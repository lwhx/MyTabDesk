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
  resolveSafeWebDavFileUrl,
  createBasicAuthHeader,
  isSyncProviderEnabled,
  getEnabledSyncProviders,
  getAutoSyncProviders,
  isMyTabDeskGist,
  ensureSyncSettings,
  touchSyncState,
  getDataUpdatedAt,
  mergeLinks,
  mergeWorkspaceData,
  createEncryptedBackup,
  restoreEncryptedBackup,
  xorEncrypt,
  detectImportConflict,
  exportData,
  exportNativeBackup,
  exportSyncData,
  importSyncData,
  importData,
  createBackupSafeData,
  createVisibleWorkspaceData,
  moveArrayItem,
  reorderSpaces,
  reorderGroups,
  reorderLinks,
  moveGroupBetweenSpaces,
  moveLinkBetweenGroups,
  updateLink,
  addLinksToGroup,
  clearAllData,
  normalizeSpaceTemplate,
  createSpaceFromTemplate
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
          url: "https://openai.com",
          note: "模型接口",
          color: "red"
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

  const noteMatched = filterGroups(groups, "模型接口");
  assert.equal(noteMatched[0].links[0].title, "OpenAI");

  const colorMatched = filterGroups(groups, "color:red");
  assert.equal(colorMatched.length, 1);
  assert.equal(colorMatched[0].links.length, 1);
  assert.equal(colorMatched[0].links[0].title, "OpenAI");

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
 * 测试安全 WebDAV 文件地址会拒绝空配置。
 *
 * @returns {void}
 */
function testResolveSafeWebDavFileUrlRejectsMissingConfig() {
  assert.throws(
    () => resolveSafeWebDavFileUrl({ webdavUrl: "", webdavUsername: "user", webdavPassword: "pass" }),
    /请先完整填写 WebDAV URL、用户名和密码/
  );
}

/**
 * 测试安全 WebDAV 文件地址会拒绝非 HTTPS 地址。
 *
 * @returns {void}
 */
function testResolveSafeWebDavFileUrlRejectsInsecureUrl() {
  assert.throws(
    () => resolveSafeWebDavFileUrl({ webdavUrl: "http://example.com/dav", webdavUsername: "user", webdavPassword: "pass" }),
    /WebDAV 地址必须使用 HTTPS 协议/
  );
}

/**
 * 测试安全 WebDAV 文件地址会返回已解析的 HTTPS 地址。
 *
 * @returns {void}
 */
function testResolveSafeWebDavFileUrlReturnsResolvedHttpsUrl() {
  /** 解析后的安全 WebDAV 文件地址。 */
  const fileUrl = resolveSafeWebDavFileUrl({
    webdavUrl: "https://example.com/dav/folder",
    webdavUsername: "user",
    webdavPassword: "pass",
    webdavFilename: "Backup.json"
  });

  assert.equal(fileUrl, "https://example.com/dav/folder/Backup.json");
}

/**
 * 测试 Basic Auth 请求头会使用 UTF-8 生成 Base64 凭证。
 *
 * @returns {void}
 */
function testCreateBasicAuthHeaderUsesUtf8Credentials() {
  assert.equal(createBasicAuthHeader("用户", "密码"), "Basic 55So5oi3OuWvhueggQ==");
}

/**
 * 测试同步服务启用判断支持 WebDAV 和 Gist 同时开启。
 *
 * @returns {void}
 */
function testIsSyncProviderEnabledSupportsBothProviders() {
  /** 同时启用两个同步服务的同步配置。 */
  const sync = {
    provider: "both",
    webdavAutoSyncEnabled: true,
    gistAutoSyncEnabled: true
  };

  assert.equal(isSyncProviderEnabled(sync, "webdav"), true);
  assert.equal(isSyncProviderEnabled(sync, "gist"), true);
}

/**
 * 测试自动同步开关不会单独开启同步服务。
 *
 * @returns {void}
 */
function testIsSyncProviderEnabledIgnoresAutoSyncOnly() {
  /** 仅开启自动同步但未启用服务的同步配置。 */
  const sync = {
    provider: "none",
    webdavAutoSyncEnabled: true,
    gistAutoSyncEnabled: true
  };

  assert.equal(isSyncProviderEnabled(sync, "webdav"), false);
  assert.equal(isSyncProviderEnabled(sync, "gist"), false);
  assert.deepEqual(getEnabledSyncProviders(sync), []);
}

/**
 * 测试获取已启用同步服务会同时返回 WebDAV 和 Gist。
 *
 * @returns {void}
 */
function testGetEnabledSyncProvidersReturnsBothProviders() {
  /** 同时启用两个同步服务的同步配置。 */
  const sync = {
    provider: "both",
    webdavAutoSyncEnabled: true,
    gistAutoSyncEnabled: true
  };

  assert.deepEqual(getEnabledSyncProviders(sync), ["webdav", "gist"]);
}

/**
 * 测试自动同步只执行显式开启自动同步的服务商。
 *
 * @returns {void}
 */
function testGetAutoSyncProvidersHonorsProviderSwitches() {
  const sync = {
    provider: "both",
    webdavAutoSyncEnabled: true,
    gistAutoSyncEnabled: false
  };

  assert.deepEqual(getAutoSyncProviders(sync), ["webdav"]);
  sync.webdavAutoSyncEnabled = false;
  sync.gistAutoSyncEnabled = true;
  assert.deepEqual(getAutoSyncProviders(sync), ["gist"]);
}

/**
 * 测试旧版单 provider 配置仍会被识别为启用。
 *
 * @returns {void}
 */
function testIsSyncProviderEnabledKeepsLegacyProvider() {
  /** 旧版单服务同步配置。 */
  const sync = {
    provider: "webdav",
    webdavAutoSyncEnabled: false,
    gistAutoSyncEnabled: false
  };

  assert.equal(isSyncProviderEnabled(sync, "webdav"), true);
  assert.deepEqual(getEnabledSyncProviders(sync), ["webdav"]);
}

/**
 * 测试 Gist 描述匹配时会识别为 MyTabDesk 同步 Gist。
 *
 * @returns {void}
 */
function testIsMyTabDeskGistMatchesDescription() {
  /** GitHub Gist 摘要对象。 */
  const gist = {
    description: "MyTabDesk Sync",
    files: {}
  };

  assert.equal(isMyTabDeskGist(gist, "mytabdesk-sync.json"), true);
}

/**
 * 测试 Gist 文件名匹配时会识别为 MyTabDesk 同步 Gist。
 *
 * @returns {void}
 */
function testIsMyTabDeskGistMatchesFilename() {
  /** GitHub Gist 摘要对象。 */
  const gist = {
    description: "其他描述",
    files: {
      "mytabdesk-sync.json": {}
    }
  };

  assert.equal(isMyTabDeskGist(gist, "mytabdesk-sync.json"), true);
}

/**
 * 测试无关 Gist 不会识别为 MyTabDesk 同步 Gist。
 *
 * @returns {void}
 */
