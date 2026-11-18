/* ============================================================================
 * dsh-model-picker-wide — 离线冒烟测试
 * 不装进 DSH，按 ModuleLoader 的方式把 lib/client.js 跑起来，验证：
 *   bundle 协议 / 注册 id / inject 声明 / 配置归一化 / 样式表内容 /
 *   面板右缘钉回算法 / 设置页注册 / 真 DOM 下的打标与加宽
 * 用法：node test/smoke.mjs
 * ========================================================================== */
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BUNDLE = path.join(HERE, '..', 'lib', 'client.js')
const SOURCE = fs.readFileSync(BUNDLE, 'utf8')

let pass = 0
let fail = 0
function check(label, ok, extra) {
  if (ok) { pass++; console.log('  ok   ' + label) }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  -> ' + extra : '')) }
}
function section(name) { console.log('\n' + name) }

/* ── 极小的 DOM / 浏览器桩 ─────────────────────────────────────────────────── */

function makeElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    style: {
      props: {},
      setProperty(k, v) { this.props[k] = v },
      getPropertyValue(k) { return this.props[k] || '' },
    },
    textContent: '',
    setAttribute(k, v) { this.attributes[k] = String(v) },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null },
    appendChild(child) { this.children.push(child); child.parentNode = this; return child },
    querySelector() { return null },
    querySelectorAll() { return [] },
    addEventListener() {},
    getBoundingClientRect() { return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 } },
  }
  return el
}

function makeDocument() {
  const head = makeElement('head')
  const body = makeElement('body')
  const tags = []
  const doc = {
    head,
    body,
    createElement: (tag) => makeElement(tag),
    querySelector(sel) {
      const m = /^style\[data-mpw-style="([^"]+)"\]$/.exec(sel)
      if (!m) return null
      return tags.find((t) => t.getAttribute('data-mpw-style') === m[1]) || null
    },
    querySelectorAll() { return [] },
    addEventListener() {},
  }
  head.appendChild = (el) => { tags.push(el); return el }
  doc.__tags = tags
  return doc
}

function makeWindow(doc) {
  const listeners = {}
  const storage = new Map()
  const win = {
    innerWidth: 1400,
    document: doc,
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => { storage.set(k, String(v)) },
      removeItem: (k) => { storage.delete(k) },
    },
    addEventListener: (type, fn) => { (listeners[type] || (listeners[type] = [])).push(fn) },
    removeEventListener() {},
    requestAnimationFrame: (fn) => { fn(0); return 1 },
    __listeners: listeners,
    __storage: storage,
  }
  return win
}

const React = {
  createElement(type, props, ...children) {
    const kids = children.length === 0 ? undefined : children.length === 1 ? children[0] : children
    return { type, props: Object.assign({}, props || {}, { children: kids }) }
  },
  useState(init) {
    const value = typeof init === 'function' ? init() : init
    return [value, () => {}]
  },
  useEffect() {},
}

/* ── 装载 bundle ──────────────────────────────────────────────────────────── */

const doc = makeDocument()
const win = makeWindow(doc)
let loaded = null

const sandbox = {
  window: win,
  document: doc,
  localStorage: win.localStorage,
  MutationObserver: class { observe() {} disconnect() {} },
  setTimeout,
  clearTimeout,
  console,
  Symbol,
  Object,
  JSON,
  Math,
  Number,
  String,
  isFinite,
  Error,
}
sandbox.globalThis = sandbox
win.__ModuleLoader__ = { load: (entry) => { loaded = entry } }

vm.createContext(sandbox)
vm.runInContext(SOURCE, sandbox, { filename: 'client.js' })

section('bundle 协议')
check('调用了 __ModuleLoader__.load', loaded !== null)
check('注册 id 等于包名', loaded && loaded.id === 'dsh-model-picker-wide', loaded && loaded.id)
check('factory 是函数', loaded && typeof loaded.factory === 'function')

const moduleExports = loaded.factory((name) => {
  if (name === 'react') return React
  throw new Error('unexpected require: ' + name)
})
check('导出 apply', typeof moduleExports.apply === 'function')
check('导出 inject 数组', Array.isArray(moduleExports.inject), JSON.stringify(moduleExports.inject))
check('inject 含 slots', moduleExports.inject.includes('slots'))

const internals = moduleExports.__internals
check('暴露测试接缝', internals && typeof internals.buildCss === 'function')

