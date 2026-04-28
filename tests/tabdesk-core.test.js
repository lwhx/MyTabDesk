/**
 * Node.js 严格断言模块，用于校验核心逻辑输出是否符合预期。
 */
const assert = require("node:assert/strict");

/**
 * MyTabDesk 核心纯逻辑模块。
 */
const tabdeskCore = require("../tabdesk-core.js");

/**
 * 从核心模块中解构出的待测试函数集合。
 */
const {
  createDefaultData,
  normalizeData,
  isValidTabUrl,
  filterValidTabs,
  tabsToLinks,
  filterGroups,
  createDeviceId,
  ensureSyncSettings,
  getDataUpdatedAt,
  createEncryptedBackup,
  restoreEncryptedBackup,
  detectImportConflict,
  exportData,
  importData,
  moveArrayItem,
  reorderSpaces,
  reorderGroups,
  reorderLinks,
  moveLinkBetweenGroups,
  addLinksToGroup,
  clearAllData
} = tabdeskCore;

/**
 * 测试默认数据创建逻辑。
 *
 * @returns {void}
 */
function testCreateDefaultData() {
  /** 默认工作台数据。 */
  const data = createDefaultData();

  assert.equal(data.version, 1);
  assert.equal(data.activeSpaceId, "default-space");
  assert.equal(data.spaces.length, 1);
  assert.equal(data.spaces[0].name, "默认空间");
  assert.deepEqual(data.spaces[0].groups, []);
}

/**
 * 测试空数据会回退为默认数据。
 *
 * @returns {void}
 */
function testNormalizeDataFallback() {
  /** 标准化后的兜底数据。 */
  const data = normalizeData(null);

  assert.equal(data.activeSpaceId, "default-space");
  assert.equal(data.spaces.length, 1);
}

/**
 * 测试激活空间丢失时会回退到第一个空间。
 *
 * @returns {void}
 */
function testNormalizeDataActiveSpaceFallback() {
  /** 标准化后的工作台数据。 */
  const data = normalizeData({
    version: 1,
    activeSpaceId: "missing-space",
    spaces: [
      {
        id: "space-a",
        name: "空间 A",
        groups: []
      }
    ],
    settings: {}
  });

  assert.equal(data.activeSpaceId, "space-a");
  assert.equal(data.settings.theme, "light");
}

/**
 * 测试标签页 URL 白名单和黑名单规则。
 *
 * @returns {void}
 */
function testIsValidTabUrl() {
  assert.equal(isValidTabUrl("https://example.com"), true);
  assert.equal(isValidTabUrl("http://example.com"), true);
  assert.equal(isValidTabUrl("chrome://extensions/"), false);
  assert.equal(isValidTabUrl("edge://settings/"), false);
  assert.equal(isValidTabUrl("about:blank"), false);
  assert.equal(isValidTabUrl("chrome-extension://abc/newtab.html"), false);
  assert.equal(isValidTabUrl(""), false);
}

/**
 * 测试标签页转链接时会过滤无效地址并按 URL 去重。
 *
 * @returns {void}
 */
function testTabsToLinksFiltersAndDedupes() {
  /** 转换后的链接列表。 */
  const links = tabsToLinks([
    {
      title: "Example",
      url: "https://example.com",
      favIconUrl: "https://example.com/favicon.ico"
    },
    {
      title: "Example Duplicate",
      url: "https://example.com",
      favIconUrl: ""
    },
    {
      title: "Chrome",
      url: "chrome://extensions/",
      favIconUrl: ""
    },
    {
      title: "Docs",
      url: "https://developer.chrome.com/docs/extensions",
      favIconUrl: ""
    }
  ]);

  assert.equal(links.length, 2);
  assert.equal(links[0].title, "Example");
  assert.equal(links[0].url, "https://example.com");
  assert.equal(links[1].title, "Docs");
}

/**
 * 测试非数组标签页输入会返回空数组。
 *
 * @returns {void}
 */
