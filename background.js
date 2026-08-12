/**
 * MyTabDesk 后台 Service Worker。
 *
 * 负责处理插件图标点击、右键菜单注册、右键菜单消息暂存和系统通知展示。
 */

globalThis.importScripts("message-protocol.js", "background-message-router.js", "background-notifications.js", "background-page-messaging.js", "workspace-repository.js");

const notificationService = globalThis.MyTabDeskBackgroundNotifications.createNotificationService(chrome);
const pageMessagingService = globalThis.MyTabDeskBackgroundPageMessaging.createPageMessagingService(chrome);
const { showNotification } = notificationService;
const { sendMessageToExtensionPages, hasOpenExtensionPage, notifyMyTabDeskPage } = pageMessagingService;

/**
 * 右键菜单 ID 集合，用于统一注册和识别菜单点击来源。
 */
const CONTEXT_MENU_IDS = {
  SAVE_LINK: "mytabdesk-save-link",
  SAVE_PAGE: "mytabdesk-save-page",
  OPEN_DESK: "mytabdesk-open",
  SAVE_TAB: "mytabdesk-save-tab"
};

/**
 * 待保存数据的存储键名。
 */
const PENDING_SAVE_KEY = "mytabdesk_pending_save_data";

/**
 * 自动同步闹钟名称。
 */
const AUTO_SYNC_ALARM_NAME = "MyTabDeskAutoSync";

/** 自动会话快照闹钟名称。 */
const SESSION_SNAPSHOT_ALARM_NAME = "MyTabDeskSessionSnapshot";
const SCHEDULED_SAVE_ALARM_NAME = "MyTabDeskScheduledSave";
const WORKSPACE_STORAGE_KEY = "my_tab_desk_data";
const workspaceRepository = globalThis.MyTabDeskWorkspaceRepository.createWorkspaceRepository({
  storageArea: chrome.storage.local,
  storageKey: WORKSPACE_STORAGE_KEY,
  lockManager: typeof navigator !== "undefined" ? navigator.locks : null
});

/** 自动会话快照间隔，单位为分钟。 */
const SESSION_SNAPSHOT_PERIOD_MINUTES = 15;

/**
 * 自动同步闹钟唤醒间隔，单位为分钟。
 */
const AUTO_SYNC_PERIOD_MINUTES = 30;

/** 会话快照存储键。 */
const SESSION_SNAPSHOTS_KEY = "mytabdesk_session_snapshots";

/** 设备本地使用统计存储键。 */
const USAGE_STATS_KEY = "mytabdesk_usage_stats";
const USAGE_STATS_RETENTION_DAYS = 90;
const TAB_TIME_STATS_KEY = "mytabdesk_tab_time_stats";
const TAB_LIFECYCLE_STATE_KEY = "mytabdesk_tab_lifecycle_state";
const TAB_LIFECYCLE_CONFIG_KEY = "mytabdesk_tab_lifecycle_config";

const DEFAULT_LIFECYCLE_CONFIG = {
  enabled: true,
  idleWarningMinutes: 60,
  autoSaveHours: 24,
  maxTabs: 50,
  autoCloseEnabled: false,
  whitelistDomains: [],
  retentionDays: 90
};

/** 会话快照默认最大保留条数。 */
const SESSION_SNAPSHOT_DEFAULT_LIMIT = 50;

/**
 * 读取用户自定义的会话快照上限，范围 10–500，默认 50。
 *
 * @returns {Promise<number>} 生效的快照上限。
 */
async function getSessionSnapshotLimit() {
  try {
    const result = await chrome.storage.local.get("mytabdesk_session_limit");
    const value = Number(result["mytabdesk_session_limit"]);
    return Number.isInteger(value) && value >= 10 && value <= 500 ? value : SESSION_SNAPSHOT_DEFAULT_LIMIT;
  } catch {
    return SESSION_SNAPSHOT_DEFAULT_LIMIT;
  }
}

/** 会话快照最长保留时间。 */
const SESSION_SNAPSHOT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 后台唤醒自动同步待处理标记键名。
 */
const AUTO_SYNC_WAKE_KEY = "mytabdesk_auto_sync_wake_pending";

/** 自动同步执行租约的持久化存储键。 */
const AUTO_SYNC_LEASE_KEY = "mytabdesk_auto_sync_lease";

/** 自动同步租约时长，页面异常退出后可自动恢复。 */
const AUTO_SYNC_LEASE_MS = 5 * 60 * 1000;

/** 自动同步租约操作串行链，保证 claim/release 的读写事务不并发。 */
let autoSyncLeaseChain = Promise.resolve();

/** 会话历史读改写串行链，防止捕获、自动快照和删除互相覆盖。 */
let sessionHistoryChain = Promise.resolve();

/** 使用统计读改写串行链。 */
let usageStatsChain = Promise.resolve();
let lifecycleChain = Promise.resolve();
const lifecycleTabs = new Map();
const activeTabByWindow = new Map();

function withLifecycleLock(task) {
  const operation = lifecycleChain.then(task, task);
  lifecycleChain = operation.catch(() => undefined);
  return operation;
}

function getTabDomain(url) {
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.hostname.toLowerCase() : "";
  } catch {
    return "";
  }
}

function createLifecycleEntry(tab, now = Date.now()) {
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    domain: getTabDomain(tab.url),
    createdAt: now,
    lastActivatedAt: tab.active ? now : 0,
    activeStartedAt: tab.active ? now : 0,
    activeMs: 0,
    pinned: Boolean(tab.pinned),
    audible: Boolean(tab.audible)
  };
}

async function persistLifecycleState() {
  await chrome.storage.local.set({
    [TAB_LIFECYCLE_STATE_KEY]: {
      tabs: Object.fromEntries(Array.from(lifecycleTabs, ([id, value]) => [String(id), value])),
      activeByWindow: Object.fromEntries(Array.from(activeTabByWindow, ([id, value]) => [String(id), value]))
    }
  });
}

