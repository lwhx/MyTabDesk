const assert = require("node:assert/strict");
const { createEventBus } = require("../page-event-bus.js");

function testEmitsInRegistrationOrderAndSupportsUnsubscribe() {
  const bus = createEventBus();
  const calls = [];
  const unsubscribe = bus.on("workspace:committed", (payload) => calls.push(`first:${payload.reason}`));
  bus.on("workspace:committed", (payload) => calls.push(`second:${payload.reason}`));
  bus.emit("workspace:committed", { reason: "created" });
  unsubscribe();
  bus.emit("workspace:committed", { reason: "updated" });
  assert.deepEqual(calls, ["first:created", "second:created", "second:updated"]);
}

function testOnceAndEventIsolation() {
  const bus = createEventBus();
  let viewChanges = 0;
  let workspaceChanges = 0;
  bus.once("view:changed", () => viewChanges += 1);
  bus.on("workspace:committed", () => workspaceChanges += 1);
  bus.emit("view:changed", {});
  bus.emit("view:changed", {});
  bus.emit("workspace:committed", {});
  assert.equal(viewChanges, 1);
  assert.equal(workspaceChanges, 1);
}

function testUsesListenerSnapshotDuringEmission() {
  const bus = createEventBus();
  const calls = [];
  let unsubscribeSecond = () => {};
  bus.on("event", () => {
    calls.push("first");
    unsubscribeSecond();
  });
  unsubscribeSecond = bus.on("event", () => calls.push("second"));
  bus.emit("event", {});
  bus.emit("event", {});
  assert.deepEqual(calls, ["first", "second", "first"]);
}

function runTests() {
  testEmitsInRegistrationOrderAndSupportsUnsubscribe();
  testOnceAndEventIsolation();
  testUsesListenerSnapshotDuringEmission();
  console.log("页面事件总线测试通过");
}

try {
  runTests();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
