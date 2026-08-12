(function (root) {
function createPageMessagingService(chromeApi) {
  function sendMessageToExtensionPages(message) {
    try {
      chromeApi.runtime.sendMessage(message);
    } catch (error) {
      console.warn("消息发送异常:", error);
    }
  }

  async function hasOpenExtensionPage() {
    const tabs = await chromeApi.tabs.query({ url: chromeApi.runtime.getURL("newtab.html") });
    return tabs.length > 0;
  }

  async function notifyMyTabDeskPage(eventType) {
    sendMessageToExtensionPages({ type: eventType });
  }

  return { sendMessageToExtensionPages, hasOpenExtensionPage, notifyMyTabDeskPage };
}

const api = { createPageMessagingService };
root.MyTabDeskBackgroundPageMessaging = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