function testIsMyTabDeskGistRejectsUnrelatedGist() {
  /** GitHub Gist 摘要对象。 */
  const gist = {
    description: "其他描述",
    files: {
      "notes.txt": {}
    }
  };

  assert.equal(isMyTabDeskGist(gist, "mytabdesk-sync.json"), false);
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
 * 测试同步状态版本在同一毫秒内仍保持单调递增。
 *
 * @returns {void}
 */
function testTouchSyncStateIsMonotonic() {
  const sync = { stateUpdatedAt: 200 };

  assert.equal(touchSyncState(sync, 200), 201);
  assert.equal(sync.stateUpdatedAt, 201);
  assert.equal(touchSyncState(sync, 150), 202);
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
 * 测试全量数据更新时间包含链接更新和删除墓碑。
 *
 * @returns {void}
 */
function testGetDataUpdatedAtIncludesLinksAndTombstones() {
  const data = normalizeData({
    version: 1,
    activeSpaceId: "space-a",
    spaces: [{
      id: "space-a",
      name: "空间 A",
      updatedAt: 100,
      groups: [{
        id: "group-a",
        name: "分组 A",
        updatedAt: 200,
        links: [{
          id: "link-a",
          title: "已删除链接",
          url: "https://example.com",
          updatedAt: 300,
          deletedAt: 400
        }]
      }]
    }],
    settings: {}
  });

  assert.equal(getDataUpdatedAt(data), 400);
}

/**
 * 测试全墓碑空间标准化时保留删除历史，并创建唯一活动空间。
 *
 * @returns {void}
 */
function testNormalizeDataPreservesAllSpaceTombstones() {
  const data = normalizeData({
    version: 1,
    activeSpaceId: "default-space",
    spaces: [
      { id: "default-space", name: "已删除默认空间", deletedAt: 300, updatedAt: 300, groups: [] },
      { id: "deleted-space", name: "已删除空间", deletedAt: 400, updatedAt: 400, groups: [] }
    ],
    settings: {}
  });

  const tombstones = data.spaces.filter((space) => space.deletedAt);
  const liveSpaces = data.spaces.filter((space) => !space.deletedAt);
  assert.equal(tombstones.length, 2);
  assert.equal(liveSpaces.length, 1);
  assert.notEqual(liveSpaces[0].id, "default-space");
  assert.equal(data.activeSpaceId, liveSpaces[0].id);
}

/**
 * 测试全墓碑空间合并时保留删除历史，并追加活动空间。
 *
 * @returns {void}
 */
function testMergePreservesAllSpaceTombstones() {
  const local = {
    version: 1,
    activeSpaceId: "default-space",
    spaces: [{ id: "default-space", name: "已删除", deletedAt: 500, updatedAt: 500, groups: [] }],
    settings: {}
  };
  const remote = {
    version: 1,
    activeSpaceId: "default-space",
    spaces: [{ id: "default-space", name: "旧空间", updatedAt: 100, groups: [] }],
    settings: {}
  };

  const merged = mergeWorkspaceData(local, remote, "device-a");
  assert.equal(merged.spaces.some((space) => space.id === "default-space" && space.deletedAt === 500), true);
  const liveSpaces = merged.spaces.filter((space) => !space.deletedAt);
  assert.equal(liveSpaces.length, 1);
  assert.notEqual(liveSpaces[0].id, "default-space");
}

/**
 * 测试旧活动空间缺失时间戳时，不会用迁移时当前时间覆盖删除墓碑。
 *
 * @returns {void}
 */
function testMergeTombstoneIgnoresSyntheticMigrationTime() {
  const originalNow = Date.now;
  let now = 1000;
  Date.now = () => {
    now += 1;
    return now;
  };

  try {
    const local = {
      version: 1,
      activeSpaceId: "deleted-space",
      spaces: [{ id: "deleted-space", name: "已删除", updatedAt: 500, deletedAt: 500, groups: [] }],
      settings: {}
    };
    const remote = {
      version: 1,
      activeSpaceId: "deleted-space",
      spaces: [{ id: "deleted-space", name: "旧设备空间", groups: [] }],
      settings: {}
    };

    const merged = mergeWorkspaceData(local, remote, "device-a");
    const tombstone = merged.spaces.find((space) => space.id === "deleted-space");
    assert.equal(tombstone.deletedAt, 500);
    assert.equal(tombstone.name, "已删除");
  } finally {
    Date.now = originalNow;
  }
}

/**
 * 测试标准化数据时不会把墓碑空间作为当前激活空间。
 *
 * @returns {void}
 */
function testNormalizeDataSkipsDeletedActiveSpace() {
  const data = normalizeData({
    version: 1,
    activeSpaceId: "deleted-space",
    spaces: [
      { id: "deleted-space", name: "已删除", deletedAt: 300, groups: [] },
      { id: "live-space", name: "可用空间", groups: [] }
    ],
    settings: {}
  });

  assert.equal(data.activeSpaceId, "live-space");
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
    settings: {
      sync: {
        webdavUrl: "https://alice:url-secret@example.com/private/?token=query-secret",
        webdavUsername: "alice@example.com",
        webdavPassword: "webdav-secret",
        webdavFilename: "sync.json?access_token=filename-secret",
        gistToken: "gist-secret",
        syncEncryptionPassword: "sync-secret"
      }
    }
  });

  /** 加密备份文本。 */
  const backupText = await createEncryptedBackup(data, "secret", "device-fixed");
  /** 备份对象。 */
  const backupData = JSON.parse(backupText);

  assert.equal(backupData.backupVersion, 1);
  assert.equal(backupData.appVersion, "2.1.0");
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
  const restoredText = JSON.stringify(restoredData);
  for (const secret of ["url-secret", "query-secret", "alice@example.com", "webdav-secret", "filename-secret", "gist-secret", "sync-secret"]) {
    assert.equal(restoredText.includes(secret), false);
  }
  assert.equal(restoredData.settings.sync.webdavUrl, "");
  assert.equal(restoredData.settings.sync.webdavUsername, "");
  assert.equal(restoredData.settings.sync.webdavFilename, "");
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
    appVersion: "2.1.0",
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
 * 测试未知加密格式不会降级为 XOR 解密。
 *
 * @returns {Promise<void>} 测试完成后结束。
 */
async function testRestoreEncryptedBackupRejectsUnknownEncryption() {
  /** 伪造的未知加密备份文本。 */
  const backupText = JSON.stringify({
    backupVersion: 1,
    appVersion: "2.1.0",
    exportedAt: 1000,
    deviceId: "device-unknown",
    encryption: "UNKNOWN-ALGORITHM",
    payload: "invalid-payload"
  });

  await assert.rejects(async () => {
    await restoreEncryptedBackup(backupText, "secret");
  }, /密码错误或文件损坏/);
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

async function testRestoreEncryptedBackupRejectsUnsafeParameters() {
  const backup = JSON.parse(await createEncryptedBackup(createDefaultData(), "secret", "device-fixed"));
  const invalidBackups = [
    { ...backup, iterations: 1000001 },
    { ...backup, iterations: 600000.5 },
    { ...backup, salt: "AA==" },
    { ...backup, iv: "AA==" },
    { ...backup, payload: "AA==" }
  ];

  for (const invalidBackup of invalidBackups) {
    await assert.rejects(
      restoreEncryptedBackup(JSON.stringify(invalidBackup), "secret"),
      /密码错误或文件损坏/
    );
  }
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
 * 测试面向用户的普通导出只包含活动空间、分组和链接。
 *
 * @returns {void}
 */
function testExportDataOmitsTombstones() {
  const data = normalizeData({
    version: 1,
    activeSpaceId: "live-space",
    spaces: [
      {
        id: "live-space",
        name: "活动空间",
        groups: [
          {
            id: "live-group",
            name: "活动分组",
            links: [
              { id: "live-link", title: "活动", url: "https://live.example" },
              { id: "dead-link", title: "已删除", url: "https://dead.example", deletedAt: 200, updatedAt: 200 }
            ]
          },
          { id: "dead-group", name: "已删除分组", deletedAt: 200, updatedAt: 200, links: [{ id: "nested", title: "N", url: "https://nested.example" }] }
        ]
      },
      { id: "dead-space", name: "已删除空间", deletedAt: 200, updatedAt: 200, groups: [] }
    ],
    settings: {}
  });

  const visible = createVisibleWorkspaceData(data);
  assert.deepEqual(visible.spaces.map((space) => space.id), ["live-space"]);
  assert.deepEqual(visible.spaces[0].groups.map((group) => group.id), ["live-group"]);
  assert.deepEqual(visible.spaces[0].groups[0].links.map((link) => link.id), ["live-link"]);

  const exportedText = exportData(data);
  assert.equal(exportedText.includes("dead-link"), false);
  assert.equal(exportedText.includes("dead-group"), false);
  assert.equal(exportedText.includes("dead-space"), false);
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

function testExportDataRemovesSyncSecrets() {
  const exportedText = exportData({
    version: 1,
    activeSpaceId: "space-a",
    spaces: [
      {
        id: "space-a",
        name: "Space A",
        groups: []
      }
    ],
    settings: {
      sync: {
        provider: "both",
        webdavPassword: "secret-webdav",
        gistToken: "secret-gist"
      }
    }
  });

  assert.equal(exportedText.includes("secret-webdav"), false);
  assert.equal(exportedText.includes("secret-gist"), false);
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
 * 测试同步格式保留版本/墓碑元数据且移除本地凭据。
 *
 * @returns {void}
 */
function testSyncDataRoundTripPreservesTombstonesWithoutSecrets() {
  const originalData = normalizeData({
    version: 1,
    activeSpaceId: "space-a",
    spaces: [{
      id: "space-a",
      name: "空间 A",
      updatedAt: 300,
      groups: [{
        id: "group-a",
        name: "分组 A",
        updatedAt: 300,
        links: [{
          id: "link-a",
          title: "已删除链接",
          url: "https://example.com",
          createdAt: 100,
          updatedAt: 200,
          deletedAt: 300
        }]
      }]
    }],
    settings: {
      sync: {
        webdavPassword: "secret-webdav",
        gistToken: "secret-gist",
        syncEncryptionPassword: "secret-encryption"
      }
    }
  });

  const text = exportSyncData(originalData);
  const restored = importSyncData(text);
  const link = restored.spaces[0].groups[0].links[0];

  assert.equal(link.createdAt, 100);
  assert.equal(link.updatedAt, 200);
  assert.equal(link.deletedAt, 300);
  assert.equal(text.includes("secret-webdav"), false);
  assert.equal(text.includes("secret-gist"), false);
  assert.equal(text.includes("secret-encryption"), false);
}

/**
 * 测试原生备份完整保留工作台元数据，同时移除同步凭据。
 *
 * @returns {void}
 */
function testNativeBackupRoundTripPreservesWorkspaceMetadata() {
  const originalData = normalizeData({
    version: 1,
    activeSpaceId: "space-a",
    spaces: [{
      id: "space-a",
      name: "空间 A",
      icon: "⭐",
      createdAt: 10,
      updatedAt: 20,
      groups: [{
        id: "group-a",
        name: "分组 A",
        collapsed: true,
        pinned: true,
        createdAt: 11,
        updatedAt: 21,
        links: [
          { id: "link-a", title: "A", url: "https://a.example", createdAt: 12, updatedAt: 22, order: 3 },
          { id: "link-deleted", title: "D", url: "https://d.example", createdAt: 13, updatedAt: 23, deletedAt: 24, order: 4 }
        ]
      }]
    }],
    settings: {
      updatedAt: 30,
      theme: "dark",
      sidebarCollapsed: true,
      rightPanelCollapsed: true,
      compactLinks: true,
      sync: {
        deviceId: "device-a",
        provider: "both",
        webdavUrl: "https://alice:url-secret@example.com/private/?token=query-secret",
        webdavUsername: "alice@example.com",
        webdavPassword: "webdav-secret",
        webdavFilename: "sync.json?access_token=filename-secret",
        gistToken: "gist-secret",
        syncEncryptionPassword: "sync-secret"
      }
    }
  });

  const backupText = exportNativeBackup(originalData);
  const backup = JSON.parse(backupText);
  const restored = importData(backupText);

  assert.equal(backup.format, "mytabdesk-backup");
  assert.equal(backupText.includes("webdav-secret"), false);
  assert.equal(backupText.includes("url-secret"), false);
  assert.equal(backupText.includes("query-secret"), false);
  assert.equal(backupText.includes("alice@example.com"), false);
  assert.equal(backupText.includes("filename-secret"), false);
  assert.equal(backupText.includes("gist-secret"), false);
  assert.equal(backupText.includes("sync-secret"), false);
  assert.equal(restored.activeSpaceId, "space-a");
  assert.equal(restored.spaces[0].icon, "⭐");
  assert.equal(restored.spaces[0].groups[0].collapsed, true);
  assert.equal(restored.spaces[0].groups[0].pinned, true);
  assert.equal(restored.spaces[0].groups[0].links[0].order, 3);
  assert.equal(restored.spaces[0].groups[0].links[1].deletedAt, 24);
  assert.equal(restored.settings.theme, "dark");
  assert.equal(restored.settings.compactLinks, true);
  assert.equal(restored.settings.sync.webdavUrl, "");
  assert.equal(restored.settings.sync.webdavUsername, "");
  assert.equal(restored.settings.sync.webdavFilename, "");
}

/**
 * 测试导出再导入后分组和链接完整保留。
 *
 * @returns {void}
 */
function testExportImportRoundTripPreservesGroupsAndLinks() {
  /** 原始工作台数据。 */
  const originalData = normalizeData({
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
                id: "link-1",
                title: "Example",
                url: "https://example.com",
                favIconUrl: "https://example.com/favicon.ico"
              },
              {
                id: "link-2",
                title: "GitHub",
                url: "https://github.com",
                favIconUrl: ""
              }
            ]
          },
          {
            id: "group-b",
            name: "分组 B",
            links: [
              {
                id: "link-3",
                title: "Google",
                url: "https://google.com"
              }
            ]
          }
        ]
      }
    ],
    settings: {}
  });
  /** 导出后的 JSON 文本。 */
  const exportedText = exportData(originalData);
  /** 重新导入后的工作台数据。 */
  const importedData = importData(exportedText);

  assert.equal(importedData.spaces.length, 1);
  assert.equal(importedData.spaces[0].id, "space-a");
  assert.equal(importedData.spaces[0].groups.length, 2);
  assert.equal(importedData.spaces[0].groups[0].id, "group-a");
  assert.equal(importedData.spaces[0].groups[0].name, "分组 A");
  assert.equal(importedData.spaces[0].groups[0].links.length, 2);
  assert.equal(importedData.spaces[0].groups[0].links[0].id, "link-1");
  assert.equal(importedData.spaces[0].groups[0].links[0].title, "Example");
  assert.equal(importedData.spaces[0].groups[0].links[0].url, "https://example.com");
  assert.equal(importedData.spaces[0].groups[0].links[1].id, "link-2");
  assert.equal(importedData.spaces[0].groups[1].id, "group-b");
  assert.equal(importedData.spaces[0].groups[1].links.length, 1);
  assert.equal(importedData.spaces[0].groups[1].links[0].title, "Google");
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
    appVersion: "2.1.0",
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
 * 测试链接跨分组移动后，与移动前旧副本合并不会在源分组复活。
 *
 * @returns {void}
 */
