const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");

function createHeaders(values = {}) {
  const normalized = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    get(name) {
      return normalized.get(String(name).toLowerCase()) || null;
    }
  };
}

function createResponse({ status = 200, json = {}, text = "", headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: createHeaders(headers),
    async json() { return json; },
    async text() { return text; }
  };
}

function createHarness(responses) {
  const requests = [];
  const oneShotRequests = [];
  const queue = [...responses];
  const context = { console };
  context.globalThis = context;

  vm.runInNewContext(fs.readFileSync(path.join(projectRoot, "newtab-sync-transport.js"), "utf8"), context);

  const transport = context.MyTabDeskSyncTransport.create({
    async fetchWithRetry(url, options) {
      requests.push({ url, options });
      if (queue.length === 0) {
        throw new Error("缺少测试响应");
      }
      return queue.shift();
    },
    async fetchWithTimeout(url, options) {
      oneShotRequests.push({ url, options });
      if (queue.length === 0) {
        throw new Error("缺少测试响应");
      }
      return queue.shift();
    },
    resolveSafeWebDavFileUrl(sync) {
      return `${sync.webdavUrl.replace(/\/$/, "")}/${sync.webdavFilename}`;
    },
    createBasicAuthHeader(username, password) {
      return `Basic ${username}:${password}`;
    },
    isMyTabDeskGist(gist, filename) {
      return Boolean(gist.files && gist.files[filename]);
    }
  });

  return { transport, requests, oneShotRequests };
}

async function testWebDavUploadUsesValidatedUrlAndBasicAuth() {
  const harness = createHarness([createResponse()]);
  await harness.transport.uploadWebDav({
    webdavUrl: "https://dav.example.com/base",
    webdavFilename: "desk.json",
    webdavUsername: "alice",
    webdavPassword: "secret"
  }, "payload");

  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].url, "https://dav.example.com/base/desk.json");
  assert.equal(harness.requests[0].options.method, "PUT");
  assert.equal(harness.requests[0].options.headers.Authorization, "Basic alice:secret");
  assert.equal(harness.requests[0].options.body, "payload");
}

async function testGistUploadFindsExistingGistBeforePatch() {
  const filename = "desk.json";
  const harness = createHarness([
    createResponse({ json: [{ id: "gist-1", files: { [filename]: {} } }] }),
    createResponse({ json: { id: "gist-1" } })
  ]);

  const gistId = await harness.transport.uploadGist({
    gistToken: "token",
    gistId: "",
    gistFilename: filename
  }, "payload");

  assert.equal(gistId, "gist-1");
  assert.equal(harness.requests[0].url, "https://api.github.com/gists?per_page=100");
  assert.equal(harness.requests[1].url, "https://api.github.com/gists/gist-1");
  assert.equal(harness.requests[1].options.method, "PATCH");
}

async function testGistCreatePostDoesNotUseGenericRetry() {
  const filename = "desk.json";
  const harness = createHarness([
    createResponse({ json: [] }),
    createResponse({ json: { id: "gist-new" } })
  ]);

  const gistId = await harness.transport.uploadGist({
    gistToken: "token",
    gistId: "",
    gistFilename: filename
  }, "payload");

  assert.equal(gistId, "gist-new");
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].options.method, "GET");
  assert.equal(harness.oneShotRequests.length, 1);
  assert.equal(harness.oneShotRequests[0].url, "https://api.github.com/gists");
  assert.equal(harness.oneShotRequests[0].options.method, "POST");
}

async function testGistDownloadReturnsConfiguredFileContent() {
  const harness = createHarness([
    createResponse({ json: { files: { "desk.json": { content: "backup" } } } })
  ]);

  const content = await harness.transport.downloadGist({
    gistToken: "token",
    gistId: "gist-2",
    gistFilename: "desk.json"
  });

  assert.equal(content, "backup");
}

async function testTransportSurfacesHttpFailure() {
  const harness = createHarness([createResponse({ status: 401 })]);

  await assert.rejects(
    () => harness.transport.downloadWebDav({
      webdavUrl: "https://dav.example.com",
      webdavFilename: "desk.json",
      webdavUsername: "alice",
      webdavPassword: "wrong"
    }),
    /WebDAV 下载失败：401/
  );
}

async function runTests() {
  await testWebDavUploadUsesValidatedUrlAndBasicAuth();
  await testGistUploadFindsExistingGistBeforePatch();
  await testGistCreatePostDoesNotUseGenericRetry();
  await testGistDownloadReturnsConfiguredFileContent();
  await testTransportSurfacesHttpFailure();
  console.log("同步传输测试通过");
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
