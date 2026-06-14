/**
 * MyTabDesk 核心模块：MyTabDeskCoreNormalize
 * 由 tabdesk-core.js 拆分而来，保持 Node（require）与浏览器（全局命名空间）双环境兼容。
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./constants.js"), require("./ids.js"));
  } else {
    root.MyTabDeskCoreNormalize = factory(root.MyTabDeskCoreConstants, root.MyTabDeskCoreIds);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (constants, ids) {
  const { DEFAULT_SYNC_SETTINGS, DEFAULT_SPACE_ID } = constants;
  const { getDefaultSpaceIcon, getCurrentTime, getPathValue, createId, createDeviceId } = ids;
/**
 * 创建默认数据结构。
 *
 * @returns {object} 包含默认空间和默认设置的数据对象。
 */
function createDefaultData() {
  /** 当前时间戳，用于初始化创建时间和更新时间。 */
  const now = getCurrentTime();

  return {
    version: 1,
    activeSpaceId: DEFAULT_SPACE_ID,
    spaces: [
      {
        id: DEFAULT_SPACE_ID,
        name: "默认空间",
        icon: getDefaultSpaceIcon(),
        groups: [],
        createdAt: now,
        updatedAt: now
      }
    ],
    settings: {
      theme: "light",
      rightPanelCollapsed: false,
      sidebarCollapsed: false,
      sync: {
        ...DEFAULT_SYNC_SETTINGS,
        deviceId: createDeviceId()
      }
    }
  };
}

/**
 * 标准化单个链接数据。
 *
 * @param {object} link 原始链接数据。
 * @returns {object} 标准化后的链接数据。
 */
function normalizeLink(link) {
  /** 当前时间戳，用于补齐缺失的创建时间。 */
  const now = getCurrentTime();

  return {
    id: link && link.id ? link.id : createId("link"),
    title: link && link.title ? link.title : link && link.url ? link.url : "未命名链接",
    url: link && link.url ? link.url : "",
    favIconUrl: link && link.favIconUrl ? link.favIconUrl : "",
    createdAt: link && link.createdAt ? link.createdAt : now,
    updatedAt: link && link.updatedAt ? link.updatedAt : link && link.createdAt ? link.createdAt : now,
    // order 缺失时回落到 createdAt，保证旧数据合并排序行为与历史完全一致
    order: link && typeof link.order === "number" ? link.order : link && link.createdAt ? link.createdAt : now
  };
}

/**
 * 标准化单个分组数据。
 *
 * @param {object} group 原始分组数据。
 * @returns {object} 标准化后的分组数据。
 */
function normalizeGroup(group) {
  /** 当前时间戳，用于补齐缺失的创建时间和更新时间。 */
  const now = getCurrentTime();
  /** 原始链接数组，非数组时兜底为空数组。 */
  const rawLinks = group && Array.isArray(group.links) ? group.links : [];

  return {
    id: group && group.id ? group.id : createId("group"),
    name: group && group.name ? group.name : "未命名分组",
    collapsed: Boolean(group && group.collapsed),
    pinned: Boolean(group && group.pinned),
    links: rawLinks.map(normalizeLink).filter((link) => Boolean(link.url)),
    createdAt: group && group.createdAt ? group.createdAt : now,
    updatedAt: group && group.updatedAt ? group.updatedAt : now
  };
}

/**
 * 标准化单个空间数据。
 *
 * @param {object} space 原始空间数据。
 * @returns {object} 标准化后的空间数据。
 */
function normalizeSpace(space) {
  /** 当前时间戳，用于补齐缺失的创建时间和更新时间。 */
  const now = getCurrentTime();
  /** 原始分组数组，非数组时兜底为空数组。 */
  const rawGroups = space && Array.isArray(space.groups) ? space.groups : [];

  return {
    id: space && space.id ? space.id : createId("space"),
    name: space && space.name ? space.name : "未命名空间",
    icon: space && space.icon && space.icon !== "folder" ? space.icon : getDefaultSpaceIcon(),
    groups: rawGroups.map(normalizeGroup),
    createdAt: space && space.createdAt ? space.createdAt : now,
    updatedAt: space && space.updatedAt ? space.updatedAt : now
  };
}

/**
 * 标准化全量数据，保证页面使用的数据结构稳定。
 *
 * @param {object} rawData 原始全量数据。
 * @returns {object} 标准化后的全量数据。
 */
