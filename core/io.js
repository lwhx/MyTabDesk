/**
 * MyTabDesk 核心模块：MyTabDeskCoreIo
 * 由 tabdesk-core.js 拆分而来，保持 Node（require）与浏览器（全局命名空间）双环境兼容。
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./normalize.js"), require("./tabtab.js"), require("./sync-settings.js"));
  } else {
    root.MyTabDeskCoreIo = factory(root.MyTabDeskCoreNormalize, root.MyTabDeskCoreTabtab, root.MyTabDeskCoreSyncSettings);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (normalize, tabtab, syncSettings) {
  const { normalizeData, migrateData } = normalize;
  const { isTabTabBackupData, convertTabTabBackupToWorkspaceData, convertWorkspaceDataToTabTabBackup } = tabtab;
  const { ensureSyncSettings } = syncSettings;
/**
 * 生成可备份的数据副本，并移除不应导出的敏感同步凭据。
 *
 * @param {object} data 当前全量数据。
 * @returns {object} 去除敏感信息后的可备份数据。
 */
function createBackupSafeData(data) {
  /** 标准化后的数据副本。 */
  const backupData = ensureSyncSettings(normalizeData(data));

  backupData.settings.sync.webdavPassword = "";
  backupData.settings.sync.gistToken = "";
  backupData.settings.sync.syncEncryptionPassword = "";
  return backupData;
}

/**
 * 标准化普通备份数据包，兼容旧版直接导出的数据结构。
 *
 * @param {object} parsedData 解析后的备份或全量数据对象。
 * @returns {object} 待迁移的全量数据对象。
 */
function extractBackupData(parsedData) {
  if (!parsedData || typeof parsedData !== "object") {
    return parsedData;
  }

  if (isTabTabBackupData(parsedData)) {
    return convertTabTabBackupToWorkspaceData(parsedData);
  }

  if (parsedData.data && typeof parsedData.data === "object") {
    return parsedData.data;
  }

  return parsedData;
}

/**
 * 导出当前数据为格式化 JSON 文本。
 *
 * @param {object} data 当前全量数据。
 * @returns {string} 可下载备份的 JSON 字符串。
 */
function exportData(data) {
  /** tabtab 兼容备份结构。 */
  const tabtabBackup = convertWorkspaceDataToTabTabBackup(data);

  return JSON.stringify(tabtabBackup, null, 2);
}

/**
 * 导出用于设备同步的完整内部数据，同时移除本地敏感凭据。
 * 与面向用户的 TabTab 兼容导出不同，本格式保留 updatedAt/deletedAt 等同步元数据。
 *
 * @param {object} data 当前全量数据。
 * @returns {string} 同步 JSON 文本。
 */
function exportSyncData(data) {
  return JSON.stringify({
    format: "mytabdesk-sync",
    version: 1,
    data: createBackupSafeData(data)
  });
}

/**
 * 导入完整同步数据。
 *
 * @param {string} text 同步 JSON 文本。
 * @returns {object} 标准化后的全量数据。
 */
function importSyncData(text) {
  let parsedData;
  try {
    parsedData = JSON.parse(text);
  } catch (error) {
    throw new Error("同步数据不是有效的 JSON", { cause: error });
  }

  return migrateData(extractBackupData(parsedData));
}

/**
 * 从 JSON 文本导入数据。
 *
 * @param {string} text JSON 文本。
 * @returns {object} 迁移并标准化后的全量数据。
 * @throws {Error} 当导入文本不是合法 JSON 时抛出错误。
 */
function importData(text) {
  /** 解析后的原始数据对象。 */
  let parsedData;

  try {
    parsedData = JSON.parse(text);
  } catch (error) {
    throw new Error("导入文件不是有效的 JSON", { cause: error });
  }

  return migrateData(extractBackupData(parsedData));
}

  return {
    createBackupSafeData,
  extractBackupData,
  exportData,
  exportSyncData,
  importSyncData,
  importData
  };
});
