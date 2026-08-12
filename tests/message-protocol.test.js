const assert = require("node:assert/strict");
const {
  createRequest,
  normalizeRequest,
  createSuccessResponse,
  createErrorResponse
} = require("../message-protocol.js");
const { createMessageRouter } = require("../background-message-router.js");

function testCreatesVersionedCompatibleRequest() {
  const request = createRequest("session.list", { limit: 20 }, "request-fixed");
  assert.equal(request.type, "session.list");
  assert.equal(request.version, 1);
  assert.equal(request.requestId, "request-fixed");
  assert.deepEqual(request.payload, { limit: 20 });
  assert.equal(request.limit, 20);
}

function testNormalizesLegacyAndVersionedRequests() {
  assert.deepEqual(normalizeRequest({ type: "legacy", value: 1 }).payload, { value: 1 });
  assert.deepEqual(
    normalizeRequest({ type: "modern", version: 1, requestId: "r1", payload: { value: 2 } }),
    { type: "modern", version: 1, requestId: "r1", payload: { value: 2 } }
  );
}

function testCreatesCompatibleResponseEnvelope() {
  const success = createSuccessResponse({ success: true, count: 2 }, { requestId: "r1" });
  assert.deepEqual(success.data, { success: true, count: 2 });
  assert.equal(success.ok, true);
  assert.equal(success.success, true);
  assert.equal(success.count, 2);

  const failure = createErrorResponse("INVALID_REQUEST", "请求无效", { requestId: "r2" });
  assert.equal(failure.ok, false);
  assert.equal(failure.success, false);
  assert.equal(failure.error.code, "INVALID_REQUEST");
  assert.equal(failure.error.message, "请求无效");
}

async function testRouterUsesUnifiedEnvelopeAndErrorCodes() {
  const router = createMessageRouter({
    handlers: {
      "session.list": async (payload) => ({ snapshots: [], limit: payload.limit })
    }
  });
  const success = await router.dispatch(createRequest("session.list", { limit: 30 }, "r3"));
  assert.equal(success.ok, true);
  assert.equal(success.requestId, "r3");
  assert.equal(success.limit, 30);

  const unknown = await router.dispatch(createRequest("unknown", {}, "r4"));
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, "MESSAGE_TYPE_NOT_SUPPORTED");
}

async function runTests() {
  testCreatesVersionedCompatibleRequest();
  testNormalizesLegacyAndVersionedRequests();
  testCreatesCompatibleResponseEnvelope();
  await testRouterUsesUnifiedEnvelopeAndErrorCodes();
  console.log("消息协议测试通过");
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