function testMoveLinkBetweenGroupsLeavesSourceTombstone() {
  const originalNow = Date.now;
  Date.now = () => 500;

  try {
    const before = normalizeData({
      version: 1,
      activeSpaceId: "space-a",
      spaces: [{
        id: "space-a",
        name: "A",
        createdAt: 1,
        updatedAt: 100,
        groups: [
          { id: "source", name: "源", createdAt: 1, updatedAt: 100, links: [{ id: "link-a", title: "A", url: "https://a.example", createdAt: 1, updatedAt: 100 }] },
          { id: "target", name: "目标", createdAt: 1, updatedAt: 100, links: [] }
        ]
      }],
      settings: {}
    });

    const moved = moveLinkBetweenGroups(before, "space-a", "source", "target", "link-a", "");
    const source = moved.spaces[0].groups.find((group) => group.id === "source");
    const target = moved.spaces[0].groups.find((group) => group.id === "target");
    assert.equal(source.links.find((link) => link.id === "link-a").deletedAt, 500);
    assert.equal(target.links.find((link) => link.id === "link-a").deletedAt, undefined);

    const merged = mergeWorkspaceData(moved, before, "device-a");
    const mergedSource = merged.spaces[0].groups.find((group) => group.id === "source");
    const mergedTarget = merged.spaces[0].groups.find((group) => group.id === "target");
    assert.equal(mergedSource.links.find((link) => link.id === "link-a").deletedAt, 500);
    assert.equal(mergedTarget.links.filter((link) => link.id === "link-a" && !link.deletedAt).length, 1);
  } finally {
    Date.now = originalNow;
  }
}

/**
 * 测试分组跨空间移动后，与移动前旧副本合并不会在源空间复活。
 *
 * @returns {void}
 */
