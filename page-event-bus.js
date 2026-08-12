(function (root) {
function createEventBus() {
  const listeners = new Map();

  function on(eventName, listener) {
    if (!listeners.has(eventName)) listeners.set(eventName, new Set());
    listeners.get(eventName).add(listener);
    return () => off(eventName, listener);
  }

  function once(eventName, listener) {
    const unsubscribe = on(eventName, (payload) => {
      unsubscribe();
      listener(payload);
    });
    return unsubscribe;
  }

  function off(eventName, listener) {
    const eventListeners = listeners.get(eventName);
    if (!eventListeners) return false;
    const removed = eventListeners.delete(listener);
    if (eventListeners.size === 0) listeners.delete(eventName);
    return removed;
  }

  function emit(eventName, payload) {
    const eventListeners = listeners.get(eventName);
    if (!eventListeners) return;
    for (const listener of Array.from(eventListeners)) listener(payload);
  }

  function clear(eventName) {
    if (eventName) listeners.delete(eventName);
    else listeners.clear();
  }

  return { on, once, off, emit, clear };
}

const api = { createEventBus };
root.MyTabDeskPageEventBus = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