function normalizeData(rawData) {
  if (!rawData || typeof rawData !== "object") {
    return createDefaultData();
  }

  if (!Array.isArray(rawData.spaces) || rawData.spaces.length === 0) {
    return createDefaultData();
  }

  /** 标准化后的空间数组。 */
  const spaces = rawData.spaces.map(normalizeSpace);
  /** 当前激活空间是否仍然存在。 */
  const activeSpaceExists = spaces.some((space) => space.id === rawData.activeSpaceId);

  return {
    version: 1,
    activeSpaceId: activeSpaceExists ? rawData.activeSpaceId : spaces[0].id,
    spaces,
    settings: {
      theme: getPathValue(rawData, "settings.theme", "light"),
      rightPanelCollapsed: getPathValue(rawData, "settings.rightPanelCollapsed", false),
      sidebarCollapsed: getPathValue(rawData, "settings.sidebarCollapsed", false),
      sync: {
        deviceId: getPathValue(rawData, "settings.sync.deviceId", ""),
        deviceName: getPathValue(rawData, "settings.sync.deviceName", DEFAULT_SYNC_SETTINGS.deviceName),
        mode: getPathValue(rawData, "settings.sync.mode", DEFAULT_SYNC_SETTINGS.mode),
        lastBackupAt: getPathValue(rawData, "settings.sync.lastBackupAt", DEFAULT_SYNC_SETTINGS.lastBackupAt),
        lastImportAt: getPathValue(rawData, "settings.sync.lastImportAt", DEFAULT_SYNC_SETTINGS.lastImportAt),
        provider: getPathValue(rawData, "settings.sync.provider", DEFAULT_SYNC_SETTINGS.provider),
        webdavUrl: getPathValue(rawData, "settings.sync.webdavUrl", DEFAULT_SYNC_SETTINGS.webdavUrl),
        webdavUsername: getPathValue(rawData, "settings.sync.webdavUsername", DEFAULT_SYNC_SETTINGS.webdavUsername),
        webdavPassword: getPathValue(rawData, "settings.sync.webdavPassword", DEFAULT_SYNC_SETTINGS.webdavPassword),
        webdavFilename: getPathValue(rawData, "settings.sync.webdavFilename", DEFAULT_SYNC_SETTINGS.webdavFilename),
        webdavAutoSyncEnabled: Boolean(getPathValue(rawData, "settings.sync.webdavAutoSyncEnabled", false)),
        gistToken: getPathValue(rawData, "settings.sync.gistToken", DEFAULT_SYNC_SETTINGS.gistToken),
        gistId: getPathValue(rawData, "settings.sync.gistId", DEFAULT_SYNC_SETTINGS.gistId),
        gistFilename: getPathValue(rawData, "settings.sync.gistFilename", DEFAULT_SYNC_SETTINGS.gistFilename),
        gistAutoSyncEnabled: Boolean(getPathValue(rawData, "settings.sync.gistAutoSyncEnabled", false)),
        autoSyncPendingAt: getPathValue(rawData, "settings.sync.autoSyncPendingAt", DEFAULT_SYNC_SETTINGS.autoSyncPendingAt),
        lastAutoSyncAt: getPathValue(rawData, "settings.sync.lastAutoSyncAt", DEFAULT_SYNC_SETTINGS.lastAutoSyncAt),
        lastAutoSyncError: getPathValue(rawData, "settings.sync.lastAutoSyncError", DEFAULT_SYNC_SETTINGS.lastAutoSyncError),
        lastSyncAt: getPathValue(rawData, "settings.sync.lastSyncAt", DEFAULT_SYNC_SETTINGS.lastSyncAt)
      }
    }
  };
}

/**
 * 迁移旧版本数据到当前版本。
 *
 * @param {object} data 待迁移的数据。
 * @returns {object} 当前版本的标准化数据。
 */
function migrateData(data) {
  if (!data || typeof data !== "object") {
    return createDefaultData();
  }

  if (!data.version) {
    return normalizeData({
      ...data,
      version: 1
    });
  }

  return normalizeData(data);
}

  return {
    createDefaultData,
  normalizeLink,
  normalizeGroup,
  normalizeSpace,
  normalizeData,
  migrateData
  };
});
