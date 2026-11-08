/**
 * style.mjs —— 「周礼体」的体例、自查清单、拼装器
 * ============================================================================
 * 这个文件是插件的**灵魂**：它不生成文字，它规定「什么算合格」。
 * 生成交给模型，把关交给我们自己 —— 因为模型最容易犯的错不是写得不好，
 * 而是**编一条很像的古文**。所以这里的每一条都写成可机械检验的。
 *
 * 四条底线（对应的检查器都在 checkDraft 里）：
 *   ① 本地有据优先   —— c0_local_grounded
 *   ② 无据必须留白   —— c1_quote_verifiable
 *   ③ 引用必带章句号 —— c2_citation
 *   ④ 默认不对外发布 —— c4_no_publish
 * ============================================================================
 */

/** 三段式的骨架。`{{...}}` 是占位，不是模板语法 */
export const FORM = {
  name: '大周礼体',
  opening: '我曾听说',
  ending: '你还是好好想想吧',
  skeleton: [
    '我曾听说，{{一句话点出情形，不点道理}}。',
    '{{典故：名 + 原句 + 谁在什么处境下说的}}。',
    '{{按：把典故与眼前的情形对上，得出一句可执行的话}}。',
    '你还是好好想想吧。',
  ],
  /** 语气配比：先秦论说文的句法骨架 + 明清劝善书的训诫语气 + 极少量当代词 */
  tone: {
    syntax: '先秦论说文：短句、对举、先立后破',
    register: '明清劝善书：《菜根谭》式的训诫与体谅并存',
    modern: '当代口语只用一两个词，且不能与文句抢戏',
  },
}

/** 每段的字数上限（视频口播节奏：一段六七秒） */
export const LENGTH = {
  openingMax: 42,
  allusionMax: 120,
  closingMax: 60,
  totalMin: 90,
  totalMax: 320,
}

/**
 * 禁忌表。`re` 是能被机械命中的写法；`why` 是给人看的原因。
 * 加新条目时请连 `why` 一起写 —— 没有理由的禁忌等于审查。
 */
export const TABOOS = [
  { key: 'fake-anecdote', re: /據說|據史料記載|有記載說|史書上說|据说|据史料记载|有记载说|史书上说/, why: '「据说/史料记载」是最常见的无据发明，用了就等于给编造盖章' },
  { key: 'fake-master', re: /古人云[^「]{0,4}(?!「)|孔子曰[^「]{0,2}(?!「)|孟子曰[^「]{0,2}(?!「)/, why: '「古人云」直接接自造句子，是伪引的最高频形态' },
  { key: 'politeness', re: /家人們|姐妹們|寶子|yyds|誰懂啊|真的栓Q/, why: '网络称呼会把训诫语气整段打碎' },
  { key: 'exclamation', re: /[！!]{2,}/, why: '连用感叹号，训诫就变成了喝斥' },
  { key: 'drama', re: /震驚|炸裂|諷刺|絕了|離譜/, why: '情绪副词越过典故本身，会让议论变成宣泄' },
  { key: 'modern-jargon', re: /賦能|抓手|閉環|落地|顆粒度|癢點/, why: '职场黑话与文言骨架冲突，且通常对应空洞的内容' },
]

/** 自查清单 —— 生成后立刻拿它过一遍；每一条都要能回答"是/否" */
export const CHECKLIST = [
  { id: 'c0_local_grounded', q: '引用的句子是否全部来自本地语料或标了 verified 的典故表？', fail: '有句子查不到出处 ⇒ 删掉它，宁可少说一句' },
  { id: 'c1_quote_verifiable', q: '把「我曾听说」和引文全删掉，剩下的道理还站得住吗？', fail: '站不住 ⇒ 说明这条议论文目前只是引文的回声，需重写' },
  { id: 'c2_citation', q: '每处引用是否带书名·篇·章句号？', fail: '缺章句号 ⇒ 补上，或降级为"某处见过"（等于承认无据）' },
  { id: 'c3_no_empty_assertion', q: '有没有一句是"不言自明因而无需论证"的空话？', fail: '有 ⇒ 换成具体动作，或整句删去' },
  { id: 'c4_no_publish', q: '是否默认按"不对外发布"处理（这只是草稿，不是我替你做决定）？', fail: '若用户要求发布，需显式确认，且不得改动引文' },
]

/** 常见误用 → 该被点破的错觉。模型写「按」的时候要挑一条对上 */
export const MISUSE_LIBRARY = [
  { pattern: /努力|奋斗|拼搏/, misused: '把「韦编三绝」当成「我很努力」的奖状', reframe: '原文说的是书读旧了，不是人熬苦了' },
  { pattern: /摆烂|躺平|放弃/, misused: '把「安步当车」当成穷酸的自嘲', reframe: '颜斶说的是不换回来，不是换不起' },
  { pattern: /热愛|爱好|兴趣|粉丝/, misused: '把「叶公好龙」当成"假喜欢"的帽子', reframe: '叶公的问题是龙真来了那一刻的反应' },
  { pattern: /套路|模板|方法/, misused: '把「刻舟求剑」当成"守旧"的通用骂词', reframe: '楚人的错是坐标没跟着船走' },
  { pattern: /效率|加速|催/, misused: '把「揠苗助长」当成反对一切加速', reframe: '宋人拔的是一棵棵苗，不是时间' },
  { pattern: /运气|侥幸|中奖/, misused: '把「守株待兔」当成骂人不思进取', reframe: '宋人放下的是耒，不是判断' },
];