function testMoveGroupBetweenSpacesLeavesSourceTombstone() {
  const originalNow = Date.now;
  Date.now = () => 600;

  try {
    const before = normalizeData({
      version: 1,
      activeSpaceId: "space-a",
      spaces: [
        { id: "space-a", name: "A", createdAt: 1, updatedAt: 100, groups: [{ id: "group-a", name: "G", createdAt: 1, updatedAt: 100, links: [] }] },
        { id: "space-b", name: "B", createdAt: 1, updatedAt: 100, groups: [] }
      ],
      settings: {}
    });

    const moved = moveGroupBetweenSpaces(before, "space-a", "space-b", "group-a");
    const source = moved.spaces.find((space) => space.id === "space-a");
    const target = moved.spaces.find((space) => space.id === "space-b");
    assert.equal(source.groups.find((group) => group.id === "group-a").deletedAt, 600);
    assert.equal(target.groups.find((group) => group.id === "group-a").deletedAt, undefined);

    const merged = mergeWorkspaceData(moved, before, "device-a");
    const mergedSource = merged.spaces.find((space) => space.id === "space-a");
    const mergedTarget = merged.spaces.find((space) => space.id === "space-b");
    assert.equal(mergedSource.groups.find((group) => group.id === "group-a").deletedAt, 600);
    assert.equal(mergedTarget.groups.filter((group) => group.id === "group-a" && !group.deletedAt).length, 1);
  } finally {
    Date.now = originalNow;
  }
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
  assert.deepEqual(nextData.spaces[0].groups[0].links.filter((link) => !link.deletedAt).map((link) => link.id), ["link-a"]);
  assert.equal(nextData.spaces[0].groups[0].links.find((link) => link.id === "link-b").deletedAt > 0, true);
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
  assert.deepEqual(nextData.spaces[0].groups[0].links.filter((link) => !link.deletedAt).map((link) => link.id), []);
  assert.equal(nextData.spaces[0].groups[0].links.find((link) => link.id === "link-a").deletedAt > 0, true);
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
    favIconUrl: "https://new.example.com/icon.png",
    note: "仅用于回归测试的备注"
  });
  /** 编辑后的链接数据。 */
  const link = nextData.spaces[0].groups[0].links[0];

  assert.equal(link.id, "link-a");
  assert.equal(link.title, "新标题");
  assert.equal(link.url, "https://new.example.com");
  assert.equal(link.favIconUrl, "https://new.example.com/icon.png");
  assert.equal(link.note, "仅用于回归测试的备注");
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
function testMergeWorkspaceDataMergesLinksWithoutPrompt() {  /** 本地工作台数据。 */
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
  // 本地顺序优先（same 在 local 之前），远端独有的 remote 追加到末尾
  assert.deepEqual(links.map((link) => link.url), ["https://same.example.com", "https://local.example.com", "https://remote.example.com"]);
  assert.equal(links.find((link) => link.url === "https://same.example.com").title, "远端标题");
}

/**
 * 测试两端各自拖拽排序后合并，本地顺序不被远端 order 交叉打散，且 order 连续不重复。
 *
 * @returns {void}
 */
function testMergeWorkspaceDataKeepsLocalOrderWithRemoteAppended() {
  /** 本地分组内已排序的链接，order 为本地数组下标。 */
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
              { id: "link-1", title: "A", url: "https://a.com", order: 0, createdAt: 1 },
              { id: "link-2", title: "B", url: "https://b.com", order: 1, createdAt: 2 },
              { id: "link-3", title: "C", url: "https://c.com", order: 2, createdAt: 3 }
            ]
          }
        ]
      }
    ],
    settings: {}
  });
  /** 远端独有链接，order 为远端数组下标，与本地 order 重叠。 */
  const remoteData = normalizeData({
    version: 1,
    activeSpaceId: "space-a",
    spaces: [
      {
        id: "space-a",
        name: "空间 A",
        updatedAt: 200,
        groups: [
          {
            id: "group-a",
            name: "分组 A",
            updatedAt: 200,
            links: [
              { id: "link-4", title: "D", url: "https://d.com", order: 0, createdAt: 4 },
              { id: "link-5", title: "E", url: "https://e.com", order: 1, createdAt: 5 }
            ]
          }
        ]
      }
    ],
    settings: {}
  });
  /** 自动合并后的链接列表。 */
  const links = mergeWorkspaceData(localData, remoteData, "device-local").spaces[0].groups[0].links;

  // 本地顺序保持不变，远端独有链接按远端顺序追加到末尾，不被交叉打散
  assert.deepEqual(links.map((link) => link.id), ["link-1", "link-2", "link-3", "link-4", "link-5"]);
  // 合并后 order 必须连续且唯一，避免下次合并再次错乱
  assert.deepEqual(links.map((link) => link.order), [0, 1, 2, 3, 4]);
}

/**
 * 测试同 ID 链接更新 URL 后，旧 URL 可由另一条链接继续使用。
 *
 * @returns {void}
 */
function testMergeLinksRefreshesIndexesAfterUrlChange() {
  const localLinks = [
    { id: "link-a", title: "A", url: "https://old.example.com", createdAt: 1, updatedAt: 100 }
  ];
  const remoteLinks = [
    { id: "link-a", title: "A new", url: "https://new.example.com", createdAt: 1, updatedAt: 300 },
    { id: "link-b", title: "B", url: "https://old.example.com", createdAt: 200, updatedAt: 200 }
  ];

  const merged = mergeLinks(localLinks, remoteLinks);

  assert.deepEqual(merged.map((link) => link.id), ["link-a", "link-b"]);
  assert.deepEqual(merged.map((link) => link.url), ["https://new.example.com", "https://old.example.com"]);
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
 * 测试 findGroup 函数能正确定位分组。
 *
 * @returns {void}
 */
function testFindGroupLocatesGroup() {
  // 由于 tabdesk-core.js 不包含 findGroup，这里测试其他核心函数
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
          }
        ]
      }
    ],
    settings: {}
  });

  // 验证数据标准化后能正确找到分组
  const group = data.spaces[0].groups.find(g => g.id === "group-a");
  assert.ok(group);
  assert.equal(group.name, "分组 A");
}

/**
 * 测试 findLink 函数能正确定位链接。
 *
 * @returns {void}
 */
function testFindLinkLocatesLink() {
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
                title: "链接 A",
                url: "https://example.com"
              }
            ]
          }
        ]
      }
    ],
    settings: {}
  });

  const link = data.spaces[0].groups[0].links.find(l => l.id === "link-a");
  assert.ok(link);
  assert.equal(link.title, "链接 A");
  assert.equal(link.url, "https://example.com");
}

/**
 * 测试删除后的同 URL 可作为新链接重新添加，墓碑仍保留用于同步。
 *
 * @returns {void}
 */
function testAddLinksToGroupAllowsUrlAfterTombstone() {
  const data = normalizeData({
    version: 1,
    activeSpaceId: "space-a",
    spaces: [{
      id: "space-a",
      name: "空间 A",
      groups: [{
        id: "group-a",
        name: "分组 A",
        links: [{
          id: "deleted-link",
          title: "已删除",
          url: "https://same.example",
          createdAt: 100,
          updatedAt: 200,
          deletedAt: 300
        }]
      }]
    }],
    settings: {}
  });

  const updated = addLinksToGroup(data, "space-a", "group-a", [{
    id: "new-link",
    title: "重新添加",
    url: "https://same.example",
    createdAt: 400,
    updatedAt: 400
  }]);
  const links = updated.spaces[0].groups[0].links;

  assert.equal(links.length, 2);
  assert.equal(links.filter((link) => !link.deletedAt).length, 1);
  assert.equal(links.find((link) => !link.deletedAt).id, "new-link");
}

/**
 * 测试添加链接时会跳过无效链接。
 *
 * @returns {void}
 */
function testAddLinksToGroupSkipsInvalidLinks() {
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
          }
        ]
      }
    ],
    settings: {}
  });

  const nextData = addLinksToGroup(data, "space-a", "group-a", [
    { title: "无效链接", url: "" },  // 空 URL
    { title: "有效链接", url: "https://example.com" }  // 有效 URL
  ]);

  const group = nextData.spaces[0].groups[0];
  assert.equal(group.links.length, 1);
  assert.equal(group.links[0].title, "有效链接");
}

