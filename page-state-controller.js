(function (root) {
function cloneValue(value) {
  if (typeof value === "function") return value;
  if (value instanceof Set) return new Set(Array.from(value, cloneValue));
  if (value instanceof Map) {
    return new Map(Array.from(value.entries(), ([key, item]) => [cloneValue(key), cloneValue(item)]));
  }
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }
  return value;
}

function createPageStateController(options) {
  const store = options.store;
  const eventBus = options.eventBus;
  const persist = options.persist;

  async function commitWorkspaceChange(mutator, metadata = {}) {
    const snapshot = cloneValue(store.getState());
    store.updateState(mutator, { ...metadata, phase: "pending" });
    try {
      await persist(metadata);
    } catch (error) {
      store.replaceState(snapshot, { ...metadata, phase: "rollback" });
      eventBus.emit("workspace:operation-failed", { ...metadata, error });
      throw error;
    }
    eventBus.emit("workspace:committed", metadata);
    return store.getState();
  }

  function replaceWorkspaceData(data, metadata = {}) {
    store.updateState((state) => {
      state.data = data;
    }, metadata);
    eventBus.emit("workspace:replaced", metadata);
    return store.getState();
  }

  function navigate(viewMode, metadata = {}) {
    const previousViewMode = store.getState().viewMode;
    store.updateState((state) => {
      state.viewMode = viewMode;
      state.createSpaceMenuOpen = false;
    }, { ...metadata, type: "view/changed" });
    if (previousViewMode !== viewMode) {
      eventBus.emit("view:changed", {
        viewMode,
        previousViewMode,
        source: metadata.source || "unknown"
      });
    }
    return store.getState();
  }

  return { commitWorkspaceChange, replaceWorkspaceData, navigate };
}

const api = { createPageStateController };
root.MyTabDeskPageStateController = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
