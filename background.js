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
 * 待保存的链接或页面信息，用于在后台和 MyTabDesk 主页面之间传递一次性保存数据。
 *
 * @type {object|null}
 */
let pendingSaveData = null;

/**
 * 从持久化存储中加载待保存数据。
 * Service Worker 重启后会调用此函数恢复数据。
 *
 * @returns {Promise<void>}
 */
async function loadPendingSaveData() {
  try {
    const result = await chrome.storage.local.get(PENDING_SAVE_KEY);
    if (result && result[PENDING_SAVE_KEY]) {
      pendingSaveData = result[PENDING_SAVE_KEY];
      // 加载后清除存储中的数据，避免重复消费
      await chrome.storage.local.remove(PENDING_SAVE_KEY);
    }
  } catch (error) {
    console.error("加载待保存数据失败:", error);
  }
}

/**
 * 将待保存数据持久化到存储中，防止 Service Worker 重启后丢失。
 *
 * @param {object} data 待保存的数据。
 * @returns {Promise<void>}
 */
async function persistPendingSaveData(data) {
  try {
    await chrome.storage.local.set({ [PENDING_SAVE_KEY]: data });
  } catch (error) {
    console.error("持久化待保存数据失败:", error);
  }
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

  pendingSaveData = data;
  await persistPendingSaveData(data);
  notifyMyTabDeskPage("link-saved");
  showNotification(
    "链接已保存",
    `已将「${title || url}」保存到 MyTabDesk`,
    "success"
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

  pendingSaveData = data;
  await persistPendingSaveData(data);
  notifyMyTabDeskPage("page-saved");
  showNotification(
    "页面已保存",
    `已将「${title || url}」保存到 MyTabDesk`,
    "success"
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

  pendingSaveData = data;
  await persistPendingSaveData(data);
  notifyMyTabDeskPage("tab-saved");
  showNotification("标签页已保存", `已将「${tab.title || tab.url}」保存到 MyTabDesk`, "success");
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
 * 通知指定标签页并兼容不同浏览器对扩展消息 API 的返回值实现。
 *
 * @param {number} tabId 标签页 ID。
 * @param {object} message 消息内容。
 * @returns {void}
 */
function sendMessageToTab(tabId, message) {
  if (!tabId) {
    return;
  }

  try {
    chrome.tabs.sendMessage(tabId, message, () => {
      if (chrome.runtime.lastError) {
        return;
      }
    });
  } catch (error) {
    return;
  }
}

/**
 * 通知已打开的 MyTabDesk 页面有新数据。
 *
 * @param {string} eventType 事件类型。
 * @returns {Promise<void>}
 */
async function notifyMyTabDeskPage(eventType) {
  /** 当前待通知的保存数据快照。 */
  const notificationData = pendingSaveData;

  const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL("newtab.html") });
  for (const tab of tabs) {
    sendMessageToTab(tab.id, {
      type: eventType,
      data: notificationData
    });
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
 * 获取待保存的数据，并在读取后清空暂存值。
 * 如果内存中没有数据，会尝试从持久化存储中恢复。
 *
 * @returns {Promise<object|null>} 待保存的数据。
 */
async function getPendingSaveData() {
  // 如果内存中没有数据，尝试从持久化存储中恢复
  if (!pendingSaveData) {
    await loadPendingSaveData();
  }

  /** 当前待保存的数据。 */
  const data = pendingSaveData;

  pendingSaveData = null;
  // 同时清除持久化存储中的数据
  try {
    await chrome.storage.local.remove(PENDING_SAVE_KEY);
  } catch (error) {
    console.error("清除持久化待保存数据失败:", error);
  }

  return data;
}

/**
 * 监听来自扩展页面的消息。
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "get-pending-save") {
    // 返回 Promise 以支持异步的 getPendingSaveData
    getPendingSaveData().then((data) => {
      sendResponse({ data });
    });
    return true; // 表示异步响应
  }

  if (message.type === "show-notification") {
    showNotification(message.title, message.message, message.notificationType);
    sendResponse({ success: true });
    return true;
  }
});

/**
 * 监听插件安装或更新事件。
 */
chrome.runtime.onInstalled.addListener((details) => {
  initializeContextMenus();

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
});

initializeContextMenus();

/**
 * 监听插件图标点击事件，并在新标签页打开 MyTabDesk 主界面。
 */
chrome.action.onClicked.addListener(() => {
  /** MyTabDesk 主界面的插件内 URL。 */
  const pageUrl = chrome.runtime.getURL("newtab.html");

  chrome.tabs.create({ url: pageUrl });
});