function testFilterValidTabsRejectsNonArray() {
  assert.deepEqual(filterValidTabs(null), []);
}

/**
 * 测试分组搜索会同时匹配分组名称和链接内容。
 *
 * @returns {void}
 */
function testFilterGroups() {
  /** 待搜索的分组列表。 */
  const groups = [
    {
      id: "group-a",
      name: "AI 工具",
      links: [
        {
          title: "OpenAI",
          url: "https://openai.com"
        },
        {
          title: "Chrome Docs",
          url: "https://developer.chrome.com/docs/extensions"
        }
      ]
    },
    {
      id: "group-b",
      name: "项目后台",
      links: [
        {
          title: "Admin",
          url: "https://admin.example.com"
        }
      ]
    }
  ];

  /** 按分组名称命中的搜索结果。 */
  const groupMatched = filterGroups(groups, "AI");
  assert.equal(groupMatched.length, 1);
  assert.equal(groupMatched[0].links.length, 2);

  /** 按链接标题命中的搜索结果。 */
  const linkMatched = filterGroups(groups, "chrome");
  assert.equal(linkMatched.length, 1);
  assert.equal(linkMatched[0].links.length, 1);
  assert.equal(linkMatched[0].links[0].title, "Chrome Docs");

  /** 无匹配项时的搜索结果。 */
  const emptyMatched = filterGroups(groups, "not-found");
  assert.equal(emptyMatched.length, 0);
}

/**
 * 测试设备 ID 会带有设备前缀。
 *
 * @returns {void}
 */
function testCreateDeviceIdUsesDevicePrefix() {
  /** 新生成的设备 ID。 */
  const deviceId = createDeviceId();

  assert.equal(deviceId.startsWith("device-"), true);
}

/**
 * 测试标准化数据会自动补齐同步设置。
 *
 * @returns {void}
 */
function testEnsureSyncSettingsAddsDefaults() {
  /** 原始工作台数据。 */
  const data = createDefaultData();
  /** 补齐同步设置后的工作台数据。 */
  const nextData = ensureSyncSettings(data, "device-fixed");

  assert.equal(nextData.settings.sync.deviceId, "device-fixed");
  assert.equal(nextData.settings.sync.deviceName, "本机浏览器");
  assert.equal(nextData.settings.sync.mode, "manual");
  assert.equal(nextData.settings.sync.lastBackupAt, 0);
  assert.equal(nextData.settings.sync.lastImportAt, 0);
}

/**
 * 测试全量数据更新时间会取空间和分组更新时间的最大值。
 *
 * @returns {void}
 */
function testGetDataUpdatedAtReturnsLatestTimestamp() {
  /** 带有多级更新时间的工作台数据。 */
  const data = normalizeData({
    version: 1,
    activeSpaceId: "space-a",
    spaces: [
      {
        id: "space-a",
        name: "空间 A",
        updatedAt: 100,
        groups: [
          {
            id: "group-a",
            name: "分组 A",
            updatedAt: 300,
            links: []
          }
        ]
      },
      {
        id: "space-b",
        name: "空间 B",
        updatedAt: 200,
        groups: []
      }
    ],
    settings: {}
  });

  assert.equal(getDataUpdatedAt(data), 300);
}

/**
 * 测试加密备份会隐藏原始链接内容并可通过密码恢复。
 *
 * @returns {void}
 */
