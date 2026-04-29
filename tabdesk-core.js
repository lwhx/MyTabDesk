(function (root) {
/**
 * 本地存储键名，用于在 chrome.storage.local 中保存 MyTabDesk 全量数据。
 */
const STORAGE_KEY = "my_tab_desk_data";

/**
 * 当前应用版本号，用于备份元信息和 manifest 版本保持一致。
 */
const APP_VERSION = "2.0.0";

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
  webdavAutoSyncEnabled: false,
  gistToken: "",
  gistId: "",
  gistFilename: "mytabdesk-sync.json",
  gistAutoSyncEnabled: false,
  autoSyncPendingAt: 0,
  lastAutoSyncAt: 0,
  lastAutoSyncError: "",
  lastSyncAt: 0
};

/**
 * 默认空间 ID，用于初始化数据和清空数据后的兜底空间。
 */
const DEFAULT_SPACE_ID = "default-space";

/**
 * 获取默认空间图标，用于初始化数据和兼容旧数据。
 *
 * @returns {string} 默认空间图标。
 */
function getDefaultSpaceIcon() {
  return "📁";
}

/**
 * 获取当前时间戳。
 *
 * @returns {number} 当前毫秒级时间戳。
 */
function getCurrentTime() {
  return Date.now();
}

/**
 * 创建业务对象 ID。
 *
 * @param {string} prefix ID 前缀，用于在不支持 crypto.randomUUID 时生成可读 ID。
 * @returns {string} 新生成的唯一 ID。
 */
function createId(prefix) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${prefix}-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

/**
 * 创建设备标识，用于区分不同浏览器实例的同步数据。
 *
 * @returns {string} 以 device- 为前缀的唯一设备 ID。
 */
function createDeviceId() {
  return `device-${createId("device")}`;
}

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
    createdAt: link && link.createdAt ? link.createdAt : now
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
      theme: rawData.settings && rawData.settings.theme ? rawData.settings.theme : "light",
      rightPanelCollapsed: Boolean(rawData.settings && rawData.settings.rightPanelCollapsed),
      sidebarCollapsed: Boolean(rawData.settings && rawData.settings.sidebarCollapsed),
      sync: {
        deviceId: rawData.settings && rawData.settings.sync && rawData.settings.sync.deviceId ? rawData.settings.sync.deviceId : "",
        deviceName: rawData.settings && rawData.settings.sync && rawData.settings.sync.deviceName ? rawData.settings.sync.deviceName : DEFAULT_SYNC_SETTINGS.deviceName,
        mode: rawData.settings && rawData.settings.sync && rawData.settings.sync.mode ? rawData.settings.sync.mode : DEFAULT_SYNC_SETTINGS.mode,
        lastBackupAt: rawData.settings && rawData.settings.sync && typeof rawData.settings.sync.lastBackupAt === "number" ? rawData.settings.sync.lastBackupAt : DEFAULT_SYNC_SETTINGS.lastBackupAt,
        lastImportAt: rawData.settings && rawData.settings.sync && typeof rawData.settings.sync.lastImportAt === "number" ? rawData.settings.sync.lastImportAt : DEFAULT_SYNC_SETTINGS.lastImportAt,
        provider: rawData.settings && rawData.settings.sync && rawData.settings.sync.provider ? rawData.settings.sync.provider : DEFAULT_SYNC_SETTINGS.provider,
        webdavUrl: rawData.settings && rawData.settings.sync && rawData.settings.sync.webdavUrl ? rawData.settings.sync.webdavUrl : DEFAULT_SYNC_SETTINGS.webdavUrl,
        webdavUsername: rawData.settings && rawData.settings.sync && rawData.settings.sync.webdavUsername ? rawData.settings.sync.webdavUsername : DEFAULT_SYNC_SETTINGS.webdavUsername,
        webdavPassword: rawData.settings && rawData.settings.sync && rawData.settings.sync.webdavPassword ? rawData.settings.sync.webdavPassword : DEFAULT_SYNC_SETTINGS.webdavPassword,
        webdavAutoSyncEnabled: Boolean(rawData.settings && rawData.settings.sync && rawData.settings.sync.webdavAutoSyncEnabled),
        gistToken: rawData.settings && rawData.settings.sync && rawData.settings.sync.gistToken ? rawData.settings.sync.gistToken : DEFAULT_SYNC_SETTINGS.gistToken,
        gistId: rawData.settings && rawData.settings.sync && rawData.settings.sync.gistId ? rawData.settings.sync.gistId : DEFAULT_SYNC_SETTINGS.gistId,
        gistFilename: rawData.settings && rawData.settings.sync && rawData.settings.sync.gistFilename ? rawData.settings.sync.gistFilename : DEFAULT_SYNC_SETTINGS.gistFilename,
        gistAutoSyncEnabled: Boolean(rawData.settings && rawData.settings.sync && rawData.settings.sync.gistAutoSyncEnabled),
        autoSyncPendingAt: rawData.settings && rawData.settings.sync && typeof rawData.settings.sync.autoSyncPendingAt === "number" ? rawData.settings.sync.autoSyncPendingAt : DEFAULT_SYNC_SETTINGS.autoSyncPendingAt,
        lastAutoSyncAt: rawData.settings && rawData.settings.sync && typeof rawData.settings.sync.lastAutoSyncAt === "number" ? rawData.settings.sync.lastAutoSyncAt : DEFAULT_SYNC_SETTINGS.lastAutoSyncAt,
        lastAutoSyncError: rawData.settings && rawData.settings.sync && rawData.settings.sync.lastAutoSyncError ? rawData.settings.sync.lastAutoSyncError : DEFAULT_SYNC_SETTINGS.lastAutoSyncError,
        lastSyncAt: rawData.settings && rawData.settings.sync && typeof rawData.settings.sync.lastSyncAt === "number" ? rawData.settings.sync.lastSyncAt : DEFAULT_SYNC_SETTINGS.lastSyncAt
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

/**
 * 判断标签页 URL 是否允许保存。
 *
 * @param {string} url 标签页 URL。
 * @returns {boolean} 可以保存时返回 true，否则返回 false。
 */
function isValidTabUrl(url) {
  if (!url) {
    return false;
  }

  /** 不允许保存的浏览器内部协议前缀。 */
  const blockedPrefixes = [
    "chrome://",
    "edge://",
    "about:",
    "chrome-extension://",
    "devtools://"
  ];

  return !blockedPrefixes.some((prefix) => url.startsWith(prefix));
}

/**
 * 按 URL 对标签页数组去重。
 *
 * @param {Array<object>} tabs 标签页数组。
 * @returns {Array<object>} 去重后的标签页数组。
 */
function dedupeTabsByUrl(tabs) {
  /** 已出现过的 URL 集合。 */
  const visitedUrls = new Set();
  /** 去重后的标签页数组。 */
  const uniqueTabs = [];

  for (const tab of tabs) {
    if (!tab || !tab.url || visitedUrls.has(tab.url)) {
      continue;
    }

    visitedUrls.add(tab.url);
    uniqueTabs.push(tab);
  }

  return uniqueTabs;
}

/**
 * 过滤出允许保存的普通网页标签页。
 *
 * @param {Array<object>} tabs 原始标签页数组。
 * @returns {Array<object>} 过滤后的标签页数组。
 */
function filterValidTabs(tabs) {
  if (!Array.isArray(tabs)) {
    return [];
  }

  return tabs.filter((tab) => tab && isValidTabUrl(tab.url));
}

/**
 * 将浏览器标签页转换为链接数据。
 *
 * @param {Array<object>} tabs 标签页数组。
 * @returns {Array<object>} 链接数组。
 */
function tabsToLinks(tabs) {
  return dedupeTabsByUrl(filterValidTabs(tabs)).map((tab) => ({
    id: createId("link"),
    title: tab.title || tab.url,
    url: tab.url,
    favIconUrl: tab.favIconUrl || "",
    createdAt: getCurrentTime()
  }));
}

/**
 * 根据关键词过滤分组和链接。
 *
 * @param {Array<object>} groups 分组数组。
 * @param {string} keyword 搜索关键词。
 * @returns {Array<object>} 匹配的分组数组。
 */
function filterGroups(groups, keyword) {
  /** 统一转为小写后的搜索关键词。 */
  const q = String(keyword || "").trim().toLowerCase();

  if (!q) {
    return groups;
  }

  return groups
    .map((group) => {
      /** 分组名称是否命中关键词。 */
      const groupMatched = group.name.toLowerCase().includes(q);

      if (groupMatched) {
        return group;
      }

      /** 当前分组内命中关键词的链接。 */
      const matchedLinks = group.links.filter((link) => {
        return link.title.toLowerCase().includes(q) || link.url.toLowerCase().includes(q);
      });

      if (matchedLinks.length === 0) {
        return null;
      }

      return {
        ...group,
        links: matchedLinks
      };
    })
    .filter(Boolean);
}

/**
 * 根据关键词过滤当前窗口标签页。
 *
 * @param {Array<object>} tabs 当前窗口标签页数组。
 * @param {string} keyword 搜索关键词。
 * @returns {Array<object>} 匹配的当前标签页数组。
 */
function filterCurrentTabs(tabs, keyword) {
  /** 统一小写后的搜索关键词。 */
  const q = String(keyword || "").trim().toLowerCase();

  if (!Array.isArray(tabs)) {
    return [];
  }

  if (!q) {
    return tabs;
  }

  return tabs.filter((tab) => {
    /** 标签标题。 */
    const title = tab && tab.title ? tab.title.toLowerCase() : "";
    /** 标签 URL。 */
    const url = tab && tab.url ? tab.url.toLowerCase() : "";

    return title.includes(q) || url.includes(q);
  });
}

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
  /** 导出前移除敏感同步凭据的数据。 */
  const normalizedData = createBackupSafeData(data);
  /** 当前时间戳。 */
  const now = getCurrentTime();

  return JSON.stringify({
    backupVersion: BACKUP_VERSION,
    appVersion: APP_VERSION,
    exportedAt: now,
    deviceId: normalizedData.settings.sync.deviceId || "",
    data: normalizedData
  }, null, 2);
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
  let parsedData = null;

  try {
    parsedData = JSON.parse(text);
  } catch (error) {
    throw new Error("导入文件不是有效的 JSON");
  }

  return migrateData(extractBackupData(parsedData));
}

/**
 * 移动数组中的单个元素。
 *
 * @param {Array<*>} items 原数组。
 * @param {number} fromIndex 起始索引。
 * @param {number} toIndex 目标索引。
 * @returns {Array<*>} 重排后的新数组。
 */
function moveArrayItem(items, fromIndex, toIndex) {
  if (!Array.isArray(items)) {
    return [];
  }

  if (fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length || fromIndex === toIndex) {
    return items.slice();
  }

  /** 复制后的数组，避免直接修改输入数组。 */
  const nextItems = items.slice();
  /** 被移动的元素。 */
  const [movedItem] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, movedItem);
  return nextItems;
}