async function recordDomainActiveTime(domain, durationMs) {
  if (!domain) return;
  const result = await chrome.storage.local.get(TAB_TIME_STATS_KEY);
  const stats = result[TAB_TIME_STATS_KEY] && typeof result[TAB_TIME_STATS_KEY] === "object"
    ? result[TAB_TIME_STATS_KEY]
    : { days: {} };
  stats.days = stats.days || {};
  const dayKey = getLocalDayKey();
  const day = stats.days[dayKey] || { domains: {} };
  day.domains = day.domains || {};
  const domainStats = day.domains[domain] || { activeMs: 0, visits: 0 };
  domainStats.activeMs += Math.max(0, Number(durationMs) || 0);
  domainStats.visits += 1;
  day.domains[domain] = domainStats;
  stats.days[dayKey] = day;
  await chrome.storage.local.set({ [TAB_TIME_STATS_KEY]: stats });
}

async function settleActiveEntry(entry, now = Date.now()) {
  if (!entry || !entry.activeStartedAt) return;
  const duration = Math.max(0, now - entry.activeStartedAt);
  entry.activeMs += duration;
  entry.activeStartedAt = 0;
  await recordDomainActiveTime(entry.domain, duration);
}

function normalizeLifecycleConfig(raw = {}) {
  return {
    enabled: raw.enabled !== false,
    idleWarningMinutes: Math.min(1440, Math.max(1, Number(raw.idleWarningMinutes) || 60)),
    autoSaveHours: Math.min(720, Math.max(1, Number(raw.autoSaveHours) || 24)),
    maxTabs: Math.min(500, Math.max(5, Number(raw.maxTabs) || 50)),
    autoCloseEnabled: Boolean(raw.autoCloseEnabled),
    whitelistDomains: Array.isArray(raw.whitelistDomains)
      ? raw.whitelistDomains.map((item) => String(item).trim().toLowerCase()).filter(Boolean).slice(0, 200)
      : [],
    retentionDays: Math.min(365, Math.max(7, Number(raw.retentionDays) || 90))
  };
}

async function getLifecycleConfig() {
  const result = await chrome.storage.local.get(TAB_LIFECYCLE_CONFIG_KEY);
  return normalizeLifecycleConfig(result[TAB_LIFECYCLE_CONFIG_KEY] || DEFAULT_LIFECYCLE_CONFIG);
}

function getProtectedReason(tab, entry, config) {
  if (tab.active) return "active";
  if (tab.pinned || entry.pinned) return "pinned";
  if (tab.audible || entry.audible) return "audible";
  if (!entry.domain || tab.url && tab.url.startsWith(chrome.runtime.getURL(""))) return "internal";
  if (config.whitelistDomains.some((domain) => entry.domain === domain || entry.domain.endsWith(`.${domain}`))) return "whitelist";
  return "";
}

async function getLifecycleStatus() {
  const [config, tabs] = await Promise.all([getLifecycleConfig(), chrome.tabs.query({})]);
  const now = Date.now();
  const results = [];
  for (const tab of tabs || []) {
    let entry = lifecycleTabs.get(tab.id);
    if (!entry) {
      entry = createLifecycleEntry(tab, now);
      lifecycleTabs.set(tab.id, entry);
    }
    entry.domain = getTabDomain(tab.url) || entry.domain;
    entry.pinned = Boolean(tab.pinned);
    entry.audible = Boolean(tab.audible);
    const lastActive = entry.lastActivatedAt || entry.createdAt;
    const idleMs = Math.max(0, now - lastActive);
    const warningMs = config.idleWarningMinutes * 60 * 1000;
    const criticalMs = config.autoSaveHours * 60 * 60 * 1000;
    results.push({
      tabId: tab.id,
      windowId: tab.windowId,
      domain: entry.domain,
      createdAt: entry.createdAt,
      lastActivatedAt: entry.lastActivatedAt,
      openMs: Math.max(0, now - entry.createdAt),
      idleMs,
      activeMs: entry.activeMs + (entry.activeStartedAt ? now - entry.activeStartedAt : 0),
      protectedReason: getProtectedReason(tab, entry, config),
      status: idleMs >= criticalMs ? "critical" : idleMs >= warningMs ? "warning" : "normal"
    });
  }
  await persistLifecycleState();
  return { config, tabs: results, tabCountWarning: results.length > config.maxTabs };
}

function withUsageStatsLock(task) {
  const operation = usageStatsChain.then(task, task);
  usageStatsChain = operation.catch(() => undefined);
  return operation;
}

function getLocalDayKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function recordUsageEvent(event) {
  if (!event || !["save", "restore"].includes(event.eventType)) return false;
  const result = await chrome.storage.local.get(USAGE_STATS_KEY);
  const stats = result[USAGE_STATS_KEY] && typeof result[USAGE_STATS_KEY] === "object"
    ? result[USAGE_STATS_KEY]
    : { days: {}, spaces: {} };
  stats.days = stats.days || {};
  stats.spaces = stats.spaces || {};
  const dayKey = getLocalDayKey();
  const day = stats.days[dayKey] || { saveCount: 0, savedLinks: 0, restoreCount: 0, restoredLinks: 0 };
  const count = Math.max(0, Number(event.linkCount) || 0);
  if (event.eventType === "save") {
    day.saveCount += 1;
    day.savedLinks += count;
    if (event.spaceId) {
      const space = stats.spaces[event.spaceId] || { saveCount: 0, savedLinks: 0, lastSavedAt: 0 };
      space.saveCount += 1;
      space.savedLinks += count;
      space.lastSavedAt = Date.now();
      stats.spaces[event.spaceId] = space;
    }
  } else {
    day.restoreCount += 1;
    day.restoredLinks += count;
  }
  stats.days[dayKey] = day;
  const cutoff = Date.now() - USAGE_STATS_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const key of Object.keys(stats.days)) {
    if (new Date(`${key}T00:00:00`).getTime() < cutoff) delete stats.days[key];
  }
  await chrome.storage.local.set({ [USAGE_STATS_KEY]: stats });
  return true;
}

