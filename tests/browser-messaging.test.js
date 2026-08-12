const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");

const quietConsole = {
  log() {},
  warn() {},
  error() {}
};

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createBackgroundHarness(initialStorage = {}, options = {}) {
  const listeners = {};
  const runtimeMessages = [];
  const tabMessages = [];
  const alarmsCreated = [];
  const windowsCreated = [];
  const tabGroupCalls = [];
  const tabsRemoved = [];
  const tabsDiscarded = [];
  const tabsCreated = [];
  const storage = { ...initialStorage };
  const context = {
    URL,
    console: quietConsole,
    importScripts() {},
    setTimeout() { return 1; },
    clearTimeout() {},
    chrome: {
      action: { onClicked: { addListener(handler) { listeners.action = handler; } } },
      alarms: {
        get(name, callback) {
          callback(options.existingAlarms && options.existingAlarms[name] || null);
        },
        clear(_name, callback) { callback(); },
        create(name, config) { alarmsCreated.push({ name, config }); },
        onAlarm: { addListener(handler) { listeners.alarm = handler; } }
      },
      contextMenus: {
        removeAll(callback) { callback(); },
        create() {},
        onClicked: { addListener(handler) { listeners.contextMenu = handler; } }
      },
      commands: {
        onCommand: { addListener(handler) { listeners.command = handler; } }
      },
      notifications: {
        create() {},
        clear(_id, callback) { callback(); }
      },
      runtime: {
        getURL(file) { return `chrome-extension://test/${file}`; },
        sendMessage(message) {
          runtimeMessages.push(message);
          return Promise.resolve();
        },
        onInstalled: { addListener(handler) { listeners.installed = handler; } },
        onStartup: { addListener(handler) { listeners.startup = handler; } },
        onMessage: { addListener(handler) { listeners.runtimeMessage = handler; } },
        lastError: null
      },
      storage: {
        local: {
          async get(key) {
            if (options.onStorageGet) await options.onStorageGet(key);
            return { [key]: storage[key] };
          },
          async set(values) {
            if (options.storageSetError) throw options.storageSetError;
            Object.assign(storage, values);
          },
          async remove(key) {
            if (options.storageRemoveError) throw options.storageRemoveError;
            delete storage[key];
          }
        }
      },
      tabs: {
        onCreated: { addListener(handler) { listeners.tabCreated = handler; } },
        onActivated: { addListener(handler) { listeners.tabActivated = handler; } },
        onRemoved: { addListener(handler) { listeners.tabRemoved = handler; } },
        onUpdated: { addListener(handler) { listeners.tabUpdated = handler; } },
        async query(queryInfo) {
          if (queryInfo && queryInfo.url) return [{ id: 7, url: "chrome-extension://test/newtab.html" }];
          if (options.onTabsQuery) await options.onTabsQuery(storage);
          return options.currentTabs || [{ id: 7, url: "chrome-extension://test/newtab.html" }];
        },
        create(config) {
          tabsCreated.push(config);
          return Promise.resolve({ id: 500 + tabsCreated.length, ...config });
        },
        async get(tabId) {
          return (options.currentTabs || []).find((tab) => tab.id === tabId) || null;
        },
        async update() {},
        async remove(tabIds) { tabsRemoved.push(...(Array.isArray(tabIds) ? tabIds : [tabIds])); },
        async discard(tabId) { tabsDiscarded.push(tabId); },
        async group(groupOptions) {
          tabGroupCalls.push({ type: "group", options: groupOptions });
          return 99;
        },
        sendMessage(tabId, message, callback) {
          tabMessages.push({ tabId, message });
          callback();
        }
      },
      windows: {
        async getAll() {
          return options.windows || [{
            id: 1,
            focused: true,
            state: "normal",
            type: "normal",
            tabs: [
              { id: 10, index: 0, url: "https://example.com", title: "Example", pinned: false, active: true, groupId: -1 },
              { id: 11, index: 1, url: "chrome://settings", title: "Settings", pinned: false, active: false, groupId: -1 }
            ]
          }];
        },
        async create(config) {
          windowsCreated.push(config);
          const urls = Array.isArray(config.url) ? config.url : [config.url];
          return {
            id: windowsCreated.length + 1,
            tabs: urls.map((url, index) => ({ id: 200 + index, url }))
          };
        }
      },
      tabGroups: {
        async query() {
          return options.tabGroups || [];
        },
        async update(groupId, values) {
          tabGroupCalls.push({ type: "update", groupId, values });
        }
      }
    }
  };

  vm.runInNewContext(fs.readFileSync(path.join(projectRoot, "message-protocol.js"), "utf8"), context);
  vm.runInNewContext(fs.readFileSync(path.join(projectRoot, "background-message-router.js"), "utf8"), context);
  vm.runInNewContext(fs.readFileSync(path.join(projectRoot, "background-notifications.js"), "utf8"), context);
  vm.runInNewContext(fs.readFileSync(path.join(projectRoot, "background-page-messaging.js"), "utf8"), context);
  vm.runInNewContext(fs.readFileSync(path.join(projectRoot, "workspace-repository.js"), "utf8"), context);
  vm.runInNewContext(fs.readFileSync(path.join(projectRoot, "background.js"), "utf8"), context);
  return {
    listeners, runtimeMessages, tabMessages, storage, alarmsCreated, windowsCreated,
    tabGroupCalls, tabsRemoved, tabsDiscarded, tabsCreated
  };
}

