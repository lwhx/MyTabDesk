/**
 * MyTabDesk 核心逻辑聚合入口。
 *
 * 本文件不再包含具体实现，而是按职责拆分到 core/*.js 子模块：
 *   constants / ids / normalize / tabs / sync-settings / tabtab / io / reorder / merge / crypto
 *
 * 聚合入口负责：
 *   - 在 Node 环境下通过 require 加载各子模块；
 *   - 在浏览器环境下合并各子模块已挂载到 root.MyTabDeskCore* 的命名空间；
 *   - 对外暴露与拆分前完全一致的 tabdeskCoreApi（保持 newtab-app.js 与测试零改动）。
 */
(function (root) {
  /** @type {Object<string, object>} 拆分后的各子模块导出（Node 环境用 require 加载）。 */
  let modules;

  if (typeof require === "function") {
    // Node 测试环境：直接 require 子模块
    modules = {
      constants: require("./core/constants.js"),
      ids: require("./core/ids.js"),
      normalize: require("./core/normalize.js"),
      tabs: require("./core/tabs.js"),
      syncSettings: require("./core/sync-settings.js"),
      tabtab: require("./core/tabtab.js"),
      io: require("./core/io.js"),
      reorder: require("./core/reorder.js"),
      trash: require("./core/trash.js"),
      health: require("./core/health.js"),
      aiGrouping: require("./core/ai-grouping.js"),
      merge: require("./core/merge.js"),
      crypto: require("./core/crypto.js")
    };
  } else {
    // 浏览器环境：子模块已通过 <script> 标签挂载到 root.MyTabDeskCore*
    modules = {
      constants: root.MyTabDeskCoreConstants,
      ids: root.MyTabDeskCoreIds,
      normalize: root.MyTabDeskCoreNormalize,
      tabs: root.MyTabDeskCoreTabs,
      syncSettings: root.MyTabDeskCoreSyncSettings,
      tabtab: root.MyTabDeskCoreTabtab,
      io: root.MyTabDeskCoreIo,
      reorder: root.MyTabDeskCoreReorder,
      trash: root.MyTabDeskCoreTrash,
      health: root.MyTabDeskCoreHealth,
      aiGrouping: root.MyTabDeskCoreAiGrouping,
      merge: root.MyTabDeskCoreMerge,
      crypto: root.MyTabDeskCoreCrypto
    };
  }

  /** 合并所有子模块导出为单一对象，保持与拆分前完全一致的对外 API。 */
  const tabdeskCoreApi = Object.assign(
    {},
    modules.constants,
    modules.ids,
    modules.normalize,
    modules.tabs,
    modules.syncSettings,
    modules.tabtab,
    modules.io,
    modules.reorder,
    modules.trash,
    modules.health,
    modules.aiGrouping,
    modules.merge,
    modules.crypto
  );

  if (typeof module !== "undefined") {
    module.exports = tabdeskCoreApi;
  } else {
    root.MyTabDeskCore = tabdeskCoreApi;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