/**
 * 现代词 → 典故表里的场景标签。
 * ---------------------------------------------------------------------------
 * 典故表的标签是文言式的（「勉学」「处困」「立身」），用户说的是白话（「努力」「躺平」）。
 * 中间不搭这座桥，pickAllusions 就会对着一句「努力」一无所获 —— 然后按体例留白，
 * 明明是能查到的。留白是底线，但不该被**匹配失败**冒充成留白。
 */
const SCENE_ALIASES = [
  [/努|奋斗|拼搏|用功|刻苦|坚持|自律|下功夫/, ['勉学', '持志', '修身']],
  [/躺平|摆烂|放弃|泄气|消沉|颓/, ['持志', '处困', '自守']],
  [/被催|着急|赶|加速|效率|急/, ['急功', '应事', '时机']],
  [/读书|学习|看书|上学|考试|学问|落榜/, ['勉学', '学问', '传习']],
  [/识人|看人|交友|朋友|同事|关系/, ['识人', '处交', '处众']],
  [/飘|自满|骄傲|得意|夸|爽/, ['自省', '修身', '名实']],
  [/官|做官|领导|管理|为政|权力/, ['为政', '制度', '责任']],
  [/真假|谣言|传言|听说|消息|刷屏/, ['求真', '闻听', '听言']],
  [/穷|难|困|倒霉|运气|不顺/, ['处困', '侥幸', '应事']],
  [/养老|身体|久坐|健康|养生/, ['养生', '修身']],
  [/教子|孩子|管教|管孩子/, ['教育', '传习']],
  [/分寸|边界|过头|适度/, ['分寸', '取舍']],
  [/套路|模仿|跟风|抄/, ['模仿', '名实']],
  [/吃亏|忍|让|退/, ['处下', '取舍', '自守']],
]

/** 把一个白话词翻成可能的场景标签（翻不出来就是空数组，不是硬凑） */
export function sceneTags(text) {
  const key = String(text || '')
  const tags = []
  for (const [re, list] of SCENE_ALIASES) {
    if (re.test(key)) for (const t of list) if (!tags.includes(t)) tags.push(t)
  }
  return tags
}

/**
 * 按「落点」挑素材：给一个现代处境，返回能用的典故与可对照的原文。
 * 不做重排、不改写 —— 只做挑选，因为挑选是可审的，改写不可审。
 *
 * 三路打分，任何一路都算命中（只靠 scene 标签会大量漏挑）：
 *   ① 场景标签（含白话别名的换算）
 *   ② 主题词直接出现在典故名/引文/今用里
 *   ③ 误用库：这个处境正好踩中某条常见误用
 */
export function pickAllusions(allusions, scene, limit = 3) {
  const key = String(scene || '').trim()
  if (!key) return []
  const tags = sceneTags(key)
  const scored = []
  for (const a of allusions) {
    let score = 0
    // ① 场景标签
    for (const s of a.scene || []) {
      if (key.includes(s) || s.includes(key)) score += 3
      else if (tags.includes(s)) score += 2
    }
    // ② 主题词直接出现在条目里
    if (a.term && (key.includes(a.term) || a.term.includes(key))) score += 5
    const hay = `${a.term || ''}${a.quote || ''}${a.modernTie || ''}`
    if (key.length >= 2 && hay.includes(key)) score += 3
    // ③ 误用库
    for (const m of MISUSE_LIBRARY) {
      if (m.pattern.test(key) && new RegExp(m.pattern.source).test(a.modernTie || '')) score += 1
    }
    if (score > 0) scored.push({ a, score: score + (a.strength || 0) })
  }
  scored.sort((x, y) => y.score - x.score)
  return scored.slice(0, limit).map(({ a }) => ({
    term: a.term,
    source: a.source,
    quote: a.quote,
    story: a.story,
    modernTie: a.modernTie,
    misuse: a.misuse,
    verified: Boolean(a.verified),
  }))
}

/**
 * 拼装器 —— **不写正文**，只把可用的材料摆成三段式的槽位。
 * 为什么要这样：让模型照着槽位填，比让它自由发挥更容易被检查。
 */
