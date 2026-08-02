(function (root) {
const app = root.MyTabDeskPage;
const {
  state,
  STORAGE_KEY,
  createDefaultData,
  migrateData,
  getCurrentTime,
  isSyncProviderEnabled,
  touchSyncState
} = app;

/**
 * 工作台数据脏标记，用于检测数据是否发生变化，避免全量序列化比较。
 */
let workspaceDirty = false;

/** 可独立参与多页面保存的同步运行状态字段。 */
const SYNC_RUNTIME_STATE_FIELDS = [
  "gistId",
  "autoSyncPendingAt",
  "lastAutoSyncAt",
  "lastAutoSyncError",
  "lastSyncAt",
  "lastBackupAt",
  "lastImportAt"
];

/** 本次保存真正修改的同步运行状态字段；实际版本在持久化锁内推进。 */
const syncStateDirtyFields = new Set();

/**
 * 同步操作串行锁的 promise 链尾节点。
 * 所有同步入口（自动同步、手动上传/下载、同步配置保存）通过 withSyncLock 排队执行，
 * 避免并发修改 state.data 或并发写入远端导致数据损坏。
 */
let syncLockChain = Promise.resolve();

/** 当前页面内的存储写入串行链；不支持 Web Locks 时作为回退。 */
let storageLockChain = Promise.resolve();

/**
 * 标记工作台数据已变更，后续 hasWorkspaceDataChanged 调用时会返回 true。
 *
 * @returns {void}
 */
function markDirty() {
  workspaceDirty = true;
}

/**
 * 标记用户设置已更新，并写入独立版本时间。
 *
 * @returns {void}
 */
function markSettingsDirty() {
  if (state.data && state.data.settings) {
    state.data.settings.updatedAt = getCurrentTime();
  }
}

/**
 * 标记指定同步运行状态字段已变更。版本号延迟到存储事务内生成，避免多页面同毫秒冲突。
 *
 * @param {string[]} fields 本次修改的状态字段。
 * @returns {void}
 */
function markSyncStateDirty(fields) {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new TypeError("同步运行状态更新必须声明具体字段");
  }

  for (const field of fields) {
    if (SYNC_RUNTIME_STATE_FIELDS.includes(field)) {
      syncStateDirtyFields.add(field);
    }
  }
}

/**
 * 串行执行同步类操作，保证同一时刻只有一个同步任务运行，后续调用自动排队。
 * 单个任务的失败不会阻塞后续排队任务（通过 .catch 续接链条实现）。
 *
 * @param {Function} fn 需要加锁执行的异步函数。
 * @returns {Promise<*>} fn 的返回值（透传）。
 */
function withSyncLock(fn) {
  /** 当前任务执行完毕（无论成功或失败）后的锁链尾节点，用于续接下一个排队任务。 */
  const nextChain = syncLockChain.then(fn, fn);
  // 即使 fn 抛错也必须续接链条，否则后续排队任务永远挂起
  syncLockChain = nextChain.then(
    () => undefined,
    () => undefined
  );
  return nextChain;
}

/**
 * 跨工作台页面串行执行本地存储读-合并-写事务。
 *
 * @param {Function} fn 需要加锁执行的异步函数。
 * @returns {Promise<*>} fn 的返回值。
 */
function withStorageLock(fn) {
  if (typeof navigator !== "undefined" && navigator.locks && typeof navigator.locks.request === "function") {
    return navigator.locks.request("mytabdesk-storage-write", fn);
  }

  const nextChain = storageLockChain.then(fn, fn);
  storageLockChain = nextChain.then(() => undefined, () => undefined);
  return nextChain;
}

/**
 * 创建防抖函数，在停止调用 delay 毫秒后才真正执行，期间重复调用会重置计时器。
 * 用于搜索框等高频输入场景，避免每次按键触发全量渲染。
 *
 * @param {Function} fn 需要防抖的函数。
 * @param {number} delay 防抖延迟毫秒数。
 * @returns {Function} 防抖包装后的函数。
 */
function debounce(fn, delay) {
  /** 当前待执行的定时器 ID。 */
  let timerId = 0;

  return function debounced(...args) {
    if (timerId) {
      clearTimeout(timerId);
    }

    timerId = setTimeout(() => {
      timerId = 0;
      fn.apply(this, args);
    }, delay);
  };
}

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
 * 验证图标 URL 是否来自可信域名，防止潜在的 XSS 风险。
 * 只允许 http/https 协议的 URL，且必须是图片格式。
 *
 * @param {string} url 图标 URL。
 * @returns {boolean} URL 安全时返回 true。
 */
function isSafeFaviconUrl(url) {
  if (!url || typeof url !== "string") {
    return false;
  }

  const trimmedUrl = url.trim();

  if (!trimmedUrl) {
    return false;
  }

  try {
    const parsed = new URL(trimmedUrl);

    if (parsed.protocol === "chrome-extension:") {
      return parsed.hostname === chrome.runtime.id && parsed.pathname.startsWith("/_favicon/");
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    const path = parsed.pathname.toLowerCase();
    const imageExtensions = [".png", ".ico", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp"];
    const hasImageExtension = imageExtensions.some((ext) => path.endsWith(ext));

    const safePaths = ["/favicon", "/favicon.ico", "/apple-touch-icon", "/icon"];
    const hasSafePath = safePaths.some((safe) => path.includes(safe));

    return hasImageExtension || hasSafePath || parsed.hostname.includes("favicon");
  } catch {
    return false;
  }
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
 * 使用脏标记优化，避免每次都进行全量序列化比较。
 *
 * @returns {boolean} 数据发生变化时返回 true。
 */
function hasWorkspaceDataChanged() {
  if (!workspaceDirty) {
    return false;
  }

  // 消费脏标记并更新快照
  workspaceDirty = false;
  state.lastWorkspaceSnapshot = createWorkspaceSnapshot();
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
    if (!result[STORAGE_KEY]) {
      return createDefaultData();
    }
    return migrateData(result[STORAGE_KEY]);
  } catch (error) {
    console.error("数据读取失败:", error);
    throw new Error("数据读取失败，请尝试重新打开页面。如问题持续，可在扩展管理页导出诊断信息。", { cause: error });
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
      markSyncStateDirty(["autoSyncPendingAt", "lastAutoSyncError"]);
    }
  }

  if (!hasChromeStorage()) {
    return;
  }

  try {
    await withStorageLock(async () => {
      // 多页面保护：写入前始终合并当前存储快照。
      // 不能只比较最新时间，因为另一个页面较早但独立的修改也可能不在当前快照中。
      if (state.data) {
        const stored = await chrome.storage.local.get(STORAGE_KEY);
        const storedData = stored[STORAGE_KEY];
        const syncSettingsPatch = options.syncSettingsPatch && typeof options.syncSettingsPatch === "object"
          ? options.syncSettingsPatch
          : null;
        /** 合并前保存本页面实际修改的状态补丁，避免把缓存中的其它旧字段一起写回。 */
        const syncStatePatch = {};
        for (const field of syncStateDirtyFields) {
          syncStatePatch[field] = state.data.settings.sync[field];
        }
        if (storedData && !options.replaceStoredData) {
          state.data = root.MyTabDeskPage.mergeWorkspaceData(state.data, storedData, state.data.settings.sync.deviceId);
        }
        if (syncSettingsPatch) {
          // 同步配置按字段保存：以锁内读取的最新设置为基底，避免旧表单覆盖其它页面的新配置。
          if (storedData && storedData.settings) {
            const storedSettings = root.MyTabDeskPage.normalizeData(storedData).settings;
            const currentDeviceId = state.data.settings.sync.deviceId;
            state.data.settings = {
              ...storedSettings,
              sync: {
                ...storedSettings.sync,
                deviceId: currentDeviceId
              }
            };
          }
          Object.assign(state.data.settings.sync, syncSettingsPatch);
          const storedSettingsVersion = storedData && storedData.settings
            ? Number(storedData.settings.updatedAt || 0)
            : 0;
          state.data.settings.updatedAt = Math.max(getCurrentTime(), storedSettingsVersion + 1);
        }
        if (syncStateDirtyFields.size > 0) {
          Object.assign(state.data.settings.sync, syncStatePatch);
          const storedVersion = storedData && storedData.settings && storedData.settings.sync
            ? Number(storedData.settings.sync.stateUpdatedAt || 0)
            : 0;
          touchSyncState(state.data.settings.sync, Math.max(getCurrentTime(), storedVersion + 1));
        }
      }

      await chrome.storage.local.set({
        [STORAGE_KEY]: state.data
      });
      syncStateDirtyFields.clear();
    });
  } catch (error) {
    console.error("数据保存失败:", error);
    // 向上传播错误，让调用方决定如何提示用户和恢复状态
    throw new Error("数据保存失败，请稍后重试。", { cause: error });
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

  return state.data.spaces.find((space) => space.id === state.data.activeSpaceId && !space.deletedAt)
    || state.data.spaces.find((space) => !space.deletedAt)
    || null;
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

  return space.groups.reduce((total, group) => {
    if (group.deletedAt || !Array.isArray(group.links)) {
      return total;
    }
    return total + group.links.filter((link) => !link.deletedAt).length;
  }, 0);
}

/**
 * 统计全部工作台数据的空间、分组和链接数量。
 * 不计入带有 deletedAt 墓碑标记的已删除项。
 *
 * @param {object} data 工作台全量数据。
 * @returns {object} 统计结果对象。
 */
function getDataSummary(data) {
  /** 全部空间列表（不含墓碑）。 */
  const spaces = data && Array.isArray(data.spaces) ? data.spaces.filter((s) => !s.deletedAt) : [];
  /** 全部分组数量（不含墓碑）。 */
  const groupCount = spaces.reduce((total, space) => total + (Array.isArray(space.groups) ? space.groups.filter((g) => !g.deletedAt).length : 0), 0);
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
  element.replaceChildren();
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
 * 根据页面地址创建 Chrome 原生图标地址。
 *
 * @param {string} pageUrl 页面地址。
 * @returns {string} Chrome 原生图标地址，不可用时返回空字符串。
 */
function getChromeFaviconUrl(pageUrl) {
  if (!pageUrl || typeof pageUrl !== "string" || typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) {
    return "";
  }

  try {
    const parsed = new URL(pageUrl.trim());

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }

    return `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(parsed.href)}&size=32`;
  } catch {
    return "";
  }
}

/**
 * 从 URL 中提取简洁域名，去掉协议和 www. 前缀，用于卡片副标题展示。
 *
 * @param {string} url 页面地址。
 * @returns {string} 简洁域名（如 github.com），无法解析时返回空字符串。
 */
function extractDomain(url) {
  if (!url || typeof url !== "string") {
    return "";
  }

  try {
    return new URL(url.trim()).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * 构造 Cravatar favicon 服务地址（国内部署，速度快且稳定，由文派开源社区维护）。
 * 作为 Chrome 原生 _favicon/ 接口失败时的二级兜底，适合中国网络环境。
 *
 * @param {string} pageUrl 页面地址。
 * @returns {string} Cravicon favicon 地址，无法解析时返回空字符串。
 */
function getCravatarFaviconUrl(pageUrl) {
  if (!pageUrl || typeof pageUrl !== "string") {
    return "";
  }

  try {
    const parsed = new URL(pageUrl.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    return `https://cn.cravatar.com/favicon/api/index.php?url=${encodeURIComponent(parsed.hostname)}&size=32`;
  } catch {
    return "";
  }
}

/**
 * 构造 Google 公开 favicon 服务地址，作为 Chrome 原生 _favicon/ 接口失败时的二级兜底。
 * Google s2 服务覆盖几乎所有公开网站，且免费稳定。
 *
 * @param {string} pageUrl 页面地址。
 * @returns {string} Google favicon 地址，无法解析时返回空字符串。
 */
function getGoogleFaviconUrl(pageUrl) {
  if (!pageUrl || typeof pageUrl !== "string") {
    return "";
  }

  try {
    const parsed = new URL(pageUrl.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=32`;
  } catch {
    return "";
  }
}

/**
 * 根据输入文本生成稳定的颜色值，用于兜底图标背景，让不同站点的失败图标在视觉上可区分。
 * 同一域名始终得到同一颜色。
 *
 * @param {string} text 用于生成颜色的文本（通常是域名或标题）。
 * @returns {string} hsl 颜色字符串（如 "hsl(210, 65%, 55%)"）。
 */
function pickFallbackColor(text) {
  /** 用于散列的种子，空文本给一个固定值避免全是同色。 */
  const seed = text && text.length > 0 ? text : "default";
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

/**
 * 创建彩色兜底图标元素，显示域名前几个字符，背景色根据域名稳定生成。
 *
 * @param {string} text 用于确定背景色和显示文字的文本（优先域名，回退标题）。
 * @returns {HTMLElement} 兜底图标 div。
 */
function createFallbackIcon(text) {
  const fallback = document.createElement("div");
  fallback.className = "fallback-icon";
  const label = text ? text.slice(0, 2).toUpperCase() : "⌁";
  fallback.textContent = label;
  fallback.style.background = pickFallbackColor(text || label);
  fallback.style.color = "#fff";
  return fallback;
}

/**
 * 创建站点图标元素，优先使用 Chrome 原生图标能力，加载失败时依次降级到
 * Google 公开 favicon 服务、最后是彩色域名方块兜底。
 * 验证图标 URL 是否安全，不安全的 URL 直接使用兜底图标。
 *
 * @param {string} src 图标地址。
 * @param {string} title 链接或标签标题。
 * @param {string} pageUrl 页面地址。
 * @returns {HTMLElement} 图标或兜底图标元素。
 */
function createFavicon(src, title, pageUrl = "", refreshToken = 0) {
  /** 优先用于兜底图标显示与配色的文本，优先用域名（更稳定可区分）。 */
  const label = extractDomain(pageUrl) || (title ? title.trim() : "") || "";

  /** 候选图标地址，按优先级排列：离线缓存 → Chrome 原生 → 原始 src → Cravatar → Google。 */
  const cachedSource = globalThis.MyTabDeskFaviconCache
    ? globalThis.MyTabDeskFaviconCache.resolveFaviconSource(src)
    : src;
  let candidates = [
    cachedSource !== src ? cachedSource : "",
    getChromeFaviconUrl(pageUrl),
    src,
    getCravatarFaviconUrl(pageUrl),
    getGoogleFaviconUrl(pageUrl)
  ].filter((url) => url && isSafeFaviconUrl(url));

  if (refreshToken) {
    candidates = candidates.map((url) => `${url}${url.includes("?") ? "&" : "?"}t=${encodeURIComponent(refreshToken)}`);
  }

  if (candidates.length === 0) {
    return createFallbackIcon(label);
  }

  /** 站点图标图片元素。 */
  const image = document.createElement("img");
  image.className = "favicon";
  image.alt = "";
  image.referrerPolicy = "no-referrer";

  /** 当前尝试到的候选地址索引。 */
  let tryIndex = 0;
  image.src = candidates[0];

  image.addEventListener("error", () => {
    tryIndex += 1;
    if (tryIndex < candidates.length) {
      // 还有候选地址，继续尝试下一个
      image.src = candidates[tryIndex];
    } else {
      // 所有图标源都失败，回退到彩色域名方块
      image.replaceWith(createFallbackIcon(label));
    }
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
  createFavicon,
  getChromeFaviconUrl,
  getCurrentTime,
  markDirty,
  markSettingsDirty,
  markSyncStateDirty,
  isSafeFaviconUrl,
  withSyncLock,
  withStorageLock,
  debounce,
  extractDomain
};
})(globalThis);
