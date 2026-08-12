(function (root) {
const PROTOCOL_VERSION = 1;

function createRequest(type, payload = {}, requestId = "") {
  const normalizedPayload = payload && typeof payload === "object" ? payload : {};
  return {
    type,
    version: PROTOCOL_VERSION,
    requestId: requestId || `request-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    payload: normalizedPayload,
    ...normalizedPayload
  };
}

function normalizeRequest(message) {
  const source = message && typeof message === "object" ? message : {};
  if (source.payload && typeof source.payload === "object") {
    return {
      type: source.type || "",
      version: Number(source.version || PROTOCOL_VERSION),
      requestId: source.requestId || "",
      payload: source.payload
    };
  }
  const payload = { ...source };
  delete payload.type;
  delete payload.version;
  return {
    type: source.type || "",
    version: Number(source.version || PROTOCOL_VERSION),
    requestId: "",
    payload
  };
}

function createSuccessResponse(data = {}, request = {}) {
  const normalizedData = data && typeof data === "object" ? data : { value: data };
  return {
    ok: true,
    version: PROTOCOL_VERSION,
    requestId: request.requestId || "",
    data: normalizedData,
    ...normalizedData
  };
}

function createErrorResponse(code, message, request = {}, details = null) {
  const error = { code, message };
  if (details != null) error.details = details;
  return {
    ok: false,
    success: false,
    version: PROTOCOL_VERSION,
    requestId: request.requestId || "",
    data: null,
    error
  };
}

const api = {
  PROTOCOL_VERSION,
  createRequest,
  normalizeRequest,
  createSuccessResponse,
  createErrorResponse
};
root.MyTabDeskMessageProtocol = api;

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}
})(typeof globalThis !== "undefined" ? globalThis : this);
