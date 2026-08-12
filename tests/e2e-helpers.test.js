const assert = require("node:assert/strict");
const { removeDirectoryWithRetry, openCreateSpaceDialog } = require("./e2e-helpers.js");

async function testRetriesWindowsPermissionErrors() {
  const attemptedCodes = [];
  let attempt = 0;
  await removeDirectoryWithRetry("C:\\temp\\profile", {
    remove: () => {
      attempt += 1;
      if (attempt < 3) {
        const error = new Error("目录仍被占用");
        error.code = attempt === 1 ? "EPERM" : "ENOTEMPTY";
        attemptedCodes.push(error.code);
        throw error;
      }
    },
    sleep: async () => {},
    maxAttempts: 3
  });
  assert.deepEqual(attemptedCodes, ["EPERM", "ENOTEMPTY"]);
  assert.equal(attempt, 3);
}

async function testDoesNotRetryUnexpectedErrors() {
  let attempt = 0;
  await assert.rejects(
    removeDirectoryWithRetry("C:\\temp\\profile", {
      remove: () => {
        attempt += 1;
        const error = new Error("无效路径");
        error.code = "EINVAL";
        throw error;
      },
      sleep: async () => {},
      maxAttempts: 5
    }),
    (error) => error.code === "EINVAL"
  );
  assert.equal(attempt, 1);
}

async function testOpensCreateSpaceDialogWithoutMenuTimingDependency() {
  const calls = [];
  const page = {
    async waitForFunction(callback) {
      calls.push(`ready:${callback.toString()}`);
    },
    locator(selector) {
      return {
        async click() {
          calls.push(`${selector}:click`);
        },
        async waitFor(options) {
          calls.push(`${selector}:${options.state}`);
        }
      };
    }
  };

  await openCreateSpaceDialog(page);

  assert.equal(calls.some((call) => call.includes("MyTabDeskPage.state.initialized")), true);
  assert.equal(calls.includes("#createSpaceBtn:click"), true);
  assert.equal(calls.includes("#createSpaceMenu:visible"), true);
  assert.equal(calls.includes("#createBlankSpaceBtn:click"), true);
  assert.equal(calls.includes("#createSpaceDialog:visible"), true);
}

async function runTests() {
  await testRetriesWindowsPermissionErrors();
  await testDoesNotRetryUnexpectedErrors();
  await testOpensCreateSpaceDialogWithoutMenuTimingDependency();
  console.log("E2E 辅助逻辑测试通过");
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
