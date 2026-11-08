#!/usr/bin/env node
/**
 * build-corpus.mjs —— 把各来源的语料统一成插件运行时读的形状
 * ============================================================================
 * 产物：`data/corpus/<slug>.json`（一部书一个文件）+ `data/corpus/index.json`
 *
 *   {
 *     slug, title, fullTitle, tier("甲"|"乙"|"丙"), scope, source, edition, aliases[],
 *     units: [ { id, section, seq, text, note? } ]
 *   }
 *
 *   甲档 = 可安心引用的全本（四书、诗经、礼记、周易）
 *   乙档 = 节本/选篇，引用要说明"出自某篇某条"（左传、尚书）
 *   丙档 = 旁证，只能当佐料（道德经、庄子选读、菜根谭、史记、资治通鉴）
 *
 * ⭐ 为什么在**构建期**切好、而不是运行时切：
 *   ① 检索要好用，切分必须落在"章句"边界上，而各来源的结构千差万别
 *      （孟子 `===N===`、诗经按行、左传逐条、周易 `*#爻辞`）；
 *   ② 切一次、校验一次，运行时只做只读加载 —— 快，且不会跑偏；
 *   ③ 各来源许可证不同（CC BY-SA / 公有领域），必须在数据里标清楚。
 *
 * 来源：
 *   · `$CLASSICS_CORPUS/source-guoxue-reader.json` —— 本地四书读本（简体，
 *     论语 501 则、大学 31、孟子选读 18、道德经 81、庄子选读 12、菜根谭 356）
 *   · 维基文库（繁体）—— 诗经、礼记、周易、左传、尚书、史记、资治通鉴 // CC BY-SA 4.0
 * 两者并存：同一句**繁简都能命中**，因为检索层会做字形归并。
 *
 * 用法：
 *   node scripts/build-corpus.mjs            # 原始抓取物默认在 $ZHOULITI_RAW 或 /tmp/harness/raw
 *   ZHOULITI_RAW=/path/to/raw node scripts/build-corpus.mjs
 * ============================================================================
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'data', 'corpus')
mkdirSync(OUT, { recursive: true })

const RAW = process.env.ZHOULITI_RAW || '/tmp/harness/raw'
const LOCAL = process.env.CLASSICS_CORPUS
  || join(homedir(), 'Documents', 'deepseek-harness', 'default-workspace', 'classics-corpus')

// ── 小工具 ────────────────────────────────────────────────────────────
const readJson = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null)

/** 数据进库前最后一次过筛：剥掉维基标记、压缩空白、去掉行首列表符 */
function tidy(text) {
  return String(text || '')
    .replace(/\[\[Category:[^\]]*\]\]/g, '')
    .replace(/zh-hans:[^;，。]*[;，]\s*zh-hant:([^;，。]*)[;，]?/g, '$1')
    .replace(/zh-(?:hans|hant):/g, '')
    .replace(/\{\{|\}\}/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u3000\s]+/g, '')
    .replace(/^[;:*#T|]+/, '')
    .replace(/^==+.*==+$/, '')     // 残留的章节标题行
    .replace(/^(?:header2?|周易\/[^；，。]*)/g, '')   // 维基页头残留
    .replace(/^[+|，、]+/, '')
    .trim()
}

/** 按句读切块，尽量贴近 [min, max] 字 */
function splitBySentence(text, min, max) {
  const out = []
  let buf = ''
  for (const ch of text) {
    buf += ch
    if ('。！？；'.includes(ch) && buf.length >= min) {
      if (buf.length <= max) {
        out.push(buf); buf = ''
      } else {
        const cut = buf.lastIndexOf('，', max)
        if (cut > min) { out.push(buf.slice(0, cut + 1)); buf = buf.slice(cut + 1) }
        else { out.push(buf); buf = '' }
      }
    }
  }
  if (buf.trim().length >= 4) out.push(buf)
  return out
}

// ── 论语：修好 label 错乱（label 原来是「1.1 · 学而时习之，不亦说乎？有」）──
const LUNYU_PIAN = ['學而', '爲政', '八佾', '里仁', '公冶長', '雍也', '述而', '泰伯', '子罕', '鄉黨',
  '先進', '顏淵', '子路', '憲問', '衞靈公', '季氏', '陽貨', '微子', '子張', '堯曰']

function lunyuSection(p, index) {
  // ① 优先用 id（lunyu.1.1 这种，最可信）
  const m = /^lunyu\.(\d+)\.(\d+)$/.exec(String(p.id || ''))
  if (m) return { key: `${m[1]}.${m[2]}`, pian: LUNYU_PIAN[Number(m[1]) - 1] || '' }
  // ② 退而用 label 里的章号，只取「N.M」，**不要**把后面的正文带进来
  const l = /^(\d+)\.(\d+)/.exec(String(p.label || '').trim())
  if (l) return { key: `${l[1]}.${l[2]}`, pian: LUNYU_PIAN[Number(l[1]) - 1] || '' }
  // ③ 再退到 sourceChapter（學而第一·1）
  const s = /·\s*(\d+)/.exec(String(p.sourceChapter || ''))
  if (s) return { key: `?${s[1]}.${index + 1}`, pian: '' }
  return { key: `?${index + 1}`, pian: '' }
}

/** 本地简体读本 → 统一形状 */
function fromLocalReader(file) {
  const raw = readJson(file)
  if (!raw) return []
  const books = raw.books || raw
  const out = []
  for (const b of books) {
    const slug = String(b.slug || '').trim()
    if (!slug) continue
    const isLunyu = slug === 'lunyu'
    const units = []
    ;(b.paragraphs || []).forEach((p, i) => {
      const text = tidy(p.original || p.traditional || '')
      if (text.length < 4) return
      const sec = isLunyu ? lunyuSection(p, i) : null
      units.push({
        id: p.id || `${slug}.${i + 1}`,
        section: sec ? sec.key : String(p.sourceChapter || p.label || '').trim(),
        seq: i + 1,
        text,
        ...(sec && sec.pian ? { chapter: sec.pian } : {}),
        ...(p.annotation ? { note: String(p.annotation) } : {}),
      })
    })
    if (!units.length) continue
    // 甲档只有真正的四书 + 中庸（中庸从礼记进来，不在这里）
    const tier = ['lunyu', 'daxue', 'mengzi'].includes(slug) ? '甲' : '丙'
    out.push({
      slug,
      title: b.title || slug,
      fullTitle: b.fullTitle || b.title || slug,
      tier,
      scope: b.scope ? String(b.scope).trim() : '全本',
      source: 'classics-corpus/source-guoxue-reader.json（简体读本）',
      edition: b.edition || '',
      aliases: b.aliases || [],
      units,
    })
  }
  return out
}

// ── 诗经：一首诗一个 unit，句由「，」连缀；section 直接用原文的「周南」「小雅」等 ────
const SHIJING_FENGYA = new Set(['周南', '召南', '邶風', '鄘風', '衞風', '王風', '鄭風', '齊風', '魏風',
  '唐風', '秦風', '陳風', '檜風', '曹風', '豳風', '小雅', '大雅', '周頌', '魯頌', '商頌'])
const SHIJING_JUAN = ['周南', '召南', '邶風', '鄘風', '衞風', '王風', '鄭風', '齊風', '魏風', '唐風',
  '秦風', '陳風', '檜風', '曹風', '豳風', '小雅', '大雅', '周頌', '魯頌', '商頌']
const SHIJING_SEQ = { 周南: 1, 召南: 1, 邶風: 1, 鄘風: 1, 衞風: 1, 王風: 1, 鄭風: 1, 齊風: 1, 魏風: 1,
  唐風: 1, 秦風: 1, 陳風: 1, 檜風: 1, 曹風: 1, 豳風: 1, 小雅: 1, 大雅: 1, 周頌: 1, 魯頌: 1, 商頌: 1 }

function buildShijing(file) {
  const raw = readJson(file)
  if (!raw) return null
  const units = []
  let seq = 0
  // 按 (风/雅/颂, 篇号) 排序 —— dict 顺序是抓取顺序，不是原书顺序
  const entries = Object.entries(raw).sort((a, b) => {
    const ia = SHIJING_JUAN.indexOf(a[1].section), ib = SHIJING_JUAN.indexOf(b[1].section)
    if (ia !== ib) return ia - ib
    return (a[1].no || 0) - (b[1].no || 0)
  })
  for (const [name, v] of entries) {
    const segs = ((Array.isArray(v) ? v : v.segs) || [])
      .map((x) => tidy(typeof x === 'string' ? x : (Array.isArray(x) ? x.join('') : x.text)))
      .filter((s) => s.length >= 3 && !/(?:header\d*|周易\/|\{\{|\}\})/.test(s))
    if (!segs.length) continue
    seq += 1
    let sec = Array.isArray(v) ? '' : String(v.section || '')
    // 雅/颂的原始 section 是「鹿鳴之什」这类「什」，归到 小雅/大雅/周頌
    if (!SHIJING_FENGYA.has(sec)) {
      if (/頌/.test(sec)) sec = sec.startsWith('魯') ? '魯頌' : sec.startsWith('商') ? '商頌' : '周頌'
      else if (/之什/.test(sec)) sec = ['文王之什', '生民之什', '蕩之什'].includes(sec) ? '大雅' : '小雅'
      else sec = ''
    }
    const no = v.no || (SHIJING_SEQ[sec]++)
    units.push({
      id: `shijing.${name}`,
      section: sec ? `${sec}·${no}` : '',
      chapter: sec,
      seq,
      title: name,
      text: segs.join(''),
    })
  }
  return {
    slug: 'shijing',
    title: '诗经',
    fullTitle: '毛诗',
    tier: '甲',
    scope: `全本（${units.length} 篇；通行本 305 篇，缺芣苢、韓奕等，另 6 篇笙诗有目无辞）`,
    source: '维基文库 詩經 // CC BY-SA 4.0',
    edition: '毛诗正义本',
    aliases: ['詩經', '毛詩', '诗'],
    units,
  }
}

// ── 礼记：篇 + 通行本卷次（「礼记·中庸」查得到，「礼记·卷一」也查得到）──────────
const LIJI_JUAN = {
  一: ['曲禮上', '曲禮下'],
  二: ['檀弓上', '檀弓下'],
  三: ['王制'],
  四: ['月令', '曾子問'],
  五: ['文王世子', '禮運', '禮器'],
  六: ['郊特牲', '內則', '明堂位'],
  七: ['玉藻', '喪服小記', '大傳'],
  八: ['少儀', '學記', '樂記'],
  九: ['雜記上', '雜記下', '喪大記'],
  十: ['祭法', '祭義', '祭統', '經解'],
  十一: ['哀公問', '仲尼燕居', '孔子閒居', '坊記', '中庸'],
  十二: ['表記', '緇衣', '奔喪', '問喪', '服問', '間傳', '三年問', '深衣', '投壺', '儒行', '大學'],
  十三: ['冠義', '昏義', '鄉飲酒義', '射義', '燕義', '聘義', '喪服四制'],
}
const PIAN_JUAN = {}
for (const [j, list] of Object.entries(LIJI_JUAN)) for (const p of list) PIAN_JUAN[p] = j

function buildLiji(file) {
  const raw = readJson(file)
  if (!raw) return null
  const units = []
  let seq = 0
  for (const [pian, v] of Object.entries(raw)) {
    const body = tidy(v.text)
    if (body.length < 20) continue
    for (const chunk of splitBySentence(body, 45, 170)) {
      seq += 1
      units.push({
        id: `liji.${pian}.${seq}`,
        section: pian,
        chapter: PIAN_JUAN[pian] ? `卷${PIAN_JUAN[pian]}` : '',
        seq,
        text: chunk,
      })
    }
  }
  return {
    slug: 'liji',
    title: '礼记',
    fullTitle: '小戴礼记',
    tier: '甲',
    scope: '全本（49 篇）',
    source: '维基文库 禮記 // CC BY-SA 4.0',
    edition: '通行本',
    aliases: ['禮記'],
    units,
  }
}

// ── 左传：每公分条；section =「隐公·元年」这种，citation 才读得懂 ──────────────
const ZUO_GONG_ORDER = ['隱公', '桓公', '莊公', '閔公', '僖公', '文公', '宣公', '成公', '襄公', '昭公', '定公', '哀公']
const CN_NUM = ['元', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四',
  '十五', '十六', '十七', '十八', '十九', '二十', '二十一', '二十二', '二十三', '二十四', '二十五',
  '二十六', '二十七', '二十八', '二十九', '三十', '三十一', '三十二', '三十三', '三十四', '三十五',
  '三十六', '三十七', '三十八', '三十九', '四十', '四十一', '四十二', '四十三', '四十四', '四十五']

function buildZuozhuan(file) {
  const raw = readJson(file)
  if (!raw) return null
  const units = []
  let seq = 0
  for (const gong of ZUO_GONG_ORDER) {
    const v = raw[gong]
    if (!v) continue
    const lines = String(v.text || '').split('\n').map((s) => s.trim()).filter(Boolean)
    let year = 0
    for (const line of lines) {
      // 标题行「==隱公元年==」只用来记年份，不进正文
      const h = /^==+\s*(.+?)年\s*==+$/.exec(line)
      if (h) {
        const cn = h[1].replace(/^.*公/, '').trim()
        const idx = CN_NUM.indexOf(cn)
        year = idx >= 0 ? idx + 1 : year + 1
        continue
      }
      if (line.startsWith('==')) continue
      const t = tidy(line)
      if (t.length < 8) continue
      const section = year ? `${gong}·${CN_NUM[year - 1] || year}年` : gong
      for (const chunk of splitBySentence(t, 60, 220)) {
        seq += 1
        units.push({ id: `zuozhuan.${gong}.${seq}`, section, chapter: gong, seq, text: chunk })
      }
    }
  }
  return {
    slug: 'zuozhuan',
    title: '左传',
    fullTitle: '春秋左氏传',
    tier: '乙',
    scope: '节本（隐公—哀公 12 公分卷，按年系事）',
    source: '维基文库 春秋左氏傳 // CC BY-SA 4.0',
    edition: '通行本',
    aliases: ['左傳', '春秋左氏傳'],
    units,
  }
}

// ── 孟子全本（繁体，取自维基文库，比本地读本多 240 章）─────────────────────
function buildMengzi(file) {
  const raw = readJson(file)
  if (!raw) return null
  const units = []
  let seq = 0
  for (const [pian, chapters] of Object.entries(raw)) {
    if (!Array.isArray(chapters)) continue
    for (const c of chapters) {
      const t = tidy(c.text)
      if (t.length < 8) continue
      seq += 1
      units.push({
        id: `mengzi.${pian}.${c.num}`,
        section: `${pian}·${c.num}`,
        chapter: pian,
        seq,
        text: t,
      })
    }
  }
  return {
    slug: 'mengzi_full',
    title: '孟子',
    fullTitle: '孟子（全本）',
    tier: '甲',
    scope: '全本（14 篇 260 章）',
    source: '维基文库 孟子 // CC BY-SA 4.0',
    edition: '通行本',
    aliases: ['孟子', 'Mengzi'],
    units,
  }
}

// ── 尚书：篇 + 真伪分组（今文 28 篇 vs 伪古文，标出来，别拿伪书当三代之文）──────
const SHANGSHU_GUWEN = new Set(['大禹謨', '五子之歌', '胤征', '仲虺之誥', '湯誥', '伊訓', '太甲上', '太甲中',
  '太甲下', '咸有一德', '說命上', '說命中', '說命下', '泰誓上', '泰誓中', '泰誓下', '武成', '旅獒',
  '微子之命', '蔡仲之命', '周官', '君陳', '畢命', '君牙', '冏命'])

function buildShangshu(file) {
  const raw = readJson(file)
  if (!raw) return null
  const units = []
  let seq = 0
  for (const [pian, v] of Object.entries(raw)) {
    const body = tidy(typeof v === 'string' ? v : v.text)
    if (body.length < 20) continue
    for (const chunk of splitBySentence(body, 40, 160)) {
      seq += 1
      units.push({
        id: `shangshu.${pian}.${seq}`,
        section: `${pian}${SHANGSHU_GUWEN.has(pian) ? '（伪古文）' : ''}`,
        chapter: pian,
        seq,
        text: chunk,
      })
    }
  }
  return {
    slug: 'shangshu',
    title: '尚书',
    fullTitle: '尚书',
    tier: '乙',
    scope: `选篇（${Object.keys(raw).length} 篇；伪古文篇目已在 section 里标注）`,
    source: '维基文库 尚書 // CC BY-SA 4.0',
    edition: '通行本',
    aliases: ['尚書', '書經'],
    units,
  }
}

// ── 周易：一卦一条（卦辞 + 爻辞 + 彖 + 象），十翼另收 ─────────────────────
const YI_SKIP = new Set(['繫辭上', '繫辭下', '說卦', '序卦', '雜卦', '文言'])
const YI_ORDER = ['乾', '坤', '屯', '蒙', '需', '訟', '師', '比', '小畜', '履', '泰', '否', '同人', '大有',
  '謙', '豫', '隨', '蠱', '臨', '觀', '噬嗑', '賁', '剝', '復', '无妄', '大畜', '頤', '大過', '坎', '離',
  '咸', '恒', '遯', '大壯', '晉', '明夷', '家人', '睽', '蹇', '解', '損', '益', '夬', '姤', '萃', '升',
  '困', '井', '革', '鼎', '震', '艮', '漸', '歸妹', '豐', '旅', '巽', '兌', '渙', '節', '中孚', '小過',
  '既濟', '未濟']

function buildYijing(file) {
  const raw = readJson(file)
  if (!raw) return null
  const units = []
  let seq = 0
  for (const gua of YI_ORDER) {
    const v = raw[gua]
    if (!v) continue
    const lines = String(v.text || '').split('\n')
      .map((s) => s.replace(/^[;:*#T|]+/, '').trim())
      .filter(Boolean)
    const parts = []
    for (const ln of lines) {
      if (/^(header|alt=|周易第|乾下|坤下|易經：|彖曰|象曰|文言曰)/.test(ln)) continue
      if (/^(初[九六]|[九六][二三四五]|上[九六]|用[九六]|大哉|至哉|天行|地勢|潛龍|見龍|飛龍|亢龍)/.test(ln)) {
        parts.push(ln)
      } else if (parts.length === 0 && ln.length >= 4) {
        parts.push(ln)          // 卦辞（如「乾：元亨。利貞。」）
      }
    }
    const text = tidy(parts.join('；'))
    if (text.length < 6) continue
    seq += 1
    units.push({ id: `yijing.${gua}`, section: gua, chapter: '', seq, text })
  }
  for (const extra of ['繫辭上', '繫辭下', '說卦', '序卦', '雜卦']) {
    const v = raw[extra]
    if (!v) continue
    for (const chunk of splitBySentence(tidy(v.text), 40, 160)) {
      seq += 1
      units.push({ id: `yijing.${extra}.${seq}`, section: extra, chapter: '易传', seq, text: chunk })
    }
  }
  return {
    slug: 'yijing',
    title: '周易',
    fullTitle: '周易（易经 + 十翼节选）',
    tier: '甲',
    scope: '全本（64 卦）+ 系辞/说卦/序卦/杂卦',
    source: '维基文库 周易 // CC BY-SA 4.0',
    edition: '通行本',
    aliases: ['易經', '易经'],
    units,
  }
}

// ── 史记 / 资治通鉴 选段：按 wiki 小标题切 ───────────────────────────────
function buildHistory(file, meta) {
  if (!existsSync(file)) return null
  const text = readFileSync(file, 'utf8')
  const units = []
  let seq = 0
  const push = (heading, body) => {
    const t = tidy(body)
    if (t.length < 30) return
    for (const chunk of splitBySentence(t, 60, 220)) {
      seq += 1
      units.push({ id: `${meta.slug}.${heading || '卷首'}.${seq}`, section: heading || '卷首', seq, text: chunk })
    }
  }
  const parts = text.split(/==([^=\n]{1,12})==/)
  push('', parts[0])
  for (let i = 1; i < parts.length; i += 2) push(parts[i].trim(), parts[i + 1] || '')
  return { ...meta, units }
}

// ── 主流程 ────────────────────────────────────────────────────────────
const built = []

const local = fromLocalReader(join(LOCAL, 'source-guoxue-reader.json'))
console.log(`本地读本 ${local.length} 部：` + local.map((b) => `${b.title}(${b.units.length})`).join(' '))
built.push(...local)

for (const [fn, file, label] of [
  [buildMengzi, join(RAW, 'mengzi-raw.json'), '孟子全本'],
  [buildShijing, join(RAW, 'shijing-poems.json'), '诗经'],
  [buildLiji, join(RAW, 'liji-raw.json'), '礼记'],
  [buildZuozhuan, join(RAW, 'zuozhuan-raw.json'), '左传'],
  [buildShangshu, join(RAW, 'shangshu-raw.json'), '尚书'],
  [buildYijing, join(RAW, 'yijing-raw.json'), '周易'],
]) {
  const b = fn(file)
  if (!b) { console.warn(`⚠ 跳过 ${label}：缺 ${file}`); continue }
  built.push(b)
}

const shiji = buildHistory(join(RAW, 'shiji-hanshu.json'), {
  slug: 'shiji', title: '史记', fullTitle: '史记·周本纪', tier: '丙',
  scope: '选段（卷四·周本纪）', source: '维基文库 史記 // CC BY-SA 4.0', edition: '中华书局点校本', aliases: ['史記'],
})
if (shiji) built.push(shiji)

const zztj = buildHistory(join(RAW, 'zztj-001.json'), {
  slug: 'zizhitongjian', title: '资治通鉴', fullTitle: '资治通鉴·卷一', tier: '丙',
  scope: '选段（卷一·周纪一）', source: '维基文库 資治通鑑 // CC BY-SA 4.0', edition: '中华书局点校本', aliases: ['資治通鑑'],
})
if (zztj) built.push(zztj)

// 去重：同一部书内 text 相同只留第一条（论语 1.3↔17.17 这类已知重复）
let dropped = 0
for (const b of built) {
  const seen = new Set()
  b.units = b.units.filter((u) => {
    if (seen.has(u.text)) { dropped += 1; return false }
    seen.add(u.text)
    return true
  })
}

const index = []
for (const b of built) {
  writeFileSync(join(OUT, `${b.slug}.json`), JSON.stringify({
    slug: b.slug, title: b.title, fullTitle: b.fullTitle, tier: b.tier,
    scope: b.scope, source: b.source, edition: b.edition, aliases: b.aliases || [],
    units: b.units,
  }))
  const chars = b.units.reduce((n, u) => n + u.text.length, 0)
  index.push({
    slug: b.slug, title: b.title, fullTitle: b.fullTitle, tier: b.tier, scope: b.scope,
    units: b.units.length, chars, file: `${b.slug}.json`,
  })
  console.log(`${b.tier} ${b.title.padEnd(6, '　')} ${String(b.units.length).padStart(4)} 条 ${String(chars).padStart(6)} 字  ${b.scope}`)
}

writeFileSync(join(OUT, 'index.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  license: '维基文库来源为 CC BY-SA 4.0；本地读本沿用其 revision 字段所载来源',
  droppedDuplicates: dropped,
  books: index,
}, null, 2))

const totalUnits = index.reduce((n, b) => n + b.units, 0)
const totalChars = index.reduce((n, b) => n + b.chars, 0)
console.log(`\n✓ ${index.length} 部 / ${totalUnits} 条 / ${totalChars} 字；去重 ${dropped} 条`)
