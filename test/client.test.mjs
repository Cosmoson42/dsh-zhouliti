/**
 * client.js 不是 ESM，是自注册脚本 —— 平时最容易「写完就没人验证」。
 * 这里给它一个假的 __ModuleLoader__ 和一个假 React，确认 factory 不崩、槽位真的注册了。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadClient() {
  const src = readFileSync(join(ROOT, 'client.js'), 'utf8')
  let factory = null
  globalThis.window = { __ModuleLoader__: { load: (spec) => { factory = spec.factory } } }
  new Function(src)()
  assert.ok(factory, 'client.js 没有调用 window.__ModuleLoader__.load')

  const h = (type, props, ...children) => ({ type, props, children })
  const React = {
    createElement: h,
    Fragment: Symbol('Fragment'),
    useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn(),
  }
  const mod = factory((name) => (name === 'react' ? React : {}))
  assert.ok(typeof mod.apply === 'function', 'factory 应该返回 { apply }')

  const regs = []
  const slots = {
    inject(_name, fn) { fn() },
    register(spec, comp) { regs.push({ spec, comp }) },
  }
  mod.apply({ get: (k) => (k === 'slots' ? slots : undefined) })
  return regs
}

test('client.js 注册设置页与五个工具卡片', () => {
  const regs = loadClient()
  const settings = regs.filter((r) => r.spec.name === 'settings.section')
  assert.equal(settings.length, 1, '应该恰好注册一个设置页')
  assert.equal(settings[0].spec.id, 'zhouliti')
  assert.equal(typeof settings[0].comp, 'function')

  const keys = regs.filter((r) => r.spec.name === 'tool.call.toolview').map((r) => r.spec.key).sort()
  assert.deepEqual(keys, [
    'zhouliti_allusion', 'zhouliti_check', 'zhouliti_compose', 'zhouliti_lookup', 'zhouliti_status',
  ], '五个工具都要有自己的卡片')
})

test('client.js 只用主题变量写样式，且不引入 iframe', () => {
  const src = readFileSync(join(ROOT, 'client.js'), 'utf8')
  assert.ok(!/<iframe/i.test(src), 'client 不该用 iframe')
  const colors = src.match(/#[0-9a-fA-F]{3,8}\b/g) || []
  assert.deepEqual(colors, [], `样式里出现了硬编码颜色：${colors.join(', ')}`)
})
