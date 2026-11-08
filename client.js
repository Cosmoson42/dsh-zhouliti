/**
 * client.js —— 周礼体的 Web 前端
 * ============================================================================
 * ⚠️ 这份文件**不是 ES module**，是一段自注册脚本：宿主的模块加载器把
 *    (id, factory) 收进去，`require` 由宿主提供（React 等），不能自己 import。
 *
 * 两个挂载点：
 *   ① `settings.section`    —— 设置页里的一栏：本地收了哪些书、典故表规模、四条底线
 *   ② `tool.call.toolview`  —— 工具卡片：查到的原文怎么显示（带书名·篇·章句号）
 *
 * 视觉纪律：只用 `--dsw-alias-*` 主题变量，跟随深浅色；不写死颜色。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-zhouliti',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // ── 共用样式 ──────────────────────────────────────────────────
    const css = {
      wrap: {
        display: 'flex', flexDirection: 'column', gap: 14,
        fontSize: 13, lineHeight: 1.65, color: 'var(--dsw-alias-text-primary)',
      },
      card: {
        border: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,.22))',
        borderRadius: 10, padding: '12px 14px',
        background: 'var(--dsw-alias-surface-raised, transparent)',
      },
      label: {
        fontSize: 12, letterSpacing: '.04em',
        color: 'var(--dsw-alias-text-secondary)',
      },
      citation: {
        fontFamily: 'var(--dsw-alias-font-mono, monospace)',
        fontSize: 12, color: 'var(--dsw-alias-text-secondary)',
      },
      text: { fontSize: 14, lineHeight: 1.85 },
      muted: { fontSize: 12, color: 'var(--dsw-alias-text-secondary)' },
      row: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
      tier: (t) => ({
        display: 'inline-block', width: 18, textAlign: 'center', borderRadius: 4,
        fontSize: 11, lineHeight: '16px', marginRight: 6,
        background: t === '甲' ? 'var(--dsw-alias-accent-subtle, rgba(60,140,255,.16))' : 'transparent',
        border: t === '甲' ? 'none' : '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,.3))',
        color: 'var(--dsw-alias-text-secondary)',
      }),
    }

    /** 一个小工具：把"引用"渲染成《书名·篇·序》「原文」 */
    function Quote({ citation, text, note }) {
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h('div', { style: css.citation }, citation || '（无出处）'),
        h('div', { style: css.text }, text || ''),
        note ? h('div', { style: css.muted }, note) : null,
      )
    }

    // ── ① 设置页：本地收了多少书、四条底线 ────────────────────────────
    function Panel() {
      const [state, setState] = React.useState(null)
      const [err, setErr] = React.useState('')
      React.useEffect(() => {
        let alive = true
        fetch('/api/zhouliti/status')
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
          .then((d) => { if (alive) setState(d) })
          .catch((e) => { if (alive) setErr(String(e && e.message ? e.message : e)) })
        return () => { alive = false }
      }, [])

      const books = (state && state.corpus) || []
      const stats = (state && state.stats) || null

      return h('div', { style: css.wrap },
        h('div', null,
          h('div', { style: { fontSize: 15, fontWeight: 600 } }, '周礼体 · 四书五经'),
          h('div', { style: css.muted }, '本地经典语料检索 + 典故表 + 三段式拟古文写作规则'),
        ),

        h('div', { style: { ...css.card, display: 'flex', flexDirection: 'column', gap: 8 } },
          h('div', { style: css.label }, '四条底线'),
          ...['本地有据优先：能查到的先查，查到什么说什么',
            '无据必须留白：查不到就说"手边没有出处"，不补一句像样的古文',
            '引用必带章句号：写成《论语·雍也》「觚不觚，觚哉！觚哉！」',
            '默认不对外发布：产出的是草稿，发不发由你决定'].map((t, i) =>
            h('div', { key: i, style: { display: 'flex', gap: 8 } },
              h('span', { style: { ...css.citation, minWidth: 14 } }, String(i + 1)),
              h('span', { style: { fontSize: 13 } }, t))) ),

        h('div', { style: css.card },
          h('div', { style: css.row },
            h('span', { style: css.label }, '本地语料'),
            h('span', { style: css.muted },
              stats ? `${stats.books} 部 · ${stats.units} 条 · ${stats.chars} 字` : '…'),
          ),
          err ? h('div', { style: { ...css.muted, marginTop: 6 } }, `读不到语料：${err}`) : null,
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 } },
            ...books.map((b) => h('div', { key: b.slug, style: css.row },
              h('span', null,
                h('span', { style: css.tier(b.tier) }, b.tier),
                h('span', { style: { fontWeight: 500 } }, b.title),
                h('span', { style: { ...css.muted, marginLeft: 6 } }, b.scope || ''),
              ),
              h('span', { style: css.muted }, `${b.units} 条`),
            ))),
        ),

        h('div', { style: { ...css.card, ...css.row } },
          h('span', { style: css.label }, '典故表'),
          h('span', { style: css.muted },
            state && state.allusions
              ? `${state.allusions.total} 条，其中 ${state.allusions.verified} 条引文已机械校验`
              : '…'),
        ),

        state && state.generatedAt
          ? h('div', { style: css.muted }, `语料构建于 ${state.generatedAt}`)
          : null,
      )
    }

    // ── ② 工具卡片：查到/查不到都要说清楚 ────────────────────────────
    function ToolView(props) {
      const block = props && props.block
      const out = block && (block.result || block.output)
      const data = typeof out === 'string' ? safeParse(out) : out
      if (!data || typeof data !== 'object') return null

      const hits = Array.isArray(data.hits) ? data.hits : []
      const found = data.found !== false && data.pass !== false

      if ('findings' in data) {
        // zhouliti_check 的结果
        const fails = (data.findings || []).filter((f) => f.level === 'fail')
        const warns = (data.findings || []).filter((f) => f.level === 'warn')
        return h('div', { style: css.wrap },
          h('div', { style: { ...css.row } },
            h('span', { style: { fontWeight: 600 } }, data.pass ? '自查通过' : '自查未过'),
            h('span', { style: css.muted }, `${data.length || 0} 字 · ${data.quotes || 0} 处引文 · ${data.citations || 0} 处标注`),
          ),
          ...fails.concat(warns).map((f, i) => h('div', {
            key: i, style: { ...css.muted, color: f.level === 'fail' ? 'var(--dsw-alias-text-primary)' : undefined },
          }, `${f.level === 'fail' ? '✕' : '!'} ${f.message}`)),
        )
      }

      if (data.stats && data.corpus) {
        // zhouliti_status 的结果：本地收了什么、这一段引了几条
        const led = data.ledger || {}
        const all = data.allusions || {}
        return h('div', { style: css.wrap },
          h('div', { style: css.row },
            h('span', { style: { fontWeight: 600 } }, '本地语料'),
            h('span', { style: css.muted }, `${data.stats.books || 0} 部 · ${data.stats.units || 0} 条 · ${data.stats.chars || 0} 字`),
          ),
          h('div', { style: css.muted }, `典故 ${all.verified || 0}/${all.total || 0} 条已校验`),
          h('div', { style: css.muted }, `引用 ${led.citations || 0} 条 · 留白 ${led.blanks || 0} 次`),
        )
      }

      if (!found) {
        return h('div', { style: css.wrap },
          h('div', { style: { fontWeight: 600 } }, '本地没有收录'),
          h('div', { style: css.muted }, data.usage || data.hint || data.emptyReason || '留白'),)
      }

      return h('div', { style: css.wrap },
        h('div', { style: css.row },
          h('span', { style: css.label }, hitLabel(data)),
          h('span', { style: css.muted }, hits.length ? `${hits.length} 条` : ''),
        ),
        ...hits.slice(0, 8).map((it, i) => h('div', { key: i, style: css.card },
          h(Quote, {
            citation: it.citation || `${it.source || ''}${it.quote ? '「' + it.quote + '」' : ''}`,
            text: it.text || it.quote || it.term || '',
            note: it.note || (it.story ? String(it.story).slice(0, 180) : '') ||
              (it.modernTie ? `今用：${it.modernTie}` : ''),
          }),
          it.misuse ? h('div', { style: { ...css.muted, marginTop: 6 } }, `易误：${it.misuse}`) : null,
        )),
        data.usage ? h('div', { style: css.muted }, data.usage) : null,
      )
    }

    function hitLabel(data) {
      if (data.mode === 'term' || data.mode === 'scene') return '典故'
      if (data.mode === 'exact') return '原句命中'
      if (data.mode === 'ref') return '按出处'
      if (data.mode === 'keyword') return '最接近的几句（不是原句）'
      return '结果'
    }

    function safeParse(s) {
      try { return JSON.parse(s) } catch { return null }
    }

    // ── 注册 ──────────────────────────────────────────────────────
    return {
      inject: ['slots'],
      apply(ctx) {
        const slots = ctx.get('slots') || ctx.slots
        slots.inject('settings.section', () => slots.register({
          name: 'settings.section', id: 'zhouliti', order: 32, label: '周礼体',
        }, Panel))

        // keyed slot：key 是工具名，只接管本插件的五个工具
        for (const tool of ['zhouliti_lookup', 'zhouliti_allusion', 'zhouliti_check', 'zhouliti_compose', 'zhouliti_status']) {
          slots.inject('tool.call.toolview', () => slots.register({
            name: 'tool.call.toolview', id: `zhouliti-${tool}`, key: tool, order: 10,
          }, ToolView))
        }
      },
    }
  },
})
