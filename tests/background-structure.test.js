const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

function testBackgroundDelegatesMessageRouting() {
  const source = fs.readFileSync(path.join(projectRoot, "background.js"), "utf8");
  assert.equal(source.includes('"background-notifications.js"'), true);
  assert.equal(source.includes('"background-page-messaging.js"'), true);
  assert.equal(source.includes("createMessageRouter"), true);
  assert.equal(source.includes("chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {"), false);
  assert.equal(source.includes("function showNotification("), false);
  assert.equal(source.includes("function sendMessageToExtensionPages("), false);
}

function testReleaseIncludesBackgroundModules() {
  const buildSource = fs.readFileSync(path.join(projectRoot, "scripts", "build-dist.js"), "utf8");
  assert.equal(buildSource.includes('"message-protocol.js"'), true);
  assert.equal(buildSource.includes('"background-message-router.js"'), true);
  assert.equal(buildSource.includes('"background-notifications.js"'), true);
  assert.equal(buildSource.includes('"background-page-messaging.js"'), true);
}

function runTests() {
  testBackgroundDelegatesMessageRouting();
  testReleaseIncludesBackgroundModules();
  console.log("后台结构测试通过");
}

try {
  runTests();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
