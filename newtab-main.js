(function (root) {
const app = root.MyTabDeskPage;
const { state, elements } = app;
const { getElement, loadData, saveData, createWorkspaceSnapshot, markDirty } = root.MyTabDeskUtils;

/**
 * 已注册的事件监听器列表，用于页面销毁时统一清理。
 * @type {Array<{element: HTMLElement, event: string, handler: Function}>}
 */
const registeredEventListeners = [];

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
  safeAddEventListener(elements.importBookmarksBtn, "click", root.MyTabDeskActions.showBookmarksImportPlaceholder);
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
  safeAddEventListener(elements.importFileInput, "change", root.MyTabDeskActions.importSelectedFile);
  safeAddEventListener(elements.toggleThemeBtn, "click", root.MyTabDeskActions.toggleTheme);
  safeAddEventListener(elements.toggleSidebarBtn, "click", root.MyTabDeskActions.toggleSidebar);
  safeAddEventListener(elements.toggleTabsPanelBtn, "click", root.MyTabDeskActions.toggleTabsPanel);
  safeAddEventListener(elements.batchDeleteBtn, "click", root.MyTabDeskActions.toggleBatchDelete);
  safeAddEventListener(elements.confirmBatchDeleteBtn, "click", root.MyTabDeskActions.confirmBatchDelete);
  safeAddEventListener(elements.cancelBatchDeleteBtn, "click", root.MyTabDeskActions.toggleBatchDelete);
  safeAddEventListener(elements.settingsBtn, "click", root.MyTabDeskActions.openSettings);
  safeAddEventListener(elements.offlineExportBtn, "click", root.MyTabDeskActions.exportCurrentData);
  safeAddEventListener(elements.offlineImportBtn, "click", root.MyTabDeskActions.requestImportData);
  safeAddEventListener(elements.exportEncryptedBtn, "click", root.MyTabDeskActions.handleExportEncryptedBackup);
  safeAddEventListener(elements.importEncryptedBtn, "click", root.MyTabDeskActions.requestImportEncryptedBackup);
  safeAddEventListener(elements.saveSyncSettingsBtn, "click", root.MyTabDeskSync.handleSaveSyncSettings);
  safeAddEventListener(elements.gistSyncSwitch, "change", async () => {
    root.MyTabDeskSync.selectSyncProvider(elements.gistSyncSwitch.checked ? "gist" : "none");
    await root.MyTabDeskSync.saveSyncSettingsFromForm();
  });
  safeAddEventListener(elements.webdavSyncSwitch, "change", async () => {
    root.MyTabDeskSync.selectSyncProvider(elements.webdavSyncSwitch.checked ? "webdav" : "none");
    await root.MyTabDeskSync.saveSyncSettingsFromForm();
  });
  safeAddEventListener(elements.gistAutoSyncSwitch, "change", root.MyTabDeskSync.saveSyncSettingsFromForm);
  safeAddEventListener(elements.webdavAutoSyncSwitch, "change", root.MyTabDeskSync.saveSyncSettingsFromForm);
  safeAddEventListener(elements.gistUploadSyncBtn, "click", () => root.MyTabDeskSync.uploadManualSync("gist"));
  safeAddEventListener(elements.gistDownloadSyncBtn, "click", () => root.MyTabDeskSync.downloadManualSync("gist"));
  safeAddEventListener(elements.webdavUploadSyncBtn, "click", () => root.MyTabDeskSync.uploadManualSync("webdav"));
  safeAddEventListener(elements.webdavDownloadSyncBtn, "click", () => root.MyTabDeskSync.downloadManualSync("webdav"));
  safeAddEventListener(elements.encryptedBackupFileInput, "change", root.MyTabDeskActions.importEncryptedBackupFile);
  safeAddEventListener(elements.searchInput, "input", (event) => {
    state.searchKeyword = event.target.value;
    root.MyTabDeskRender.renderGroups();
  });
  safeAddEventListener(elements.tabSearchInput, "input", (event) => {
    state.tabSearchKeyword = event.target.value;
    root.MyTabDeskRender.renderCurrentTabs();
  });
  safeAddEventListener(document, "dragend", () => {
    state.draggedSpaceId = "";
    state.draggedGroupId = "";
    state.draggedLink = null;
    state.draggedTab = null;
  });
  safeAddEventListener(document, "click", (event) => {
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
  elements.appDialogConfirmBtn = getElement("appDialogConfirmBtn");
  elements.editLinkDialog = getElement("editLinkDialog");
  elements.editLinkTitleInput = getElement("editLinkTitleInput");
  elements.editLinkUrlInput = getElement("editLinkUrlInput");
  elements.editLinkIconInput = getElement("editLinkIconInput");
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
  elements.currentSpaceName = getElement("currentSpaceName");
  elements.currentSpaceMeta = getElement("currentSpaceMeta");
  elements.searchInput = getElement("searchInput");
  elements.toggleThemeBtn = getElement("toggleThemeBtn");
  elements.toggleTabsPanelBtn = getElement("toggleTabsPanelBtn");
  elements.batchDeleteBtn = getElement("batchDeleteBtn");
  elements.createGroupBtn = getElement("createGroupBtn");
  elements.batchBar = getElement("batchBar");
  elements.confirmBatchDeleteBtn = getElement("confirmBatchDeleteBtn");
  elements.cancelBatchDeleteBtn = getElement("cancelBatchDeleteBtn");
  elements.groupList = getElement("groupList");
  elements.emptyState = getElement("emptyState");
  elements.workspaceToolbar = getElement("workspaceToolbar");
  elements.settingsView = getElement("settingsView");
  elements.offlineExportBtn = getElement("offlineExportBtn");
  elements.offlineImportBtn = getElement("offlineImportBtn");
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
  elements.currentTabsList = getElement("currentTabsList");
}

/**
 * 初始化新标签页应用。
 *
 * @returns {Promise<void>} 初始化完成后结束。
 */
async function init() {
  // 初始化前先清理可能存在的事件监听器，避免重复绑定
  cleanupEventListeners();
  bindElements();
  state.data = app.ensureSyncSettings(await loadData());
  state.lastWorkspaceSnapshot = createWorkspaceSnapshot();
  await saveData({ skipAutoSync: true });
  bindEvents();
  root.MyTabDeskRender.renderAll();
  root.MyTabDeskSync.scheduleAutoSync();
  await root.MyTabDeskActions.refreshCurrentTabs();
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
  state.autoSyncRunning = false;
  state.lastWorkspaceSnapshot = "";
  state.openSpaceMenuId = "";
  state.openLinkMenuId = "";
  state.editingLinkContext = null;
  state.appDialogResolver = null;
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
  cleanupEventListeners
};

document.addEventListener("DOMContentLoaded", init);
})(globalThis);
