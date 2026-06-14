/**
 * MyTabDesk 核心模块：MyTabDeskCoreIds
 * 由 tabdesk-core.js 拆分而来，保持 Node（require）与浏览器（全局命名空间）双环境兼容。
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.MyTabDeskCoreIds = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {

/**
 * 获取默认空间图标，用于初始化数据和兼容旧数据。
 *
 * @returns {string} 默认空间图标。
 */
function getDefaultSpaceIcon() {
  return "📁";
}

/**
 * 获取当前时间戳。
 *
 * @returns {number} 当前毫秒级时间戳。
 */
function getCurrentTime() {
  return Date.now();
}

/**
 * 安全获取嵌套对象属性值。
 *
 * @param {object} obj 源对象。
 * @param {string[]} keys 属性路径数组。
 * @param {*} defaultValue 默认值。
 * @returns {*} 属性值或默认值。
 */
function getNestedValue(obj, keys, defaultValue) {
  let current = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== "object") {
      return defaultValue;
    }
    current = current[key];
  }
  return current !== undefined ? current : defaultValue;
}

/**
 * 获取嵌套对象属性值（支持点号分隔的路径字符串）。
 *
 * @param {object} obj 源对象。
 * @param {string} path 属性路径，如 "settings.sync.webdavUrl"。
 * @param {*} defaultValue 默认值。
 * @returns {*} 属性值或默认值。
 */
function getPathValue(obj, path, defaultValue) {
  return getNestedValue(obj, path.split("."), defaultValue);
}

/**
 * 创建业务对象 ID。
 *
 * @param {string} prefix ID 前缀，用于在不支持 crypto.randomUUID 时生成可读 ID。
 * @returns {string} 新生成的唯一 ID。
 */
function createId(prefix) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${prefix}-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

/**
 * 创建设备标识，用于区分不同浏览器实例的同步数据。
 *
 * @returns {string} 以 device- 为前缀的唯一设备 ID。
 */
function createDeviceId() {
  return `device-${createId("device")}`;
}

  return {
    getDefaultSpaceIcon,
  getCurrentTime,
  getNestedValue,
  getPathValue,
  createId,
  createDeviceId
  };
});
