const { performance: performanceClock } = require("node:perf_hooks");
const { normalizeData } = require("../core/normalize.js");
const { mergeWorkspaceData } = require("../core/merge.js");
const { filterGroups } = require("../core/tabs.js");
const { createPageStore } = require("../page-store.js");
const { createEventBus } = require("../page-event-bus.js");

/** 默认性能预算，使用宽松阈值降低不同机器之间的波动。 */
const DEFAULT_BUDGETS = {
  "工作台标准化": { medianMs: 120, p95Ms: 250 },
  "工作台合并": { medianMs: 350, p95Ms: 700 },
  "链接搜索过滤": { medianMs: 60, p95Ms: 150 },
  "页面状态更新": { medianMs: 40, p95Ms: 100 },
  "页面事件派发": { medianMs: 30, p95Ms: 80 },
  workspaceBytes: 8 * 1024 * 1024
};

/**
 * 创建确定性大型工作台测试数据。
 *
 * @param {{spaceCount?:number,groupCount?:number,linksPerGroup?:number,seed?:string}} options 数据规模选项。
 * @returns {object} 可用于核心算法测试的工作台数据。
 */
function createWorkspaceFixture(options = {}) {
  /** 空间数量。 */
  const spaceCount = options.spaceCount || 10;
  /** 每个空间的分组数量。 */
  const groupCount = options.groupCount || 20;
  /** 每个分组的链接数量。 */
  const linksPerGroup = options.linksPerGroup || 50;
  /** 确定性 ID 前缀。 */
  const seed = options.seed || "benchmark";
  /** 固定基准时间，避免夹具内容随运行时间变化。 */
  const baseTime = 1700000000000;
  /** 工作台空间列表。 */
  const spaces = [];

  for (let spaceIndex = 0; spaceIndex < spaceCount; spaceIndex += 1) {
    /** 当前空间的分组列表。 */
    const groups = [];

    for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
      /** 当前分组的链接列表。 */
      const links = [];

      for (let linkIndex = 0; linkIndex < linksPerGroup; linkIndex += 1) {
        /** 当前链接的全局顺序。 */
        const sequence = ((spaceIndex * groupCount) + groupIndex) * linksPerGroup + linkIndex;
        links.push({
          id: `${seed}-link-${sequence}`,
          title: `性能资料 ${sequence}`,
          url: `https://example.com/${seed}/${sequence}`,
          favIconUrl: "",
          note: sequence % 7 === 0 ? `关键字 benchmark ${sequence}` : "",
          color: sequence % 5 === 0 ? "blue" : "",
          createdAt: baseTime + sequence,
          updatedAt: baseTime + sequence,
          order: linkIndex
        });
      }

      groups.push({
        id: `${seed}-space-${spaceIndex}-group-${groupIndex}`,
        name: `性能分组 ${spaceIndex}-${groupIndex}`,
        collapsed: false,
        pinned: groupIndex === 0,
        links,
        createdAt: baseTime + groupIndex,
        updatedAt: baseTime + groupIndex
      });
    }

    spaces.push({
      id: `${seed}-space-${spaceIndex}`,
      name: `性能空间 ${spaceIndex}`,
      icon: "📁",
      groups,
      createdAt: baseTime + spaceIndex,
      updatedAt: baseTime + spaceIndex
    });
  }

  return {
    version: 1,
    activeSpaceId: `${seed}-space-0`,
    spaces,
    settings: {
      updatedAt: baseTime,
      sync: {
        deviceId: `${seed}-device`,
        stateUpdatedAt: baseTime
      }
    }
  };
}

/**
 * 计算给定样本的最近秩百分位数。
 *
 * @param {Array<number>} samples 原始数值样本。
 * @param {number} ratio 百分位比例，取值范围为 0 到 1。
 * @returns {number} 百分位结果。
 */
function percentile(samples, ratio) {
  if (!Array.isArray(samples) || samples.length === 0) return 0;
  /** 升序排列的样本副本。 */
  const sorted = [...samples].sort((left, right) => left - right);
  /** 最近秩索引。 */
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
}

/**
 * 对单个性能场景执行预热和多轮采样。
 *
 * @param {{name:string,operation:Function,warmupRuns?:number,sampleRuns?:number}} options 测量选项。
 * @returns {Promise<object>} 场景性能结果。
 */
async function measureScenario(options) {
  /** 预热次数。 */
  const warmupRuns = options.warmupRuns == null ? 3 : options.warmupRuns;
  /** 正式采样次数。 */
  const sampleRuns = options.sampleRuns == null ? 15 : options.sampleRuns;
  /** 正式耗时样本。 */
  const samples = [];

  for (let index = 0; index < warmupRuns; index += 1) {
    await options.operation();
  }

  for (let index = 0; index < sampleRuns; index += 1) {
    /** 单次测量开始时间。 */
    const startedAt = performanceClock.now();
    await options.operation();
    samples.push(performanceClock.now() - startedAt);
  }

  return {
    name: options.name,
    samples,
    medianMs: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95)
  };
}

