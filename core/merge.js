/**
 * MyTabDesk 核心模块：MyTabDeskCoreMerge
 * 由 tabdesk-core.js 拆分而来，保持 Node（require）与浏览器（全局命名空间）双环境兼容。
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./normalize.js"), require("./sync-settings.js"));
  } else {
    root.MyTabDeskCoreMerge = factory(root.MyTabDeskCoreNormalize, root.MyTabDeskCoreSyncSettings);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (normalize, syncSettings) {
  const { createDefaultData, normalizeLink, normalizeGroup, normalizeSpace } = normalize;
  const { ensureSyncSettings } = syncSettings;

/**
 * 获取业务对象的有效版本时间戳。
 * 删除时间也参与版本比较，确保墓碑不会被更旧的活动对象覆盖。
 *
 * @param {object} item 业务对象。
 * @returns {number} 有效更新时间戳。
 */
function getEffectiveUpdatedAt(item) {
  if (!item) {
    return 0;
  }
  // createdAt 可能由旧数据迁移时补齐，不能参与跨设备版本竞争。
  return Math.max(item.updatedAt || 0, item.deletedAt || 0, item.purgedAt || 0);
}

/**
 * 比较两个业务对象的更新时间并返回更新的一方。
 *
 * @param {object} localItem 本地业务对象。
 * @param {object} remoteItem 远端业务对象。
 * @returns {object} 更新时间较新的业务对象。
 */
function pickNewerItem(localItem, remoteItem) {
  /** 本地业务对象更新时间。 */
  const localUpdatedAt = getEffectiveUpdatedAt(localItem);
  /** 远端业务对象更新时间。 */
  const remoteUpdatedAt = getEffectiveUpdatedAt(remoteItem);

  return remoteUpdatedAt > localUpdatedAt ? remoteItem : localItem;
}

/**
 * 合并两个链接列表，按 ID 和 URL 去重并优先保留较新的链接。
 *
 * 排序策略：order 是各端分组内的本地数组下标，跨端不可比，因此不能直接按 order 排序。
 * 这里采用「本地顺序优先，远端独有链接追加到末尾」：先按本地顺序保留链接，再把仅远端
 * 存在的链接按远端顺序接在后面，最后按下标重新分配连续 order，保证两端顺序都不被交叉打散。
 *
 * @param {Array<object>} localLinks 本地链接列表。
 * @param {Array<object>} remoteLinks 远端链接列表。
 * @returns {Array<object>} 自动合并后的链接列表。
 */