async function testEncryptedBackupRoundTrip() {
  /** 待备份的工作台数据。 */
  const data = normalizeData({
    version: 1,
    activeSpaceId: "space-a",
    spaces: [
      {
        id: "space-a",
        name: "空间 A",
        groups: [
          {
            id: "group-a",
            name: "分组 A",
            links: [
              {
                id: "link-a",
                title: "Example",
                url: "https://example.com"
              }
            ]
          }
        ]
      }
    ],
    settings: {}
  });

  /** 加密备份文本。 */
  const backupText = await createEncryptedBackup(data, "secret", "device-fixed");
  /** 备份对象。 */
  const backupData = JSON.parse(backupText);

  assert.equal(backupData.backupVersion, 1);
  assert.equal(backupData.appVersion, "2.0.0");
  assert.equal(backupData.deviceId, "device-fixed");
  assert.equal(typeof backupData.exportedAt, "number");
  assert.equal(backupText.includes("https://example.com"), false);

  /** 恢复后的工作台数据。 */
  const restoredData = await restoreEncryptedBackup(backupText, "secret");
  assert.equal(restoredData.spaces[0].groups[0].links[0].url, "https://example.com");
}

/**
 * 测试加密备份密码错误时会抛出可读错误。
 *
 * @returns {void}
 */
async function testRestoreEncryptedBackupRejectsWrongPassword() {
  /** 加密备份文本。 */
  const backupText = await createEncryptedBackup(createDefaultData(), "secret", "device-fixed");

  await assert.rejects(async () => {
    await restoreEncryptedBackup(backupText, "wrong");
  }, /密码错误或文件损坏/);
}

/**
 * 测试导入备份会识别旧数据和不同设备。
 *
 * @returns {void}
 */
function testDetectImportConflictFlagsOlderAndDifferentDevice() {
  /** 本地工作台数据。 */
  const localData = ensureSyncSettings(normalizeData({
    version: 1,
    activeSpaceId: "space-a",
    spaces: [
      {
        id: "space-a",
        name: "空间 A",
        updatedAt: 500,
        groups: []
      }
    ],
    settings: {}
  }), "device-local");

  /** 待导入工作台数据。 */
  const importedData = ensureSyncSettings(normalizeData({
    version: 1,
    activeSpaceId: "space-b",
    spaces: [
      {
        id: "space-b",
        name: "空间 B",
        updatedAt: 100,
        groups: []
      }
    ],
    settings: {}
  }), "device-remote");

  /** 冲突检测结果。 */
  const conflict = detectImportConflict(localData, importedData);
  assert.equal(conflict.isOlder, true);
  assert.equal(conflict.isDifferentDevice, true);
  assert.equal(conflict.requiresConfirm, true);
}

/**
 * 测试导出数据会包含版本号和导出时间。
 *
 * @returns {void}
 */
function testExportDataAddsVersionAndTimestamp() {
  /** 导出的 JSON 文本。 */
  const exportedText = exportData(createDefaultData());
  /** 解析后的导出数据。 */
  const exportedData = JSON.parse(exportedText);

  assert.equal(exportedData.version, 1);
  assert.equal(typeof exportedData.exportedAt, "number");
  assert.equal(exportedData.spaces.length, 1);
}

/**
 * 测试导入非法 JSON 文本时会抛出可读错误。
 *
 * @returns {void}
 */
function testImportDataRejectsInvalidText() {
  assert.throws(() => {
    importData("not-json");
  }, /导入文件不是有效的 JSON/);
}

/**
 * 测试导入数据会经过标准化处理。
 *
 * @returns {void}
 */
function testImportDataNormalizesData() {
  /** 导入后的标准化数据。 */
  const importedData = importData(JSON.stringify({
    version: 1,
    activeSpaceId: "space-a",
    spaces: [
      {
        id: "space-a",
        name: "空间 A",
        groups: [
          {
            id: "group-a",
            name: "分组 A",
            links: [
              {
                title: "Example",
                url: "https://example.com"
              },
              {
                title: "无效链接"
              }
            ]
          }
        ]
      }
    ],
    settings: {
      theme: "dark"
    }
  }));

  assert.equal(importedData.settings.theme, "dark");
  assert.equal(importedData.spaces[0].groups[0].links.length, 1);
}

/**
 * 测试数组元素移动工具函数。
 *
 * @returns {void}
 */
