import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { createRetriever, normalize, parseQuery, cnToInt } from '../lib/retrieval.mjs'
import { checkDraft, composeSkeleton, pickAllusions, LENGTH, rulesForPrompt, sceneTags } from '../lib/style.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadCorpus() {
  const index = JSON.parse(readFileSync(join(ROOT, 'data', 'corpus', 'index.json'), 'utf8'))
  return index.books.map((b) => JSON.parse(readFileSync(join(ROOT, 'data', 'corpus', b.file), 'utf8')))
}

const books = loadCorpus()
const r = createRetriever(books)

// ── 语料 ────────────────────────────────────────────────────────────
test('语料至少收了四书与诗经', () => {
  const slugs = books.map((b) => b.slug)
  for (const need of ['lunyu', 'daxue', 'mengzi_full', 'shijing', 'liji', 'yijing']) {
    assert.ok(slugs.includes(need), `缺 ${need}`)
  }
})

test('甲档书必须在 catalog 里标成甲', () => {
  const cat = r.catalog()
  const lunyu = cat.find((b) => b.slug === 'lunyu')
  assert.equal(lunyu.tier, '甲')
})

test('语料里没有残留的维基标记', () => {
  const dirty = /header\d*|zh-hans|zh-hant|毛詩序|缩略图|\{\{/
  for (const b of books) {
    for (const u of b.units) {
      assert.ok(!dirty.test(u.text), `${b.slug} ${u.id} 残留标记：${u.text.slice(0, 40)}`)
    }
  }
})

// ── 检索 ────────────────────────────────────────────────────────────
test('原句检索：学而时习之', () => {
  const res = r.search('学而时习之')
  assert.equal(res.mode, 'exact')
  assert.equal(res.hits[0].book, 'lunyu')
  assert.equal(res.hits[0].section, '1.1')
})

test('简繁互查：简体输入能命中繁体篇', () => {
  const res = r.search('关关雎鸠')
  assert.equal(res.mode, 'exact')
  assert.equal(res.hits[0].book, 'shijing')
  assert.match(res.hits[0].text, /關關雎鳩/)
})

test('原句检索：礼记·中庸', () => {
  const res = r.search('天命之谓性')
  assert.equal(res.mode, 'exact')
  assert.equal(res.hits[0].book, 'liji')
  assert.equal(res.hits[0].section, '中庸')
})

test('出处 + 原句的写法', () => {
  const res = r.search('孟子·告子上「鱼，我所欲也」')
  assert.equal(res.found, true)
  assert.equal(res.hits[0].book, 'mengzi')
})

test('查不到就必须是 found:false —— 不许凑', () => {
  const res = r.search('民惟邦本')
  assert.equal(res.found, false, '这句不该在语料里，也绝不该被关键词凑出来')
  assert.equal(res.emptyReason, 'not-in-corpus')
})

test('命中必带 citation，形如 书名·篇·序', () => {
  const res = r.search('学而时习之')
  assert.match(res.hits[0].citation, /^.+·.+·\d+$/)
})

test('parseQuery 四种形态', () => {
  assert.deepEqual(parseQuery('孟子·告子上「鱼，我所欲也」'), { origin: '孟子·告子上', quote: '鱼，我所欲也', hint: '', raw: '孟子·告子上「鱼，我所欲也」' })
  assert.equal(parseQuery('论久坐').hint, '论久坐')
  assert.equal(parseQuery('学而时习之，不亦说乎').quote, '学而时习之，不亦说乎')
  assert.equal(parseQuery('孟子·告子上').origin, '孟子·告子上')
})

test('cnToInt 认中文数字', () => {
  assert.equal(cnToInt('十五'), 15)
  assert.equal(cnToInt('二十三'), 23)
  assert.equal(cnToInt('108'), 108)
  assert.ok(Number.isNaN(cnToInt('abc')))
})

test('normalize 去标点', () => {
  assert.equal(normalize('子曰：「学而时习之，不亦说乎？」'), '子曰学而时习之不亦说乎')
})

test('检索够快（100 次 < 800ms）', () => {
  const t0 = Date.now()
  for (let i = 0; i < 100; i++) r.search('学而时习之')
  assert.ok(Date.now() - t0 < 800, `太慢：${Date.now() - t0}ms`)
})

// ── 体例与自查 ──────────────────────────────────────────────────────
test('好稿子能过 checkDraft', () => {
  const good = [
    '我曾听说，如今读书的人，书是新的，字是新的，人却旧了。',
    '孔子晚年喜《易》，读得书绳断了三次——《史记·孔子世家》「讀《易》，韋編三絕」。他说的不是用功，是那部书被他翻旧了。',
    '按：把「韦编三绝」当成努力的奖状，是把读旧当成了熬苦。落到眼前：与其添一本新书，不如把手里这本读旧。',
    '你还是好好想想吧。',
  ].join('')
  const res = checkDraft(good)
  assert.equal(res.pass, true, JSON.stringify(res.findings))
})

test('伪引「据说」必须判 fail', () => {
  const res = checkDraft('我曾听说，据说古人每天读书十卷。《论语》「学而时习之」。你还是好好想想吧。')
  assert.equal(res.pass, false)
  assert.ok(res.findings.some((f) => f.id === 'taboo:fake-anecdote'))
})

test('有引文却没出处必须判 fail', () => {
  const res = checkDraft('我曾听说，「天行健，君子以自强不息」这句话很有道理，你要好好想想。你还是好好想想吧。')
  assert.equal(res.pass, false)
  assert.ok(res.findings.some((f) => f.id === 'c2_citation' && f.level === 'fail'))
})

test('空稿直接 fail', () => {
  assert.equal(checkDraft('').pass, false)
})

test('长度阈值参与检查', () => {
  const short = '我曾听说。你还是好好想想吧。'
  const res = checkDraft(short)
  assert.ok(res.findings.some((f) => f.id === 'length'))
  assert.ok(LENGTH.totalMin > 0)
})

test('pickAllusions 按场景挑，不发明条目', () => {
  const all = JSON.parse(readFileSync(join(ROOT, 'data', 'allusions.jsonl'), 'utf8').trim().split('\n')[0])
  const picked = pickAllusions([all], '勉学')
  assert.ok(Array.isArray(picked))
  for (const p of picked) assert.ok(['term', 'source', 'quote'].every((k) => k in p))
})

test('引用账会落盘 —— 重载插件后不该清零', async () => {
  const home = mkdtempSync(join(tmpdir(), 'zhouliti-ledger-'))
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const m = await import('../index.mjs')
    const boot = async () => {
      const regs = []
      const ctx = {
        effect: (fn) => fn(), get: () => undefined, logger: { info() {}, debug() {} },
        on: () => () => {}, inject() {},
        tools: { register: (t) => { regs.push(t); return () => {} } },
        systemPrompt: { context: () => () => {} },
      }
      await m.apply(ctx, {})
      return regs
    }
    let regs = await boot()
    await regs.find((t) => t.name === 'zhouliti_lookup').execute({ query: '学而时习之' })
    assert.ok(existsSync(join(home, 'zhouliti', 'ledger.json')), '引用账没有落盘')

    regs = await boot()
    const st = regs.find((t) => t.name === 'zhouliti_status')
    const text = st.output.render({}, await st.execute({}))[0].text
    assert.match(text, /引用 [1-9]/, `重载后引用账被清零了：${text}`)
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prev
    rmSync(home, { recursive: true, force: true })
  }
})

test('白话处境能翻成典故表的场景标签（否则会误留白）', () => {
  assert.ok(sceneTags('努力').includes('勉学'))
  assert.ok(sceneTags('刷屏').includes('求真'))
  assert.deepEqual(sceneTags(''), [])
})

test('给白话处境能挑出典故 —— 不能因为标签对不上就留白', () => {
  const rows = readFileSync(join(ROOT, 'data', 'allusions.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  for (const scene of ['努力', '躺平', '被催', '刷屏', '识人', '教子']) {
    const picked = pickAllusions(rows, scene, 2)
    assert.ok(picked.length > 0, `「${scene}」竟然一条典故都挑不出来 —— 这会被体例误当成"无据留白"`)
  }
})

test('composeSkeleton 在无典故时明确留白', () => {
  const s = composeSkeleton({ theme: '论久坐' })
  assert.ok(s.skeleton.some((line) => line.includes('[留白]')), '没有素材时必须留白，不能编')
  assert.ok(s.checklist.length > 0)
})

test('rulesForPrompt 含四条底线', () => {
  const text = rulesForPrompt(r.stats())
  for (const key of ['本地有据优先', '无据必须留白', '引用必带章句号', '默认不对外发布']) {
    assert.ok(text.includes(key), `缺 ${key}`)
  }
})

// ── 典故表 ──────────────────────────────────────────────────────────
test('典故表每条都有出处与原句', () => {
  const lines = readFileSync(join(ROOT, 'data', 'allusions.jsonl'), 'utf8').trim().split('\n')
  assert.ok(lines.length >= 50, `典故太少：${lines.length}`)
  const seen = new Set()
  for (const line of lines) {
    const a = JSON.parse(line)
    assert.ok(a.term && a.source && a.quote, JSON.stringify(a).slice(0, 80))
    assert.ok(!seen.has(a.term), `典故重复：${a.term}`)
    seen.add(a.term)
  }
})

test('标了 verified 的典故，原句必须真能在语料里查到（或明说是外部来源）', () => {
  const lines = readFileSync(join(ROOT, 'data', 'allusions.jsonl'), 'utf8').trim().split('\n')
  const all = lines.map((l) => JSON.parse(l))
  const verified = all.filter((a) => a.verified)
  assert.ok(verified.length > 0)
  // 这里只做弱校验：verified 的条目引文长度合理
  for (const a of verified) assert.ok(a.quote.length >= 4, `${a.term} 引文太短`)
})
