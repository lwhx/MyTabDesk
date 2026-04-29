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
  filterCurrentTabs,
  createDeviceId,
  getCurrentTime,
  resolveWebDavSyncUrl,
  ensureSyncSettings,
  getDataUpdatedAt,
  mergeWorkspaceData,
  createEncryptedBackup,
  restoreEncryptedBackup,
  xorEncrypt,
  detectImportConflict,
  exportData,
  importData,
  createBackupSafeData,
  moveArrayItem,
  reorderSpaces,
  reorderGroups,
  reorderLinks,
  moveLinkBetweenGroups,
  updateLink,
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
 * 测试当前标签页搜索会按标题和 URL 过滤。
 *
 * @returns {void}
 */
function testFilterCurrentTabs() {
  /** 匹配后的标签页。 */
  const tabs = filterCurrentTabs([
    {
      title: "Example",
      url: "https://example.com"
    },
    {
      title: "Docs",
      url: "https://docs.example.com"
    }
  ], "docs");

  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].title, "Docs");
  assert.deepEqual(filterCurrentTabs(null, "docs"), []);
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
 * 测试当前时间工具会对外导出给页面同步逻辑使用。
 *
 * @returns {void}
 */
function testGetCurrentTimeExported() {
  /** 调用前的系统时间戳。 */
  const before = Date.now();
  /** 当前时间工具返回的时间戳。 */
  const currentTime = getCurrentTime();
  /** 调用后的系统时间戳。 */
  const after = Date.now();

  assert.equal(typeof getCurrentTime, "function");
  assert.equal(typeof currentTime, "number");
  assert.equal(currentTime >= before, true);
  assert.equal(currentTime <= after, true);
}

/**
 * 测试 WebDAV 目录地址会自动拼接默认同步文件名。
 *
 * @returns {void}
 */
function testResolveWebDavSyncUrlAppendsDefaultFileName() {
  /** 根据目录地址解析后的同步文件地址。 */
  const syncUrl = resolveWebDavSyncUrl("https://alist.whks.de/dav/tabtab");

  assert.equal(syncUrl, "https://alist.whks.de/dav/tabtab/MyTabDesk.json");
}

/**
 * 测试 WebDAV 目录地址会拼接自定义文件名。
 *
 * @returns {void}
 */
function testResolveWebDavSyncUrlAppendsCustomFileName() {
  /** 根据目录地址和自定义文件名解析后的同步文件地址。 */
  const syncUrl = resolveWebDavSyncUrl("https://alist.whks.de/dav/tabtab", "Backup.json");

  assert.equal(syncUrl, "https://alist.whks.de/dav/tabtab/Backup.json");
}

/**
 * 测试 WebDAV 完整 JSON 地址会保持原样。
 *
 * @returns {void}
 */
function testResolveWebDavSyncUrlKeepsJsonFileName() {
  /** 根据完整文件地址解析后的同步文件地址。 */
  const syncUrl = resolveWebDavSyncUrl("https://alist.whks.de/dav/tabtab/Custom.json");

  assert.equal(syncUrl, "https://alist.whks.de/dav/tabtab/Custom.json");
}

/**
 * 测试 WebDAV 完整 JSON 地址即使传入自定义文件名也会保持原样。
 *
 * @returns {void}
 */
function testResolveWebDavSyncUrlKeepsJsonFileNameWithCustomName() {
  /** 根据完整文件地址解析后的同步文件地址。 */
  const syncUrl = resolveWebDavSyncUrl("https://alist.whks.de/dav/tabtab/Custom.json", "Other.json");

  assert.equal(syncUrl, "https://alist.whks.de/dav/tabtab/Custom.json");
}

/**
 * 测试 WebDAV 空地址返回空字符串。
 *
 * @returns {void}
 */
