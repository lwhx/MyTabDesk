const fs = require("node:fs");

const RETRYABLE_REMOVE_ERROR_CODES = new Set(["EBUSY", "EPERM", "ENOTEMPTY"]);

async function removeDirectoryWithRetry(directory, options = {}) {
  const remove = options.remove || ((target) => fs.rmSync(target, { recursive: true, force: true }));
  const sleep = options.sleep || ((delay) => new Promise((resolve) => setTimeout(resolve, delay)));
  const maxAttempts = options.maxAttempts || 8;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      remove(directory);
      return;
    } catch (error) {
      if (!RETRYABLE_REMOVE_ERROR_CODES.has(error.code) || attempt === maxAttempts - 1) throw error;
      await sleep(200 * (attempt + 1));
    }
  }
}

async function openCreateSpaceDialog(page) {
  await page.waitForFunction(() => {
    return Boolean(globalThis.MyTabDeskPage && globalThis.MyTabDeskPage.state.initialized);
  });
  await page.locator("#createSpaceBtn").click();
  await page.locator("#createSpaceMenu").waitFor({ state: "visible" });
  await page.locator("#createBlankSpaceBtn").click();
  await page.locator("#createSpaceDialog").waitFor({ state: "visible" });
}

module.exports = { removeDirectoryWithRetry, openCreateSpaceDialog };