function mergeLinks(localLinks, remoteLinks) {
  /** 标准化后的本地链接列表。 */
  const normalizedLocalLinks = (Array.isArray(localLinks) ? localLinks : []).map(normalizeLink);
  /** 标准化后的远端链接列表。 */
  const normalizedRemoteLinks = (Array.isArray(remoteLinks) ? remoteLinks : []).map(normalizeLink);
  /** 合并后的链接列表。 */
  const mergedLinks = [];
  /** 链接 ID → mergedLinks 数组索引的映射，O(1) 查找。 */
  const linkIndexById = new Map();
  /** 链接 URL → mergedLinks 数组索引的映射，O(1) 查找。 */
  const linkIndexByUrl = new Map();

  /**
   * 替换指定索引的链接，并同步刷新 ID/URL 索引。
   *
   * @param {number} index 链接索引。
   * @param {object} link 替换后的链接。
   * @returns {void}
   */
  const replaceMergedLink = (index, link) => {
    const previous = mergedLinks[index];
    if (previous && linkIndexById.get(previous.id) === index) {
      linkIndexById.delete(previous.id);
    }
    if (previous && linkIndexByUrl.get(previous.url) === index) {
      linkIndexByUrl.delete(previous.url);
    }

    mergedLinks[index] = link;
    linkIndexById.set(link.id, index);
    linkIndexByUrl.set(link.url, index);
  };


  /**
   * 尝试把链接加入合并结果，按 ID 和 URL 去重，冲突时保留较新的一方。

   *
   * @param {object} link 待加入的链接。
   * @param {boolean} allowAppend 是否允许追加到末尾（远端独有链接才追加）。
   * @returns {void}
   */
  const addLink = (link, allowAppend) => {

    /** 同 ID 的已合并链接索引。 */
    const existingIndexById = linkIndexById.get(link.id);

    if (existingIndexById !== undefined) {
      replaceMergedLink(existingIndexById, pickNewerItem(mergedLinks[existingIndexById], link));
      return;
    }

    /** 同 URL 的已合并链接索引。 */
    const existingIndexByUrl = linkIndexByUrl.get(link.url);

    if (existingIndexByUrl !== undefined) {
      replaceMergedLink(existingIndexByUrl, pickNewerItem(mergedLinks[existingIndexByUrl], link));
      return;
    }

    if (!allowAppend) {
      return;
    }

    /** 新链接在 mergedLinks 中的索引。 */
    const newIndex = mergedLinks.length;
    mergedLinks.push(link);
    linkIndexById.set(link.id, newIndex);
    linkIndexByUrl.set(link.url, newIndex);
  };


  // 先按本地顺序合并本地链接，保留用户在本地的拖拽顺序
  for (const link of normalizedLocalLinks) {
    if (!link.url) {
      continue;
    }
    addLink(link, true);
  }

  // 再按远端顺序补充仅远端独有的链接，追加到末尾
  for (const link of normalizedRemoteLinks) {
    if (!link.url) {
      continue;
    }
    addLink(link, !linkIndexById.has(link.id) && !linkIndexByUrl.has(link.url));
  }

  // 合并后按下标重新分配连续 order，避免两端 order 交叉错乱
  mergedLinks.forEach((link, index) => {
    link.order = index;
  });

  return mergedLinks;
}

/**
 * 合并同一个分组，保留两端链接并按较新元信息更新分组属性。
 *
 * @param {object} localGroup 本地分组。
 * @param {object} remoteGroup 远端分组。
 * @returns {object} 自动合并后的分组。
 */
function mergeGroup(localGroup, remoteGroup) {
  /** 较新的分组元信息。 */
  const newerGroup = pickNewerItem(localGroup, remoteGroup);
  /** 本地分组链接列表。 */
  const localLinks = localGroup && Array.isArray(localGroup.links) ? localGroup.links : [];
  /** 远端分组链接列表。 */
  const remoteLinks = remoteGroup && Array.isArray(remoteGroup.links) ? remoteGroup.links : [];
  /** 自动合并后的分组。 */
  const mergedGroup = normalizeGroup({
    ...newerGroup,
    links: mergeLinks(localLinks, remoteLinks)
  });

  mergedGroup.updatedAt = Math.max(localGroup && localGroup.updatedAt ? localGroup.updatedAt : 0, remoteGroup && remoteGroup.updatedAt ? remoteGroup.updatedAt : 0, mergedGroup.updatedAt || 0);
  return mergedGroup;
}

/**
 * 合并两个分组列表，按 ID 合并并保留两端独有分组。
 *
 * @param {Array<object>} localGroups 本地分组列表。
 * @param {Array<object>} remoteGroups 远端分组列表。
 * @returns {Array<object>} 自动合并后的分组列表。
 */
function mergeGroups(localGroups, remoteGroups) {
  /** 分组 ID 的有序列表。 */
  const groupIds = [];
  /** 已收集的分组 ID 集合，用于 O(1) 去重。 */
  const seenGroupIds = new Set();
  /** 本地分组映射。 */
  const localGroupById = new Map();
  /** 远端分组映射。 */
  const remoteGroupById = new Map();
  /** 收集分组 ID 的内部函数。 */
  const collectGroup = (group, targetMap) => {
    if (!group || !group.id) {
      return;
    }

    targetMap.set(group.id, group);

    if (!seenGroupIds.has(group.id)) {
      seenGroupIds.add(group.id);
      groupIds.push(group.id);
    }
  };

  for (const group of Array.isArray(localGroups) ? localGroups : []) {
    collectGroup(group, localGroupById);
  }

  for (const group of Array.isArray(remoteGroups) ? remoteGroups : []) {
    collectGroup(group, remoteGroupById);
  }

  return groupIds.map((groupId) => {
    const localGroup = localGroupById.get(groupId);
    const remoteGroup = remoteGroupById.get(groupId);
    const newerGroup = pickNewerItem(localGroup, remoteGroup);

    if (newerGroup && newerGroup.deletedAt) {
      return normalizeGroup(newerGroup);
    }

    return mergeGroup(localGroup, remoteGroup);
  });
}