function testResolveWebDavSyncUrlReturnsEmptyForEmptyInput() {
  assert.equal(resolveWebDavSyncUrl(""), "");
  assert.equal(resolveWebDavSyncUrl(null), "");
  assert.equal(resolveWebDavSyncUrl(undefined), "");
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
  assert.equal(nextData.settings.sync.webdavAutoSyncEnabled, false);
  assert.equal(nextData.settings.sync.gistAutoSyncEnabled, false);
  assert.equal(nextData.settings.sync.autoSyncPendingAt, 0);
  assert.equal(nextData.settings.sync.lastAutoSyncAt, 0);
  assert.equal(nextData.settings.sync.lastAutoSyncError, "");
}

/**
 * 测试同步设置会保留自动同步开关。
 *
 * @returns {void}
 */
function testEnsureSyncSettingsKeepsAutoSyncOptions() {
  /** 补齐同步设置后的工作台数据。 */
  const nextData = ensureSyncSettings({
    version: 1,
    activeSpaceId: "space-a",
    spaces: [
      {
        id: "space-a",
        name: "空间 A",
        groups: []
      }
    ],
    settings: {
      sync: {
        webdavAutoSyncEnabled: true,
        gistAutoSyncEnabled: true,
        autoSyncPendingAt: 100,
        lastAutoSyncAt: 90,
        lastAutoSyncError: "网络异常"
      }
    }
  }, "device-fixed");

  assert.equal(nextData.settings.sync.webdavAutoSyncEnabled, true);
  assert.equal(nextData.settings.sync.gistAutoSyncEnabled, true);
  assert.equal(nextData.settings.sync.autoSyncPendingAt, 100);
  assert.equal(nextData.settings.sync.lastAutoSyncAt, 90);
  assert.equal(nextData.settings.sync.lastAutoSyncError, "网络异常");
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
  assert.equal(backupData.encrypted, true);
  assert.equal(backupData.encryption, "PBKDF2-SHA256-AES-GCM");
  assert.equal(backupData.deviceId, "device-fixed");
  assert.equal(typeof backupData.exportedAt, "number");
  assert.equal(typeof backupData.iterations, "number");
  assert.equal(typeof backupData.salt, "string");
  assert.equal(typeof backupData.iv, "string");
  assert.equal(backupText.includes("https://example.com"), false);

  /** 恢复后的工作台数据。 */
  const restoredData = await restoreEncryptedBackup(backupText, "secret");
  assert.equal(restoredData.spaces[0].groups[0].links[0].url, "https://example.com");
}

/**
 * 测试旧版 XOR 加密备份仍然可以导入。
 *
 * @returns {Promise<void>} 测试完成后结束。
 */
async function testRestoreEncryptedBackupReadsLegacyXorBackup() {
  /** 旧版明文数据。 */
  const legacyData = JSON.stringify({
    version: 1,
    activeSpaceId: "space-legacy",
    spaces: [
      {
        id: "space-legacy",
        name: "旧版空间",
        groups: []
      }
    ],
    settings: {}
  });
  /** 旧版 XOR 加密密文。 */
  const payload = await xorEncrypt(legacyData, "secret");
  /** 旧版备份文本。 */
  const backupText = JSON.stringify({
    backupVersion: 1,
    appVersion: "2.0.0",
    exportedAt: 1000,
    deviceId: "device-legacy",
    payload
  });
  /** 从旧版备份恢复的数据。 */
  const restoredData = await restoreEncryptedBackup(backupText, "secret");

  assert.equal(restoredData.activeSpaceId, "space-legacy");
  assert.equal(restoredData.spaces[0].name, "旧版空间");
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
 * 测试普通导出数据会使用 tabtab 兼容结构。
 *
 * @returns {void}
 */
function testExportDataUsesTabTabCompatibleShape() {
  /** 导出的 JSON 文本。 */
  const exportedText = exportData({
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
                url: "https://example.com",
                favIconUrl: "https://example.com/favicon.ico"
              }
            ]
          }
        ]
      }
    ],
    settings: {}
  });
  /** 解析后的 tabtab 兼容备份数据。 */
  const exportedPackage = JSON.parse(exportedText);

  assert.equal(typeof exportedPackage.version, "number");
  assert.deepEqual(exportedPackage.space_list, [
    {
      id: "space-a",
      name: "空间 A"
    }
  ]);
  assert.equal(Array.isArray(exportedPackage.spaces), false);
  assert.equal(exportedPackage.spaces["space-a"].groups[0].tabs[0].kind, "record");
  assert.equal(exportedPackage.spaces["space-a"].groups[0].tabs[0].id, "link-a");
  assert.equal(exportedPackage.spaces["space-a"].groups[0].tabs[0].title, "Example");
  assert.equal(exportedPackage.spaces["space-a"].groups[0].tabs[0].url, "https://example.com");
  assert.equal(exportedPackage.spaces["space-a"].groups[0].tabs[0].favIconUrl, "https://example.com/favicon.ico");
  assert.equal(exportedPackage.spaces["space-a"].groups[0].tabs[0].pinned, false);
  assert.deepEqual(exportedPackage.spaces["space-a"].pins, {});
}