/**
 * 执行核心算法和页面通信性能基准。
 *
 * @param {{fixtureOptions?:object,warmupRuns?:number,sampleRuns?:number,enforceBudgets?:boolean,budgets?:object}} options 基准选项。
 * @returns {Promise<object>} 完整基准报告。
 * @throws {Error} 启用预算门禁且任一场景超出预算时抛出。
 */
async function runBenchmarkSuite(options = {}) {
  /** 基准工作台夹具。 */
  const fixture = createWorkspaceFixture(options.fixtureOptions);
  /** 用于模拟远端独有数据的工作台夹具。 */
  const remoteFixture = createWorkspaceFixture({
    ...(options.fixtureOptions || {}),
    seed: `${options.fixtureOptions && options.fixtureOptions.seed || "benchmark"}-remote`
  });
  /** 页面状态仓库。 */
  const store = createPageStore({ counter: 0, viewMode: "workspace" });
  /** 页面事件总线。 */
  const eventBus = createEventBus();
  /** 事件派发计数器。 */
  let emittedEvents = 0;
  eventBus.on("benchmark:event", () => {
    emittedEvents += 1;
  });
  /** 所有场景共用的采样选项。 */
  const measurementOptions = {
    warmupRuns: options.warmupRuns,
    sampleRuns: options.sampleRuns
  };
  /** 核心性能场景。 */
  const scenarios = [];

  scenarios.push(await measureScenario({
    ...measurementOptions,
    name: "工作台标准化",
    operation: () => normalizeData(fixture)
  }));
  scenarios.push(await measureScenario({
    ...measurementOptions,
    name: "工作台合并",
    operation: () => mergeWorkspaceData(fixture, remoteFixture, "benchmark-device")
  }));
  scenarios.push(await measureScenario({
    ...measurementOptions,
    name: "链接搜索过滤",
    operation: () => fixture.spaces.map((space) => filterGroups(space.groups, "benchmark"))
  }));
  scenarios.push(await measureScenario({
    ...measurementOptions,
    name: "页面状态更新",
    operation: () => {
      for (let index = 0; index < 1000; index += 1) {
        store.updateState((state) => {
          state.counter += 1;
        });
      }
    }
  }));
  scenarios.push(await measureScenario({
    ...measurementOptions,
    name: "页面事件派发",
    operation: () => {
      for (let index = 0; index < 10000; index += 1) {
        eventBus.emit("benchmark:event", index);
      }
    }
  }));

  /** 工作台序列化大小。 */
  const workspaceBytes = Buffer.byteLength(JSON.stringify(fixture), "utf8");
  /** 最终基准报告。 */
  const report = { scenarios, workspaceBytes, emittedEvents };

  if (options.enforceBudgets !== false) {
    assertBudgets(report, options.budgets || DEFAULT_BUDGETS);
  }

  return report;
}

/**
 * 验证基准报告是否满足性能预算。
 *
 * @param {object} report 基准报告。
 * @param {object} budgets 性能预算。
 * @returns {void}
 * @throws {Error} 任一性能指标超出预算时抛出。
 */
function assertBudgets(report, budgets) {
  /** 超出预算的指标描述。 */
  const failures = [];

  for (const scenario of report.scenarios) {
    /** 当前场景预算。 */
    const budget = budgets[scenario.name];
    if (!budget) continue;
    if (scenario.medianMs > budget.medianMs) {
      failures.push(`${scenario.name} 中位数 ${scenario.medianMs.toFixed(2)}ms > ${budget.medianMs}ms`);
    }
    if (scenario.p95Ms > budget.p95Ms) {
      failures.push(`${scenario.name} P95 ${scenario.p95Ms.toFixed(2)}ms > ${budget.p95Ms}ms`);
    }
  }

  if (report.workspaceBytes > budgets.workspaceBytes) {
    failures.push(`工作台大小 ${report.workspaceBytes} bytes > ${budgets.workspaceBytes} bytes`);
  }

  if (failures.length > 0) {
    throw new Error(`性能预算未通过：\n${failures.join("\n")}`);
  }
}

/**
 * 输出便于人工和持续集成阅读的基准报告。
 *
 * @param {object} report 基准报告。
 * @returns {void}
 */
function printReport(report) {
  console.log("MyTabDesk 性能基准");
  for (const scenario of report.scenarios) {
    console.log(`${scenario.name}: median=${scenario.medianMs.toFixed(2)}ms, p95=${scenario.p95Ms.toFixed(2)}ms`);
  }
  console.log(`工作台 JSON 大小: ${(report.workspaceBytes / 1024 / 1024).toFixed(2)}MB`);
  console.log("性能预算验证通过");
}

module.exports = {
  DEFAULT_BUDGETS,
  createWorkspaceFixture,
  percentile,
  measureScenario,
  runBenchmarkSuite,
  assertBudgets,
  printReport
};

if (require.main === module) {
  runBenchmarkSuite()
    .then(printReport)
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
