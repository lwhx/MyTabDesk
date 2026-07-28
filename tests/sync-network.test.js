const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");

function loadNetwork(fetchImpl, delays) {
  const context = {
    console: { warn() {} },
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: fetchImpl
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(path.join(projectRoot, "newtab-sync-network.js"), "utf8"), context);
  return context.MyTabDeskSyncNetwork.create({
    fetchImpl,
    baseRetryDelay: 10,
    sleep: async (delay) => { delays.push(delay); }
  });
}

function response(status) {
  return { status, ok: status >= 200 && status < 300 };
}

async function testRetriesTransientHttpStatuses() {
  const delays = [];
  const responses = [response(429), response(503), response(200)];
  let attempts = 0;
  const network = loadNetwork(async () => {
    attempts += 1;
    return responses.shift();
  }, delays);

  const result = await network.fetchWithRetry("https://example.com", {}, 3);

  assert.equal(result.status, 200);
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [10, 20]);
}

async function testDoesNotRetryAuthenticationFailure() {
  const delays = [];
  let attempts = 0;
  const network = loadNetwork(async () => {
    attempts += 1;
    return response(401);
  }, delays);

  const result = await network.fetchWithRetry("https://example.com", {}, 3);

  assert.equal(result.status, 401);
  assert.equal(attempts, 1);
  assert.deepEqual(delays, []);
}

async function testRetriesNetworkFailure() {
  const delays = [];
  let attempts = 0;
  const network = loadNetwork(async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new TypeError("network down");
    }
    return response(200);
  }, delays);

  const result = await network.fetchWithRetry("https://example.com", {}, 2);

  assert.equal(result.status, 200);
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [10]);
}

async function testReturnsLastTransientResponseAfterRetryLimit() {
  const delays = [];
  let attempts = 0;
  const network = loadNetwork(async () => {
    attempts += 1;
    return response(503);
  }, delays);

  const result = await network.fetchWithRetry("https://example.com", {}, 2);

  assert.equal(result.status, 503);
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [10, 20]);
}

async function runTests() {
  await testRetriesTransientHttpStatuses();
  await testDoesNotRetryAuthenticationFailure();
  await testRetriesNetworkFailure();
  await testReturnsLastTransientResponseAfterRetryLimit();
  console.log("同步网络测试通过");
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
