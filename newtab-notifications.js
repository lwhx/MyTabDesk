(function (root) {
/**
 * 通知类型枚举
 * @readonly
 * @enum {string}
 */
const NotificationType = {
  SUCCESS: "success",
  ERROR: "error",
  WARNING: "warning",
  INFO: "info"
};

/**
 * 通知配置
 */
const NotificationConfig = {
  [NotificationType.SUCCESS]: { duration: 3000, priority: 1 },
  [NotificationType.ERROR]: { duration: 5000, priority: 2 },
  [NotificationType.WARNING]: { duration: 4000, priority: 1 },
  [NotificationType.INFO]: { duration: 3000, priority: 1 }
};

/**
 * 通过后台脚本显示系统通知
 *
 * @param {string} title - 通知标题
 * @param {string} message - 通知内容
 * @param {NotificationType} type - 通知类型
 * @returns {Promise<void>}
 */
async function showSystemNotification(title, message, type = NotificationType.INFO) {
  try {
    if (typeof chrome !== "undefined" && chrome.runtime) {
      chrome.runtime.sendMessage({
        type: "show-notification",
        title: title,
        message: message,
        notificationType: type
      });
    }
  } catch (error) {
    console.warn("无法显示系统通知：", error);
  }
}

/**
 * 显示应用内通知提示
 *
 * @param {string} message - 提示文本
 * @param {string} type - 提示类型：success | error | warning | info
 * @param {number} duration - 显示时长（毫秒）
 */
function showInAppToast(message, type = "info", duration = 3000) {
  // 创建通知容器
  let container = document.getElementById("toast-container");

  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 99999;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
    `;
    document.body.appendChild(container);
  }

  // 创建通知元素
  const toast = document.createElement("div");
  toast.style.cssText = `
    background: ${getToastBackground(type)};
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    font-size: 14px;
    max-width: 300px;
    animation: slideIn 0.3s ease;
    pointer-events: auto;
  `;
  /** 通知内容布局元素。 */
  const toastContent = document.createElement("div");
  toastContent.style.cssText = "display: flex; align-items: center; gap: 8px;";
  /** 通知图标元素。 */
  const toastIcon = document.createElement("span");
  toastIcon.textContent = getToastIcon(type);
  /** 通知文本元素。 */
  const toastMessage = document.createElement("span");
  toastMessage.textContent = message;
  toastContent.append(toastIcon, toastMessage);
  toast.appendChild(toastContent);

  container.appendChild(toast);

  // 自动移除
  setTimeout(() => {
    toast.style.animation = "slideOut 0.3s ease";
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, duration);
}

/**
 * 获取通知的背景色
 *
 * @param {string} type - 通知类型
 * @returns {string} CSS 颜色值
 */
function getToastBackground(type) {
  const backgrounds = {
    success: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
    error: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
    warning: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
    info: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)"
  };
  return backgrounds[type] || backgrounds.info;
}

/**
 * 获取通知图标
 *
 * @param {string} type - 通知类型
 * @returns {string} 图标字符
 */
function getToastIcon(type) {
  const icons = {
    success: "✓",
    error: "✕",
    warning: "⚠",
    info: "ℹ"
  };
  return icons[type] || icons.info;
}

/**
 * 显示统一通知（同时显示应用内提示和系统通知）
 *
 * @param {string} title - 通知标题（用于系统通知）
 * @param {string} message - 通知内容
 * @param {string} type - 通知类型
 */
function notify(title, message, type = NotificationType.INFO) {
  // 显示应用内 Toast
  showInAppToast(message, type);

  // 显示系统通知（静默模式，不打扰用户）
  if (type === NotificationType.SUCCESS || type === NotificationType.ERROR) {
    showSystemNotification(title, message, type);
  }
}

/**
 * 显示成功通知
 *
 * @param {string} title - 通知标题
 * @param {string} message - 通知内容
 */
function notifySuccess(title, message) {
  notify(title, message, NotificationType.SUCCESS);
}

/**
 * 显示错误通知
 *
 * @param {string} title - 通知标题
 * @param {string} message - 通知内容
 */
function notifyError(title, message) {
  notify(title, message, NotificationType.ERROR);
}

/**
 * 显示警告通知
 *
 * @param {string} title - 通知标题
 * @param {string} message - 通知内容
 */
function notifyWarning(title, message) {
  notify(title, message, NotificationType.WARNING);
}

/**
 * 显示信息通知
 *
 * @param {string} title - 通知标题
 * @param {string} message - 通知内容
 */
function notifyInfo(title, message) {
  notify(title, message, NotificationType.INFO);
}

/**
 * 初始化消息监听，接收来自 background.js 的保存通知
 */
function initializeMessageListener() {
  if (typeof chrome === "undefined" || !chrome.runtime) {
    return;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "link-saved" || message.type === "page-saved" || message.type === "tab-saved") {
      // runtime 消息会广播给所有已打开的扩展页面。统一向后台原子消费 pending 数据，
      // 只有第一个页面能取得记录，避免多页面同时用不同 ID 保存出重复链接。
      checkPendingSaveData().catch((error) => {
        console.error("处理右键保存数据失败：", error);
      });
      sendResponse({ success: true });
      return true;
    }

    if (message.type === "run-auto-sync") {
      // 后台 alarms 唤醒：页面打开期间由 Service Worker 触发的定时同步。
      runLeasedAutoSync().catch((error) => {
        console.error("后台唤醒自动同步失败：", error);
      });
      sendResponse({ success: true });
      return true;
    }
  });
}

/**
 * 申请后台租约后执行一次自动同步，确保多个工作台页面中只有一个运行。
 *
 * @returns {Promise<boolean>} 实际取得租约并执行时返回 true。
 */
async function runLeasedAutoSync() {
  if (!root.MyTabDeskSync || typeof root.MyTabDeskSync.runAutoSyncNow !== "function") {
    return false;
  }

  const lease = await chrome.runtime.sendMessage({ type: "claim-auto-sync" });
  if (!lease || !lease.claimed) {
    return false;
  }

  try {
    await root.MyTabDeskSync.runAutoSyncNow();
    return true;
  } finally {
    await chrome.runtime.sendMessage({
      type: "release-auto-sync",
      leaseId: lease.leaseId
    });
  }
}

/**
 * 检查并处理待保存数据。仅在页面初始化、state.data 就绪后由 main.js 调用，
 * 避免在 state.data 为 null 时消费并丢失 background 暂存的保存数据。
 */
async function checkPendingSaveData() {
  if (typeof chrome === "undefined" || !chrome.runtime) {
    return;
  }

  try {
    while (true) {
      const response = await chrome.runtime.sendMessage({ type: "claim-pending-save" });
      if (!response || !response.data) {
        return;
      }

      const data = response.data;
      try {
        await handleExternalSaveData(data);
        const ack = await chrome.runtime.sendMessage({
          type: "ack-pending-save",
          requestId: data.requestId
        });
        if (!ack || ack.success !== true) {
          throw new Error("确认保存请求失败，已保留请求供重试");
        }
      } catch (error) {
        await chrome.runtime.sendMessage({
          type: "release-pending-save",
          requestId: data.requestId
        });
        throw error;
      }
    }
  } catch (error) {
    console.error("待保存请求处理失败：", error);
    throw error;
  }
}

/**
 * 检查并消费后台自动同步唤醒标记。
 *
 * 后台 alarms 触发时如果没有扩展页面打开，会留下一个待处理标记。
 * 页面启动时消费该标记，触发一次补同步。
 */
async function checkPendingAutoSyncWake() {
  if (typeof chrome === "undefined" || !chrome.runtime) {
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({ type: "consume-auto-sync-wake" });
    if (response && response.pendingAt > 0) {
      await runLeasedAutoSync();
    }
  } catch {
    // 静默处理
  }
}

/**
 * 处理从外部保存的数据
 *
 * @param {Object} data - 保存的数据
 */
async function handleExternalSaveData(data) {
  if (!data || !data.url) {
    return;
  }

  // 数据未就绪时必须让 claim 失败并 release，不能返回后被外层误 ack。
  if (!root.MyTabDeskPage.state.data) {
    throw new Error("工作台页面尚未初始化完成");
  }

  // 获取当前激活空间
  const activeSpace = root.MyTabDeskUtils.getActiveSpace();
  if (!activeSpace) {
    showInAppToast("请先创建一个分组后再使用右键保存", "warning");
    throw new Error("当前没有可用空间");
  }

  const targetGroup = Array.isArray(activeSpace.groups) ? activeSpace.groups.find((group) => !group.deletedAt) : null;

  // 显示保存提示
  showInAppToast(`正在将「${data.title}」保存到第一个分组...`, "info");

  // 使用 actions 模块添加链接
  if (root.MyTabDeskActions && typeof root.MyTabDeskActions.addExternalLink === "function") {
    await root.MyTabDeskActions.addExternalLink(data);
    showInAppToast(`已将「${data.title}」保存到「${targetGroup ? targetGroup.name : "收集箱"}」`, "success");
  }
}

// 添加 CSS 动画
const style = document.createElement("style");
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);

// 导出模块
root.MyTabDeskNotifications = {
  NotificationType,
  NotificationConfig,
  showSystemNotification,
  showInAppToast,
  notify,
  notifySuccess,
  notifyError,
  notifyWarning,
  notifyInfo,
  initializeMessageListener,
  runLeasedAutoSync,
  checkPendingSaveData,
  checkPendingAutoSyncWake
};

// 仅自动注册消息监听器（轻量、无副作用）；待保存数据的消费由 main.js 在 init 完成、
// state.data 就绪后显式调用 checkPendingSaveData，避免在数据未就绪时消费丢失。
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeMessageListener);
} else {
  initializeMessageListener();
}

})(globalThis);