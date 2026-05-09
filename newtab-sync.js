(function (root) {
const app = root.MyTabDeskPage;
const { state, elements } = app;
const {
  getCurrentTime,
  getEnabledSyncProviders,
  isMyTabDeskGist,
  ensureSyncSettings,
  mergeWorkspaceData,
  exportData,
  importData,
  resolveSafeWebDavFileUrl,
  getWebDavSyncFilename,
  resolveWebDavHistoryDirectoryUrl,
  resolveWebDavHistoryFileUrl,
  formatWebDavHistoryDate,
  createWebDavHistoryBackupPayload,
  normalizeWebDavHistoryEntry,
  DEFAULT_WEBDAV_HISTORY_LIMIT,
  createBasicAuthHeader
} = app;
const {
  isAutoSyncEnabled,
  getSyncSettings,
  createWorkspaceSnapshot,
  saveData
} = root.MyTabDeskUtils;
const { showAlert, showConfirm } = root.MyTabDeskDialogs;
const notifications = root.MyTabDeskNotifications || {};

/**
 * 默认重试次数。
 */
const DEFAULT_MAX_RETRIES = 3;

/**
 * 基础重试延迟（毫秒）。
 */
const BASE_RETRY_DELAY = 1000;

/**
 * 执行带超时和指数退避重试的网络请求。
 *
 * @param {string} url 请求地址。
 * @param {object} options fetch 请求选项。
 * @param {number} maxRetries 最大重试次数。
 * @returns {Promise<Response>} fetch 响应对象。
 * @throws {Error} 当请求超时或所有重试都失败时抛出错误。
 */
async function fetchWithRetry(url, options, maxRetries = DEFAULT_MAX_RETRIES) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetchWithTimeout(url, options);
    } catch (error) {
      lastError = error;

      // 如果已经达到最大重试次数，或者错误是用户取消（AbortError），不再重试
      if (error.name === "AbortError" || attempt >= maxRetries) {
        throw error;
      }

      // 计算指数退避延迟
      const delay = BASE_RETRY_DELAY * Math.pow(2, attempt);
      console.warn(`请求失败，${delay}ms 后重试 (${attempt + 1}/${maxRetries}):`, error.message);

      // 等待后再重试
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * 从设置表单读取同步配置。
 *
 * @returns {object} 表单中的同步配置对象。
 */
function readSyncSettingsForm() {
  /** 是否启用 WebDAV 同步。 */
  const webdavEnabled = elements.webdavSyncSwitch.checked;
  /** 是否启用 GitHub Gist 同步。 */
  const gistEnabled = elements.gistSyncSwitch.checked;
  /** 兼容旧数据结构的主同步服务商。 */
  const provider = webdavEnabled && gistEnabled ? "both" : webdavEnabled ? "webdav" : gistEnabled ? "gist" : "none";

  return {
    provider,
    webdavUrl: elements.webdavUrlInput.value.trim(),
    webdavUsername: elements.webdavUsernameInput.value.trim(),
    webdavPassword: elements.webdavPasswordInput.value,
    webdavFilename: elements.webdavFilenameInput.value.trim(),
    webdavAutoSyncEnabled: elements.webdavAutoSyncSwitch.checked,
    gistToken: elements.gistTokenInput.value.trim(),
    gistId: elements.gistIdInput.value.trim(),
    gistFilename: elements.gistFilenameInput.value.trim() || "mytabdesk-sync.json",
    gistAutoSyncEnabled: elements.gistAutoSyncSwitch.checked
  };
}

/**
 * 保存同步配置到本地数据。
 *
 * @returns {Promise<void>} 保存完成后结束。
 */
async function saveSyncSettingsFromForm() {
  /** 表单同步配置。 */
  const form = readSyncSettingsForm();
  /** 当前同步配置。 */
  const sync = state.data.settings.sync;

  Object.assign(sync, form);
  await saveData({ skipAutoSync: true });
  root.MyTabDeskRender.renderSettingsStatus();
}

/**
 * 切换启用的远程同步服务商。
 *
 * @param {string} provider 需要启用的同步服务商。
 * @returns {void}
 */
function selectSyncProvider(provider) {
  if (provider === "gist") {
    elements.gistSyncSwitch.checked = true;
  } else if (provider === "webdav") {
    elements.webdavSyncSwitch.checked = true;
  } else {
    elements.gistSyncSwitch.checked = false;
    elements.webdavSyncSwitch.checked = false;
  }
}

/**
 * 保存同步配置并提示用户。
 *
 * @returns {Promise<void>} 保存完成后结束。
 */
async function handleSaveSyncSettings() {
  await saveSyncSettingsFromForm();
  await showAlert("同步配置已保存。");
  if (notifications.notifySuccess) {
    notifications.notifySuccess("配置已保存", "同步设置已更新");
  }
}

/**
 * 创建用于云端同步的普通备份文本。
 *
 * @returns {string} JSON 备份文本。
 */
function createSyncPayload() {
  return exportData(state.data);
}

/**
 * 自动上传本地数据到当前远程服务商。
 *
 * @param {object} sync 当前同步配置。
 * @returns {Promise<void>} 上传完成后结束。
 */
async function uploadAutoSync(sync) {
  /** 自动同步备份文本。 */
  const payload = createSyncPayload();
  /** 已启用的同步服务商列表。 */
  const providers = getEnabledSyncProviders(sync);

  for (const provider of providers) {
    validateSyncProviderSettings(sync, provider);

    if (provider === "webdav") {
      await uploadWebDav(sync, payload);
    } else {
      /** 上传后返回的 Gist ID。 */
      const gistId = await uploadGist(sync, payload);
      state.data.settings.sync.gistId = gistId;

      if (elements.gistIdInput) {
        elements.gistIdInput.value = gistId;
      }
    }
  }
}

/**
 * 从当前远程服务商下载云端同步数据。
 *
 * @param {object} sync 当前同步配置。
 * @param {string} provider 需要下载的同步服务商。
 * @returns {Promise<object|null>} 解析后的远端数据，远端不存在时返回 null。
 */
async function downloadRemoteSyncData(sync, provider) {
  try {
    /** 云端备份文本。 */
    const payload = provider === "webdav" ? await downloadWebDav(sync) : await downloadGist(sync);
    return importData(payload);
  } catch (error) {
    /** 错误消息文本。 */
    const message = error && error.message ? error.message : "";
    /** 是否为远端文件不存在错误。 */
    const isMissingRemote = message.includes("404") || message.includes("未找到指定同步文件") || message.includes("请先填写 Gist ID");

    if (isMissingRemote) {
      return null;
    }

    throw error;
  }
}

/**
 * 将同步配置状态更新为已完成。
 *
 * @param {object} sync 当前同步配置。
 * @param {number} syncedAt 同步完成时间戳。
 * @returns {void}
 */
function markSyncCompleted(sync, syncedAt) {
  sync.lastSyncAt = syncedAt;
  sync.lastBackupAt = syncedAt;
  sync.lastImportAt = syncedAt;
  sync.lastAutoSyncAt = syncedAt;
  sync.autoSyncPendingAt = 0;
  sync.lastAutoSyncError = "";
}

/**
 * 执行一次自动双向同步，先拉取远端数据，再自动合并并上传合并结果。
 *
 * @param {object} sync 当前同步配置。
 * @param {string} provider 需要执行双向同步的同步服务商。
 * @returns {Promise<void>} 同步完成后结束。
 */
async function runBidirectionalSync(sync, provider) {
  /** 本地同步配置副本。 */
  const localSync = Object.assign({}, state.data.settings.sync);
  /** 远端工作台数据。 */
  const remoteData = await downloadRemoteSyncData(sync, provider);

  if (remoteData) {
    state.data = mergeWorkspaceData(state.data, remoteData, localSync.deviceId);
    Object.assign(state.data.settings.sync, localSync);
  }

  if (provider === "webdav") {
    await uploadWebDav(state.data.settings.sync, createSyncPayload());
  } else {
    /** 上传后返回的 Gist ID。 */
    const gistId = await uploadGist(state.data.settings.sync, createSyncPayload());
    state.data.settings.sync.gistId = gistId;

    if (elements.gistIdInput) {
      elements.gistIdInput.value = gistId;
    }
  }

  markSyncCompleted(state.data.settings.sync, getCurrentTime());
  state.lastWorkspaceSnapshot = createWorkspaceSnapshot();
  await saveData({ skipAutoSync: true });
}

/**
 * 立即执行一次待处理自动同步。
 *
 * @returns {Promise<void>} 同步尝试完成后结束。
 */
async function runAutoSyncNow() {
  /** 当前同步配置。 */
  const sync = getSyncSettings();
  /** 已启用的同步服务商列表。 */
  const providers = getEnabledSyncProviders(sync);

  if (state.autoSyncRunning || !isAutoSyncEnabled(sync) || !sync.autoSyncPendingAt) {
    return;
  }

  state.autoSyncRunning = true;

  try {
    validateSyncSettings();

    for (const provider of providers) {
      await runBidirectionalSync(sync, provider);
    }
  } catch (error) {
    sync.lastAutoSyncError = error.message || "自动同步失败";
    await saveData({ skipAutoSync: true });
  } finally {
    state.autoSyncRunning = false;
    root.MyTabDeskRender.renderSettingsStatus();
  }
}

/**
 * 延迟调度一次自动同步，避免连续改动时重复上传。
 *
 * @returns {void}
 */
function scheduleAutoSync() {
  /** 当前同步配置。 */
  const sync = getSyncSettings();

  if (!isAutoSyncEnabled(sync) || !sync.autoSyncPendingAt) {
    return;
  }

  if (state.autoSyncTimerId) {
    clearTimeout(state.autoSyncTimerId);
  }

  state.autoSyncTimerId = window.setTimeout(() => {
    state.autoSyncTimerId = 0;
    try {
      runAutoSyncNow();
    } catch (error) {
      console.error("自动同步调度失败：", error);
    }
  }, 1200);
}

/**
 * 校验指定同步服务商配置。
 *
 * @param {object} sync 当前同步配置。
 * @param {string} provider 需要校验的同步服务商。
 * @returns {void} 校验通过后结束。
 * @throws {Error} 当同步配置不完整时抛出错误。
 */
function validateSyncProviderSettings(sync, provider) {
  if (provider === "webdav") {
    resolveSafeWebDavFileUrl(sync);
    return;
  }

  if (provider === "gist") {
    if (!sync.gistToken) {
      throw new Error("请先填写 GitHub Gist Token。");
    }
    return;
  }

  throw new Error("请先选择 WebDAV 或 GitHub Gist 同步方式。");
}

/**
 * 校验当前同步服务商配置。
 *
 * @returns {object} 当前同步配置。
 * @throws {Error} 当同步配置不完整时抛出错误。
 */
function validateSyncSettings() {
  /** 当前同步配置。 */
  const sync = state.data.settings.sync || {};
  /** 已启用的同步服务商列表。 */
  const providers = getEnabledSyncProviders(sync);

  if (providers.length === 0) {
    throw new Error("请先选择 WebDAV 或 GitHub Gist 同步方式。");
  }

  for (const provider of providers) {
    validateSyncProviderSettings(sync, provider);
  }

  return sync;
}

/**
 * 执行带超时控制的网络请求。
 *
 * @param {string} url 请求地址。
 * @param {object} options fetch 请求选项。
 * @returns {Promise<Response>} fetch 响应对象。
 * @throws {Error} 当请求超时时抛出错误。
 */
async function fetchWithTimeout(url, options) {
  /** 超时控制器。 */
  const controller = new AbortController();
  /** 合并后的请求选项。 */
  const requestOptions = {
    ...options,
    signal: controller.signal
  };
  /** 超时定时器。 */
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    return await fetch(url, requestOptions);
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("远程同步请求超时，请检查网络连接");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 判断响应状态是否表示远端资源不存在。
 *
 * @param {Response} response fetch 响应对象。
 * @returns {boolean} 远端资源不存在时返回 true。
 */
function isMissingWebDavResponse(response) {
  return response.status === 404;
}

/**
 * 创建 WebDAV 请求头。
 *
 * @param {object} sync WebDAV 同步配置。
 * @param {object} extraHeaders 额外请求头。
 * @returns {object} WebDAV 请求头对象。
 */
function createWebDavHeaders(sync, extraHeaders = {}) {
  return {
    Authorization: createBasicAuthHeader(sync.webdavUsername, sync.webdavPassword),
    ...extraHeaders
  };
}

/**
 * 上传文本到指定 WebDAV 文件地址。
 *
 * @param {object} sync WebDAV 同步配置。
 * @param {string} fileUrl WebDAV 文件地址。
 * @param {string} payload 待上传的文本内容。
 * @returns {Promise<void>} 上传完成后结束。
 * @throws {Error} 当上传失败时抛出错误。
 */
async function putWebDavText(sync, fileUrl, payload) {
  /** WebDAV 上传响应。 */
  const response = await fetchWithRetry(fileUrl, {
    method: "PUT",
    headers: createWebDavHeaders(sync, {
      "Content-Type": "application/json;charset=utf-8"
    }),
    body: payload
  });

  if (!response.ok) {
    throw new Error(`WebDAV 上传失败：${response.status}`);
  }
}

/**
 * 从指定 WebDAV 文件地址下载文本。
 *
 * @param {object} sync WebDAV 同步配置。
 * @param {string} fileUrl WebDAV 文件地址。
 * @returns {Promise<string|null>} 下载得到的文本，远端不存在时返回 null。
 * @throws {Error} 当下载失败时抛出错误。
 */
async function getWebDavText(sync, fileUrl) {
  /** WebDAV 下载响应。 */
  const response = await fetchWithRetry(fileUrl, {
    method: "GET",
    headers: createWebDavHeaders(sync)
  });

  if (isMissingWebDavResponse(response)) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`WebDAV 下载失败：${response.status}`);
  }

  return response.text();
}

/**
 * 确保 WebDAV 历史备份目录存在。
 *
 * @param {object} sync WebDAV 同步配置。
 * @param {string} directoryUrl WebDAV 历史备份目录地址。
 * @returns {Promise<void>} 目录可用后结束。
 * @throws {Error} 当目录创建失败时抛出错误。
 */
async function ensureWebDavHistoryDirectory(sync, directoryUrl) {
  /** WebDAV 创建目录响应。 */
  const response = await fetchWithRetry(directoryUrl, {
    method: "MKCOL",
    headers: createWebDavHeaders(sync)
  }, 0);

  if (response.ok || response.status === 405) {
    return;
  }

  throw new Error(`WebDAV 历史备份目录创建失败：${response.status}`);
}

/**
 * 解析 WebDAV PROPFIND 响应中的历史备份条目。
 *
 * @param {string} xmlText WebDAV PROPFIND XML 响应文本。
 * @param {string} directoryUrl WebDAV 历史备份目录地址。
 * @param {string} sourceFilename 当前 WebDAV 同步文件名。
 * @returns {object[]} WebDAV 历史备份条目列表。
 */
function parseWebDavHistoryListXml(xmlText, directoryUrl, sourceFilename) {
  /** XML 解析器。 */
  const parser = new DOMParser();
  /** XML 文档。 */
  const document = parser.parseFromString(xmlText, "application/xml");
  /** WebDAV 响应节点列表。 */
  const responses = Array.from(document.getElementsByTagNameNS("DAV:", "response"));
  /** 历史备份文件名前缀。 */
  const historyFilenamePrefix = `${sourceFilename.replace(/\.json$/i, "")}-backup-`;

  return responses.map((response) => {
    /** href 节点。 */
    const hrefNode = response.getElementsByTagNameNS("DAV:", "href")[0];
    /** 修改时间节点。 */
    const modifiedNode = response.getElementsByTagNameNS("DAV:", "getlastmodified")[0];
    /** href 原始值。 */
    const href = hrefNode ? hrefNode.textContent || "" : "";
    /** 文件 URL 对象。 */
    const itemUrl = new URL(href, directoryUrl);
    /** 文件名。 */
    const filename = decodeURIComponent(itemUrl.pathname.split("/").filter(Boolean).pop() || "");
    /** 修改时间戳。 */
    const modifiedAt = modifiedNode ? Date.parse(modifiedNode.textContent || "") : 0;

    return normalizeWebDavHistoryEntry({
      filename,
      url: itemUrl.toString(),
      backupDate: "",
      createdAt: Number.isFinite(modifiedAt) ? modifiedAt : 0
    });
  }).filter((entry) => entry.filename.startsWith(historyFilenamePrefix) && entry.filename.endsWith(".json") && entry.backupDate);
}

/**
 * 获取 WebDAV 历史备份列表。
 *
 * @param {object} sync WebDAV 同步配置。
 * @returns {Promise<object[]>} 历史备份条目列表。
 */
async function listWebDavHistoryBackups(sync) {
  /** 同步文件地址。 */
  const fileUrl = resolveSafeWebDavFileUrl(sync);
  /** 历史备份目录地址。 */
  const directoryUrl = resolveWebDavHistoryDirectoryUrl(fileUrl);
  /** WebDAV 历史备份列表响应。 */
  const response = await fetchWithRetry(directoryUrl, {
    method: "PROPFIND",
    headers: createWebDavHeaders(sync, {
      Depth: "1"
    })
  }, 0);

  if (isMissingWebDavResponse(response)) {
    return [];
  }

  if (!response.ok) {
    throw new Error(`WebDAV 历史备份列表获取失败：${response.status}`);
  }

  /** WebDAV XML 文本。 */
  const xmlText = await response.text();
  /** 同步文件名称。 */
  const sourceFilename = getWebDavSyncFilename(fileUrl);

  return parseWebDavHistoryListXml(xmlText, directoryUrl, sourceFilename).sort((left, right) => {
    if (left.backupDate !== right.backupDate) {
      return right.backupDate.localeCompare(left.backupDate);
    }

    return right.createdAt - left.createdAt;
  });
}

/**
 * 删除指定 WebDAV 历史备份文件。
 *
 * @param {object} sync WebDAV 同步配置。
 * @param {string} fileUrl WebDAV 历史备份文件地址。
 * @returns {Promise<void>} 删除完成后结束。
 * @throws {Error} 当删除失败时抛出错误。
 */
async function deleteWebDavHistoryBackup(sync, fileUrl) {
  /** WebDAV 删除响应。 */
  const response = await fetchWithRetry(fileUrl, {
    method: "DELETE",
    headers: createWebDavHeaders(sync)
  }, 0);

  if (response.ok || response.status === 404) {
    return;
  }

  throw new Error(`WebDAV 历史备份清理失败：${response.status}`);
}

/**
 * 清理超出保留数量的 WebDAV 历史备份。
 *
 * @param {object} sync WebDAV 同步配置。
 * @returns {Promise<void>} 清理完成后结束。
 */
async function pruneWebDavHistoryBackups(sync) {
  /** 历史备份列表。 */
  const backups = await listWebDavHistoryBackups(sync);
  /** 需要删除的历史备份列表。 */
  const expiredBackups = backups.slice(DEFAULT_WEBDAV_HISTORY_LIMIT);

  for (const backup of expiredBackups) {
    await deleteWebDavHistoryBackup(sync, backup.url);
  }
}

/**
 * 上传前创建当天 WebDAV 历史备份。
 *
 * @param {object} sync WebDAV 同步配置。
 * @param {string} fileUrl WebDAV 当前同步文件地址。
 * @returns {Promise<void>} 历史备份创建完成后结束。
 */
async function createDailyWebDavHistoryBackup(sync, fileUrl) {
  /** 当前云端同步文件文本。 */
  const remotePayload = await getWebDavText(sync, fileUrl);

  if (!remotePayload) {
    return;
  }

  /** 当前时间戳。 */
  const now = getCurrentTime();
  /** 当天历史备份日期。 */
  const backupDate = formatWebDavHistoryDate(now);
  /** 历史备份目录地址。 */
  const directoryUrl = resolveWebDavHistoryDirectoryUrl(fileUrl);
  /** 历史备份文件地址。 */
  const historyFileUrl = resolveWebDavHistoryFileUrl(fileUrl, backupDate);
  /** 当天已存在的历史备份文本。 */
  const existingHistoryPayload = await getWebDavText(sync, historyFileUrl);

  if (existingHistoryPayload) {
    return;
  }

  await ensureWebDavHistoryDirectory(sync, directoryUrl);

  /** 历史备份文本。 */
  const historyPayload = createWebDavHistoryBackupPayload(remotePayload, {
    backupDate,
    createdAt: now,
    sourceFilename: getWebDavSyncFilename(fileUrl)
  });

  await putWebDavText(sync, historyFileUrl, historyPayload);
  await pruneWebDavHistoryBackups(sync);
}

/**
 * 上传备份文本到 WebDAV。
 *
 * @param {object} sync 同步配置。
 * @param {string} payload 待上传的备份文本。
 * @returns {Promise<void>} 上传完成后结束。
 * @throws {Error} 当服务端返回失败状态时抛出错误。
 */
async function uploadWebDav(sync, payload) {
  /** 解析后的 WebDAV 同步文件地址。 */
  const fileUrl = resolveSafeWebDavFileUrl(sync);

  await createDailyWebDavHistoryBackup(sync, fileUrl);
  await putWebDavText(sync, fileUrl, payload);
}

/**
 * 从 WebDAV 下载备份文本。
 *
 * @param {object} sync 同步配置。
 * @returns {Promise<string>} 下载得到的备份文本。
 * @throws {Error} 当服务端返回失败状态时抛出错误。
 */
async function downloadWebDav(sync) {
  /** 解析后的 WebDAV 同步文件地址。 */
  const fileUrl = resolveSafeWebDavFileUrl(sync);
  /** WebDAV 下载文本。 */
  const payload = await getWebDavText(sync, fileUrl);

  if (!payload) {
    throw new Error("WebDAV 下载失败：404");
  }

  return payload;
}

/**
 * 上传备份文本到 GitHub Gist，未填写 Gist ID 时自动查找或创建。
 *
 * @param {object} sync 同步配置。
 * @param {string} payload 待上传的备份文本。
 * @returns {Promise<string>} 上传后使用的 Gist ID。
 * @throws {Error} 当服务端返回失败状态时抛出错误。
 */
async function uploadGist(sync, payload) {
  /** Gist 文件名。 */
  const filename = sync.gistFilename || "mytabdesk-sync.json";
  /** 最终使用的 Gist ID。 */
  let gistId = sync.gistId;
  /** 是否为新创建的 Gist。 */
  let isNewGist = false;

  if (!gistId) {
    /** 自动查找到的 MyTabDesk Gist。 */
    const foundGist = await findMyTabDeskGist(sync);

    if (foundGist) {
      gistId = foundGist.id;
    } else {
      isNewGist = true;
    }
  }

  /** Gist 请求地址。 */
  const url = isNewGist ? "https://api.github.com/gists" : `https://api.github.com/gists/${gistId}`;
  /** Gist 上传响应。 */
  const response = await fetchWithRetry(url, {
    method: isNewGist ? "POST" : "PATCH",
    headers: {
      Authorization: `Bearer ${sync.gistToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json;charset=utf-8"
    },
    body: JSON.stringify({
      description: isNewGist ? "MyTabDesk Sync" : undefined,
      public: false,
      files: {
        [filename]: {
          content: payload
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`GitHub Gist 上传失败：${response.status}`);
  }

  /** Gist 响应数据。 */
  const result = await response.json();
  return result.id || gistId;
}

/**
 * 自动查找当前 Token 下已有的 MyTabDesk 同步 Gist。
 *
 * @param {object} sync 同步配置。
 * @returns {Promise<object|null>} 找到的 Gist 摘要对象，未找到时返回 null。
 */
async function findMyTabDeskGist(sync) {
  /** Gist 列表请求地址。 */
  const url = "https://api.github.com/gists?per_page=100";
  /** Gist 列表响应。 */
  const response = await fetchWithRetry(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${sync.gistToken}`,
      Accept: "application/vnd.github+json"
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub Gist 列表获取失败：${response.status}`);
  }

  /** Gist 列表数据。 */
  const gists = await response.json();
  /** 同步文件名。 */
  const filename = sync.gistFilename || "mytabdesk-sync.json";

  for (const gist of gists) {
    if (isMyTabDeskGist(gist, filename)) {
      return gist;
    }
  }

  return null;
}

/**
 * 从 GitHub Gist 下载备份文本。
 *
 * @param {object} sync 同步配置。
 * @returns {Promise<string>} 下载得到的备份文本。
 * @throws {Error} 当服务端返回失败状态时抛出错误。
 */
async function downloadGist(sync) {
  /** 最终使用的 Gist ID。 */
  let gistId = sync.gistId;

  if (!gistId) {
    /** 自动查找到的 MyTabDesk Gist。 */
    const foundGist = await findMyTabDeskGist(sync);

    if (!foundGist) {
      throw new Error("未找到指定同步文件，请先上传一次自动创建 Gist。");
    }

    gistId = foundGist.id;
  }

  /** Gist 下载响应。 */
  const response = await fetchWithRetry(`https://api.github.com/gists/${gistId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${sync.gistToken}`,
      Accept: "application/vnd.github+json"
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub Gist 下载失败：${response.status}`);
  }

  /** Gist 响应数据。 */
  const result = await response.json();
  /** Gist 文件名。 */
  const filename = sync.gistFilename || "mytabdesk-sync.json";
  /** 目标 Gist 文件。 */
  const file = result.files && result.files[filename] ? result.files[filename] : null;

  if (!file || typeof file.content !== "string") {
    throw new Error("Gist 中未找到指定同步文件。");
  }

  return file.content;
}

/**
 * 手动上传当前数据到云端。
 *
 * @param {string} provider 同步服务商。
 * @returns {Promise<void>} 上传完成后结束。
 */
async function uploadManualSync(provider) {
  try {
    selectSyncProvider(provider);
    await saveSyncSettingsFromForm();
    /** 当前同步配置。 */
    const sync = state.data.settings.sync;
    validateSyncProviderSettings(sync, provider);
    /** 同步备份文本。 */
    const payload = createSyncPayload();

    if (provider === "webdav") {
      await uploadWebDav(sync, payload);
    } else {
      /** 上传后返回的 Gist ID。 */
      const gistId = await uploadGist(sync, payload);
      state.data.settings.sync.gistId = gistId;
      elements.gistIdInput.value = gistId;
    }

    state.data.settings.sync.lastSyncAt = getCurrentTime();
    state.data.settings.sync.lastBackupAt = state.data.settings.sync.lastSyncAt;
    state.data.settings.sync.autoSyncPendingAt = 0;
    state.data.settings.sync.lastAutoSyncAt = state.data.settings.sync.lastSyncAt;
    state.data.settings.sync.lastAutoSyncError = "";
    await saveData({ skipAutoSync: true });
    root.MyTabDeskRender.renderSettingsStatus();
    await showAlert("已上传到云端。");
    if (notifications.notifySuccess) {
      notifications.notifySuccess("上传成功", "数据已同步到云端");
    }
  } catch (error) {
    if (notifications.notifyError) {
      notifications.notifyError("上传失败", error.message || "同步到云端失败");
    }
    await showAlert(error.message || "上传到云端失败。");
  }
}

/**
 * 从云端下载数据并导入本地。
 *
 * @param {string} provider 同步服务商。
 * @returns {Promise<void>} 下载导入完成后结束。
 */
async function downloadManualSync(provider) {
  try {
    selectSyncProvider(provider);
    await saveSyncSettingsFromForm();
    /** 当前同步配置。 */
    const sync = state.data.settings.sync;
    validateSyncProviderSettings(sync, provider);

    /** 从云端下载的远端数据。 */
    const remoteData = await downloadRemoteSyncData(sync, provider);

    if (!remoteData) {
      await showAlert("云端没有找到同步数据。");
      return;
    }

    /** 远程覆盖本地前的确认结果。 */
    const confirmed = await showConfirm("将使用云端数据覆盖当前本地工作台，当前本地数据会被替换。是否继续？", "远程覆盖本地");

    if (!confirmed) {
      return;
    }

    await applyRemoteDataToLocal(remoteData);
    if (notifications.notifySuccess) {
      notifications.notifySuccess("下载成功", "已用云端数据覆盖本地");
    }
    await showAlert("已用云端数据覆盖本地。");
  } catch (error) {
    if (notifications.notifyError) {
      notifications.notifyError("下载失败", error.message || "从云端下载失败");
    }
    await showAlert(error.message || "从云端下载失败。");
  }
}

/**
 * 将远端数据覆盖导入本地，并保留本地同步配置。
 *
 * @param {object} remoteData 远端工作台数据。
 * @returns {Promise<void>} 导入保存完成后结束。
 */
async function applyRemoteDataToLocal(remoteData) {
  /** 本地同步配置副本，用于在覆盖后保留连接信息。 */
  const localSyncSettings = { ...state.data.settings.sync };
  /** 当前时间戳。 */
  const now = getCurrentTime();

  state.data = ensureSyncSettings(remoteData, localSyncSettings.deviceId);
  state.data.settings.sync = {
    ...localSyncSettings,
    lastImportAt: now,
    lastSyncAt: now
  };
  state.lastWorkspaceSnapshot = createWorkspaceSnapshot();
  state.viewMode = "workspace";

  await saveData({ skipAutoSync: true });
  root.MyTabDeskRender.renderAll();
}

/**
 * 从 WebDAV 历史备份文本中解析工作台数据。
 *
 * @param {string} payload WebDAV 历史备份文本。
 * @returns {object} 解析后的工作台数据。
 */
function importWebDavHistoryPayload(payload) {
  /** 解析后的历史备份对象。 */
  const backup = JSON.parse(payload);

  if (!backup || backup.backupType !== "webdav-daily-history" || !backup.data) {
    throw new Error("不是有效的 WebDAV 历史备份文件。");
  }

  return ensureSyncSettings(importData(JSON.stringify(backup.data)));
}

/**
 * 渲染 WebDAV 历史备份列表。
 *
 * @param {object[]} backups 历史备份条目列表。
 * @returns {void}
 */
function renderWebDavHistoryList(backups) {
  if (!elements.webdavHistoryList) {
    return;
  }

  elements.webdavHistoryList.replaceChildren();

  if (!backups.length) {
    /** 空状态元素。 */
    const empty = document.createElement("div");
    empty.className = "webdav-history-empty";
    empty.textContent = "暂无历史备份。";
    elements.webdavHistoryList.append(empty);
    return;
  }

  /** 历史备份文档片段。 */
  const fragment = document.createDocumentFragment();

  backups.forEach((backup) => {
    /** 历史备份行元素。 */
    const item = document.createElement("div");
    /** 历史备份信息元素。 */
    const info = document.createElement("div");
    /** 历史备份日期元素。 */
    const date = document.createElement("strong");
    /** 历史备份添加时间元素。 */
    const time = document.createElement("span");
    /** 历史备份恢复按钮。 */
    const restoreButton = document.createElement("button");

    item.className = "webdav-history-item";
    info.className = "webdav-history-info";
    date.textContent = backup.backupDate;
    time.textContent = `添加时间：${backup.createdAtText}`;
    restoreButton.className = "secondary-button webdav-history-restore-button";
    restoreButton.type = "button";
    restoreButton.textContent = "恢复";
    restoreButton.addEventListener("click", () => restoreWebDavHistoryBackup(backup));

    info.append(date, time);
    item.append(info, restoreButton);
    fragment.append(item);
  });

  elements.webdavHistoryList.append(fragment);
}

/**
 * 加载 WebDAV 历史备份列表。
 *
 * @returns {Promise<void>} 加载完成后结束。
 */
async function loadWebDavHistoryBackups() {
  try {
    await saveSyncSettingsFromForm();
    /** 当前同步配置。 */
    const sync = state.data.settings.sync;
    validateSyncProviderSettings(sync, "webdav");

    if (elements.webdavHistoryList) {
      elements.webdavHistoryList.textContent = "正在加载历史备份...";
    }

    /** 历史备份列表。 */
    const backups = await listWebDavHistoryBackups(sync);
    renderWebDavHistoryList(backups);
  } catch (error) {
    if (elements.webdavHistoryList) {
      elements.webdavHistoryList.textContent = error.message || "历史备份加载失败。";
    }
    if (notifications.notifyError) {
      notifications.notifyError("历史备份加载失败", error.message || "请检查 WebDAV 配置");
    }
  }
}

/**
 * 恢复指定 WebDAV 历史备份。
 *
 * @param {object} backup 历史备份条目。
 * @returns {Promise<void>} 恢复完成后结束。
 */
async function restoreWebDavHistoryBackup(backup) {
  /** 是否确认恢复。 */
  const confirmed = await showConfirm(`将使用 ${backup.backupDate} 的历史备份覆盖本地数据，当前本地数据不会自动上传。是否继续？`, "恢复历史备份");

  if (!confirmed) {
    return;
  }

  try {
    await saveSyncSettingsFromForm();
    /** 当前同步配置。 */
    const sync = state.data.settings.sync;
    /** 历史备份文本。 */
    const payload = await getWebDavText(sync, backup.url);

    if (!payload) {
      await showAlert("该历史备份文件不存在，可能已被清理。");
      await loadWebDavHistoryBackups();
      return;
    }

    /** 历史备份中的远端数据。 */
    const remoteData = importWebDavHistoryPayload(payload);

    await applyRemoteDataToLocal(remoteData);
    await showAlert(`已恢复 ${backup.backupDate} 的 WebDAV 历史备份。`);
    if (notifications.notifySuccess) {
      notifications.notifySuccess("恢复成功", `已恢复 ${backup.backupDate} 的历史备份`);
    }
  } catch (error) {
    if (notifications.notifyError) {
      notifications.notifyError("恢复失败", error.message || "WebDAV 历史备份恢复失败");
    }
    await showAlert(error.message || "WebDAV 历史备份恢复失败。");
  }
}

root.MyTabDeskSync = {
  readSyncSettingsForm,
  saveSyncSettingsFromForm,
  selectSyncProvider,
  handleSaveSyncSettings,
  createSyncPayload,
  uploadAutoSync,
  downloadRemoteSyncData,
  markSyncCompleted,
  runBidirectionalSync,
  runAutoSyncNow,
  scheduleAutoSync,
  validateSyncProviderSettings,
  validateSyncSettings,
  fetchWithTimeout,
  fetchWithRetry,
  isMissingWebDavResponse,
  createWebDavHeaders,
  putWebDavText,
  getWebDavText,
  ensureWebDavHistoryDirectory,
  parseWebDavHistoryListXml,
  listWebDavHistoryBackups,
  deleteWebDavHistoryBackup,
  pruneWebDavHistoryBackups,
  createDailyWebDavHistoryBackup,
  uploadWebDav,
  downloadWebDav,
  uploadGist,
  findMyTabDeskGist,
  downloadGist,
  uploadManualSync,
  downloadManualSync,
  applyRemoteDataToLocal,
  importWebDavHistoryPayload,
  renderWebDavHistoryList,
  loadWebDavHistoryBackups,
  restoreWebDavHistoryBackup
};
})(globalThis);
