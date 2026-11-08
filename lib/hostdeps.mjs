/**
 * hostdeps.mjs —— 从宿主那棵树里取 `@deepseek-ai/*`，拿不到就用本包的等价实现
 * ============================================================================
 * 🔴 为什么不能裸 import（2026-10-16 一个用户递来的完整报告，本机也复现过）：
 *   桌面版 profile（`pnpm-workspace.yaml` 里 `autoInstallPeers: false`）**永远不装 peer**，
 *   而 `@deepseek-ai/dsh-tools` / `@deepseek-ai/schemastery` 在插件里只能是 optional peer
 *   ⇒ 裸 import 的结果是**整条插件不激活**，DSH 只留一句
 *   `warning: 1 entry did not activate … failed to import`。
 *   （web profile 上偶尔没事，是因为 profile 树里恰好有别的插件把它们 hoist 上来了 —— 那是运气 ✗）
 *
 * ⭐ 策略（三条一起走，任何一条失败都不让插件挂掉）：
 *   ① 优先从宿主那棵树里解析（跟宿主用同一份，工具参数校验行为最一致）；
 *   ② 解析不到 ⇒ 用本包内置的等价实现（下面是本地版 `defineTool`）；
 *   ③ `schemastery` 彻底拿不到 ⇒ 返回 null，插件照常加载，只是没有 Config、设置页降级。
 *
 * 环境变量：`DSH_HOST_MODULES` 可以指定一个额外的宿主 node_modules 根目录（排查用）。
 * ============================================================================
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 插件自己那棵树（本包 dependencies 装出来的那份）—— 用模块位置算，别依赖 cwd */
const SELF_MODULES = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '@deepseek-ai')

/** 可能藏着宿主 `@deepseek-ai` 包的地方，按可能性排序 */
export function candidateRoots() {
  const out = []
  const push = (p) => { if (p && !out.includes(p)) out.push(p) }
  push(process.env.DSH_HOST_MODULES)

  const appdata = process.env.APPDATA
  if (appdata) {
    const npm = join(appdata, 'npm', 'node_modules')
    push(join(npm, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'))
    push(join(npm, '@deepseek-ai'))
    try {
      for (const n of readdirSync(join(npm, '@deepseek-ai'))) {
        push(join(npm, '@deepseek-ai', n, 'node_modules', '@deepseek-ai'))
      }
    } catch { /* 没有就算了 */ }
  }

  push('/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai')
  push('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai')
  push('/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai')
  push('/opt/homebrew/lib/node_modules/@deepseek-ai')
  push('/usr/local/lib/node_modules/@deepseek-ai')
  push('/usr/lib/node_modules/@deepseek-ai')

  // profile 树：有些机器上这些包是被别的插件 hoist 到 profile 根上的
  try {
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
    for (const p of readdirSync(join(dshHome, 'profiles'))) {
      push(join(dshHome, 'profiles', p, 'node_modules', '@deepseek-ai'))
    }
  } catch { /* 没有就算了 */ }

  push(SELF_MODULES)
  return out
}

/** 按包的 exports['.'] 找入口文件，返回 file:// URL */
function entryUrlFor(root, name) {
  try {
    const dir = join(root, name)
    const pkgFile = join(dir, 'package.json')
    if (!existsSync(pkgFile)) return null
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
    const dot = pkg.exports?.['.']
    const rel = typeof dot === 'string'
      ? dot
      : (dot?.import || dot?.default || pkg.module || pkg.main)
    if (!rel) return null
    const file = join(dir, String(rel).replace(/^\.\//, ''))
    return existsSync(file) ? pathToFileURL(file).href : null
  } catch { return null }
}

/** 从宿主树里 import 一个包；拿不到返回 null，绝不抛 */
export async function importHostPackage(name) {
  for (const root of candidateRoots()) {
    const url = entryUrlFor(root, name)
    if (!url) continue
    try { return await import(url) } catch { /* 这一棵不行，试下一棵 */ }
  }
  return null
}

/**
 * defineTool：宿主版的优先，拿不到就用下面这个等价实现。
 * 本地版只做宿主版也在做的事：把返回值转成 JSON 无损值，其余原样返回。
 */
export async function loadDefineTool() {
  const mod = await importHostPackage('dsh-tools')
  if (mod?.defineTool) return mod.defineTool
  return (options) => {
    const userExecute = options.execute
    return {
      ...options,
      async execute(args, exec) {
        const out = await userExecute(args, exec)
        try { return JSON.parse(JSON.stringify(out)) } catch { return String(out) }
      },
    }
  }
}

/** schemastery；拿不到返回 null（调用方据此跳过 Config） */
export async function loadSchemastery() {
  const mod = await importHostPackage('schemastery')
  return mod?.default ?? mod ?? null
}
