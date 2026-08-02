const assert = require("node:assert/strict");
const path = require("node:path");

const modulePath = path.resolve(__dirname, "..", "newtab-favicon-cache.js");

class MockFileReader {
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buffer) => {
      const type = blob.type || "application/octet-stream";
      this.result = `data:${type};base64,${Buffer.from(buffer).toString("base64")}`;
      if (this.onload) this.onload();
    }, (error) => {
      this.error = error;
      if (this.onerror) this.onerror();
    });
  }
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createStorage(initialCache) {
  const values = initialCache === undefined ? {} : {
    mytabdesk_favicon_cache: clone(initialCache)
  };
  return {
    values,
    area: {
      async get(key) {
        return { [key]: clone(values[key]) };
      },
      async set(update) {
        Object.assign(values, clone(update));
      },
      async remove(key) {
        delete values[key];
      }
    }
  };
}

function createResponse({ type = "image/png", size = 8, ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type" ? type : null;
      }
    },
    async blob() {
      return new Blob([Buffer.alloc(size)], { type });
    }
  };
}

function createCache(options = {}) {
  const { createFaviconCache } = require(modulePath);
  const storage = options.storage || createStorage(options.initialCache);
  let now = options.now || 1000;
  const cache = createFaviconCache({
    storageArea: storage.area,
    fetch: options.fetch || (async () => createResponse()),
    FileReader: MockFileReader,
    AbortController,
    setTimeout,
    clearTimeout,
    now: () => now++
  });
  return { cache, storage };
}

async function testCacheHitAndResolution() {
  const iconUrl = "https://cdn.example/icon.png";
  const dataUrl = "data:image/png;base64,AQID";
  const { cache } = createCache({
    initialCache: {
      [iconUrl]: { dataUrl, updatedAt: 10, lastUsedAt: 20, byteSize: 3 }
    }
  });

  const loaded = await cache.loadCache();

  assert.equal(loaded instanceof Map, true);
  assert.equal(cache.getCachedIcon(iconUrl), dataUrl);
  assert.equal(cache.resolveFaviconSource(iconUrl), dataUrl);
  assert.equal(cache.resolveFaviconSource("https://cdn.example/missing.png"), "https://cdn.example/missing.png");
}

async function testRejectsNonImageMime() {
  const iconUrl = "https://cdn.example/not-image";
  const { cache, storage } = createCache({
    fetch: async () => createResponse({ type: "text/html" })
  });

  const result = await cache.cacheIcon(iconUrl);

  assert.equal(result.success, false);
  assert.match(result.error, /image/i);
  assert.deepEqual(storage.values.mytabdesk_favicon_cache || {}, {});
}

async function testRejectsIconsOver100Kb() {
  const iconUrl = "https://cdn.example/too-large.png";
  const { cache, storage } = createCache({
    fetch: async () => createResponse({ size: 100 * 1024 + 1 })
  });

  const result = await cache.cacheIcon(iconUrl);

  assert.equal(result.success, false);
  assert.match(result.error, /100\s*KB/i);
  assert.deepEqual(storage.values.mytabdesk_favicon_cache || {}, {});
}

async function testTrimsLeastRecentlyUsedEntryAt500Items() {
  const initialCache = {};
  for (let index = 0; index < 500; index += 1) {
    initialCache[`https://icons.example/${index}.png`] = {
      dataUrl: "data:image/png;base64,AQ==",
      updatedAt: index + 1,
      lastUsedAt: index + 1,
      byteSize: 1
    };
  }
  const { cache, storage } = createCache({ initialCache });

  const result = await cache.cacheIcon("https://icons.example/new.png");
  const saved = storage.values.mytabdesk_favicon_cache;

  assert.equal(result.success, true);
  assert.equal(Object.keys(saved).length, 500);
  assert.equal(saved["https://icons.example/0.png"], undefined);
  assert.ok(saved["https://icons.example/new.png"]);
}

async function testBatchUsesFiveWorkersAndReportsResults() {
  let activeFetches = 0;
  let peakFetches = 0;
  const progress = [];
  const links = Array.from({ length: 8 }, (_, index) => ({
    url: `https://pages.example/${index}`,
    favIconUrl: `https://icons.example/batch-${index}.png`
  }));
  links.push({ url: "https://pages.example/deleted", favIconUrl: "https://icons.example/deleted.png", deletedAt: 1 });
  links.push({ url: "https://pages.example/no-icon" });

  const { cache, storage } = createCache({
    fetch: async (url) => {
      activeFetches += 1;
      peakFetches = Math.max(peakFetches, activeFetches);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeFetches -= 1;
      if (url.endsWith("batch-6.png")) throw new Error("network unavailable");
      if (url.endsWith("batch-7.png")) return createResponse({ type: "text/plain" });
      return createResponse();
    }
  });

  const result = await cache.cacheLinks(links, {
    concurrency: 99,
    onProgress(update) {
      progress.push(update);
    }
  });

  assert.deepEqual(result, { total: 8, succeeded: 6, failed: 2 });
  assert.equal(peakFetches, 5);
  assert.equal(progress.length, 8);
  assert.equal(progress.at(-1).completed, 8);
  assert.equal(storage.values.mytabdesk_favicon_cache[links[0].url], undefined);
  assert.equal(Object.keys(storage.values.mytabdesk_favicon_cache).length, 6);
}

async function testClearRemovesOnlyFaviconCache() {
  const storage = createStorage({
    "https://icons.example/a.png": {
      dataUrl: "data:image/png;base64,AQ==",
      updatedAt: 1,
      lastUsedAt: 1,
      byteSize: 1
    }
  });
  storage.values.mytabdesk_data = { spaces: ["keep"] };
  const { cache } = createCache({ storage });
  await cache.loadCache();

  await cache.clearCache();

  assert.equal(cache.getCachedIcon("https://icons.example/a.png"), "");
  assert.equal(storage.values.mytabdesk_favicon_cache, undefined);
  assert.deepEqual(storage.values.mytabdesk_data, { spaces: ["keep"] });
}

async function runTests() {
  await testCacheHitAndResolution();
  await testRejectsNonImageMime();
  await testRejectsIconsOver100Kb();
  await testTrimsLeastRecentlyUsedEntryAt500Items();
  await testBatchUsesFiveWorkersAndReportsResults();
  await testClearRemovesOnlyFaviconCache();
  console.log("图标缓存测试通过");
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
