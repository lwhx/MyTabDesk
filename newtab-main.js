(function (root) {
const app = root.MyTabDeskPage;
const { state, elements } = app;
const { getElement, loadData, saveData, createWorkspaceSnapshot, debounce } = root.MyTabDeskUtils;

/**
 * 已注册的事件监听器列表，用于页面销毁时统一清理。
 * @type {Array<{element: HTMLElement, event: string, handler: Function}>}
 */
const registeredEventListeners = [];
const stateSubscriptions = [];

function bindStateCommunication() {
  if (stateSubscriptions.length > 0) return;
  stateSubscriptions.push(app.eventBus.on("workspace:committed", () => root.MyTabDeskRender.renderAll()));
  stateSubscriptions.push(app.eventBus.on("workspace:replaced", () => root.MyTabDeskRender.renderAll()));
  stateSubscriptions.push(app.eventBus.on("view:changed", () => root.MyTabDeskRender.renderAll()));
}

function cleanupStateCommunication() {
  for (const unsubscribe of stateSubscriptions.splice(0)) unsubscribe();
}

/**
 * 安全地注册事件监听器，自动记录以便后续清理。
 *
 * @param {HTMLElement} element DOM 元素。
 * @param {string} event 事件名称。
 * @param {Function} handler 事件处理函数。
 * @param {Object} [options] addEventListener 选项。
 * @returns {void}
 */
function safeAddEventListener(element, event, handler, options) {
  if (!element) return;
  element.addEventListener(event, handler, options);
  registeredEventListeners.push({ element, event, handler, options });
}

/**
 * 清理所有已注册的事件监听器。
 *
 * @returns {void}
 */
function cleanupEventListeners() {
  for (const { element, event, handler, options } of registeredEventListeners) {
    if (element) {
      element.removeEventListener(event, handler, options);
    }
  }
  registeredEventListeners.length = 0;
}

/**
 * 绑定页面级事件。
 *
 * @returns {void}
 */
function bindEvents() {
  safeAddEventListener(elements.appDialog, "click", (event) => {
    if (event.target === elements.appDialog) {
      root.MyTabDeskDialogs.closeAppDialog(state.appDialogType === "alert");
    }
  });
  safeAddEventListener(elements.appDialog, "keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      root.MyTabDeskDialogs.closeAppDialog(state.appDialogType === "alert");
    }
  });
  safeAddEventListener(elements.appDialogCancelBtn, "click", () => root.MyTabDeskDialogs.closeAppDialog(false));
  safeAddEventListener(elements.appDialogActionBtn, "click", () => root.MyTabDeskDialogs.triggerAppDialogAction());
  safeAddEventListener(elements.appDialogConfirmBtn, "click", () => root.MyTabDeskDialogs.closeAppDialog(true));
  safeAddEventListener(elements.appDialogInput, "keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      root.MyTabDeskDialogs.closeAppDialog(true);
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      root.MyTabDeskDialogs.closeAppDialog(false);
    }
  });
  safeAddEventListener(elements.editLinkDialog, "click", (event) => {
    if (event.target === elements.editLinkDialog) {
      root.MyTabDeskActions.closeEditLinkDialog();
    }
  });
  safeAddEventListener(elements.editLinkDialog, "keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      root.MyTabDeskActions.closeEditLinkDialog();
    }
  });
  safeAddEventListener(elements.closeEditLinkDialogBtn, "click", root.MyTabDeskActions.closeEditLinkDialog);
  safeAddEventListener(elements.cancelEditLinkBtn, "click", root.MyTabDeskActions.closeEditLinkDialog);
  safeAddEventListener(elements.confirmEditLinkBtn, "click", root.MyTabDeskActions.submitEditLinkDialog);

  for (const input of [elements.editLinkTitleInput, elements.editLinkUrlInput, elements.editLinkIconInput]) {
    safeAddEventListener(input, "input", () => {
      elements.editLinkError.textContent = "";
    });
    safeAddEventListener(input, "keydown", async (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        await root.MyTabDeskActions.submitEditLinkDialog();
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        root.MyTabDeskActions.closeEditLinkDialog();
      }
    });
  }
  safeAddEventListener(elements.createSpaceBtn, "click", (event) => {
    event.stopPropagation();
    root.MyTabDeskRender.toggleCreateSpaceMenu();
  });
  safeAddEventListener(elements.createBlankSpaceBtn, "click", root.MyTabDeskActions.createBlankSpaceFromMenu);
  safeAddEventListener(elements.importSpaceBtn, "click", root.MyTabDeskActions.requestImportSpace);
  safeAddEventListener(elements.importBookmarksBtn, "click", root.MyTabDeskActions.importBrowserBookmarks);
  safeAddEventListener(elements.createFromTemplateBtn, "click", root.MyTabDeskActions.createSpaceFromSelectedTemplate);
  safeAddEventListener(elements.saveCurrentSpaceTemplateBtn, "click", root.MyTabDeskActions.saveCurrentSpaceAsTemplate);
  safeAddEventListener(elements.closeSpaceIconDialogBtn, "click", root.MyTabDeskRender.closeSpaceIconPicker);
  safeAddEventListener(elements.cancelSpaceIconBtn, "click", root.MyTabDeskRender.closeSpaceIconPicker);
  safeAddEventListener(elements.confirmSpaceIconBtn, "click", root.MyTabDeskRender.confirmSpaceIconChange);
  safeAddEventListener(elements.createSpaceDialog, "click", (event) => {
    if (event.target === elements.createSpaceDialog) {
      root.MyTabDeskRender.closeCreateSpaceDialog();
    }
  });
  safeAddEventListener(elements.closeCreateSpaceDialogBtn, "click", root.MyTabDeskRender.closeCreateSpaceDialog);
  safeAddEventListener(elements.cancelCreateSpaceBtn, "click", root.MyTabDeskRender.closeCreateSpaceDialog);
  safeAddEventListener(elements.confirmCreateSpaceBtn, "click", root.MyTabDeskActions.submitCreateSpaceDialog);
  safeAddEventListener(elements.createSpaceNameInput, "input", () => {
    state.createSpaceDialogError = "";
    root.MyTabDeskRender.renderCreateSpaceDialog();
  });
  safeAddEventListener(elements.createSpaceNameInput, "keydown", (event) => {
    if (event.key === "Enter") {
      root.MyTabDeskActions.submitCreateSpaceDialog();
    }

    if (event.key === "Escape") {
      root.MyTabDeskRender.closeCreateSpaceDialog();
    }
  });
  safeAddEventListener(elements.spaceIconDialog, "click", (event) => {
    if (event.target === elements.spaceIconDialog) {
      root.MyTabDeskRender.closeSpaceIconPicker();
    }
  });
  safeAddEventListener(elements.createGroupBtn, "click", root.MyTabDeskActions.createGroup);
  safeAddEventListener(elements.refreshTabsBtn, "click", root.MyTabDeskActions.refreshCurrentTabs);
  safeAddEventListener(elements.saveCurrentTabsBtn, "click", root.MyTabDeskActions.saveCurrentTabsToGroup);
  safeAddEventListener(elements.saveAndCloseTabsBtn, "click", root.MyTabDeskActions.saveCurrentTabsAndClose);
  safeAddEventListener(elements.saveAndDiscardTabsBtn, "click", root.MyTabDeskActions.saveCurrentTabsAndDiscard);
  safeAddEventListener(elements.organizeIdleTabsBtn, "click", root.MyTabDeskLifecycle.organizeIdleTabs);
  safeAddEventListener(elements.saveLifecycleConfigBtn, "click", root.MyTabDeskLifecycle.saveLifecycleConfig);
  safeAddEventListener(elements.saveScheduledSaveConfigBtn, "click", root.MyTabDeskActions.saveScheduledSaveConfig);
  safeAddEventListener(elements.aiGroupLinksBtn, "click", root.MyTabDeskAiGrouping.runGrouping);
  safeAddEventListener(elements.saveAiGroupingConfigBtn, "click", async () => {
    try {
      await root.MyTabDeskAiGrouping.saveConfigFromForm();
    } catch (error) {
      await root.MyTabDeskDialogs.showAlert(error.message || "AI 配置保存失败。", "AI 分组");
    }
  });
  safeAddEventListener(elements.cancelAiGroupingBtn, "click", root.MyTabDeskAiGrouping.closePreview);
  safeAddEventListener(elements.confirmAiGroupingBtn, "click", root.MyTabDeskAiGrouping.confirmGrouping);
  safeAddEventListener(elements.cacheFaviconsBtn, "click", async () => {
    const space = root.MyTabDeskUtils.getActiveSpace();
    const links = space.groups.filter((group) => !group.deletedAt).flatMap((group) => group.links.filter((link) => !link.deletedAt));
    const result = await root.MyTabDeskFaviconCache.cacheLinks(links);
    root.MyTabDeskRender.renderAll();
    root.MyTabDeskNotifications.showToast(`已缓存 ${result.succeeded} 个图标，失败 ${result.failed} 个`, result.failed ? "warning" : "success");
  });
  safeAddEventListener(elements.clearFaviconCacheBtn, "click", async () => {
    await root.MyTabDeskFaviconCache.clearCache();
    root.MyTabDeskRender.renderAll();
    root.MyTabDeskNotifications.showToast("图标缓存已清空", "success");
  });
  safeAddEventListener(elements.scheduledSaveSpaceSelect, "change", root.MyTabDeskActions.loadScheduledSaveConfigOptions);
  safeAddEventListener(elements.importFileInput, "change", root.MyTabDeskActions.importSelectedFile);
  safeAddEventListener(elements.toggleThemeBtn, "click", root.MyTabDeskActions.toggleTheme);
  safeAddEventListener(elements.toggleSidebarBtn, "click", root.MyTabDeskActions.toggleSidebar);
  safeAddEventListener(elements.toggleTabsPanelBtn, "click", root.MyTabDeskActions.toggleTabsPanel);
  safeAddEventListener(elements.toggleCompactLinksBtn, "click", root.MyTabDeskActions.toggleCompactLinks);
  safeAddEventListener(elements.batchDeleteBtn, "click", root.MyTabDeskActions.toggleBatchDelete);
  safeAddEventListener(elements.deduplicateLinksBtn, "click", root.MyTabDeskActions.scanAndDeduplicateLinks);
  safeAddEventListener(elements.checkLinksHealthBtn, "click", root.MyTabDeskHealth.checkActiveSpaceLinks);
  safeAddEventListener(elements.exportSpaceAsHtmlBtn, "click", root.MyTabDeskActions.exportSpaceAsHtml);
  safeAddEventListener(elements.confirmBatchDeleteBtn, "click", root.MyTabDeskActions.confirmBatchDelete);
  safeAddEventListener(elements.cancelBatchDeleteBtn, "click", root.MyTabDeskActions.toggleBatchDelete);
  safeAddEventListener(elements.settingsBtn, "click", root.MyTabDeskActions.openSettings);
  safeAddEventListener(elements.sessionsBtn, "click", root.MyTabDeskSessions.openSessionView);
  safeAddEventListener(elements.trashBtn, "click", root.MyTabDeskTrash.openTrashView);
  safeAddEventListener(elements.statsBtn, "click", root.MyTabDeskStats.openStatsView);
  safeAddEventListener(elements.refreshStatsBtn, "click", root.MyTabDeskStats.loadStats);
  safeAddEventListener(elements.statsTrendRangeSelect, "change", root.MyTabDeskStats.renderStats);
  safeAddEventListener(elements.emptyTrashBtn, "click", root.MyTabDeskTrash.emptyTrash);
  safeAddEventListener(elements.offlineExportBtn, "click", root.MyTabDeskActions.exportCurrentData);
  safeAddEventListener(elements.offlineImportBtn, "click", root.MyTabDeskActions.requestImportData);
  safeAddEventListener(elements.exportTabTabBtn, "click", root.MyTabDeskActions.exportTabTabData);
  safeAddEventListener(elements.exportEncryptedBtn, "click", root.MyTabDeskActions.handleExportEncryptedBackup);
  safeAddEventListener(elements.importEncryptedBtn, "click", root.MyTabDeskActions.requestImportEncryptedBackup);
  safeAddEventListener(elements.saveSyncSettingsBtn, "click", root.MyTabDeskSync.handleSaveSyncSettings);
  // 同步表单文本输入框编辑时标记为脏，避免 renderSettingsStatus 在用户未保存时覆盖输入
  for (const input of [
    elements.webdavUrlInput,
    elements.webdavUsernameInput,
    elements.webdavPasswordInput,
    elements.webdavFilenameInput,
    elements.gistTokenInput,
    elements.gistIdInput,
    elements.gistFilenameInput,
    elements.syncEncryptionPasswordInput
  ]) {
    safeAddEventListener(input, "input", () => {
      state.settingsFormDirty = true;
    });
  }
  safeAddEventListener(elements.gistSyncSwitch, "change", async () => {
    // 不调用 selectSyncProvider，避免关闭 gist 时连带关闭 webdav；
    // 直接以两个开关的实际勾选状态重新计算 provider。
    await root.MyTabDeskSync.saveSyncSettingsFromForm();
  });
  safeAddEventListener(elements.webdavSyncSwitch, "change", async () => {
    await root.MyTabDeskSync.saveSyncSettingsFromForm();
  });
  safeAddEventListener(elements.gistAutoSyncSwitch, "change", root.MyTabDeskSync.saveSyncSettingsFromForm);
  safeAddEventListener(elements.webdavAutoSyncSwitch, "change", root.MyTabDeskSync.saveSyncSettingsFromForm);
  safeAddEventListener(elements.gistUploadSyncBtn, "click", () => root.MyTabDeskSync.uploadManualSync("gist"));
  safeAddEventListener(elements.gistDownloadSyncBtn, "click", () => root.MyTabDeskSync.downloadManualSync("gist"));
  safeAddEventListener(elements.webdavUploadSyncBtn, "click", () => root.MyTabDeskSync.uploadManualSync("webdav"));
  safeAddEventListener(elements.webdavDownloadSyncBtn, "click", () => root.MyTabDeskSync.downloadManualSync("webdav"));
  safeAddEventListener(elements.encryptedBackupFileInput, "change", root.MyTabDeskActions.importEncryptedBackupFile);
  safeAddEventListener(elements.searchInput, "input", debounce((event) => {
    state.searchKeyword = event.target.value;
    root.MyTabDeskRender.renderGroups();
  }, 200));
  safeAddEventListener(elements.tabSearchInput, "input", debounce((event) => {
    state.tabSearchKeyword = event.target.value;
    root.MyTabDeskRender.renderCurrentTabs();
  }, 200));
  safeAddEventListener(document, "dragend", () => {
    state.draggedSpaceId = "";
    state.draggedGroupId = "";
    state.draggedLink = null;
    state.draggedTab = null;
  });
  safeAddEventListener(document, "click", (event) => {
    const workspaceMoreMenu = event.target.closest(".workspace-more-menu");
    if (workspaceMoreMenu && event.target.closest(".workspace-menu-action")) {
      workspaceMoreMenu.removeAttribute("open");
    }
    if (!event.target.closest(".space-item") && !event.target.closest(".space-menu-panel")) {
      state.openSpaceMenuId = "";
      root.MyTabDeskRender.renderSpaces();
    }

    if (!event.target.closest(".create-space-wrap")) {
      root.MyTabDeskRender.closeCreateSpaceMenu();
    }

    if (!event.target.closest(".link-card") && state.openLinkMenuId) {
      state.openLinkMenuId = "";
      root.MyTabDeskRender.renderGroups();
    }

    if (!event.target.closest(".group-move-wrap") && state.movingGroupId) {
      root.MyTabDeskActions.closeMoveGroupMenu();
    }
  });

  // Ctrl/Cmd+K 聚焦中栏搜索框，方便高频检索
  safeAddEventListener(document, "keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") {
      return;
    }
    // 对话框打开时不抢焦点，避免干扰正在进行的输入
    if (state.appDialogResolver || !elements.editLinkDialog.hidden) {
      return;
    }
    event.preventDefault();
    // 设置页下先切回工作台视图，再聚焦（搜索框在 workspaceToolbar 内，settings 下被隐藏）
    if (state.viewMode === "settings" || state.viewMode === "sessions" || state.viewMode === "trash" || state.viewMode === "stats") {
      state.viewMode = "workspace";
      root.MyTabDeskRender.renderAll();
      requestAnimationFrame(() => elements.searchInput.focus());
    } else {
      elements.searchInput.focus();
      elements.searchInput.select();
    }
  });
}

