const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const projectRoot = path.resolve(__dirname, "..");
const extensionPath = path.join(projectRoot, "dist", "MyTabDesk-Chrome");

function resolveChromiumExecutable() {
  const configured = process.env.MYTABDESK_CHROMIUM_EXECUTABLE;
  const bundled = chromium.executablePath();
  const candidates = [configured, bundled].filter(Boolean);

  if (process.platform === "win32") {
    const browserRoot = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
    if (fs.existsSync(browserRoot)) {
      const installedChromiums = fs.readdirSync(browserRoot)
        .filter((entry) => entry.startsWith("chromium-"))
        .sort()
        .reverse()
        .map((entry) => path.join(browserRoot, entry, "chrome-win64", "chrome.exe"));
      candidates.push(...installedChromiums);
    }
  }

  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

async function waitFor(check, message, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

async function testLoadedExtensionPersistsWorkspaceAndConsumesBackgroundSave() {
  assert.equal(fs.existsSync(path.join(extensionPath, "manifest.json")), true, "请先构建扩展发布目录");

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mytabdesk-e2e-"));
  const executablePath = resolveChromiumExecutable();
  let context;
  const diagnostics = [];

  try {
    assert.notEqual(executablePath, "", "未找到 Chromium；请执行 npx playwright install chromium");
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath,
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });

    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent("serviceworker", { timeout: 15000 });
    }

    const extensionId = new URL(serviceWorker.url()).host;
    assert.match(extensionId, /^[a-p]{32}$/);

    const page = await context.newPage();
    page.on("console", (message) => diagnostics.push(`console:${message.type()}:${message.text()}`));
    page.on("pageerror", (error) => diagnostics.push(`pageerror:${error.stack || error.message}`));
    await page.goto(`chrome-extension://${extensionId}/newtab.html`);
    await page.waitForSelector("#createSpaceBtn");

    assert.equal(await page.title(), "MyTabDesk");
    assert.equal(await page.locator("#offlineExportBtn").textContent(), "导出完整备份");
    assert.equal(await page.locator("#exportTabTabBtn").textContent(), "导出 TabTab 格式");

    await page.locator("#createSpaceBtn").click();
    await page.locator("#createBlankSpaceBtn").click();
    await page.locator("#createSpaceNameInput").fill("E2E 空间");
    await page.locator("#confirmCreateSpaceBtn").click();
    try {
      await waitFor(
        async () => (await page.locator("#currentSpaceName").textContent()).includes("E2E 空间"),
        "创建空间后页面未切换到新空间"
      );
    } catch (error) {
      const state = await page.evaluate(async () => {
        const result = await chrome.storage.local.get("my_tab_desk_data");
        return {
          dialogHidden: document.querySelector("#createSpaceDialog").hidden,
          dialogError: document.querySelector("#createSpaceError").textContent,
          inputValue: document.querySelector("#createSpaceNameInput").value,
          heading: document.querySelector("#currentSpaceName").textContent,
          stored: result.my_tab_desk_data
        };
      });
      throw new Error(`${error.message}\n${JSON.stringify({ diagnostics, state }, null, 2)}`, { cause: error });
    }

    await serviceWorker.evaluate(
      'saveLinkToMyTabDesk("https://example.com/mytabdesk-e2e", "E2E 后台保存")'
    );

    await waitFor(
      async () => (await page.locator("#groupList").textContent()).includes("E2E 后台保存"),
      "后台保存请求未通过真实 runtime 消息进入工作台"
    );

    const stored = await page.evaluate(async () => {
      const result = await chrome.storage.local.get("my_tab_desk_data");
      return result.my_tab_desk_data;
    });
    const activeSpace = stored.spaces.find((space) => space.id === stored.activeSpaceId && !space.deletedAt);
    const activeLinks = activeSpace.groups
      .filter((group) => !group.deletedAt)
      .flatMap((group) => group.links.filter((link) => !link.deletedAt));

    assert.equal(activeSpace.name, "E2E 空间");
    assert.equal(activeLinks.some((link) => link.url === "https://example.com/mytabdesk-e2e"), true);

    // 两个扩展页面同时打开时，旧页面后写入业务数据也不能清掉较新的同步运行状态。
    const stalePage = await context.newPage();
    await stalePage.goto(`chrome-extension://${extensionId}/newtab.html`);
    await stalePage.waitForSelector("#groupList");
    const staleSettingsPage = await context.newPage();
    await staleSettingsPage.goto(`chrome-extension://${extensionId}/newtab.html`);
    await staleSettingsPage.waitForSelector("#groupList");

    await page.evaluate(async () => {
      const sync = globalThis.MyTabDeskPage.state.data.settings.sync;
      sync.gistId = "gist-e2e-latest";
      sync.autoSyncPendingAt = 12345;
      sync.lastSyncAt = 23456;
      document.querySelector("#gistIdInput").value = "gist-e2e-latest";
      globalThis.MyTabDeskUtils.markSyncStateDirty(["gistId", "autoSyncPendingAt", "lastSyncAt"]);
      await globalThis.MyTabDeskUtils.saveData({ skipAutoSync: true });
    });
    await stalePage.evaluate(async () => {
      const data = globalThis.MyTabDeskPage.state.data;
      const active = data.spaces.find((space) => space.id === data.activeSpaceId && !space.deletedAt);
      active.updatedAt += 1;
      data.settings.sync.lastBackupAt = 34567;
      globalThis.MyTabDeskUtils.markDirty();
      globalThis.MyTabDeskUtils.markSyncStateDirty(["lastBackupAt"]);
      await globalThis.MyTabDeskUtils.saveData({ skipAutoSync: true });
    });

    const mergedSync = await page.evaluate(async () => {
      const result = await chrome.storage.local.get("my_tab_desk_data");
      return result.my_tab_desk_data.settings.sync;
    });
    assert.equal(mergedSync.gistId, "gist-e2e-latest");
    assert.equal(mergedSync.autoSyncPendingAt, 12345);
    assert.equal(mergedSync.lastSyncAt, 23456);
    assert.equal(mergedSync.lastBackupAt, 34567);
    assert.equal(mergedSync.stateUpdatedAt > 0, true);
    await stalePage.close();

    // 页面 A 保存较新的同步配置后，旧页面 B 只改另一个字段时不能覆盖 A 的修改。
    await page.evaluate(async () => {
      document.querySelector("#webdavUsernameInput").value = "newer-user";
      await globalThis.MyTabDeskSync.saveSyncSettingsFromForm();
    });
    await staleSettingsPage.evaluate(async () => {
      document.querySelector("#gistFilenameInput").value = "other-change.json";
      await globalThis.MyTabDeskSync.saveSyncSettingsFromForm();
    });
    const syncAfterStaleForm = await page.evaluate(async () => {
      const result = await chrome.storage.local.get("my_tab_desk_data");
      return result.my_tab_desk_data.settings.sync;
    });
    assert.equal(syncAfterStaleForm.gistId, "gist-e2e-latest");
    assert.equal(syncAfterStaleForm.webdavUsername, "newer-user");
    assert.equal(syncAfterStaleForm.gistFilename, "other-change.json");
    await staleSettingsPage.close();

    // 设置页两个导出入口必须生成不同且语义明确的格式。
    await page.locator("#settingsBtn").click();
    await page.locator("#settingsView").waitFor({ state: "visible" });
    const nativeDownloadPromise = page.waitForEvent("download");
    await page.locator("#offlineExportBtn").click();
    const nativeDownload = await nativeDownloadPromise;
    const nativeDownloadPath = await nativeDownload.path();
    const nativeBackup = JSON.parse(fs.readFileSync(nativeDownloadPath, "utf8"));
    assert.equal(nativeBackup.format, "mytabdesk-backup");
    assert.match(nativeDownload.suggestedFilename(), /^mytabdesk-backup-/);

    const tabTabDownloadPromise = page.waitForEvent("download");
    await page.locator("#exportTabTabBtn").click();
    const tabTabDownload = await tabTabDownloadPromise;
    const tabTabBackup = JSON.parse(fs.readFileSync(await tabTabDownload.path(), "utf8"));
    assert.equal(Array.isArray(tabTabBackup.space_list), true);
    assert.equal(tabTabBackup.format, undefined);
    assert.match(tabTabDownload.suggestedFilename(), /^mytabdesk-tabtab-/);

    // 原生备份导入是用户确认后的原子覆盖；更新的本地墓碑不能阻止备份恢复链接。
    await page.evaluate(async () => {
      const result = await chrome.storage.local.get("my_tab_desk_data");
      const data = result.my_tab_desk_data;
      const active = data.spaces.find((space) => space.id === data.activeSpaceId && !space.deletedAt);
      const link = active.groups
        .filter((group) => !group.deletedAt)
        .flatMap((group) => group.links)
        .find((item) => item.url === "https://example.com/mytabdesk-e2e");
      const deletedAt = Date.now() + 10000;
      link.updatedAt = deletedAt;
      link.deletedAt = deletedAt;
      await chrome.storage.local.set({ my_tab_desk_data: data });
    });
    await page.locator("#importFileInput").setInputFiles(nativeDownloadPath);
    await page.locator("#appDialogConfirmBtn").click();
    await waitFor(async () => page.evaluate(async () => {
      const result = await chrome.storage.local.get("my_tab_desk_data");
      const data = result.my_tab_desk_data;
      const active = data.spaces.find((space) => space.id === data.activeSpaceId && !space.deletedAt);
      return active.groups
        .filter((group) => !group.deletedAt)
        .flatMap((group) => group.links)
        .some((link) => link.url === "https://example.com/mytabdesk-e2e" && !link.deletedAt);
    }), "原生备份导入未覆盖更新的本地墓碑");
    await page.locator("#appDialogConfirmBtn").click();

    await page.reload();
    await page.waitForSelector("#groupList");
    await waitFor(
      async () => (await page.locator("#groupList").textContent()).includes("E2E 后台保存"),
      "刷新扩展页面后保存数据未恢复"
    );
  } finally {
    if (context) await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function runTests() {
  await testLoadedExtensionPersistsWorkspaceAndConsumesBackgroundSave();
  console.log("Chromium 扩展端到端测试通过");
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
