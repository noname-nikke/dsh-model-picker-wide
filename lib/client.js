/**
 * dsh-model-picker-wide — 浏览器半边
 * ----------------------------------------------------------------------------
 * 解决的问题：DSH 输入框里那颗「模型」胶囊与它的下拉面板都只有固定窄宽
 * （官方面板 max-width 420px、better-panel 自建面板 272px），名字带 provider
 * 后缀（"xxx · Volcengine Ark"）或名字本身很长时会被 ellipsis 截断，看不全。
 *
 * 做法（全部是"只加宽、不改结构"的加法）：
 *   1) 注入一张样式表，用 --mpw-panel-w / --mpw-trigger-w 两个变量同时覆盖
 *      两套实现：官方 dsh-client-ui-model-selection 的菜单与触发器，
 *      以及 dsh-better-panel 自建浮层（.cxp-*）。
 *   2) 自建浮层的水平位置是 JS 用固定 PANEL_W=272 算出来写进内联样式的，
 *      光改 CSS 会把它顶出屏幕右边，所以运行期把面板钉回"与输入框右缘对齐"：
 *      读触发器（或输入框卡片）右缘，算出 right 偏移写进 --mpw-right。
 *   3) 官方菜单是 position:fixed + anchor(right)，天然向左长，改 max-width 即可。
 *   4) 自建浮层的模型行 title 原本只有"N 档：..."，这里把完整模型名补进去，
 *      极端长的名字仍可悬停看全；行被复用换模型时 title 跟着更新。
 *   5) 全部运行期资源（观察器 / 定时器 / 监听器 / 样式表 / 打标属性）都在
 *      apply 里用 ctx.effect 登记了拆卸函数，插件停用或 HMR 重载后不留痕迹。
 *
 * 一切都在 try/catch 里：这个插件坏了最多是"没变宽"，绝不能连累输入区。
 * 设置页文案按浏览器语言在中文 / 英文之间切换。
 */
