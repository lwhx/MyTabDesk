const assert = require("node:assert/strict");
const { createPageStore } = require("../page-store.js");
const { createEventBus } = require("../page-event-bus.js");

async function testCommitPublishesAfterPersistenceAndRendersThroughSubscriber() {
  const calls = [];
  const store = createPageStore({ data: { value: 1 }, viewMode: "workspace" });
  const eventBus = createEventBus();
  const controller = createController(store, eventBus, async () => calls.push("save"));
  eventBus.on("workspace:committed", () => calls.push("render"));

  await controller.commitWorkspaceChange((state) => {
    state.data.value = 2;
    calls.push("mutate");
  }, { reason: "value-updated", source: "test" });

  assert.deepEqual(calls, ["mutate", "save", "render"]);
  assert.equal(store.getState().data.value, 2);
}

async function testCommitRollsBackAndDoesNotPublishWhenPersistenceFails() {
  const store = createPageStore({ data: { value: 1 }, viewMode: "workspace" });
  const eventBus = createEventBus();
  let committed = 0;
  eventBus.on("workspace:committed", () => committed += 1);
  const controller = createController(store, eventBus, async () => {
    throw new Error("保存失败");
  });

  await assert.rejects(
    controller.commitWorkspaceChange((state) => {
      state.data.value = 2;
    }, { reason: "value-updated" }),
    /保存失败/
  );

  assert.equal(store.getState().data.value, 1);
  assert.equal(committed, 0);
}

function testNavigationPublishesSingleViewEvent() {
  const resolver = () => true;
  const store = createPageStore({
    data: null,
    viewMode: "workspace",
    createSpaceMenuOpen: true,
    appDialogResolver: resolver
  });
  const eventBus = createEventBus();
  const controller = createController(store, eventBus, async () => {});
  const events = [];
  eventBus.on("view:changed", (payload) => events.push(payload));

  controller.navigate("trash", { source: "test" });

  assert.equal(store.getState().viewMode, "trash");
  assert.equal(store.getState().createSpaceMenuOpen, false);
  assert.equal(store.getState().appDialogResolver, resolver);
  assert.deepEqual(events, [{ viewMode: "trash", previousViewMode: "workspace", source: "test" }]);
}

function createController(store, eventBus, persist) {
  const moduleApi = require("../page-state-controller.js");
  return moduleApi.createPageStateController({ store, eventBus, persist });
}

async function runTests() {
  await testCommitPublishesAfterPersistenceAndRendersThroughSubscriber();
  await testCommitRollsBackAndDoesNotPublishWhenPersistenceFails();
  testNavigationPublishesSingleViewEvent();
  console.log("页面状态集成测试通过");
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