/**
 * 合并同一个空间，保留两端分组并按较新元信息更新空间属性。
 *
 * @param {object} localSpace 本地空间。
 * @param {object} remoteSpace 远端空间。
 * @returns {object} 自动合并后的空间。
 */
function mergeSpace(localSpace, remoteSpace) {
  /** 较新的空间元信息。 */
  const newerSpace = pickNewerItem(localSpace, remoteSpace);
  /** 本地空间分组列表。 */
  const localGroups = localSpace && Array.isArray(localSpace.groups) ? localSpace.groups : [];
  /** 远端空间分组列表。 */
  const remoteGroups = remoteSpace && Array.isArray(remoteSpace.groups) ? remoteSpace.groups : [];
  /** 自动合并后的空间。 */
  const mergedSpace = normalizeSpace({
    ...newerSpace,
    groups: mergeGroups(localGroups, remoteGroups)
  });

  mergedSpace.updatedAt = Math.max(localSpace && localSpace.updatedAt ? localSpace.updatedAt : 0, remoteSpace && remoteSpace.updatedAt ? remoteSpace.updatedAt : 0, mergedSpace.updatedAt || 0);
  return mergedSpace;
}

/**
 * 合并两个空间列表，按 ID 合并并保留两端独有空间。
 *
 * @param {Array<object>} localSpaces 本地空间列表。
 * @param {Array<object>} remoteSpaces 远端空间列表。
 * @returns {Array<object>} 自动合并后的空间列表。
 */
function mergeSpaces(localSpaces, remoteSpaces) {
  /** 空间 ID 的有序列表。 */
  const spaceIds = [];
  /** 已收集的空间 ID 集合，用于 O(1) 去重。 */
  const seenSpaceIds = new Set();
  /** 本地空间映射。 */
  const localSpaceById = new Map();
  /** 远端空间映射。 */
  const remoteSpaceById = new Map();
  /** 收集空间 ID 的内部函数。 */
  const collectSpace = (space, targetMap) => {
    if (!space || !space.id) {
      return;
    }

    targetMap.set(space.id, space);

    if (!seenSpaceIds.has(space.id)) {
      seenSpaceIds.add(space.id);
      spaceIds.push(space.id);
    }
  };

  for (const space of Array.isArray(localSpaces) ? localSpaces : []) {
    collectSpace(space, localSpaceById);
  }

  for (const space of Array.isArray(remoteSpaces) ? remoteSpaces : []) {
    collectSpace(space, remoteSpaceById);
  }

  return spaceIds.map((spaceId) => {
    const localSpace = localSpaceById.get(spaceId);
    const remoteSpace = remoteSpaceById.get(spaceId);
    const newerSpace = pickNewerItem(localSpace, remoteSpace);

    if (newerSpace && newerSpace.deletedAt) {
      return normalizeSpace(newerSpace);
    }

    return mergeSpace(localSpace, remoteSpace);
  });
}

/**
 * 自动合并本地和远端工作台数据，优先保留两端数据避免同步丢失。
 *
 * @param {object} localData 本地当前全量数据。
 * @param {object} remoteData 远端当前全量数据。
 * @param {string} deviceId 当前设备 ID。
 * @returns {object} 自动合并后的全量数据。
 */