/**
 * 重排空间顺序。
 *
 * @param {object} data 当前全量数据。
 * @param {string} sourceSpaceId 被拖拽的空间 ID。
 * @param {string} targetSpaceId 放置目标空间 ID。
 * @returns {object} 重排后的全量数据。
 */
function reorderSpaces(data, sourceSpaceId, targetSpaceId) {
  /** 标准化后的下一份数据。 */
  const nextData = normalizeData(data);
  /** 被拖拽空间的索引。 */
  const fromIndex = nextData.spaces.findIndex((space) => space.id === sourceSpaceId);
  /** 放置目标空间的索引。 */
  const toIndex = nextData.spaces.findIndex((space) => space.id === targetSpaceId);
  nextData.spaces = moveArrayItem(nextData.spaces, fromIndex, toIndex);
  return nextData;
}

/**
 * 重排指定空间内的分组顺序。
 *
 * @param {object} data 当前全量数据。
 * @param {string} spaceId 空间 ID。
 * @param {string} sourceGroupId 被拖拽的分组 ID。
 * @param {string} targetGroupId 放置目标分组 ID。
 * @returns {object} 重排后的全量数据。
 */
function reorderGroups(data, spaceId, sourceGroupId, targetGroupId) {
  /** 标准化后的下一份数据。 */
  const nextData = normalizeData(data);
  /** 当前操作的空间。 */
  const space = nextData.spaces.find((item) => item.id === spaceId);

  if (!space) {
    return nextData;
  }

  /** 被拖拽分组的索引。 */
  const fromIndex = space.groups.findIndex((group) => group.id === sourceGroupId);
  /** 放置目标分组的索引。 */
  const toIndex = space.groups.findIndex((group) => group.id === targetGroupId);
  space.groups = moveArrayItem(space.groups, fromIndex, toIndex);
  space.updatedAt = getCurrentTime();
  return nextData;
}

