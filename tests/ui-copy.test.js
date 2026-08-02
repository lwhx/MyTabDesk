const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function testRemoteDownloadUsesMergeWording() {
  const html = readProjectFile("newtab.html");
  const syncSource = readProjectFile("newtab-sync.js");

  assert.equal(html.includes("远程覆盖本地"), false);
  assert.equal((html.match(/合并远程数据/g) || []).length, 2);
  assert.equal(syncSource.includes("已合并云端数据到本地"), true);
}

function testBackupActionsDistinguishNativeAndTabTabFormats() {
  const html = readProjectFile("newtab.html");
  const actionsSource = readProjectFile("newtab-actions.js");
  const readme = readProjectFile("README.md");

  assert.equal(html.includes('id="offlineExportBtn"'), true);
  assert.equal(html.includes("导出完整备份"), true);
  assert.equal(html.includes('id="exportTabTabBtn"'), true);
  assert.equal(html.includes("导出 TabTab 格式"), true);
  assert.equal(actionsSource.includes("exportNativeBackup(state.data)"), true);
  assert.equal(actionsSource.includes("function exportTabTabData()"), true);
  assert.equal(readme.includes("完整原生备份"), true);
  assert.equal(readme.includes("TabTab 兼容导出"), true);
  assert.equal(readme.includes("迁移完整同步凭据"), false);
  assert.equal(
    (actionsSource.match(/persistWithDirtySkipSync\(\{ replaceStoredData: true \}\)/g) || []).length,
    2
  );
}

function testSyncStateWritesAlwaysDeclareFields() {
  const sources = [
    readProjectFile("newtab-actions.js"),
    readProjectFile("newtab-sync.js"),
    readProjectFile("newtab-utils.js")
  ].join("\n");

  assert.equal(sources.includes("markSyncStateDirty()"), false);
  assert.equal(sources.includes("function markSyncStateDirty(fields ="), false);
  assert.equal(sources.includes("同步运行状态更新必须声明具体字段"), true);
}

function testSyncSettingsSaveUsesFieldPatch() {
  const syncSource = readProjectFile("newtab-sync.js");
  const utilsSource = readProjectFile("newtab-utils.js");

  assert.equal(syncSource.includes("Object.assign(sync, form)"), false);
  assert.equal(syncSource.includes("const syncSettingsPatch = {}"), true);
  assert.equal(syncSource.includes("saveData({ skipAutoSync: true, syncSettingsPatch })"), true);
  assert.equal(utilsSource.includes("Object.assign(state.data.settings.sync, syncSettingsPatch)"), true);
}

function testRefinedWorkspaceStructureExists() {
  const html = readProjectFile("newtab.html");
  const renderSource = readProjectFile("newtab-render.js");

  assert.equal(html.includes('class="workspace-more-menu"'), true);
  assert.equal(html.includes('class="workspace-more-trigger"'), true);
  assert.equal(renderSource.includes('className = "group-more-menu"'), true);
  assert.equal(renderSource.includes('className = "tabs-empty-state"'), true);
  assert.equal(html.includes('class="tabs-title">标签 (0)</div>'), true);
  assert.equal(renderSource.includes("elements.tabSearchInput.disabled = !hasCurrentTabs"), true);
  assert.equal(renderSource.includes("elements.saveCurrentTabsBtn.disabled = !hasCurrentTabs"), true);
}

function testRefinedVisualRulesExist() {
  const css = readProjectFile("newtab.css");

  assert.equal(css.includes(".app-shell.settings-mode .sidebar-footer-button"), true);
  assert.equal(css.includes("white-space: nowrap"), true);
  assert.equal(css.includes("@media (max-width: 1180px)"), true);
  assert.equal(css.includes(".tabs-empty-state"), true);
  assert.equal(css.includes(".settings-backup-actions"), true);
  assert.equal(/\.space-heading\s*\{[^}]*flex:\s*none;/.test(css), true);
  assert.equal(/\.settings-status-item:last-child\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/.test(css), true);
}

