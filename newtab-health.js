(function (root) {
  const app = root.MyTabDeskPage;
  const { state } = app;
  const { classifyLinkHealth } = root.MyTabDeskCore;
  const TIMEOUT_MS = 8000;
  const CONCURRENCY = 5;

  async function fetchWithTimeout(url, method) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await fetch(url, {
        method,
        redirect: "follow",
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
        ...(method === "GET" ? { headers: { Range: "bytes=0-0" } } : {})
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function probeUrl(url) {
    try {
      let response = await fetchWithTimeout(url, "HEAD");
      if (response.status === 405 || response.status === 501) {
        response = await fetchWithTimeout(url, "GET");
      }
      return classifyLinkHealth({ status: response.status });
    } catch (error) {
      return classifyLinkHealth({
        timedOut: error && error.name === "AbortError",
        networkBlocked: !error || error.name !== "AbortError"
      });
    }
  }

  function findLinkContext(spaceId, groupId, linkId) {
    const space = state.data.spaces.find((item) => item.id === spaceId && !item.deletedAt);
    const group = space && space.groups.find((item) => item.id === groupId && !item.deletedAt);
    const link = group && group.links.find((item) => item.id === linkId && !item.deletedAt);
    return { space, group, link };
  }

  async function checkSingleLink(spaceId, groupId, linkId, options = {}) {
    const context = findLinkContext(spaceId, groupId, linkId);
    if (!context.link) return null;
    const result = await probeUrl(context.link.url);
    const checkedAt = Date.now();
    context.link.healthStatus = result.status;
    context.link.healthCode = result.code;
    context.link.healthCheckedAt = checkedAt;
    context.link.updatedAt = checkedAt;
    context.group.updatedAt = checkedAt;
    context.space.updatedAt = checkedAt;
    if (!options.deferSave) {
      root.MyTabDeskUtils.markDirty();
      await root.MyTabDeskUtils.saveData({ skipAutoSync: false });
      root.MyTabDeskRender.renderAll();
      root.MyTabDeskNotifications.showToast(`检查完成：${context.link.title || context.link.url}`, result.status === "broken" ? "warning" : "success");
    }
    return result;
  }

  async function checkActiveSpaceLinks() {
    const space = state.data.spaces.find((item) => item.id === state.data.activeSpaceId && !item.deletedAt);
    if (!space) return;
    const targets = space.groups.filter((group) => !group.deletedAt).flatMap((group) => (
      group.links.filter((link) => !link.deletedAt).map((link) => ({ spaceId: space.id, groupId: group.id, linkId: link.id }))
    ));
    if (targets.length === 0) {
      root.MyTabDeskNotifications.showToast("当前空间没有可检查的链接", "info");
      return;
    }

    let nextIndex = 0;
    const results = [];
    async function worker() {
      while (nextIndex < targets.length) {
        const target = targets[nextIndex];
        nextIndex += 1;
        const result = await checkSingleLink(target.spaceId, target.groupId, target.linkId, { deferSave: true });
        if (result) results.push(result);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
    root.MyTabDeskUtils.markDirty();
    await root.MyTabDeskUtils.saveData({ skipAutoSync: false });
    root.MyTabDeskRender.renderAll();
    const broken = results.filter((item) => item.status === "broken").length;
    const blocked = results.filter((item) => item.status === "blocked" || item.status === "timeout").length;
    root.MyTabDeskNotifications.showToast(`已检查 ${results.length} 条：失效 ${broken} 条，受限/超时 ${blocked} 条`, broken ? "warning" : "success");
  }

  root.MyTabDeskHealth = {
    probeUrl,
    checkSingleLink,
    checkActiveSpaceLinks
  };
})(globalThis);