/**
 * 重排指定分组内的链接顺序。
 *
 * @param {object} data 当前全量数据。
 * @param {string} spaceId 空间 ID。
 * @param {string} groupId 分组 ID。
 * @param {string} sourceLinkId 被拖拽的链接 ID。
 * @param {string} targetLinkId 放置目标链接 ID。
 * @returns {object} 重排后的全量数据。
 */
function reorderLinks(data, spaceId, groupId, sourceLinkId, targetLinkId) {
  /** 标准化后的下一份数据。 */
  const nextData = normalizeData(data);
  /** 当前操作的空间。 */
  const space = nextData.spaces.find((item) => item.id === spaceId);
  /** 当前操作的分组。 */
  const group = space ? space.groups.find((item) => item.id === groupId) : null;

  if (!group) {
    return nextData;
  }

  /** 被拖拽链接的索引。 */
  const fromIndex = group.links.findIndex((link) => link.id === sourceLinkId);
  /** 放置目标链接的索引。 */
  const toIndex = group.links.findIndex((link) => link.id === targetLinkId);
  group.links = moveArrayItem(group.links, fromIndex, toIndex);
  group.updatedAt = getCurrentTime();
  return nextData;
}

/**
 * 在同一空间内跨分组移动链接。
 *
 * @param {object} data 当前全量数据。
 * @param {string} spaceId 空间 ID。
 * @param {string} sourceGroupId 源分组 ID。
 * @param {string} targetGroupId 目标分组 ID。
 * @param {string} sourceLinkId 被拖拽的链接 ID。
 * @param {string} targetLinkId 放置目标链接 ID，为空时追加到目标分组末尾。
 * @returns {object} 移动链接后的全量数据。
 */