function sendBackgroundMessage(listener, message) {
  return Promise.race([
    new Promise((resolve) => {
      listener(message, {}, resolve);
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`后台消息未响应: ${message.type}`)), 50))
  ]);
}

function createNotificationsHarness(options = {}) {
  const listeners = [];
  const sentMessages = [];
  let autoSyncRuns = 0;
  const document = {
    readyState: "complete",
    head: { appendChild() {} },
    body: { appendChild() {} },
    createElement() {
      return {
        style: {},
        append() {},
        appendChild() {},
        addEventListener() {},
        remove() {},
        set textContent(_value) {},
        get textContent() { return ""; }
      };
    },
    getElementById() { return null; }
  };
  const pendingSaveResponses = options.pendingSaveResponses ? [...options.pendingSaveResponses] : [];
  const context = {
    console: quietConsole,
    document,
    setTimeout() { return 1; },
    clearTimeout() {},
    chrome: {
      runtime: {
        onMessage: { addListener(handler) { listeners.push(handler); } },
        async sendMessage(message) {
          sentMessages.push(message);
          if (message.type === "consume-auto-sync-wake") {
            return { pendingAt: options.pendingAt || 0 };
          }
          if (message.type === "claim-auto-sync") {
            return {
              claimed: options.claimAutoSync !== false,
              leaseId: options.leaseId || "lease-test"
            };
          }
          if (message.type === "release-auto-sync") {
            return { success: true };
          }
          if (message.type === "claim-pending-save") {
            return pendingSaveResponses.length > 0 ? pendingSaveResponses.shift() : { data: null };
          }
          if (message.type === "ack-pending-save" || message.type === "release-pending-save") {
            if (message.type === "ack-pending-save" && options.ackPendingSuccess === false) {
              return { success: false };
            }
            return { success: true };
          }
          return {};
        }
      }
    },
    MyTabDeskPage: {
      state: {
        data: Object.prototype.hasOwnProperty.call(options, "stateData") ? options.stateData : { spaces: [] }
      }
    },
    MyTabDeskUtils: { getActiveSpace() { return options.activeSpace || null; } },
    MyTabDeskActions: {
      async addExternalLink(data) {
        if (options.addExternalLink) {
          return options.addExternalLink(data);
        }
      }
    },
    MyTabDeskSync: {
      async runAutoSyncNow() {
        autoSyncRuns += 1;
        if (options.autoSyncError) {
          throw options.autoSyncError;
        }
      }
    }
  };
  context.globalThis = context;

  vm.runInNewContext(fs.readFileSync(path.join(projectRoot, "newtab-notifications.js"), "utf8"), context);
  return { context, listeners, sentMessages, getAutoSyncRuns: () => autoSyncRuns };
}

async function testBackgroundUsesRuntimeMessagingForExtensionPage() {
  const harness = createBackgroundHarness();
  await harness.listeners.alarm({ name: "MyTabDeskAutoSync" });
  await flushPromises();

  assert.equal(harness.runtimeMessages.length, 1);
  assert.equal(harness.runtimeMessages[0].type, "run-auto-sync");
  assert.equal(harness.tabMessages.length, 0);
}

async function testPageRunsAutoSyncForRuntimeMessage() {
  const harness = createNotificationsHarness();
  assert.equal(harness.listeners.length, 1);

  harness.listeners[0]({ type: "run-auto-sync" }, {}, () => {});
  await flushPromises();
  await flushPromises();

  assert.equal(harness.getAutoSyncRuns(), 1);
  assert.equal(harness.sentMessages.some((message) => message.type === "release-auto-sync"), true);
}

async function testPageConsumesPendingAutoSyncWakeOnStartup() {
  const harness = createNotificationsHarness({ pendingAt: 123 });
  await harness.context.MyTabDeskNotifications.checkPendingAutoSyncWake();

  assert.equal(harness.getAutoSyncRuns(), 1);
}

async function testPendingSaveCanOnlyBeClaimedOnceBeforeAck() {
  const pending = { requestId: "save-1", url: "https://example.com", title: "Example" };
  const harness = createBackgroundHarness({ mytabdesk_pending_save_data: [pending] });

  const [first, second] = await Promise.all([
    sendBackgroundMessage(harness.listeners.runtimeMessage, { type: "claim-pending-save" }),
    sendBackgroundMessage(harness.listeners.runtimeMessage, { type: "claim-pending-save" })
  ]);

  const claimed = [first.data, second.data].filter(Boolean);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].url, pending.url);
  assert.equal(harness.storage.mytabdesk_pending_save_data.length, 1);

  const ack = await sendBackgroundMessage(harness.listeners.runtimeMessage, {
    type: "ack-pending-save",
    requestId: pending.requestId
  });
  assert.equal(ack.success, true);
  assert.equal(harness.storage.mytabdesk_pending_save_data, undefined);
}