window.__ModuleLoader__.load({
  id: 'dsh-model-picker-wide',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var react = require('react')
    var h = react.createElement

    var PACKAGE_ID = 'dsh-model-picker-wide'
    var STYLE_ID = PACKAGE_ID + ':runtime'
    var SETTINGS_STYLE_ID = PACKAGE_ID + ':settings'
    var STORAGE_KEY = PACKAGE_ID + ':config:v1'
    var SETTINGS_SECTION_ID = 'model-picker-wide'

    /* ── 配置 ─────────────────────────────────────────────────────────────── */

    var DEFAULTS = {
      enabled: true,
      panelWidth: 480,   /* 下拉面板宽度（px） */
      triggerWidth: 360, /* 输入框里那颗胶囊的最大宽度（px） */
      wrapNames: false,  /* 名字还是放不下时换行，而不是省略号 */
    }

    var RANGE = {
      panelWidth: [340, 760],
      triggerWidth: [240, 560],
    }

    /** 把任意值夹进 [lo, hi] 的整数；不可解析时退回 fallback。 */
    function clampNumber(value, lo, hi, fallback) {
      var n = typeof value === 'number' ? value : Number(value)
      if (!isFinite(n)) return fallback
      n = Math.round(n)
      if (n < lo) return lo
      if (n > hi) return hi
      return n
    }

    /** 归一化一份配置：坏字段各自退回默认值，绝不抛错。 */
    function normalizeConfig(raw) {
      var input = raw && typeof raw === 'object' ? raw : {}
      var next = {
        enabled: input.enabled === undefined ? DEFAULTS.enabled : input.enabled === true,
        panelWidth: clampNumber(input.panelWidth, RANGE.panelWidth[0], RANGE.panelWidth[1], DEFAULTS.panelWidth),
        triggerWidth: clampNumber(input.triggerWidth, RANGE.triggerWidth[0], RANGE.triggerWidth[1], DEFAULTS.triggerWidth),
        wrapNames: input.wrapNames === true,
      }
      /* 触发器不能比面板还宽（那样面板看起来反而更窄）。 */
      if (next.triggerWidth > next.panelWidth) next.triggerWidth = next.panelWidth
      return next
    }

    function readStored() {
      try {
        var raw = window.localStorage.getItem(STORAGE_KEY)
        if (!raw) return normalizeConfig(DEFAULTS)
        return normalizeConfig(JSON.parse(raw))
      } catch (error) {
        return normalizeConfig(DEFAULTS)
      }
    }

    function writeStored(value) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
      } catch (error) {
        /* 无痕模式 / 配额满：配置只在本次会话有效，不影响功能 */
      }
    }

    var config = readStored()
    var listeners = []

    function subscribe(fn) {
      listeners.push(fn)
      return function unsubscribe() {
        var at = listeners.indexOf(fn)
        if (at >= 0) listeners.splice(at, 1)
      }
    }

    function emit() {
      var snapshot = listeners.slice()
      for (var i = 0; i < snapshot.length; i++) {
        try { snapshot[i](config) } catch (error) { /* 一个订阅者坏了不影响其它 */ }
      }
    }

    /** 合并补丁 → 归一化 → 落盘 → 重刷样式 → 通知订阅者。 */
    function saveConfig(patch) {
      var merged = {}
      var key
      for (key in config) { if (Object.prototype.hasOwnProperty.call(config, key)) merged[key] = config[key] }
      if (patch && typeof patch === 'object') {
        for (key in patch) { if (Object.prototype.hasOwnProperty.call(patch, key)) merged[key] = patch[key] }
      }
      config = normalizeConfig(merged)
      writeStored(config)
      renderStyles()
      scheduleSync()
      emit()
      return config
    }

    /* ── 样式 ─────────────────────────────────────────────────────────────── */

    var PANEL_WIDTH_EXPR = 'min(var(--mpw-panel-w), calc(100vw - 24px))'

    /** 按当前配置拼出整张样式表（纯函数，便于离线断言）。 */
    function buildCss(cfg) {
      var panel = cfg.panelWidth
      var trigger = cfg.triggerWidth
      /* 胶囊里除了名字还有图标、推理档位、箭头，留 78px 给它们。 */
      var nameWidth = Math.max(80, trigger - 78)
      var rules = [
        ':root{--mpw-panel-w:' + panel + 'px;--mpw-trigger-w:' + trigger + 'px;--mpw-trigger-name-w:' + nameWidth + 'px}',

        /* ── dsh-better-panel 自建浮层（.cxp-*）── */
        '.cxp-trigger{max-width:var(--mpw-trigger-w)!important}',
        '.cxp-trigger__name{max-width:var(--mpw-trigger-name-w)!important}',
        '.cxp-root[data-mpw="picker"]{left:auto!important;right:var(--mpw-right,12px)!important;width:' + PANEL_WIDTH_EXPR + '!important}',
        '.cxp-root[data-mpw="picker"]>.cxp-panel{width:' + PANEL_WIDTH_EXPR + '!important;max-width:none!important}',
        '.cxp-root[data-mpw="picker"] .cxp-model__name{flex:1 1 auto;min-width:0}',
        '.cxp-root[data-mpw="picker"] .cxp-row__cur{max-width:none!important}',

        /* ── 官方 dsh-client-ui-model-selection ── */
        'button[data-mpw="trigger"]{max-width:var(--mpw-trigger-w)!important}',
        '[data-mpw="menu"]{max-width:' + PANEL_WIDTH_EXPR + '!important}',
      ]
      if (cfg.wrapNames) {
        rules.push(
          '.cxp-root[data-mpw="picker"] .cxp-model{align-items:flex-start}',
          '.cxp-root[data-mpw="picker"] .cxp-model__name>span:first-child{white-space:normal!important;overflow:visible!important;text-overflow:clip!important;word-break:break-word}',
          '[data-mpw="menu"] [role="menuitemradio"] span,[data-mpw="menu"] [role="menuitem"] span{white-space:normal!important;overflow:visible!important;text-overflow:clip!important;line-height:1.45}',
        )
      }
      return rules.join('\n')
    }

    function installStyle(id, css) {
      if (typeof document === 'undefined' || !document.head) return
      var tag = document.querySelector('style[data-mpw-style="' + id + '"]')
      if (tag === null) {
        tag = document.createElement('style')
        tag.setAttribute('data-mpw-style', id)
        document.head.appendChild(tag)
      }
      if (tag.textContent !== css) tag.textContent = css
    }

    function removeStyle(id) {
      if (typeof document === 'undefined' || !document.querySelector) return
      var tag = document.querySelector('style[data-mpw-style="' + id + '"]')
      if (tag === null) return
      if (typeof tag.remove === 'function') tag.remove()
      else if (tag.parentNode && typeof tag.parentNode.removeChild === 'function') tag.parentNode.removeChild(tag)
    }

    function renderStyles() {
      try {
        if (!config.enabled) {
          installStyle(STYLE_ID, '/* dsh-model-picker-wide: disabled */')
          return
        }
        installStyle(STYLE_ID, buildCss(config))
      } catch (error) {
        /* 样式装不上就什么都不做 */
      }
    }

    /* ── 运行期：给真实节点打标 + 把自建浮层钉回右缘 ──────────────────────── */

    /**
     * 自建浮层用 position:fixed + 内联 left，左缘是 JS 按固定 272px 算的。
     * 面板变宽后必须把右缘钉住，否则会顶出视口右边。
     *
     * @param viewportWidth 视口宽
     * @param panelWidth 想要的面板宽
     * @param anchorRight 参照物（触发器或输入框卡片）的右缘 x；null 表示量不到
     * @returns 距视口右边的像素数
     */
    function computeRight(viewportWidth, panelWidth, anchorRight) {
      var vw = typeof viewportWidth === 'number' && isFinite(viewportWidth) ? viewportWidth : 1280
      var width = Math.min(panelWidth, Math.max(240, vw - 24))
      var right = 12
      if (typeof anchorRight === 'number' && isFinite(anchorRight) && anchorRight > 0) right = vw - anchorRight
      var maxRight = vw - width - 12
      if (maxRight < 12) maxRight = 12
      if (right < 12) right = 12
      if (right > maxRight) right = maxRight
      return Math.round(right)
    }

    /** 视口宽度：优先用不含滚动条的 clientWidth，否则 right 会偏出一个滚动条。 */
    function viewportWidth() {
      try {
        if (document.documentElement && document.documentElement.clientWidth) return document.documentElement.clientWidth
      } catch (error) { /* 忽略 */ }
      return window.innerWidth
    }

    function rectRightOf(node) {
      if (!node || typeof node.getBoundingClientRect !== 'function') return null
      var rect = node.getBoundingClientRect()
      if (!rect || !isFinite(rect.right) || rect.width <= 0) return null
      return rect.right
    }

    /**
     * 给自建浮层的模型行补上完整模型名（原本 title 只有档位信息）。
     * 原始 title 存在 data-mpw-base 里，名字变了就重新拼一次 —— 面板行是复用的，
     * 换成另一个模型后 title 必须跟着变，否则悬停看到的是旧名字。
     */
    function decorateTitles(root) {
      var rows = root.querySelectorAll('.cxp-model')
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i]
        var nameEl = row.querySelector('.cxp-model__name>span')
        if (!nameEl) continue
        var name = String(nameEl.textContent || '').trim()
        if (name === '') continue
        if (row.getAttribute('data-mpw-title') === name) continue
        var base = row.getAttribute('data-mpw-base')
        if (base === null) {
          var original = row.getAttribute('title') || ''
          /* 第一次打标时如果 title 已经以模型名开头，说明是我们上次写的，基座留空。 */
          base = original.indexOf(name) === 0 ? '' : original
          row.setAttribute('data-mpw-base', base)
        }
        row.setAttribute('title', base === '' ? name : name + ' · ' + base)
        row.setAttribute('data-mpw-title', name)
      }
    }

    function tagPickerRoot(root) {
      if (!root || !root.style || !root.setAttribute) return
      var anchorRight = rectRightOf(document.querySelector('[data-ces-part="picker-trigger"]'))
      if (anchorRight === null) anchorRight = rectRightOf(document.querySelector('[data-composer-card]'))
      var right = computeRight(viewportWidth(), config.panelWidth, anchorRight)
      root.style.setProperty('--mpw-right', right + 'px')
      if (root.getAttribute('data-mpw') !== 'picker') root.setAttribute('data-mpw', 'picker')
      decorateTitles(root)
    }

    /**
     * 官方菜单打标。同时顺着 aria-controls 反向找到控制它的那颗触发器 ——
     * 这比猜 aria-label 精确得多（label 是本地化的，换个语言就认不出来了）。
     */
    function tagMenu(menu) {
      if (!menu || !menu.setAttribute) return
      if (menu.getAttribute('data-mpw') !== 'menu') menu.setAttribute('data-mpw', 'menu')
      var id = menu.getAttribute('id')
      if (id === null || id === '') return
      var escaped = (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function')
        ? CSS.escape(id)
        : String(id).replace(/["\\]/g, '\\$&')
      var owner = document.querySelector('button[aria-controls="' + escaped + '"]')
      if (owner !== null) tagTrigger(owner)
    }

    function tagTrigger(trigger) {
      if (!trigger || !trigger.setAttribute) return
      if (trigger.getAttribute('data-mpw') !== 'trigger') trigger.setAttribute('data-mpw', 'trigger')
    }

    /** 一次扫描：自建浮层、官方触发器、官方菜单（只认带 menuitem* 的那种）。 */
    function sync() {
      if (!config.enabled) return
      if (typeof document === 'undefined' || !document.querySelectorAll) return
      try {
        var roots = document.querySelectorAll('.cxp-root')
        for (var i = 0; i < roots.length; i++) tagPickerRoot(roots[i])

        /*
         * 官方模型席与它的菜单共用一份内联样式（`--dsh-model-anchor` 是它们
         * 唯一共享的定位锚点），拿这个当指纹比认 role 精确得多 —— 页面上别的
         * 下拉菜单（权限预设、命令面板）不会被误伤。
         *
         * 第二条路是兜底：万一哪天 MenuSurface 不再转发 style，官方菜单仍然
         * 靠"id 以 -menu 结尾 + 里面是 menuitemradio"这个形状被认出来。
         */
        var anchored = document.querySelectorAll('[style*="--dsh-model-anchor"]')
        for (var a = 0; a < anchored.length; a++) {
          var node = anchored[a]
          if (node.tagName === 'BUTTON') { tagTrigger(node); continue }
          if (!node.querySelector) continue
          if (!node.querySelector('[role="menuitemradio"],[role="menuitem"]')) continue
          tagMenu(node)
        }

        var idMenus = document.querySelectorAll('[id$="-menu"]')
        for (var k = 0; k < idMenus.length; k++) {
          var candidate = idMenus[k]
          if (!candidate.querySelector) continue
          if (!candidate.querySelector('[role="menuitemradio"],[role="menuitem"]')) continue
          tagMenu(candidate)
        }
      } catch (error) {
        /* 一次扫描失败不影响下一次 */
      }
    }

    var syncQueued = false
    var pendingFrame = null

    function scheduleSync() {
      if (syncQueued) return
      syncQueued = true
      var raf = (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function')
        ? window.requestAnimationFrame
        : function (fn) { return setTimeout(fn, 16) }
      try {
        pendingFrame = raf(function () { syncQueued = false; pendingFrame = null; sync() })
      } catch (error) {
        syncQueued = false
        pendingFrame = null
      }
    }

    function cancelSync() {
      if (pendingFrame === null) return
      try {
        if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
          window.cancelAnimationFrame(pendingFrame)
        } else {
          clearTimeout(pendingFrame)
        }
      } catch (error) { /* 忽略 */ }
      pendingFrame = null
      syncQueued = false
    }

    /*
     * better-panel 的面板是"先挂载、后定位"的：portal 进 body 时还没算好位置，
     * 紧接着 React 会整块重写根节点的属性 —— `data-mpw` 会被一起抹掉。
     *
     * 那是一次**属性变更**，不是 childList，所以只盯 body 的旧做法要等下一次
     * 无关变动才补标（实测滞后约 1 秒）。现在另挂一个 `attributeFilter: ['data-mpw']`
     * 的子树属性观察器：标记被抹掉的瞬间就能补回来，比按时间点反复全文档重扫
     * 更快也更省。[0, 120, 600, 1400] 四次兜底负责"挂载 → 重写 → 布局稳定"这段窗口。
     */
    var RETRY_DELAYS = [0, 120, 600, 1400]

    var rootObserver = null
    var retryTimers = []

    function cancelRetries() {
      for (var i = 0; i < retryTimers.length; i++) {
        try { clearTimeout(retryTimers[i]) } catch (error) { /* 忽略 */ }
      }
      retryTimers = []
    }

    function scheduleRetries() {
      cancelRetries()
      for (var i = 0; i < RETRY_DELAYS.length; i++) {
        try { retryTimers.push(setTimeout(sync, RETRY_DELAYS[i])) } catch (error) { /* 忽略 */ }
      }
    }

    /*
     * 点击只在这些区域里才值得重扫：输入框卡片、已经打标的胶囊/面板、自建浮层。
     * 页面别处（设置页、侧栏、消息流）点一下就去扫三遍全文档，纯属浪费。
     */
    var CLICK_SCOPE = '[data-composer-card],[data-mpw],.cxp-root,.cxp-trigger'

    var started = false
    var runtimeDisposers = null

    function startRuntime() {
      if (started) return
      started = true

      var disposers = []
      runtimeDisposers = disposers

      try {
        /*
         * 主观察面仍然只有 body 的直接子节点：两套实现的面板都是 portal 到 body 的，
         * 不开 subtree，流式输出时的 DOM 抖动不会打进来；被 React 抹掉的属性交给
         * 下面那个只过滤 data-mpw 的属性观察器。
         */
        if (typeof MutationObserver === 'function' && document.body) {
          var observer = new MutationObserver(function () { scheduleSync() })
          observer.observe(document.body, { childList: true })
          disposers.push(function () { observer.disconnect() })

          /*
           * 第二个观察器只认 data-mpw 这一种属性、且挂子树：React 抹掉标记时立刻回调。
           * 用子树而不是逐节点 observe，是因为逐节点会强引用已经卸载的面板节点，
           * 面板开合若干次就把旧节点攒住了。
           */
          if (rootObserver === null) {
            rootObserver = new MutationObserver(function () { scheduleSync() })
            rootObserver.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['data-mpw'] })
          }
          var attrs = rootObserver
          disposers.push(function () {
            attrs.disconnect()
            if (rootObserver === attrs) rootObserver = null
          })
        }
      } catch (error) { /* 没有 MutationObserver 就只靠同步扫描 */ }

      try {
        window.addEventListener('resize', scheduleSync, { passive: true })
        disposers.push(function () { window.removeEventListener('resize', scheduleSync) })
      } catch (error) { /* 忽略 */ }

      function onClick(event) {
        try {
          var target = event && event.target
          if (target && typeof target.closest === 'function' && target.closest(CLICK_SCOPE) === null) return
        } catch (error) { /* 判断不了就不拦，退化为旧行为 */ }
        scheduleSync()
        scheduleRetries()
      }

      try {
        document.addEventListener('click', onClick, true)
        disposers.push(function () { document.removeEventListener('click', onClick, true) })
      } catch (error) { /* 忽略 */ }

      scheduleSync()
    }

    /**
     * 拆卸运行期：定时器、观察器、监听器、样式表、打标属性一次清干净。
     * 插件停用 / HMR 重载时就靠它，否则窗口上会留一个永远在扫 DOM 的监听器。
     */
    function teardownRuntime() {
      cancelRetries()
      cancelSync()

      var disposers = runtimeDisposers
      runtimeDisposers = null
      if (disposers !== null) {
        for (var i = 0; i < disposers.length; i++) {
          try { disposers[i]() } catch (error) { /* 单个拆卸失败不影响其它 */ }
        }
      }

      try { removeStyle(STYLE_ID); removeStyle(SETTINGS_STYLE_ID) } catch (error) { /* 忽略 */ }

      try {
        var roots = document.querySelectorAll('.cxp-root')
        for (var r = 0; r < roots.length; r++) {
          if (roots[r].style && typeof roots[r].style.removeProperty === 'function') {
            roots[r].style.removeProperty('--mpw-right')
          }
        }
      } catch (error) { /* 忽略 */ }

      /* 把被我们改过的 title 还原成基座值，不留痕。 */
      try {
        var decorated = document.querySelectorAll('[data-mpw-title]')
        for (var d = 0; d < decorated.length; d++) {
          var row = decorated[d]
          var base = row.getAttribute('data-mpw-base')
          if (base === null || base === '') row.removeAttribute('title')
          else row.setAttribute('title', base)
          row.removeAttribute('data-mpw-title')
          row.removeAttribute('data-mpw-base')
        }
      } catch (error) { /* 忽略 */ }

      try {
        var tagged = document.querySelectorAll('[data-mpw]')
        for (var g = 0; g < tagged.length; g++) tagged[g].removeAttribute('data-mpw')
      } catch (error) { /* 忽略 */ }

      started = false
    }

    /* ── 设置页 ───────────────────────────────────────────────────────────── */

    /*
     * 设置页文案：这个插件不把 locale 服务变成硬依赖（那会让 inject 列表变化，
     * 缺少该服务时整插件不加载），所以只按浏览器语言提供 zh / en 两套。
     */
    var STRINGS = {
      zh: {
        section: '模型选择器宽度',
        enable: '启用加宽',
        enableHint: ' 关掉后立刻恢复 DSH 的原始宽度。',
        saved: '改动即时生效并保存在本机浏览器里；下次打开页面自动套用。',
        panel: '下拉面板宽度',
        panelHint: '模型列表所在的那块浮层的宽度。名字带 provider 后缀（“xxx · Volcengine Ark”）时最容易看出差别。',
        trigger: '输入框胶囊宽度',
        triggerHint: '输入框底部那颗“当前模型”胶囊的最大宽度。窗口太窄时 DSH 本来就会把它收成图标，加宽不会改变这个行为。',
        wrap: '超长名称换行',
        wrapHint: ' 开：名字再长也折行显示完整（行会变高）。关：仍然用省略号，但悬停可看全名。',
        reset: '恢复默认',
      },
      en: {
        section: 'Model picker width',
        enable: 'Enable widening',
        enableHint: ' Turn off to restore the original DSH widths immediately.',
        saved: 'Changes apply instantly and are stored in this browser; they load automatically next time.',
        panel: 'Dropdown panel width',
        panelHint: 'Width of the floating list that holds the models. Most visible with provider suffixes such as “xxx · Volcengine Ark”.',
        trigger: 'Composer pill width',
        triggerHint: 'Maximum width of the current-model pill at the bottom of the composer. DSH collapses it to an icon on narrow windows; widening does not change that.',
        wrap: 'Wrap very long names',
        wrapHint: ' On: names wrap and show in full (rows get taller). Off: they stay ellipsized, but hovering shows the full name.',
        reset: 'Reset to defaults',
      },
    }

    /** 按浏览器语言选文案：以 en 开头用英文，其余回落到中文。 */
    function pickStrings() {
      var language = ''
      try {
        language = String((typeof navigator !== 'undefined' && navigator.language) || '')
      } catch (error) { /* 没有 navigator 就用中文 */ }
      return language.slice(0, 2).toLowerCase() === 'en' ? STRINGS.en : STRINGS.zh
    }

    var SETTINGS_CSS = [
      '.mpw-panel{max-width:620px;display:flex;flex-direction:column;gap:14px;font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.mpw-group{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:12px}',
      '.mpw-field{display:flex;flex-direction:column;gap:6px}',
      '.mpw-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}',
      '.mpw-label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.mpw-value{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.mpw-hint{font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}',
      '.mpw-range{width:100%;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}',
      '.mpw-check{display:flex;align-items:flex-start;gap:8px;cursor:pointer}',
      '.mpw-check input{margin-top:2px;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}',
      '.mpw-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 12px;font:inherit;font-size:12px;cursor:pointer;align-self:flex-start}',
      '.mpw-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
    ].join('\n')

    function installSettingsCss() {
      try { installStyle(SETTINGS_STYLE_ID, SETTINGS_CSS) } catch (error) { /* 忽略 */ }
    }

    function widthField(label, key, min, max, step, hint) {
      var value = config[key]
      return h('div', { className: 'mpw-field', key: key },
        h('div', { className: 'mpw-head' },
          h('span', { className: 'mpw-label' }, label),
          h('span', { className: 'mpw-value' }, value + ' px'),
        ),
        h('input', {
          className: 'mpw-range',
          type: 'range',
          min: min,
          max: max,
          step: step,
          value: value,
          onChange: function (event) {
            var next = {}
            next[key] = Number(event.target.value)
            saveConfig(next)
          },
        }),
        h('span', { className: 'mpw-hint' }, hint),
      )
    }

    function SettingsPanel() {
      var t = pickStrings()
      var state = react.useState(config)
      var cfg = state[0]
      var setCfg = state[1]
      react.useEffect(function () {
        var off = subscribe(function (next) { setCfg(next) })
        return function () { off() }
      }, [])

      return h('div', { className: 'mpw-panel' },
        h('div', { className: 'mpw-group' },
          h('label', { className: 'mpw-check' },
            h('input', {
              type: 'checkbox',
              checked: cfg.enabled,
              onChange: function (event) { saveConfig({ enabled: event.target.checked }) },
            }),
            h('span', null,
              h('span', { className: 'mpw-label' }, t.enable),
              h('span', { className: 'mpw-hint' }, t.enableHint),
            ),
          ),
          h('span', { className: 'mpw-hint' }, t.saved),
        ),
        h('div', { className: 'mpw-group' },
          widthField(t.panel, 'panelWidth', RANGE.panelWidth[0], RANGE.panelWidth[1], 20, t.panelHint),
          widthField(t.trigger, 'triggerWidth', RANGE.triggerWidth[0], RANGE.triggerWidth[1], 10, t.triggerHint),
        ),
        h('div', { className: 'mpw-group' },
          h('label', { className: 'mpw-check' },
            h('input', {
              type: 'checkbox',
              checked: cfg.wrapNames,
              onChange: function (event) { saveConfig({ wrapNames: event.target.checked }) },
            }),
            h('span', null,
              h('span', { className: 'mpw-label' }, t.wrap),
              h('span', { className: 'mpw-hint' }, t.wrapHint),
            ),
          ),
          h('button', {
            type: 'button',
            className: 'mpw-btn',
            onClick: function () { saveConfig(DEFAULTS) },
          }, t.reset),
        ),
      )
    }

    /* ── 插件体 ───────────────────────────────────────────────────────────── */

    var inject = ['slots']

    function apply(ctx) {
      try {
        installSettingsCss()
        renderStyles()
        startRuntime()
      } catch (error) {
        try { console.warn('[' + PACKAGE_ID + '] 样式/运行期初始化失败，界面宽度不会改变：', error) } catch (e) { /* 忽略 */ }
      }

      /*
       * 生命周期：插件停用 / HMR 重载时把监听器、观察器、样式表和打标属性全部收走。
       * 没有这一句，窗口上会留一个永远在扫 DOM 的 click 监听器（旧版本就是这样）。
       */
      try {
        if (ctx && typeof ctx.effect === 'function') {
          ctx.effect(function () { return teardownRuntime }, PACKAGE_ID + ': runtime')
        }
      } catch (error) { /* 没有 effect 能力就保持旧行为，不影响加宽 */ }

      try {
        ctx.slots.inject('settings.section', function () {
          return ctx.slots.register(
            {
              name: 'settings.section',
              id: SETTINGS_SECTION_ID,
              order: 34,
              label: pickStrings().section,
            },
            SettingsPanel,
          )
        })
      } catch (error) {
        try { console.warn('[' + PACKAGE_ID + '] 设置页注册失败（加宽仍然生效）：', error) } catch (e) { /* 忽略 */ }
      }
    }

    exports.apply = apply
    exports.inject = inject
    /* 离线测试接缝：纯函数，运行时无副作用。 */
    exports.__internals = {
      DEFAULTS: DEFAULTS,
      RANGE: RANGE,
      STORAGE_KEY: STORAGE_KEY,
      clampNumber: clampNumber,
      normalizeConfig: normalizeConfig,
      buildCss: buildCss,
      computeRight: computeRight,
      SettingsPanel: SettingsPanel,
      STRINGS: STRINGS,
      pickStrings: pickStrings,
      decorateTitles: decorateTitles,
      RETRY_DELAYS: RETRY_DELAYS,
    }
    return module.exports
  },
})