/**
 * 测试备份数据会移除同步敏感凭据。
 *
 * @returns {void}
 */
function testCreateBackupSafeDataRemovesSecrets() {
  /** 去除敏感配置后的备份数据。 */
  const data = createBackupSafeData({
    version: 1,
    activeSpaceId: "space-a",
    spaces: [
      {
        id: "space-a",
        name: "空间 A",
        groups: []
      }
    ],
    settings: {
      sync: {
        webdavPassword: "secret-webdav",
        gistToken: "secret-gist"
      }
    }
  });

  assert.equal(data.settings.sync.webdavPassword, "");
  assert.equal(data.settings.sync.gistToken, "");
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
 * 测试导入新格式普通备份包会读取 data 字段。
 *
 * @returns {void}
 */
function testImportDataReadsPackagedBackup() {
  /** 新格式备份包导入后的标准化数据。 */
  const importedData = importData(JSON.stringify({
    backupVersion: 1,
    appVersion: "2.0.0",
    exportedAt: 1000,
    deviceId: "device-fixed",
    data: {
      version: 1,
      activeSpaceId: "space-a",
      spaces: [
        {
          id: "space-a",
          name: "空间 A",
          groups: []
        }
      ],
      settings: {}
    }
  }));

  assert.equal(importedData.activeSpaceId, "space-a");
  assert.equal(importedData.spaces[0].name, "空间 A");
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
 * 测试导入 tabtab 原生备份会转换为工作台内部结构。
 *
 * @returns {void}
 */
function testImportDataReadsTabTabBackup() {
  /** tabtab 原生备份导入后的标准化数据。 */
  const importedData = importData(JSON.stringify({
    version: 1777427016569,
    space_list: [
      {
        id: "1777427013918",
        name: "网站"
      }
    ],
    spaces: {
      "1777427013918": {
        id: "1777427013918",
        name: "网站",
        groups: [
          {
            id: "group_1777427016546",
            name: "2026-04-29 09:43:36",
            tabs: [
              {
                kind: "record",
                id: "41bd2472-27e4-40dc-a43c-a2e014be267a",
                title: "用户名修改",
                url: "https://passport.baidu.com/static/manage-chunk/change-username.html",
                pinned: false
              },
              {
                kind: "record",
                id: "deb96ef0-4b27-4779-9c8a-dd9dbd9ebe8d",
                title: "淘宝搜索",
                favIconUrl: "https://www.taobao.com/favicon.ico",
                url: "https://s.taobao.com/search?q=test",
                pinned: false
              }
            ]
          }
        ],
        pins: {}
      }
    }
  }));

  assert.equal(importedData.activeSpaceId, "1777427013918");
  assert.equal(importedData.spaces[0].id, "1777427013918");
  assert.equal(importedData.spaces[0].name, "网站");
  assert.equal(importedData.spaces[0].groups[0].id, "group_1777427016546");
  assert.equal(importedData.spaces[0].groups[0].links.length, 2);
  assert.equal(importedData.spaces[0].groups[0].links[0].id, "41bd2472-27e4-40dc-a43c-a2e014be267a");
  assert.equal(importedData.spaces[0].groups[0].links[0].title, "用户名修改");
  assert.equal(importedData.spaces[0].groups[0].links[0].url, "https://passport.baidu.com/static/manage-chunk/change-username.html");
  assert.equal(importedData.spaces[0].groups[0].links[1].favIconUrl, "https://www.taobao.com/favicon.ico");
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
 * 测试编辑链接会更新标题、地址和图标。
 *
 * @returns {void}
 */
function testUpdateLinkChangesTitleUrlAndIcon() {
  /** 编辑前的工作台数据。 */
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
            updatedAt: 100,
            links: [
              {
                id: "link-a",
                title: "旧标题",
                url: "https://old.example.com",
                favIconUrl: "https://old.example.com/icon.png",
                createdAt: 80
              }
            ]
          }
        ]
      }
    ],
    settings: {}
  });

  /** 编辑后的工作台数据。 */
  const nextData = updateLink(data, "space-a", "group-a", "link-a", {
    title: "新标题",
    url: "https://new.example.com",
    favIconUrl: "https://new.example.com/icon.png"
  });
  /** 编辑后的链接数据。 */
  const link = nextData.spaces[0].groups[0].links[0];

  assert.equal(link.id, "link-a");
  assert.equal(link.title, "新标题");
  assert.equal(link.url, "https://new.example.com");
  assert.equal(link.favIconUrl, "https://new.example.com/icon.png");
  assert.equal(link.createdAt, 80);
  assert.equal(link.updatedAt >= 100, true);
  assert.equal(nextData.spaces[0].groups[0].updatedAt >= 100, true);
  assert.equal(nextData.spaces[0].updatedAt >= 100, true);
}