async function testPendingSaveReleaseAllowsRetryAndQueueIsFifo() {
  const first = { requestId: "save-1", url: "https://one.example", title: "One" };
  const second = { requestId: "save-2", url: "https://two.example", title: "Two" };
  const harness = createBackgroundHarness({ mytabdesk_pending_save_data: [first, second] });

  const firstClaim = await sendBackgroundMessage(harness.listeners.runtimeMessage, { type: "claim-pending-save" });
  assert.equal(firstClaim.data.requestId, first.requestId);
  assert.equal(harness.storage.mytabdesk_pending_save_data.length, 2);

  const release = await sendBackgroundMessage(harness.listeners.runtimeMessage, {
    type: "release-pending-save",
    requestId: first.requestId
  });
  assert.equal(release.success, true);

  const retried = await sendBackgroundMessage(harness.listeners.runtimeMessage, { type: "claim-pending-save" });
  assert.equal(retried.data.requestId, first.requestId);
  await sendBackgroundMessage(harness.listeners.runtimeMessage, {
    type: "ack-pending-save",
    requestId: first.requestId
  });

  const secondClaim = await sendBackgroundMessage(harness.listeners.runtimeMessage, { type: "claim-pending-save" });
  assert.equal(secondClaim.data.requestId, second.requestId);
}

async function testPendingAckFailureKeepsQueueAndReturnsFailure() {
  const pending = { requestId: "save-1", url: "https://example.com", title: "Example" };
  const harness = createBackgroundHarness(
    { mytabdesk_pending_save_data: [pending] },
    { storageRemoveError: new Error("remove failed") }
  );

  await sendBackgroundMessage(harness.listeners.runtimeMessage, { type: "claim-pending-save" });
  const ack = await sendBackgroundMessage(harness.listeners.runtimeMessage, {
    type: "ack-pending-save",
    requestId: pending.requestId
  });

  assert.equal(ack.success, false);
  assert.equal(harness.storage.mytabdesk_pending_save_data.length, 1);
  const blockedClaim = await sendBackgroundMessage(harness.listeners.runtimeMessage, { type: "claim-pending-save" });
  assert.equal(blockedClaim.data, null);
}

async function testRapidContextMenuSavesAreQueued() {
  const harness = createBackgroundHarness();
  harness.listeners.contextMenu({
    menuItemId: "mytabdesk-save-link",
    linkUrl: "https://one.example",
    linkText: "One"
  }, {});
  harness.listeners.contextMenu({
    menuItemId: "mytabdesk-save-link",
    linkUrl: "https://two.example",
    linkText: "Two"
  }, {});
  await flushPromises();
  await flushPromises();

  const queue = harness.storage.mytabdesk_pending_save_data;
  assert.equal(queue.length, 2);
  assert.equal(queue.map((item) => item.url).join(","), "https://one.example,https://two.example");
}

async function testFailedPageSaveReleasesPendingClaim() {
  const pending = { requestId: "save-fail", url: "https://fail.example", title: "Fail" };
  const harness = createNotificationsHarness({
    activeSpace: { id: "space-1", groups: [{ id: "group-1", name: "Group" }] },
    pendingSaveResponses: [{ data: pending }],
    async addExternalLink() { throw new Error("storage failed"); }
  });

  await assert.rejects(
    harness.context.MyTabDeskNotifications.checkPendingSaveData(),
    /storage failed/
  );
  assert.equal(harness.sentMessages.some((message) => message.type === "release-pending-save"), true);
  assert.equal(harness.sentMessages.some((message) => message.type === "ack-pending-save"), false);
}

async function testFailedPendingAckIsReleasedAndReported() {
  const pending = { requestId: "save-ack-fail", url: "https://ack.example", title: "Ack" };
  const harness = createNotificationsHarness({
    activeSpace: { id: "space-1", groups: [{ id: "group-1", name: "Group" }] },
    pendingSaveResponses: [{ data: pending }],
    ackPendingSuccess: false
  });

  await assert.rejects(
    harness.context.MyTabDeskNotifications.checkPendingSaveData(),
    /确认保存请求失败/
  );
  assert.equal(harness.sentMessages.some((message) => message.type === "release-pending-save"), true);
}

async function testUninitializedPageReleasesPendingClaim() {
  const pending = { requestId: "save-unready", url: "https://wait.example", title: "Wait" };
  const harness = createNotificationsHarness({
    stateData: null,
    pendingSaveResponses: [{ data: pending }]
  });

  await assert.rejects(harness.context.MyTabDeskNotifications.checkPendingSaveData());
  assert.equal(harness.sentMessages.some((message) => message.type === "release-pending-save"), true);
  assert.equal(harness.sentMessages.some((message) => message.type === "ack-pending-save"), false);
}

