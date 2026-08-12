const assert = require("node:assert/strict");
const { createPageStore } = require("../page-store.js");
const { createEventBus } = require("../page-event-bus.js");
const { createPageStateController } = require("../page-state-controller.js");

/**
 * 创建模拟持久化存储，用于验证内存、存储和事件的一致性。
 *
 * @param {object} initialData 初始工作台数据。
 * @returns {{load:Function,save:Function,failNextSave:Function}} 模拟持久化存储。
 */
function createPersistenceHarness(initialData) {
  let storedData = structuredClone(initialData);
  let nextError = null;

  return {
    load() {
      return structuredClone(storedData);
    },
    async save(data) {
      if (nextError) {
        const error = nextError;
        nextError = null;
        throw error;
      }
      storedData = structuredClone(data);
    },
    failNextSave(error) {
      nextError = error;
    }
  };
}

/**
 * 创建阶段四页面事务测试环境。
 *
 * @returns {{store:object,eventBus:object,controller:object,persistence:object,events:Array<string>}} 测试环境。
 */
function createHarness() {
  const data = {
    activeSpaceId: "space-1",
    spaces: [{
      id: "space-1",
      name: "集成空间",
      groups: [{ id: "group-1", name: "集成分组", links: [] }]
    }]
  };
  const store = createPageStore({
    data,
    viewMode: "workspace",
    createSpaceMenuOpen: false
  });
  const eventBus = createEventBus();
  const persistence = createPersistenceHarness(data);
  const events = [];
  const controller = createPageStateController({
    store,
    eventBus,
    persist: async () => persistence.save(store.getState().data)
  });

  eventBus.on("workspace:committed", () => events.push("committed"));
  eventBus.on("workspace:operation-failed", () => events.push("failed"));

  return { store, eventBus, controller, persistence, events };
}

/**
 * 验证提交成功后内存、存储、事件和渲染订阅保持一致。
 *
 * @returns {Promise<void>}
 */
async function testCommitConvergesMemoryStorageEventAndRender() {
  const harness = createHarness();
  const stateReference = harness.store.getState();
  let renderedLinks = -1;
  harness.eventBus.on("workspace:committed", () => {
    renderedLinks = harness.store.getState().data.spaces[0].groups[0].links.length;
  });

  await harness.controller.commitWorkspaceChange((state) => {
    state.data.spaces[0].groups[0].links.push({
      id: "link-1",
      title: "阶段四链接",
      url: "https://example.com/stage4"
    });
  }, { reason: "stage4-link-added", source: "integration" });

  assert.equal(harness.store.getState(), stateReference);
  assert.equal(harness.persistence.load().spaces[0].groups[0].links.length, 1);
  assert.deepEqual(harness.events, ["committed"]);
  assert.equal(renderedLinks, 1);
}

/**
 * 验证持久化失败后内存回滚、存储不变且成功失败事件互斥。
 *
 * @returns {Promise<void>}
 */
async function testFailedCommitRollsBackWithoutFalseSuccess() {
  const harness = createHarness();
  const stateReference = harness.store.getState();
  harness.persistence.failNextSave(new Error("模拟磁盘写入失败"));

  await assert.rejects(
    harness.controller.commitWorkspaceChange((state) => {
      state.data.spaces[0].groups[0].links.push({
        id: "link-failed",
        title: "不应保存",
        url: "https://example.com/failed"
      });
    }, { reason: "stage4-save-failed", source: "integration" }),
    /模拟磁盘写入失败/
  );

  assert.equal(harness.store.getState(), stateReference);
  assert.equal(harness.store.getState().data.spaces[0].groups[0].links.length, 0);
  assert.equal(harness.persistence.load().spaces[0].groups[0].links.length, 0);
  assert.deepEqual(harness.events, ["failed"]);
}

/**
 * 依次执行阶段四页面事务集成测试。
 *
 * @returns {Promise<void>}
 */
async function runTests() {
  await testCommitConvergesMemoryStorageEventAndRender();
  await testFailedCommitRollsBackWithoutFalseSuccess();
  console.log("阶段四页面事务集成测试通过");
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
