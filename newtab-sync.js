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
  createBasicAuthHeader
} = app;
const {
  isAutoSyncEnabled,
  getSyncSettings,
  createWorkspaceSnapshot,
  saveData
} = root.MyTabDeskUtils;
const { showAlert } = root.MyTabDeskDialogs;

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
    Object.assign(state.data.settings.sync, localSync, {
      provider
    });
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

  if (state.autoSyncRunning || !isAutoSyncEnabled(sync) || !sync.autoSyncPendingAt) {
    return;
  }

  state.autoSyncRunning = true;

  try {
    validateSyncSettings();
    await runBidirectionalSync(sync);
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
    runAutoSyncNow();
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
  /** WebDAV 上传响应。 */
  const response = await fetchWithTimeout(fileUrl, {
    method: "PUT",
    headers: {
      Authorization: createBasicAuthHeader(sync.webdavUsername, sync.webdavPassword),
      "Content-Type": "application/json;charset=utf-8"
    },
    body: payload
  });

  if (!response.ok) {
    throw new Error(`WebDAV 上传失败：${response.status}`);
  }
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
  /** WebDAV 下载响应。 */
  const response = await fetchWithTimeout(fileUrl, {
    method: "GET",
    headers: {
      Authorization: createBasicAuthHeader(sync.webdavUsername, sync.webdavPassword)
    }
  });

  if (!response.ok) {
    throw new Error(`WebDAV 下载失败：${response.status}`);
  }

  return response.text();
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
  const response = await fetchWithTimeout(url, {
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
  const response = await fetchWithTimeout(url, {
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
  const response = await fetchWithTimeout(`https://api.github.com/gists/${gistId}`, {
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
  } catch (error) {
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

    /** 本地同步配置副本，用于在覆盖后保留连接信息。 */
    const localSyncSettings = { ...state.data.settings.sync };
    state.data = ensureSyncSettings(remoteData, localSyncSettings.deviceId);
    state.data.settings.sync = {
      ...localSyncSettings,
      lastImportAt: getCurrentTime(),
      lastSyncAt: getCurrentTime()
    };
    state.lastWorkspaceSnapshot = createWorkspaceSnapshot();
    state.viewMode = "workspace";

    await saveData({ skipAutoSync: true });
    root.MyTabDeskRender.renderAll();
    await showAlert("已用云端数据覆盖本地。");
  } catch (error) {
    await showAlert(error.message || "从云端下载失败。");
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
  uploadWebDav,
  downloadWebDav,
  uploadGist,
  findMyTabDeskGist,
  downloadGist,
  uploadManualSync,
  downloadManualSync
};
})(globalThis);