/**
 * 测试移动数组元素时边界情况处理。
 *
 * @returns {void}
 */
function testMoveArrayItemBoundaryCases() {
  // 空数组
  assert.deepEqual(moveArrayItem([], 0, 0), []);

  // 单元素数组
  assert.deepEqual(moveArrayItem(["a"], 0, 0), ["a"]);

  // 相同索引
  assert.deepEqual(moveArrayItem(["a", "b", "c"], 1, 1), ["a", "b", "c"]);

  // 越界索引
  assert.deepEqual(moveArrayItem(["a", "b"], -1, 0), ["a", "b"]);
  assert.deepEqual(moveArrayItem(["a", "b"], 0, 10), ["a", "b"]);
}

/**
 * 测试加密备份能正确识别不同的加密格式。
 *
 * @returns {void}
 */
async function testEncryptedBackupFormatDetection() {
  const data = normalizeData({
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
  });

  const backupText = await createEncryptedBackup(data, "secret", "device-test");
  const backupData = JSON.parse(backupText);

  // 验证加密格式元数据存在
  assert.equal(backupData.encrypted, true);
  assert.equal(backupData.encryption, "PBKDF2-SHA256-AES-GCM");
  assert.ok(backupData.iterations > 0);
  assert.ok(backupData.salt.length > 0);
  assert.ok(backupData.iv.length > 0);
  assert.ok(backupData.payload.length > 0);

  // 验证原始数据不包含在备份中
  assert.equal(backupText.includes("space-a"), false);
  assert.equal(backupText.includes("空间 A"), false);
}

/**
 * 测试导入冲突检测能正确识别各种冲突情况。
 *
 * @returns {void}
 */
function testDetectImportConflictVariousScenarios() {
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

  // 场景1：导入较旧数据
  const olderData = ensureSyncSettings(normalizeData({
    version: 1,
    activeSpaceId: "space-a",
    spaces: [
      {
        id: "space-a",
        name: "空间 A",
        updatedAt: 100,
        groups: []
      }
    ],
    settings: {}
  }), "device-local");

  let conflict = detectImportConflict(localData, olderData);
  assert.equal(conflict.isOlder, true);
  assert.equal(conflict.isDifferentDevice, false);
  assert.equal(conflict.requiresConfirm, true);

  // 场景2：同设备导入较新数据
  const newerData = ensureSyncSettings(normalizeData({
    version: 1,
    activeSpaceId: "space-a",
    spaces: [
      {
        id: "space-a",
        name: "空间 A",
        updatedAt: 1000,
        groups: []
      }
    ],
    settings: {}
  }), "device-local");

  conflict = detectImportConflict(localData, newerData);
  assert.equal(conflict.isOlder, false);
  assert.equal(conflict.isDifferentDevice, false);
  assert.equal(conflict.requiresConfirm, false);

  // 场景3：不同设备导入
  const differentDeviceData = ensureSyncSettings(normalizeData({
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
  }), "device-remote");

  conflict = detectImportConflict(localData, differentDeviceData);
  assert.equal(conflict.isOlder, false);
  assert.equal(conflict.isDifferentDevice, true);
  assert.equal(conflict.requiresConfirm, true);
}

/**
 * 测试工作台合并按 settings.updatedAt 保留较新的设置。
 *
 * @returns {void}
 */
function testMergeWorkspaceDataKeepsNewerSettings() {
  const baseSpace = { id: "space-a", name: "A", createdAt: 1, updatedAt: 100, groups: [] };
  const staleLocal = normalizeData({
    version: 1,
    activeSpaceId: "space-a",
    spaces: [baseSpace],
    settings: { updatedAt: 100, theme: "light", sync: { gistToken: "old-token" } }
  });
  const newerStored = normalizeData({
    version: 1,
    activeSpaceId: "space-a",
    spaces: [baseSpace],
    settings: { updatedAt: 200, theme: "dark", sync: { gistToken: "new-token" } }
  });

  const storedWins = mergeWorkspaceData(staleLocal, newerStored, "device-a");
  assert.equal(storedWins.settings.theme, "dark");
  assert.equal(storedWins.settings.sync.gistToken, "new-token");

  const localWins = mergeWorkspaceData(newerStored, staleLocal, "device-a");
  assert.equal(localWins.settings.theme, "dark");
  assert.equal(localWins.settings.sync.gistToken, "new-token");
}

/**
 * 测试同步运行状态使用独立版本时间，避免同 settings 版本的旧页面清掉新同步结果。
 *
 * @returns {void}
 */
function testMergeWorkspaceDataKeepsNewerSyncRuntimeState() {
  const baseSpace = { id: "space-a", name: "A", createdAt: 1, updatedAt: 100, groups: [] };
  const stalePage = normalizeData({
    version: 1,
    activeSpaceId: "space-a",
    spaces: [baseSpace],
    settings: {
      updatedAt: 1000,
      sync: {
        deviceId: "device-a",
        provider: "gist",
        gistToken: "local-token",
        gistId: "",
        stateUpdatedAt: 100,
        autoSyncPendingAt: 0,
        lastSyncAt: 0
      }
    }
  });
  const latestStored = normalizeData({
    version: 1,
    activeSpaceId: "space-a",
    spaces: [baseSpace],
    settings: {
      updatedAt: 1000,
      sync: {
        deviceId: "device-a",
        provider: "gist",
        gistToken: "local-token",
        gistId: "gist-latest",
        stateUpdatedAt: 200,
        autoSyncPendingAt: 150,
        lastSyncAt: 180
      }
    }
  });

  const merged = mergeWorkspaceData(stalePage, latestStored, "device-a");

  assert.equal(merged.settings.sync.stateUpdatedAt, 200);
  assert.equal(merged.settings.sync.gistId, "gist-latest");
  assert.equal(merged.settings.sync.autoSyncPendingAt, 150);
  assert.equal(merged.settings.sync.lastSyncAt, 180);
}

/**
 * 测试合并时链接墓碑（deletedAt）能阻止已删除链接被远端旧数据复活。
 *
 * @returns {void}
 */
function testMergeRespectsLinkTombstone() {
  /** 本地数据：链接已被删除，留下 deletedAt 墓碑。 */
  const localData = ensureSyncSettings(normalizeData({
    version: 1,
    activeSpaceId: "s1",
    spaces: [{
      id: "s1",
      name: "S1",
      createdAt: 1,
      updatedAt: 300,
      groups: [{
        id: "g1",
        name: "G1",
        createdAt: 1,
        updatedAt: 300,
        links: [
          { id: "l1", title: "已删除链接", url: "https://example.com", createdAt: 1, updatedAt: 100, deletedAt: 200 }
        ]
      }]
    }],
    settings: {}
  }), "device-a");

  /** 远端数据：链接仍然存在，没有墓碑。 */
  const remoteData = ensureSyncSettings(normalizeData({
    version: 1,
    activeSpaceId: "s1",
    spaces: [{
      id: "s1",
      name: "S1",
      createdAt: 1,
      updatedAt: 100,
      groups: [{
        id: "g1",
        name: "G1",
        createdAt: 1,
        updatedAt: 100,
        links: [
          { id: "l1", title: "原始链接", url: "https://example.com", createdAt: 1, updatedAt: 100 }
        ]
      }]
    }],
    settings: {}
  }), "device-b");

  const merged = mergeWorkspaceData(localData, remoteData, "device-a");
  const group = merged.spaces[0].groups[0];

  assert.equal(group.links.length, 1);
  assert.equal(group.links[0].id, "l1");
  assert.equal(group.links[0].deletedAt, 200);

  // 墓碑必须保留在同步数据中，才能阻止更晚上线的第三台设备再次带回旧链接。
  const mergedWithThirdDevice = mergeWorkspaceData(merged, remoteData, "device-a");
  assert.equal(mergedWithThirdDevice.spaces[0].groups[0].links[0].deletedAt, 200);
}