function moveLinkBetweenGroups(data, spaceId, sourceGroupId, targetGroupId, sourceLinkId, targetLinkId) {
  /** 标准化后的下一份数据。 */
  const nextData = normalizeData(data);
  /** 当前操作的空间。 */
  const space = nextData.spaces.find((item) => item.id === spaceId);

  if (!space || sourceGroupId === targetGroupId) {
    return nextData;
  }

  /** 源分组。 */
  const sourceGroup = space.groups.find((item) => item.id === sourceGroupId);
  /** 目标分组。 */
  const targetGroup = space.groups.find((item) => item.id === targetGroupId);

  if (!sourceGroup || !targetGroup) {
    return nextData;
  }

  /** 被移动链接在源分组中的索引。 */
  const sourceIndex = sourceGroup.links.findIndex((link) => link.id === sourceLinkId);

  if (sourceIndex < 0) {
    return nextData;
  }

  /** 被移动的链接数据。 */
  const [movedLink] = sourceGroup.links.splice(sourceIndex, 1);
  /** 目标链接在目标分组中的索引。 */
  const targetIndex = targetGroup.links.findIndex((link) => link.id === targetLinkId);

  if (targetIndex < 0) {
    targetGroup.links.push(movedLink);
  } else {
    targetGroup.links.splice(targetIndex, 0, movedLink);
  }

  sourceGroup.updatedAt = getCurrentTime();
  targetGroup.updatedAt = getCurrentTime();
  space.updatedAt = getCurrentTime();
  return nextData;
}

/**
 * 向指定分组添加链接，并按 URL 跳过重复链接。
 *
 * @param {object} data 当前全量数据。
 * @param {string} spaceId 空间 ID。
 * @param {string} groupId 分组 ID。
 * @param {Array<object>} rawLinks 待添加的原始链接数组。
 * @returns {object} 添加链接后的全量数据。
 */
function addLinksToGroup(data, spaceId, groupId, rawLinks) {
  /** 标准化后的下一份数据。 */
  const nextData = normalizeData(data);
  /** 当前操作的空间。 */
  const space = nextData.spaces.find((item) => item.id === spaceId);
  /** 当前操作的分组。 */
  const group = space ? space.groups.find((item) => item.id === groupId) : null;

  if (!group) {
    return nextData;
  }

  /** 分组内已经存在的 URL 集合。 */
  const existingUrls = new Set(group.links.map((link) => link.url));
  /** 本次真正需要新增的链接数组。 */
  const nextLinks = [];

  for (const rawLink of rawLinks) {
    /** 标准化后的待添加链接。 */
    const link = normalizeLink(rawLink);

    if (!link.url || existingUrls.has(link.url)) {
      continue;
    }

    existingUrls.add(link.url);
    nextLinks.push(link);
  }

  group.links = group.links.concat(nextLinks);
  group.updatedAt = getCurrentTime();
  space.updatedAt = getCurrentTime();
  return nextData;
}

/**
 * 比较两个业务对象的更新时间并返回更新的一方。
 *
 * @param {object} localItem 本地业务对象。
 * @param {object} remoteItem 远端业务对象。
 * @returns {object} 更新时间较新的业务对象。
 */
function pickNewerItem(localItem, remoteItem) {
  /** 本地业务对象更新时间。 */
  const localUpdatedAt = localItem && localItem.updatedAt ? localItem.updatedAt : localItem && localItem.createdAt ? localItem.createdAt : 0;
  /** 远端业务对象更新时间。 */
  const remoteUpdatedAt = remoteItem && remoteItem.updatedAt ? remoteItem.updatedAt : remoteItem && remoteItem.createdAt ? remoteItem.createdAt : 0;

  return remoteUpdatedAt > localUpdatedAt ? remoteItem : localItem;
}

/**
 * 合并两个链接列表，按 ID 和 URL 去重并优先保留较新的链接。
 *
 * @param {Array<object>} localLinks 本地链接列表。
 * @param {Array<object>} remoteLinks 远端链接列表。
 * @returns {Array<object>} 自动合并后的链接列表。
 */