async function testAutoSyncLeaseAllowsOnlyOneOwner() {
  const harness = createBackgroundHarness();
  const [first, second] = await Promise.all([
    sendBackgroundMessage(harness.listeners.runtimeMessage, { type: "claim-auto-sync" }),
    sendBackgroundMessage(harness.listeners.runtimeMessage, { type: "claim-auto-sync" })
  ]);
  assert.equal([first.claimed, second.claimed].filter(Boolean).length, 1);

  const owner = first.claimed ? first : second;
  assert.equal(typeof owner.leaseId, "string");

  const wrongRelease = await sendBackgroundMessage(harness.listeners.runtimeMessage, {
    type: "release-auto-sync",
    leaseId: "wrong-owner"
  });
  assert.equal(wrongRelease.success, false);

  const stillBlocked = await sendBackgroundMessage(harness.listeners.runtimeMessage, { type: "claim-auto-sync" });
  assert.equal(stillBlocked.claimed, false);

  await sendBackgroundMessage(harness.listeners.runtimeMessage, {
    type: "release-auto-sync",
    leaseId: owner.leaseId
  });
  const afterRelease = await sendBackgroundMessage(harness.listeners.runtimeMessage, { type: "claim-auto-sync" });
  assert.equal(afterRelease.claimed, true);
}

async function testAutoSyncLeaseSurvivesBackgroundRestart() {
  const firstWorker = createBackgroundHarness();
  const lease = await sendBackgroundMessage(firstWorker.listeners.runtimeMessage, { type: "claim-auto-sync" });
  assert.equal(lease.claimed, true);

  const restartedWorker = createBackgroundHarness(firstWorker.storage);
  const blocked = await sendBackgroundMessage(restartedWorker.listeners.runtimeMessage, { type: "claim-auto-sync" });
  assert.equal(blocked.claimed, false);

  const released = await sendBackgroundMessage(restartedWorker.listeners.runtimeMessage, {
    type: "release-auto-sync",
    leaseId: lease.leaseId
  });
  assert.equal(released.success, true);
}

async function testPageSkipsAutoSyncWithoutLease() {
  const harness = createNotificationsHarness({ claimAutoSync: false });
  const ran = await harness.context.MyTabDeskNotifications.runLeasedAutoSync();
  assert.equal(ran, false);
  assert.equal(harness.getAutoSyncRuns(), 0);
}

async function testPageReleasesLeaseWhenAutoSyncFails() {
  const harness = createNotificationsHarness({ autoSyncError: new Error("sync failed") });
  await assert.rejects(
    harness.context.MyTabDeskNotifications.runLeasedAutoSync(),
    /sync failed/
  );
  assert.equal(harness.sentMessages.some((message) => message.type === "release-auto-sync"), true);
  const release = harness.sentMessages.find((message) => message.type === "release-auto-sync");
  assert.equal(release.leaseId, "lease-test");
}