function testProductPositioningDoesNotClaimNewTabOverride() {
  const readme = readProjectFile("README.md");
  const packageData = JSON.parse(readProjectFile("package.json"));
  const manifest = JSON.parse(readProjectFile("manifest.json"));

  assert.equal(readme.includes("浏览器新标签页工作台扩展"), false);
  assert.equal(readme.includes("点击浏览器工具栏中的 MyTabDesk 扩展图标"), true);
  assert.equal(packageData.description.includes("新标签页"), false);
  assert.equal(manifest.description.toLowerCase().includes("new tab"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(manifest, "chrome_url_overrides"), false);
}

function testSessionRecoveryUiIsAvailable() {
  const html = readProjectFile("newtab.html");
  const sessionsSource = readProjectFile("newtab-sessions.js");

  assert.equal(html.includes('id="sessionsBtn"'), true);
  assert.equal(html.includes('id="sessionView"'), true);
  assert.equal(html.includes('id="captureSessionBtn"'), true);
  assert.equal(html.includes('id="sessionHistoryList"'), true);
  const settingsMarkup = html.slice(html.indexOf('id="settingsView"'), html.indexOf('</main>'));
  assert.equal(settingsMarkup.includes('id="sessionHistoryList"'), false);
  assert.equal(html.includes('id="sessionSearchInput"'), true);
  assert.equal(html.includes('id="sessionFilterTabs"'), true);
  const css = readProjectFile("newtab.css");
  assert.equal(css.includes(".session-view[hidden]"), true);
  assert.equal(css.includes(".settings-view[hidden]"), true);
  assert.equal(sessionsSource.includes('type: "list-session-snapshots"'), true);
  assert.equal(sessionsSource.includes('type: "restore-session-snapshot"'), true);
  assert.equal(sessionsSource.includes('type: "delete-session-snapshot"'), true);
  assert.equal(sessionsSource.includes("groupSnapshotsByDate"), true);
  assert.equal(sessionsSource.includes("toggleSnapshotDetails"), true);
  assert.equal(sessionsSource.includes("session-more-menu"), true);
  assert.equal(html.includes('id="sessionSkipOpenUrlsInput"'), true);
  assert.equal(sessionsSource.includes('restoreSnapshot(snapshot.id, "new")'), true);
  assert.equal(sessionsSource.includes('restoreSnapshot(snapshot.id, "current")'), true);
  assert.equal(sessionsSource.includes("targetWindowId"), true);
  assert.equal(sessionsSource.includes("skipOpenUrls"), true);
  assert.equal(sessionsSource.includes("session-tab-select"), true);
  assert.equal(sessionsSource.includes("selectedTabKeys"), true);
  assert.equal(sessionsSource.includes("全选"), true);
  assert.equal(sessionsSource.includes("清空"), true);
  assert.equal(sessionsSource.includes("恢复选中到当前窗口"), true);
}

function testSaveCloseAndDiscardActionsAreAvailable() {
  const html = readProjectFile("newtab.html");
  const actionsSource = readProjectFile("newtab-actions.js");
  const mainSource = readProjectFile("newtab-main.js");

  assert.equal(html.includes('id="saveAndCloseTabsBtn"'), true);
  assert.equal(html.includes('id="saveAndDiscardTabsBtn"'), true);
  assert.equal(actionsSource.includes('"close-saved-tabs"'), true);
  assert.equal(actionsSource.includes('"discard-saved-tabs"'), true);
  assert.equal(mainSource.includes("saveAndCloseTabsBtn"), true);
  assert.equal(mainSource.includes("saveAndDiscardTabsBtn"), true);
}

function testLinkNotesAreEditableAndVisible() {
  const html = readProjectFile("newtab.html");
  const actionsSource = readProjectFile("newtab-actions.js");
  const renderSource = readProjectFile("newtab-render.js");

  assert.equal(html.includes('id="editLinkNoteInput"'), true);
  assert.equal(actionsSource.includes("editLinkNoteInput.value = link.note || \"\""), true);
  assert.equal(actionsSource.includes("editLinkNoteInput.value = \"\""), true);
  assert.equal(renderSource.includes('"link-note"'), true);
  assert.equal(renderSource.includes("link.note"), true);
  assert.equal(readProjectFile("newtab-command-palette.js").includes('link.note || ""'), true);
}

function testDuplicateLinkCleanupIsAvailable() {
  const html = readProjectFile("newtab.html");
  const actionsSource = readProjectFile("newtab-actions.js");
  const mainSource = readProjectFile("newtab-main.js");
  const appSource = readProjectFile("newtab-app.js");

  assert.equal(html.includes('id="deduplicateLinksBtn"'), true);
  assert.equal(actionsSource.includes("findDuplicateLinks"), true);
  assert.equal(actionsSource.includes("deduplicateLinks"), true);
  assert.equal(actionsSource.includes("scanAndDeduplicateLinks"), true);
  assert.equal(mainSource.includes("deduplicateLinksBtn"), true);
  assert.equal(appSource.includes("findDuplicateLinks"), true);
  assert.equal(appSource.includes("deduplicateLinks"), true);
  assert.equal(mainSource.includes("workspaceMoreMenu.removeAttribute"), true);
}

function testCurrentTabsCanBeDraggedIntoGroups() {
  const actionsSource = readProjectFile("newtab-actions.js");
  const renderSource = readProjectFile("newtab-render.js");

  assert.equal(renderSource.includes("item.draggable = true"), true);
  assert.equal(renderSource.includes("state.draggedTab = tab"), true);
  assert.equal(actionsSource.includes("addDraggedTabToGroup"), true);
  assert.equal(actionsSource.includes("tabsToLinks([state.draggedTab])"), true);
}

function testTrashWorkspaceIsAvailable() {
  const html = readProjectFile("newtab.html");
  const appSource = readProjectFile("newtab-app.js");
  const mainSource = readProjectFile("newtab-main.js");
  const renderSource = readProjectFile("newtab-render.js");
  const trashSource = readProjectFile("newtab-trash.js");

  assert.equal(html.includes('id="trashBtn"'), true);
  assert.equal(html.includes('id="trashView"'), true);
  assert.equal(html.includes('id="trashList"'), true);
  assert.equal(html.includes('id="emptyTrashBtn"'), true);
  assert.equal(appSource.includes("getTrashItems"), true);
  assert.equal(appSource.includes("restoreTrashItem"), true);
  assert.equal(appSource.includes("purgeTrashItem"), true);
  assert.equal(mainSource.includes("trashBtn"), true);
  assert.equal(renderSource.includes('state.viewMode === "trash"'), true);
  assert.equal(trashSource.includes("openTrashView"), true);
  assert.equal(trashSource.includes("restoreItem"), true);
  assert.equal(trashSource.includes("purgeItem"), true);
  assert.equal(trashSource.includes("purgeExpiredTrash"), true);
  assert.equal(readProjectFile("newtab-notifications.js").includes("actionText"), true);
  const actionsSource = readProjectFile("newtab-actions.js");
  assert.equal(actionsSource.includes('actionText: "撤销"'), true);
  assert.equal(actionsSource.includes('state.openLinkMenuId = ""'), true);
  assert.equal(actionsSource.includes("root.MyTabDeskRender.renderGroups()"), true);
}

function testLinkHealthCheckIsAvailable() {
  const manifest = JSON.parse(readProjectFile("manifest.json"));
  const html = readProjectFile("newtab.html");
  const healthSource = readProjectFile("newtab-health.js");
  const renderSource = readProjectFile("newtab-render.js");
  const mainSource = readProjectFile("newtab-main.js");

  assert.equal(manifest.host_permissions.includes("http://*/*"), true);
  assert.equal(manifest.host_permissions.includes("https://*/*"), true);
  assert.equal(html.includes('id="checkLinksHealthBtn"'), true);
  assert.equal(healthSource.includes("checkSingleLink"), true);
  assert.equal(healthSource.includes("checkActiveSpaceLinks"), true);
  assert.equal(healthSource.includes('fetchWithTimeout(url, "HEAD")'), true);
  assert.equal(healthSource.includes('fetchWithTimeout(url, "GET")'), true);
  assert.equal(healthSource.includes("AbortController"), true);
  assert.equal(renderSource.includes("link-health-indicator"), true);
  assert.equal(renderSource.includes("检查链接"), true);
  assert.equal(mainSource.includes("checkLinksHealthBtn"), true);
}

function testLinkAndGroupColorMarkersAreAvailable() {
  const html = readProjectFile("newtab.html");
  const actionsSource = readProjectFile("newtab-actions.js");
  const renderSource = readProjectFile("newtab-render.js");
  const mainSource = readProjectFile("newtab-main.js");

  assert.equal(html.includes('id="editLinkColorInput"'), true);
  assert.equal(actionsSource.includes("editLinkColorInput.value = link.color"), true);
  assert.equal(actionsSource.includes("setGroupColor"), true);
  assert.equal(renderSource.includes("link.color ? `color-${link.color}`"), true);
  assert.equal(renderSource.includes("group.color ? `color-${group.color}`"), true);
  assert.equal(renderSource.includes("group-color-picker"), true);
  assert.equal(mainSource.includes("editLinkColorInput"), true);
}

function testUsageStatisticsDashboardIsAvailable() {
  const html = readProjectFile("newtab.html");
  const mainSource = readProjectFile("newtab-main.js");
  const renderSource = readProjectFile("newtab-render.js");
  const statsSource = readProjectFile("newtab-stats.js");

  assert.equal(html.includes('id="statsBtn"'), true);
  assert.equal(html.includes('id="statsView"'), true);
  assert.equal(html.includes('id="statsTrendChart"'), true);
  assert.equal(html.includes('id="statsDomainList"'), true);
  assert.equal(html.includes('id="statsSpaceList"'), true);
  assert.equal(mainSource.includes("statsBtn"), true);
  assert.equal(renderSource.includes('state.viewMode === "stats"'), true);
  assert.equal(statsSource.includes("get-usage-stats"), true);
  assert.equal(statsSource.includes("renderTrendChart"), true);
  assert.equal(statsSource.includes("createElementNS"), true);
  assert.equal(statsSource.includes("mytabdesk_usage_stats"), false);
  assert.equal(html.includes('id="statsTrendRangeSelect"'), true);
  assert.equal(statsSource.includes("getTrendDays"), true);
  assert.equal(statsSource.includes("statsTrendRangeSelect"), true);
}

function testTabLifecycleManagementIsAvailable() {
  const html = readProjectFile("newtab.html");
  const lifecycleSource = readProjectFile("newtab-lifecycle.js");
  const renderSource = readProjectFile("newtab-render.js");
  const mainSource = readProjectFile("newtab-main.js");

  assert.equal(html.includes('id="organizeIdleTabsBtn"'), true);
  assert.equal(html.includes('id="lifecycleEnabledInput"'), true);
  assert.equal(html.includes('id="lifecycleIdleMinutesInput"'), true);
  assert.equal(html.includes('id="lifecycleAutoSaveHoursInput"'), true);
  assert.equal(html.includes('id="lifecycleWhitelistInput"'), true);
  assert.equal(lifecycleSource.includes("get-tab-lifecycle"), true);
  assert.equal(lifecycleSource.includes("set-tab-lifecycle-config"), true);
  assert.equal(lifecycleSource.includes("organizeIdleTabs"), true);
  assert.equal(renderSource.includes("tab-lifecycle-badge"), true);
  assert.equal(mainSource.includes("organizeIdleTabsBtn"), true);
}

function testBrowserBookmarksImportIsImplemented() {
  const manifest = JSON.parse(readProjectFile("manifest.json"));
  const readme = readProjectFile("README.md");
  const actionsSource = readProjectFile("newtab-actions.js");
  const mainSource = readProjectFile("newtab-main.js");

  assert.equal(manifest.permissions.includes("bookmarks"), true);
  assert.equal(actionsSource.includes("showBookmarksImportPlaceholder"), false);
  assert.equal(actionsSource.includes("chrome.bookmarks.getTree"), true);
  assert.equal(actionsSource.includes("importBrowserBookmarks"), true);
  assert.equal(mainSource.includes("importBrowserBookmarks"), true);
  assert.equal(readme.includes("读取完整书签树"), true);
  assert.equal(readme.includes("只导入用户最终选定的目录"), true);
  assert.equal(readme.includes("仅在用户主动选择“从浏览器书签导入”时读取所选书签目录"), false);
  assert.equal(readme.includes("不参与工作台的 Gist/WebDAV 同步"), true);
  assert.equal(readme.includes("不包含在备份导出中"), true);
}

function testExportSpaceAsHtmlIsAvailable() {
  const html = readProjectFile("newtab.html");
  const actionsSource = readProjectFile("newtab-actions.js");
  const mainSource = readProjectFile("newtab-main.js");

  // 工作台"更多"菜单中存在导出 HTML 按钮
  assert.equal(html.includes('id="exportSpaceAsHtmlBtn"'), true);
  assert.equal(html.includes("导出为 HTML"), true);
  // 按钮位于 workspace-more-panel 菜单内
  const morePanel = html.slice(html.indexOf('class="workspace-more-panel"'), html.indexOf("</details>"));
  assert.equal(morePanel.includes('id="exportSpaceAsHtmlBtn"'), true);
  // actions 中实现导出函数
  assert.equal(actionsSource.includes("function exportSpaceAsHtml"), true);
  // 必须使用转义函数
  assert.equal(actionsSource.includes("function escapeHtml"), true);
  assert.equal(actionsSource.includes("escapeHtml("), true);
  // 导出函数体内禁止使用 innerHTML（使用转义字符串拼接代替）
  const fnStart = actionsSource.indexOf("function exportSpaceAsHtml");
  const fnEnd = actionsSource.indexOf("function requestImportData");
  const fnBody = actionsSource.slice(fnStart, fnEnd);
  assert.equal(fnBody.includes("innerHTML"), false);
  // 跳过已删除项
  assert.equal(actionsSource.includes("deletedAt"), true);
  // 文件名格式
  assert.equal(actionsSource.includes("mytabdesk-"), true);
  assert.equal(actionsSource.includes(".html"), true);
  // 导出到模块对外接口
  assert.equal(actionsSource.includes("exportSpaceAsHtml"), true);
  // main 中接线事件
  assert.equal(mainSource.includes("exportSpaceAsHtmlBtn"), true);
  assert.equal(mainSource.includes("exportSpaceAsHtml"), true);
}

function testScheduledAutoSaveIsConfigurable() {
  const html = readProjectFile("newtab.html");
  const normalizeSource = readProjectFile("core/normalize.js");
  const actionsSource = readProjectFile("newtab-actions.js");
  const mainSource = readProjectFile("newtab-main.js");
  const backgroundSource = readProjectFile("background.js");

  // HTML 控件存在
  assert.equal(html.includes('id="scheduledSaveEnabledInput"'), true);
  assert.equal(html.includes('id="scheduledSaveTimeInput"'), true);
  assert.equal(html.includes('id="scheduledSaveSpaceSelect"'), true);
  assert.equal(html.includes('id="scheduledSaveGroupSelect"'), true);
  assert.equal(html.includes('id="saveScheduledSaveConfigBtn"'), true);
  assert.equal(html.includes("定时保存"), true);

  // normalize 保留 settings.scheduledSave
  assert.equal(normalizeSource.includes("scheduledSave"), true);

  // actions 提供保存配置函数，写入 settings.scheduledSave
  assert.equal(actionsSource.includes("saveScheduledSaveConfig"), true);
  assert.equal(actionsSource.includes("state.data.settings.scheduledSave"), true);

  // main 接线
  assert.equal(mainSource.includes("saveScheduledSaveConfigBtn"), true);
  assert.equal(mainSource.includes("scheduledSaveEnabledInput"), true);

  // background 定时保存 alarm 名称与处理逻辑
  assert.equal(backgroundSource.includes("MyTabDeskScheduledSave"), true);
  assert.equal(backgroundSource.includes("SCHEDULED_SAVE_ALARM_NAME"), true);
  assert.equal(backgroundSource.includes("scheduledSave"), true);
  assert.equal(backgroundSource.includes("executeScheduledSave"), true);
}

function testSpaceTemplatesAreAvailable() {
  const html = readProjectFile("newtab.html");
  const actionsSource = readProjectFile("newtab-actions.js");
  const mainSource = readProjectFile("newtab-main.js");
  assert.equal(html.includes('id="createFromTemplateBtn"'), true);
  assert.equal(actionsSource.includes("saveCurrentSpaceAsTemplate"), true);
  assert.equal(actionsSource.includes("createSpaceFromSelectedTemplate"), true);
  assert.equal(actionsSource.includes("state.data.settings.spaceTemplates"), true);
  assert.equal(mainSource.includes("createFromTemplateBtn"), true);
}

function testAiGroupingAndFaviconCacheUiIsAvailable() {
  const html = readProjectFile("newtab.html");
  const mainSource = readProjectFile("newtab-main.js");
  const faviconSource = readProjectFile("newtab-utils.js");
  assert.equal(html.includes('id="aiGroupLinksBtn"'), true);
  assert.equal(html.includes('id="aiGroupingBaseUrlInput"'), true);
  assert.equal(html.includes('id="aiGroupingModelInput"'), true);
  assert.equal(html.includes('id="aiGroupingApiKeyInput"'), true);
  assert.equal(html.includes('id="aiGroupingPreviewDialog"'), true);
  assert.equal(html.includes('id="cacheFaviconsBtn"'), true);
  assert.equal(html.includes('id="clearFaviconCacheBtn"'), true);
  assert.equal(mainSource.includes("aiGroupLinksBtn"), true);
  assert.equal(mainSource.includes("cacheFaviconsBtn"), true);
  assert.equal(faviconSource.includes("resolveFaviconSource"), true);
}

function testGlobalCommandPaletteAndShortcutsExist() {
  const manifest = JSON.parse(readProjectFile("manifest.json"));
  const html = readProjectFile("newtab.html");
  const source = readProjectFile("newtab-command-palette.js");

  assert.equal(html.includes('id="commandPalette"'), true);
  assert.equal(html.includes('id="commandPaletteInput"'), true);
  assert.equal(source.includes('event.key.toLowerCase() === "k"'), true);
  assert.equal(source.includes("state.data.spaces"), true);
  assert.equal(source.includes("state.currentTabs"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(manifest, "commands"), true);
  assert.equal(manifest.commands["open-mytabdesk"].suggested_key.default, "Alt+Shift+D");
  assert.equal(manifest.commands["save-current-tab"].suggested_key.default, "Alt+Shift+S");
}

function runTests() {
  testRemoteDownloadUsesMergeWording();
  testBackupActionsDistinguishNativeAndTabTabFormats();
  testSyncStateWritesAlwaysDeclareFields();
  testSyncSettingsSaveUsesFieldPatch();
  testRefinedWorkspaceStructureExists();
  testRefinedVisualRulesExist();
  testProductPositioningDoesNotClaimNewTabOverride();
  testSessionRecoveryUiIsAvailable();
  testSaveCloseAndDiscardActionsAreAvailable();
  testLinkNotesAreEditableAndVisible();
  testDuplicateLinkCleanupIsAvailable();
  testCurrentTabsCanBeDraggedIntoGroups();
  testTrashWorkspaceIsAvailable();
  testLinkHealthCheckIsAvailable();
  testLinkAndGroupColorMarkersAreAvailable();
  testUsageStatisticsDashboardIsAvailable();
  testTabLifecycleManagementIsAvailable();
  testBrowserBookmarksImportIsImplemented();
  testExportSpaceAsHtmlIsAvailable();
  testScheduledAutoSaveIsConfigurable();
  testSpaceTemplatesAreAvailable();
  testAiGroupingAndFaviconCacheUiIsAvailable();
  testGlobalCommandPaletteAndShortcutsExist();
  console.log("界面文案测试通过");
}

runTests();