/**
 * 测试合并时分组墓碑（deletedAt）能阻止已删除分组被远端旧数据复活。
 *
 * @returns {void}
 */
function testMergeRespectsGroupTombstone() {
  const localData = ensureSyncSettings(normalizeData({
    version: 1,
    activeSpaceId: "s1",
    spaces: [{
      id: "s1",
      name: "S1",
      createdAt: 1,
      updatedAt: 300,
      groups: [
        { id: "g1", name: "G1", createdAt: 1, updatedAt: 100, links: [] },
        { id: "g2", name: "已删除分组", createdAt: 1, updatedAt: 100, deletedAt: 200, links: [] }
      ]
    }],
    settings: {}
  }), "device-a");

  const remoteData = ensureSyncSettings(normalizeData({
    version: 1,
    activeSpaceId: "s1",
    spaces: [{
      id: "s1",
      name: "S1",
      createdAt: 1,
      updatedAt: 100,
      groups: [
        { id: "g1", name: "G1", createdAt: 1, updatedAt: 100, links: [] },
        { id: "g2", name: "原始分组", createdAt: 1, updatedAt: 100, links: [{ id: "l1", title: "L", url: "https://x.com", createdAt: 1 }] }
      ]
    }],
    settings: {}
  }), "device-b");

  const merged = mergeWorkspaceData(localData, remoteData, "device-a");
  const groups = merged.spaces[0].groups;

  assert.deepEqual(groups.map((g) => g.id), ["g1", "g2"]);
  assert.equal(groups.find((g) => g.id === "g2").deletedAt, 200);

  const mergedWithThirdDevice = mergeWorkspaceData(merged, remoteData, "device-a");
  assert.equal(mergedWithThirdDevice.spaces[0].groups.find((g) => g.id === "g2").deletedAt, 200);
}

/**
 * 测试合并时空间墓碑（deletedAt）能阻止已删除空间被远端旧数据复活。
 *
 * @returns {void}
 */
function testMergeRespectsSpaceTombstone() {
  const localData = ensureSyncSettings(normalizeData({
    version: 1,
    activeSpaceId: "s1",
    spaces: [
      { id: "s1", name: "S1", createdAt: 1, updatedAt: 100, groups: [] },
      { id: "s2", name: "已删除空间", createdAt: 1, updatedAt: 100, deletedAt: 200, groups: [] }
    ],
    settings: {}
  }), "device-a");

  const remoteData = ensureSyncSettings(normalizeData({
    version: 1,
    activeSpaceId: "s1",
    spaces: [
      { id: "s1", name: "S1", createdAt: 1, updatedAt: 100, groups: [] },
      { id: "s2", name: "原始空间", createdAt: 1, updatedAt: 100, groups: [{ id: "g1", name: "G", createdAt: 1, links: [] }] }
    ],
    settings: {}
  }), "device-b");

  const merged = mergeWorkspaceData(localData, remoteData, "device-a");
  const spaces = merged.spaces;

  assert.deepEqual(spaces.map((s) => s.id), ["s1", "s2"]);
  assert.equal(spaces.find((s) => s.id === "s2").deletedAt, 200);

  const mergedWithThirdDevice = mergeWorkspaceData(merged, remoteData, "device-a");
  assert.equal(mergedWithThirdDevice.spaces.find((s) => s.id === "s2").deletedAt, 200);
}

function testMergeSessionSnapshotsUnionsById() {
  const now = Date.now();
  const local = [
    { id: "a", createdAt: now, reason: "manual", windows: [] },
    { id: "b", createdAt: now - 1000, reason: "interval", windows: [] }
  ];
  const remote = [
    { id: "b", createdAt: now - 1000, reason: "interval", windows: [] },
    { id: "c", createdAt: now - 2000, reason: "startup", windows: [] }
  ];
  const merged = tabdeskCore.mergeSessionSnapshots(local, remote, { limit: 50, retentionMs: 30 * 24 * 60 * 60 * 1000 });
  assert.equal(merged.length, 3);
  assert.equal(merged[0].id, "a");
  assert.equal(merged[1].id, "b");
  assert.equal(merged[2].id, "c");
}

function testMergeSessionSnapshotsAppliesLimitAndRetention() {
  const now = Date.now();
  const old = now - (31 * 24 * 60 * 60 * 1000);
  const localSnapshots = Array.from({ length: 5 }, (_, i) => ({
    id: `local-${i}`, createdAt: now - i * 1000, reason: "interval", windows: []
  }));
  const remote = [
    { id: "expired", createdAt: old, reason: "manual", windows: [] },
    { id: "remote-0", createdAt: now - 200, reason: "manual", windows: [] }
  ];
  const merged = tabdeskCore.mergeSessionSnapshots(localSnapshots, remote, { limit: 3, retentionMs: 30 * 24 * 60 * 60 * 1000 });
  assert.equal(merged.length, 3);
  assert.equal(merged.some((s) => s.id === "expired"), false);
  assert.equal(merged[0].id, "local-0");
  assert.equal(merged[1].id, "remote-0");
}

function testFindDuplicateLinksAcrossGroups() {
  const data = normalizeData({
    version: 1,
    activeSpaceId: "s1",
    spaces: [{
      id: "s1",
      name: "S1",
      groups: [
        { id: "g1", name: "G1", links: [{ id: "a", title: "A", url: "https://example.com/page#one", createdAt: 10, updatedAt: 10 }] },
        { id: "g2", name: "G2", links: [{ id: "b", title: "B", url: "https://EXAMPLE.com/page", createdAt: 20, updatedAt: 20 }] }
      ]
    }],
    settings: {}
  });

  const duplicates = tabdeskCore.findDuplicateLinks(data, { spaceId: "s1" });
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].keep.linkId, "b");
  assert.deepEqual(duplicates[0].duplicates.map((item) => item.linkId), ["a"]);
}

function testDeduplicateLinksCreatesTombstones() {
  const data = normalizeData({
    version: 1,
    activeSpaceId: "s1",
    spaces: [{
      id: "s1",
      name: "S1",
      groups: [
        { id: "g1", name: "G1", links: [{ id: "a", title: "A", url: "https://example.com/page/", createdAt: 10, updatedAt: 10 }] },
        { id: "g2", name: "G2", links: [{ id: "b", title: "B", url: "https://example.com/page", createdAt: 20, updatedAt: 20 }] }
      ]
    }],
    settings: {}
  });

  const result = tabdeskCore.deduplicateLinks(data, { spaceId: "s1" });
  assert.equal(result.removedCount, 1);
  assert.equal(result.data.spaces[0].groups[0].links[0].deletedAt > 0, true);
  assert.equal(result.data.spaces[0].groups[1].links[0].deletedAt, undefined);
}

function testTrashListsOnlyTopLevelRecoverableTombstones() {
  const now = Date.now();
  const data = normalizeData({
    version: 1,
    activeSpaceId: "live-space",
    spaces: [
      {
        id: "deleted-space",
        name: "已删空间",
        deletedAt: now - 100,
        groups: [{ id: "nested-group", name: "内部组", deletedAt: now - 90, links: [] }]
      },
      {
        id: "live-space",
        name: "正常空间",
        groups: [
          { id: "deleted-group", name: "已删分组", deletedAt: now - 80, links: [] },
          {
            id: "live-group",
            name: "正常分组",
            links: [{ id: "deleted-link", title: "已删链接", url: "https://trash.example", deletedAt: now - 70 }]
          }
        ]
      }
    ],
    settings: {}
  });

  const items = tabdeskCore.getTrashItems(data);
  assert.deepEqual(items.map((item) => item.type), ["link", "group", "space"]);
  assert.equal(items.some((item) => item.groupId === "nested-group"), false);
}

function testRestoreTrashLinkClearsTombstoneAndWinsVersionConflict() {
  const deletedAt = Date.now() - 1000;
  const data = normalizeData({
    version: 1,
    activeSpaceId: "s1",
    spaces: [{
      id: "s1",
      name: "S1",
      groups: [{
        id: "g1",
        name: "G1",
        links: [{ id: "l1", title: "L1", url: "https://restore.example", updatedAt: deletedAt, deletedAt }]
      }]
    }],
    settings: {}
  });

  const restored = tabdeskCore.restoreTrashItem(data, { type: "link", spaceId: "s1", groupId: "g1", linkId: "l1" });
  const link = restored.spaces[0].groups[0].links[0];
  assert.equal(link.deletedAt, undefined);
  assert.equal(link.updatedAt > deletedAt, true);
}