async function testSessionSnapshotsAreDeduplicatedAndBounded() {
  const harness = createBackgroundHarness();
  const first = await sendBackgroundMessage(harness.listeners.runtimeMessage, {
    type: "capture-session-now"
  });
  assert.equal(first.success, true);
  assert.equal(first.snapshot.windows.length, 1);
  assert.equal(first.snapshot.windows[0].tabs.length, 1);
  assert.equal(first.snapshot.windows[0].tabs[0].url, "https://example.com");

  const duplicate = await sendBackgroundMessage(harness.listeners.runtimeMessage, {
    type: "capture-session-now"
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(harness.storage.mytabdesk_session_snapshots.length, 1);

  harness.storage.mytabdesk_session_snapshots = Array.from({ length: 55 }, (_, index) => ({
    id: `old-${index}`,
    createdAt: Date.now() - index - 1,
    fingerprint: `old-${index}`,
    windows: []
  }));
  const bounded = await sendBackgroundMessage(harness.listeners.runtimeMessage, {
    type: "capture-session-now"
  });
  assert.equal(bounded.success, true);
  assert.equal(harness.storage.mytabdesk_session_snapshots.length, 50);
}

async function testConcurrentSessionHistoryWritesAreSerialized() {
  const harness = createBackgroundHarness();
  const [first, second] = await Promise.all([
    sendBackgroundMessage(harness.listeners.runtimeMessage, { type: "capture-session-now" }),
    sendBackgroundMessage(harness.listeners.runtimeMessage, { type: "capture-session-now" })
  ]);
  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal([first.duplicate, second.duplicate].filter(Boolean).length, 1);
  assert.equal(harness.storage.mytabdesk_session_snapshots.length, 1);

  const snapshotId = harness.storage.mytabdesk_session_snapshots[0].id;
  const [, deleted] = await Promise.all([
    sendBackgroundMessage(harness.listeners.runtimeMessage, { type: "capture-session-now" }),
    sendBackgroundMessage(harness.listeners.runtimeMessage, {
      type: "delete-session-snapshot",
      snapshotId
    })
  ]);
  assert.equal(deleted.success, true);
  assert.equal(harness.storage.mytabdesk_session_snapshots.some((item) => item.id === snapshotId), false);
}

async function testCaptureAndDeleteUseSameSessionHistoryLock() {
  let historyGets = 0;
  let releaseFirstGet;
  const firstGetGate = new Promise((resolve) => { releaseFirstGet = resolve; });
  const harness = createBackgroundHarness({}, {
    onStorageGet: async (key) => {
      if (key !== "mytabdesk_session_snapshots") return;
      historyGets += 1;
      if (historyGets === 1) await firstGetGate;
    }
  });
  const captured = sendBackgroundMessage(harness.listeners.runtimeMessage, { type: "capture-session-now" });
  await flushPromises();
  const deleted = sendBackgroundMessage(harness.listeners.runtimeMessage, {
    type: "delete-session-snapshot",
    snapshotId: "does-not-exist"
  });
  await flushPromises();
  assert.equal(historyGets, 1, "delete 必须等待 capture 释放同一把会话历史锁");
  releaseFirstGet();
  await Promise.all([captured, deleted]);
  assert.equal(historyGets, 2);
}

async function testExpiredDuplicateIsReplacedAndGroupIdsAreStable() {
  const initialWindows = [{
    id: 1,
    focused: true,
    state: "normal",
    type: "normal",
    tabs: [{
      id: 10, index: 0, url: "https://stable.example", title: "Stable",
      pinned: false, active: true, groupId: 7
    }]
  }];
  const harness = createBackgroundHarness({}, {
    windows: initialWindows,
    tabGroups: [{ id: 7, windowId: 1, title: "稳定组", color: "blue", collapsed: false }]
  });
  const first = await sendBackgroundMessage(harness.listeners.runtimeMessage, { type: "capture-session-now" });
  const expiredId = first.snapshot.id;
  harness.storage.mytabdesk_session_snapshots[0].createdAt = Date.now() - (31 * 24 * 60 * 60 * 1000);
  const replacement = await sendBackgroundMessage(harness.listeners.runtimeMessage, { type: "capture-session-now" });
  assert.equal(replacement.duplicate, false);
  assert.notEqual(replacement.snapshot.id, expiredId);
  assert.equal(harness.storage.mytabdesk_session_snapshots.some((item) => item.id === expiredId), false);

  initialWindows[0].tabs[0].groupId = 99;
  const sameGroup = createBackgroundHarness({
    mytabdesk_session_snapshots: harness.storage.mytabdesk_session_snapshots
  }, {
    windows: initialWindows,
    tabGroups: [{ id: 99, windowId: 1, title: "稳定组", color: "blue", collapsed: false }]
  });
  const stable = await sendBackgroundMessage(sameGroup.listeners.runtimeMessage, { type: "capture-session-now" });
  assert.equal(stable.duplicate, true);
}

async function testAutomaticSessionSnapshotAlarmRunsEveryFifteenMinutes() {
  const harness = createBackgroundHarness();
  const alarm = harness.alarmsCreated.find((item) => item.name === "MyTabDeskSessionSnapshot");
  assert.equal(alarm.config.periodInMinutes, 15);

  await harness.listeners.alarm({ name: "MyTabDeskSessionSnapshot" });
  await flushPromises();
  assert.equal(harness.storage.mytabdesk_session_snapshots.length, 1);
  assert.equal(harness.storage.mytabdesk_session_snapshots[0].reason, "interval");
}

async function testExistingAlarmsAreNotResetOnWorkerRestart() {
  const harness = createBackgroundHarness({}, {
    existingAlarms: {
      MyTabDeskAutoSync: { name: "MyTabDeskAutoSync", periodInMinutes: 30 },
      MyTabDeskSessionSnapshot: { name: "MyTabDeskSessionSnapshot", periodInMinutes: 15 },
      MyTabDeskScheduledSave: { name: "MyTabDeskScheduledSave", periodInMinutes: 1 }
    }
  });
  assert.equal(harness.alarmsCreated.length, 0);
}

async function testSessionHistoryCanBeListedRestoredAndDeleted() {
  const snapshot = {
    id: "session-1",
    createdAt: 100,
    reason: "manual",
    fingerprint: "one",
    windows: [{
      state: "normal",
      tabs: [
        { url: "https://one.example", pinned: true, active: false },
        { url: "https://two.example", pinned: false, active: true }
      ]
    }]
  };
  const harness = createBackgroundHarness({ mytabdesk_session_snapshots: [snapshot] });
  const listed = await sendBackgroundMessage(harness.listeners.runtimeMessage, { type: "list-session-snapshots" });
  assert.equal(listed.snapshots.length, 1);

  const restored = await sendBackgroundMessage(harness.listeners.runtimeMessage, {
    type: "restore-session-snapshot",
    snapshotId: "session-1"
  });
  assert.equal(restored.success, true);
  assert.deepEqual(harness.windowsCreated[0].url, ["https://one.example", "https://two.example"]);

  const deleted = await sendBackgroundMessage(harness.listeners.runtimeMessage, {
    type: "delete-session-snapshot",
    snapshotId: "session-1"
  });
  assert.equal(deleted.success, true);
  assert.equal(harness.storage.mytabdesk_session_snapshots.length, 0);
}

async function testSessionCanRestoreIntoCurrentWindowAndSkipOpenUrls() {
  const snapshot = {
    id: "session-current",
    createdAt: 100,
    reason: "manual",
    fingerprint: "current",
    windows: [{
      state: "normal",
      tabs: [
        { url: "https://already.example", pinned: false, active: false },
        { url: "https://new.example", pinned: true, active: true }
      ],
      groups: []
    }]
  };
  const harness = createBackgroundHarness({ mytabdesk_session_snapshots: [snapshot] }, {
    currentTabs: [
      { id: 70, windowId: 9, url: "chrome-extension://test/newtab.html", active: true },
      { id: 71, windowId: 4, url: "https://already.example", active: false }
    ]
  });

  const restored = await sendBackgroundMessage(harness.listeners.runtimeMessage, {
    type: "restore-session-snapshot",
    snapshotId: "session-current",
    restoreTo: "current",
    targetWindowId: 9,
    skipOpenUrls: true
  });

  assert.equal(restored.success, true);
  assert.equal(restored.restoredTabs, 1);
  assert.equal(restored.skippedTabs, 1);
  assert.equal(harness.windowsCreated.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.tabsCreated)), [{
    windowId: 9,
    url: "https://new.example",
    pinned: true,
    active: true
  }]);
}