async function getUsageStats() {
  const result = await chrome.storage.local.get(USAGE_STATS_KEY);
  return result[USAGE_STATS_KEY] || { days: {}, spaces: {} };
}

/**
 * 待保存请求队列，用于在后台和 MyTabDesk 主页面之间可靠传递保存数据。
 *
 * @type {Array<object>}
 */
let pendingSaveQueue = [];

/** 当前已被页面认领、尚未确认的请求 ID。 */
let claimedPendingSaveId = "";

/** 待保存数据消费串行链，确保多个扩展页面不能重复取得同一条记录。 */
let pendingSaveConsumeChain = Promise.resolve();

/**
 * 从持久化存储中加载待保存队列。
 * Service Worker 重启后会调用此函数恢复数据，并兼容旧版单对象格式。
 *
 * @returns {Promise<void>}
 */
async function loadPendingSaveData() {
  try {
    const result = await chrome.storage.local.get(PENDING_SAVE_KEY);
    const stored = result && result[PENDING_SAVE_KEY];
    if (Array.isArray(stored)) {
      pendingSaveQueue = stored;
    } else if (stored && typeof stored === "object") {
      pendingSaveQueue = [{
        requestId: stored.requestId || `legacy-${stored.timestamp || Date.now()}`,
        ...stored
      }];
    }
  } catch (error) {
    console.error("加载待保存数据失败:", error);
    throw error;
  }
}

/**
 * 持久化待保存队列，防止 Service Worker 重启后丢失。
 *
 * @param {Array<object>} queue 待保存请求队列。
 * @returns {Promise<void>}
 */
async function persistPendingSaveData(queue) {
  try {
    if (queue.length === 0) {
      await chrome.storage.local.remove(PENDING_SAVE_KEY);
    } else {
      await chrome.storage.local.set({ [PENDING_SAVE_KEY]: queue });
    }
  } catch (error) {
    console.error("持久化待保存数据失败:", error);
    throw error;
  }
}

/**
 * 把保存请求加入队列，避免快速连续右键时互相覆盖。
 *
 * @param {object} data 保存请求数据。
 * @returns {Promise<object>} 带请求 ID 的队列记录。
 */