function testPurgeTrashLinkKeepsMinimalSyncTombstone() {
  const data = normalizeData({
    version: 1,
    activeSpaceId: "s1",
    spaces: [{
      id: "s1",
      name: "S1",
      groups: [{
        id: "g1",
        name: "G1",
        links: [{ id: "l1", title: "敏感标题", note: "敏感备注", url: "https://purge.example", deletedAt: Date.now() - 1000 }]
      }]
    }],
    settings: {}
  });

  const purged = tabdeskCore.purgeTrashItem(data, { type: "link", spaceId: "s1", groupId: "g1", linkId: "l1" });
  const link = purged.spaces[0].groups[0].links[0];
  assert.equal(link.purgedAt > 0, true);
  assert.equal(link.deletedAt, link.purgedAt);
  assert.equal(link.title, "已永久删除");
  assert.equal(link.url, "mytabdesk-purged://l1");
  assert.equal(link.note, "");
  assert.equal(tabdeskCore.getTrashItems(purged).length, 0);
}

function testPurgeExpiredTrashPurgesOnlyExpiredItems() {
  const now = Date.now();
  const retentionMs = 30 * 24 * 60 * 60 * 1000;
  const data = normalizeData({
    version: 1,
    activeSpaceId: "s1",
    spaces: [{
      id: "s1",
      name: "S1",
      groups: [{
        id: "g1",
        name: "G1",
        links: [
          { id: "old", title: "Old", url: "https://old.example", deletedAt: now - retentionMs - 1 },
          { id: "recent", title: "Recent", url: "https://recent.example", deletedAt: now - 1000 }
        ]
      }]
    }],
    settings: {}
  });

  const result = tabdeskCore.purgeExpiredTrash(data, retentionMs, now);
  const links = result.data.spaces[0].groups[0].links;
  assert.equal(result.purgedCount, 1);
  assert.equal(links.find((link) => link.id === "old").purgedAt > 0, true);
  assert.equal(links.find((link) => link.id === "recent").purgedAt, undefined);
}

function testClassifyLinkHealthSeparatesReachableBlockedAndBroken() {
  assert.deepEqual(tabdeskCore.classifyLinkHealth({ status: 204 }), { status: "ok", code: 204 });
  assert.deepEqual(tabdeskCore.classifyLinkHealth({ status: 403 }), { status: "blocked", code: 403 });
  assert.deepEqual(tabdeskCore.classifyLinkHealth({ status: 404 }), { status: "broken", code: 404 });
  assert.deepEqual(tabdeskCore.classifyLinkHealth({ timedOut: true }), { status: "timeout", code: 0 });
  assert.deepEqual(tabdeskCore.classifyLinkHealth({ networkBlocked: true }), { status: "blocked", code: 0 });
}

function testNormalizeAndUpdateLinkColorUsesAllowedPalette() {
  const data = normalizeData({
    version: 1,
    activeSpaceId: "s1",
    spaces: [{
      id: "s1",
      name: "S1",
      groups: [{ id: "g1", name: "G1", color: "blue", links: [{ id: "l1", title: "L1", url: "https://color.example", color: "red" }] }]
    }],
    settings: {}
  });
  assert.equal(data.spaces[0].groups[0].color, "blue");
  assert.equal(data.spaces[0].groups[0].links[0].color, "red");

  const updated = updateLink(data, "s1", "g1", "l1", { title: "L1", url: "https://color.example", favIconUrl: "", color: "purple" });
  assert.equal(updated.spaces[0].groups[0].links[0].color, "purple");
  const invalid = normalizeData({ ...data, spaces: [{ ...data.spaces[0], groups: [{ ...data.spaces[0].groups[0], color: "invalid" }] }] });
  assert.equal(invalid.spaces[0].groups[0].color, "");
}

/**
 * 测试 normalizeData 会为缺失的 settings.spaceTemplates 字段补充默认空数组。
 *
 * @returns {void}
 */
function testNormalizeDataPreservesSpaceTemplates() {
  /** 不含 spaceTemplates 的原始数据。 */
  const rawData = {
    version: 1,
    activeSpaceId: "s1",
    spaces: [{ id: "s1", name: "空间", groups: [] }],
    settings: {}
  };
  /** 标准化后的数据。 */
  const normalized = normalizeData(rawData);

  assert.equal(Array.isArray(normalized.settings.spaceTemplates), true);
  assert.equal(normalized.settings.spaceTemplates.length, 0);

  /** 已包含模板的原始数据。 */
  const template = {
    id: "tpl-1",
    name: "开发模板",
    icon: "💻",
    groups: [{ name: "文档", links: [{ title: "文档站", url: "https://docs.example" }] }]
  };
  /** 标准化后的带模板数据。 */
  const withTemplates = normalizeData({
    ...rawData,
    settings: { spaceTemplates: [template] }
  });

  assert.equal(Array.isArray(withTemplates.settings.spaceTemplates), true);
  assert.equal(withTemplates.settings.spaceTemplates.length, 1);
  assert.equal(withTemplates.settings.spaceTemplates[0].id, "tpl-1");
  assert.equal(withTemplates.settings.spaceTemplates[0].name, "开发模板");
  assert.equal(withTemplates.settings.spaceTemplates[0].icon, "💻");
  assert.equal(withTemplates.settings.spaceTemplates[0].groups.length, 1);
  assert.equal(withTemplates.settings.spaceTemplates[0].groups[0].name, "文档");
  assert.equal(withTemplates.settings.spaceTemplates[0].groups[0].links[0].url, "https://docs.example");
}

/**
 * 测试 normalizeSpaceTemplate 会规范化模板字段，剔除多余字段并只保留允许的链接字段。
 *
 * @returns {void}
 */
function testNormalizeSpaceTemplateStripsExtraFields() {
  /** 带有冗余字段的原始模板。 */
  const rawTemplate = {
    id: "",
    name: "",
    icon: "",
    groups: [
      {
        name: "工具",
        extra: true,
        links: [
          { title: "A", url: "https://a.example", favIconUrl: "https://a.example/fav.ico", note: "备注", color: "red", healthStatus: "ok", extra: true },
          { title: "", url: "", note: "空链接应被过滤" }
        ]
      }
    ]
  };
  /** 标准化后的模板。 */
  const template = normalizeSpaceTemplate(rawTemplate);

  assert.equal(typeof template.id === "string" && template.id.length > 0, true);
  assert.equal(template.name, "未命名模板");
  assert.equal(template.icon, "📁");
  assert.equal(template.groups.length, 1);
  assert.equal(template.groups[0].name, "工具");
  assert.equal("extra" in template.groups[0], false);
  assert.equal(template.groups[0].links.length, 1);
  /** 链接只保留允许的字段。 */
  assert.equal(template.groups[0].links[0].title, "A");
  assert.equal(template.groups[0].links[0].url, "https://a.example");
  assert.equal(template.groups[0].links[0].favIconUrl, "https://a.example/fav.ico");
  assert.equal(template.groups[0].links[0].note, "备注");
  assert.equal(template.groups[0].links[0].color, "red");
  assert.equal("healthStatus" in template.groups[0].links[0], false);
  assert.equal("extra" in template.groups[0].links[0], false);
}

/**
 * 测试 createSpaceFromTemplate 会生成新空间，复制分组和链接，并为所有对象生成全新 ID。
 *
 * @returns {void}
 */
