(function (root) {
const app = root.MyTabDeskPage;
const { state, elements } = app;
const {
  getCurrentTime,
  getEnabledSyncProviders,
  getAutoSyncProviders,
  mergeWorkspaceData,
  exportSyncData,
  importSyncData,
  importData,
  resolveSafeWebDavFileUrl,
  detectImportConflict,
  createEncryptedBackup,
  restoreEncryptedBackup
} = app;
const {
  isAutoSyncEnabled,
  getSyncSettings,
  createWorkspaceSnapshot,
  saveData,
  markSettingsDirty,
  withSyncLock
} = root.MyTabDeskUtils;
const { showAlert, showConfirm } = root.MyTabDeskDialogs;
const notifications = root.MyTabDeskNotifications || {};

/**
 * 同步日志最大保留条数。
 */
const MAX_SYNC_LOG_ENTRIES = 20;

/**
 * 添加一条同步日志到 state.syncLog。
 *
 * @param {object} entry 日志条目，包含 type、provider、spaces、links、error 等字段。
 * @returns {void}
 */
function addSyncLog(entry) {
  if (!state.syncLog) {
    state.syncLog = [];
  }

  state.syncLog.unshift({
    timestamp: getCurrentTime(),
    ...entry
  });

  if (state.syncLog.length > MAX_SYNC_LOG_ENTRIES) {
    state.syncLog.length = MAX_SYNC_LOG_ENTRIES;
  }
}

/**
 * 获取最近的同步日志列表。
 *
 * @returns {Array<object>} 同步日志数组，最近的在前。
 */
function getSyncLog() {
  return state.syncLog || [];
}

/**
 * 统计可见工作台数据，墓碑项不计入用户可见数量。
 *
 * @param {object} data 工作台数据。
 * @returns {{ spaces: number, groups: number, links: number }} 统计结果。
 */
function getWorkspaceStats(data) {
  const spaces = data && Array.isArray(data.spaces) ? data.spaces.filter((space) => !space.deletedAt) : [];
  let groups = 0;
  let links = 0;

  for (const space of spaces) {
    const visibleGroups = Array.isArray(space.groups) ? space.groups.filter((group) => !group.deletedAt) : [];
    groups += visibleGroups.length;

    for (const group of visibleGroups) {
      links += Array.isArray(group.links) ? group.links.filter((link) => !link.deletedAt).length : 0;
    }
  }

  return { spaces: spaces.length, groups, links };
}

/** 带超时和重试的同步网络客户端。 */
const syncNetwork = root.MyTabDeskSyncNetwork.create();
const { isRetryableStatus, fetchWithTimeout, fetchWithRetry } = syncNetwork;

/** WebDAV/Gist 协议传输适配器。 */
const syncTransport = root.MyTabDeskSyncTransport.create({
  fetchWithTimeout,
  fetchWithRetry,
  resolveSafeWebDavFileUrl,
  createBasicAuthHeader: app.createBasicAuthHeader,
  isMyTabDeskGist: app.isMyTabDeskGist
});

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
    gistAutoSyncEnabled: elements.gistAutoSyncSwitch.checked,
    syncEncryptionPassword: elements.syncEncryptionPasswordInput ? elements.syncEncryptionPasswordInput.value : ""
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
  markSettingsDirty();
  // 表单已保存到数据，清除脏标记，允许后续渲染回写表单
  state.settingsFormDirty = false;
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
 * 创建用于云端同步的备份文本。
 *
 * 当用户设置了同步加密密码时，使用 AES-GCM 加密 payload，远端存储密文。
 * 未设置密码时保持明文同步（向后兼容）。
 *
 * @returns {Promise<string>} JSON 备份文本（加密或明文）。
 */
async function createSyncPayload() {
  /** 当前同步配置中的加密密码。 */
  const encryptionPassword = state.data.settings.sync.syncEncryptionPassword;

  if (encryptionPassword) {
    return createEncryptedBackup(state.data, encryptionPassword, state.data.settings.sync.deviceId);
  }

  return exportSyncData(state.data);
}

/**
 * 自动上传本地数据到当前远程服务商。
 *
 * @param {object} sync 当前同步配置。
 * @returns {Promise<void>} 上传完成后结束。
 */
async function uploadAutoSync(sync) {
  /** 自动同步备份文本。 */
  const payload = await createSyncPayload();
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
 * 自动检测远端数据格式：加密格式（encrypted: true）使用同步加密密码解密，
 * 明文格式走标准 importData 路径（向后兼容旧数据）。
 *
 * @param {object} sync 当前同步配置。
 * @param {string} provider 需要下载的同步服务商。
 * @returns {Promise<object|null>} 解析后的远端数据，远端不存在时返回 null。
 */
async function downloadRemoteSyncData(sync, provider) {
  try {
    /** 云端备份文本。 */
    const payload = provider === "webdav" ? await downloadWebDav(sync) : await downloadGist(sync);

    /** 尝试检测是否为加密同步数据。 */
    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch {
      // 非 JSON，走标准导入路径
      return importData(payload);
    }

    if (parsed && parsed.encrypted === true && parsed.payload) {
      /** 同步加密密码。 */
      const encryptionPassword = sync.syncEncryptionPassword;
      if (!encryptionPassword) {
        throw new Error("远端数据已加密，请先在同步设置中填写加密密码。");
      }
      return restoreEncryptedBackup(payload, encryptionPassword);
    }

    if (parsed && parsed.format === "mytabdesk-sync") {
      return importSyncData(payload);
    }

    // 兼容升级前上传的 TabTab 明文同步数据。
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
  // 每次从 state 获取最新 sync 引用，避免 both 模式下第一个 provider 更新 state.data 后
  // 传入的 sync 参数仍指向旧对象，导致第二个 provider 使用过期的 gistId 等字段。
  const currentSync = state.data.settings.sync;
  /** 本地同步配置副本。 */
  const localSync = Object.assign({}, currentSync);
  /** 远端工作台数据。 */
  const remoteData = await downloadRemoteSyncData(currentSync, provider);

  if (remoteData) {
    state.data = mergeWorkspaceData(state.data, remoteData, localSync.deviceId);
    // 保留 localSync 中的原始 provider（可能是 both），不覆盖成当前循环的单个 provider，
    // 避免 both 模式下循环处理第二个服务商时丢失 both 状态。
    Object.assign(state.data.settings.sync, localSync);
  }

  if (provider === "webdav") {
    await uploadWebDav(state.data.settings.sync, await createSyncPayload());
  } else {
    /** 上传后返回的 Gist ID。 */
    const gistId = await uploadGist(state.data.settings.sync, await createSyncPayload());
    state.data.settings.sync.gistId = gistId;

    if (elements.gistIdInput) {
      elements.gistIdInput.value = gistId;
    }
  }

  state.lastWorkspaceSnapshot = createWorkspaceSnapshot();

  /** 合并统计用于日志。 */
  const mergedStats = getWorkspaceStats(state.data);

  addSyncLog({
    type: "auto",
    provider,
    merged: Boolean(remoteData),
    spaces: mergedStats.spaces,
    links: mergedStats.links
  });

  await saveData({ skipAutoSync: true });
}

/**
 * 立即执行一次待处理自动同步。
 * 实际同步逻辑通过 withSyncLock 串行化，避免与手动同步入口并发。
 *
 * @returns {Promise<void>} 同步尝试完成后结束。
 */
function runAutoSyncNow() {
  /** 当前同步配置。 */
  const sync = getSyncSettings();
  /** 实际开启自动同步的服务商列表。 */
  const providers = getAutoSyncProviders(sync);

  // 前置守卫放在锁外，无待同步任务时直接返回，避免无谓排队
  if (providers.length === 0 || !sync.autoSyncPendingAt) {
    return Promise.resolve();
  }

  return withSyncLock(async () => {
    try {
      for (const provider of providers) {
        validateSyncProviderSettings(state.data.settings.sync, provider);
        await runBidirectionalSync(state.data.settings.sync, provider);
      }

      // 只有全部启用的自动同步服务商都成功后，才清除全局 pending。
      markSyncCompleted(state.data.settings.sync, getCurrentTime());
      await saveData({ skipAutoSync: true });
    } catch (error) {
      // 合并可能替换 state.data，必须写入当前引用并保留 pending 供后续补传。
      state.data.settings.sync.lastAutoSyncError = error.message || "自动同步失败";
      await saveData({ skipAutoSync: true });
    } finally {
      root.MyTabDeskRender.renderSettingsStatus();
    }
  });
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
    const runner = root.MyTabDeskNotifications && root.MyTabDeskNotifications.runLeasedAutoSync
      ? root.MyTabDeskNotifications.runLeasedAutoSync()
      : runAutoSyncNow();
    Promise.resolve(runner).catch((error) => {
      console.error("自动同步调度失败：", error);
    });
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
 * 上传备份文本到 WebDAV。
 *
 * @param {object} sync 同步配置。
 * @param {string} payload 待上传的备份文本。
 * @returns {Promise<void>} 上传完成后结束。
 * @throws {Error} 当服务端返回失败状态时抛出错误。
 */
async function uploadWebDav(sync, payload) {
  return syncTransport.uploadWebDav(sync, payload);
}

/**
 * 从 WebDAV 下载备份文本。
 *
 * @param {object} sync 同步配置。
 * @returns {Promise<string>} 下载得到的备份文本。
 * @throws {Error} 当服务端返回失败状态时抛出错误。
 */
async function downloadWebDav(sync) {
  return syncTransport.downloadWebDav(sync);
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
  return syncTransport.uploadGist(sync, payload);
}

/**
 * 自动查找当前 Token 下已有的 MyTabDesk 同步 Gist。
 * 通过响应 Link 头翻页，避免用户 Gist 超过 100 个时遗漏同步 Gist 而重复创建。
 *
 * @param {object} sync 同步配置。
 * @returns {Promise<object|null>} 找到的 Gist 摘要对象，未找到时返回 null。
 */
async function findMyTabDeskGist(sync) {
  return syncTransport.findMyTabDeskGist(sync);
}


/**
 * 从 GitHub Gist 下载备份文本。
 *
 * @param {object} sync 同步配置。
 * @returns {Promise<string>} 下载得到的备份文本。
 * @throws {Error} 当服务端返回失败状态时抛出错误。
 */
async function downloadGist(sync) {
  return syncTransport.downloadGist(sync);
}

/**
 * 获取指定服务商对应的上传/下载按钮元素。
 *
 * @param {string} provider 同步服务商。
 * @param {"upload"|"download"} action 操作类型。
 * @returns {HTMLElement|null} 按钮元素。
 */
function getSyncButton(provider, action) {
  if (provider === "webdav") {
    return action === "upload" ? elements.webdavUploadSyncBtn : elements.webdavDownloadSyncBtn;
  }
  return action === "upload" ? elements.gistUploadSyncBtn : elements.gistDownloadSyncBtn;
}

/**
 * 包裹同步操作，在执行期间禁用按钮并显示“同步中…”状态，结束后恢复。
 *
 * @param {HTMLElement} btn 触发操作的按钮。
 * @param {Function} asyncFn 实际执行的异步操作。
 * @returns {Promise<void>} 操作完成后结束。
 */
async function withSyncButtonLoading(btn, asyncFn) {
  if (!btn) {
    return asyncFn();
  }

  /** 按钮原始文案，用于结束后恢复。 */
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "同步中…";

  try {
    await asyncFn();
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

/**
 * 手动上传当前数据到云端。
 * 通过 withSyncLock 串行化，避免与自动同步或其它手动操作并发。
 *
 * @param {string} provider 同步服务商。
 * @returns {Promise<void>} 上传完成后结束。
 */
async function uploadManualSync(provider) {
  return withSyncButtonLoading(getSyncButton(provider, "upload"), async () => withSyncLock(async () => {
    try {
      selectSyncProvider(provider);
      await saveSyncSettingsFromForm();
      /** 当前同步配置。 */
      const sync = state.data.settings.sync;
      validateSyncProviderSettings(sync, provider);
      /** 同步备份文本。 */
      const payload = await createSyncPayload();

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

      const uploadStats = getWorkspaceStats(state.data);
      addSyncLog({
        type: "manual-upload",
        provider,
        spaces: uploadStats.spaces,
        links: uploadStats.links
      });

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
      await showAlert(error.message || "上传到云端失败。", "上传失败", {
        actionText: "重试",
        onAction: () => {
          uploadManualSync(provider);
        }
      });
    }
  }));
}

/**
 * 从云端下载数据并合并到本地。
 * 通过 withSyncLock 串行化，避免下载合并 state.data 时与其它同步操作竞争。
 *
 * 与自动同步 runBidirectionalSync 保持一致，采用 mergeWorkspaceData 合并策略，
 * 而非直接覆盖本地数据。冲突检测提示保留作为额外安全层。
 *
 * @param {string} provider 同步服务商。
 * @returns {Promise<void>} 下载合并完成后结束。
 */
async function downloadManualSync(provider) {
  return withSyncButtonLoading(getSyncButton(provider, "download"), async () => withSyncLock(async () => {
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

      /** 冲突检测：本地比远端新或来自不同设备时，提示用户确认。 */
      const conflict = detectImportConflict(state.data, remoteData);
      if (conflict.requiresConfirm) {
        /** 冲突提示文案。 */
        const conflictMessage = conflict.isOlder
          ? "云端数据比本地旧，合并后本地较新的修改会保留。继续合并吗？"
          : "即将与另一台设备的数据合并，两端的修改都会保留。继续吗？";
        const confirmed = await showConfirm(conflictMessage);
        if (!confirmed) {
          return;
        }
      }

      /** 本地同步配置副本，用于在合并后保留连接信息。 */
      const localSyncSettings = { ...state.data.settings.sync };
      /** 合并前本地空间/分组/链接统计，用于同步日志。 */
      const localStats = getWorkspaceStats(state.data);

      state.data = mergeWorkspaceData(state.data, remoteData, localSyncSettings.deviceId);
      state.data.settings.sync = {
        ...localSyncSettings,
        lastImportAt: getCurrentTime(),
        lastSyncAt: getCurrentTime()
      };
      state.lastWorkspaceSnapshot = createWorkspaceSnapshot();
      state.viewMode = "workspace";

      /** 合并后空间/链接统计。 */
      const mergedStats = getWorkspaceStats(state.data);

      addSyncLog({
        type: "manual-download",
        provider,
        spaces: { before: localStats.spaces, after: mergedStats.spaces },
        links: { before: localStats.links, after: mergedStats.links }
      });

      await saveData({ skipAutoSync: true });
      root.MyTabDeskRender.renderAll();
      if (notifications.notifySuccess) {
        notifications.notifySuccess("下载成功", "已合并云端数据到本地");
      }
      await showAlert("已合并云端数据到本地。");
    } catch (error) {
      if (notifications.notifyError) {
        notifications.notifyError("下载失败", error.message || "从云端下载失败");
      }
      await showAlert(error.message || "从云端下载失败。", "下载失败", {
        actionText: "重试",
        onAction: () => {
          downloadManualSync(provider);
        }
      });
    }
  }));
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
  isRetryableStatus,
  uploadWebDav,
  downloadWebDav,
  uploadGist,
  findMyTabDeskGist,
  downloadGist,
  uploadManualSync,
  downloadManualSync,
  addSyncLog,
  getSyncLog,
  getWorkspaceStats
};
})(globalThis);