async function testSessionRestoreCanFilterSelectedTabs() {
  const snapshot = {
    id: "session-selected",
    createdAt: 100,
    reason: "manual",
    fingerprint: "selected",
    windows: [{
      state: "normal",
      tabs: [
        { url: "https://first.example", pinned: false, active: false },
        { url: "https://second.example", pinned: false, active: true }
      ],
      groups: []
    }]
  };
  const harness = createBackgroundHarness({ mytabdesk_session_snapshots: [snapshot] });

  const restored = await sendBackgroundMessage(harness.listeners.runtimeMessage, {
    type: "restore-session-snapshot",
    snapshotId: "session-selected",
    selectedTabKeys: ["0:1"]
  });

  assert.equal(restored.success, true);
  assert.equal(restored.restoredTabs, 1);
  assert.deepEqual(harness.windowsCreated[0].url, ["https://second.example"]);
}

async function testRemoteSessionReplacementValidatesAndAppliesLimit() {
  const now = Date.now();
  const snapshots = Array.from({ length: 12 }, (_, index) => ({
    id: `remote-${index}`,
    createdAt: now - index,
    reason: "manual",
    windows: []
  }));
  snapshots.push({ id: "invalid", createdAt: now });
  const harness = createBackgroundHarness({ mytabdesk_session_limit: 10 });

  const response = await sendBackgroundMessage(harness.listeners.runtimeMessage, {
    type: "replace-session-snapshots",
    snapshots
  });

  assert.equal(response.success, true);
  assert.equal(response.count, 10);
  assert.equal(harness.storage.mytabdesk_session_snapshots.length, 10);
  assert.equal(harness.storage.mytabdesk_session_snapshots.some((item) => item.id === "invalid"), false);
}

async function testNativeTabGroupsAreCapturedAndRestored() {
  const windows = [{
    id: 3,
    focused: true,
    state: "normal",
    type: "normal",
    tabs: [
      { id: 31, index: 0, url: "https://docs.example", title: "Docs", pinned: false, active: true, groupId: 7 },
      { id: 32, index: 1, url: "https://api.example", title: "API", pinned: false, active: false, groupId: 7 }
    ]
  }];
  const tabGroups = [{ id: 7, windowId: 3, title: "研发", color: "blue", collapsed: true }];
  const harness = createBackgroundHarness({}, { windows, tabGroups });

  const captured = await sendBackgroundMessage(harness.listeners.runtimeMessage, { type: "capture-session-now" });
  assert.deepEqual(JSON.parse(JSON.stringify(captured.snapshot.windows[0].groups[0])), {
    sourceGroupId: 7,
    title: "研发",
    color: "blue",
    collapsed: true
  });

  const restored = await sendBackgroundMessage(harness.listeners.runtimeMessage, {
    type: "restore-session-snapshot",
    snapshotId: captured.snapshot.id
  });
  assert.equal(restored.success, true);
  const groupCall = harness.tabGroupCalls.find((call) => call.type === "group");
  assert.deepEqual(JSON.parse(JSON.stringify(groupCall.options.tabIds)), [200, 201]);
  const updateCall = harness.tabGroupCalls.find((call) => call.type === "update");
  assert.equal(updateCall.groupId, 99);
  assert.deepEqual(JSON.parse(JSON.stringify(updateCall.values)), { title: "研发", color: "blue", collapsed: true });
}

