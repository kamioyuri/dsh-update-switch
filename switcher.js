/**
 * dsh-update-switch —— 更新下载开关的核心（纯 node: 内置模块，无第三方依赖）。
 *
 * 拦截原理（可逆、不动 asar、不动网络栈、立即生效、无需重启）：
 *   DSH 桌面端主进程 main.js:15360 的默认 enabled() 是
 *     () => app.isPackaged && existsSync(join(process.resourcesPath, "app-update.yml"))
 *   main.js:15506-15523 的 doCheck() 每次检查前都调用 enabled()，一旦为 false 就抛
 *   "no packaged update source"，直接短路，连 electron-updater 的 checkForUpdates()
 *   都不会调用（因此也不会弹错误框，用户无感）。
 *
 *   「禁止更新」把 resources/app-update.yml 原子「移走」到同目录的隐藏文件
 *   app-update.yml.dsh-update-switch-off，并把原始内容另备份到 <DSH_HOME> 下；
 *   「允许更新」再原样移回。相比「改写文件内容」，移走文件不会被
 *   electron-updater 内部缓存的 provider/clientPromise 绕过，是最可靠的拦截点。
 *
 * 默认状态 allow（不改动用户系统），只有用户主动点「禁止更新」才会动文件。
 */

import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** 同目录「移走」后的文件名后缀（仍在 resources 下，但 electron-updater 不会读它）。 */
const DISABLED_SUFFIX = '.dsh-update-switch-off'

/** 旧版/外部写入的无效 feed 标记，仅用于识别兼容，不再写入。 */
const BLOCK_MARKER = '# blocked by dsh-update-switch'

/** DSH 家目录：状态与备份都放这里。 */
export function dshHome() {
  const fromEnv = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  return fromEnv !== '' ? fromEnv : join(homedir(), '.dsh')
}

/** 开关状态文件。 */
export function statePath() {
  return join(dshHome(), 'dsh-update-switch.json')
}

/** app-update.yml 原始内容的内容备份（跨目录双保险）。 */
export function backupPath() {
  return join(dshHome(), 'dsh-update-switch.app-update.yml.bak')
}

/** 同目录「移走」目标路径。 */
function disabledPath(feedPath) {
  return `${feedPath}${DISABLED_SUFFIX}`
}

/**
 * 探测 app-update.yml 的真实路径。
 * 优先级：process.resourcesPath → execPath 同目录 resources → LOCALAPPDATA 默认安装位置。
 */
export function defaultFeedPath() {
  const candidates = []
  const rp = process.resourcesPath
  if (typeof rp === 'string' && rp !== '') candidates.push(join(rp, 'app-update.yml'))

  const exe = typeof process.execPath === 'string' ? process.execPath : ''
  if (exe !== '') candidates.push(join(dirname(exe), 'resources', 'app-update.yml'))

  const local = typeof process.env.LOCALAPPDATA === 'string' ? process.env.LOCALAPPDATA : ''
  if (local !== '') {
    candidates.push(join(local, 'Programs', 'DeepSeek Harness', 'resources', 'app-update.yml'))
  }

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      // 忽略单个候选的探测失败
    }
  }
  return candidates.length > 0 ? candidates[0] : ''
}

/** 原子写：先写同目录临时文件再 rename，避免半截文件。 */
function atomicWrite(file, content) {
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, file)
}

/** 读开关状态（坏文件回退到默认 allow，不让插件整个失效）。 */
export function readState() {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), 'utf8'))
    if (parsed !== null && typeof parsed === 'object') {
      return {
        mode: parsed.mode === 'block' ? 'block' : 'allow',
        feedPath: typeof parsed.feedPath === 'string' ? parsed.feedPath : '',
      }
    }
  } catch {
    // 不存在或坏掉 → 默认值
  }
  return { mode: 'allow', feedPath: '' }
}

/** 写开关状态。 */
export function writeState(state) {
  atomicWrite(statePath(), `${JSON.stringify({
    mode: state.mode === 'block' ? 'block' : 'allow',
    feedPath: typeof state.feedPath === 'string' ? state.feedPath : '',
  }, null, 2)}\n`)
}

/** 内容是否为本插件（旧版）写入的无效 feed。 */
function isBlockFeed(text) {
  return typeof text === 'string' && text.includes(BLOCK_MARKER)
}

