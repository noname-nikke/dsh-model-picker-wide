# dsh-model-picker-wide

把 DSH 输入框里的**模型选择器加宽**，让带 provider 后缀或本身很长的模型名不再被省略号截断。

DSH 的模型名普遍是 `<模型 id> · <provider>` 这种结构：

```
doubao-seed-translation · Volcengine Ark
search_agent_qwen_fast-0710 · Trae CN
deepseek-v41-flash · 百度搭子 DuMate
```

开箱的布局只放得下 150~162px，上面三条全都要被切成 `doubao-seed-transl…`。这个插件只做"加宽"这一件事，不动结构、不改模型列表、不接管插槽。

- **输入框胶囊**：150px → 360px
- **下拉面板**：272px（better-panel）/ 420px（官方）→ 480px
- 面板**右缘仍贴着输入框**，不会顶出屏幕
- 超长名字额外补 `title`，悬停可看全
- 两处宽度可在 **设置 → 模型选择器宽度** 调整，即时生效

## 安装

```bash
dsh plugin --profile web add link:<本仓库路径>
# 或从 GitHub 直接装：
dsh plugin --profile web add github:noname-nikke/dsh-model-picker-wide
```

装完重启 DSH（或刷新页面）。卸载：

```bash
dsh plugin --profile web remove dsh-model-picker-wide
```

> 注意：必须用 `dsh plugin add`，**不要**直接 `pnpm add`。后者只会写 `dependencies`，
> 不会把插件并入 `dsh.profile.bundles` 层堆栈，结果是装了但完全不生效。

## 兼容性

同一张样式表同时覆盖两套实现：

| 实现 | 选择器 |
| --- | --- |
| `dsh-better-panel` 自建浮层（默认接管输入框模型席） | `.cxp-trigger` / `.cxp-root` / `.cxp-panel` |
| 官方 `@deepseek-ai/dsh-client-ui-model-selection` | `button[data-mpw="trigger"]` / `[data-mpw="menu"]` |

两套都不存在时插件静默失效 —— 它不注册插槽、不改 DOM 结构，最坏结果是"没变宽"。

## 设置

| 项 | 默认 | 范围 | 说明 |
| --- | --- | --- | --- |
| 启用加宽 | 开 | — | 关掉立刻恢复原始宽度 |
| 下拉面板宽度 | 480 px | 340–760 | 模型列表那块浮层 |
| 输入框胶囊宽度 | 360 px | 240–560 | 永远不会超过面板宽度 |
| 超长名称换行 | 关 | — | 开：折行显示完整（行变高）；关：仍省略，但悬停可看全名 |

配置存在浏览器 `localStorage` 的 `dsh-model-picker-wide:config:v1`。

## 实现要点

1. **面板右缘钉回**：`dsh-better-panel` 用 `position:fixed` + 内联 `left`，而 `left` 是按固定 `PANEL_W=272` 在 JS 里算的。光改 CSS 会让加宽后的面板顶出视口右边。运行期读触发器（没有则读 `[data-composer-card]`）右缘，算出 `right = clamp(vw - anchorRight, 12, vw - W - 12)` 写进 `--mpw-right`，再让 CSS 用 `left:auto; right:var(--mpw-right)`。
2. **打标而不是改结构**：只给真实节点加 `data-mpw` 属性，样式全由这些属性限定作用范围，插件卸载后残留零成本。
3. **观察面最小**：`MutationObserver` 只盯 `document.body` 的直接子节点（两套面板都是 portal 到 body），不开 `subtree` —— 流式输出时的 DOM 抖动不会打进来。
4. **绝不连累输入区**：所有入口都包在 `try/catch` 里，失败只打一条 `console.warn`。

## 目录

```
.
├── package.json        # dsh.bundle.patch + dsh.client(platform: web)
├── cordis.patch.yml    # 把 Host 半边挂进配置树
├── lib/index.js        # Host 半边（空实现，只为让 Loader 有条目）
├── lib/client.js       # 全部逻辑：样式注入 + DOM 打标 + 设置页
└── test/smoke.mjs      # 离线冒烟测试（42 项）
```

## 测试

```bash
node test/smoke.mjs
```

不装进 DSH 也能跑：用 `vm` 按 `__ModuleLoader__` 协议加载 `lib/client.js`，配上最小 DOM / React 桩，验证 bundle 协议、配置归一化、样式表内容、右缘钉回算法、设置页注册，以及一次仿真 DOM 下的打标与加宽。

## License

MIT
