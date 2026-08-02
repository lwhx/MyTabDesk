/**
 * MyTabDesk 核心模块：链接健康状态分类。
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.MyTabDeskCoreHealth = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function classifyLinkHealth(result = {}) {
    if (result.timedOut) return { status: "timeout", code: 0 };
    if (result.networkBlocked) return { status: "blocked", code: 0 };
    const code = Number(result.status) || 0;
    if (code >= 200 && code < 400) return { status: "ok", code };
    if ([401, 403, 405, 429].includes(code)) return { status: "blocked", code };
    return { status: "broken", code };
  }

  return { classifyLinkHealth };
});