async function testSaveCleanupProtectsPinnedActiveAndInternalTabs() {
  const currentTabs = [
    { id: 1, windowId: 10, url: "https://close.example", pinned: false, active: false },
    { id: 2, windowId: 10, url: "https://pinned.example", pinned: true, active: false },
    { id: 3, windowId: 10, url: "https://active.example", pinned: false, active: true },
    { id: 4, windowId: 10, url: "chrome://settings", pinned: false, active: false }
  ];
  const savedTabs = currentTabs.map((tab) => ({ tabId: tab.id, url: tab.url, windowId: tab.windowId }));
  const closeHarness = createBackgroundHarness({}, { currentTabs });
  const closed = await sendBackgroundMessage(closeHarness.listeners.runtimeMessage, {
    type: "close-saved-tabs",
    savedTabs
  });
  assert.equal(closed.success, true);
  assert.deepEqual(closeHarness.tabsRemoved, [1]);

  const discardHarness = createBackgroundHarness({}, { currentTabs });
  const discarded = await sendBackgroundMessage(discardHarness.listeners.runtimeMessage, {
    type: "discard-saved-tabs",
    savedTabs
  });
  assert.equal(discarded.success, true);
  assert.deepEqual(discardHarness.tabsDiscarded, [1]);

  const changedTabs = currentTabs.map((tab) => tab.id === 1 ? { ...tab, url: "https://notsaved.example" } : tab);
  const changedHarness = createBackgroundHarness({}, { currentTabs: changedTabs });
  const changed = await sendBackgroundMessage(changedHarness.listeners.runtimeMessage, {
    type: "close-saved-tabs",
    savedTabs
  });
  assert.equal(changed.affected, 0);
  assert.deepEqual(changedHarness.tabsRemoved, []);

  const movedTabs = currentTabs.map((tab) => tab.id === 1 ? { ...tab, windowId: 20 } : tab);
  const movedHarness = createBackgroundHarness({}, { currentTabs: movedTabs });
  const moved = await sendBackgroundMessage(movedHarness.listeners.runtimeMessage, {
    type: "close-saved-tabs",
    savedTabs
  });
  assert.equal(moved.affected, 0);
  assert.deepEqual(movedHarness.tabsRemoved, []);

  const emptyHarness = createBackgroundHarness({}, { currentTabs });
  const empty = await sendBackgroundMessage(emptyHarness.listeners.runtimeMessage, { type: "close-saved-tabs" });
  assert.equal(empty.affected, 0);
  assert.deepEqual(emptyHarness.tabsRemoved, []);
}

async function testBrowserCommandsOpenDeskAndQueueActiveTab() {
  const currentTabs = [{
    id: 88,
    url: "https://shortcut.example",
    title: "Shortcut",
    favIconUrl: "",
    pinned: false,
    active: true
  }];
  const harness = createBackgroundHarness({}, { currentTabs });

  await harness.listeners.command("open-mytabdesk");
  assert.equal(harness.tabsCreated.length, 1);
  assert.equal(harness.tabsCreated[0].url, "chrome-extension://test/newtab.html");

  await harness.listeners.command("save-current-tab");
  await flushPromises();
  assert.equal(harness.storage.mytabdesk_pending_save_data.length, 1);
  assert.equal(harness.storage.mytabdesk_pending_save_data[0].url, "https://shortcut.example");
}

async function testUsageEventsAreAggregatedByDay() {
  const harness = createBackgroundHarness();
  await sendBackgroundMessage(harness.listeners.runtimeMessage, {
    type: "record-usage-event",
    eventType: "save",
    linkCount: 3,
    spaceId: "space-a"
  });
  await sendBackgroundMessage(harness.listeners.runtimeMessage, {
    type: "record-usage-event",
    eventType: "restore",
    linkCount: 2
  });
  const response = await sendBackgroundMessage(harness.listeners.runtimeMessage, { type: "get-usage-stats" });
  const days = Object.values(response.stats.days);
  assert.equal(days.length, 1);
  assert.equal(days[0].saveCount, 1);
  assert.equal(days[0].savedLinks, 3);
  assert.equal(days[0].restoreCount, 1);
  assert.equal(days[0].restoredLinks, 2);
  assert.equal(response.stats.spaces["space-a"].saveCount, 1);
}

async function testTabLifecycleTracksActiveDomainTime() {
  const tabs = [
    { id: 1, windowId: 1, url: "https://first.example/page", title: "First", active: true, pinned: false },
    { id: 2, windowId: 1, url: "https://second.example/page", title: "Second", active: false, pinned: false }
  ];
  const harness = createBackgroundHarness({}, { currentTabs: tabs });
  harness.listeners.tabCreated(tabs[0]);
  harness.listeners.tabCreated(tabs[1]);
  await harness.listeners.tabActivated({ tabId: 2, windowId: 1 });
  await harness.listeners.tabRemoved(2, { windowId: 1, isWindowClosing: false });
  await flushPromises();
  const timeStats = harness.storage.mytabdesk_tab_time_stats;
  assert.equal(typeof timeStats.days, "object");
  assert.equal(Object.values(timeStats.days).some((day) => Object.prototype.hasOwnProperty.call(day.domains, "first.example")), true);
  assert.equal(Object.values(timeStats.days).some((day) => Object.prototype.hasOwnProperty.call(day.domains, "second.example")), true);
}

async function testLifecycleStatusProtectsPinnedAudibleAndWhitelistedTabs() {
  const currentTabs = [
    { id: 1, windowId: 1, url: "https://normal.example", title: "Normal", active: false, pinned: false, audible: false },
    { id: 2, windowId: 1, url: "https://pinned.example", title: "Pinned", active: false, pinned: true, audible: false },
    { id: 3, windowId: 1, url: "https://audio.example", title: "Audio", active: false, pinned: false, audible: true },
    { id: 4, windowId: 1, url: "https://mail.example", title: "Mail", active: false, pinned: false, audible: false }
  ];
  const harness = createBackgroundHarness({
    mytabdesk_tab_lifecycle_config: {
      enabled: true,
      idleWarningMinutes: 1,
      autoSaveHours: 2,
      maxTabs: 20,
      autoCloseEnabled: false,
      whitelistDomains: ["mail.example"],
      retentionDays: 90
    }
  }, { currentTabs });
  currentTabs.forEach((tab) => harness.listeners.tabCreated(tab));
  await flushPromises();
  const response = await sendBackgroundMessage(harness.listeners.runtimeMessage, { type: "get-tab-lifecycle" });
  const byId = Object.fromEntries(response.tabs.map((tab) => [tab.tabId, tab]));
  assert.equal(byId[1].protectedReason, "");
  assert.equal(byId[2].protectedReason, "pinned");
  assert.equal(byId[3].protectedReason, "audible");
  assert.equal(byId[4].protectedReason, "whitelist");
  assert.equal(typeof byId[1].openMs, "number");
  assert.equal(typeof byId[1].idleMs, "number");
}

