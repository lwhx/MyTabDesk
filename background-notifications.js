(function (root) {
function createNotificationService(chromeApi) {
  function showNotification(title, message, type = "info") {
    const configs = {
      success: { priority: 1 },
      error: { priority: 2 },
      warning: { priority: 1 },
      info: { priority: 1 }
    };
    const config = configs[type] || configs.info;
    chromeApi.notifications.create(
      `mytabdesk-${Date.now()}`,
      {
        type: "basic",
        iconUrl: chromeApi.runtime.getURL("assets/icon48.png"),
        title,
        message,
        priority: config.priority
      },
      (notificationId) => {
        setTimeout(() => {
          chromeApi.notifications.clear(notificationId, () => {});
        }, 5000);
      }
    );
  }

  return { showNotification };
}

const api = { createNotificationService };
root.MyTabDeskBackgroundNotifications = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