function mergeLinks(localLinks, remoteLinks) {
  /** 按链接 ID 记录的合并结果。 */
  const linkById = new Map();
  /** 合并输入链接到结果集合的内部函数。 */
  const appendLink = (rawLink) => {
    /** 标准化后的链接。 */
    const link = normalizeLink(rawLink);
    /** 已存在的同 ID 链接。 */
    const existingLink = linkById.get(link.id);

    linkById.set(link.id, existingLink ? pickNewerItem(existingLink, link) : link);
  };

  for (const link of Array.isArray(localLinks) ? localLinks : []) {
    appendLink(link);
  }

  for (const link of Array.isArray(remoteLinks) ? remoteLinks : []) {
    appendLink(link);
  }

  /** 按 URL 记录的合并结果。 */
  const linkByUrl = new Map();

  for (const link of linkById.values()) {
    /** 已存在的同 URL 链接。 */
    const existingLink = linkByUrl.get(link.url);

    if (!existingLink) {
      linkByUrl.set(link.url, link);
      continue;
    }

    linkByUrl.set(link.url, pickNewerItem(existingLink, link));
  }

  return Array.from(linkByUrl.values()).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

/**
 * 合并同一个分组，保留两端链接并按较新元信息更新分组属性。
 *
 * @param {object} localGroup 本地分组。
 * @param {object} remoteGroup 远端分组。
 * @returns {object} 自动合并后的分组。
 */
function mergeGroup(localGroup, remoteGroup) {
  /** 较新的分组元信息。 */
  const newerGroup = pickNewerItem(localGroup, remoteGroup);
  /** 本地分组链接列表。 */
  const localLinks = localGroup && Array.isArray(localGroup.links) ? localGroup.links : [];
  /** 远端分组链接列表。 */
  const remoteLinks = remoteGroup && Array.isArray(remoteGroup.links) ? remoteGroup.links : [];
  /** 自动合并后的分组。 */
  const mergedGroup = normalizeGroup({
    ...newerGroup,
    links: mergeLinks(localLinks, remoteLinks)
  });

  mergedGroup.updatedAt = Math.max(localGroup && localGroup.updatedAt ? localGroup.updatedAt : 0, remoteGroup && remoteGroup.updatedAt ? remoteGroup.updatedAt : 0, mergedGroup.updatedAt || 0);
  return mergedGroup;
}

/**
 * 合并两个分组列表，按 ID 合并并保留两端独有分组。
 *
 * @param {Array<object>} localGroups 本地分组列表。
 * @param {Array<object>} remoteGroups 远端分组列表。
 * @returns {Array<object>} 自动合并后的分组列表。
 */
function mergeGroups(localGroups, remoteGroups) {
  /** 分组 ID 的有序集合。 */
  const groupIds = [];
  /** 本地分组映射。 */
  const localGroupById = new Map();
  /** 远端分组映射。 */
  const remoteGroupById = new Map();
  /** 收集分组 ID 的内部函数。 */
  const collectGroup = (group, targetMap) => {
    if (!group || !group.id) {
      return;
    }

    targetMap.set(group.id, group);

    if (!groupIds.includes(group.id)) {
      groupIds.push(group.id);
    }
  };

  for (const group of Array.isArray(localGroups) ? localGroups : []) {
    collectGroup(group, localGroupById);
  }

  for (const group of Array.isArray(remoteGroups) ? remoteGroups : []) {
    collectGroup(group, remoteGroupById);
  }

  return groupIds.map((groupId) => mergeGroup(localGroupById.get(groupId), remoteGroupById.get(groupId)));
}

/**
 * 合并同一个空间，保留两端分组并按较新元信息更新空间属性。
 *
 * @param {object} localSpace 本地空间。
 * @param {object} remoteSpace 远端空间。
 * @returns {object} 自动合并后的空间。
 */
function mergeSpace(localSpace, remoteSpace) {
  /** 较新的空间元信息。 */
  const newerSpace = pickNewerItem(localSpace, remoteSpace);
  /** 本地空间分组列表。 */
  const localGroups = localSpace && Array.isArray(localSpace.groups) ? localSpace.groups : [];
  /** 远端空间分组列表。 */
  const remoteGroups = remoteSpace && Array.isArray(remoteSpace.groups) ? remoteSpace.groups : [];
  /** 自动合并后的空间。 */
  const mergedSpace = normalizeSpace({
    ...newerSpace,
    groups: mergeGroups(localGroups, remoteGroups)
  });

  mergedSpace.updatedAt = Math.max(localSpace && localSpace.updatedAt ? localSpace.updatedAt : 0, remoteSpace && remoteSpace.updatedAt ? remoteSpace.updatedAt : 0, mergedSpace.updatedAt || 0);
  return mergedSpace;
}

/**
 * 合并两个空间列表，按 ID 合并并保留两端独有空间。
 *
 * @param {Array<object>} localSpaces 本地空间列表。
 * @param {Array<object>} remoteSpaces 远端空间列表。
 * @returns {Array<object>} 自动合并后的空间列表。
 */
function mergeSpaces(localSpaces, remoteSpaces) {
  /** 空间 ID 的有序集合。 */
  const spaceIds = [];
  /** 本地空间映射。 */
  const localSpaceById = new Map();
  /** 远端空间映射。 */
  const remoteSpaceById = new Map();
  /** 收集空间 ID 的内部函数。 */
  const collectSpace = (space, targetMap) => {
    if (!space || !space.id) {
      return;
    }

    targetMap.set(space.id, space);

    if (!spaceIds.includes(space.id)) {
      spaceIds.push(space.id);
    }
  };

  for (const space of Array.isArray(localSpaces) ? localSpaces : []) {
    collectSpace(space, localSpaceById);
  }

  for (const space of Array.isArray(remoteSpaces) ? remoteSpaces : []) {
    collectSpace(space, remoteSpaceById);
  }

  return spaceIds.map((spaceId) => mergeSpace(localSpaceById.get(spaceId), remoteSpaceById.get(spaceId)));
}

/**
 * 自动合并本地和远端工作台数据，优先保留两端数据避免同步丢失。
 *
 * @param {object} localData 本地当前全量数据。
 * @param {object} remoteData 远端当前全量数据。
 * @param {string} deviceId 当前设备 ID。
 * @returns {object} 自动合并后的全量数据。
 */
function mergeWorkspaceData(localData, remoteData, deviceId) {
  /** 标准化后的本地数据。 */
  const normalizedLocalData = ensureSyncSettings(localData, deviceId);
  /** 标准化后的远端数据。 */
  const normalizedRemoteData = ensureSyncSettings(remoteData, normalizedLocalData.settings.sync.deviceId);
  /** 自动合并后的空间列表。 */
  const spaces = mergeSpaces(normalizedLocalData.spaces, normalizedRemoteData.spaces);
  /** 合并后仍然存在的当前激活空间 ID。 */
  const activeSpaceId = spaces.some((space) => space.id === normalizedLocalData.activeSpaceId) ? normalizedLocalData.activeSpaceId : spaces[0].id;
  /** 合并后的全量数据。 */
  const mergedData = ensureSyncSettings({
    version: Math.max(normalizedLocalData.version || 1, normalizedRemoteData.version || 1),
    activeSpaceId,
    spaces,
    settings: normalizedLocalData.settings
  }, normalizedLocalData.settings.sync.deviceId);

  mergedData.settings.sync = {
    ...normalizedLocalData.settings.sync
  };
  return mergedData;
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
    webdavAutoSyncEnabled: Boolean(nextData.settings.sync.webdavAutoSyncEnabled),
    gistToken: nextData.settings.sync.gistToken || DEFAULT_SYNC_SETTINGS.gistToken,
    gistId: nextData.settings.sync.gistId || DEFAULT_SYNC_SETTINGS.gistId,
    gistFilename: nextData.settings.sync.gistFilename || DEFAULT_SYNC_SETTINGS.gistFilename,
    gistAutoSyncEnabled: Boolean(nextData.settings.sync.gistAutoSyncEnabled),
    autoSyncPendingAt: typeof nextData.settings.sync.autoSyncPendingAt === "number" ? nextData.settings.sync.autoSyncPendingAt : DEFAULT_SYNC_SETTINGS.autoSyncPendingAt,
    lastAutoSyncAt: typeof nextData.settings.sync.lastAutoSyncAt === "number" ? nextData.settings.sync.lastAutoSyncAt : DEFAULT_SYNC_SETTINGS.lastAutoSyncAt,
    lastAutoSyncError: nextData.settings.sync.lastAutoSyncError || DEFAULT_SYNC_SETTINGS.lastAutoSyncError,
    lastSyncAt: typeof nextData.settings.sync.lastSyncAt === "number" ? nextData.settings.sync.lastSyncAt : DEFAULT_SYNC_SETTINGS.lastSyncAt
  };

  return nextData;
}

