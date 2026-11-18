/**
 * dsh-model-picker-wide — 宿主半边（空逻辑）
 * ----------------------------------------------------------------------------
 * 这个插件的全部功能都在浏览器半边（lib/client.js）。
 * 宿主半边存在的唯一理由：让本包成为 cordis Loader 树上的一行 ——
 * dsh-client-modules 只扫描「已启用的 Loader 条目」，据此把 package.json 里
 * dsh.client 声明的 lib/client.js 编进 window.__DSH_BOOT__ 发给浏览器。
 *
 * 纪律：
 *   1. apply() 绝不抛错（同步抛错会让该条目的 fiber 失败，启动审计报红）。
 *   2. 不声明任何服务（声明一个没人 provide 的服务会让 fiber 停在 PENDING）。
 *   3. 不打日志噪音。
 */

/** Host plugin body — 本插件没有任何宿主侧行为。 */
export function apply() {}