/**
 * 绑定页面 DOM 元素引用。
 *
 * @returns {void}
 */
function bindElements() {
  elements.appShell = getElement("appShell");
  elements.appDialog = getElement("appDialog");
  elements.appDialogTitle = getElement("appDialogTitle");
  elements.appDialogMessage = getElement("appDialogMessage");
  elements.appDialogInputWrap = getElement("appDialogInputWrap");
  elements.appDialogInput = getElement("appDialogInput");
  elements.appDialogCancelBtn = getElement("appDialogCancelBtn");
  elements.appDialogActionBtn = getElement("appDialogActionBtn");
  elements.appDialogConfirmBtn = getElement("appDialogConfirmBtn");
  elements.editLinkDialog = getElement("editLinkDialog");
  elements.editLinkTitleInput = getElement("editLinkTitleInput");
  elements.editLinkUrlInput = getElement("editLinkUrlInput");
  elements.editLinkIconInput = getElement("editLinkIconInput");
  elements.editLinkNoteInput = getElement("editLinkNoteInput");
  elements.editLinkColorInput = getElement("editLinkColorInput");
  elements.editLinkError = getElement("editLinkError");
  elements.closeEditLinkDialogBtn = getElement("closeEditLinkDialogBtn");
  elements.cancelEditLinkBtn = getElement("cancelEditLinkBtn");
  elements.confirmEditLinkBtn = getElement("confirmEditLinkBtn");
  elements.importFileInput = getElement("importFileInput");
  elements.encryptedBackupFileInput = getElement("encryptedBackupFileInput");
  elements.createSpaceBtn = getElement("createSpaceBtn");
  elements.createSpaceMenu = getElement("createSpaceMenu");
  elements.createBlankSpaceBtn = getElement("createBlankSpaceBtn");
  elements.importSpaceBtn = getElement("importSpaceBtn");
  elements.importBookmarksBtn = getElement("importBookmarksBtn");
  elements.createFromTemplateBtn = getElement("createFromTemplateBtn");
  elements.saveCurrentSpaceTemplateBtn = getElement("saveCurrentSpaceTemplateBtn");
  elements.toggleSidebarBtn = getElement("toggleSidebarBtn");
  elements.spaceList = getElement("spaceList");
  elements.spaceIconDialog = getElement("spaceIconDialog");
  elements.spaceIconGrid = getElement("spaceIconGrid");
  elements.createSpaceDialog = getElement("createSpaceDialog");
  elements.createSpaceNameInput = getElement("createSpaceNameInput");
  elements.createSpaceError = getElement("createSpaceError");
  elements.closeCreateSpaceDialogBtn = getElement("closeCreateSpaceDialogBtn");
  elements.cancelCreateSpaceBtn = getElement("cancelCreateSpaceBtn");
  elements.confirmCreateSpaceBtn = getElement("confirmCreateSpaceBtn");
  elements.closeSpaceIconDialogBtn = getElement("closeSpaceIconDialogBtn");
  elements.cancelSpaceIconBtn = getElement("cancelSpaceIconBtn");
  elements.confirmSpaceIconBtn = getElement("confirmSpaceIconBtn");
  elements.settingsBtn = getElement("settingsBtn");
  elements.sessionsBtn = getElement("sessionsBtn");
  elements.trashBtn = getElement("trashBtn");
  elements.statsBtn = getElement("statsBtn");
  elements.currentSpaceName = getElement("currentSpaceName");
  elements.currentSpaceMeta = getElement("currentSpaceMeta");
  elements.searchInput = getElement("searchInput");
  elements.toggleThemeBtn = getElement("toggleThemeBtn");
  elements.toggleTabsPanelBtn = getElement("toggleTabsPanelBtn");
  elements.toggleCompactLinksBtn = getElement("toggleCompactLinksBtn");
  elements.batchDeleteBtn = getElement("batchDeleteBtn");
  elements.deduplicateLinksBtn = getElement("deduplicateLinksBtn");
  elements.checkLinksHealthBtn = getElement("checkLinksHealthBtn");
  elements.exportSpaceAsHtmlBtn = getElement("exportSpaceAsHtmlBtn");
  elements.createGroupBtn = getElement("createGroupBtn");
  elements.batchBar = getElement("batchBar");
  elements.confirmBatchDeleteBtn = getElement("confirmBatchDeleteBtn");
  elements.cancelBatchDeleteBtn = getElement("cancelBatchDeleteBtn");
  elements.groupList = getElement("groupList");
  elements.emptyState = getElement("emptyState");
  elements.workspaceToolbar = getElement("workspaceToolbar");
  elements.settingsView = getElement("settingsView");
  elements.sessionView = getElement("sessionView");
  elements.trashView = getElement("trashView");
  elements.trashList = getElement("trashList");
  elements.emptyTrashBtn = getElement("emptyTrashBtn");
  elements.statsView = getElement("statsView");
  elements.refreshStatsBtn = getElement("refreshStatsBtn");
  elements.statsSavedToday = getElement("statsSavedToday");
  elements.statsRestoredToday = getElement("statsRestoredToday");
  elements.statsDomainsToday = getElement("statsDomainsToday");
  elements.statsTrackedTabs = getElement("statsTrackedTabs");
  elements.statsTrendChart = getElement("statsTrendChart");
  elements.statsTrendRangeSelect = getElement("statsTrendRangeSelect");
  elements.statsDomainList = getElement("statsDomainList");
  elements.statsSpaceList = getElement("statsSpaceList");
  elements.offlineExportBtn = getElement("offlineExportBtn");
  elements.offlineImportBtn = getElement("offlineImportBtn");
  elements.exportTabTabBtn = getElement("exportTabTabBtn");
  elements.backupPasswordInput = getElement("backupPasswordInput");
  elements.exportEncryptedBtn = getElement("exportEncryptedBtn");
  elements.importEncryptedBtn = getElement("importEncryptedBtn");
  elements.gistSyncSwitch = getElement("gistSyncSwitch");
  elements.webdavSyncSwitch = getElement("webdavSyncSwitch");
  elements.gistAutoSyncSwitch = getElement("gistAutoSyncSwitch");
  elements.webdavAutoSyncSwitch = getElement("webdavAutoSyncSwitch");
  elements.webdavUrlInput = getElement("webdavUrlInput");
  elements.webdavUsernameInput = getElement("webdavUsernameInput");
  elements.webdavPasswordInput = getElement("webdavPasswordInput");
  elements.webdavFilenameInput = getElement("webdavFilenameInput");
  elements.gistTokenInput = getElement("gistTokenInput");
  elements.gistIdInput = getElement("gistIdInput");
  elements.gistFilenameInput = getElement("gistFilenameInput");
  elements.syncEncryptionPasswordInput = getElement("syncEncryptionPasswordInput");
  elements.saveSyncSettingsBtn = getElement("saveSyncSettingsBtn");
  elements.gistUploadSyncBtn = getElement("gistUploadSyncBtn");
  elements.gistDownloadSyncBtn = getElement("gistDownloadSyncBtn");
  elements.webdavUploadSyncBtn = getElement("webdavUploadSyncBtn");
  elements.webdavDownloadSyncBtn = getElement("webdavDownloadSyncBtn");
  elements.syncModeValue = getElement("syncModeValue");
  elements.syncDeviceIdValue = getElement("syncDeviceIdValue");
  elements.syncLastModifiedValue = getElement("syncLastModifiedValue");
  elements.syncLastBackupValue = getElement("syncLastBackupValue");
  elements.syncLastImportValue = getElement("syncLastImportValue");
  elements.syncAutoStatusValue = getElement("syncAutoStatusValue");
  elements.settingsVersionValue = getElement("settingsVersionValue");
  elements.settingsSpaceCountValue = getElement("settingsSpaceCountValue");
  elements.settingsGroupCountValue = getElement("settingsGroupCountValue");
  elements.settingsLinkCountValue = getElement("settingsLinkCountValue");
  elements.tabsTitle = getElement("tabsTitle");
  elements.tabSearchInput = getElement("tabSearchInput");
  elements.refreshTabsBtn = getElement("refreshTabsBtn");
  elements.saveCurrentTabsBtn = getElement("saveCurrentTabsBtn");
  elements.saveAndCloseTabsBtn = getElement("saveAndCloseTabsBtn");
  elements.saveAndDiscardTabsBtn = getElement("saveAndDiscardTabsBtn");
  elements.organizeIdleTabsBtn = getElement("organizeIdleTabsBtn");
  elements.lifecycleEnabledInput = getElement("lifecycleEnabledInput");
  elements.lifecycleIdleMinutesInput = getElement("lifecycleIdleMinutesInput");
  elements.lifecycleAutoSaveHoursInput = getElement("lifecycleAutoSaveHoursInput");
  elements.lifecycleMaxTabsInput = getElement("lifecycleMaxTabsInput");
  elements.lifecycleWhitelistInput = getElement("lifecycleWhitelistInput");
  elements.saveLifecycleConfigBtn = getElement("saveLifecycleConfigBtn");
  elements.scheduledSaveEnabledInput = getElement("scheduledSaveEnabledInput");
  elements.scheduledSaveTimeInput = getElement("scheduledSaveTimeInput");
  elements.scheduledSaveSpaceSelect = getElement("scheduledSaveSpaceSelect");
  elements.scheduledSaveGroupSelect = getElement("scheduledSaveGroupSelect");
  elements.saveScheduledSaveConfigBtn = getElement("saveScheduledSaveConfigBtn");
  elements.aiGroupLinksBtn = getElement("aiGroupLinksBtn");
  elements.aiGroupingBaseUrlInput = getElement("aiGroupingBaseUrlInput");
  elements.aiGroupingModelInput = getElement("aiGroupingModelInput");
  elements.aiGroupingApiKeyInput = getElement("aiGroupingApiKeyInput");
  elements.saveAiGroupingConfigBtn = getElement("saveAiGroupingConfigBtn");
  elements.aiGroupingPreviewDialog = getElement("aiGroupingPreviewDialog");
  elements.aiGroupingPreviewList = getElement("aiGroupingPreviewList");
  elements.cancelAiGroupingBtn = getElement("cancelAiGroupingBtn");
  elements.confirmAiGroupingBtn = getElement("confirmAiGroupingBtn");
  elements.cacheFaviconsBtn = getElement("cacheFaviconsBtn");
  elements.clearFaviconCacheBtn = getElement("clearFaviconCacheBtn");
  elements.currentTabsList = getElement("currentTabsList");
}

