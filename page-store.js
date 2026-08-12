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

function replaceObject(target, source) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, cloneValue(source));
}

function createPageStore(initialState) {
  const initialSnapshot = cloneValue(initialState);
  const state = cloneValue(initialState);
  const subscriptions = new Set();

  function getState() {
    return state;
  }

  function notify(metadata) {
    for (const subscription of Array.from(subscriptions)) {
      const nextValue = subscription.selector(state);
      if (subscription.equals(nextValue, subscription.value)) continue;
      const previousValue = subscription.value;
      subscription.value = nextValue;
      subscription.listener(nextValue, previousValue, metadata);
    }
  }

  function updateState(updater, metadata = {}) {
    const snapshot = cloneValue(state);
    try {
      updater(state);
    } catch (error) {
      replaceObject(state, snapshot);
      throw error;
    }
    notify(metadata);
    return state;
  }

  function replaceState(nextState, metadata = {}) {
    replaceObject(state, nextState);
    notify(metadata);
    return state;
  }

  function subscribe(selector, listener, options = {}) {
    let normalizedSelector = selector;
    let normalizedListener = listener;
    if (typeof listener !== "function") {
      normalizedListener = selector;
      normalizedSelector = (currentState) => currentState;
    }
    const subscription = {
      selector: normalizedSelector,
      listener: normalizedListener,
      equals: options.equals || Object.is,
      value: normalizedSelector(state)
    };
    subscriptions.add(subscription);
    return () => subscriptions.delete(subscription);
  }

  function reset(metadata = {}) {
    return replaceState(initialSnapshot, metadata);
  }

  return { getState, updateState, replaceState, subscribe, reset };
}

const api = { createPageStore };
root.MyTabDeskPageStore = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
