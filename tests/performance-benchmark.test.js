const assert = require("node:assert/strict");
const {
  createWorkspaceFixture,
  measureScenario,
  percentile,
  runBenchmarkSuite
} = require("../scripts/performance-benchmark.js");

/**
 * 验证大型工作台夹具具有稳定且可核对的数据规模。
 *
 * @returns {void}
 */
function testCreatesDeterministicWorkspaceFixture() {
  const fixture = createWorkspaceFixture({
    spaceCount: 3,
    groupCount: 4,
    linksPerGroup: 5,
    seed: "test"
  });
  const groups = fixture.spaces.flatMap((space) => space.groups);
  const links = groups.flatMap((group) => group.links);

  assert.equal(fixture.spaces.length, 3);
  assert.equal(groups.length, 12);
  assert.equal(links.length, 60);
  assert.equal(new Set(links.map((link) => link.id)).size, 60);
  assert.equal(fixture.activeSpaceId, "test-space-0");
}

/**
 * 验证百分位计算使用排序后的最近秩结果。
 *
 * @returns {void}
 */
function testCalculatesPercentileByNearestRank() {
  assert.equal(percentile([9, 1, 5, 3, 7], 0.5), 5);
  assert.equal(percentile([9, 1, 5, 3, 7], 0.95), 9);
}

/**
 * 验证场景测量会执行预热，并仅统计正式采样。
 *
 * @returns {Promise<void>}
 */
async function testMeasuresWarmupAndSamplesSeparately() {
  let calls = 0;
  const result = await measureScenario({
    name: "测试场景",
    warmupRuns: 2,
    sampleRuns: 5,
    operation: () => {
      calls += 1;
    }
  });

  assert.equal(calls, 7);
  assert.equal(result.samples.length, 5);
  assert.equal(Number.isFinite(result.medianMs), true);
  assert.equal(Number.isFinite(result.p95Ms), true);
}

/**
 * 验证完整基准套件覆盖核心算法、页面状态与事件通信场景。
 *
 * @returns {Promise<void>}
 */
async function testRunsRequiredBenchmarkScenarios() {
  const report = await runBenchmarkSuite({
    fixtureOptions: {
      spaceCount: 2,
      groupCount: 3,
      linksPerGroup: 20,
      seed: "suite"
    },
    warmupRuns: 1,
    sampleRuns: 3,
    enforceBudgets: false
  });
  const scenarioNames = new Set(report.scenarios.map((scenario) => scenario.name));

  assert.equal(scenarioNames.has("工作台标准化"), true);
  assert.equal(scenarioNames.has("工作台合并"), true);
  assert.equal(scenarioNames.has("链接搜索过滤"), true);
  assert.equal(scenarioNames.has("页面状态更新"), true);
  assert.equal(scenarioNames.has("页面事件派发"), true);
  assert.equal(report.workspaceBytes > 0, true);
}

/**
 * 依次执行性能基准工具测试。
 *
 * @returns {Promise<void>}
 */
async function runTests() {
  testCreatesDeterministicWorkspaceFixture();
  testCalculatesPercentileByNearestRank();
  await testMeasuresWarmupAndSamplesSeparately();
  await testRunsRequiredBenchmarkScenarios();
  console.log("性能基准工具测试通过");
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
