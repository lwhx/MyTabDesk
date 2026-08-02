(function (root, factory) {
  const createFaviconCache = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = { createFaviconCache };
  }
  if (root && root.chrome && root.chrome.storage && root.chrome.storage.local) {
    root.MyTabDeskFaviconCache = createFaviconCache({
      storageArea: root.chrome.storage.local,
      fetch: root.fetch && root.fetch.bind(root),
      FileReader: root.FileReader,
      AbortController: root.AbortController,
      setTimeout: root.setTimeout.bind(root),
      clearTimeout: root.clearTimeout.bind(root)
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_KEY = "mytabdesk_favicon_cache";
  const FETCH_TIMEOUT_MS = 8000;
  const MAX_ICON_BYTES = 100 * 1024;
  const MAX_CACHE_ENTRIES = 500;
  const BATCH_CONCURRENCY = 5;

  function normalizeEntry(value) {
    if (!value || typeof value !== "object") return null;
    if (typeof value.dataUrl !== "string" || !value.dataUrl.startsWith("data:image/")) return null;
    return {
      dataUrl: value.dataUrl,
      updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
      lastUsedAt: Number.isFinite(value.lastUsedAt) ? value.lastUsedAt : 0,
      byteSize: Number.isFinite(value.byteSize) && value.byteSize >= 0 ? value.byteSize : 0
    };
  }

  function normalizeCache(value) {
    const normalized = new Map();
    if (!value || typeof value !== "object" || Array.isArray(value)) return normalized;
    for (const [iconUrl, entryValue] of Object.entries(value)) {
      if (typeof iconUrl !== "string" || !iconUrl) continue;
      const entry = normalizeEntry(entryValue);
      if (entry) normalized.set(iconUrl, entry);
    }
    return normalized;
  }

  function mapToObject(cache) {
    return Object.fromEntries(cache.entries());
  }

  function readBlobAsDataUrl(blob, FileReaderImpl) {
    return new Promise((resolve, reject) => {
      const reader = new FileReaderImpl();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => reject(reader.error || new Error("图标读取失败"));
      reader.readAsDataURL(blob);
    });
  }

  function getErrorMessage(error) {
    if (error && error.name === "AbortError") return "图标请求超时";
    if (error && typeof error.message === "string" && error.message) return error.message;
    return "图标缓存失败";
  }

  function createFaviconCache(options) {
    const dependencies = options || {};
    const storageArea = dependencies.storageArea;
    const fetchImpl = dependencies.fetch;
    const FileReaderImpl = dependencies.FileReader;
    const AbortControllerImpl = dependencies.AbortController;
    const setTimer = dependencies.setTimeout;
    const clearTimer = dependencies.clearTimeout;
    const now = dependencies.now || Date.now;
    let cache = new Map();
    let loaded = false;
    let loading = null;
    let pendingWrite = Promise.resolve();

    async function loadCache() {
      if (!loading) {
        loading = storageArea.get(STORAGE_KEY).then((stored) => {
          cache = normalizeCache(stored && stored[STORAGE_KEY]);
          loaded = true;
          return new Map(cache);
        }).finally(() => {
          loading = null;
        });
      }
      return loading;
    }

    async function ensureLoaded() {
      if (!loaded) await loadCache();
    }

    function getCachedIcon(iconUrl) {
      if (typeof iconUrl !== "string" || !iconUrl) return "";
      const entry = cache.get(iconUrl);
      if (!entry) return "";
      entry.lastUsedAt = now();
      saveCache().catch(() => {});
      return entry.dataUrl;
    }

    function trimCache() {
      if (cache.size <= MAX_CACHE_ENTRIES) return;
      const oldest = [...cache.entries()]
        .sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt)
        .slice(0, cache.size - MAX_CACHE_ENTRIES);
      for (const [iconUrl] of oldest) cache.delete(iconUrl);
    }

    async function saveCache() {
      const value = mapToObject(cache);
      pendingWrite = pendingWrite
        .catch(() => {})
        .then(() => storageArea.set({ [STORAGE_KEY]: value }));
      await pendingWrite;
    }

    async function fetchIconBlob(iconUrl, signal, requestOptions) {
      const response = await fetchImpl(iconUrl, {
        ...requestOptions,
        signal,
        credentials: "omit",
        redirect: "follow"
      });
      if (!response || !response.ok) {
        throw new Error(`图标请求失败${response && response.status ? ` (${response.status})` : ""}`);
      }
      const contentType = response.headers && response.headers.get("content-type") || "";
      if (!contentType.toLowerCase().startsWith("image/")) throw new Error("响应不是 image 类型");
      const blob = await response.blob();
      if (!blob || blob.size > MAX_ICON_BYTES) throw new Error("单个图标不能超过 100KB");
      if (blob.type && !blob.type.toLowerCase().startsWith("image/")) throw new Error("响应不是 image 类型");
      return blob;
    }

    async function cacheIcon(iconUrl, requestOptions = {}) {
      if (typeof iconUrl !== "string" || !iconUrl) {
        return { success: false, error: "缺少 favicon URL" };
      }
      try {
        await ensureLoaded();
        const controller = new AbortControllerImpl();
        const timer = setTimer(() => controller.abort(), FETCH_TIMEOUT_MS);
        let blob;
        try {
          blob = await fetchIconBlob(iconUrl, controller.signal, requestOptions);
        } finally {
          clearTimer(timer);
        }
        const dataUrl = await readBlobAsDataUrl(blob, FileReaderImpl);
        if (!dataUrl.startsWith("data:image/")) throw new Error("图标转换失败");
        const timestamp = now();
        cache.set(iconUrl, {
          dataUrl,
          updatedAt: timestamp,
          lastUsedAt: timestamp,
          byteSize: blob.size
        });
        trimCache();
        await saveCache();
        return { success: true, dataUrl };
      } catch (error) {
        return { success: false, error: getErrorMessage(error) };
      }
    }

    async function cacheLinks(links, options = {}) {
      const targets = (Array.isArray(links) ? links : [])
        .filter((link) => link && !link.deletedAt && typeof link.favIconUrl === "string" && link.favIconUrl)
        .map((link) => link.favIconUrl);
      const summary = { total: targets.length, succeeded: 0, failed: 0 };
      const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
      const requestedConcurrency = Number.isInteger(options.concurrency) && options.concurrency > 0
        ? options.concurrency
        : BATCH_CONCURRENCY;
      let nextIndex = 0;

      async function worker() {
        while (nextIndex < targets.length) {
          const targetIndex = nextIndex;
          nextIndex += 1;
          const result = await cacheIcon(targets[targetIndex]);
          if (result.success) summary.succeeded += 1;
          else summary.failed += 1;
          if (onProgress) {
            try {
              onProgress({
                completed: summary.succeeded + summary.failed,
                ...summary,
                success: result.success
              });
            } catch {
              // Progress reporting must not interrupt favicon caching.
            }
          }
        }
      }

      const workerCount = Math.min(BATCH_CONCURRENCY, requestedConcurrency, targets.length);
      await Promise.all(Array.from({ length: workerCount }, worker));
      return summary;
    }

    async function clearCache() {
      cache = new Map();
      loaded = true;
      await pendingWrite;
      await storageArea.remove(STORAGE_KEY);
    }

    function resolveFaviconSource(remoteUrl) {
      return getCachedIcon(remoteUrl) || (typeof remoteUrl === "string" ? remoteUrl : "");
    }

    return {
      loadCache,
      getCachedIcon,
      cacheIcon,
      cacheLinks,
      clearCache,
      resolveFaviconSource
    };
  }

  return createFaviconCache;
});