/**
 * 测试编辑链接时会拒绝空地址。
 *
 * @returns {void}
 */
function testUpdateLinkRejectsEmptyUrl() {
  /** 编辑前的工作台数据。 */
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
                title: "旧标题",
                url: "https://old.example.com"
              }
            ]
          }
        ]
      }
    ],
    settings: {}
  });

  assert.throws(() => {
    updateLink(data, "space-a", "group-a", "link-a", {
      title: "新标题",
      url: ""
    });
  }, /请输入链接地址/);
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
 * 测试自动合并会保留本地和远端各自新增的数据。
 *
 * @returns {void}
 */
function testMergeWorkspaceDataKeepsBothSidesNewItems() {
  /** 本地工作台数据。 */
  const localData = normalizeData({
    version: 1,
    activeSpaceId: "space-local",
    spaces: [
      {
        id: "space-local",
        name: "本地空间",
        updatedAt: 200,
        groups: [
          {
            id: "group-local",
            name: "本地分组",
            updatedAt: 200,
            links: [
              {
                id: "link-local",
                title: "本地链接",
                url: "https://local.example.com",
                createdAt: 200
              }
            ]
          }
        ]
      }
    ],
    settings: {
      sync: {
        deviceId: "device-local",
        provider: "webdav",
        webdavAutoSyncEnabled: true
      }
    }
  });
  /** 远端工作台数据。 */
  const remoteData = normalizeData({
    version: 1,
    activeSpaceId: "space-remote",
    spaces: [
      {
        id: "space-remote",
        name: "远端空间",
        updatedAt: 300,
        groups: [
          {
            id: "group-remote",
            name: "远端分组",
            updatedAt: 300,
            links: [
              {
                id: "link-remote",
                title: "远端链接",
                url: "https://remote.example.com",
                createdAt: 300
              }
            ]
          }
        ]
      }
    ],
    settings: {
      sync: {
        deviceId: "device-remote"
      }
    }
  });
  /** 自动合并后的工作台数据。 */
  const mergedData = mergeWorkspaceData(localData, remoteData, "device-local");

  assert.deepEqual(mergedData.spaces.map((space) => space.id), ["space-local", "space-remote"]);
  assert.equal(mergedData.settings.sync.deviceId, "device-local");
  assert.equal(mergedData.settings.sync.provider, "webdav");
}

