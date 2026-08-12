(function (root) {
const protocol = root.MyTabDeskMessageProtocol || (
  typeof require === "function" ? require("./message-protocol.js") : null
);

function createMessageRouter(options = {}) {
  const handlers = options.handlers || {};

  async function dispatch(message, sender) {
    const request = protocol.normalizeRequest(message);
    const handler = handlers[request.type];
    if (typeof handler !== "function") {
      return protocol.createErrorResponse(
        "MESSAGE_TYPE_NOT_SUPPORTED",
        `不支持的消息类型：${request.type || "空"}`,
        request
      );
    }
    try {
      const data = await handler(request.payload, sender, request);
      return protocol.createSuccessResponse(data, request);
    } catch (error) {
      return protocol.createErrorResponse(
        error && error.code || "MESSAGE_HANDLER_FAILED",
        error && error.message || "消息处理失败",
        request
      );
    }
  }

  function listener(message, sender, sendResponse) {
    dispatch(message, sender).then(sendResponse);
    return true;
  }

  return { dispatch, listener };
}

const api = { createMessageRouter };
root.MyTabDeskBackgroundMessageRouter = api;

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}
})(typeof globalThis !== "undefined" ? globalThis : this);
