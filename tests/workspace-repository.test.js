const assert = require("node:assert/strict");
const { createWorkspaceRepository } = require("../workspace-repository.js");

async function testUpdateReadsLatestDataInsideLock() {
  const storage = {
    workspace: { links: [{ id: "before" }] }
  };
  let lockRequests = 0;
  const repository = createWorkspaceRepository({
    storageArea: {
      async get(key) {
        return { [key]: structuredClone(storage[key]) };
      },
      async set(values) {
        Object.assign(storage, structuredClone(values));
      }
    },
    storageKey: "workspace",
    lockManager: {
      async request(name, operation) {
        lockRequests += 1;
        assert.equal(name, "mytabdesk-storage-write");
        storage.workspace.links.push({ id: "concurrent" });
        return operation();
      }
    }
  });

  await repository.update((latestData) => {
    latestData.links.push({ id: "updated" });
    return latestData;
  });

  assert.equal(lockRequests, 1);
  assert.deepEqual(storage.workspace.links.map((link) => link.id), ["before", "concurrent", "updated"]);
}

async function testUpdateDoesNotWriteWhenOperationDeclines() {
  let writes = 0;
  const repository = createWorkspaceRepository({
    storageArea: {
      async get(key) {
        return { [key]: { id: "workspace" } };
      },
      async set() {
        writes += 1;
      }
    },
    storageKey: "workspace"
  });

  const result = await repository.update(() => null);

  assert.equal(result, null);
  assert.equal(writes, 0);
}

async function runTests() {
  await testUpdateReadsLatestDataInsideLock();
  await testUpdateDoesNotWriteWhenOperationDeclines();
  console.log("工作台仓储测试通过");
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