export function composeSkeleton({ theme, hits = [], allusions = [], scene = '' }) {
  const noted = []
  const slots = FORM.skeleton.map((line) => {
    if (line.includes('{{典故')) {
      const a = allusions[0]
      if (!a) {
        noted.push('本地典故表里没有贴合的条目 ⇒ 这一段留白，不要现编一个')
        return '[留白] 典故：本地无据'
      }
      return `典故：${a.term}（${a.source}「${a.quote}」）`
    }
    if (line.includes('{{按')) {
      const a = allusions[0]
      const tie = a ? a.modernTie : ''
      return `按：${tie ? `原文说的是「${tie}」` : '原文要自己读，不要替它下结论'}；落到眼前：${theme || '[待填]'}`
    }
    if (line.includes('{{一句话点出情形')) {
      return `我曾听说，${theme ? `${theme}这件事，` : '[情形，一句]'}`
    }
    return line
  })

  const citations = [
    ...hits.filter((h) => h.mode !== 'keyword').map((h) => h.citation),
    ...allusions.map((a) => `${a.source}「${a.quote}」`),
  ]

  return {
    form: FORM.name,
    theme: theme || '',
    scene: scene || '',
    skeleton: slots,
    citations,
    materials: {
      local: hits.map((h) => ({ citation: h.citation, text: h.text, mode: h.mode })),
      allusions,
    },
    notes: noted,
    checklist: CHECKLIST.map((c) => ({ id: c.id, q: c.q })),
    remind: '这只是一份材料清单，正文要自己写；写完请按 checklist 自查，尤其 c1。',
  }
}

/**
 * 机械自查：能判的判，不能判的如实说"判不了"，别假装通过。
 * 返回 { pass, findings:[{id, level:'fail'|'warn'|'info', message}] }
 */
export function checkDraft(text) {
  const t = String(text || '')
  const findings = []
  const push = (id, level, message) => findings.push({ id, level, message })

  if (!t.trim()) return { pass: false, findings: [{ id: 'empty', level: 'fail', message: '正文为空' }] }

  // 三段式是否存在
  if (!/我曾聽說|我曾听说/.test(t)) push('form-opening', 'warn', '没有「我曾听说」起手（若刻意不用，可忽略）')
  if (!/你還是好好想想吧|你还是好好想想吧/.test(t)) push('form-ending', 'warn', '没有「你还是好好想想吧」收束（若刻意不用，可忽略）')

  // 引用是否带书名号
  const quoted = t.match(/「[^」]{4,}」|『[^』]{4,}』/g) || []
  const citedCount = (t.match(/《[^》]{1,20}》[\u4e00-\u9fa5·]{0,12}/g) || []).length
  if (quoted.length > 0 && citedCount === 0) {
    push('c2_citation', 'fail', `有 ${quoted.length} 处引号内的引文，但没有任何《书名·篇》标注 —— 违反「引用必带章句号」`)
  } else if (quoted.length > citedCount) {
    push('c2_citation', 'warn', `${quoted.length} 处引文，${citedCount} 处标注：可能有引文没跟上出处`)
  }

  // 「据说/史料记载」类伪引
  for (const tb of TABOOS) {
    const m = t.match(tb.re)
    if (m) push(`taboo:${tb.key}`, 'fail', `出现「${m[0]}」：${tb.why}`)
  }

  // 长度
  const len = t.replace(/\s/g, '').length
  if (len < LENGTH.totalMin) push('length', 'warn', `${len} 字，短于体例下限 ${LENGTH.totalMin} 字`)
  if (len > LENGTH.totalMax) push('length', 'warn', `${len} 字，长于体例上限 ${LENGTH.totalMax} 字`)

  // c1 只能由模型回答，这里如实声明
  push('c1_quote_verifiable', 'info', '「删掉引文还站得住吗」只能人/模型自己回答，机械检查不做判断')

  const pass = !findings.some((f) => f.level === 'fail')
  return { pass, length: len, quotes: quoted.length, citations: citedCount, findings }
}

/** 给 systemPrompt 用的规则文本（简短，注入到每一步） */
export function rulesForPrompt(corpusStats) {
  const stats = corpusStats ? `本地语料 ${corpusStats.books} 部、${corpusStats.units} 条、${corpusStats.chars} 字。` : ''
  return [
    '【周礼体】用户要求用「周礼体」说话时，遵守以下四条，缺一条即为不合格：',
    '① 本地有据优先：凡引用，先用 zhouliti_lookup 或 zhouliti_allusion 在本地查；查到什么说什么。',
    '② 无据必须留白：查不到就明说「这一条我手边没有出处」，禁止凭印象补一句像样的古文。',
    '③ 引用必带章句号：写成《论语·雍也》「觚不觚，觚哉！觚哉！」这样的形式，不许只写「古人说」。',
    '④ 默认不对外发布：产出的是草稿，要不要发、发到哪里由用户决定，你不替他做。',
    '体例三段：我曾听说（点情形）→ 典故（名+原句+处境）→ 按（对上前事）→ 你还是好好想想吧。',
    '自查一问：把「我曾听说」和引文全删掉，剩下的道理还站得住吗？站不住就重写。',
    stats,
  ].filter(Boolean).join('\n')
}
