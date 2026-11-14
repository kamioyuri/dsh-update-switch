/**
 * dsh-update-switch —— 宿主半：更新 feed 开关 + 同源 HTTP API + agent tool。
 *
 * 只 import node: 内置模块与同目录 ./switcher.js（本地 link: 安装时 Node 以真实
 * 路径解析本插件，裸包名解析不到 profile 的 node_modules）。
 *
 * 拦截点（可逆、不进 asar、不改网络栈）：resources/app-update.yml。
 * 详见 ./switcher.js 顶部说明。
 */

import { applyMode, readState, status, writeState } from './switcher.js'

export const name = 'update-switch'

/** 声明式依赖：同源 API（设置页 fetch 它）。 */
export const inject = ['webServer']

/** 同源 API 前缀（浏览器半侧 fetch 它）。 */
const API_PREFIX = '/api/dsh-update-switch'

/** 幂等注册：DSH loader 可能在无 scope 标签的 ctx 上把本插件装配两次。 */
const registeredServers = new WeakSet()

function registerApi(ctx, route) {
  if (registeredServers.has(ctx.webServer)) return
  try {
    ctx.webServer.register(route)
    registeredServers.add(ctx.webServer)
  } catch (error) {
    if (error instanceof Error && /duplicate (prefix|exact) route/.test(error.message)) {
      registeredServers.add(ctx.webServer)
      return
    }
    throw error
  }
}

/** JSON 响应。 */
function sendJson(res, code, body) {
  const bytes = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(bytes.length),
    'cache-control': 'no-store',
  })
  res.end(bytes)
}

/** 读 JSON 请求体（限制 64 KiB，本插件请求体极小）。 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 64 * 1024) {
        req.destroy()
        reject(new Error('请求体过大'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text.trim() === '' ? {} : JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

/**
 * 唯一的操作实现：设置模式并把磁盘同步到位。
 * UI action 与 agent tool 都调它，逻辑不重复。
 */
function setMode(mode, feedPath) {
  if (mode !== 'allow' && mode !== 'block') {
    return { ok: false, error: `未知模式：${String(mode)}` }
  }
  const result = applyMode(mode, feedPath)
  if (result.ok) {
    writeState({ mode, feedPath: result.feedPath })
  }
  return { ...result, status: status() }
}

export function apply(ctx) {
  // 启动时把磁盘同步到上次保存的模式（可逆、幂等）。
  const initial = readState()
  if (initial.mode === 'block') applyMode('block', initial.feedPath || undefined)

  registerApi(ctx, {
    kind: 'prefix',
    path: API_PREFIX,
    handler: async (req, res) => {
      const route = (req.url ?? '').split('?')[0].slice(API_PREFIX.length) || '/'
      try {
        if (route === '/state' && req.method === 'GET') {
          return sendJson(res, 200, status())
        }
        if (route === '/set' && req.method === 'POST') {
          const body = await readBody(req)
          return sendJson(res, 200, setMode(String(body.mode ?? ''), body.feedPath))
        }
        return sendJson(res, 404, { error: `未知接口：${route}` })
      } catch (error) {
        return sendJson(res, 500, { error: String((error && error.message) || error) })
      }
    },
  })

  // agent tool：让「允许/禁止更新」也能由对话直接驱动，走同一个 setMode。
  ctx.effect(() => {
    const tools = ctx.get('tools')
    if (tools === undefined || tools === null || typeof tools.register !== 'function') return undefined
    let removed = false
    try {
      const dispose = tools.register({
        name: 'dsh_update_switch',
        description: '允许或禁止 DSH 桌面端版本更新下载。mode=block 禁止下载，mode=allow 恢复；可逆，不改程序本体。',
        parameters: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['allow', 'block'], description: 'allow=允许更新，block=禁止更新下载' },
          },
          required: ['mode'],
          additionalProperties: false,
        },
        execute: async (args) => setMode(String(args?.mode ?? ''), undefined),
      })
      return () => {
        if (removed) return
        removed = true
        if (typeof dispose === 'function') dispose()
      }
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-update-switch] agent tool 注册失败：${String((error && error.message) || error)}`)
      return undefined
    }
  }, 'dsh-update-switch: agent tool')

  ctx.logger?.info?.('[dsh-update-switch] 更新下载开关已加载')
}
