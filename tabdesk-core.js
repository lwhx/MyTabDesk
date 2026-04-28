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
  lastImportAt: 0
};

/**
 * 默认空间 ID，用于初始化数据和清空数据后的兜底空间。
 */
const DEFAULT_SPACE_ID = "default-space";

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
        icon: "folder",
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
    icon: space && space.icon ? space.icon : "folder",
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
        lastImportAt: rawData.settings && rawData.settings.sync && typeof rawData.settings.sync.lastImportAt === "number" ? rawData.settings.sync.lastImportAt : DEFAULT_SYNC_SETTINGS.lastImportAt
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
 * 导出当前数据为格式化 JSON 文本。
 *
 * @param {object} data 当前全量数据。
 * @returns {string} 可下载备份的 JSON 字符串。
 */
function exportData(data) {
  /** 导出前的标准化数据。 */
  const normalizedData = normalizeData(data);

  return JSON.stringify({
    ...normalizedData,
    exportedAt: getCurrentTime()
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

  return migrateData(parsedData);
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
    lastImportAt: typeof nextData.settings.sync.lastImportAt === "number" ? nextData.settings.sync.lastImportAt : DEFAULT_SYNC_SETTINGS.lastImportAt
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
 */
async function createEncryptedBackup(data, password, deviceId) {
  /** 标准化后的数据。 */
  const normalizedData = normalizeData(data);
  /** 数据部分的 JSON 文本。 */
  const dataText = JSON.stringify(normalizedData);
  /** 加密后的 Base64 密文。 */
  const payload = await xorEncrypt(dataText, password);
  /** 当前时间戳。 */
  const now = getCurrentTime();

  return JSON.stringify({
    backupVersion: BACKUP_VERSION,
    appVersion: APP_VERSION,
    exportedAt: now,
    deviceId: deviceId || "",
    payload
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
    plainText = await xorDecrypt(backupData.payload, password);
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

  return migrateData(decryptedData);
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

if (typeof module !== "undefined") {
  module.exports = {
    STORAGE_KEY,
    DEFAULT_SPACE_ID,
    APP_VERSION,
    BACKUP_VERSION,
    createDefaultData,
    normalizeData,
    migrateData,
    createDeviceId,
    ensureSyncSettings,
    getDataUpdatedAt,
    createEncryptedBackup,
    restoreEncryptedBackup,
    detectImportConflict,
    isValidTabUrl,
    dedupeTabsByUrl,
    filterValidTabs,
    tabsToLinks,
    filterGroups,
    exportData,
    importData,
    moveArrayItem,
    reorderSpaces,
    reorderGroups,
    reorderLinks,
    moveLinkBetweenGroups,
    addLinksToGroup,
    clearAllData
  };
}
