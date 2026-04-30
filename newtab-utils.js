(function (root) {
const app = root.MyTabDeskPage;
const {
  state,
  elements,
  STORAGE_KEY,
  createDefaultData,
  migrateData,
  getCurrentTime,
  isSyncProviderEnabled,
  ensureSyncSettings
} = app;

/**
 * 获取空间显示图标，兼容旧版本保存的英文图标值。
 *
 * @param {string} iconValue 空间保存的图标值。
 * @returns {string} 用于界面展示的彩色图标。
 */
function getDisplaySpaceIcon(iconValue) {
  if (!iconValue || iconValue === "folder") {
    return app.UI_DEFAULT_SPACE_ICON;
  }

  return iconValue;
}

/**
 * 根据 ID 获取页面元素。
 *
 * @param {string} id 元素 ID。
 * @returns {HTMLElement|null} 匹配到的页面元素，没有找到时返回 null。
 */
function getElement(id) {
  return document.getElementById(id);
}

/**
 * 判断当前环境是否支持 Chrome 本地存储 API。
 *
 * @returns {boolean} 支持 chrome.storage.local 时返回 true。
 */
function hasChromeStorage() {
  return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
}

/**
 * 判断当前环境是否支持 Chrome 标签页 API。
 *
 * @returns {boolean} 支持 chrome.tabs 时返回 true。
 */
function hasChromeTabs() {
  return typeof chrome !== "undefined" && chrome.tabs;
}

/**
 * 获取当前同步设置对象。
 *
 * @returns {object|null} 当前同步配置，未初始化时返回 null。
 */
function getSyncSettings() {
  return state.data && state.data.settings ? state.data.settings.sync : null;
}

/**
 * 判断当前同步服务商是否启用自动上传。
 *
 * @param {object} sync 当前同步配置。
 * @returns {boolean} 自动上传可用时返回 true。
 */
function isAutoSyncEnabled(sync) {
  if (!sync) {
    return false;
  }

  return isSyncProviderEnabled(sync, "webdav") && sync.webdavAutoSyncEnabled || isSyncProviderEnabled(sync, "gist") && sync.gistAutoSyncEnabled;
}

/**
 * 判断当前保存是否应该标记为待自动同步。
 *
 * @param {object} options 保存选项。
 * @returns {boolean} 需要标记自动同步时返回 true。
 */
function shouldMarkAutoSyncPending(options) {
  return !(options && options.skipAutoSync);
}

/**
 * 创建只包含工作台业务数据的快照文本。
 *
 * @returns {string} 工作台业务数据快照。
 */
function createWorkspaceSnapshot() {
  if (!state.data) {
    return "";
  }

  return JSON.stringify({
    spaces: state.data.spaces
  });
}

/**
 * 判断本地工作台业务数据是否发生变化。
 *
 * @returns {boolean} 数据发生变化时返回 true。
 */
function hasWorkspaceDataChanged() {
  /** 当前工作台业务数据快照。 */
  const snapshot = createWorkspaceSnapshot();

  if (snapshot === state.lastWorkspaceSnapshot) {
    return false;
  }

  state.lastWorkspaceSnapshot = snapshot;
  return true;
}

/**
 * 从本地存储读取工作台数据。
 *
 * @returns {Promise<object>} 迁移并标准化后的工作台数据。
 */
async function loadData() {
  if (!hasChromeStorage()) {
    return createDefaultData();
  }

  try {
    /** Chrome 本地存储读取结果。 */
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return migrateData(result[STORAGE_KEY]);
  } catch (error) {
    await root.MyTabDeskDialogs.showAlert("数据读取失败，已为你恢复默认数据。");
    return createDefaultData();
  }
}

/**
 * 保存当前工作台数据到本地存储。
 *
 * @param {object} options 保存选项。
 * @returns {Promise<void>} 保存完成后结束。
 */
async function saveData(options = {}) {
  /** 本次保存是否需要尝试标记自动同步。 */
  const shouldCheckAutoSync = shouldMarkAutoSyncPending(options);
  /** 本次保存是否存在工作台业务数据变化。 */
  const workspaceChanged = shouldCheckAutoSync && hasWorkspaceDataChanged();

  if (workspaceChanged) {
    /** 当前同步配置。 */
    const sync = getSyncSettings();

    if (isAutoSyncEnabled(sync)) {
      /** 当前时间戳。 */
      const now = getCurrentTime();
      sync.autoSyncPendingAt = now;
      sync.lastAutoSyncError = "";
    }
  }

  if (!hasChromeStorage()) {
    return;
  }

  try {
    await chrome.storage.local.set({
      [STORAGE_KEY]: state.data
    });
  } catch (error) {
    await root.MyTabDeskDialogs.showAlert("数据保存失败，请稍后重试。");
  }

  if (workspaceChanged) {
    root.MyTabDeskSync.scheduleAutoSync();
  }
}

/**
 * 获取当前激活空间。
 *
 * @returns {object|null} 当前激活空间，无法获取时返回 null。
 */
function getActiveSpace() {
  if (!state.data || !Array.isArray(state.data.spaces)) {
    return null;
  }

  return state.data.spaces.find((space) => space.id === state.data.activeSpaceId) || state.data.spaces[0] || null;
}

/**
 * 格式化时间戳为本地日期时间文本。
 *
 * @param {number} timestamp 毫秒级时间戳。
 * @returns {string} 格式化后的日期时间字符串。
 */
function formatDateTime(timestamp) {
  /** 日期对象。 */
  const date = new Date(timestamp);
  /** 年份文本。 */
  const year = date.getFullYear();
  /** 月份文本。 */
  const month = String(date.getMonth() + 1).padStart(2, "0");
  /** 日期文本。 */
  const day = String(date.getDate()).padStart(2, "0");
  /** 小时文本。 */
  const hour = String(date.getHours()).padStart(2, "0");
  /** 分钟文本。 */
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hour}:${minute}`;
}

/**
 * 统计空间下的链接总数。
 *
 * @param {object} space 空间数据。
 * @returns {number} 链接总数。
 */
function getTotalLinks(space) {
  if (!space || !Array.isArray(space.groups)) {
    return 0;
  }

  return space.groups.reduce((total, group) => total + group.links.length, 0);
}

/**
 * 统计全部工作台数据的空间、分组和链接数量。
 *
 * @param {object} data 工作台全量数据。
 * @returns {object} 统计结果对象。
 */
function getDataSummary(data) {
  /** 全部空间列表。 */
  const spaces = data && Array.isArray(data.spaces) ? data.spaces : [];
  /** 全部分组数量。 */
  const groupCount = spaces.reduce((total, space) => total + (Array.isArray(space.groups) ? space.groups.length : 0), 0);
  /** 全部链接数量。 */
  const linkCount = spaces.reduce((total, space) => total + getTotalLinks(space), 0);

  return {
    spaceCount: spaces.length,
    groupCount,
    linkCount
  };
}

/**
 * 清空指定 DOM 容器。
 *
 * @param {HTMLElement} element 待清空的页面元素。
 * @returns {void}
 */
function clearElement(element) {
  element.innerHTML = "";
}

/**
 * 创建带文本内容的 DOM 元素。
 *
 * @param {string} tagName 标签名称。
 * @param {string} className CSS 类名。
 * @param {string} text 文本内容。
 * @returns {HTMLElement} 创建好的 DOM 元素。
 */
function createTextElement(tagName, className, text) {
  /** 新创建的 DOM 元素。 */
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

/**
 * 创建站点图标元素，加载失败时自动回退为首字母图标。
 *
 * @param {string} src 图标地址。
 * @param {string} title 链接或标签标题。
 * @returns {HTMLElement} 图标或兜底图标元素。
 */
function createFavicon(src, title) {
  if (!src) {
    /** 无图标地址时显示的兜底图标。 */
    const fallback = document.createElement("div");
    fallback.className = "fallback-icon";
    fallback.textContent = title ? title.slice(0, 1).toUpperCase() : "⌁";
    return fallback;
  }

  /** 站点图标图片元素。 */
  const image = document.createElement("img");
  image.className = "favicon";
  image.src = src;
  image.alt = "";
  image.referrerPolicy = "no-referrer";
  image.addEventListener("error", () => {
    /** 图片加载失败时创建的兜底图标。 */
    const fallback = createFavicon("", title);
    image.replaceWith(fallback);
  });
  return image;
}

root.MyTabDeskUtils = {
  getDisplaySpaceIcon,
  getElement,
  hasChromeStorage,
  hasChromeTabs,
  getSyncSettings,
  isAutoSyncEnabled,
  shouldMarkAutoSyncPending,
  createWorkspaceSnapshot,
  hasWorkspaceDataChanged,
  loadData,
  saveData,
  getActiveSpace,
  formatDateTime,
  getTotalLinks,
  getDataSummary,
  clearElement,
  createTextElement,
  createFavicon
};
})(globalThis);
