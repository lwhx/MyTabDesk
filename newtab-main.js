(function (root) {
const app = root.MyTabDeskPage;
const { state, elements } = app;
const { getElement, loadData, saveData, createWorkspaceSnapshot } = root.MyTabDeskUtils;

/**
 * 绑定页面级事件。
 *
 * @returns {void}
 */
function bindEvents() {
  elements.appDialog.addEventListener("click", (event) => {
    if (event.target === elements.appDialog) {
      root.MyTabDeskDialogs.closeAppDialog(state.appDialogType === "alert");
    }
  });
  elements.appDialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      root.MyTabDeskDialogs.closeAppDialog(state.appDialogType === "alert");
    }
  });
  elements.appDialogCancelBtn.addEventListener("click", () => root.MyTabDeskDialogs.closeAppDialog(false));
  elements.appDialogConfirmBtn.addEventListener("click", () => root.MyTabDeskDialogs.closeAppDialog(true));
  elements.appDialogInput.addEventListener("keydown", (event) => {
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
  elements.editLinkDialog.addEventListener("click", (event) => {
    if (event.target === elements.editLinkDialog) {
      root.MyTabDeskActions.closeEditLinkDialog();
    }
  });
  elements.editLinkDialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      root.MyTabDeskActions.closeEditLinkDialog();
    }
  });
  elements.closeEditLinkDialogBtn.addEventListener("click", root.MyTabDeskActions.closeEditLinkDialog);
  elements.cancelEditLinkBtn.addEventListener("click", root.MyTabDeskActions.closeEditLinkDialog);
  elements.confirmEditLinkBtn.addEventListener("click", root.MyTabDeskActions.submitEditLinkDialog);

  for (const input of [elements.editLinkTitleInput, elements.editLinkUrlInput, elements.editLinkIconInput]) {
    input.addEventListener("input", () => {
      elements.editLinkError.textContent = "";
    });
    input.addEventListener("keydown", async (event) => {
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
  elements.createSpaceBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    root.MyTabDeskRender.toggleCreateSpaceMenu();
  });
  elements.createBlankSpaceBtn.addEventListener("click", root.MyTabDeskActions.createBlankSpaceFromMenu);
  elements.importSpaceBtn.addEventListener("click", root.MyTabDeskActions.requestImportSpace);
  elements.importBookmarksBtn.addEventListener("click", root.MyTabDeskActions.showBookmarksImportPlaceholder);
  elements.closeSpaceIconDialogBtn.addEventListener("click", root.MyTabDeskRender.closeSpaceIconPicker);
  elements.cancelSpaceIconBtn.addEventListener("click", root.MyTabDeskRender.closeSpaceIconPicker);
  elements.confirmSpaceIconBtn.addEventListener("click", root.MyTabDeskRender.confirmSpaceIconChange);
  elements.createSpaceDialog.addEventListener("click", (event) => {
    if (event.target === elements.createSpaceDialog) {
      root.MyTabDeskRender.closeCreateSpaceDialog();
    }
  });
  elements.closeCreateSpaceDialogBtn.addEventListener("click", root.MyTabDeskRender.closeCreateSpaceDialog);
  elements.cancelCreateSpaceBtn.addEventListener("click", root.MyTabDeskRender.closeCreateSpaceDialog);
  elements.confirmCreateSpaceBtn.addEventListener("click", root.MyTabDeskActions.submitCreateSpaceDialog);
  elements.createSpaceNameInput.addEventListener("input", () => {
    state.createSpaceDialogError = "";
    root.MyTabDeskRender.renderCreateSpaceDialog();
  });
  elements.createSpaceNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      root.MyTabDeskActions.submitCreateSpaceDialog();
    }

    if (event.key === "Escape") {
      root.MyTabDeskRender.closeCreateSpaceDialog();
    }
  });
  elements.spaceIconDialog.addEventListener("click", (event) => {
    if (event.target === elements.spaceIconDialog) {
      root.MyTabDeskRender.closeSpaceIconPicker();
    }
  });
  elements.createGroupBtn.addEventListener("click", root.MyTabDeskActions.createGroup);
  elements.refreshTabsBtn.addEventListener("click", root.MyTabDeskActions.refreshCurrentTabs);
  elements.saveCurrentTabsBtn.addEventListener("click", root.MyTabDeskActions.saveCurrentTabsToGroup);
  elements.importFileInput.addEventListener("change", root.MyTabDeskActions.importSelectedFile);
  elements.toggleThemeBtn.addEventListener("click", root.MyTabDeskActions.toggleTheme);
  elements.toggleSidebarBtn.addEventListener("click", root.MyTabDeskActions.toggleSidebar);
  elements.toggleTabsPanelBtn.addEventListener("click", root.MyTabDeskActions.toggleTabsPanel);
  elements.batchDeleteBtn.addEventListener("click", root.MyTabDeskActions.toggleBatchDelete);
  elements.confirmBatchDeleteBtn.addEventListener("click", root.MyTabDeskActions.confirmBatchDelete);
  elements.cancelBatchDeleteBtn.addEventListener("click", root.MyTabDeskActions.toggleBatchDelete);
  elements.settingsBtn.addEventListener("click", root.MyTabDeskActions.openSettings);
  elements.offlineExportBtn.addEventListener("click", root.MyTabDeskActions.exportCurrentData);
  elements.offlineImportBtn.addEventListener("click", root.MyTabDeskActions.requestImportData);
  elements.exportEncryptedBtn.addEventListener("click", root.MyTabDeskActions.handleExportEncryptedBackup);
  elements.importEncryptedBtn.addEventListener("click", root.MyTabDeskActions.requestImportEncryptedBackup);
  elements.saveSyncSettingsBtn.addEventListener("click", root.MyTabDeskSync.handleSaveSyncSettings);
  elements.gistSyncSwitch.addEventListener("change", async () => {
    root.MyTabDeskSync.selectSyncProvider(elements.gistSyncSwitch.checked ? "gist" : "none");
    await root.MyTabDeskSync.saveSyncSettingsFromForm();
  });
  elements.webdavSyncSwitch.addEventListener("change", async () => {
    root.MyTabDeskSync.selectSyncProvider(elements.webdavSyncSwitch.checked ? "webdav" : "none");
    await root.MyTabDeskSync.saveSyncSettingsFromForm();
  });
  elements.gistAutoSyncSwitch.addEventListener("change", root.MyTabDeskSync.saveSyncSettingsFromForm);
  elements.webdavAutoSyncSwitch.addEventListener("change", root.MyTabDeskSync.saveSyncSettingsFromForm);
  elements.gistUploadSyncBtn.addEventListener("click", () => root.MyTabDeskSync.uploadManualSync("gist"));
  elements.gistDownloadSyncBtn.addEventListener("click", () => root.MyTabDeskSync.downloadManualSync("gist"));
  elements.webdavUploadSyncBtn.addEventListener("click", () => root.MyTabDeskSync.uploadManualSync("webdav"));
  elements.webdavDownloadSyncBtn.addEventListener("click", () => root.MyTabDeskSync.downloadManualSync("webdav"));
  elements.encryptedBackupFileInput.addEventListener("change", root.MyTabDeskActions.importEncryptedBackupFile);
  elements.searchInput.addEventListener("input", (event) => {
    state.searchKeyword = event.target.value;
    root.MyTabDeskRender.renderGroups();
  });
  elements.tabSearchInput.addEventListener("input", (event) => {
    state.tabSearchKeyword = event.target.value;
    root.MyTabDeskRender.renderCurrentTabs();
  });
  document.addEventListener("dragend", () => {
    state.draggedSpaceId = "";
    state.draggedGroupId = "";
    state.draggedLink = null;
    state.draggedTab = null;
  });
  document.addEventListener("click", (event) => {
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
  bindElements();
  state.data = app.ensureSyncSettings(await loadData());
  state.lastWorkspaceSnapshot = createWorkspaceSnapshot();
  await saveData({ skipAutoSync: true });
  bindEvents();
  root.MyTabDeskRender.renderAll();
  root.MyTabDeskSync.scheduleAutoSync();
  await root.MyTabDeskActions.refreshCurrentTabs();
}

root.MyTabDeskMain = {
  bindEvents,
  bindElements,
  init
};

document.addEventListener("DOMContentLoaded", init);
})(globalThis);
