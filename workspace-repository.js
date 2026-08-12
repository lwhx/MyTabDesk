(function (root) {
const DEFAULT_LOCK_NAME = "mytabdesk-storage-write";

function createWorkspaceRepository(options) {
  const storageArea = options.storageArea;
  const storageKey = options.storageKey;
  const lockName = options.lockName || DEFAULT_LOCK_NAME;
  const lockManager = options.lockManager || null;
  let fallbackLockChain = Promise.resolve();

  function withLock(operation) {
    if (lockManager && typeof lockManager.request === "function") {
      return lockManager.request(lockName, operation);
    }
    const nextOperation = fallbackLockChain.then(operation, operation);
    fallbackLockChain = nextOperation.then(() => undefined, () => undefined);
    return nextOperation;
  }

  async function load() {
    const stored = await storageArea.get(storageKey);
    return stored[storageKey];
  }

  async function save(data) {
    await storageArea.set({ [storageKey]: data });
    return data;
  }

  async function update(operation) {
    return withLock(async () => {
      const latestData = await load();
      const nextData = await operation(latestData);
      if (nextData == null) return nextData;
      return save(nextData);
    });
  }

  return { load, save, update, withLock };
}

const api = { createWorkspaceRepository };
root.MyTabDeskWorkspaceRepository = api;

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}
})(typeof globalThis !== "undefined" ? globalThis : this);