/**
 * 初始化新标签页应用。
 *
 * @returns {Promise<void>} 初始化完成后结束。
 */
async function init() {
  state.initialized = false;
  // 初始化前先清理可能存在的事件监听器，避免重复绑定
  cleanupEventListeners();
  bindElements();
  state.data = app.ensureSyncSettings(await loadData());
  state.lastWorkspaceSnapshot = createWorkspaceSnapshot();
  await saveData({ skipAutoSync: true });
  bindEvents();
  bindStateCommunication();
  root.MyTabDeskSessions.bindSessionEvents();
  await root.MyTabDeskTrash.purgeExpiredItems();
  root.MyTabDeskCommandPalette.bindCommandPalette();
  root.MyTabDeskRender.renderAll();
  await root.MyTabDeskSessions.loadSessionHistory();
  await root.MyTabDeskLifecycle.loadLifecycleStatus();
  await root.MyTabDeskFaviconCache.loadCache();
  root.MyTabDeskSync.scheduleAutoSync();
  await root.MyTabDeskActions.refreshCurrentTabs();
  state.initialized = true;
  // state.data 就绪后，消费 background 暂存的右键保存数据
  await root.MyTabDeskNotifications.checkPendingSaveData();
  // 消费后台 alarms 唤醒标记：如果后台触发同步时页面未打开，现在补同步
  await root.MyTabDeskNotifications.checkPendingAutoSyncWake();
}