function testMoveArrayItemReordersArray() {
  assert.deepEqual(moveArrayItem(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
}

/**
 * 测试空间拖拽排序逻辑。
 *
 * @returns {void}
 */
function testReorderSpacesMovesTargetSpace() {
  /** 拖拽排序前的工作台数据。 */
  const data = normalizeData({
    version: 1,
    activeSpaceId: "space-a",
    spaces: [
      {
        id: "space-a",
        name: "空间 A",
        groups: []
      },
      {
        id: "space-b",
        name: "空间 B",
        groups: []
      }
    ],
    settings: {}
  });

  /** 拖拽排序后的工作台数据。 */
  const nextData = reorderSpaces(data, "space-a", "space-b");
  assert.equal(nextData.spaces[0].id, "space-b");
  assert.equal(nextData.spaces[1].id, "space-a");
}

/**
 * 测试分组拖拽排序逻辑。
 *
 * @returns {void}
 */
function testReorderGroupsMovesTargetGroup() {
  /** 拖拽排序前的工作台数据。 */
  const data = normalizeData({
    version: 1,
    activeSpaceId: "space-a",
    spaces: [
      {
        id: "space-a",
        name: "空间 A",
        groups: [
          {
            id: "group-a",
            name: "分组 A",
            links: []
          },
          {
            id: "group-b",
            name: "分组 B",
            links: []
          }
        ]
      }
    ],
    settings: {}
  });

  /** 拖拽排序后的工作台数据。 */
  const nextData = reorderGroups(data, "space-a", "group-a", "group-b");
  assert.equal(nextData.spaces[0].groups[0].id, "group-b");
  assert.equal(nextData.spaces[0].groups[1].id, "group-a");
}

/**
 * 测试链接拖拽排序逻辑。
 *
 * @returns {void}
 */
function testReorderLinksMovesTargetLink() {
  /** 拖拽排序前的工作台数据。 */
  const data = normalizeData({
    version: 1,
    activeSpaceId: "space-a",
    spaces: [
      {
        id: "space-a",
        name: "空间 A",
        groups: [
          {
            id: "group-a",
            name: "分组 A",
            links: [
              {
                id: "link-a",
                title: "A",
                url: "https://a.com"
              },
              {
                id: "link-b",
                title: "B",
                url: "https://b.com"
              }
            ]
          }
        ]
      }
    ],
    settings: {}
  });

  /** 拖拽排序后的工作台数据。 */
  const nextData = reorderLinks(data, "space-a", "group-a", "link-a", "link-b");
  assert.equal(nextData.spaces[0].groups[0].links[0].id, "link-b");
  assert.equal(nextData.spaces[0].groups[0].links[1].id, "link-a");
}

/**
 * 测试链接可以跨分组移动到目标链接之前。
 *
 * @returns {void}
 */
function testMoveLinkBetweenGroupsInsertsBeforeTargetLink() {
  /** 移动前的工作台数据。 */
  const data = normalizeData({
    version: 1,
    activeSpaceId: "space-a",
    spaces: [
      {
        id: "space-a",
        name: "空间 A",
        groups: [
          {
            id: "group-a",
            name: "分组 A",
            links: [
              {
                id: "link-a",
                title: "A",
                url: "https://a.com"
              },
              {
                id: "link-b",
                title: "B",
                url: "https://b.com"
              }
            ]
          },
          {
            id: "group-b",
            name: "分组 B",
            links: [
              {
                id: "link-c",
                title: "C",
                url: "https://c.com"
              }
            ]
          }
        ]
      }
    ],
    settings: {}
  });

  /** 跨分组移动后的工作台数据。 */
  const nextData = moveLinkBetweenGroups(data, "space-a", "group-a", "group-b", "link-b", "link-c");
  assert.deepEqual(nextData.spaces[0].groups[0].links.map((link) => link.id), ["link-a"]);
  assert.deepEqual(nextData.spaces[0].groups[1].links.map((link) => link.id), ["link-b", "link-c"]);
}

/**
 * 测试链接可以跨分组移动到目标分组末尾。
 *
 * @returns {void}
 */
function testMoveLinkBetweenGroupsAppendsWhenNoTargetLink() {
  /** 移动前的工作台数据。 */
  const data = normalizeData({
    version: 1,
    activeSpaceId: "space-a",
    spaces: [
      {
        id: "space-a",
        name: "空间 A",
        groups: [
          {
            id: "group-a",
            name: "分组 A",
            links: [
              {
                id: "link-a",
                title: "A",
                url: "https://a.com"
              }
            ]
          },
          {
            id: "group-b",
            name: "分组 B",
            links: []
          }
        ]
      }
    ],
    settings: {}
  });

  /** 跨分组移动后的工作台数据。 */
  const nextData = moveLinkBetweenGroups(data, "space-a", "group-a", "group-b", "link-a", "");
  assert.deepEqual(nextData.spaces[0].groups[0].links.map((link) => link.id), []);
  assert.deepEqual(nextData.spaces[0].groups[1].links.map((link) => link.id), ["link-a"]);
}

/**
 * 测试向分组添加链接时会按 URL 去重。
 *
 * @returns {void}
 */
function testAddLinksToGroupDedupesByUrl() {
  /** 添加链接前的工作台数据。 */
  const data = normalizeData({
    version: 1,
    activeSpaceId: "space-a",
    spaces: [
      {
        id: "space-a",
        name: "空间 A",
        groups: [
          {
            id: "group-a",
            name: "分组 A",
            links: [
              {
                id: "link-a",
                title: "旧链接",
                url: "https://example.com"
              }
            ]
          }
        ]
      }
    ],
    settings: {}
  });

  /** 添加链接后的工作台数据。 */
  const nextData = addLinksToGroup(data, "space-a", "group-a", [
    {
      title: "重复链接",
      url: "https://example.com"
    },
    {
      title: "新增链接",
      url: "https://new.example.com"
    }
  ]);

  assert.equal(nextData.spaces[0].groups[0].links.length, 2);
  assert.equal(nextData.spaces[0].groups[0].links[1].url, "https://new.example.com");
}

/**
 * 测试清空数据会返回默认工作台数据。
 *
 * @returns {void}
 */
function testClearAllDataReturnsDefaultData() {
  /** 清空后的默认数据。 */
  const clearedData = clearAllData();

  assert.equal(clearedData.activeSpaceId, "default-space");
  assert.equal(clearedData.spaces.length, 1);
}

/**
 * 执行全部核心逻辑测试。
 *
 * @returns {void}
 */
async function runTests() {
  testCreateDefaultData();
  testNormalizeDataFallback();
  testNormalizeDataActiveSpaceFallback();
  testIsValidTabUrl();
  testTabsToLinksFiltersAndDedupes();
  testFilterValidTabsRejectsNonArray();
  testFilterGroups();
  testCreateDeviceIdUsesDevicePrefix();
  testEnsureSyncSettingsAddsDefaults();
  testGetDataUpdatedAtReturnsLatestTimestamp();
  await testEncryptedBackupRoundTrip();
  await testRestoreEncryptedBackupRejectsWrongPassword();
  testDetectImportConflictFlagsOlderAndDifferentDevice();
  testExportDataAddsVersionAndTimestamp();
  testImportDataRejectsInvalidText();
  testImportDataNormalizesData();
  testMoveArrayItemReordersArray();
  testReorderSpacesMovesTargetSpace();
  testReorderGroupsMovesTargetGroup();
  testReorderLinksMovesTargetLink();
  testMoveLinkBetweenGroupsInsertsBeforeTargetLink();
  testMoveLinkBetweenGroupsAppendsWhenNoTargetLink();
  testAddLinksToGroupDedupesByUrl();
  testClearAllDataReturnsDefaultData();
  console.log("所有核心逻辑测试通过");
}

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
