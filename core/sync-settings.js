/**
 * MyTabDesk 核心模块：MyTabDeskCoreSyncSettings
 * 由 tabdesk-core.js 拆分而来，保持 Node（require）与浏览器（全局命名空间）双环境兼容。
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./constants.js"), require("./ids.js"), require("./normalize.js"));
  } else {
    root.MyTabDeskCoreSyncSettings = factory(root.MyTabDeskCoreConstants, root.MyTabDeskCoreIds, root.MyTabDeskCoreNormalize);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (constants, ids, normalize) {
  const { DEFAULT_SYNC_SETTINGS, DEFAULT_WEBDAV_SYNC_FILENAME, DEFAULT_GIST_SYNC_DESCRIPTION } = constants;
  const { createDeviceId } = ids;
  const { normalizeData } = normalize;
/**
 * 解析 WebDAV 同步文件地址，目录地址会自动拼接 JSON 文件名。
 *
 * @param {string} webdavUrl 用户填写的 WebDAV 地址。
 * @param {string} [customFilename] 自定义文件名，为空时使用默认文件名。
 * @returns {string} 最终用于上传和下载的 WebDAV 文件地址。
 */
function resolveWebDavSyncUrl(webdavUrl, customFilename) {
  /** 去除首尾空白后的 WebDAV 地址。 */
  const normalizedUrl = webdavUrl ? webdavUrl.trim() : "";

  if (!normalizedUrl) {
    return "";
  }

  if (/\.json(?:[?#].*)?$/i.test(normalizedUrl)) {
    return normalizedUrl;
  }

  /** 使用的文件名，自定义优先，其次使用默认文件名。 */
  const filename = customFilename ? customFilename.trim() : DEFAULT_WEBDAV_SYNC_FILENAME;
  /** 移除尾部斜杠后的目录地址。 */
  const directoryUrl = normalizedUrl.replace(/\/+$/, "");
  return `${directoryUrl}/${filename}`;
}

/**
 * 解析并校验安全的 WebDAV 同步文件地址。
 *
 * @param {object} sync 同步配置。
 * @returns {string} 已解析并通过安全校验的 WebDAV 文件地址。
 * @throws {Error} 当 WebDAV 配置不完整或地址不是 HTTPS 时抛出错误。
 */
function resolveSafeWebDavFileUrl(sync) {
  if (!sync || !sync.webdavUrl || !sync.webdavUsername || !sync.webdavPassword) {
    throw new Error("请先完整填写 WebDAV URL、用户名和密码");
  }

  /** 解析后的 WebDAV 同步文件地址。 */
  const fileUrl = resolveWebDavSyncUrl(sync.webdavUrl, sync.webdavFilename);

  if (!fileUrl.startsWith("https://")) {
    throw new Error("WebDAV 地址必须使用 HTTPS 协议，以确保凭证传输安全");
  }

  return fileUrl;
}

/**
 * 创建 Basic Auth 请求头。
 *
 * @param {string} username 用户名。
 * @param {string} password 密码。
 * @returns {string} Basic Auth 请求头值。
 */
function createBasicAuthHeader(username, password) {
  /** UTF-8 编码后的凭证文本。 */
  const credentialText = `${username}:${password}`;

  if (typeof Buffer !== "undefined") {
    return `Basic ${Buffer.from(credentialText, "utf8").toString("base64")}`;
  }

  const credentialBytes = new TextEncoder().encode(credentialText);
  const binary = String.fromCharCode(...credentialBytes);
  return `Basic ${btoa(binary)}`;
}

/**
 * 判断指定同步服务是否已启用。
 *
 * @param {object} sync 同步配置。
 * @param {string} provider 同步服务商，支持 webdav 和 gist。
 * @returns {boolean} 已启用时返回 true。
 */
function isSyncProviderEnabled(sync, provider) {
  if (!sync || !provider) {
    return false;
  }

  if (provider === "webdav") {
    return sync.provider === "webdav" || sync.provider === "both";
  }

  if (provider === "gist") {
    return sync.provider === "gist" || sync.provider === "both";
  }

  return false;
}

/**
 * 获取已启用的同步服务商列表。
 *
 * @param {object} sync 同步配置。
 * @returns {string[]} 已启用的同步服务商列表。
 */
function getEnabledSyncProviders(sync) {
  /** 已启用的同步服务商列表。 */
  const providers = [];

  if (isSyncProviderEnabled(sync, "webdav")) {
    providers.push("webdav");
  }

  if (isSyncProviderEnabled(sync, "gist")) {
    providers.push("gist");
  }

  return providers;
}

/**
 * 获取实际开启自动同步的服务商列表。
 *
 * @param {object} sync 同步配置。
 * @returns {string[]} 自动同步服务商列表。
 */
function getAutoSyncProviders(sync) {
  return getEnabledSyncProviders(sync).filter((provider) => provider === "webdav"
    ? Boolean(sync.webdavAutoSyncEnabled)
    : Boolean(sync.gistAutoSyncEnabled));
}

/**
 * 判断 GitHub Gist 是否为 MyTabDesk 同步 Gist。
 *
 * @param {object} gist GitHub Gist 摘要对象。
 * @param {string} filename 同步文件名。
 * @returns {boolean} 匹配 MyTabDesk 同步 Gist 时返回 true。
 */
function isMyTabDeskGist(gist, filename) {
  /** 最终用于匹配的同步文件名。 */
  const finalFilename = filename || DEFAULT_SYNC_SETTINGS.gistFilename;
  /** Gist 描述文本。 */
  const description = gist && gist.description ? gist.description.trim() : "";
  /** Gist 文件集合。 */
  const files = gist && gist.files ? gist.files : {};

  return description === DEFAULT_GIST_SYNC_DESCRIPTION || Boolean(files[finalFilename]);
}

/**
 * 确保数据中包含完整的同步设置，缺失时用指定设备 ID 补齐。
 *
 * @param {object} data 当前全量数据。
 * @param {string} deviceId 设备 ID，为空时自动生成。
 * @returns {object} 补齐同步设置后的全量数据。
 */
function ensureSyncSettings(data, deviceId) {
  /** 标准化后的数据。 */
  const nextData = normalizeData(data);
  /** 最终使用的设备 ID。 */
  const finalDeviceId = deviceId || nextData.settings.sync.deviceId || createDeviceId();

  nextData.settings.sync = {
    deviceId: finalDeviceId,
    deviceName: nextData.settings.sync.deviceName || DEFAULT_SYNC_SETTINGS.deviceName,
    mode: nextData.settings.sync.mode || DEFAULT_SYNC_SETTINGS.mode,
    lastBackupAt: typeof nextData.settings.sync.lastBackupAt === "number" ? nextData.settings.sync.lastBackupAt : DEFAULT_SYNC_SETTINGS.lastBackupAt,
    lastImportAt: typeof nextData.settings.sync.lastImportAt === "number" ? nextData.settings.sync.lastImportAt : DEFAULT_SYNC_SETTINGS.lastImportAt,
    provider: nextData.settings.sync.provider || DEFAULT_SYNC_SETTINGS.provider,
    webdavUrl: nextData.settings.sync.webdavUrl || DEFAULT_SYNC_SETTINGS.webdavUrl,
    webdavUsername: nextData.settings.sync.webdavUsername || DEFAULT_SYNC_SETTINGS.webdavUsername,
    webdavPassword: nextData.settings.sync.webdavPassword || DEFAULT_SYNC_SETTINGS.webdavPassword,
    webdavFilename: nextData.settings.sync.webdavFilename || DEFAULT_SYNC_SETTINGS.webdavFilename,
    webdavAutoSyncEnabled: Boolean(nextData.settings.sync.webdavAutoSyncEnabled),
    gistToken: nextData.settings.sync.gistToken || DEFAULT_SYNC_SETTINGS.gistToken,
    gistId: nextData.settings.sync.gistId || DEFAULT_SYNC_SETTINGS.gistId,
    gistFilename: nextData.settings.sync.gistFilename || DEFAULT_SYNC_SETTINGS.gistFilename,
    gistAutoSyncEnabled: Boolean(nextData.settings.sync.gistAutoSyncEnabled),
    syncEncryptionPassword: nextData.settings.sync.syncEncryptionPassword || DEFAULT_SYNC_SETTINGS.syncEncryptionPassword,
    autoSyncPendingAt: typeof nextData.settings.sync.autoSyncPendingAt === "number" ? nextData.settings.sync.autoSyncPendingAt : DEFAULT_SYNC_SETTINGS.autoSyncPendingAt,
    lastAutoSyncAt: typeof nextData.settings.sync.lastAutoSyncAt === "number" ? nextData.settings.sync.lastAutoSyncAt : DEFAULT_SYNC_SETTINGS.lastAutoSyncAt,
    lastAutoSyncError: nextData.settings.sync.lastAutoSyncError || DEFAULT_SYNC_SETTINGS.lastAutoSyncError,
    lastSyncAt: typeof nextData.settings.sync.lastSyncAt === "number" ? nextData.settings.sync.lastSyncAt : DEFAULT_SYNC_SETTINGS.lastSyncAt
  };

  return nextData;
}

/**
 * 获取全量数据中最近的版本时间，包含空间、分组、链接的更新和删除时间。
 * 不使用 createdAt，避免迁移时补齐的创建时间被误判为真实业务更新。
 *
 * @param {object} data 当前全量数据。
 * @returns {number} 最近的更新时间戳，无数据时返回 0。
 */
function getDataUpdatedAt(data) {
  if (!data || !Array.isArray(data.spaces)) {
    return 0;
  }

  /** 所有业务对象的版本时间集合。 */
  const timestamps = [];

  const collectItemTimestamps = (item) => {
    if (!item) {
      return;
    }
    for (const key of ["updatedAt", "deletedAt"]) {
      if (typeof item[key] === "number") {
        timestamps.push(item[key]);
      }
    }
  };

  for (const space of data.spaces) {
    collectItemTimestamps(space);

    if (Array.isArray(space.groups)) {
      for (const group of space.groups) {
        collectItemTimestamps(group);

        if (Array.isArray(group.links)) {
          for (const link of group.links) {
            collectItemTimestamps(link);
          }
        }
      }
    }
  }

  return timestamps.length > 0 ? Math.max(...timestamps) : 0;
}

  return {
    resolveWebDavSyncUrl,
  resolveSafeWebDavFileUrl,
  createBasicAuthHeader,
  isSyncProviderEnabled,
  getEnabledSyncProviders,
  getAutoSyncProviders,
  isMyTabDeskGist,
  ensureSyncSettings,
  getDataUpdatedAt
  };
});
