/**
 * MyTabDesk 核心模块：MyTabDeskCoreConstants
 * 由 tabdesk-core.js 拆分而来，保持 Node（require）与浏览器（全局命名空间）双环境兼容。
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.MyTabDeskCoreConstants = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {

/**
 * 本地存储键名，用于在 chrome.storage.local 中保存 MyTabDesk 全量数据。
 */
const STORAGE_KEY = "my_tab_desk_data";

/**
 * 当前应用版本号，用于备份元信息和 manifest 版本保持一致。
 */
const APP_VERSION = "2.1.0";

/**
 * 加密备份文件版本号，用于后续升级备份格式。
 */
const BACKUP_VERSION = 1;

/**
 * 默认同步设置对象，用于给旧数据补齐同步基础版配置。
 */
const DEFAULT_SYNC_SETTINGS = {
  deviceId: "",
  deviceName: "本机浏览器",
  mode: "manual",
  lastBackupAt: 0,
  lastImportAt: 0,
  provider: "none",
  webdavUrl: "",
  webdavUsername: "",
  webdavPassword: "",
  webdavFilename: "",
  webdavAutoSyncEnabled: false,
  gistToken: "",
  gistId: "",
  gistFilename: "mytabdesk-sync.json",
  gistAutoSyncEnabled: false,
  syncEncryptionPassword: "",
  stateUpdatedAt: 0,
  autoSyncPendingAt: 0,
  lastAutoSyncAt: 0,
  lastAutoSyncError: "",
  lastSyncAt: 0
};

/**
 * WebDAV 默认同步文件名，用于目录地址自动补齐同步文件。
 */
const DEFAULT_WEBDAV_SYNC_FILENAME = "MyTabDesk.json";

/**
 * GitHub Gist 默认同步描述，用于自动发现 MyTabDesk 同步 Gist。
 */
const DEFAULT_GIST_SYNC_DESCRIPTION = "MyTabDesk Sync";

/**
 * 默认空间 ID，用于初始化数据和清空数据后的兜底空间。
 */
const DEFAULT_SPACE_ID = "default-space";

  return {
    STORAGE_KEY,
  APP_VERSION,
  BACKUP_VERSION,
  DEFAULT_SYNC_SETTINGS,
  DEFAULT_WEBDAV_SYNC_FILENAME,
  DEFAULT_GIST_SYNC_DESCRIPTION,
  DEFAULT_SPACE_ID
  };
});
