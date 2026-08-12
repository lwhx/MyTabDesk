const assert = require("node:assert/strict");
const { createPageStore } = require("../page-store.js");

function createInitialState() {
  return {
    data: null,
    viewMode: "workspace",
    selectedLinkIds: new Set(),
    syncLog: []
  };
}

function testKeepsStableStateReference() {
  const store = createPageStore(createInitialState());
  const state = store.getState();
  store.updateState((draft) => {
    draft.viewMode = "settings";
  }, { type: "view/changed", source: "test" });
  assert.equal(store.getState(), state);
  assert.equal(state.viewMode, "settings");
}

function testNotifiesSelectorOnlyWhenSelectedValueChanges() {
  const store = createPageStore(createInitialState());
  const changes = [];
  const unsubscribe = store.subscribe(
    (state) => state.viewMode,
    (value, previousValue, metadata) => changes.push({ value, previousValue, metadata })
  );
  store.updateState((draft) => {
    draft.syncLog.push("同步");
  }, { type: "sync/logged" });
  store.updateState((draft) => {
    draft.viewMode = "trash";
  }, { type: "view/changed", source: "test" });
  unsubscribe();
  store.updateState((draft) => {
    draft.viewMode = "stats";
  }, { type: "view/changed" });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].value, "trash");
  assert.equal(changes[0].previousValue, "workspace");
  assert.equal(changes[0].metadata.source, "test");
}

function testRollsBackWhenUpdaterFails() {
  const store = createPageStore(createInitialState());
  let notifications = 0;
  store.subscribe(() => notifications += 1);
  assert.throws(() => store.updateState((draft) => {
    draft.viewMode = "trash";
    throw new Error("更新失败");
  }), /更新失败/);
  assert.equal(store.getState().viewMode, "workspace");
  assert.equal(notifications, 0);
}

function testResetPreservesReferenceAndCollectionTypes() {
  const store = createPageStore(createInitialState());
  const state = store.getState();
  state.selectedLinkIds.add("link-1");
  store.updateState((draft) => {
    draft.viewMode = "trash";
  });
  store.reset({ type: "app/reset" });
  assert.equal(store.getState(), state);
  assert.equal(state.viewMode, "workspace");
  assert.equal(state.selectedLinkIds instanceof Set, true);
  assert.equal(state.selectedLinkIds.size, 0);
}

function testSupportsRuntimeCallbackState() {
  const callback = () => true;
  const store = createPageStore({ viewMode: "workspace", dialogResolver: callback });
  store.updateState((state) => {
    state.viewMode = "settings";
  });
  assert.equal(store.getState().dialogResolver, callback);
}

function runTests() {
  testKeepsStableStateReference();
  testNotifiesSelectorOnlyWhenSelectedValueChanges();
  testRollsBackWhenUpdaterFails();
  testResetPreservesReferenceAndCollectionTypes();
  testSupportsRuntimeCallbackState();
  console.log("页面状态仓库测试通过");
}

try {
  runTests();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
