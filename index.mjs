/**
 * index.mjs —— dsh-zhouliti 宿主端入口
 * ============================================================================
 * 干三件事：
 *   ① 把经典语料挂成检索能力（本地有据优先）；
 *   ② 把「周礼体」的体例与四条底线注入 systemPrompt（无据必须留白）；
 *   ③ 记一笔小小的账：这一轮引用了几条经典、有没有留白（默认不对外发布 = 只在本地记账）。
 *
 * ⚠️ 加载纪律：这里**不能出现任何裸 import**（`@deepseek-ai/*` 一律经 lib/hostdeps.mjs 动态加载）。
 *    桌面版 profile 的 `autoInstallPeers: false` 会让裸 import 直接把整条插件打哑 —— 详见 hostdeps 的注释。
 * ============================================================================
 */
import { readFileSync, existsSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

import { loadDefineTool, loadSchemastery } from './lib/hostdeps.mjs'
import { createRetriever } from './lib/retrieval.mjs'
import { FORM, CHECKLIST, rulesForPrompt, composeSkeleton, pickAllusions, checkDraft } from './lib/style.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * 工具的输出声明 —— 宿主强制要求的形状：`{ schema, render }`。
 * ---------------------------------------------------------------------------
 * 为什么必须有 render：宿主用 `render` 的返回值（内容块数组）作为**给模型看的正文**，
 * `execute` 的返回值则是给前端卡片用的结构化数据。两者分开，前端才能画卡片而
 * 模型只读话。少了它整条插件都注册不上（报 `must declare output`）。
 *
 * 这里的 render 一律把结构化结果翻成一句人话 —— 因为模型的下一句往往就是给用户看的，
 * 让它读 JSON 是浪费且容易漏看 `found:false`。
 */
function textOutput(schema, toText) {
  return {
    schema,
    render: (_args, value) => [{ type: 'text', text: toText(value) }],
  }
}

/** 「查不到」这件事必须在 render 里说得很重，否则模型会当没看见 */
function renderLookup(v) {
  if (!v.found) {
    return `本地未收录（${v.emptyReason || 'no-match'}）：${v.usage || '请如实说"这一条我手边没有出处"，禁止补写。'}`
  }
  const lines = v.hits.map((h, i) => `${i + 1}. 《${h.citation}》「${h.text}」`)
  return [
    `本地命中 ${v.hits.length} 条（${v.mode}）：`,
    ...lines,
    v.usage ? `用法：${v.usage}` : '',
  ].filter(Boolean).join('\n')
}

function renderAllusion(v) {
  if (!v.found) return `典故表未收录：${v.hint || '请改用 zhouliti_lookup 查原文，或如实留白。'}`
  return v.hits.map((a, i) => [
    `${i + 1}. ${a.term} —— ${a.source}「${a.quote}」`,
    a.story ? `   故事：${a.story}` : '',
    a.modernTie ? `   今用：${a.modernTie}` : '',
    a.misuse ? `   易误：${a.misuse}` : '',
    a.verified ? '   引文已机械校验' : '   引文未经校验，引用前请再核',
  ].filter(Boolean).join('\n')).join('\n')
}

function renderCompose(v) {
  return [
    `【${v.form.name}】骨架（正文自己写，这里只是槽位）：`,
    ...v.skeleton.map((line, i) => `${i + 1}. ${line}`),
    v.citations.length ? `可引出处：${v.citations.join('；')}` : '可引出处：无（典故段须留白）',
    ...v.notes.map((n) => `注意：${n}`),
    v.remind,
  ].join('\n')
}

function renderCheck(v) {
  const fails = v.findings.filter((f) => f.level === 'fail')
  const warns = v.findings.filter((f) => f.level === 'warn')
  return [
    v.pass ? '自查通过。' : `自查未过（${fails.length} 处硬伤）。`,
    `${v.length} 字 · ${v.quotes} 处引文 · ${v.citations} 处出处标注`,
    ...fails.map((f) => `✕ ${f.message}`),
    ...warns.map((f) => `! ${f.message}`),
  ].join('\n')
}

function renderStatus(v) {
  return [
    `本地语料 ${v.stats.books} 部 / ${v.stats.units} 条 / ${v.stats.chars} 字；典故 ${v.allusions.total} 条（${v.allusions.verified} 条已校验）。`,
    ...v.corpus.map((b) => `${b.tier} ${b.title}：${b.units} 条 · ${b.scope || ''}`),
    `本会话：引用 ${v.ledger.citations} 条，留白 ${v.ledger.blanks} 次。`,
  ].join('\n')
}

/** 插件名（日志前缀 / 系统提示段名都用它） */
export const name = 'zhouliti'

/** 依赖的服务：tools 必须有；systemPrompt 有则注入，没有也能跑 */
export const inject = ['tools']

// ── 语料加载：一次读完，之后只读 ─────────────────────────────────────
function loadCorpus() {
  const dir = join(HERE, 'data', 'corpus')
  const indexFile = join(dir, 'index.json')
  if (!existsSync(indexFile)) return { books: [], index: null }
  const index = JSON.parse(readFileSync(indexFile, 'utf8'))
  const books = []
  for (const meta of index.books || []) {
    const f = join(dir, meta.file)
    if (!existsSync(f)) continue
    try { books.push(JSON.parse(readFileSync(f, 'utf8'))) } catch { /* 单个文件坏了不该拖垮全插件 */ }
  }
  return { books, index }
}

function loadAllusions() {
  const f = join(HERE, 'data', 'allusions.jsonl')
  if (!existsSync(f)) return []
  const rows = []
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    try { rows.push(JSON.parse(s)) } catch { /* 跳过坏行，别让一条脏数据炸掉整表 */ }
  }
  return rows
}

