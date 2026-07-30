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

function runTests() {
  testRemoteDownloadUsesMergeWording();
  testBackupActionsDistinguishNativeAndTabTabFormats();
  testSyncStateWritesAlwaysDeclareFields();
  testSyncSettingsSaveUsesFieldPatch();
  testRefinedWorkspaceStructureExists();
  testRefinedVisualRulesExist();
  console.log("界面文案测试通过");
}

runTests();
