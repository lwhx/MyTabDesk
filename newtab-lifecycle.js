(function (root) {
  const app = root.MyTabDeskPage;
  const { state, elements } = app;

  function formatElapsed(ms) {
    const minutes = Math.max(0, Math.floor((Number(ms) || 0) / 60000));
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }

  async function loadLifecycleStatus() {
    const response = await chrome.runtime.sendMessage({ type: "get-tab-lifecycle" });
    state.tabLifecycleById = new Map((response.tabs || []).map((item) => [item.tabId, item]));
    state.tabLifecycleConfig = response.config || {};
    root.MyTabDeskRender.renderCurrentTabs();
    return response;
  }

  async function loadLifecycleConfig() {
    const response = await loadLifecycleStatus();
    const config = response.config || {};
    elements.lifecycleEnabledInput.checked = config.enabled !== false;
    elements.lifecycleIdleMinutesInput.value = config.idleWarningMinutes || 60;
    elements.lifecycleAutoSaveHoursInput.value = config.autoSaveHours || 24;
    elements.lifecycleMaxTabsInput.value = config.maxTabs || 50;
    elements.lifecycleWhitelistInput.value = (config.whitelistDomains || []).join("\n");
  }

  async function saveLifecycleConfig() {
    const config = {
      enabled: elements.lifecycleEnabledInput.checked,
      idleWarningMinutes: Number(elements.lifecycleIdleMinutesInput.value),
      autoSaveHours: Number(elements.lifecycleAutoSaveHoursInput.value),
      maxTabs: Number(elements.lifecycleMaxTabsInput.value),
      autoCloseEnabled: false,
      whitelistDomains: elements.lifecycleWhitelistInput.value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean),
      retentionDays: 90
    };
    const response = await chrome.runtime.sendMessage({ type: "set-tab-lifecycle-config", config });
    if (!response || !response.success) throw new Error("生命周期设置保存失败");
    await loadLifecycleConfig();
    root.MyTabDeskNotifications.showToast("生命周期设置已保存", "success");
  }

  function ensureStagingGroup(activeSpace) {
    let group = activeSpace.groups.find((item) => !item.deletedAt && item.name === "暂存");
    if (!group) {
      const now = Date.now();
      group = { id: app.createId("group"), name: "暂存", collapsed: false, pinned: false, links: [], createdAt: now, updatedAt: now };
      activeSpace.groups.push(group);
      activeSpace.updatedAt = now;
    }
    return group;
  }

  async function organizeIdleTabs() {
    const response = await loadLifecycleStatus();
    const candidates = (response.tabs || []).filter((item) => item.status === "critical" && !item.protectedReason);
    const currentById = new Map(state.currentTabs.map((tab) => [tab.tabId, tab]));
    const tabs = candidates.map((item) => currentById.get(item.tabId)).filter(Boolean);
    if (tabs.length === 0) {
      root.MyTabDeskNotifications.showToast("当前窗口没有需要整理的闲置标签", "info");
      return;
    }
    const preview = tabs.slice(0, 8).map((tab) => `• ${tab.title || tab.url}`).join("\n");
    const extra = tabs.length > 8 ? `\n另有 ${tabs.length - 8} 个标签` : "";
    const confirmed = await root.MyTabDeskDialogs.showConfirm(
      `将保存以下 ${tabs.length} 个闲置标签到“暂存”分组，然后关闭：\n${preview}${extra}`,
      "整理闲置标签"
    );
    if (!confirmed) return;
    const activeSpace = root.MyTabDeskUtils.getActiveSpace();
    const group = ensureStagingGroup(activeSpace);
    state.data = app.addLinksToGroup(state.data, activeSpace.id, group.id, app.tabsToLinks(tabs));
    root.MyTabDeskUtils.markDirty();
    await root.MyTabDeskUtils.saveData();
    await chrome.runtime.sendMessage({
      type: "record-usage-event",
      eventType: "save",
      linkCount: tabs.length,
      spaceId: activeSpace.id
    });
    const cleanup = await chrome.runtime.sendMessage({
      type: "close-saved-tabs",
      savedTabs: tabs.map((tab) => ({ tabId: tab.tabId, url: tab.url, windowId: tab.windowId }))
    });
    await root.MyTabDeskActions.refreshCurrentTabs();
    root.MyTabDeskRender.renderAll();
    root.MyTabDeskNotifications.showToast(`已保存并关闭 ${cleanup.affected || 0} 个闲置标签`, "success");
  }

  root.MyTabDeskLifecycle = {
    formatElapsed,
    loadLifecycleStatus,
    loadLifecycleConfig,
    saveLifecycleConfig,
    organizeIdleTabs
  };
})(globalThis);