/**
 * 获取全量数据中最近的更新时间，取所有空间和分组 updatedAt 的最大值。
 *
 * @param {object} data 当前全量数据。
 * @returns {number} 最近的更新时间戳，无数据时返回 0。
 */
function getDataUpdatedAt(data) {
  if (!data || !Array.isArray(data.spaces)) {
    return 0;
  }

  /** 所有空间和分组的更新时间集合。 */
  const timestamps = [];

  for (const space of data.spaces) {
    if (space.updatedAt) {
      timestamps.push(space.updatedAt);
    }

    if (Array.isArray(space.groups)) {
      for (const group of space.groups) {
        if (group.updatedAt) {
          timestamps.push(group.updatedAt);
        }
      }
    }
  }

  return timestamps.length > 0 ? Math.max(...timestamps) : 0;
}

/**
 * 将字节数组转换为 Base64 文本。
 *
 * @param {Uint8Array} bytes 待编码的字节数组。
 * @returns {string} Base64 文本。
 */
function bytesToBase64(bytes) {
  /** 每个字节转换得到的字符数组。 */
  const chars = [];

  for (const byte of bytes) {
    chars.push(String.fromCharCode(byte));
  }

  return btoa(chars.join(""));
}

/**
 * 将 Base64 文本转换为字节数组。
 *
 * @param {string} text Base64 文本。
 * @returns {Uint8Array} 解码后的字节数组。
 */
function base64ToBytes(text) {
  /** Base64 解码后的二进制字符串。 */
  const binary = atob(text);
  /** 解码后的字节数组。 */
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

/**
 * 使用 PBKDF2 从密码和盐值派生 AES-GCM 密钥。
 *
 * @param {string} password 用户输入的加密密码。
 * @param {Uint8Array} salt 随机盐值。
 * @param {number} iterations PBKDF2 迭代次数。
 * @returns {Promise<CryptoKey>} AES-GCM 加解密密钥。
 */
async function deriveAesKey(password, salt, iterations) {
  /** 密码原始密钥材料。 */
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256"
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * 使用 AES-GCM 加密明文。
 *
 * @param {string} plaintext 明文 JSON 字符串。
 * @param {string} password 用户输入的加密密码。
 * @returns {Promise<object>} 加密参数和密文。
 */
async function aesGcmEncrypt(plaintext, password) {
  /** PBKDF2 迭代次数。 */
  const iterations = 120000;
  /** 随机盐值。 */
  const salt = crypto.getRandomValues(new Uint8Array(16));
  /** AES-GCM 随机初始化向量。 */
  const iv = crypto.getRandomValues(new Uint8Array(12));
  /** AES-GCM 密钥。 */
  const key = await deriveAesKey(password, salt, iterations);
  /** 加密后的密文字节。 */
  const cipherBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv
    },
    key,
    new TextEncoder().encode(plaintext)
  );

  return {
    algorithm: "PBKDF2-SHA256-AES-GCM",
    iterations,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    payload: bytesToBase64(new Uint8Array(cipherBuffer))
  };
}

