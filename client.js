/**
 * dsh-update-switch —— 浏览器半侧（手写 __ModuleLoader__ bundle，无需构建工具）。
 *
 * 在设置页（slot: settings.section）注册一个「更新开关」页，提供：
 *   - 允许更新 / 禁止更新 两个模式（role=switch，aria-checked）；
 *   - 当前 feed 文件路径、是否已屏蔽、备份是否存在；
 *   - 可手填 feed 路径（自动探测失败时）；
 *   - 操作结果提示（失败原因原样显示）。
 *
 * 与宿主端只走同源 HTTP（/api/dsh-update-switch/*），不碰 RPC。
 */

window.__ModuleLoader__.load({
  id: 'dsh-update-switch',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')
    var h = React.createElement
    var Component = React.Component
    var useEffect = React.useEffect
    var useState = React.useState

    var API = '/api/dsh-update-switch'
    var NS = 'dsh-update-switch'

    function apiGet(path) {
      return fetch(API + path, { cache: 'no-store' }).then(readJson)
    }
    function apiPost(path, body) {
      return fetch(API + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      }).then(readJson)
    }
    function readJson(res) {
      return res.text().then(function (text) {
        var data = null
        try { data = text === '' ? null : JSON.parse(text) } catch (e) { data = null }
        if (!res.ok) {
          var msg = data && data.error ? data.error : ('HTTP ' + res.status)
          var err = new Error(msg)
          err.status = res.status
          throw err
        }
        return data
      })
    }

    /** 设置页错误边界：崩了显示原因，不白屏。 */
    class ErrorBoundary extends Component {
      constructor(props) { super(props); this.state = { error: null } }
      static getDerivedStateFromError(error) { return { error: error } }
      componentDidCatch(error) { try { console.error('[dsh-update-switch] 设置页渲染失败：', error) } catch (e) {} }
      render() {
        if (this.state.error !== null) {
          var msg = this.state.error && this.state.error.message ? this.state.error.message : String(this.state.error)
          return h('div', { className: 'us-error' }, '设置页渲染失败：' + msg)
        }
        return this.props.children
      }
    }

    var CSS = [
      '.us-root{--us-fg:var(--dsw-alias-label-primary,#1f1c18);--us-muted:var(--dsw-alias-label-secondary,#6f6558);--us-card:var(--dsw-alias-bg-layer-1,#fffdf8);--us-bar:var(--dsw-alias-bg-layer-2,#f4efe4);--us-field:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2,#fbf7ef));--us-line:var(--dsw-alias-border-l2,#e3daca);--us-line-soft:var(--dsw-alias-border-l1,#ece5d8);--us-brand:var(--dsw-alias-brand-primary,#2563eb);--us-ok:var(--dsw-alias-state-success-primary,#2f6b46);--us-err:var(--dsw-alias-state-error-primary,#a83a2c);color:var(--us-fg);font-size:13px;line-height:1.7;}',
      '.us-root h2{font-size:16px;margin:0 0 6px;font-weight:600;}',
      '.us-root p{margin:0 0 14px;color:var(--us-muted);}',
      '.us-card{background:var(--us-card);border:1px solid var(--us-line);border-radius:12px;padding:16px;margin-bottom:14px;}',
      '.us-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 0;border-bottom:1px solid var(--us-line-soft);}',
      '.us-row:last-child{border-bottom:0;}',
      '.us-label{font-weight:600;}',
      '.us-hint{font-size:12px;color:var(--us-muted);}',
      '.us-seg{display:inline-flex;border:1px solid var(--us-line);border-radius:9px;overflow:hidden;}',
      '.us-seg button{font:inherit;font-size:12.5px;padding:6px 16px;border:0;background:var(--us-card);color:var(--us-fg);cursor:pointer;}',
      '.us-seg button.us-on{background:var(--us-brand);color:#fff;}',
      '.us-switch{position:relative;width:46px;height:26px;border-radius:999px;border:1px solid var(--us-line);background:var(--us-bar);cursor:pointer;flex:0 0 auto;}',
      '.us-switch[aria-checked="true"]{background:var(--us-brand);border-color:var(--us-brand);}',
      '.us-knob{position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:transform .18s ease;}',
      '.us-switch[aria-checked="true"] .us-knob{transform:translateX(20px);}',
      '.us-input{width:100%;box-sizing:border-box;font:inherit;font-size:12px;padding:7px 10px;border-radius:8px;border:1px solid var(--us-line-soft);background:var(--us-field);color:var(--us-fg);font-family:var(--dsw-font-family-mono,ui-monospace,Menlo,Consolas,monospace);}',
      '.us-kv{display:flex;gap:8px;font-size:12px;color:var(--us-muted);margin-top:4px;word-break:break-all;}',
      '.us-kv b{color:var(--us-fg);font-weight:600;}',
      '.us-badge{display:inline-block;font-size:11.5px;padding:1px 9px;border-radius:999px;border:1px solid var(--us-line-soft);}',
      '.us-badge.us-blocked{color:var(--us-err);border-color:var(--us-err);}',
      '.us-badge.us-allowed{color:var(--us-ok);border-color:var(--us-ok);}',
      '.us-note{background:var(--us-bar);border:1px solid var(--us-line-soft);border-radius:10px;padding:10px 13px;font-size:12px;color:var(--us-muted);}',
      '.us-error{color:var(--us-err);border:1px solid var(--us-err);background:var(--us-card);border-radius:10px;padding:10px 13px;font-size:12.5px;}',
      '.us-toast{margin-top:12px;font-size:12.5px;padding:9px 13px;border-radius:9px;border:1px solid var(--us-line);background:var(--us-bar);}',
      '.us-toast.us-ok{border-color:var(--us-ok);color:var(--us-ok);}',
      '.us-toast.us-bad{border-color:var(--us-err);color:var(--us-err);}',
      '@supports not (color:var(--dsw-alias-label-primary)){.us-root{--us-fg:#241f18;--us-muted:#6f6558;--us-card:#fffdf8;--us-bar:#f6f2ea;--us-field:#fbf8f2;--us-line:#e0d7c8;--us-line-soft:#ece5d8;--us-brand:#2563eb;--us-ok:#2f6b46;--us-err:#a83a2c}}',
    ].join('\n')

    function Section(props) {
      var st = useState(null)
      var info = st[0]
      var setInfo = st[1]
      var b = useState(false)
      var busy = b[0]
      var setBusy = b[1]
      var m = useState('')
      var message = m[0]
      var setMessage = m[1]
      var sev = useState('ok')
      var severity = sev[0]
      var setSeverity = sev[1]
      var fp = useState('')
      var feedPathInput = fp[0]
      var setFeedPathInput = fp[1]

      function load() {
        apiGet('/state').then(function (data) {
          setInfo(data)
          setFeedPathInput(data.feedPath || '')
        }).catch(function (e) {
          setMessage(e.message || String(e)); setSeverity('bad')
        })
      }

      useEffect(function () { load() }, [])

      function choose(mode) {
        if (busy) return
        setBusy(true); setMessage('')
        apiPost('/set', { mode: mode, feedPath: feedPathInput || undefined })
          .then(function (res) {
            if (res.ok) {
              setInfo(res.status)
              setSeverity('ok')
              setMessage(mode === 'block'
                ? '已禁止更新下载：feed 已移走并备份，桌面端检查会直接跳过，立即生效。'
                : '已允许更新：原始 feed 已放回，立即生效。')
            } else {
              setSeverity('bad')
              setMessage(res.error || '操作失败')
            }
          })
          .catch(function (e) { setSeverity('bad'); setMessage(e.message || String(e)) })
          .then(function () { setBusy(false) })
      }

      var mode = info && info.mode === 'block' ? 'block' : 'allow'
      var blocked = !!(info && info.feedBlocked)

      return h('div', { className: 'us-root' },
        h('h2', null, '更新下载开关'),
        h('p', null, '允许或禁止 DSH 桌面端版本更新下载。开关可逆、立即生效、无需重启，不修改程序本体。'),

        h('div', { className: 'us-card' },
          h('div', { className: 'us-row' },
            h('div', null,
              h('div', { className: 'us-label' }, '禁止更新下载'),
              h('div', { className: 'us-hint' }, '打开后，更新 feed 文件被移走，桌面端每次检查直接跳过，无法下载新版本。')),
            h('button', {
              type: 'button', className: 'us-switch', role: 'switch',
              'aria-checked': mode === 'block' ? 'true' : 'false',
              'aria-label': '禁止更新下载',
              disabled: busy,
              onClick: function () { choose(mode === 'block' ? 'allow' : 'block') },
            }, h('span', { className: 'us-knob' }))),
          h('div', { className: 'us-row' },
            h('div', null,
              h('div', { className: 'us-label' }, '模式'),
              h('div', { className: 'us-hint' }, '与上方开关等价，二选一。')),
            h('div', { className: 'us-seg' },
              h('button', { type: 'button', className: mode === 'allow' ? 'us-on' : '', disabled: busy, onClick: function () { choose('allow') } }, '允许更新'),
              h('button', { type: 'button', className: mode === 'block' ? 'us-on' : '', disabled: busy, onClick: function () { choose('block') } }, '禁止更新')))),

        h('div', { className: 'us-card' },
          h('div', { className: 'us-label' }, '更新 feed 文件'),
          h('div', { className: 'us-hint', style: { marginBottom: '8px' } }, '自动探测失败时可手动填写 app-update.yml 的完整路径。'),
          h('input', {
            className: 'us-input', value: feedPathInput, placeholder: 'C:\\...\\resources\\app-update.yml',
            onChange: function (e) { setFeedPathInput(e.target.value) },
          }),
          h('div', { className: 'us-kv' },
            h('span', null, '当前状态：'),
            h('span', { className: 'us-badge ' + (blocked ? 'us-blocked' : 'us-allowed') }, blocked ? '已屏蔽' : '未屏蔽'),
            h('span', null, '· 文件存在：' + (info && info.feedExists ? '是' : '否')),
            h('span', null, '· 备份存在：' + (info && info.backupExists ? '是' : '否')))),

        h('div', { className: 'us-note' },
          '原理：桌面端每次检查更新前都会确认 resources/app-update.yml 存在，不存在就直接跳过、连网络都不访问。禁止时把该文件原子移走（同目录隐藏）并把原始内容备份到 ' + (info ? info.dshHome : '<DSH_HOME>') + ' 下；允许时原样放回，立即生效、无需重启。强制更新策略弹窗不受此影响，但也拿不到安装包。已下载的更新包不会被删除，本开关只阻止后续检查/下载。'),

        message !== '' ? h('div', { className: 'us-toast ' + (severity === 'ok' ? 'us-ok' : 'us-bad') }, message) : null,

        info === null ? h('div', { className: 'us-hint' }, '正在读取状态…') : null
      )
    }

    function apply(ctx) {
      ctx.effect(function () {
        var id = 'dsh-update-switch-styles'
        if (document.getElementById(id) === null) {
          var style = document.createElement('style')
          style.id = id
          style.textContent = CSS
          document.head.appendChild(style)
        }
        return function () {
          var el = document.getElementById(id)
          if (el !== null && el.parentNode !== null) el.parentNode.removeChild(el)
        }
      }, 'dsh-update-switch: styles')

      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register({
          name: 'settings.section',
          id: 'update-switch',
          order: 47,
          locale: NS,
          label: function () { return '更新开关' },
        }, function (props) {
          var p = props !== null && props !== undefined ? props : {}
          return h(ErrorBoundary, null, h(Section, p))
        })
      })
    }

    module.exports = {
      name: 'update-switch',
      inject: ['slots'],
      apply: apply,
    }
    return module.exports
  },
})