/**
 * 测试自动合并同一分组时会按 URL 去重并保留两端链接。
 *
 * @returns {void}
 */
function testMergeWorkspaceDataMergesLinksWithoutPrompt() {
  /** 本地工作台数据。 */
  const localData = normalizeData({
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
            updatedAt: 100,
            links: [
              {
                id: "link-a",
                title: "本地标题",
                url: "https://same.example.com",
                createdAt: 100
              },
              {
                id: "link-local",
                title: "本地新增",
                url: "https://local.example.com",
                createdAt: 110
              }
            ]
          }
        ]
      }
    ],
    settings: {}
  });
  /** 远端工作台数据。 */
  const remoteData = normalizeData({
    version: 1,
    activeSpaceId: "space-a",
    spaces: [
      {
        id: "space-a",
        name: "空间 A 远端",
        updatedAt: 300,
        groups: [
          {
            id: "group-a",
            name: "分组 A 远端",
            updatedAt: 300,
            links: [
              {
                id: "link-remote-duplicate",
                title: "远端标题",
                url: "https://same.example.com",
                createdAt: 300
              },
              {
                id: "link-remote",
                title: "远端新增",
                url: "https://remote.example.com",
                createdAt: 310
              }
            ]
          }
        ]
      }
    ],
    settings: {}
  });
  /** 自动合并后的链接列表。 */
  const links = mergeWorkspaceData(localData, remoteData, "device-local").spaces[0].groups[0].links;

  assert.equal(links.length, 3);
  assert.deepEqual(links.map((link) => link.url), ["https://local.example.com", "https://same.example.com", "https://remote.example.com"]);
  assert.equal(links.find((link) => link.url === "https://same.example.com").title, "远端标题");
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
  testFilterCurrentTabs();
  testCreateDeviceIdUsesDevicePrefix();
  testGetCurrentTimeExported();
  testResolveWebDavSyncUrlAppendsDefaultFileName();
  testResolveWebDavSyncUrlAppendsCustomFileName();
  testResolveWebDavSyncUrlKeepsJsonFileName();
  testResolveWebDavSyncUrlKeepsJsonFileNameWithCustomName();
  testResolveWebDavSyncUrlReturnsEmptyForEmptyInput();
  testEnsureSyncSettingsAddsDefaults();
  testEnsureSyncSettingsKeepsAutoSyncOptions();
  testGetDataUpdatedAtReturnsLatestTimestamp();
  await testEncryptedBackupRoundTrip();
  await testRestoreEncryptedBackupReadsLegacyXorBackup();
  await testRestoreEncryptedBackupRejectsWrongPassword();
  testDetectImportConflictFlagsOlderAndDifferentDevice();
  testExportDataUsesTabTabCompatibleShape();
  testCreateBackupSafeDataRemovesSecrets();
  testImportDataRejectsInvalidText();
  testImportDataReadsPackagedBackup();
  testImportDataNormalizesData();
  testImportDataReadsTabTabBackup();
  testMoveArrayItemReordersArray();
  testReorderSpacesMovesTargetSpace();
  testReorderGroupsMovesTargetGroup();
  testReorderLinksMovesTargetLink();
  testMoveLinkBetweenGroupsInsertsBeforeTargetLink();
  testMoveLinkBetweenGroupsAppendsWhenNoTargetLink();
  testUpdateLinkChangesTitleUrlAndIcon();
  testUpdateLinkRejectsEmptyUrl();
  testAddLinksToGroupDedupesByUrl();
  testMergeWorkspaceDataKeepsBothSidesNewItems();
  testMergeWorkspaceDataMergesLinksWithoutPrompt();
  testClearAllDataReturnsDefaultData();
  console.log("所有核心逻辑测试通过");
}

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
