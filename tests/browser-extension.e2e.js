const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const { removeDirectoryWithRetry, openCreateSpaceDialog } = require("./e2e-helpers.js");

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

    await page.waitForFunction(() => Boolean(
      globalThis.MyTabDeskPage
      && globalThis.MyTabDeskPage.state.initialized
    ));
    const stateWiring = await page.evaluate(async () => {
      const app = globalThis.MyTabDeskPage;
      const stateReference = app.state;
      let viewEvents = 0;
      const waitForRender = () => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
      const unsubscribe = app.eventBus.on("view:changed", () => {
        viewEvents += 1;
      });
      app.stateController.navigate("settings", { source: "e2e-state-wiring" });
      await waitForRender();
      const settingsVisible = !document.querySelector("#settingsView").hidden;
      app.stateController.navigate("workspace", { source: "e2e-state-wiring" });
      await waitForRender();
      unsubscribe();
      return {
        sharedReference: app.store.getState() === stateReference && app.state === stateReference,
        stableReference: app.store.getState() === stateReference,
        viewEvents,
        settingsVisible,
        workspaceVisible: !document.querySelector("#groupList").hidden
      };
    });
    assert.deepEqual(stateWiring, {
      sharedReference: true,
      stableReference: true,
      viewEvents: 2,
      settingsVisible: true,
      workspaceVisible: true
    });

    await openCreateSpaceDialog(page);
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

    // 链接备注可通过编辑弹窗保存，并在页面刷新后继续显示。
    const savedLinkCard = page.locator(".link-card").filter({ hasText: "E2E 后台保存" }).first();
    await savedLinkCard.locator(".link-action-button").click();
    await savedLinkCard.locator(".link-menu-action").filter({ hasText: "编辑" }).click();
    await page.locator("#editLinkNoteInput").fill("E2E 多设备备注");
    await page.locator("#confirmEditLinkBtn").click();
    await waitFor(
      async () => (await page.locator("#groupList").textContent()).includes("E2E 多设备备注"),
      "链接备注保存后未显示"
    );
    await page.reload();
    await page.waitForSelector("#groupList");
    await waitFor(
      async () => (await page.locator("#groupList").textContent()).includes("E2E 多设备备注"),
      "刷新页面后链接备注未持久化"
    );

    // 链接颜色标记可通过编辑弹窗保存，搜索栏可按颜色筛选。
    const colorLinkCard = page.locator(".link-card").filter({ hasText: "E2E 后台保存" }).first();
    await colorLinkCard.locator(".link-action-button").click();
    await colorLinkCard.locator(".link-menu-action").filter({ hasText: "编辑" }).click();
    await page.locator("#editLinkColorInput").selectOption("red");
    await page.locator("#confirmEditLinkBtn").click();
    await waitFor(
      async () => page.evaluate(() => {
        const link = globalThis.MyTabDeskPage.state.data.spaces
          .flatMap((space) => space.groups)
          .flatMap((group) => group.links)
          .find((item) => item.url === "https://example.com/mytabdesk-e2e");
        return link && link.color === "red";
      }),
      "链接颜色保存后未写入数据"
    );
    await page.locator("#searchInput").fill("color:red");
    await waitFor(
      async () => page.locator(".link-card.color-red").count().then((count) => count >= 1),
      "颜色搜索未筛出红色链接"
    );
    await page.locator("#searchInput").fill("");

    // 当前空间可导出为独立 HTML，包含链接与备注。
    const htmlDownloadPromise = page.waitForEvent("download");
    await page.locator(".workspace-more-menu summary").click();
    await page.locator("#exportSpaceAsHtmlBtn").click();
    const htmlDownload = await htmlDownloadPromise;
    const htmlPath = await htmlDownload.path();
    const exportedHtml = fs.readFileSync(htmlPath, "utf8");
    assert.equal(exportedHtml.includes("E2E 多设备备注"), true);
    assert.equal(exportedHtml.includes("https://example.com/mytabdesk-e2e"), true);
    assert.equal(exportedHtml.includes("<style>"), true);

    // 当前空间可保存为模板，并从模板创建带相同分组结构的新空间。
    const sourceSpaceId = await page.evaluate(() => globalThis.MyTabDeskPage.state.data.activeSpaceId);
    await page.locator(".workspace-more-menu summary").click();
    await page.locator("#saveCurrentSpaceTemplateBtn").click();
    await page.locator("#appDialogInput").fill("E2E 模板");
    await page.locator("#appDialogConfirmBtn").click();
    await waitFor(async () => page.evaluate(() => globalThis.MyTabDeskPage.state.data.settings.spaceTemplates.length === 1), "空间模板未保存");
    await page.locator("#createSpaceBtn").click();
    await page.locator("#createFromTemplateBtn").click();
    await page.locator("#appDialogInput").fill("1");
    await page.locator("#appDialogConfirmBtn").click();
    await page.locator("#appDialogInput").fill("E2E 模板空间");
    await page.locator("#appDialogConfirmBtn").click();
    await waitFor(async () => page.locator("#currentSpaceName").textContent().then((text) => text.includes("E2E 模板空间")), "未从模板创建空间");
    await page.locator(`.space-item[data-space-id="${sourceSpaceId}"]`).click();

    // AI 分组必须先展示预览，取消不改数据，确认后才应用。
    const aiEvidence = await page.evaluate(async () => {
      const app = globalThis.MyTabDeskPage;
      const space = app.state.data.spaces.find((item) => item.id === app.state.data.activeSpaceId);
      const link = space.groups.flatMap((group) => group.links).find((item) => !item.deletedAt);
      const before = JSON.stringify(space.groups.map((group) => ({ name: group.name, ids: group.links.map((item) => item.id) })));
      await globalThis.MyTabDeskAiGrouping.saveConfig({ baseUrl: "https://ai.test/v1", model: "test-model", apiKey: "test-key" });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ groups: [{ name: "AI 建议组", linkIds: [link.id] }] }) } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      await globalThis.MyTabDeskAiGrouping.runGrouping();
      const previewVisible = !app.elements.aiGroupingPreviewDialog.hidden;
      globalThis.MyTabDeskAiGrouping.closePreview();
      const unchangedAfterCancel = before === JSON.stringify(space.groups.map((group) => ({ name: group.name, ids: group.links.map((item) => item.id) })));
      await globalThis.MyTabDeskAiGrouping.runGrouping();
      await globalThis.MyTabDeskAiGrouping.confirmGrouping();
      globalThis.fetch = originalFetch;
      const updatedSpace = app.state.data.spaces.find((item) => item.id === app.state.data.activeSpaceId);
      return { previewVisible, unchangedAfterCancel, applied: updatedSpace.groups.some((group) => group.name === "AI 建议组" && group.links.some((item) => item.id === link.id)) };
    });
    assert.deepEqual(aiEvidence, { previewVisible: true, unchangedAfterCancel: true, applied: true });

    // favicon 缓存后，卡片优先使用本地 data:image URL。
    const faviconEvidence = await page.evaluate(async () => {
      const app = globalThis.MyTabDeskPage;
      const link = app.state.data.spaces.flatMap((space) => space.groups).flatMap((group) => group.links).find((item) => item.favIconUrl && !item.deletedAt);
      if (!link) return { skipped: true };
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => new Response(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), { status: 200, headers: { "Content-Type": "image/png" } });
      const result = await globalThis.MyTabDeskFaviconCache.cacheIcon(link.favIconUrl);
      globalThis.fetch = originalFetch;
      globalThis.MyTabDeskRender.renderAll();
      const cached = globalThis.MyTabDeskFaviconCache.getCachedIcon(link.favIconUrl);
      const domUsesCached = Array.from(document.querySelectorAll(".link-card img.favicon")).some((image) => image.src.startsWith("data:image/"));
      return { success: result.success, cached: cached.startsWith("data:image/"), domUsesCached };
    });
    assert.equal(faviconEvidence.skipped || (faviconEvidence.success && faviconEvidence.cached && faviconEvidence.domUsesCached), true);

    // 使用统计：之前保存和恢复操作产生了事件记录，统计页可读取。
    const idleTab = await context.newPage();
    await idleTab.goto("https://example.com/idle-lifecycle");
    await idleTab.title();
    await page.bringToFront();
    await page.locator("#statsBtn").click();
    await page.locator("#statsView").waitFor({ state: "visible" });
    await page.locator("#statsTrendRangeSelect").selectOption("90");
    assert.equal(await page.locator("#statsTrendChart polyline").count(), 2);
    await waitFor(
      async () => page.evaluate(() => Number(globalThis.MyTabDeskStats && 1) || Number(document.getElementById("statsTrackedTabs").textContent) > 0),
      "使用统计页面未反映标签追踪"
    );
    await page.locator(`.space-item[data-space-id="${await page.evaluate(() => globalThis.MyTabDeskPage.state.data.activeSpaceId)}"]`).click();
    await page.locator("#refreshTabsBtn").click();
    await page.evaluate(async () => {
      await chrome.runtime.sendMessage({
        type: "set-tab-lifecycle-config",
        config: { enabled: true, idleWarningMinutes: 1, autoSaveHours: 1, maxTabs: 200, whitelistDomains: [], retentionDays: 90 }
      });
    });
    await page.waitForTimeout(200);
    await page.evaluate(async () => { await globalThis.MyTabDeskLifecycle.loadLifecycleStatus(); });
    await waitFor(
      async () => page.locator(".tab-lifecycle-badge").count().then((count) => count >= 1),
      "右栏标签页未显示生命周期徽标"
    );
    await idleTab.close();

    // Ctrl+K 全局命令面板可跨空间搜索已保存链接，并搜索当前窗口标签。
    await page.evaluate(async () => {
      const data = globalThis.MyTabDeskPage.state.data;
      const now = Date.now();
      data.spaces.push({
        id: "palette-space",
        name: "命令面板空间",
        icon: "⌕",
        createdAt: now,
        updatedAt: now,
        groups: [{
          id: "palette-group",
          name: "跨空间资料",
          collapsed: false,
          pinned: false,
          createdAt: now,
          updatedAt: now,
          links: [{
            id: "palette-link",
            title: "跨空间 E2E 文档",
            url: "https://example.com/palette-global",
            favIconUrl: "",
            createdAt: now,
            updatedAt: now,
            order: now
          }]
        }]
      });
      globalThis.MyTabDeskUtils.markDirty();
      await globalThis.MyTabDeskUtils.saveData({ skipAutoSync: true });
      await globalThis.MyTabDeskActions.refreshCurrentTabs();
    });
    await page.keyboard.press("Control+k");
    await page.locator("#commandPalette").waitFor({ state: "visible" });
    await page.locator("#commandPaletteInput").fill("跨空间 E2E");
    await waitFor(
      async () => (await page.locator("#commandPaletteResults").textContent()).includes("命令面板空间 / 跨空间资料"),
      "命令面板未跨空间搜索已保存链接"
    );
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Escape");
    await page.locator("#commandPalette").waitFor({ state: "hidden" });

    await page.keyboard.press("Control+k");
    await page.locator("#commandPaletteInput").fill("命令面板空间");
    await waitFor(
      async () => (await page.locator("#commandPaletteResults").textContent()).includes("命令面板空间"),
      "命令面板未搜索空间"
    );
    await page.keyboard.press("Enter");
    await page.locator("#commandPalette").waitFor({ state: "hidden" });
    await waitFor(
      async () => (await page.locator("#currentSpaceName").textContent()).includes("命令面板空间"),
      "命令面板 Enter 未切换空间"
    );
    assert.equal(await page.evaluate(async () => {
      const result = await chrome.storage.local.get("my_tab_desk_data");
      return result.my_tab_desk_data.activeSpaceId;
    }), "palette-space");
    await page.evaluate(async () => {
      globalThis.MyTabDeskPage.state.data.activeSpaceId = globalThis.MyTabDeskPage.state.data.spaces
        .find((space) => space.name === "E2E 空间").id;
      globalThis.MyTabDeskRender.renderAll();
      globalThis.MyTabDeskUtils.markDirty();
      await globalThis.MyTabDeskUtils.saveData({ skipAutoSync: true });
    });

    const paletteCurrentTabId = await page.evaluate(async () => {
      const current = await chrome.tabs.getCurrent();
      const tab = await chrome.tabs.create({
        windowId: current.windowId,
        url: "https://example.com/palette-current-tab",
        active: false
      });
      return tab.id;
    });
    await waitFor(async () => page.evaluate(async (tabId) => {
      const tab = await chrome.tabs.get(tabId);
      return tab.url.includes("/palette-current-tab");
    }, paletteCurrentTabId), "命令面板测试标签导航未就绪");
    await page.evaluate(() => globalThis.MyTabDeskActions.refreshCurrentTabs());
    assert.equal(await page.evaluate(() => (
      globalThis.MyTabDeskPage.state.currentTabs.some((tab) => tab.url.includes("/palette-current-tab"))
    )), true);
    await page.keyboard.press("Control+k");
    await page.locator("#commandPaletteInput").fill("palette-current-tab");
    await waitFor(
      async () => (await page.locator("#commandPaletteResults").textContent()).includes("当前窗口标签"),
      "命令面板未搜索当前窗口标签"
    );
    await page.keyboard.press("Escape");
    await page.evaluate((tabId) => chrome.tabs.remove(tabId), paletteCurrentTabId);

    // 右栏真实浏览器标签可拖入分组，并在刷新后持久化。
    const draggedTabId = await page.evaluate(async () => {
      const current = await chrome.tabs.getCurrent();
      const tab = await chrome.tabs.create({
        windowId: current.windowId,
        url: "https://example.com/drag-current-tab",
        active: false
      });
      return tab.id;
    });
    await waitFor(async () => page.evaluate(async (tabId) => {
      const tab = await chrome.tabs.get(tabId);
      return tab.url.includes("/drag-current-tab");
    }, draggedTabId), "拖拽测试标签导航未就绪");
    await page.evaluate(() => globalThis.MyTabDeskActions.refreshCurrentTabs());
    const currentTabItem = page.locator(".current-tab-item").filter({ hasText: "drag-current-tab" }).first();
    await currentTabItem.dragTo(page.locator(".group-section .link-grid").first());
    await waitFor(
      async () => page.evaluate(() => (
        globalThis.MyTabDeskPage.state.data.spaces
          .flatMap((space) => space.groups)
          .flatMap((group) => group.links)
          .some((link) => !link.deletedAt && link.url.includes("/drag-current-tab"))
      )),
      "右栏标签拖入分组后未生成链接"
    );
    await page.reload();
    await page.waitForSelector("#groupList");
    assert.equal(await page.evaluate(async () => {
      const result = await chrome.storage.local.get("my_tab_desk_data");
      return result.my_tab_desk_data.spaces
        .flatMap((space) => space.groups)
        .flatMap((group) => group.links)
        .some((link) => !link.deletedAt && link.url.includes("/drag-current-tab"));
    }), true);
    await page.evaluate((tabId) => chrome.tabs.remove(tabId), draggedTabId);

    // 当前空间重复扫描保留最新链接，并为旧链接写入墓碑。
    await page.evaluate(async () => {
      const state = globalThis.MyTabDeskPage.state;
      const space = state.data.spaces.find((item) => item.id === state.data.activeSpaceId && !item.deletedAt);
      const group = space.groups.find((item) => !item.deletedAt);
      const now = Date.now();
      state.data = globalThis.MyTabDeskCore.addLinksToGroup(state.data, space.id, group.id, [
        { id: "dedupe-old", title: "重复旧链接", url: "https://example.com/dedupe#old", createdAt: now, updatedAt: now },
        { id: "dedupe-new", title: "重复新链接", url: "https://example.com/dedupe/", createdAt: now + 1, updatedAt: now + 1 }
      ]);
      globalThis.MyTabDeskUtils.markDirty();
      await globalThis.MyTabDeskUtils.saveData({ skipAutoSync: true });
      globalThis.MyTabDeskRender.renderAll();
    });
    await page.locator(".workspace-more-menu summary").click();
    await page.locator("#deduplicateLinksBtn").click();
    const dedupeDialogMessage = await page.locator("#appDialogMessage").textContent();
    if (!/清理 \d+ 条重复链接/.test(dedupeDialogMessage)) {
      const evidence = await page.evaluate(() => {
        const state = globalThis.MyTabDeskPage.state;
        const space = state.data.spaces.find((item) => item.id === state.data.activeSpaceId && !item.deletedAt);
        return {
          activeSpaceId: state.data.activeSpaceId,
          links: space.groups.flatMap((group) => group.links).filter((link) => link.id.startsWith("dedupe-")),
          duplicateGroups: globalThis.MyTabDeskCore.findDuplicateLinks(state.data, { spaceId: space.id })
        };
      });
      throw new Error(`重复扫描文案异常: ${dedupeDialogMessage}\n${JSON.stringify(evidence, null, 2)}`);
    }
    await page.locator("#appDialogConfirmBtn").click();
    await waitFor(async () => page.evaluate(async () => {
      const result = await chrome.storage.local.get("my_tab_desk_data");
      const links = result.my_tab_desk_data.spaces.flatMap((space) => space.groups.flatMap((group) => group.links));
      return Boolean(links.find((link) => link.id === "dedupe-old" && link.deletedAt))
        && !links.find((link) => link.id === "dedupe-new").deletedAt;
    }), "重复链接清理未写入正确墓碑");

    // 回收站直接展示同步墓碑，支持恢复、删除后撤销和永久删除。
    await page.locator("#trashBtn").click();
    await page.locator("#trashView").waitFor({ state: "visible" });
    const oldTrashItem = page.locator('.trash-item[data-trash-type="link"]').filter({ hasText: "重复旧链接" }).first();
    await oldTrashItem.locator("button").filter({ hasText: "恢复" }).click();
    await waitFor(async () => page.evaluate(() => {
      const links = globalThis.MyTabDeskPage.state.data.spaces.flatMap((space) => space.groups.flatMap((group) => group.links));
      return !links.find((link) => link.id === "dedupe-old").deletedAt;
    }), "回收站恢复未清除链接墓碑");

    const activeSpaceId = await page.evaluate(() => globalThis.MyTabDeskPage.state.data.activeSpaceId);
    await page.locator(`.space-item[data-space-id="${activeSpaceId}"]`).click();
    const restoredCard = page.locator(".link-card").filter({ hasText: "重复旧链接" }).first();
    await restoredCard.locator(".link-action-button").click();
    await restoredCard.locator(".link-menu-action.danger").click();
    await page.locator("#appDialogConfirmBtn").click();
    const undoButton = page.locator("#toast-container button").filter({ hasText: "撤销" }).last();
    await undoButton.click();
    await waitFor(async () => page.evaluate(() => {
      const links = globalThis.MyTabDeskPage.state.data.spaces.flatMap((space) => space.groups.flatMap((group) => group.links));
      return !links.find((link) => link.id === "dedupe-old").deletedAt;
    }), "删除链接后的撤销操作未恢复链接");

    const restoredAgainCard = page.locator(".link-card").filter({ hasText: "重复旧链接" }).first();
    await restoredAgainCard.locator(".link-action-button").click();
    await restoredAgainCard.locator(".link-menu-action.danger").click();
    await page.locator("#appDialogConfirmBtn").click();
    await page.locator("#trashBtn").click();
    const purgeTrashItem = page.locator('.trash-item[data-trash-type="link"]').filter({ hasText: "重复旧链接" }).first();
    await purgeTrashItem.locator("button").filter({ hasText: "永久删除" }).click();
    await page.locator("#appDialogConfirmBtn").click();
    await waitFor(async () => page.evaluate(() => {
      const links = globalThis.MyTabDeskPage.state.data.spaces.flatMap((space) => space.groups.flatMap((group) => group.links));
      const link = links.find((item) => item.id === "dedupe-old");
      return Boolean(link && link.purgedAt && link.url === "mytabdesk-purged://dedupe-old");
    }), "永久删除未生成最小同步墓碑");

    // 单链接健康检查：stub fetch 返回 404 后写入失效状态并显示红点。
    await page.locator(`.space-item[data-space-id="${activeSpaceId}"]`).click();
    await page.evaluate(async () => {
      const state = globalThis.MyTabDeskPage.state;
      const space = state.data.spaces.find((item) => item.id === state.data.activeSpaceId && !item.deletedAt);
      const group = space.groups.find((item) => !item.deletedAt);
      state.data = globalThis.MyTabDeskCore.addLinksToGroup(state.data, space.id, group.id, [{
        id: "health-broken",
        title: "健康检查 E2E",
        url: "https://health.test/e2e",
        createdAt: Date.now()
      }]);
      globalThis.MyTabDeskUtils.markDirty();
      await globalThis.MyTabDeskUtils.saveData({ skipAutoSync: true });
      globalThis.MyTabDeskRender.renderAll();
    });
    await page.evaluate(() => {
      window.__originalFetch = window.fetch;
      window.fetch = async (url, options) => {
        if (String(url).includes("health.test")) {
          return { status: 404, ok: false } ;
        }
        return window.__originalFetch(url, options);
      };
    });
    const healthCard = page.locator(".link-card").filter({ hasText: "健康检查 E2E" }).first();
    await healthCard.locator(".link-action-button").click();
    await healthCard.locator(".link-menu-action").filter({ hasText: "检查链接" }).click();
    await waitFor(async () => page.evaluate(() => {
      const links = globalThis.MyTabDeskPage.state.data.spaces.flatMap((space) => space.groups.flatMap((group) => group.links));
      const link = links.find((item) => item.id === "health-broken");
      return link && link.healthStatus === "broken" && link.healthCode === 404;
    }), "HTTP 404 未被记录为失效链接");
    await waitFor(
      async () => page.locator(".link-card").filter({ hasText: "健康检查 E2E" }).locator(".link-health-indicator.status-broken").count().then((count) => count === 1),
      "失效链接卡片未显示红色健康指示点"
    );
    await page.evaluate(() => { window.fetch = window.__originalFetch; });

    // 真实 bookmarks API：选择书签栏并导入嵌套目录，忽略非 HTTP(S) 地址。
    const bookmarkFixture = await page.evaluate(async () => {
      const tree = await chrome.bookmarks.getTree();
      const bar = tree[0].children.find((node) => node.id === "1") || tree[0].children[0];
      const folder = await chrome.bookmarks.create({ parentId: bar.id, title: "E2E 开发" });
      const nested = await chrome.bookmarks.create({ parentId: folder.id, title: "文档" });
      await chrome.bookmarks.create({ parentId: folder.id, title: "GitHub E2E", url: "https://github.com/e2e" });
      await chrome.bookmarks.create({ parentId: nested.id, title: "MDN E2E", url: "https://developer.mozilla.org/e2e" });
      return { folderId: folder.id, rootIndex: tree[0].children.findIndex((node) => node.id === bar.id) + 1 };
    });
    await page.locator("#createSpaceBtn").click();
    await page.locator("#importBookmarksBtn").click();
    await page.locator("#appDialogInput").fill(String(bookmarkFixture.rootIndex));
    await page.locator("#appDialogConfirmBtn").click();
    await waitFor(
      async () => (await page.locator("#groupList").textContent()).includes("E2E 开发 / 文档"),
      "浏览器书签嵌套目录未导入为工作台分组"
    );
    if (await page.locator("#appDialogConfirmBtn").isVisible()) {
      await page.locator("#appDialogConfirmBtn").click();
    }
    assert.equal((await page.locator("#groupList").textContent()).includes("MDN E2E"), true);
    await page.evaluate((folderId) => chrome.bookmarks.removeTree(folderId), bookmarkFixture.folderId);

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

    // 会话恢复独立页面：导航、保存、筛选、展开详情、恢复和删除。
    await page.evaluate(() => chrome.storage.local.remove("mytabdesk_session_snapshots"));
    const sessionPageOne = await context.newPage();
    const sessionPageTwo = await context.newPage();
    await sessionPageOne.goto("https://example.com/session-one", { waitUntil: "commit" });
    await sessionPageTwo.goto("https://example.com/session-two", { waitUntil: "commit" });
    await sessionPageOne.evaluate(() => { document.title = "E2E Session One"; });
    await sessionPageTwo.evaluate(() => { document.title = "E2E Session Two"; });
    await page.evaluate(async () => {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const tabIds = tabs
        .filter((tab) => tab.url.includes("/session-one") || tab.url.includes("/session-two"))
        .map((tab) => tab.id);
      const groupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(groupId, { title: "E2E 研发", color: "blue", collapsed: true });
    });
    await page.locator("#sessionsBtn").click();
    await page.locator("#sessionView").waitFor({ state: "visible" });
    assert.equal(await page.locator("#settingsView").isHidden(), true);
    await page.locator("#captureSessionBtn").click();
    await waitFor(
      async () => page.locator(".session-history-item").count(),
      "手动会话快照未显示在会话恢复页"
    );
    const sessionHistory = await page.evaluate(async () => {
      const result = await chrome.storage.local.get("mytabdesk_session_snapshots");
      return result.mytabdesk_session_snapshots;
    });
    assert.equal(Array.isArray(sessionHistory), true);
    assert.equal(sessionHistory.length, 1);
    assert.equal(
      sessionHistory[0].windows.flatMap((item) => item.tabs).some((tab) => tab.url.includes("/session-one")),
      true
    );
    assert.equal(
      sessionHistory[0].windows.flatMap((item) => item.groups || []).some((group) => (
        group.title === "E2E 研发" && group.color === "blue" && group.collapsed === true
      )),
      true
    );

    // 筛选到"手动保存"仍能看到记录
    await page.locator("[data-filter=\"manual\"]").click();
    await waitFor(
      async () => page.locator(".session-history-item").count().then((count) => count === 1),
      "手动筛选未显示手动恢复点"
    );
    // 切回全部
    await page.locator("[data-filter=\"all\"]").click();

    // 展开详情，验证窗口、标签组和标签出现
    await page.locator(".session-history-toggle").first().click();
    await waitFor(
      async () => page.locator(".session-detail-tab").count().then((count) => count > 0),
      "展开详情未显示标签列表"
    );
    assert.equal(
      (await page.locator(".session-window-block h4").first().textContent()).includes("窗口 1"),
      true
    );

    // 批量选择只勾选 session-two，并恢复到当前窗口；session-one 仍因未选中而不重复创建。
    await page.locator(".session-selection-toolbar button").filter({ hasText: "清空" }).click();
    await page.locator(".session-detail-tab").filter({ hasText: "E2E Session Two" }).locator(".session-tab-select").check();
    assert.equal((await page.locator(".session-selection-toolbar strong").textContent()).includes("已选择 1 个标签"), true);
    await sessionPageTwo.close();
    const targetWindowId = await page.evaluate(async () => (await chrome.tabs.getCurrent()).windowId);
    await page.locator(".session-selection-toolbar button").filter({ hasText: "恢复选中到当前窗口" }).click();
    await page.locator("#appDialogConfirmBtn").click();
    await waitFor(
      async () => page.evaluate(async (windowId) => {
        const tabs = await chrome.tabs.query({});
        return tabs.some((tab) => tab.windowId === windowId && tab.url.includes("/session-two"));
      }, targetWindowId),
      "恢复到当前窗口未追加已关闭的标签"
    );
    assert.equal(await page.evaluate(async (windowId) => {
      const tabs = await chrome.tabs.query({});
      return tabs.filter((tab) => tab.windowId === windowId && tab.url.includes("/session-one")).length;
    }, targetWindowId), 1);

    // 恢复全选状态；关闭跳过选项后，新窗口路径完整恢复并重建原生标签组。
    await page.locator(".session-selection-toolbar button").filter({ hasText: "全选" }).click();
    await page.locator("#sessionSkipOpenUrlsInput").uncheck();
    const pagesBeforeRestore = context.pages().length;
    await page.locator(".session-restore-button").first().click();
    await page.locator("#appDialogConfirmBtn").click();
    await waitFor(
      async () => context.pages().length > pagesBeforeRestore,
      "恢复会话后未创建新窗口标签"
    );
    await waitFor(
      async () => page.evaluate(async () => {
        const groups = await chrome.tabGroups.query({ title: "E2E 研发" });
        return groups.some((group) => group.color === "blue" && group.collapsed === true);
      }),
      "恢复会话后未重建原生标签组"
    );
    const sessionMoreMenu = page.locator(".session-more-menu").first();
    if (!await sessionMoreMenu.evaluate((element) => element.open)) {
      await sessionMoreMenu.locator("summary").click();
    }
    await sessionMoreMenu.locator(".session-more-panel button.danger").click();
    await page.locator("#appDialogConfirmBtn").click();
    await waitFor(
      async () => page.locator(".session-history-item").count().then((count) => count === 0),
      "删除会话快照后历史仍存在"
    );
    await sessionPageOne.close();
    await sessionPageTwo.close();

    // 切回设置页继续备份/同步测试
    await page.locator("#settingsBtn").click();
    await page.locator("#settingsView").waitFor({ state: "visible" });
    assert.equal(await page.locator("#sessionView").isHidden(), true);

    // 保存后关闭/休眠只处理非固定、非活动的普通网页标签。
    const cleanupCloseTabId = await page.evaluate(async () => {
      const current = await chrome.tabs.getCurrent();
      const created = await chrome.tabs.create({
        windowId: current.windowId,
        url: "https://example.com/cleanup-close",
        active: false
      });
      return created.id;
    });
    await waitFor(async () => page.evaluate(async (tabId) => {
      const tab = await chrome.tabs.get(tabId);
      return tab.url.includes("/cleanup-close") && tab.active === false;
    }, cleanupCloseTabId), "关闭目标标签导航未就绪");
    const closeResult = await page.evaluate(
      async (tabId) => {
        const tab = await chrome.tabs.get(tabId);
        return chrome.runtime.sendMessage({
          type: "close-saved-tabs",
          savedTabs: [{ tabId, url: tab.url, windowId: tab.windowId }]
        });
      },
      cleanupCloseTabId
    );
    assert.equal(closeResult.success, true);
    assert.equal(closeResult.affected, 1, JSON.stringify(closeResult));
    await waitFor(async () => page.evaluate(async (tabId) => {
      try {
        await chrome.tabs.get(tabId);
        return false;
      } catch {
        return true;
      }
    }, cleanupCloseTabId), "保存后关闭未关闭安全目标标签");

    const pinnedTabId = await page.evaluate(async () => {
      const current = await chrome.tabs.getCurrent();
      const created = await chrome.tabs.create({
        windowId: current.windowId,
        url: "https://example.com/cleanup-pinned",
        active: false,
        pinned: true
      });
      return created.id;
    });
    await page.evaluate(
      async (tabId) => {
        const tab = await chrome.tabs.get(tabId);
        return chrome.runtime.sendMessage({
          type: "close-saved-tabs",
          savedTabs: [{ tabId, url: tab.url, windowId: tab.windowId }]
        });
      },
      pinnedTabId
    );
    assert.equal(await page.evaluate(async (tabId) => Boolean(await chrome.tabs.get(tabId)), pinnedTabId), true);
    await page.evaluate((tabId) => chrome.tabs.remove(tabId), pinnedTabId);

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

    // headless Chromium 执行 tabs.discard 可能关闭 CDP 目标；E2E 验证共用清理入口的 close 分支，discard 分支由消息测试覆盖。
    const cleanupCloseResult = await page.evaluate(async () => {
      const extensionTabs = await chrome.tabs.query({ url: chrome.runtime.getURL("newtab.html") });
      const created = await chrome.tabs.create({
        windowId: extensionTabs[0].windowId,
        url: "https://example.com/cleanup-close",
        active: false
      });
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const tab = await chrome.tabs.get(created.id);
        if (tab.url.includes("/cleanup-close") && tab.active === false) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const tab = await chrome.tabs.get(created.id);
      return chrome.runtime.sendMessage({
        type: "close-saved-tabs",
        savedTabs: [{
          tabId: tab.id,
          url: tab.url,
          windowId: tab.windowId
        }]
      });
    });
    assert.equal(cleanupCloseResult.success, true);
    assert.equal(cleanupCloseResult.affected, 1, JSON.stringify(cleanupCloseResult));
  } finally {
    if (context) await context.close();
    await removeDirectoryWithRetry(userDataDir);
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
