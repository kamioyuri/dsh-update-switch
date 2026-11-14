/**
 * 独立自测：用临时目录模拟 allow→block→allow 全流程，绝不碰真实 app-update.yml。
 * 运行：node selftest.mjs
 */
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { applyMode, status, readState, writeState, backupPath } from './switcher.js'

const root = mkdtempSync(join(tmpdir(), 'dsh-update-switch-test-'))
const home = join(root, 'home')
mkdirSync(home, { recursive: true })
process.env.DSH_HOME = home

const feed = join(root, 'resources', 'app-update.yml')
mkdirSync(join(root, 'resources'), { recursive: true })
const ORIGINAL = [
  'provider: generic',
  'url: https://download.deepseek.com/dsh-desk/feeds/win-x64/',
  'channel: nightly',
  "updaterCacheDirName: '@deepseek-aidsh-desktop-updater'",
  'publisherName: [CN=Hangzhou DeepSeek]',
  '',
].join('\n')
writeFileSync(feed, ORIGINAL, 'utf8')

function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; throw new Error(msg) }
  console.log('PASS: ' + msg)
}

// 初始
assert(existsSync(feed), '初始 feed 存在')
let st = status()
assert(st.feedExists === true && st.effective === false, '初始状态：feed 存在、未屏蔽')

// block
let r = applyMode('block', feed)
assert(r.ok === true, 'block 返回 ok')
assert(existsSync(feed) === false, 'block 后 feed 被移走')
assert(existsSync(feed + '.dsh-update-switch-off') === true, 'block 后同目录 off 文件存在')
assert(existsSync(backupPath()) === true, 'block 后内容备份存在')
assert(readFileSync(backupPath(), 'utf8') === ORIGINAL, '备份内容 === 原始内容')

// block 幂等
r = applyMode('block', feed)
assert(r.ok === true, 'block 二次调用仍 ok（幂等）')
assert(readFileSync(backupPath(), 'utf8') === ORIGINAL, '幂等后备份仍是原始内容')

// 落盘状态 + status()
writeState({ mode: 'block', feedPath: feed })
assert(readState().mode === 'block', '状态持久化 mode=block')
st = status()
assert(st.effective === true && st.mode === 'block', 'status() 报告已屏蔽')

// allow
r = applyMode('allow', feed)
assert(r.ok === true, 'allow 返回 ok')
assert(existsSync(feed) === true, 'allow 后 feed 回到原位')
assert(readFileSync(feed, 'utf8') === ORIGINAL, 'allow 后 feed 内容 === 原始内容')
assert(existsSync(feed + '.dsh-update-switch-off') === false, 'allow 后 off 文件已清理')

writeState({ mode: 'allow', feedPath: feed })
st = status()
assert(st.effective === false && st.mode === 'allow', 'status() 报告已允许')

// 旧版无效 feed 兼容：fp 在原位但是无效内容 → allow 用备份恢复
const BLOCK_FEED = '# blocked by dsh-update-switch\nprovider: generic\nurl: http://127.0.0.1:9/x/\n'
writeFileSync(feed, BLOCK_FEED, 'utf8')
r = applyMode('allow', feed)
assert(r.ok === true, '旧版无效 feed 场景 allow ok')
assert(readFileSync(feed, 'utf8') === ORIGINAL, '旧版无效 feed 被备份恢复为原始内容')

// 清理
rmSync(root, { recursive: true, force: true })
console.log('SELFTEST_DONE')