/** 配置目录：先问宿主的 dshHomePath（是函数，不是字符串），再退到 ~/.dsh */
/** 读回上次的引用账；文件坏了就当新账，不抛错 */
function loadLedger(file) {
  const fresh = { citations: 0, blanks: 0, lastAt: 0, sessions: 0 }
  try {
    if (!existsSync(file)) return fresh
    const v = JSON.parse(readFileSync(file, 'utf8'))
    return {
      citations: Number(v.citations) || 0,
      blanks: Number(v.blanks) || 0,
      lastAt: Number(v.lastAt) || 0,
      sessions: Number(v.sessions) || 0,
    }
  } catch {
    return fresh
  }
}

function configDir(ctx) {
  try {
    const p = ctx.get('dshHomePath')
    if (typeof p === 'function') return p('zhouliti')
  } catch { /* ignore */ }
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'zhouliti')
}

export async function apply(ctx, config = {}) {
  const defineTool = await loadDefineTool()
  const { books, index } = loadCorpus()
  const allusions = loadAllusions()
  const retriever = createRetriever(books, { maxHits: Number(config.maxHits) || 6 })

  // 引用账：只记条数与次数，不存正文（默认不对外发布）。
  // 落盘到状态目录，否则插件每次重载都清零 —— 那种「本会话 0 条」是假的。
  const statePath = configDir(ctx)
  const ledgerFile = join(statePath, 'ledger.json')
  const ledger = loadLedger(ledgerFile)
  function saveLedger() {
    try {
      mkdirSync(statePath, { recursive: true })
      writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2))
    } catch { /* 记不上账不影响主功能 */ }
  }

  const stats = retriever.stats()
  ctx.logger?.info?.(`[zhouliti] 语料 ${stats.books} 部 / ${stats.units} 条 / ${stats.chars} 字；典故 ${allusions.length} 条`)

  // ── 工具 1：查经典 ────────────────────────────────────────────────
  const lookup = defineTool({
    name: 'zhouliti_lookup',
    description: '在本地四书五经语料里检索原文。可以给原句（"鱼，我所欲也"）、给引用（"孟子·告子上"）、或给一个概念（"久坐""落榜"）。返回 found=false 表示本地没有 —— 这时必须如实说"手边没有出处"，不许补一句像样的古文。',
    parameters: {
      query: { type: 'string', description: '原句 / 引用（如 孟子·告子上）/ 概念（如 守拙）' },
      limit: { type: 'number', description: '最多返回几条，默认 6' },
    },
    output: textOutput({
      type: 'object',
      additionalProperties: false,
      required: ['found', 'hits'],
      properties: {
        found: { type: 'boolean' },
        mode: { type: 'string' },
        emptyReason: { type: 'string' },
        usage: { type: 'string' },
        hint: { type: 'string' },
        query: { type: 'object', additionalProperties: true, required: [], properties: {} },
        searched: { type: 'string' },
        hits: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            required: ['citation', 'text'],
            properties: {
              citation: { type: 'string' },
              text: { type: 'string' },
              book: { type: 'string' },
              section: { type: 'string' },
              seq: { type: 'number' },
              note: { type: 'string' },
            },
          },
        },
      },
    }, renderLookup),
    async execute({ query, limit }) {
      const r = retriever.search(query, { limit })
      if (!r.found) ledger.blanks += 1
      else ledger.citations += r.hits.length
      saveLedger()
      return {
        ...r,
        // 提示模型这段结果该怎么用：exact/ref 可当原句引用，keyword 只能当"最接近的几句"
        usage: r.found
          ? (r.mode === 'keyword'
            ? '这些是按关键词找到的最接近的句子，不是你要的原句。若要引用，必须引用这里的原文并带章句号。'
            : '可直接引用，引用时请写成《书名·篇·序》「原文」。')
          : '本地语料没有收录。请如实留白（"这一条我手边没有出处"），或建议用户去查权威版本；禁止凭记忆补写。',
      }
    },
  })

  // ── 工具 2：查典故 ────────────────────────────────────────────────
  const allusion = defineTool({
    name: 'zhouliti_allusion',
    description: '查典故表：条目的原句、故事、可对应的现代表达、以及"最常见的误用"。verified=true 表示引文已机械校验过。',
    parameters: {
      query: { type: 'string', description: '典故名（韦编三绝）或一个现代处境（努力/躺平/被催）' },
      limit: { type: 'number', description: '最多返回几条，默认 4' },
    },
    output: textOutput({
      type: 'object',
      additionalProperties: false,
      required: ['found', 'hits'],
      properties: {
        found: { type: 'boolean' },
        mode: { type: 'string' },
        hint: { type: 'string' },
        query: { type: 'object', additionalProperties: true, required: [], properties: {} },
        hits: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            required: ['term', 'source', 'quote'],
            properties: {
              term: { type: 'string' },
              source: { type: 'string' },
              quote: { type: 'string' },
              story: { type: 'string' },
              modernTie: { type: 'string' },
              misuse: { type: 'string' },
              verified: { type: 'boolean' },
            },
          },
        },
      },
    }, renderAllusion),
    async execute({ query, limit }) {
      const q = String(query || '').trim()
      if (!q) return { found: false, hits: [], hint: '查询为空。', mode: 'none' }
      const n = Math.max(1, Math.min(10, Number(limit) || 4))
      const picked = pickAllusions(allusions, q, n)
      if (picked.length) {
        ledger.citations += picked.length
        saveLedger()
        return { found: true, mode: 'scene', hits: picked }
      }
      const byName = allusions.filter((a) => a.term.includes(q) || q.includes(a.term))
      if (byName.length) {
        ledger.citations += byName.length
        saveLedger()
        return { found: true, mode: 'term', hits: byName.slice(0, n) }
      }
      ledger.blanks += 1
      saveLedger()
      return { found: false, hits: [], hint: '典故表未收录；请在 zhouliti_lookup 里找原文，或如实留白。' }
    },
  })

  // ── 工具 3：搭骨架（不代写）──────────────────────────────────────
  const compose = defineTool({
    name: 'zhouliti_compose',
    description: '给一个主题，返回「周礼体」三段式的槽位与可用材料（不生成正文）。正文仍须自己写，写完用 zhouliti_check 自查。',
    parameters: {
      theme: { type: 'string', description: '主题，如 "刷屏""久坐""被夸了两句就飘"' },
      scene: { type: 'string', description: '落点（可选）：努力/躺平/被催/识人/为政…' },
    },
    output: textOutput({
      type: 'object',
      additionalProperties: true,
      required: ['form', 'skeleton', 'citations', 'notes'],
      properties: {
        form: { type: 'object', additionalProperties: true, required: [], properties: {} },
        theme: { type: 'string' },
        scene: { type: 'string' },
        skeleton: { type: 'array', items: { type: 'string' } },
        citations: { type: 'array', items: { type: 'string' } },
        notes: { type: 'array', items: { type: 'string' } },
        remind: { type: 'string' },
        corpusNote: { type: 'string' },
        materials: { type: 'object', additionalProperties: true, required: [], properties: {} },
        checklist: { type: 'array', items: { type: 'object', additionalProperties: true, required: [], properties: {} } },
      },
    }, renderCompose),
    async execute({ theme, scene }) {
      const hits = retriever.search(theme, { limit: 4 })
      const picked = pickAllusions(allusions, scene || theme, 2)
      const materials = composeSkeleton({
        theme, scene: scene || '', allusions: picked,
        hits: hits.found ? hits.hits.map((h) => ({ ...h, mode: hits.mode })) : [],
      })
      return {
        ...materials,
        corpusNote: hits.found ? `本地命中 ${hits.hits.length} 条（${hits.mode}）` : '本地未命中该主题，典故段按体例留白',
        form: { ...FORM },
      }
    },
  })

  // ── 工具 4：机械自查 ─────────────────────────────────────────────
  const check = defineTool({
    name: 'zhouliti_check',
    description: '对一段「周礼体」草稿做机械自查：三段式是否齐、引文有没有带出处、有没有"据说/史料记载"这类伪引、长度是否合规。不能判断的部分会如实说"判不了"。',
    parameters: {
      text: { type: 'string', description: '要检查的正文' },
    },
    output: textOutput({
      type: 'object',
      additionalProperties: true,
      required: ['pass', 'findings'],
      properties: {
        pass: { type: 'boolean' },
        length: { type: 'number' },
        quotes: { type: 'number' },
        citations: { type: 'number' },
        checklist: { type: 'array', items: { type: 'object', additionalProperties: true, required: [], properties: {} } },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            required: ['id', 'level', 'message'],
            properties: {
              id: { type: 'string' },
              level: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    }, renderCheck),
    async execute({ text }) {
      const r = checkDraft(text)
      return { ...r, checklist: CHECKLIST.map((c) => ({ id: c.id, q: c.q })) }
    },
  })

  // ── 工具 5：本地有什么 ────────────────────────────────────────────
  const status = defineTool({
    name: 'zhouliti_status',
    description: '看本地语料与典故表的规模、检索器状态，以及本会话的引用账（引用了几条、留白了几次）。',
    parameters: {},
    output: textOutput({
      type: 'object',
      additionalProperties: true,
      required: ['stats', 'corpus', 'allusions', 'ledger'],
      properties: {
        stats: { type: 'object', additionalProperties: true, required: [], properties: {} },
        corpus: { type: 'array', items: { type: 'object', additionalProperties: true, required: [], properties: {} } },
        allusions: { type: 'object', additionalProperties: true, required: [], properties: {} },
        ledger: { type: 'object', additionalProperties: true, required: [], properties: {} },
        generatedAt: { type: 'string' },
        rules: { type: 'array', items: { type: 'string' } },
      },
    }, renderStatus),
    async execute() {
      return {
        corpus: retriever.catalog(),
        stats: retriever.stats(),
        allusions: { total: allusions.length, verified: allusions.filter((a) => a.verified).length },
        ledger: { ...ledger },
        generatedAt: index?.generatedAt || null,
        rules: ['本地有据优先', '无据必须留白', '引用必带章句号', '默认不对外发布'],
      }
    },
  })

  const tools = config.enableTools === false ? [] : [lookup, allusion, compose, check, status]
  for (const t of tools) {
    ctx.effect(() => ctx.tools.register(t))
  }

  // ── 系统提示：只在开启时注入，且写得很短（每步都要复述，长一点都嫌贵）──
  if (config.injectRules !== false) {
    ctx.inject(['systemPrompt'], (sp) => {
      ctx.effect(() => sp.systemPrompt.context({
        name: 'zhouliti:rules',
        order: 3200,
        text: () => rulesForPrompt(stats),
        interpolate: false,
      }))
    })
  }

  // ── 给设置页喂数据（只读，不暴露正文，只给规模）──────────────────────
  //
  // ⚠️ webServer.register 收的是对象 `{ kind, path, handler }`，不是 (path, handler)。
  //    拿不到 webServer 就静默跳过 —— 桌面版某些 profile 没装这个服务，
  //    少了它只是设置页读不到数，工具照常能用。
  try {
    const ws = ctx.get('webServer')
    if (ws && typeof ws.register === 'function') {
      const payload = () => JSON.stringify({
        stats,
        corpus: retriever.catalog(),
        allusions: { total: allusions.length, verified: allusions.filter((a) => a.verified).length },
        ledger: { ...ledger },
        generatedAt: index?.generatedAt || null,
      })
      ctx.effect(() => ws.register({
        kind: 'exact',
        path: '/api/zhouliti/status',
        handler: async (req, res) => {
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          })
          res.end(payload())
        },
      }))
    }
  } catch (e) {
    ctx.logger?.debug?.(`[zhouliti] webServer 不可用，设置页将读不到统计：${e?.message || e}`)
  }

  // ── 记账：只数条数，不存正文 ──────────────────────────────────────
  ctx.effect(() => ctx.on('session/event', (session, event) => {
    if (!event || !event.type) return
    if (event.type === 'turn/end') {
      // 一轮结束时把这一轮的账落一次盘，这样重载插件后数字还在
      ledger.sessions += 1
      ledger.lastAt = Date.now()
      saveLedger()
    }
  }))
}

/** 给宿主看的插件级 Config（可选）：只用得到两三个开关，参数尽量少 */
export async function Config(Schema) {
  return Schema.object({
    maxHits: Schema.natural().default(6).description('单次检索最多返回几条'),
    injectRules: Schema.boolean().default(true).description('是否把「周礼体」规则注入系统提示'),
    enableTools: Schema.boolean().default(true).description('是否注册工具（关掉后只剩系统提示规则）'),
  })
}

export default { name, inject, apply }