/**
 * 使用 AES-GCM 解密密文。
 *
 * @param {object} encryptedData 加密参数和密文。
 * @param {string} password 用户输入的解密密码。
 * @returns {Promise<string>} 解密后的明文 JSON 字符串。
 */
async function aesGcmDecrypt(encryptedData, password) {
  /** 随机盐值。 */
  const salt = base64ToBytes(encryptedData.salt);
  /** AES-GCM 初始化向量。 */
  const iv = base64ToBytes(encryptedData.iv);
  /** AES-GCM 密钥。 */
  const key = await deriveAesKey(password, salt, encryptedData.iterations);
  /** 密文字节。 */
  const cipherBytes = base64ToBytes(encryptedData.payload);
  /** 解密后的明文字节。 */
  const plainBuffer = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv
    },
    key,
    cipherBytes
  );

  return new TextDecoder().decode(plainBuffer);
}

/**
 * 使用密码和 XOR 派生密钥对数据进行简单对称加密。
 *
 * 加密流程：
 * 1. 用 SHA-256 对密码哈希得到 32 字节密钥；
 * 2. 将密钥循环扩展到与明文等长；
 * 3. 逐字节 XOR 得到密文；
 * 4. Base64 编码存储。
 *
 * @param {string} plaintext 明文 JSON 字符串。
 * @param {string} password 用户输入的加密密码。
 * @returns {Promise<string>} Base64 编码的密文。
 */
async function xorEncrypt(plaintext, password) {
  /** 密码的 UTF-8 编码。 */
  const passwordBytes = new TextEncoder().encode(password);
  /** SHA-256 哈希后的 32 字节密钥。 */
  const keyBuffer = await crypto.subtle.digest("SHA-256", passwordBytes);
  /** 密钥数组，用于循环 XOR。 */
  const keyArray = new Uint8Array(keyBuffer);
  /** 明文的 UTF-8 编码。 */
  const plainBytes = new TextEncoder().encode(plaintext);
  /** 密文字节数组。 */
  const cipherBytes = new Uint8Array(plainBytes.length);

  for (let i = 0; i < plainBytes.length; i++) {
    cipherBytes[i] = plainBytes[i] ^ keyArray[i % keyArray.length];
  }

  /** 密文的 Base64 编码。 */
  const base64 = btoa(String.fromCharCode(...cipherBytes));
  return base64;
}

/**
 * 使用密码和 XOR 派生密钥解密 Base64 密文。
 *
 * @param {string} cipherBase64 Base64 编码的密文。
 * @param {string} password 用户输入的解密密码。
 * @returns {Promise<string>} 解密后的明文 JSON 字符串。
 */
async function xorDecrypt(cipherBase64, password) {
  /** 密码的 UTF-8 编码。 */
  const passwordBytes = new TextEncoder().encode(password);
  /** SHA-256 哈希后的 32 字节密钥。 */
  const keyBuffer = await crypto.subtle.digest("SHA-256", passwordBytes);
  /** 密钥数组，用于循环 XOR。 */
  const keyArray = new Uint8Array(keyBuffer);
  /** Base64 解码后的密文字节数组。 */
  const cipherChars = atob(cipherBase64);
  /** 密文字节数组。 */
  const cipherBytes = new Uint8Array(cipherChars.length);

  for (let i = 0; i < cipherChars.length; i++) {
    cipherBytes[i] = cipherChars.charCodeAt(i);
  }

  /** 解密后的明文字节数组。 */
  const plainBytes = new Uint8Array(cipherBytes.length);

  for (let i = 0; i < cipherBytes.length; i++) {
    plainBytes[i] = cipherBytes[i] ^ keyArray[i % keyArray.length];
  }

  return new TextDecoder().decode(plainBytes);
}

/**
 * 创建加密备份文件内容。
 *
 * @param {object} data 当前全量数据。
 * @param {string} password 加密密码。
 * @param {string} deviceId 当前设备 ID。
 * @returns {Promise<string>} 加密备份 JSON 文本。
 * @throws {Error} 当密码为空时抛出错误。
 */