/**
 * 清理页面绑定的事件和状态，用于页面卸载或重置时调用。
 *
 * @returns {void}
 */
function destroy() {
  /** 清理自动同步定时器。 */
  if (state.autoSyncTimerId) {
    clearTimeout(state.autoSyncTimerId);
    state.autoSyncTimerId = 0;
  }

  /** 清理所有已注册的事件监听器，防止内存泄漏 */
  cleanupEventListeners();
  cleanupStateCommunication();

  /** 清理所有状态。 */
  state.data = null;
  state.currentTabs = [];
  state.searchKeyword = "";
  state.tabSearchKeyword = "";
  state.batchDeleteEnabled = false;
  state.selectedLinkIds.clear();
  state.draggedSpaceId = "";
  state.draggedGroupId = "";
  state.draggedLink = null;
  state.draggedTab = null;
  state.lastWorkspaceSnapshot = "";
  state.openSpaceMenuId = "";
  state.openLinkMenuId = "";
  state.editingLinkContext = null;
  state.appDialogResolver = null;
  state.appDialogActionHandler = null;
  state.createSpaceMenuOpen = false;
  state.createSpaceDialogOpen = false;
  state.iconPickerSpaceId = "";
  state.selectedSpaceIcon = "";
  state.viewMode = "workspace";
}

root.MyTabDeskMain = {
  bindEvents,
  bindElements,
  init,
  destroy,
  cleanupEventListeners,
  bindStateCommunication,
  cleanupStateCommunication
};

document.addEventListener("DOMContentLoaded", () => {
  init().catch((error) => {
    console.error("初始化失败:", error);
    document.body.innerHTML = "";
    const errorDiv = document.createElement("div");
    errorDiv.style.cssText = "padding:32px;font-family:system-ui,sans-serif;color:#d32f2f;text-align:center;line-height:1.8;";
    errorDiv.textContent = "数据加载失败，请尝试刷新页面。如问题持续，可在扩展管理页禁用后重新启用 MyTabDesk。";
    const retryBtn = document.createElement("button");
    retryBtn.textContent = "重试";
    retryBtn.style.cssText = "display:block;margin:16px auto 0;padding:8px 24px;font-size:14px;cursor:pointer;border:1px solid #d32f2f;background:#fff;color:#d32f2f;border-radius:4px;";
    retryBtn.addEventListener("click", () => location.reload());
    errorDiv.appendChild(retryBtn);
    document.body.appendChild(errorDiv);
  });
});
})(globalThis);
