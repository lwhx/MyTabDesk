/**
 * MyTabDesk 后台 Service Worker。
 *
 * 负责处理插件图标点击、右键菜单注册、右键菜单消息暂存和系统通知展示。
 */

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

/**
 * 自动同步闹钟唤醒间隔，单位为分钟。
 */
const AUTO_SYNC_PERIOD_MINUTES = 30;

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
 * 向所有已打开的 MyTabDesk 扩展页面发送消息。
 *
 * 扩展页面（newtab.html）监听的是 chrome.runtime.onMessage，
 * 因此必须使用 chrome.runtime.sendMessage 而非 chrome.tabs.sendMessage
 * （后者只能到达 content script，无法投递到扩展页面）。
 *
 * @param {object} message 消息内容。
 * @returns {void}
 */
function sendMessageToExtensionPages(message) {
  try {
    chrome.runtime.sendMessage(message);
  } catch (error) {
    console.warn("消息发送异常:", error);
  }
}

/**
 * 检查是否有已打开的 MyTabDesk 扩展页面。
 *
 * @returns {Promise<boolean>} 有扩展页面打开时返回 true。
 */
async function hasOpenExtensionPage() {
  const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL("newtab.html") });
  return tabs.length > 0;
}

/**
 * 通知已打开的 MyTabDesk 页面有新数据。
 *
 * @param {string} eventType 事件类型。
 * @returns {Promise<void>}
 */
async function notifyMyTabDeskPage(eventType) {
  sendMessageToExtensionPages({
    type: eventType
  });
}

/**
 * 设置后台自动同步闹钟，避免 MV3 Service Worker 休眠导致定时任务丢失。
 *
 * @returns {void}
 */
function setupAutoSyncAlarm() {
  chrome.alarms.clear(AUTO_SYNC_ALARM_NAME, () => {
    chrome.alarms.create(AUTO_SYNC_ALARM_NAME, {
      periodInMinutes: AUTO_SYNC_PERIOD_MINUTES
    });
  });
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
 * 显示 Chrome 系统通知。
 *
 * @param {string} title 通知标题。
 * @param {string} message 通知内容。
 * @param {string} type 通知类型，支持 success、error、warning、info。
 * @returns {void}
 */
function showNotification(title, message, type = "info") {
  /** 不同通知类型对应的 Chrome 通知配置。 */
  const configs = {
    success: { priority: 1 },
    error: { priority: 2 },
    warning: { priority: 1 },
    info: { priority: 1 }
  };
  /** 当前通知类型对应的配置。 */
  const config = configs[type] || configs.info;

  chrome.notifications.create(
    `mytabdesk-${Date.now()}`,
    {
      type: "basic",
      iconUrl: chrome.runtime.getURL("assets/icon48.png"),
      title: title,
      message: message,
      priority: config.priority
    },
    (notificationId) => {
      setTimeout(() => {
        chrome.notifications.clear(notificationId, () => {});
      }, 5000);
    }
  );
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

/**
 * 监听来自扩展页面的消息。
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "claim-pending-save" || message.type === "get-pending-save") {
    withPendingSaveLock(() => claimPendingSaveData()).then((data) => {
      sendResponse({ data });
    });
    return true;
  }

  if (message.type === "ack-pending-save") {
    withPendingSaveLock(() => ackPendingSaveData(message.requestId)).then((success) => {
      sendResponse({ success });
    }).catch((error) => {
      console.error("确认待保存请求失败:", error);
      sendResponse({ success: false });
    });
    return true;
  }

  if (message.type === "release-pending-save") {
    withPendingSaveLock(() => releasePendingSaveData(message.requestId)).then((success) => {
      sendResponse({ success });
    });
    return true;
  }

  if (message.type === "claim-auto-sync") {
    withAutoSyncLeaseLock(() => claimAutoSyncLease()).then(sendResponse).catch((error) => {
      console.error("申请自动同步租约失败:", error);
      sendResponse({ claimed: false });
    });
    return true;
  }

  if (message.type === "release-auto-sync") {
    withAutoSyncLeaseLock(() => releaseAutoSyncLease(message.leaseId)).then((success) => {
      sendResponse({ success });
    }).catch((error) => {
      console.error("释放自动同步租约失败:", error);
      sendResponse({ success: false });
    });
    return true;
  }

  if (message.type === "show-notification") {
    showNotification(message.title, message.message, message.notificationType);
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "consume-auto-sync-wake") {
    consumeAutoSyncWakeFlag().then((pendingAt) => {
      sendResponse({ pendingAt });
    });
    return true;
  }
});

/**
 * 监听插件安装或更新事件。
 */
chrome.runtime.onInstalled.addListener((details) => {
  initializeContextMenus();
  setupAutoSyncAlarm();

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
});

setupAutoSyncAlarm();
initializeContextMenus();

/**
 * 监听右键菜单点击事件，分发给对应处理函数。
 */
chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleContextMenuClick(info, tab).catch((error) => {
    console.error("右键菜单处理失败:", error);
  });
});

/**
 * 监听自动同步闹钟唤醒事件。
 */
chrome.alarms.onAlarm.addListener((alarm) => {
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
