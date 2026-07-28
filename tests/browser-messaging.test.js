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
  const storage = { ...initialStorage };
  const context = {
    URL,
    console: quietConsole,
    setTimeout() { return 1; },
    clearTimeout() {},
    chrome: {
      action: { onClicked: { addListener(handler) { listeners.action = handler; } } },
      alarms: {
        clear(_name, callback) { callback(); },
        create() {},
        onAlarm: { addListener(handler) { listeners.alarm = handler; } }
      },
      contextMenus: {
        removeAll(callback) { callback(); },
        create() {},
        onClicked: { addListener(handler) { listeners.contextMenu = handler; } }
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
          async get(key) { return { [key]: storage[key] }; },
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
        async query() { return [{ id: 7, url: "chrome-extension://test/newtab.html" }]; },
        create() {},
        sendMessage(tabId, message, callback) {
          tabMessages.push({ tabId, message });
          callback();
        }
      }
    }
  };

  vm.runInNewContext(fs.readFileSync(path.join(projectRoot, "background.js"), "utf8"), context);
  return { listeners, runtimeMessages, tabMessages, storage };
}

function sendBackgroundMessage(listener, message) {
  return new Promise((resolve) => {
    listener(message, {}, resolve);
  });
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
  console.log("浏览器消息测试通过");
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