async function enqueuePendingSave(data) {
  return withPendingSaveLock(async () => {
    await loadPendingSaveData();
    const record = {
      requestId: `save-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ...data
    };
    pendingSaveQueue.push(record);
    await persistPendingSaveData(pendingSaveQueue);
    return record;
  });
}

/**
 * 初始化右键菜单。
 *
 * @returns {void}
 */
function initializeContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_IDS.SAVE_LINK,
      title: "保存链接到 MyTabDesk",
      contexts: ["link"]
    });

    chrome.contextMenus.create({
      id: CONTEXT_MENU_IDS.SAVE_PAGE,
      title: "保存页面到 MyTabDesk",
      contexts: ["page", "image"]
    });

    chrome.contextMenus.create({
      id: CONTEXT_MENU_IDS.SAVE_TAB,
      title: "保存当前标签页到 MyTabDesk",
      contexts: ["page"]
    });

    chrome.contextMenus.create({
      id: CONTEXT_MENU_IDS.OPEN_DESK,
      title: "打开 MyTabDesk",
      contexts: ["page"]
    });
  });
}

/**
 * 处理右键菜单点击事件。
 *
 * @param {object} info 右键菜单点击信息。
 * @param {object} tab 当前标签页信息。
 * @returns {Promise<void>}
 */
async function handleContextMenuClick(info, tab) {
  switch (info.menuItemId) {
    case CONTEXT_MENU_IDS.SAVE_LINK:
      await saveLinkToMyTabDesk(info.linkUrl, info.linkText || info.linkUrl);
      break;

    case CONTEXT_MENU_IDS.SAVE_PAGE:
      await savePageToMyTabDesk(tab.url, tab.title, tab.favIconUrl);
      break;

    case CONTEXT_MENU_IDS.OPEN_DESK:
      openMyTabDesk();
      break;

    case CONTEXT_MENU_IDS.SAVE_TAB:
      await saveCurrentTab(tab);
      break;
  }
}

/**
 * 保存链接到 MyTabDesk。
 *
 * @param {string} url 链接 URL。
 * @param {string} title 链接标题。
 * @returns {Promise<void>}
 */
async function saveLinkToMyTabDesk(url, title) {
  const data = {
    type: "link",
    url: url,
    title: title || url,
    timestamp: Date.now()
  };

  await enqueuePendingSave(data);
  notifyMyTabDeskPage("link-saved");
  showNotification(
    "保存请求已提交",
    `正在将「${title || url}」保存到 MyTabDesk`,
    "info"
  );
}

/**
 * 保存页面到 MyTabDesk。
 *
 * @param {string} url 页面 URL。
 * @param {string} title 页面标题。
 * @param {string} favIconUrl 页面图标。
 * @returns {Promise<void>}
 */
async function savePageToMyTabDesk(url, title, favIconUrl) {
  const data = {
    type: "page",
    url: url,
    title: title || url,
    favIconUrl: favIconUrl || "",
    timestamp: Date.now()
  };

  await enqueuePendingSave(data);
  notifyMyTabDeskPage("page-saved");
  showNotification(
    "保存请求已提交",
    `正在将「${title || url}」保存到 MyTabDesk`,
    "info"
  );
}

/**
 * 保存当前标签页到 MyTabDesk。
 *
 * @param {object} tab 标签页信息。
 * @returns {Promise<void>}
 */
async function saveCurrentTab(tab) {
  if (!tab || !tab.url || !isSavableWebUrl(tab.url)) {
    showNotification("无法保存", "仅支持保存 http 或 https 网页地址", "warning");
    return;
  }

  const data = {
    type: "tab",
    url: tab.url,
    title: tab.title || tab.url,
    favIconUrl: tab.favIconUrl || "",
    tabId: tab.id,
    timestamp: Date.now()
  };

  await enqueuePendingSave(data);
  notifyMyTabDeskPage("tab-saved");
  showNotification("保存请求已提交", `正在将「${tab.title || tab.url}」保存到 MyTabDesk`, "info");
}

/**
 * 打开 MyTabDesk 新标签页。
 *
 * @returns {void}
 */
function openMyTabDesk() {
  /** MyTabDesk 主界面的插件内 URL。 */
  const pageUrl = chrome.runtime.getURL("newtab.html");

  chrome.tabs.create({ url: pageUrl });
}

/**
 * 判断 URL 是否为可保存的 http/https 网页地址。
 *
 * @param {string} url 待检查的 URL。
 * @returns {boolean} 可保存时返回 true。
 */
function isSavableWebUrl(url) {
  if (!url || typeof url !== "string") {
    return false;
  }

  try {
    const parsedUrl = new URL(url.trim());
    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * 捕获当前所有普通窗口中的网页标签，并在结构变化时写入会话历史。
 *
 * @param {string} [reason] 快照生成原因。
 * @returns {Promise<object>} 捕获结果。
 */
async function captureSessionSnapshot(reason = "manual") {
  const browserWindows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const browserGroups = chrome.tabGroups && chrome.tabGroups.query
    ? await chrome.tabGroups.query({})
    : [];
  const groupById = new Map(browserGroups.map((group) => [group.id, group]));
  const windows = browserWindows.map((browserWindow) => ({
    focused: Boolean(browserWindow.focused),
    state: browserWindow.state || "normal",
    groups: [...new Set((browserWindow.tabs || [])
      .map((tab) => tab.groupId)
      .filter((groupId) => Number.isInteger(groupId) && groupId >= 0))]
      .map((groupId) => groupById.get(groupId))
      .filter(Boolean)
      .map((group) => ({
        sourceGroupId: group.id,
        title: group.title || "",
        color: group.color || "grey",
        collapsed: Boolean(group.collapsed)
      })),
    tabs: (browserWindow.tabs || [])
      .filter((tab) => isSavableWebUrl(tab.url))
      .map((tab) => ({
        url: tab.url,
        title: tab.title || tab.url,
        favIconUrl: tab.favIconUrl || "",
        pinned: Boolean(tab.pinned),
        active: Boolean(tab.active),
        index: Number.isFinite(tab.index) ? tab.index : 0,
        sourceGroupId: Number.isInteger(tab.groupId) ? tab.groupId : -1
      }))
  })).filter((browserWindow) => browserWindow.tabs.length > 0);

  const fingerprint = JSON.stringify(windows.map((browserWindow) => {
    const savedGroupById = new Map(browserWindow.groups.map((group) => [group.sourceGroupId, group]));
    return browserWindow.tabs.map((tab) => {
      const group = savedGroupById.get(tab.sourceGroupId);
      return [
        tab.url,
        tab.pinned,
        tab.active,
        group ? group.title : "",
        group ? group.color : "",
        group ? group.collapsed : false
      ];
    });
  }));
  return withSessionHistoryLock(async () => {
    const stored = await chrome.storage.local.get(SESSION_SNAPSHOTS_KEY);
    const currentHistory = Array.isArray(stored[SESSION_SNAPSHOTS_KEY]) ? stored[SESSION_SNAPSHOTS_KEY] : [];
    const createdAt = Date.now();
    const cutoff = createdAt - SESSION_SNAPSHOT_RETENTION_MS;
    const snapshotLimit = await getSessionSnapshotLimit();
    const retainedHistory = currentHistory
      .filter((item) => item && item.createdAt >= cutoff)
      .slice(0, snapshotLimit);
    if (retainedHistory[0] && retainedHistory[0].fingerprint === fingerprint) {
      if (retainedHistory.length !== currentHistory.length) {
        await chrome.storage.local.set({ [SESSION_SNAPSHOTS_KEY]: retainedHistory });
      }
      return { success: true, duplicate: true, snapshot: retainedHistory[0] };
    }

    const snapshot = {
      id: `session-${createdAt}-${Math.random().toString(36).slice(2)}`,
      createdAt,
      reason,
      fingerprint,
      windows
    };
    const history = [snapshot, ...retainedHistory]
      .slice(0, snapshotLimit);
    await chrome.storage.local.set({ [SESSION_SNAPSHOTS_KEY]: history });
    return { success: true, duplicate: false, snapshot };
  });
}

/** 读取会话快照历史。 */
async function listSessionSnapshots() {
  const stored = await chrome.storage.local.get(SESSION_SNAPSHOTS_KEY);
  return Array.isArray(stored[SESSION_SNAPSHOTS_KEY]) ? stored[SESSION_SNAPSHOTS_KEY] : [];
}

/** 删除指定会话快照。 */
async function deleteSessionSnapshot(snapshotId) {
  return withSessionHistoryLock(async () => {
    const stored = await chrome.storage.local.get(SESSION_SNAPSHOTS_KEY);
    const history = Array.isArray(stored[SESSION_SNAPSHOTS_KEY]) ? stored[SESSION_SNAPSHOTS_KEY] : [];
    const nextHistory = history.filter((snapshot) => snapshot.id !== snapshotId);
    await chrome.storage.local.set({ [SESSION_SNAPSHOTS_KEY]: nextHistory });
    return nextHistory.length !== history.length;
  });
}

/**
 * 恢复指定会话快照。
 *
 * @param {string} snapshotId 快照 ID。
 * @param {{restoreTo?:'new'|'current',targetWindowId?:number,skipOpenUrls?:boolean,selectedTabKeys?:string[]}} [options] 恢复选项。
 * @returns {Promise<object>} 恢复结果。
 */
async function restoreSessionSnapshot(snapshotId, options = {}) {
  const history = await listSessionSnapshots();
  const snapshot = history.find((item) => item.id === snapshotId);
  if (!snapshot) {
    return { success: false, error: "会话快照不存在" };
  }

  const restoreTo = options.restoreTo === "current" ? "current" : "new";
  const targetWindowId = Number.isInteger(options.targetWindowId) ? options.targetWindowId : null;
  if (restoreTo === "current" && targetWindowId === null) {
    return { success: false, error: "缺少目标窗口" };
  }

  const openUrls = new Set();
  const selectedTabKeys = Array.isArray(options.selectedTabKeys)
    ? new Set(options.selectedTabKeys)
    : null;
  if (options.skipOpenUrls) {
    const currentTabs = await chrome.tabs.query({});
    for (const tab of currentTabs || []) {
      if (isSavableWebUrl(tab.url)) openUrls.add(tab.url);
    }
  }

  let restoredWindows = 0;
  let restoredTabs = 0;
  let skippedTabs = 0;
  for (const [windowIndex, savedWindow] of (snapshot.windows || []).entries()) {
    const allTabs = Array.isArray(savedWindow.tabs)
      ? savedWindow.tabs.filter((tab, tabIndex) => (
        isSavableWebUrl(tab.url)
        && (!selectedTabKeys || selectedTabKeys.has(`${windowIndex}:${tabIndex}`))
      ))
      : [];
    const tabs = allTabs.filter((tab) => {
      if (!options.skipOpenUrls || !openUrls.has(tab.url)) {
        if (options.skipOpenUrls) openUrls.add(tab.url);
        return true;
      }
      skippedTabs += 1;
      return false;
    });
    if (tabs.length === 0) continue;

    let createdWindow;
    if (restoreTo === "current") {
      const createdTabs = [];
      for (const savedTab of tabs) {
        const createdTab = await chrome.tabs.create({
          windowId: targetWindowId,
          url: savedTab.url,
          pinned: Boolean(savedTab.pinned),
          active: Boolean(savedTab.active)
        });
        createdTabs.push(createdTab);
      }
      createdWindow = { id: targetWindowId, tabs: createdTabs };
    } else {
      createdWindow = await chrome.windows.create({
        url: tabs.map((tab) => tab.url),
        focused: restoredWindows === 0,
        state: savedWindow.state === "maximized" ? "maximized" : "normal"
      });
      if (createdWindow && Array.isArray(createdWindow.tabs) && chrome.tabs.update) {
        await Promise.all(createdWindow.tabs.map((tab, index) => {
          const savedTab = tabs[index];
          return savedTab && tab && tab.id
            ? chrome.tabs.update(tab.id, { pinned: Boolean(savedTab.pinned), active: Boolean(savedTab.active) })
            : Promise.resolve();
        }));
      }
    }

    if (createdWindow && Array.isArray(createdWindow.tabs)) {
      restoredTabs += createdWindow.tabs.length;
      if (chrome.tabs.group && chrome.tabGroups && chrome.tabGroups.update) {
        for (const savedGroup of savedWindow.groups || []) {
          const tabIds = tabs
            .map((savedTab, index) => savedTab.sourceGroupId === savedGroup.sourceGroupId
              ? createdWindow.tabs[index] && createdWindow.tabs[index].id
              : null)
            .filter(Number.isInteger);
          if (tabIds.length === 0) continue;
          const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId: createdWindow.id } });
          await chrome.tabGroups.update(groupId, {
            title: savedGroup.title || "",
            color: savedGroup.color || "grey",
            collapsed: Boolean(savedGroup.collapsed)
          });
        }
      }
    }
    restoredWindows += 1;
  }
  if (restoredTabs > 0) {
    withUsageStatsLock(() => recordUsageEvent({ eventType: "restore", linkCount: restoredTabs })).catch((error) => {
      console.error("记录会话恢复统计失败:", error);
    });
  }
  return {
    success: restoredTabs > 0,
    restoredWindows,
    restoredTabs,
    skippedTabs
  };
}

/**
 * 关闭或休眠当前窗口中可保存的非固定、非活动网页标签。
 *
 * @param {'close'|'discard'} mode 清理方式。
 * @param {Array<{tabId:number,url:string,windowId:number}>} [savedTabs] 本次成功保存的标签快照。
 * @returns {Promise<object>} 清理结果。
 */
async function cleanupCurrentWindowTabs(mode, savedTabs = []) {
  if (!Array.isArray(savedTabs) || savedTabs.length === 0 || !chrome.tabs.get) {
    return { success: true, affected: 0 };
  }
  const tabs = (await Promise.all(savedTabs.map(async (savedTab) => {
    try {
      const tab = await chrome.tabs.get(savedTab.tabId);
      return tab.url === savedTab.url && tab.windowId === savedTab.windowId ? tab : null;
    } catch {
      return null;
    }
  }))).filter(Boolean);
  const targets = tabs.filter((tab) => (
    Number.isInteger(tab.id)
    && isSavableWebUrl(tab.url)
    && !tab.pinned
    && !tab.active
  ));
  if (mode === "close") {
    if (targets.length > 0) await chrome.tabs.remove(targets.map((tab) => tab.id));
  } else {
    for (const tab of targets) await chrome.tabs.discard(tab.id);
  }
  return { success: true, affected: targets.length };
}

/**
 * 设置后台自动同步闹钟，避免 MV3 Service Worker 休眠导致定时任务丢失。
 *
 * @returns {void}
 */
function ensurePeriodicAlarm(name, periodInMinutes) {
  chrome.alarms.get(name, (alarm) => {
    if (alarm && alarm.periodInMinutes === periodInMinutes) return;
    chrome.alarms.clear(name, () => {
      chrome.alarms.create(name, { periodInMinutes });
    });
  });
}

function setupAutoSyncAlarm() {
  ensurePeriodicAlarm(AUTO_SYNC_ALARM_NAME, AUTO_SYNC_PERIOD_MINUTES);
}

/** 注册独立的自动会话快照闹钟。 */
function setupSessionSnapshotAlarm() {
  ensurePeriodicAlarm(SESSION_SNAPSHOT_ALARM_NAME, SESSION_SNAPSHOT_PERIOD_MINUTES);
}

function setupScheduledSaveAlarm() {
  ensurePeriodicAlarm(SCHEDULED_SAVE_ALARM_NAME, 1);
}

async function executeScheduledSave() {
  const stored = await chrome.storage.local.get(WORKSPACE_STORAGE_KEY);
  const data = stored[WORKSPACE_STORAGE_KEY];
  const config = data && data.settings && data.settings.scheduledSave;
  if (!data || !config || !config.enabled) return { success: false, reason: "disabled" };
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  if (currentTime !== config.time) return { success: false, reason: "time-mismatch" };
  const dayKey = getLocalDayKey(now.getTime());
  if (config.lastRunDate === dayKey) return { success: false, reason: "already-ran" };
  const tabs = (await chrome.tabs.query({ currentWindow: true })).filter((tab) => isSavableWebUrl(tab.url));
  let outcome = { success: false, reason: "skipped" };
  const result = await workspaceRepository.update(async (latestData) => {
    const latestConfig = latestData && latestData.settings && latestData.settings.scheduledSave;
    if (!latestData || !latestConfig || !latestConfig.enabled) {
      outcome = { success: false, reason: "disabled" };
      return null;
    }
    if (latestConfig.time !== currentTime) {
      outcome = { success: false, reason: "time-mismatch" };
      return null;
    }
    if (latestConfig.lastRunDate === dayKey) {
      outcome = { success: false, reason: "already-ran" };
      return null;
    }
    const space = latestData.spaces.find((item) => item.id === latestConfig.spaceId && !item.deletedAt);
    const group = space && space.groups.find((item) => item.id === latestConfig.groupId && !item.deletedAt);
    if (!space || !group) {
      outcome = { success: false, reason: "target-missing" };
      return null;
    }
    const existingUrls = new Set(group.links.filter((link) => !link.deletedAt).map((link) => link.url));
    const timestamp = Date.now();
    let added = 0;
    for (const tab of tabs) {
      if (existingUrls.has(tab.url)) continue;
      group.links.push({
        id: `scheduled-${timestamp}-${added}`,
        title: tab.title || tab.url,
        url: tab.url,
        favIconUrl: tab.favIconUrl || "",
        note: "",
        color: "",
        createdAt: timestamp,
        updatedAt: timestamp
      });
      existingUrls.add(tab.url);
      added += 1;
    }
    group.updatedAt = timestamp;
    space.updatedAt = timestamp;
    latestConfig.lastRunDate = dayKey;
    latestData.settings.updatedAt = timestamp;
    outcome = { success: true, added, spaceName: space.name, groupName: group.name, spaceId: space.id };
    return latestData;
  });
  if (!result || !outcome.success) return outcome;
  const { added } = outcome;
  if (added > 0) {
    await recordUsageEvent({ eventType: "save", linkCount: added, spaceId: outcome.spaceId });
    showNotification("定时保存完成", `已保存 ${added} 个标签到「${outcome.spaceName} / ${outcome.groupName}」`, "success");
  }
  return { success: true, added };
}

/**
 * 通知已打开的 MyTabDesk 页面执行现有自动同步流程。
 *
 * @returns {Promise<void>} 通知完成后结束。
 */
async function notifyMyTabDeskAutoSync() {
  /** 当前是否有 MyTabDesk 扩展页面打开。 */
  const hasPage = await hasOpenExtensionPage();

  if (!hasPage) {
    await chrome.storage.local.set({
      [AUTO_SYNC_WAKE_KEY]: Date.now()
    });
    return;
  }

  sendMessageToExtensionPages({
    type: "run-auto-sync"
  });
}

/**
 * 消费后台自动同步待处理标记。
 *
 * @returns {Promise<number>} 待处理标记时间戳，不存在时返回 0。
 */
async function consumeAutoSyncWakeFlag() {
  try {
    /** 后台自动同步待处理读取结果。 */
    const result = await chrome.storage.local.get(AUTO_SYNC_WAKE_KEY);
    /** 后台自动同步待处理时间戳。 */
    const pendingAt = Number(result[AUTO_SYNC_WAKE_KEY] || 0);
    await chrome.storage.local.remove(AUTO_SYNC_WAKE_KEY);
    return pendingAt;
  } catch (error) {
    console.error("读取自动同步待处理标记失败:", error);
    return 0;
  }
}

/**
 * 认领队首待保存请求，但不删除；页面保存成功后必须显式 ack。
 *
 * @returns {Promise<object|null>} 只有第一个认领者能得到队首记录。
 */
async function claimPendingSaveData() {
  await loadPendingSaveData();
  if (claimedPendingSaveId || pendingSaveQueue.length === 0) {
    return null;
  }

  claimedPendingSaveId = pendingSaveQueue[0].requestId;
  return pendingSaveQueue[0];
}

/**
 * 确认保存成功并删除已认领记录。
 *
 * @param {string} requestId 请求 ID。
 * @returns {Promise<boolean>} 确认成功时返回 true。
 */
async function ackPendingSaveData(requestId) {
  if (!requestId || requestId !== claimedPendingSaveId) {
    return false;
  }

  const record = pendingSaveQueue.find((item) => item.requestId === requestId);
  const nextQueue = pendingSaveQueue.filter((item) => item.requestId !== requestId);
  await persistPendingSaveData(nextQueue);
  pendingSaveQueue = nextQueue;
  claimedPendingSaveId = "";
  showNotification("已保存到 MyTabDesk", `已保存「${record && (record.title || record.url) || "网页"}」`, "success");
  return true;
}

/**
 * 释放失败的认领，保留记录供下次重试。
 *
 * @param {string} requestId 请求 ID。
 * @returns {boolean} 释放成功时返回 true。
 */
function releasePendingSaveData(requestId) {
  if (!requestId || requestId !== claimedPendingSaveId) {
    return false;
  }
  claimedPendingSaveId = "";
  return true;
}

/**
 * 串行执行 pending 队列操作。
 *
 * @param {Function} fn 队列操作。
 * @returns {Promise<*>} 操作结果。
 */
function withPendingSaveLock(fn) {
  const task = pendingSaveConsumeChain.then(fn, fn);
  pendingSaveConsumeChain = task.then(() => undefined, () => undefined);
  return task;
}

/**
 * 串行执行自动同步租约操作。
 *
 * @param {Function} fn 租约操作。
 * @returns {Promise<*>} 操作结果。
 */
function withAutoSyncLeaseLock(fn) {
  const task = autoSyncLeaseChain.then(fn, fn);
  autoSyncLeaseChain = task.then(() => undefined, () => undefined);
  return task;
}

/** 串行执行会话历史读改写，防止快照丢失或删除复活。 */
function withSessionHistoryLock(fn) {
  const task = sessionHistoryChain.then(fn, fn);
  sessionHistoryChain = task.then(() => undefined, () => undefined);
  return task;
}

/**
 * 申请持久化自动同步租约。
 *
 * @returns {Promise<object>} claim 结果。
 */
async function claimAutoSyncLease() {
  const now = Date.now();
  const result = await chrome.storage.local.get(AUTO_SYNC_LEASE_KEY);
  const currentLease = result && result[AUTO_SYNC_LEASE_KEY];

  if (currentLease && currentLease.expiresAt > now) {
    return { claimed: false };
  }

  const lease = {
    leaseId: `sync-${now}-${Math.random().toString(36).slice(2)}`,
    expiresAt: now + AUTO_SYNC_LEASE_MS
  };
  await chrome.storage.local.set({ [AUTO_SYNC_LEASE_KEY]: lease });
  return { claimed: true, leaseId: lease.leaseId };
}

/**
 * 仅由租约所有者释放自动同步租约。
 *
 * @param {string} leaseId 租约 ID。
 * @returns {Promise<boolean>} 释放成功时返回 true。
 */
async function releaseAutoSyncLease(leaseId) {
  if (!leaseId) {
    return false;
  }

  const result = await chrome.storage.local.get(AUTO_SYNC_LEASE_KEY);
  const currentLease = result && result[AUTO_SYNC_LEASE_KEY];
  if (!currentLease || currentLease.leaseId !== leaseId) {
    return false;
  }

  await chrome.storage.local.remove(AUTO_SYNC_LEASE_KEY);
  return true;
}

async function replaceSessionSnapshots(snapshots) {
  return withSessionHistoryLock(async () => {
    const incoming = Array.isArray(snapshots) ? snapshots : [];
    const limit = await getSessionSnapshotLimit();
    const cutoff = Date.now() - SESSION_SNAPSHOT_RETENTION_MS;
    const validSnapshots = incoming
      .filter((snapshot) => (
        snapshot
        && typeof snapshot.id === "string"
        && Number.isFinite(snapshot.createdAt)
        && snapshot.createdAt >= cutoff
        && Array.isArray(snapshot.windows)
      ))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
    await chrome.storage.local.set({ [SESSION_SNAPSHOTS_KEY]: validSnapshots });
    return validSnapshots.length;
  });
}

const messageHandlers = {
  "get-tab-lifecycle": async () => withLifecycleLock(() => getLifecycleStatus()),
  "set-tab-lifecycle-config": async ({ config }) => {
    const normalizedConfig = normalizeLifecycleConfig(config || {});
    await chrome.storage.local.set({ [TAB_LIFECYCLE_CONFIG_KEY]: normalizedConfig });
    return { success: true, config: normalizedConfig };
  },
  "set-scheduled-save-config": async () => {
    setupScheduledSaveAlarm();
    return { success: true };
  },
  "record-usage-event": async (payload) => ({
    success: await withUsageStatsLock(() => recordUsageEvent(payload))
  }),
  "get-usage-stats": async () => {
    const [stats, local] = await Promise.all([
      withUsageStatsLock(() => getUsageStats()),
      chrome.storage.local.get([TAB_TIME_STATS_KEY, TAB_LIFECYCLE_STATE_KEY])
    ]);
    return {
      stats,
      timeStats: local[TAB_TIME_STATS_KEY] || { days: {} },
      lifecycle: local[TAB_LIFECYCLE_STATE_KEY] || { tabs: {}, activeByWindow: {} }
    };
  },
  "capture-session-now": async () => captureSessionSnapshot("manual"),
  "list-session-snapshots": async () => {
    const [snapshots, limit] = await Promise.all([listSessionSnapshots(), getSessionSnapshotLimit()]);
    return { snapshots, limit };
  },
  "set-session-limit": async ({ limit }) => {
    const value = Number(limit);
    if (!Number.isInteger(value) || value < 10 || value > 500) {
      const error = new Error("上限必须在 10 到 500 之间");
      error.code = "SESSION_LIMIT_INVALID";
      throw error;
    }
    await chrome.storage.local.set({ mytabdesk_session_limit: value });
    return { success: true, limit: value };
  },
  "delete-session-snapshot": async ({ snapshotId }) => ({
    success: await deleteSessionSnapshot(snapshotId)
  }),
  "replace-session-snapshots": async ({ snapshots }) => ({
    success: true,
    count: await replaceSessionSnapshots(snapshots)
  }),
  "restore-session-snapshot": async (payload) => restoreSessionSnapshot(payload.snapshotId, {
    restoreTo: payload.restoreTo,
    targetWindowId: payload.targetWindowId,
    skipOpenUrls: Boolean(payload.skipOpenUrls),
    selectedTabKeys: payload.selectedTabKeys
  }),
  "close-saved-tabs": async ({ savedTabs }) => cleanupCurrentWindowTabs("close", savedTabs),
  "discard-saved-tabs": async ({ savedTabs }) => cleanupCurrentWindowTabs("discard", savedTabs),
  "claim-pending-save": async () => ({ data: await withPendingSaveLock(() => claimPendingSaveData()) }),
  "get-pending-save": async () => ({ data: await withPendingSaveLock(() => claimPendingSaveData()) }),
  "ack-pending-save": async ({ requestId }) => ({
    success: await withPendingSaveLock(() => ackPendingSaveData(requestId))
  }),
  "release-pending-save": async ({ requestId }) => ({
    success: await withPendingSaveLock(() => releasePendingSaveData(requestId))
  }),
  "claim-auto-sync": async () => withAutoSyncLeaseLock(() => claimAutoSyncLease()),
  "release-auto-sync": async ({ leaseId }) => ({
    success: await withAutoSyncLeaseLock(() => releaseAutoSyncLease(leaseId))
  }),
  "show-notification": async ({ title, message, notificationType }) => {
    showNotification(title, message, notificationType);
    return { success: true };
  },
  "consume-auto-sync-wake": async () => ({ pendingAt: await consumeAutoSyncWakeFlag() })
};

const messageRouter = globalThis.MyTabDeskBackgroundMessageRouter.createMessageRouter({ handlers: messageHandlers });
chrome.runtime.onMessage.addListener(messageRouter.listener);

chrome.tabs.onCreated.addListener((tab) => withLifecycleLock(async () => {
  const entry = createLifecycleEntry(tab);
  lifecycleTabs.set(tab.id, entry);
  if (tab.active) activeTabByWindow.set(tab.windowId, tab.id);
  await persistLifecycleState();
}));

chrome.tabs.onActivated.addListener((activeInfo) => withLifecycleLock(async () => {
  const now = Date.now();
  const previousId = activeTabByWindow.get(activeInfo.windowId);
  if (previousId && previousId !== activeInfo.tabId) {
    await settleActiveEntry(lifecycleTabs.get(previousId), now);
  }
  let entry = lifecycleTabs.get(activeInfo.tabId);
  if (!entry) {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (!tab) return;
    entry = createLifecycleEntry(tab, now);
    lifecycleTabs.set(activeInfo.tabId, entry);
  }
  entry.lastActivatedAt = now;
  entry.activeStartedAt = now;
  activeTabByWindow.set(activeInfo.windowId, activeInfo.tabId);
  await persistLifecycleState();
}));

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => withLifecycleLock(async () => {
  const entry = lifecycleTabs.get(tabId) || createLifecycleEntry(tab);
  if (changeInfo.url || tab.url) entry.domain = getTabDomain(changeInfo.url || tab.url);
  entry.pinned = Boolean(tab.pinned);
  entry.audible = Boolean(tab.audible);
  lifecycleTabs.set(tabId, entry);
  await persistLifecycleState();
}));

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => withLifecycleLock(async () => {
  const now = Date.now();
  const entry = lifecycleTabs.get(tabId);
  await settleActiveEntry(entry, now);
  lifecycleTabs.delete(tabId);
  if (activeTabByWindow.get(removeInfo.windowId) === tabId) activeTabByWindow.delete(removeInfo.windowId);
  await persistLifecycleState();
}));

/**
 * 监听插件安装或更新事件。
 */
chrome.runtime.onInstalled.addListener((details) => {
  initializeContextMenus();
  setupAutoSyncAlarm();
  setupSessionSnapshotAlarm();
  setupScheduledSaveAlarm();

  if (details.reason === "install") {
    showNotification(
      "MyTabDesk 已安装",
      "右键点击任意页面或链接，即可快速保存到 MyTabDesk",
      "success"
    );
  }
});

/**
 * 监听浏览器启动事件。
 */
chrome.runtime.onStartup.addListener(() => {
  initializeContextMenus();
  setupAutoSyncAlarm();
  setupSessionSnapshotAlarm();
  setupScheduledSaveAlarm();
  captureSessionSnapshot("startup").catch((error) => {
    console.error("启动会话快照失败:", error);
  });
});

setupAutoSyncAlarm();
setupSessionSnapshotAlarm();
setupScheduledSaveAlarm();
initializeContextMenus();

/**
 * 监听右键菜单点击事件，分发给对应处理函数。
 */
chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleContextMenuClick(info, tab).catch((error) => {
    console.error("右键菜单处理失败:", error);
  });
});

chrome.commands.onCommand.addListener((command) => {
  (async () => {
    if (command === "open-mytabdesk") {
      openMyTabDesk();
      return;
    }
    if (command === "save-current-tab") {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      await saveCurrentTab(tabs[0]);
    }
  })().catch((error) => {
    console.error("快捷键操作失败:", error);
    showNotification("快捷键操作失败", error.message || "请稍后重试", "error");
  });
});

/**
 * 监听自动同步闹钟唤醒事件。
 */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SESSION_SNAPSHOT_ALARM_NAME) {
    captureSessionSnapshot("interval").catch((error) => {
      console.error("自动会话快照失败:", error);
    });
    return;
  }

  if (alarm.name === SCHEDULED_SAVE_ALARM_NAME) {
    executeScheduledSave().catch((error) => console.error("定时保存失败:", error));
    return;
  }

  if (alarm.name !== AUTO_SYNC_ALARM_NAME) {
    return;
  }

  notifyMyTabDeskAutoSync().catch((error) => {
    console.error("后台自动同步唤醒失败:", error);
  });
});

/**
 * 监听插件图标点击事件，并在新标签页打开 MyTabDesk 主界面。
 */
chrome.action.onClicked.addListener(() => {
  /** MyTabDesk 主界面的插件内 URL。 */
  const pageUrl = chrome.runtime.getURL("newtab.html");

  chrome.tabs.create({ url: pageUrl });
});