/**
 * 把磁盘状态同步到目标模式。幂等：重复调用同一模式不会重复备份/移文件。
 * 返回结构化结果，失败带 error，绝不抛到插件外层把整行打成失败态。
 */
export function applyMode(mode, feedPathOverride) {
  const fp = (typeof feedPathOverride === 'string' && feedPathOverride.trim() !== '')
    ? feedPathOverride.trim()
    : defaultFeedPath()

  if (fp === '') {
    return { ok: false, error: '未找到 app-update.yml，请在设置页手动填写路径' }
  }

  const backup = backupPath()
  const off = disabledPath(fp)

  if (mode === 'block') {
    try {
      if (existsSync(fp)) {
        let current
        try {
          current = readFileSync(fp, 'utf8')
        } catch (error) {
          return { ok: false, error: `读取 feed 失败：${String((error && error.message) || error)}` }
        }
        // 只备份「有效原始内容」：旧版无效 feed 不进备份（备份里应始终是原始 feed）。
        if (!isBlockFeed(current) && !existsSync(backup)) {
          atomicWrite(backup, current)
        }
        // 同目录移走（原子、同卷），让 enabled() 恒为 false。
        if (existsSync(off)) {
          try { unlinkSync(off) } catch { /* 清掉陈旧 off，以当前 fp 内容为准 */ }
        }
        renameSync(fp, off)
      } else if (!existsSync(off)) {
        // fp 与 off 都不在：若备份存在，说明此前已由本插件移走，视为已屏蔽（幂等）。
        if (!existsSync(backup)) {
          return { ok: false, error: `feed 文件不存在：${fp}` }
        }
      }
    } catch (error) {
      return { ok: false, error: `移走 feed 失败：${String((error && error.message) || error)}` }
    }
    return { ok: true, mode: 'block', feedPath: fp, changed: true }
  }

  // allow：把原始 feed 放回原位。
  try {
    if (existsSync(off)) {
      if (existsSync(fp)) {
        // fp 又出现（外部重装/旧版占位）：若是无效 feed 则用备份覆盖；否则保持现状。
        const raw = readFileSync(fp, 'utf8')
        if (isBlockFeed(raw) && existsSync(backup)) {
          atomicWrite(fp, readFileSync(backup, 'utf8'))
        }
        try { unlinkSync(off) } catch { /* 清理残留 off */ }
      } else {
        renameSync(off, fp)
      }
    } else if (existsSync(fp)) {
      // fp 在原位但可能是旧版写入的无效 feed → 用原始备份恢复。
      const raw = readFileSync(fp, 'utf8')
      if (isBlockFeed(raw) && existsSync(backup)) {
        atomicWrite(fp, readFileSync(backup, 'utf8'))
      }
    } else if (existsSync(backup)) {
      // fp 与 off 都不在、但有备份 → 从内容备份写回。
      atomicWrite(fp, readFileSync(backup, 'utf8'))
    }
    // 三者都无 → 从未屏蔽过，不动用户文件。
  } catch (error) {
    return { ok: false, error: `恢复 feed 失败：${String((error && error.message) || error)}` }
  }
  return { ok: true, mode: 'allow', feedPath: fp, changed: true }
}

/** 供设置页展示的完整状态。 */
export function status() {
  const state = readState()
  const fp = state.feedPath || defaultFeedPath()
  const off = fp !== '' ? disabledPath(fp) : ''
  let exists = false
  let blocked = false
  let preview = ''
  try {
    exists = fp !== '' && existsSync(fp)
    if (exists) {
      const raw = readFileSync(fp, 'utf8')
      blocked = isBlockFeed(raw)
      preview = raw.slice(0, 600)
    } else {
      // 文件被移走 = 我们的屏蔽态（off 文件或内容备份任一存在即算）。
      blocked = (off !== '' && existsSync(off)) || existsSync(backupPath())
      if (off !== '' && existsSync(off)) preview = readFileSync(off, 'utf8').slice(0, 600)
    }
  } catch {
    // 探测失败按「不存在」处理
  }
  return {
    mode: state.mode,
    feedPath: fp,
    feedExists: exists,
    feedBlocked: blocked,
    effective: blocked,
    backupExists: existsSync(backupPath()),
    offPath: off,
    offExists: off !== '' && existsSync(off),
    resourcesPath: typeof process.resourcesPath === 'string' ? process.resourcesPath : '',
    execPath: typeof process.execPath === 'string' ? process.execPath : '',
    dshHome: dshHome(),
    feedPreview: preview,
  }
}