async function testScheduledSaveAlarmWritesCurrentTabsToConfiguredGroup() {
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const data = {
    version: 1,
    activeSpaceId: "space-a",
    spaces: [{ id: "space-a", name: "工作", groups: [{ id: "group-a", name: "每日", links: [] }] }],
    settings: { scheduledSave: { enabled: true, time, spaceId: "space-a", groupId: "group-a" } }
  };
  const harness = createBackgroundHarness({ my_tab_desk_data: data }, {
    currentTabs: [{ id: 1, windowId: 1, url: "https://scheduled.example", title: "Scheduled", active: true, pinned: false }]
  });
  await harness.listeners.alarm({ name: "MyTabDeskScheduledSave" });
  await flushPromises();
  const links = harness.storage.my_tab_desk_data.spaces[0].groups[0].links;
  assert.equal(links.length, 1);
  assert.equal(links[0].url, "https://scheduled.example");
  assert.equal(harness.storage.my_tab_desk_data.settings.scheduledSave.lastRunDate.length, 10);
}

async function testScheduledSavePreservesConcurrentWorkspaceChanges() {
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const data = {
    version: 1,
    activeSpaceId: "space-a",
    spaces: [{ id: "space-a", name: "工作", groups: [{ id: "group-a", name: "每日", links: [] }] }],
    settings: { scheduledSave: { enabled: true, time, spaceId: "space-a", groupId: "group-a" } }
  };
  const concurrentLink = {
    id: "link-concurrent",
    title: "页面并发保存",
    url: "https://concurrent.example",
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  const harness = createBackgroundHarness({ my_tab_desk_data: data }, {
    currentTabs: [{ id: 1, windowId: 1, url: "https://scheduled.example", title: "Scheduled", active: true, pinned: false }],
    async onTabsQuery(storage) {
      storage.my_tab_desk_data = structuredClone(storage.my_tab_desk_data);
      storage.my_tab_desk_data.spaces[0].groups[0].links.push(concurrentLink);
    }
  });

  await harness.listeners.alarm({ name: "MyTabDeskScheduledSave" });
  await flushPromises();

  const links = harness.storage.my_tab_desk_data.spaces[0].groups[0].links;
  assert.equal(links.some((link) => link.id === concurrentLink.id), true);
  assert.equal(links.some((link) => link.url === "https://scheduled.example"), true);
}

async function runTests() {
  await testBackgroundUsesRuntimeMessagingForExtensionPage();
  await testPageRunsAutoSyncForRuntimeMessage();
  await testPageConsumesPendingAutoSyncWakeOnStartup();
  await testPendingSaveCanOnlyBeClaimedOnceBeforeAck();
  await testPendingSaveReleaseAllowsRetryAndQueueIsFifo();
  await testPendingAckFailureKeepsQueueAndReturnsFailure();
  await testRapidContextMenuSavesAreQueued();
  await testFailedPageSaveReleasesPendingClaim();
  await testFailedPendingAckIsReleasedAndReported();
  await testUninitializedPageReleasesPendingClaim();
  await testAutoSyncLeaseAllowsOnlyOneOwner();
  await testAutoSyncLeaseSurvivesBackgroundRestart();
  await testPageSkipsAutoSyncWithoutLease();
  await testPageReleasesLeaseWhenAutoSyncFails();
  await testSessionSnapshotsAreDeduplicatedAndBounded();
  await testConcurrentSessionHistoryWritesAreSerialized();
  await testCaptureAndDeleteUseSameSessionHistoryLock();
  await testExpiredDuplicateIsReplacedAndGroupIdsAreStable();
  await testAutomaticSessionSnapshotAlarmRunsEveryFifteenMinutes();
  await testExistingAlarmsAreNotResetOnWorkerRestart();
  await testSessionHistoryCanBeListedRestoredAndDeleted();
  await testSessionCanRestoreIntoCurrentWindowAndSkipOpenUrls();
  await testSessionRestoreCanFilterSelectedTabs();
  await testRemoteSessionReplacementValidatesAndAppliesLimit();
  await testNativeTabGroupsAreCapturedAndRestored();
  await testSaveCleanupProtectsPinnedActiveAndInternalTabs();
  await testBrowserCommandsOpenDeskAndQueueActiveTab();
  await testUsageEventsAreAggregatedByDay();
  await testTabLifecycleTracksActiveDomainTime();
  await testLifecycleStatusProtectsPinnedAudibleAndWhitelistedTabs();
  await testScheduledSaveAlarmWritesCurrentTabsToConfiguredGroup();
  await testScheduledSavePreservesConcurrentWorkspaceChanges();
  console.log("浏览器消息测试通过");
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
