(function (root) {
  const sessionState = {
    snapshots: [],
    loading: false,
    filter: "all",
    searchKeyword: "",
    expandedIds: new Set(),
    selectedTabKeysBySnapshot: new Map(),
    limit: 50
  };

  function getAllSnapshotTabKeys(snapshot) {
    return (snapshot.windows || []).flatMap((browserWindow, windowIndex) => (
      (browserWindow.tabs || []).map((_tab, tabIndex) => `${windowIndex}:${tabIndex}`)
    ));
  }

  function getSelectedTabKeys(snapshot) {
    if (!sessionState.selectedTabKeysBySnapshot.has(snapshot.id)) {
      sessionState.selectedTabKeysBySnapshot.set(snapshot.id, new Set(getAllSnapshotTabKeys(snapshot)));
    }
    return sessionState.selectedTabKeysBySnapshot.get(snapshot.id);
  }

  function getElements() {
    return {
      captureButton: document.getElementById("captureSessionBtn"),
      list: document.getElementById("sessionHistoryList"),
      searchInput: document.getElementById("sessionSearchInput"),
      skipOpenUrlsInput: document.getElementById("sessionSkipOpenUrlsInput"),
      filterTabs: document.getElementById("sessionFilterTabs"),
      latestValue: document.getElementById("sessionLatestValue"),
      countValue: document.getElementById("sessionCountValue"),
      limitInput: document.getElementById("sessionLimitInput"),
      webdavUrlInput: document.getElementById("sessionWebdavUrlInput"),
      webdavUsernameInput: document.getElementById("sessionWebdavUsernameInput"),
      webdavPasswordInput: document.getElementById("sessionWebdavPasswordInput"),
      webdavFilenameInput: document.getElementById("sessionWebdavFilenameInput"),
      webdavSyncSwitch: document.getElementById("sessionWebdavSyncSwitch"),
      uploadBtn: document.getElementById("sessionUploadBtn"),
      downloadBtn: document.getElementById("sessionDownloadBtn")
    };
  }

  function formatSnapshotSummary(snapshot) {
    const windows = Array.isArray(snapshot.windows) ? snapshot.windows : [];
    const tabCount = windows.reduce((total, item) => total + (Array.isArray(item.tabs) ? item.tabs.length : 0), 0);
    const groupCount = windows.reduce((total, item) => total + (Array.isArray(item.groups) ? item.groups.length : 0), 0);
    return `${windows.length} 个窗口 · ${tabCount} 个标签 · ${groupCount} 个标签组`;
  }

  function formatReason(reason) {
    return ({ manual: "手动", interval: "自动", startup: "启动恢复点" })[reason] || "自动";
  }

  function isManualSnapshot(snapshot) {
    return snapshot.reason === "manual";
  }

  function getDateKey(timestamp) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }

  function getDateLabel(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (getDateKey(date) === getDateKey(today)) return "今天";
    if (getDateKey(date) === getDateKey(yesterday)) return "昨天";
    return date.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" });
  }

  function groupSnapshotsByDate(snapshots) {
    const groups = [];
    for (const snapshot of snapshots) {
      const key = getDateKey(snapshot.createdAt);
      let group = groups.find((item) => item.key === key);
      if (!group) {
        group = { key, label: getDateLabel(snapshot.createdAt), snapshots: [] };
        groups.push(group);
      }
      group.snapshots.push(snapshot);
    }
    return groups;
  }

  function getSearchText(snapshot) {
    return (snapshot.windows || []).flatMap((browserWindow) => [
      ...(browserWindow.tabs || []).flatMap((tab) => [tab.title, tab.url]),
      ...(browserWindow.groups || []).map((group) => group.title)
    ]).filter(Boolean).join(" ").toLowerCase();
  }

  function getVisibleSnapshots() {
    const keyword = sessionState.searchKeyword.trim().toLowerCase();
    return sessionState.snapshots.filter((snapshot) => {
      const filterMatches = sessionState.filter === "all"
        || (sessionState.filter === "manual" ? isManualSnapshot(snapshot) : !isManualSnapshot(snapshot));
      return filterMatches && (!keyword || getSearchText(snapshot).includes(keyword));
    });
  }

  function getHostname(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url || "未知页面";
    }
  }

  function updateSessionSummary() {
    const { latestValue, countValue, limitInput } = getElements();
    if (countValue) countValue.textContent = String(sessionState.snapshots.length);
    if (limitInput && document.activeElement !== limitInput) limitInput.value = String(sessionState.limit);
    if (latestValue) {
      latestValue.textContent = sessionState.snapshots[0]
        ? new Date(sessionState.snapshots[0].createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : "暂无";
    }
  }

  function createSnapshotDetails(snapshot) {
    const details = document.createElement("div");
    details.className = "session-snapshot-details";
    details.hidden = !sessionState.expandedIds.has(snapshot.id);
    const selectedKeys = getSelectedTabKeys(snapshot);
    const toolbar = document.createElement("div");
    toolbar.className = "session-selection-toolbar";
    const summary = document.createElement("strong");
    summary.textContent = `已选择 ${selectedKeys.size} 个标签`;
    const selectAll = document.createElement("button");
    selectAll.type = "button";
    selectAll.textContent = "全选";
    selectAll.addEventListener("click", () => {
      sessionState.selectedTabKeysBySnapshot.set(snapshot.id, new Set(getAllSnapshotTabKeys(snapshot)));
      renderSessionHistory();
    });
    const clearAll = document.createElement("button");
    clearAll.type = "button";
    clearAll.textContent = "清空";
    clearAll.addEventListener("click", () => {
      sessionState.selectedTabKeysBySnapshot.set(snapshot.id, new Set());
      renderSessionHistory();
    });
    const restoreNew = document.createElement("button");
    restoreNew.type = "button";
    restoreNew.textContent = "恢复选中到新窗口";
    restoreNew.addEventListener("click", () => restoreSnapshot(snapshot.id, "new"));
    const restoreCurrent = document.createElement("button");
    restoreCurrent.type = "button";
    restoreCurrent.textContent = "恢复选中到当前窗口";
    restoreCurrent.addEventListener("click", () => restoreSnapshot(snapshot.id, "current"));
    toolbar.append(summary, selectAll, clearAll, restoreNew, restoreCurrent);
    details.appendChild(toolbar);

    (snapshot.windows || []).forEach((browserWindow, windowIndex) => {
      const windowBlock = document.createElement("section");
      windowBlock.className = "session-window-block";
      const heading = document.createElement("h4");
      heading.textContent = `窗口 ${windowIndex + 1} · ${(browserWindow.tabs || []).length} 个标签`;
      windowBlock.appendChild(heading);

      const groups = new Map((browserWindow.groups || []).map((group) => [group.sourceGroupId, group]));
      const buckets = [];
      (browserWindow.tabs || []).forEach((tab, tabIndex) => {
        const group = groups.get(tab.sourceGroupId);
        const key = group ? `group-${group.sourceGroupId}` : "ungrouped";
        let bucket = buckets.find((item) => item.key === key);
        if (!bucket) {
          bucket = { key, title: group && group.title || "未分组", color: group && group.color || "grey", tabs: [] };
          buckets.push(bucket);
        }
        bucket.tabs.push({ tab, tabIndex });
      });

      for (const bucket of buckets) {
        const groupBlock = document.createElement("div");
        groupBlock.className = "session-detail-group";
        const groupTitle = document.createElement("div");
        groupTitle.className = "session-detail-group-title";
        const color = document.createElement("i");
        color.className = `session-group-color color-${bucket.color}`;
        const name = document.createElement("strong");
        name.textContent = `${bucket.title} (${bucket.tabs.length})`;
        groupTitle.append(color, name);
        groupBlock.appendChild(groupTitle);

        for (const item of bucket.tabs) {
          const { tab, tabIndex } = item;
          const tabKey = `${windowIndex}:${tabIndex}`;
          const tabRow = document.createElement("label");
          tabRow.className = "session-detail-tab";
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.className = "session-tab-select";
          checkbox.checked = selectedKeys.has(tabKey);
          checkbox.addEventListener("change", () => {
            if (checkbox.checked) selectedKeys.add(tabKey);
            else selectedKeys.delete(tabKey);
            renderSessionHistory();
          });
          const marker = document.createElement("span");
          marker.className = "session-tab-marker";
          marker.textContent = tab.pinned ? "◆" : "";
          const text = document.createElement("span");
          text.textContent = tab.title || getHostname(tab.url);
          const domain = document.createElement("small");
          domain.textContent = getHostname(tab.url);
          tabRow.append(checkbox, marker, text, domain);
          groupBlock.appendChild(tabRow);
        }
        windowBlock.appendChild(groupBlock);
      }
      details.appendChild(windowBlock);
    });
    return details;
  }

  function toggleSnapshotDetails(snapshotId) {
    if (sessionState.expandedIds.has(snapshotId)) sessionState.expandedIds.delete(snapshotId);
    else sessionState.expandedIds.add(snapshotId);
    renderSessionHistory();
  }

  function createSnapshotRow(snapshot) {
    const row = document.createElement("article");
    row.className = "session-history-item";
    row.dataset.snapshotId = snapshot.id;

    const main = document.createElement("div");
    main.className = "session-history-main";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "session-history-toggle";
    toggle.setAttribute("aria-expanded", sessionState.expandedIds.has(snapshot.id) ? "true" : "false");
    toggle.addEventListener("click", () => toggleSnapshotDetails(snapshot.id));
    const time = document.createElement("strong");
    time.className = "session-history-time";
    time.textContent = new Date(snapshot.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const title = document.createElement("span");
    title.className = "session-history-label";
    title.textContent = `${formatReason(snapshot.reason)}恢复点`;
    const meta = document.createElement("span");
    meta.className = "session-history-meta";
    meta.textContent = formatSnapshotSummary(snapshot);
    const preview = document.createElement("span");
    preview.className = "session-history-preview";
    preview.textContent = (snapshot.windows || []).flatMap((item) => item.tabs || []).slice(0, 4)
      .map((tab) => tab.title || getHostname(tab.url)).join(" · ") || "暂无可预览标签";
    toggle.append(time, title, meta, preview);

    const actions = document.createElement("div");
    actions.className = "session-history-actions";
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "primary-button session-restore-button";
    restore.textContent = "恢复";
    restore.addEventListener("click", () => restoreSnapshot(snapshot.id, "new"));
    const more = document.createElement("details");
    more.className = "session-more-menu";
    const summary = document.createElement("summary");
    summary.setAttribute("aria-label", "恢复点更多操作");
    summary.textContent = "···";
    const menu = document.createElement("div");
    menu.className = "session-more-panel";
    const view = document.createElement("button");
    view.type = "button";
    view.textContent = sessionState.expandedIds.has(snapshot.id) ? "收起详情" : "查看详情";
    view.addEventListener("click", () => toggleSnapshotDetails(snapshot.id));
    const restoreCurrent = document.createElement("button");
    restoreCurrent.type = "button";
    restoreCurrent.textContent = "恢复到当前窗口";
    restoreCurrent.addEventListener("click", () => restoreSnapshot(snapshot.id, "current"));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "删除恢复点";
    remove.addEventListener("click", () => deleteSnapshot(snapshot.id));
    menu.append(restoreCurrent, view, remove);
    more.append(summary, menu);
    actions.append(restore, more);
    main.append(toggle, actions);
    row.append(main, createSnapshotDetails(snapshot));
    return row;
  }

  function renderSessionHistory() {
    const { list } = getElements();
    if (!list) return;
    list.replaceChildren();
    updateSessionSummary();

    if (sessionState.loading) {
      const loading = document.createElement("p");
      loading.className = "settings-row-desc";
      loading.textContent = "正在读取会话历史...";
      list.appendChild(loading);
      return;
    }

    if (sessionState.snapshots.length === 0) {
      const empty = document.createElement("div");
      empty.className = "session-empty-state";
      const title = document.createElement("strong");
      title.textContent = "还没有会话恢复点";
      const text = document.createElement("span");
      text.textContent = "打开一些网页后创建第一个恢复点，之后 MyTabDesk 会每 15 分钟自动保护。";
      empty.append(title, text);
      list.appendChild(empty);
      return;
    }

    const visibleSnapshots = getVisibleSnapshots();
    if (visibleSnapshots.length === 0) {
      const empty = document.createElement("div");
      empty.className = "session-empty-state compact";
      empty.textContent = "没有符合当前筛选条件的恢复点。";
      list.appendChild(empty);
      return;
    }

    for (const dateGroup of groupSnapshotsByDate(visibleSnapshots)) {
      const section = document.createElement("section");
      section.className = "session-date-group";
      const heading = document.createElement("h3");
      heading.textContent = dateGroup.label;
      const rows = document.createElement("div");
      rows.className = "session-date-list";
      dateGroup.snapshots.forEach((snapshot) => rows.appendChild(createSnapshotRow(snapshot)));
      section.append(heading, rows);
      list.appendChild(section);
    }
  }

  async function loadSessionHistory() {
    sessionState.loading = true;
    renderSessionHistory();
    try {
      const response = await chrome.runtime.sendMessage({ type: "list-session-snapshots" });
      sessionState.snapshots = Array.isArray(response && response.snapshots) ? response.snapshots : [];
      if (response && Number.isInteger(response.limit)) sessionState.limit = response.limit;
    } finally {
      sessionState.loading = false;
      renderSessionHistory();
    }
  }

  async function captureSessionNow() {
    const { captureButton } = getElements();
    if (captureButton) captureButton.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: "capture-session-now" });
      if (!response || !response.success) throw new Error(response && response.error || "保存会话失败");
      await loadSessionHistory();
      root.MyTabDeskNotifications.showToast(response.duplicate ? "当前会话没有变化" : "会话快照已保存", "success");
    } catch (error) {
      root.MyTabDeskNotifications.showToast(error.message || "保存会话失败", "error");
    } finally {
      if (captureButton) captureButton.disabled = false;
    }
  }

  async function restoreSnapshot(snapshotId, restoreTo = "new") {
    const selectedTabKeys = sessionState.selectedTabKeysBySnapshot.has(snapshotId)
      ? Array.from(sessionState.selectedTabKeysBySnapshot.get(snapshotId))
      : undefined;
    if (selectedTabKeys && selectedTabKeys.length === 0) {
      root.MyTabDeskNotifications.showToast("请至少选择一个要恢复的标签", "error");
      return;
    }
    const isCurrent = restoreTo === "current";
    const message = isCurrent
      ? "将在当前窗口中追加这条会话，当前标签不会被关闭。"
      : "将在新窗口中恢复这条会话，当前窗口不会被关闭。";
    const confirmed = await root.MyTabDeskDialogs.showConfirm(message, "恢复会话");
    if (!confirmed) return;

    let targetWindowId;
    if (isCurrent) {
      const currentTab = await chrome.tabs.getCurrent();
      targetWindowId = currentTab && currentTab.windowId;
    }
    const { skipOpenUrlsInput } = getElements();
    const response = await chrome.runtime.sendMessage({
      type: "restore-session-snapshot",
      snapshotId,
      restoreTo,
      targetWindowId,
      skipOpenUrls: Boolean(skipOpenUrlsInput && skipOpenUrlsInput.checked),
      selectedTabKeys
    });
    if (response && response.success) {
      const skipped = response.skippedTabs ? `，跳过 ${response.skippedTabs} 个已打开页面` : "";
      root.MyTabDeskNotifications.showToast(
        `已恢复 ${response.restoredTabs || 0} 个标签${skipped}`,
        "success"
      );
      return;
    }
    root.MyTabDeskNotifications.showToast(response && response.error || "恢复会话失败", "error");
  }

  async function deleteSnapshot(snapshotId) {
    const confirmed = await root.MyTabDeskDialogs.showConfirm("确定删除这条本机会话快照吗？", "删除会话快照");
    if (!confirmed) return;
    const response = await chrome.runtime.sendMessage({ type: "delete-session-snapshot", snapshotId });
    if (response && response.success) await loadSessionHistory();
  }

  /**
   * 会话恢复独立 WebDAV 同步配置在 chrome.storage.local 中的存储键。
   * 独立于工作台数据同步配置，使用单独的地址/用户名/密码/文件名。
   */
  const SESSION_SYNC_CONFIG_KEY = "mytabdesk_session_sync_config";

  /**
   * 读取当前会话同步表单中的配置值。
   *
   * @returns {object} 表单中的会话同步配置对象。
   */
  function readSessionSyncForm() {
    const {
      webdavUrlInput,
      webdavUsernameInput,
      webdavPasswordInput,
      webdavFilenameInput,
      webdavSyncSwitch
    } = getElements();
    return {
      webdavUrl: webdavUrlInput ? webdavUrlInput.value.trim() : "",
      webdavUsername: webdavUsernameInput ? webdavUsernameInput.value.trim() : "",
      webdavPassword: webdavPasswordInput ? webdavPasswordInput.value : "",
      webdavFilename: webdavFilenameInput ? webdavFilenameInput.value.trim() : "",
      autoSyncEnabled: webdavSyncSwitch ? webdavSyncSwitch.checked : false
    };
  }

  /**
   * 从 chrome.storage.local 读取会话同步配置并回填表单。
   *
   * @returns {Promise<void>} 配置回填完成后结束。
   */
  async function loadSessionSyncConfig() {
    const {
      webdavUrlInput,
      webdavUsernameInput,
      webdavPasswordInput,
      webdavFilenameInput,
      webdavSyncSwitch
    } = getElements();
    const result = await chrome.storage.local.get(SESSION_SYNC_CONFIG_KEY);
    const config = result && result[SESSION_SYNC_CONFIG_KEY] ? result[SESSION_SYNC_CONFIG_KEY] : {};
    if (webdavUrlInput) webdavUrlInput.value = config.webdavUrl || "";
    if (webdavUsernameInput) webdavUsernameInput.value = config.webdavUsername || "";
    if (webdavPasswordInput) webdavPasswordInput.value = config.webdavPassword || "";
    if (webdavFilenameInput) webdavFilenameInput.value = config.webdavFilename || "";
    if (webdavSyncSwitch) webdavSyncSwitch.checked = Boolean(config.autoSyncEnabled);
  }

  /**
   * 把当前会话同步表单值写入 chrome.storage.local。
   *
   * @returns {Promise<void>} 保存完成后结束。
   */
  async function saveSessionSyncConfig() {
    const config = readSessionSyncForm();
    await chrome.storage.local.set({ [SESSION_SYNC_CONFIG_KEY]: config });
  }

  /**
   * 构造用于 WebDAV 上传/下载的同步配置对象，供 syncTransport 使用。
   * 文件名为空时回退到默认会话同步文件名。
   *
   * @returns {object} 包含 webdavUrl/webdavUsername/webdavPassword/webdavFilename 的同步配置。
   */
  function getSessionSyncTransportConfig() {
    const form = readSessionSyncForm();
    return {
      webdavUrl: form.webdavUrl,
      webdavUsername: form.webdavUsername,
      webdavPassword: form.webdavPassword,
      webdavFilename: form.webdavFilename || "MyTabDesk-session.json"
    };
  }

  /**
   * 把本地会话快照上传到独立 WebDAV。
   * 读取后台 list-session-snapshots → JSON.stringify → syncTransport.uploadWebDav。
   *
   * @returns {Promise<void>} 上传完成后结束。
   */
  async function uploadSessionSnapshots() {
    const { uploadBtn } = getElements();
    const notifications = root.MyTabDeskNotifications || {};
    const originalText = uploadBtn ? uploadBtn.textContent : "";
    if (uploadBtn) {
      uploadBtn.disabled = true;
      uploadBtn.textContent = "同步中…";
    }
    try {
      const sync = getSessionSyncTransportConfig();
      if (!sync.webdavUrl || !sync.webdavUsername || !sync.webdavPassword) {
        throw new Error("请先完整填写 WebDAV URL、用户名和密码");
      }
      const response = await chrome.runtime.sendMessage({ type: "list-session-snapshots" });
      const snapshots = response && Array.isArray(response.snapshots) ? response.snapshots : [];
      const payload = JSON.stringify({ format: "mytabdesk-session-sync", snapshots });
      const syncTransport = root.MyTabDeskSync && root.MyTabDeskSync.uploadWebDav
        ? { uploadWebDav: root.MyTabDeskSync.uploadWebDav }
        : null;
      if (!syncTransport || typeof syncTransport.uploadWebDav !== "function") {
        throw new Error("同步模块未就绪");
      }
      await syncTransport.uploadWebDav(sync, payload);
      await saveSessionSyncConfig();
      root.MyTabDeskNotifications.showToast(`已上传 ${snapshots.length} 条恢复点`, "success");
      if (notifications.notifySuccess) {
        notifications.notifySuccess("上传成功", `已上传 ${snapshots.length} 条恢复点到 WebDAV`);
      }
    } catch (error) {
      root.MyTabDeskNotifications.showToast(error.message || "上传会话快照失败", "error");
      if (notifications.notifyError) {
        notifications.notifyError("上传失败", error.message || "上传会话快照失败");
      }
    } finally {
      if (uploadBtn) {
        uploadBtn.disabled = false;
        uploadBtn.textContent = originalText;
      }
    }
  }

  /**
   * 从独立 WebDAV 下载远程会话快照，与本地合并后写回后台存储。
   * 下载 → JSON.parse → mergeSessionSnapshots → replace-session-snapshots。
   *
   * @returns {Promise<void>} 下载合并完成后结束。
   */
  async function downloadSessionSnapshots() {
    const { downloadBtn } = getElements();
    const notifications = root.MyTabDeskNotifications || {};
    const originalText = downloadBtn ? downloadBtn.textContent : "";
    if (downloadBtn) {
      downloadBtn.disabled = true;
      downloadBtn.textContent = "同步中…";
    }
    try {
      const sync = getSessionSyncTransportConfig();
      if (!sync.webdavUrl || !sync.webdavUsername || !sync.webdavPassword) {
        throw new Error("请先完整填写 WebDAV URL、用户名和密码");
      }
      const syncTransport = root.MyTabDeskSync && root.MyTabDeskSync.downloadWebDav
        ? { downloadWebDav: root.MyTabDeskSync.downloadWebDav }
        : null;
      if (!syncTransport || typeof syncTransport.downloadWebDav !== "function") {
        throw new Error("同步模块未就绪");
      }
      const remotePayload = await syncTransport.downloadWebDav(sync);
      let remoteSnapshots = [];
      try {
        const parsed = JSON.parse(remotePayload);
        remoteSnapshots = parsed && Array.isArray(parsed.snapshots) ? parsed.snapshots : [];
      } catch {
        remoteSnapshots = [];
      }
      const localResponse = await chrome.runtime.sendMessage({ type: "list-session-snapshots" });
      const localSnapshots = localResponse && Array.isArray(localResponse.snapshots) ? localResponse.snapshots : [];
      const limit = localResponse && Number.isInteger(localResponse.limit) ? localResponse.limit : sessionState.limit;
      const coreApi = root.MyTabDeskCore;
      if (!coreApi || typeof coreApi.mergeSessionSnapshots !== "function") {
        throw new Error("核心模块未就绪");
      }
      const mergedSnapshots = coreApi.mergeSessionSnapshots(localSnapshots, remoteSnapshots, {
        limit,
        retentionMs: 30 * 24 * 60 * 60 * 1000
      });
      const writeResponse = await chrome.runtime.sendMessage({
        type: "replace-session-snapshots",
        snapshots: mergedSnapshots
      });
      if (!writeResponse || !writeResponse.success) {
        throw new Error((writeResponse && writeResponse.error) || "写回后台存储失败");
      }
      await saveSessionSyncConfig();
      await loadSessionHistory();
      root.MyTabDeskNotifications.showToast(`已合并远程恢复点，本地共 ${mergedSnapshots.length} 条`, "success");
      if (notifications.notifySuccess) {
        notifications.notifySuccess("下载成功", `已合并远程恢复点，本地共 ${mergedSnapshots.length} 条`);
      }
    } catch (error) {
      const message = error && error.message ? error.message : "";
      // 远端文件不存在视为空合并，提示但不算失败
      if (message.includes("404") || message.includes("未找到")) {
        await saveSessionSyncConfig();
        root.MyTabDeskNotifications.showToast("远端没有会话快照可合并", "success");
        return;
      }
      root.MyTabDeskNotifications.showToast(message || "下载会话快照失败", "error");
      if (notifications.notifyError) {
        notifications.notifyError("下载失败", message || "下载会话快照失败");
      }
    } finally {
      if (downloadBtn) {
        downloadBtn.disabled = false;
        downloadBtn.textContent = originalText;
      }
    }
  }

  function openSessionView() {
    root.MyTabDeskPage.state.viewMode = "sessions";
    root.MyTabDeskPage.state.createSpaceMenuOpen = false;
    root.MyTabDeskRender.renderAll();
    loadSessionHistory().catch((error) => {
      root.MyTabDeskNotifications.showToast(error.message || "读取会话历史失败", "error");
    });
    loadSessionSyncConfig().catch((error) => {
      root.MyTabDeskNotifications.showToast(error.message || "读取会话同步配置失败", "error");
    });
  }

  function bindSessionEvents() {
    const { captureButton, searchInput, filterTabs, limitInput } = getElements();
    if (captureButton && !captureButton.dataset.bound) {
      captureButton.dataset.bound = "true";
      captureButton.addEventListener("click", captureSessionNow);
    }
    if (limitInput && !limitInput.dataset.bound) {
      limitInput.dataset.bound = "true";
      limitInput.addEventListener("change", async (event) => {
        const value = Number(event.target.value);
        if (!Number.isInteger(value) || value < 10 || value > 500) {
          root.MyTabDeskNotifications.showToast("上限必须在 10 到 500 之间", "error");
          limitInput.value = String(sessionState.limit);
          return;
        }
        const response = await chrome.runtime.sendMessage({ type: "set-session-limit", limit: value });
        if (response && response.success) {
          sessionState.limit = value;
          root.MyTabDeskNotifications.showToast(`已设置最多保留 ${value} 条`, "success");
        } else {
          root.MyTabDeskNotifications.showToast(response && response.error || "设置失败", "error");
          limitInput.value = String(sessionState.limit);
        }
      });
    }
    if (searchInput && !searchInput.dataset.bound) {
      searchInput.dataset.bound = "true";
      searchInput.addEventListener("input", (event) => {
        sessionState.searchKeyword = event.target.value;
        renderSessionHistory();
      });
    }
    if (filterTabs && !filterTabs.dataset.bound) {
      filterTabs.dataset.bound = "true";
      filterTabs.addEventListener("click", (event) => {
        const button = event.target.closest("[data-filter]");
        if (!button) return;
        sessionState.filter = button.dataset.filter;
        filterTabs.querySelectorAll("[data-filter]").forEach((item) => {
          const selected = item === button;
          item.classList.toggle("active", selected);
          item.setAttribute("aria-selected", selected ? "true" : "false");
        });
        renderSessionHistory();
      });
    }

    const {
      uploadBtn,
      downloadBtn,
      webdavUrlInput,
      webdavUsernameInput,
      webdavPasswordInput,
      webdavFilenameInput,
      webdavSyncSwitch
    } = getElements();
    if (uploadBtn && !uploadBtn.dataset.bound) {
      uploadBtn.dataset.bound = "true";
      uploadBtn.addEventListener("click", () => {
        uploadSessionSnapshots().catch((error) => {
          root.MyTabDeskNotifications.showToast(error.message || "上传会话快照失败", "error");
        });
      });
    }
    if (downloadBtn && !downloadBtn.dataset.bound) {
      downloadBtn.dataset.bound = "true";
      downloadBtn.addEventListener("click", () => {
        downloadSessionSnapshots().catch((error) => {
          root.MyTabDeskNotifications.showToast(error.message || "下载会话快照失败", "error");
        });
      });
    }
    // 任意配置输入变化后自动保存到 chrome.storage.local
    const configInputs = [webdavUrlInput, webdavUsernameInput, webdavPasswordInput, webdavFilenameInput, webdavSyncSwitch];
    for (const input of configInputs) {
      if (input && !input.dataset.bound) {
        input.dataset.bound = "true";
        input.addEventListener("change", () => {
          saveSessionSyncConfig().catch((error) => {
            root.MyTabDeskNotifications.showToast(error.message || "保存会话同步配置失败", "error");
          });
        });
      }
    }
  }

  root.MyTabDeskSessions = {
    bindSessionEvents,
    openSessionView,
    loadSessionHistory,
    renderSessionHistory,
    captureSessionNow,
    restoreSnapshot,
    deleteSnapshot,
    groupSnapshotsByDate,
    toggleSnapshotDetails,
    loadSessionSyncConfig,
    saveSessionSyncConfig,
    uploadSessionSnapshots,
    downloadSessionSnapshots,
    state: sessionState
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