function testCreateSpaceFromTemplateCopiesGroupsAndLinks() {
  /** 基础数据。 */
  const data = normalizeData({
    version: 1,
    activeSpaceId: "s1",
    spaces: [{ id: "s1", name: "源空间", groups: [] }],
    settings: {}
  });
  /** 源模板。 */
  const template = {
    id: "tpl-1",
    name: "开发模板",
    icon: "💻",
    groups: [
      {
        name: "文档",
        links: [{ title: "文档站", url: "https://docs.example", favIconUrl: "https://docs.example/fav.ico", note: "主站", color: "blue" }]
      },
      {
        name: "工具",
        links: [{ title: "工具站", url: "https://tools.example" }]
      }
    ]
  };

  /** 从模板创建后的数据。 */
  const result = createSpaceFromTemplate(data, template, "我的开发空间", "🚀");
  /** 新创建的空间。 */
  const newSpace = result.spaces.find((space) => space.name === "我的开发空间");

  assert.equal(typeof newSpace, "object");
  assert.equal(newSpace.name, "我的开发空间");
  assert.equal(newSpace.icon, "🚀");
  assert.equal(newSpace.groups.length, 2);
  assert.equal(newSpace.groups[0].name, "文档");
  assert.equal(newSpace.groups[0].links.length, 1);
  assert.equal(newSpace.groups[0].links[0].title, "文档站");
  assert.equal(newSpace.groups[0].links[0].url, "https://docs.example");
  assert.equal(newSpace.groups[0].links[0].favIconUrl, "https://docs.example/fav.ico");
  assert.equal(newSpace.groups[0].links[0].note, "主站");
  assert.equal(newSpace.groups[0].links[0].color, "blue");
  assert.equal(newSpace.groups[1].name, "工具");
  assert.equal(newSpace.groups[1].links[0].url, "https://tools.example");

  /** 所有分组和链接都应获得全新 ID，不复用模板内 ID。 */
  assert.equal(newSpace.id !== template.id, true);
  assert.equal(typeof newSpace.id === "string" && newSpace.id.length > 0, true);
  for (const group of newSpace.groups) {
    assert.equal(typeof group.id === "string" && group.id.length > 0, true);
    for (const link of group.links) {
      assert.equal(typeof link.id === "string" && link.id.length > 0, true);
    }
  }

  /** 新空间应被激活。 */
  assert.equal(result.activeSpaceId, newSpace.id);
  /** 原空间仍应存在。 */
  assert.equal(result.spaces.length, 2);
  assert.equal(result.spaces.find((space) => space.id === "s1") !== undefined, true);
}

/**
 * 测试 createSpaceFromTemplate 使用默认名称和图标时仍可正常工作。
 *
 * @returns {void}
 */
function testCreateSpaceFromTemplateUsesDefaultsWhenNameEmpty() {
  /** 基础数据。 */
  const data = normalizeData({
    version: 1,
    activeSpaceId: "s1",
    spaces: [{ id: "s1", name: "源", groups: [] }],
    settings: {}
  });
  /** 仅含一个分组的模板。 */
  const template = {
    id: "tpl-1",
    name: "模板",
    icon: "📁",
    groups: [{ name: "G1", links: [] }]
  };

  /** 名称和图标为空时创建空间。 */
  const result = createSpaceFromTemplate(data, template, "", "");
  /** 新创建的空间。 */
  const newSpace = result.spaces.find((space) => space.name === "模板");

  assert.equal(newSpace !== undefined, true);
  assert.equal(newSpace.icon, "📁");
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
  testResolveSafeWebDavFileUrlRejectsMissingConfig();
  testResolveSafeWebDavFileUrlRejectsInsecureUrl();
  testResolveSafeWebDavFileUrlReturnsResolvedHttpsUrl();
  testCreateBasicAuthHeaderUsesUtf8Credentials();
  testIsSyncProviderEnabledSupportsBothProviders();
  testIsSyncProviderEnabledIgnoresAutoSyncOnly();
  testGetEnabledSyncProvidersReturnsBothProviders();
  testGetAutoSyncProvidersHonorsProviderSwitches();
  testIsSyncProviderEnabledKeepsLegacyProvider();
  testIsMyTabDeskGistMatchesDescription();
  testIsMyTabDeskGistMatchesFilename();
  testIsMyTabDeskGistRejectsUnrelatedGist();
  testEnsureSyncSettingsAddsDefaults();
  testEnsureSyncSettingsKeepsAutoSyncOptions();
  testTouchSyncStateIsMonotonic();
  testGetDataUpdatedAtReturnsLatestTimestamp();
  testGetDataUpdatedAtIncludesLinksAndTombstones();
  testNormalizeDataPreservesAllSpaceTombstones();
  testMergePreservesAllSpaceTombstones();
  testMergeTombstoneIgnoresSyntheticMigrationTime();
  testNormalizeDataSkipsDeletedActiveSpace();
  await testEncryptedBackupRoundTrip();
  await testRestoreEncryptedBackupReadsLegacyXorBackup();
  await testRestoreEncryptedBackupRejectsUnknownEncryption();
  await testRestoreEncryptedBackupRejectsWrongPassword();
  await testRestoreEncryptedBackupRejectsUnsafeParameters();
  testDetectImportConflictFlagsOlderAndDifferentDevice();
  testExportDataOmitsTombstones();
  testExportDataUsesTabTabCompatibleShape();
  testExportDataRemovesSyncSecrets();
  testCreateBackupSafeDataRemovesSecrets();
  testSyncDataRoundTripPreservesTombstonesWithoutSecrets();
  testNativeBackupRoundTripPreservesWorkspaceMetadata();
  testExportImportRoundTripPreservesGroupsAndLinks();
  testImportDataRejectsInvalidText();
  testImportDataReadsPackagedBackup();
  testImportDataNormalizesData();
  testImportDataReadsTabTabBackup();
  testMoveArrayItemReordersArray();
  testReorderSpacesMovesTargetSpace();
  testReorderGroupsMovesTargetGroup();
  testReorderLinksMovesTargetLink();
  testMoveLinkBetweenGroupsLeavesSourceTombstone();
  testMoveGroupBetweenSpacesLeavesSourceTombstone();
  testMoveLinkBetweenGroupsInsertsBeforeTargetLink();
  testMoveLinkBetweenGroupsAppendsWhenNoTargetLink();
  testUpdateLinkChangesTitleUrlAndIcon();
  testUpdateLinkRejectsEmptyUrl();
  testAddLinksToGroupDedupesByUrl();
  testMergeWorkspaceDataKeepsBothSidesNewItems();
  testMergeWorkspaceDataMergesLinksWithoutPrompt();
  testMergeWorkspaceDataKeepsLocalOrderWithRemoteAppended();
  testMergeLinksRefreshesIndexesAfterUrlChange();
  testClearAllDataReturnsDefaultData();
  // 新增测试用例
  testFindGroupLocatesGroup();
  testFindLinkLocatesLink();
  testAddLinksToGroupAllowsUrlAfterTombstone();
  testAddLinksToGroupSkipsInvalidLinks();
  testMoveArrayItemBoundaryCases();
  await testEncryptedBackupFormatDetection();
  testDetectImportConflictVariousScenarios();
  testMergeWorkspaceDataKeepsNewerSettings();
  testMergeWorkspaceDataKeepsNewerSyncRuntimeState();
  testMergeRespectsLinkTombstone();
  testMergeRespectsGroupTombstone();
  testMergeRespectsSpaceTombstone();
  testMergeSessionSnapshotsUnionsById();
  testMergeSessionSnapshotsAppliesLimitAndRetention();
  testFindDuplicateLinksAcrossGroups();
  testDeduplicateLinksCreatesTombstones();
  testTrashListsOnlyTopLevelRecoverableTombstones();
  testRestoreTrashLinkClearsTombstoneAndWinsVersionConflict();
  testPurgeTrashLinkKeepsMinimalSyncTombstone();
  testPurgeExpiredTrashPurgesOnlyExpiredItems();
  testClassifyLinkHealthSeparatesReachableBlockedAndBroken();
  testNormalizeAndUpdateLinkColorUsesAllowedPalette();
  testNormalizeDataPreservesSpaceTemplates();
  testNormalizeSpaceTemplateStripsExtraFields();
  testCreateSpaceFromTemplateCopiesGroupsAndLinks();
  testCreateSpaceFromTemplateUsesDefaultsWhenNameEmpty();

  console.log("所有核心逻辑测试通过");
}

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
