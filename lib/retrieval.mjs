/**
 * retrieval.mjs —— 本地经典检索（零依赖、纯函数、可单测）
 * ============================================================================
 * 设计原则（对应方案的「四条底线」）：
 *   ① **本地有据优先**：只用打包进来的语料说话，不联网、不靠模型记忆；
 *   ② **无据必须留白**：查不到就返回 found:false，**绝不编一条像样的句子**；
 *   ③ **引用必带章句号**：每条命中都带 id / 章 / 句号，能回溯到原文；
 *   ④ 结果里显式区分「本地有据」与「未收录」——调用方据此决定要不要去联网查。
 *
 * 三路检索：
 *   · 典出（exact）：直接把查到的句子当原句用
 *   · 关键词（keyword）：给一个意思，找最接近的几句（供模型挑，或作"旁证"）
 *   · 编号（ref）：按 `lunyu.1.1` / `論語·學而·1` 这类写法精确取
 * ============================================================================
 */

/** 去标点与空白，只留下汉字/字母/数字，用于子串比对 */
export function normalize(text) {
  return String(text ?? '')
    .replace(/[\s\u3000]/g, '')
    .replace(/[，。！？；：「」『』（）《》〈〉…—·、,.!?;:()\[\]{}"'“”‘’~～\-_/\\|]/g, '')
}

/** 中文数字（用于"第N章""卷N"之类的检索） */
const CN_DIGITS = { '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 }
const CN_UNITS = { '十': 10, '百': 100, '千': 1000 }

/** "十有五" → 15，"二十三" → 23，"一〇八" → 108；解析不了返回 NaN */
export function cnToInt(s) {
  const t = String(s ?? '').trim()
  if (!t) return NaN
  if (/^\d+$/.test(t)) return Number(t)
  let total = 0
  let section = 0
  let digit = 0
  let sawUnit = false
  for (const ch of t) {
    if (ch in CN_DIGITS) {
      digit = CN_DIGITS[ch]
      if (digit === 0) { section *= 10; digit = 0 }
    } else if (ch in CN_UNITS) {
      sawUnit = true
      section += (digit || 1) * CN_UNITS[ch]
      digit = 0
    } else {
      return NaN
    }
  }
  total = section + digit
  if (!sawUnit && t.length > 1) {
    // "一〇八" 这种逐位写法
    let n = 0
    for (const ch of t) {
      if (!(ch in CN_DIGITS)) return NaN
      n = n * 10 + CN_DIGITS[ch]
    }
    return n
  }
  return total
}

/**
 * 字形归并表 —— 检索层最重要的一个决定。
 * ---------------------------------------------------------------------------
 * 语料里的繁体篇（诗经/礼记/左传/尚书/周易）和简体篇（论语/大学/道德经…）是
 * 混着来的，用户输入十有八九是简体。如果只做"原样比对"，
 * 「关关雎鸠」会查不到「關關雎鳩」—— 这属于**技术性查不到**，不是真的没收录，
 * 会直接把「无据必须留白」这条底线变成「动不动就留白」。
 *
 * 做法：建索引时把每条原文折成**简体侧**的规范形，查询也照同样规则折一次。
 * 表里每项是「简体+繁体」两字一组（成对而不是拼接成串，拼接版取下标太容易错位）。
 * 只收"一对一同义"的常用字，多义字（干/乾/幹、发/發/髮）刻意不做，
 * 保证折两次和折一次结果一样 —— 否则索引与查询会错位。
 */
const TRAD_PAIRS = [
  '与與',
  '万萬',
  '亲親',
  '亿億',
  '仅僅',
  '从從',
  '众衆',
  '优優',
  '会會',
  '伟偉',
  '传傳',
  '伤傷',
  '华華',
  '单單',
  '卫衞',
  '变變',
  '听聽',
  '员員',
  '和龢',
  '国國',
  '图圖',
  '圣聖',
  '场場',
  '坏壞',
  '备備',
  '复復',
  '头頭',
  '夺奪',
  '奋奮',
  '妇婦',
  '学學',
  '实實',
  '宫宮',
  '对對',
  '将將',
  '尔爾',
  '尘塵',
  '岁歲',
  '师師',
  '义義',
  '广廣',
  '张張',
  '归歸',
  '当當',
  '强強',
  '论論',
  '讥譏',
  '识識',
  '说說',
  '谓謂',
  '请請',
  '诸諸',
  '读讀',
  '谁誰',
  '谋謀',
  '让讓',
  '议議',
  '训訓',
  '讲講',
  '讹訛',
  '讼訟',
  '诈詐',
  '调調',
  '谈談',
  '谢謝',
  '谦謙',
  '谨謹',
  '过過',
  '还還',
  '这這',
  '进進',
  '远遠',
  '违違',
  '连連',
  '迟遲',
  '适適',
  '选選',
  '逊遜',
  '遗遺',
  '边邊',
  '达達',
  '迁遷',
  '运運',
  '关關',
  '兴興',
  '养養',
  '兽獸',
  '内內',
  '册冊',
  '军軍',
  '农農',
  '击擊',
  '刘劉',
  '则則',
  '刚剛',
  '创創',
  '剂劑',
  '剑劍',
  '劝勸',
  '动動',
  '势勢',
  '勋勳',
  '劳勞',
  '医醫',
  '区區',
  '协協',
  '厌厭',
  '县縣',
  '参參',
  '双雙',
  '叙敘',
  '号號',
  '吓嚇',
  '吕呂',
  '吗嗎',
  '吨噸',
  '呜嗚',
  '咏詠',
  '响響',
  '哑啞',
  '唤喚',
  '啸嘯',
  '喷噴',
  '嘱囑',
  '园園',
  '围圍',
  '坚堅',
  '垒壘',
  '声聲',
  '夹夾',
  '奖獎',
  '妆妝',
  '娱娛',
  '婴嬰',
  '孙孫',
  '宁寧',
  '宝寶',
  '审審',
  '宪憲',
  '宽寬',
  '宾賓',
  '寻尋',
  '导導',
  '寿壽',
  '尝嘗',
  '尧堯',
  '尸屍',
  '屉屜',
  '属屬',
  '峦巒',
  '币幣',
  '帅帥',
  '帜幟',
  '带帶',
  '帮幫',
  '幸倖',
  '庆慶',
  '庐廬',
  '库庫',
  '弃棄',
  '庄莊',
  '庙廟',
  '庞龐',
  '废廢',
  '开開',
  '异異',
  '彻徹',
  '径徑',
  '忧憂',
  '怀懷',
  '态態',
  '怜憐',
  '总總',
  '恋戀',
  '恳懇',
  '恼惱',
  '悦悅',
  '悬懸',
  '惊驚',
  '惧懼',
  '惨慘',
  '惭慚',
  '慑懾',
  '懒懶',
  '戏戲',
  '战戰',
  '户戶',
  '执執',
  '扩擴',
  '扫掃',
  '扬揚',
  '扰擾',
  '护護',
  '报報',
  '担擔',
  '拟擬',
  '拦攔',
  '择擇',
  '挤擠',
  '挥揮',
  '损損',
  '换換',
  '据據',
  '掳擄',
  '掺摻',
  '揽攬',
  '携攜',
  '摄攝',
  '摊攤',
  '撑撐',
  '撵攆',
  '撸擼',
  '擞擻',
  '敌敵',
  '敛斂',
  '数數',
  '斋齋',
  '斗鬥',
  '斩斬',
  '断斷',
  '无無',
  '旧舊',
  '时時',
  '旷曠',
  '昙曇',
  '显顯',
  '晋晉',
  '晒曬',
  '晓曉',
  '晕暈',
  '暂暫',
  '术術',
  '机機',
  '杀殺',
  '杂雜',
  '权權',
  '条條',
  '来來',
  '杨楊',
  '极極',
  '杰傑',
  '构構',
  '枢樞',
  '标標',
  '栋棟',
  '树樹',
  '桥橋',
  '档檔',
  '梦夢',
  '检檢',
  '楼樓',
  '槛檻',
  '横橫',
  '欢歡',
  '欤歟',
  '殁歿',
  '毁毀',
  '气氣',
  '汉漢',
  '汤湯',
  '沟溝',
  '沪滬',
  '泪淚',
  '泽澤',
  '洁潔',
  '洒灑',
  '浃浹',
  '浅淺',
  '浆漿',
  '浊濁',
  '测測',
  '涟漣',
  '润潤',
  '涨漲',
  '淀澱',
  '秽穢',
  '稳穩',
  '满滿',
  '滞滯',
  '潜潛',
  '澜瀾',
  '濒瀕',
  '灭滅',
  '灯燈',
  '灵靈',
  '灾災',
  '灿燦',
  '炉爐',
  '烂爛',
  '烦煩',
  '热熱',
  '焕煥',
  '爱愛',
  '爷爺',
  '牍牘',
  '牵牽',
  '犹猶',
  '狈狽',
  '独獨',
  '狱獄',
  '猪豬',
  '献獻',
  '环環',
  '现現',
  '玑璣',
  '玺璽',
  '玛瑪',
  '电電',
  '畅暢',
  '疗療',
  '疟瘧',
  '痒癢',
  '痴癡',
  '疯瘋',
  '盐鹽',
  '监監',
  '盖蓋',
  '盘盤',
  '着著',
  '睁睜',
  '矫矯',
  '碍礙',
  '祸禍',
  '禄祿',
  '种種',
  '积積',
  '称稱',
  '窍竅',
  '竞競',
  '笃篤',
  '笔筆',
  '笺箋',
  '签簽',
  '简簡',
  '篓簍',
  '类類',
  '饭飯',
  '饮飲',
  '饯餞',
  '饰飾',
  '饱飽',
  '饲飼',
  '馆館',
  '驱驅',
  '驳駁',
  '驴驢',
  '骏駿',
  '骗騙',
  '驶駛',
  '驾駕',
  '验驗',
  '髅髏',
  '髪髮',
  '鸡雞',
  '鸟鳥',
  '鸣鳴',
  '鸦鴉',
  '鸿鴻',
  '鹏鵬',
  '鹤鶴',
  '麸麩',
  '黄黃',
  '齐齊',
  '齿齒',
  '龙龍',
  '龟龜',
  '众眾',
  '姜薑',
  '讐讎',
  '争爭',
  '净淨',
  '冲衝',
  '凉涼',
  '减減',
  '凑湊',
  '决決',
  '况況',
  '冻凍',
  '凄淒',
  '准準',
  '凌淩',
  '复覆',
  '挣扎',
  '丘邱',
  '托盘',
  '约約',
  '页頁',
  '郑鄭',
  '兰蘭',
  '问問',
  '阳陽',
  '阴陰',
  '觉覺',
  '习習',
  '乐樂',
  '愠慍',
  '鲜鮮',
  '弟悌',
  '乱亂',
  '见見',
  '贤賢',
  '闻聞',
  '鸠鳩',
  '辗輾',
  '侧側',
  '钟鐘',
]

/** 「简繁」两两成对 → 单字映射（建表一次，查询时 O(1) 查表） */
const TO_SIMPLIFIED = (() => {
  const m = new Map()
  for (const pair of TRAD_PAIRS) m.set(pair[1], pair[0])
  return m
})()

/** 少量异体/古今字：不在上表里，但检索时必须看成同一个字 */
const VARIANT_FOLD = [
  [/牀/g, '床'], [/嘆/g, '叹'], [/爲/g, '为'], [/於/g, '于'], [/裏/g, '里'],
  [/牠/g, '它'], [/祂/g, '他'], [/眞/g, '真'], [/乗/g, '乘'], [/説/g, '说'],
  [/兌/g, '兑'], [/眾/g, '衆'], [/亙/g, '亘'], [/衹/g, '只'], [/祇/g, '只'],
]

/** 折一折：异体字 → 简体规范化 */
function fold(str) {
  let s = str
  for (const [re, to] of VARIANT_FOLD) s = s.replace(re, to)
  if (TO_SIMPLIFIED.size === 0) return s
  let out = ''
  for (const ch of s) {
    const to = TO_SIMPLIFIED.get(ch)
    out += to === undefined ? ch : to
  }
  return out
}

/**
 * 从查询串里认出「出处」与「原句」两部分。
 *   "孟子·告子上「鱼，我所欲也」"  → { origin: '孟子', quote: '鱼，我所欲也' }
 *   纯原句                          → { origin: '', quote: '鱼，我所欲也' }
 *   纯出处                          → { origin: '孟子·告子上', quote: '' }
 */
export function parseQuery(input) {
  const raw = String(input ?? '').trim()
  if (!raw) return { origin: '', quote: '', hint: '', raw }
  // ① "孟子·告子上「鱼，我所欲也」" —— 出处 + 带引号的原句
  const m = raw.match(/^(.{1,24}?)[「『“]([\s\S]{2,}?)[」』”]$/)
  if (m) return { origin: m[1].trim().replace(/[·\-—，,\s]+$/, ''), quote: m[2].trim(), hint: '', raw }
  // ② "孟子·告子上" / "論語 學而" —— 只给引用，不带原句
  if (/^[\u4e00-\u9fa5·\-—\s]{2,20}$/.test(raw) && /[·\-—]|[\u4e00-\u9fa5]\s+\S/.test(raw)
      && !/[，。！？；]/.test(raw)) {
    return { origin: raw, quote: '', hint: '', raw }
  }
  // ③ "论久坐" / "落榜" —— 一个概念，不是原句：走关键词
  if (/^[\u4e00-\u9fa5]{2,8}$/.test(raw)) {
    return { origin: '', quote: '', hint: raw, raw }
  }
  // ④ 其余当原句
  return { origin: '', quote: raw, hint: '', raw }
}

/**
 * 检索器。`books` 是 lib/index.mjs 加载出来的语料数组（见 build-corpus 的产物形状）。
 * 纯函数、无 I/O，方便在测试里直接构造小语料。
 */
export function createRetriever(books, options = {}) {
  const maxHits = Math.max(1, Number(options.maxHits) || 6)
  const minScore = Number.isFinite(options.minScore) ? Number(options.minScore) : 0.34

  // ── 建索引：每条原文都预先折成可比的串；另建二元组倒排 ──────────────
  const units = []
  for (const book of books) {
    for (const u of book.units || []) {
      const text = u.text || ''
      units.push({
        id: u.id,
        book: book.slug,
        bookTitle: book.title,
        section: u.section || '',
        seq: u.seq ?? 0,
        text,
        norm: fold(normalize(text)),
      })
    }
  }
  const bigrams = new Map()
  for (let i = 0; i < units.length; i++) {
    const n = units[i].norm
    const seen = new Set()
    for (let k = 0; k + 1 < n.length; k++) {
      const bg = n.slice(k, k + 2)
      if (seen.has(bg)) continue
      seen.add(bg)
      let arr = bigrams.get(bg)
      if (!arr) bigrams.set(bg, (arr = []))
      arr.push(i)
    }
  }
  const byId = new Map(units.map((u, i) => [u.id, i]))
  const booksByKey = new Map()
  for (const b of books) {
    for (const k of new Set([b.slug, b.title, b.fullTitle, ...(b.aliases || [])].filter(Boolean))) {
      booksByKey.set(String(k), b)
    }
  }

  const normQuery = (q) => fold(normalize(q))

  /** 原句精确检索：先整串，再退到较长的子串窗口 */
  function exact(quote, origin) {
    const nq = normQuery(quote)
    if (nq.length < 2) return []
    const hits = []
    for (let i = 0; i < units.length; i++) {
      const u = units[i]
      if (!u.norm.includes(nq)) continue
      hits.push({ i, why: 'quote' })
    }
    if (hits.length) return hits
    // 整句没中：拿查询里最长的、≥4 字的片段再试一次（用户常把两句拼在一起问）
    if (nq.length >= 8) {
      for (const size of [Math.floor(nq.length * 0.7), Math.floor(nq.length * 0.5)]) {
        if (size < 4) continue
        for (let s = 0; s + size <= nq.length; s++) {
          const piece = nq.slice(s, s + size)
          const found = []
          for (let i = 0; i < units.length; i++) {
            if (units[i].norm.includes(piece)) found.push({ i, why: 'quote-part' })
          }
          if (found.length) return found
        }
      }
    }
    return []
  }

  /** 关键词（二元组交集 + 长度归一）打分 */
  function keyword(q, origin, limit) {
    const nq = normQuery(q)
    if (nq.length < 2) return []
    const score = new Map()
    for (let k = 0; k + 1 < nq.length; k++) {
      const bg = nq.slice(k, k + 2)
      const arr = bigrams.get(bg)
      if (!arr) continue
      for (const i of arr) score.set(i, (score.get(i) || 0) + 1)
    }
    const total = Math.max(1, nq.length - 1)
    const originBook = origin ? bookOfOrigin(origin) : null
    const out = []
    for (const [i, c] of score) {
      let s = c / total
      // 整串子串命中：这基本就是原句，二元组重合率会低看它，得单独抬上去。
      // 例：「天命之谓性」在礼记·中庸里是连续一段，但二元组计数会和别的书打平。
      if (units[i].norm.includes(nq)) s = Math.max(s, 0.98)
      else if (nq.length >= 4 && longestCommonRun(units[i].norm, nq) >= Math.ceil(nq.length * 0.6)) {
        s = Math.max(s, 0.8)
      }
      // 出处对上了，再加一档：同书里的句子更可能是用户要找的
      if (originBook && units[i].book === originBook.slug) s = Math.min(1, s + 0.15)
      if (s >= minScore) out.push({ i, score: s, why: 'keyword' })
    }
    out.sort((a, b) => b.score - a.score || a.i - b.i)
    return out.slice(0, limit)
  }

  /** 两个串的最长公共连续子串长度（判断"像不像原句"比二元组更准） */
  function longestCommonRun(a, b) {
    if (!a || !b) return 0
    const m = b.length
    let prev = new Uint16Array(m + 1)
    let cur = new Uint16Array(m + 1)
    let best = 0
    for (let i = 1; i <= a.length; i++) {
      const ca = a.charCodeAt(i - 1)
      for (let j = 1; j <= m; j++) {
        cur[j] = ca === b.charCodeAt(j - 1) ? prev[j - 1] + 1 : 0
        if (cur[j] > best) best = cur[j]
      }
      const t = prev; prev = cur; cur = t
      cur.fill(0)
    }
    return best
  }

  /** "孟子·告子上" / "論語 學而" 这类出处串 → 书 */
  function bookOfOrigin(origin) {
    const t = String(origin || '').trim()
    if (!t) return null
    const head = t.split(/[·\-—\s]/)[0]
    for (const key of [head, t]) {
      const b = booksByKey.get(key)
      if (b) return b
    }
    // 允许"孟子"匹配到"孟子选读"这类带尾巴的书名
    for (const [k, b] of booksByKey) {
      if (k.length >= 2 && (head.includes(k) || k.includes(head))) return b
    }
    return null
  }

  /** 按 id 或"书·篇·序"取一条 */
  function byReference(ref) {
    const t = String(ref || '').trim()
    if (!t) return []
    const direct = byId.get(t)
    if (direct !== undefined) return [{ i: direct, why: 'ref' }]
    const m = t.match(/^(.+?)[·\-—.\s]+(.+?)(?:[·\-—.第\s]+(\d+)(?:句|章|则)?)?$/)
    if (!m) return []
    const book = bookOfOrigin(m[1])
    if (!book) return []
    const secName = m[2]
    const seq = m[3] ? cnToInt(m[3]) : NaN
    const out = []
    for (let i = 0; i < units.length; i++) {
      const u = units[i]
      if (u.book !== book.slug) continue
      if (!Number.isNaN(seq) && u.seq === seq) out.push({ i, why: 'ref' })
      else if (Number.isNaN(seq) && secName && normalize(u.section).includes(normalize(secName))) out.push({ i, why: 'ref' })
    }
    return out
  }

  function present(hit) {
    const u = units[hit.i]
    return {
      id: u.id,
      book: u.book,
      bookTitle: u.bookTitle,
      section: u.section,
      seq: u.seq,
      text: u.text,
      why: hit.why,
      citation: `${u.bookTitle}·${u.section}${u.seq ? `·${u.seq}` : ''}`,
      ...(hit.score === undefined ? {} : { score: Math.round(hit.score * 100) / 100 }),
    }
  }

  /**
   * 主入口。返回结构固定（调用方与工具 schema 都依赖它）：
   *   { found, mode, hits:[...], emptyReason? }
   * found:false 表示**本地语料里没有**，调用方必须留白或另想办法 —— 不许凑。
   */
  function search(input, opts = {}) {
    const { origin, quote, hint, raw } = parseQuery(input)
    const limit = Math.max(1, Math.min(20, Number(opts.limit) || maxHits))

    // ① 只给了"书·篇·序"引用 → 精确取
    if (!quote && !hint) {
      const refHits = byReference(raw)
      if (refHits.length) {
        return { found: true, mode: 'ref', query: { origin, quote, hint }, hits: refHits.slice(0, limit).map(present) }
      }
      return { found: false, mode: 'ref', query: { origin, quote, hint }, hits: [], emptyReason: 'not-in-corpus', searched: raw }
    }

    // ② 概念/原句检索：整串精确 → 关键词兜底
    const needle = quote || hint
    const exactHits = exact(needle, origin)
    if (exactHits.length) {
      return { found: true, mode: 'exact', query: { origin, quote, hint }, hits: exactHits.slice(0, limit).map(present) }
    }

    // ③ 关键词：明确标成 keyword，让调用方知道这不是原句，而是"最接近的几句"
    const kw = keyword([needle, origin].filter(Boolean).join(' '), origin, limit)
    if (kw.length) {
      return { found: true, mode: 'keyword', query: { origin, quote, hint }, hits: kw.map(present) }
    }

    return { found: false, mode: 'none', query: { origin, quote, hint }, hits: [], emptyReason: 'not-in-corpus', searched: raw }
  }

  /** 全书目清单（给"本地有什么"用） */
  function catalog() {
    return books.map((b) => ({
      slug: b.slug,
      title: b.title,
      fullTitle: b.fullTitle,
      tier: b.tier,
      scope: b.scope,
      units: (b.units || []).length,
      chars: (b.units || []).reduce((n, u) => n + (u.text || '').length, 0),
      edition: b.edition,
      source: b.source,
    }))
  }

  function stats() {
    const chars = units.reduce((n, u) => n + u.text.length, 0)
    return { books: books.length, units: units.length, chars }
  }

  /** 按 id 取一条原文（工具回显用） */
  function get(id) {
    const i = byId.get(String(id))
    return i === undefined ? null : present({ i, why: 'get' })
  }

  return { search, catalog, stats, get, parseQuery, normalize: normQuery }
}
