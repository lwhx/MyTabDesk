(function (root) {
const app = root.MyTabDeskPage;
const { state } = app;

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
 * 队列管理，避免通知重叠
 */
const notificationQueue = {
  /** 当前正在显示的通知ID */
  currentId: null,
  /** 等待显示的通知队列 */
  pending: [],
  /** 处理间隔（毫秒） */
  interval: 100
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
 * HTML 转义，防止 XSS
 *
 * @param {string} text - 原始文本
 * @returns {string} 转义后的文本
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
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
      // 通知用户有新的保存数据
      if (message.data) {
        showInAppToast(`已从右键菜单保存「${message.data.title}」`, "success");
      }
      sendResponse({ success: true });
      return true;
    }

    // 处理获取待保存数据的请求
    if (message.type === "get-pending-save") {
      chrome.runtime.sendMessage({ type: "get-pending-save" }, (response) => {
        if (response && response.data) {
          handleExternalSaveData(response.data);
        }
      });
      sendResponse({ success: true });
      return true;
    }
  });

  // 页面加载时检查是否有待保存数据
  checkPendingSaveData();
}

/**
 * 检查并处理待保存数据
 */
async function checkPendingSaveData() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "get-pending-save" });
    if (response && response.data) {
      handleExternalSaveData(response.data);
    }
  } catch (error) {
    // 静默处理，页面可能没有权限
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

  // 获取当前激活空间
  const activeSpace = root.MyTabDeskUtils.getActiveSpace();
  if (!activeSpace) {
    showInAppToast("请先创建一个分组后再使用右键保存", "warning");
    return;
  }

  if (!activeSpace.groups || activeSpace.groups.length === 0) {
    showInAppToast("请先创建一个分组后再使用右键保存", "warning");
    return;
  }

  // 显示保存提示
  showInAppToast(`正在将「${data.title}」保存到第一个分组...`, "info");

  // 使用 actions 模块添加链接
  if (root.MyTabDeskActions && typeof root.MyTabDeskActions.addExternalLink === "function") {
    await root.MyTabDeskActions.addExternalLink(data);
    showInAppToast(`已将「${data.title}」保存到「${activeSpace.groups[0].name}」`, "success");
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
  initializeMessageListener
};

// 自动初始化
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeMessageListener);
} else {
  initializeMessageListener();
}

})(globalThis);