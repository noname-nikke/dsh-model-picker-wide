# Changelog

## 0.1.1

- 修复：面板打开后约 1 秒才变宽。`dsh-better-panel` 的面板 portal 进 `body` 时尚
  未定位，紧接着 React 会整块重写根节点属性，把 `data-mpw` 一并抹掉；原先只有
  `MutationObserver` 会在下一次无关 DOM 变动时才补打标记，期间面板仍是窄的。
  现在点开后在 0 / 50 / 120 / 260 / 520 / 900 / 1400 ms 各补扫一次，覆盖
  「挂载 → 重写属性 → 稳定」这段窗口。

## 0.1.0

- 首个版本：输入框模型胶囊上限 150px → 360px，下拉面板 272px / 420px → 480px。
- 面板右缘钉回输入框：`dsh-better-panel` 的 `left` 是按固定 `PANEL_W=272` 算出的内联
  样式，仅改宽度会把面板顶出视口右边，因此运行期重算 `right`。
- 同时覆盖 `dsh-better-panel` 的 `.cxp-*` 与官方 `ModelSelect` 两套实现。
- 超长模型名补 `title`，悬停可看全名。
- 设置页可调面板 / 胶囊宽度并即时生效，配置存 `localStorage`。
- 全部入口包在 `try/catch` 里，失败只降级为「未加宽」。