section('配置归一化')
const norm = internals.normalizeConfig
check('空输入 → 默认值', norm(undefined).panelWidth === internals.DEFAULTS.panelWidth)
check('越界下夹紧', norm({ panelWidth: 1 }).panelWidth === internals.RANGE.panelWidth[0])
check('越界上夹紧', norm({ panelWidth: 99999 }).panelWidth === internals.RANGE.panelWidth[1])
check('非数字退回默认', norm({ panelWidth: 'abc' }).panelWidth === internals.DEFAULTS.panelWidth)
check('触发器不得宽于面板', norm({ panelWidth: 400, triggerWidth: 560 }).triggerWidth === 400)
check('enabled=false 保留', norm({ enabled: false }).enabled === false)
check('wrapNames 只认 true', norm({ wrapNames: 'yes' }).wrapNames === false)

section('样式表')
const css = internals.buildCss(norm({ panelWidth: 500, triggerWidth: 360 }))
check('写入面板宽度变量', css.includes('--mpw-panel-w:500px'))
check('写入胶囊宽度变量', css.includes('--mpw-trigger-w:360px'))
check('覆盖自建浮层根', css.includes('.cxp-root[data-mpw="picker"]'))
check('覆盖自建浮层胶囊', css.includes('.cxp-trigger{max-width:var(--mpw-trigger-w)!important}'))
check('覆盖官方面板', css.includes('[data-mpw="menu"]'))
check('覆盖官方胶囊', css.includes('button[data-mpw="trigger"]'))
check('默认不折行', !css.includes('white-space:normal'))
const cssWrap = internals.buildCss(norm({ wrapNames: true }))
check('开启后折行规则存在', cssWrap.includes('white-space:normal!important'))

section('面板右缘钉回算法')
const cr = internals.computeRight
check('贴着参照物右缘', cr(1400, 480, 1200) === 200, cr(1400, 480, 1200))
check('不许越出左边界', cr(1400, 480, 100) === 908, cr(1400, 480, 100))
check('量不到参照物时退回 12', cr(1400, 480, null) === 12)
check('窄视口下面板自动收窄', cr(400, 480, 380) === 12, cr(400, 480, 380))

section('插件体')
let registered = []
const ctx = {
  slots: {
    inject(name, fn) { registered.push({ name, fn }) },
    register(spec, component) { registered.push({ spec, component }); return () => {} },
  },
}
let threw = null
try { moduleExports.apply(ctx) } catch (error) { threw = error }
check('apply 不抛错', threw === null, threw && String(threw))
const styleTag = doc.__tags.find((t) => t.getAttribute('data-mpw-style') === 'dsh-model-picker-wide:runtime')
check('注入了运行期样式表', Boolean(styleTag))
check('样式表内容非空', styleTag && styleTag.textContent.includes('--mpw-panel-w'))

const sectionInject = registered.find((r) => r.name === 'settings.section')
check('等 settings.section 槽', Boolean(sectionInject))
check('等槽是幂等入口', typeof (sectionInject && sectionInject.fn) === 'function')

/* 槽被声明时应当注册一节设置页 */
let sectionSpec = null
if (sectionInject) {
  try { sectionInject.fn() } catch (error) { /* 忽略 */ }
  const reg = registered.find((r) => r.spec && r.spec.name === 'settings.section')
  sectionSpec = reg ? reg.spec : null
}
check('注册了设置页一节', sectionSpec !== null)
check('设置页 id 稳定', sectionSpec && sectionSpec.id === 'model-picker-wide', sectionSpec && sectionSpec.id)
check('设置页有中文标题', sectionSpec && sectionSpec.label === '模型选择器宽度', sectionSpec && sectionSpec.label)

section('设置页组件')
let panelTree = null
try {
  panelTree = internals.SettingsPanel()
} catch (error) {
  console.log('  (设置页渲染跳过：桩件 React 不完整)', String(error).slice(0, 80))
}
check('设置页可渲染', panelTree !== null && panelTree !== undefined)

section('真 DOM：打标与加宽')
const doc2 = makeDocument()
const win2 = makeWindow(doc2)
let loaded2 = null
win2.__ModuleLoader__ = { load: (entry) => { loaded2 = entry } }
const sandbox2 = Object.assign({}, sandbox, { window: win2, document: doc2, localStorage: win2.localStorage })
sandbox2.globalThis = sandbox2
vm.createContext(sandbox2)
vm.runInContext(SOURCE, sandbox2, { filename: 'client2.js' })
const exports2 = loaded2.factory((n) => (n === 'react' ? React : (() => { throw new Error('x') })()))