async function createEncryptedBackup(data, password, deviceId) {
  if (!password) {
    throw new Error("请输入加密密码");
  }

  /** 标准化并移除敏感同步凭据后的数据。 */
  const normalizedData = createBackupSafeData(data);
  /** 当前时间戳。 */
  const now = getCurrentTime();
  /** 当前设备 ID。 */
  const currentDeviceId = deviceId || normalizedData.settings.sync.deviceId || "";
  /** 加密前的备份包明文。 */
  const dataText = JSON.stringify({
    backupVersion: BACKUP_VERSION,
    appVersion: APP_VERSION,
    exportedAt: now,
    deviceId: currentDeviceId,
    data: normalizedData
  });
  /** AES-GCM 加密结果。 */
  const encryptedData = await aesGcmEncrypt(dataText, password);

  return JSON.stringify({
    encrypted: true,
    backupVersion: BACKUP_VERSION,
    appVersion: APP_VERSION,
    exportedAt: now,
    deviceId: currentDeviceId,
    encryption: encryptedData.algorithm,
    iterations: encryptedData.iterations,
    salt: encryptedData.salt,
    iv: encryptedData.iv,
    payload: encryptedData.payload
  }, null, 2);
}

/**
 * 从加密备份文本恢复数据。
 *
 * @param {string} text 加密备份 JSON 文本。
 * @param {string} password 解密密码。
 * @returns {Promise<object>} 解密并标准化后的全量数据。
 * @throws {Error} 当密码错误或文件损坏时抛出错误。
 */
async function restoreEncryptedBackup(text, password) {
  if (!password) {
    throw new Error("请输入解密密码");
  }

  /** 解析后的备份对象。 */
  let backupData = null;

  try {
    backupData = JSON.parse(text);
  } catch (error) {
    throw new Error("密码错误或文件损坏");
  }

  if (!backupData || !backupData.payload) {
    throw new Error("密码错误或文件损坏");
  }

  /** 解密后的明文 JSON。 */
  let plainText = "";

  try {
    plainText = backupData.encryption === "PBKDF2-SHA256-AES-GCM"
      ? await aesGcmDecrypt(backupData, password)
      : await xorDecrypt(backupData.payload, password);
  } catch (error) {
    throw new Error("密码错误或文件损坏");
  }

  /** 解密后的数据对象。 */
  let decryptedData = null;

  try {
    decryptedData = JSON.parse(plainText);
  } catch (error) {
    throw new Error("密码错误或文件损坏");
  }

  return migrateData(extractBackupData(decryptedData));
}

/**
 * 检测本地数据和待导入数据之间是否存在冲突。
 *
 * @param {object} localData 本地当前全量数据。
 * @param {object} importedData 待导入的全量数据。
 * @returns {object} 冲突检测结果，包含 isOlder、isDifferentDevice、requiresConfirm 字段。
 */
function detectImportConflict(localData, importedData) {
  /** 本地数据的最近更新时间。 */
  const localUpdatedAt = getDataUpdatedAt(localData);
  /** 待导入数据的最近更新时间。 */
  const importedUpdatedAt = getDataUpdatedAt(importedData);
  /** 导入数据是否比本地旧。 */
  const isOlder = importedUpdatedAt < localUpdatedAt;
  /** 本地设备 ID。 */
  const localDeviceId = localData.settings && localData.settings.sync ? localData.settings.sync.deviceId : "";
  /** 导入数据设备 ID。 */
  const importedDeviceId = importedData.settings && importedData.settings.sync ? importedData.settings.sync.deviceId : "";
  /** 是否来自不同设备。 */
  const isDifferentDevice = Boolean(localDeviceId && importedDeviceId && localDeviceId !== importedDeviceId);
  /** 是否需要二次确认。 */
  const requiresConfirm = isOlder || isDifferentDevice;

  return {
    isOlder,
    isDifferentDevice,
    requiresConfirm
  };
}

/**
 * 清空所有数据并恢复默认数据结构。
 *
 * @returns {object} 默认全量数据。
 */
function clearAllData() {
  return createDefaultData();
}

const tabdeskCoreApi = {
  STORAGE_KEY,
  DEFAULT_SPACE_ID,
  APP_VERSION,
  BACKUP_VERSION,
  createDefaultData,
  normalizeData,
  migrateData,
  createId,
  createDeviceId,
  ensureSyncSettings,
  getDataUpdatedAt,
  mergeWorkspaceData,
  createEncryptedBackup,
  restoreEncryptedBackup,
  xorEncrypt,
  detectImportConflict,
  isValidTabUrl,
  dedupeTabsByUrl,
  filterValidTabs,
  tabsToLinks,
  filterGroups,
  filterCurrentTabs,
  exportData,
  importData,
  extractBackupData,
  createBackupSafeData,
  moveArrayItem,
  reorderSpaces,
  reorderGroups,
  reorderLinks,
  moveLinkBetweenGroups,
  addLinksToGroup,
  clearAllData
};

if (typeof module !== "undefined") {
  module.exports = tabdeskCoreApi;
} else {
  root.MyTabDeskCore = tabdeskCoreApi;
}
})(typeof globalThis !== "undefined" ? globalThis : window);