function mergeWorkspaceData(localData, remoteData, deviceId) {
  /** 标准化后的本地数据。 */
  const normalizedLocalData = ensureSyncSettings(localData, deviceId);
  /** 标准化后的远端数据。 */
  const normalizedRemoteData = ensureSyncSettings(remoteData, normalizedLocalData.settings.sync.deviceId);
  /** 自动合并后的空间列表。 */
  const spaces = mergeSpaces(normalizedLocalData.spaces, normalizedRemoteData.spaces);
  /** 合并后未被删除的空间列表。 */
  const liveSpaces = spaces.filter((space) => !space.deletedAt);

  if (liveSpaces.length === 0) {
    return ensureSyncSettings(createDefaultData(), normalizedLocalData.settings.sync.deviceId);
  }

  /** 合并后仍然存在的当前激活空间 ID。 */
  const activeSpaceId = liveSpaces.some((space) => space.id === normalizedLocalData.activeSpaceId) ? normalizedLocalData.activeSpaceId : liveSpaces[0].id;
  /** 合并后的全量数据。 */
  const newerSettings = (normalizedRemoteData.settings.updatedAt || 0) > (normalizedLocalData.settings.updatedAt || 0)
    ? normalizedRemoteData.settings
    : normalizedLocalData.settings;
  /** 同步运行状态使用独立版本，不能被同 settings 版本的旧页面覆盖。 */
  const newerSyncState = (normalizedRemoteData.settings.sync.stateUpdatedAt || 0) > (normalizedLocalData.settings.sync.stateUpdatedAt || 0)
    ? normalizedRemoteData.settings.sync
    : normalizedLocalData.settings.sync;
  const mergedData = ensureSyncSettings({
    version: Math.max(normalizedLocalData.version || 1, normalizedRemoteData.version || 1),
    activeSpaceId,
    spaces,
    settings: newerSettings
  }, normalizedLocalData.settings.sync.deviceId);

  mergedData.settings.sync = {
    ...newerSettings.sync,
    stateUpdatedAt: newerSyncState.stateUpdatedAt,
    gistId: newerSyncState.gistId,
    autoSyncPendingAt: newerSyncState.autoSyncPendingAt,
    lastAutoSyncAt: newerSyncState.lastAutoSyncAt,
    lastAutoSyncError: newerSyncState.lastAutoSyncError,
    lastSyncAt: newerSyncState.lastSyncAt,
    lastBackupAt: newerSyncState.lastBackupAt,
    lastImportAt: newerSyncState.lastImportAt,
    // 当前设备身份不跟随其它页面/远端设置变化。
    deviceId: normalizedLocalData.settings.sync.deviceId
  };
  return mergedData;
}

/**
 * 合并本地和远程会话快照，取并集后按 createdAt 降序排列，再裁剪到上限和保留期。
 *
 * @param {Array<object>} localSnapshots 本地快照列表。
 * @param {Array<object>} remoteSnapshots 远程快照列表。
 * @param {{limit:number,retentionMs:number}} options 合并选项。
 * @returns {Array<object>} 合并后的快照列表。
 */
function mergeSessionSnapshots(localSnapshots, remoteSnapshots, options) {
  const limit = options && Number.isInteger(options.limit) ? options.limit : 50;
  const retentionMs = options && Number.isInteger(options.retentionMs) ? options.retentionMs : 30 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - retentionMs;
  const seen = new Map();

  for (const snapshot of [...(localSnapshots || []), ...(remoteSnapshots || [])]) {
    if (!snapshot || !snapshot.id || !Number.isFinite(snapshot.createdAt)) continue;
    if (!seen.has(snapshot.id)) seen.set(snapshot.id, snapshot);
  }

  return Array.from(seen.values())
    .filter((s) => s.createdAt >= cutoff)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

  return {
    getEffectiveUpdatedAt,

    pickNewerItem,
  mergeLinks,
  mergeGroup,
  mergeGroups,
  mergeSpace,
  mergeSpaces,
  mergeWorkspaceData,
  mergeSessionSnapshots
  };
});