/* 造一棵仿真 DOM：输入框卡片 + 自建浮层 + 官方触发器/菜单 */
function nodeWithRect(tag, attrs, rect) {
  const el = makeElement(tag)
  Object.assign(el.attributes, attrs)
  el.getAttribute = (k) => (Object.prototype.hasOwnProperty.call(el.attributes, k) ? el.attributes[k] : null)
  el.getBoundingClientRect = () => rect
  return el
}
const triggerRect = { left: 900, right: 1180, top: 500, bottom: 528, width: 280, height: 28 }
const fakeTrigger = nodeWithRect('button', { 'data-ces-part': 'picker-trigger' }, triggerRect)
const pickerRoot = nodeWithRect('div', { class: 'cxp cxp-root' }, { left: 900, right: 1180, top: 200, bottom: 500, width: 280, height: 300 })
const pickerPanel = nodeWithRect('div', { class: 'cxp-panel' }, { left: 900, right: 1180, top: 200, bottom: 500, width: 280, height: 300 })
pickerRoot.appendChild(pickerPanel)

const nameSpan = makeElement('span')
nameSpan.textContent = 'doubao-seed-character · Volcengine Ark'
const nameWrap = makeElement('span')
nameWrap.appendChild(nameSpan)
const modelRow = nodeWithRect('button', { class: 'cxp-model', title: '3 档：low / medium / high' }, { left: 0, right: 0, top: 0, bottom: 0, width: 240, height: 34 })
modelRow.querySelector = (sel) => (sel === '.cxp-model__name>span' ? nameSpan : null)
modelRow.querySelectorAll = () => []
pickerRoot.querySelectorAll = (sel) => {
  if (sel === '.cxp-model') return [modelRow]
  return []
}

const officialMenu = makeElement('div')
officialMenu.attributes['role'] = 'group'
officialMenu.querySelector = (sel) => (sel.includes('menuitem') ? makeElement('button') : null)
const officialTrigger = nodeWithRect('button', {}, triggerRect)
officialTrigger.style = { props: { '--dsh-model-anchor': '--dsh-mpw' }, setProperty(k, v) { this.props[k] = v } }

doc2.querySelectorAll = (sel) => {
  if (sel === '.cxp-root') return [pickerRoot]
  if (sel === '[style*="--dsh-model-anchor"]') return [officialTrigger, officialMenu]
  return []
}
doc2.querySelector = (sel) => {
  if (sel === '[data-ces-part="picker-trigger"]') return fakeTrigger
  const m = /^style\[data-mpw-style="([^"]+)"\]$/.exec(sel)
  if (!m) return null
  return doc2.__tags.find((t) => t.getAttribute('data-mpw-style') === m[1]) || null
}
doc2.addEventListener = () => {}

const ctx2 = { slots: { inject() {}, register() { return () => {} } } }
exports2.apply(ctx2)

check('自建浮层被打标', pickerRoot.getAttribute('data-mpw') === 'picker')
check('写入 --mpw-right', pickerRoot.style.getPropertyValue('--mpw-right') !== '')
const expectedRight = String(internals.computeRight(win2.innerWidth, internals.DEFAULTS.panelWidth, triggerRect.right)) + 'px'
check('--mpw-right 等于算法结果', pickerRoot.style.getPropertyValue('--mpw-right') === expectedRight, pickerRoot.style.getPropertyValue('--mpw-right') + ' vs ' + expectedRight)
check('官方触发器被打标', officialTrigger.getAttribute('data-mpw') === 'trigger')
check('官方菜单被打标', officialMenu.getAttribute('data-mpw') === 'menu')
check('模型行补了完整名字', String(modelRow.getAttribute('title')).startsWith('doubao-seed-character'), modelRow.getAttribute('title'))
check('打标幂等（不重复写 title）', (() => {
  const before = modelRow.getAttribute('title')
  exports2.apply(ctx2)
  return modelRow.getAttribute('title') === before
})())

section('结果')
console.log(pass + ' 通过 / ' + fail + ' 失败')
if (fail > 0) process.exit(1)
