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
  const { normalizeLink, normalizeGroup, normalizeSpace } = normalize;
  const { ensureSyncSettings } = syncSettings;
/**
 * 比较两个业务对象的更新时间并返回更新的一方。
 *
 * @param {object} localItem 本地业务对象。
 * @param {object} remoteItem 远端业务对象。
 * @returns {object} 更新时间较新的业务对象。
 */
function pickNewerItem(localItem, remoteItem) {
  /** 本地业务对象更新时间。 */
  const localUpdatedAt = localItem && localItem.updatedAt ? localItem.updatedAt : localItem && localItem.createdAt ? localItem.createdAt : 0;
  /** 远端业务对象更新时间。 */
  const remoteUpdatedAt = remoteItem && remoteItem.updatedAt ? remoteItem.updatedAt : remoteItem && remoteItem.createdAt ? remoteItem.createdAt : 0;

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
  /** 合并结果中已出现过的链接 ID 集合。 */
  const mergedLinkIds = new Set();
  /** 合并结果中已出现过的链接 URL 集合。 */
  const mergedLinkUrls = new Set();
  /** 合并后的链接列表。 */
  const mergedLinks = [];

  /**
   * 尝试把链接加入合并结果，按 ID 和 URL 去重，冲突时保留较新的一方。
   *
   * @param {object} link 待加入的链接。
   * @param {boolean} allowAppend 是否允许追加到末尾（远端独有链接才追加）。
   * @returns {void}
   */
  const addLink = (link, allowAppend) => {
    /** 同 ID 的已合并链接索引。 */
    const existingIndexById = mergedLinks.findIndex((item) => item.id === link.id);

    if (existingIndexById >= 0) {
      mergedLinks[existingIndexById] = pickNewerItem(mergedLinks[existingIndexById], link);
      mergedLinkUrls.add(mergedLinks[existingIndexById].url);
      return;
    }

    /** 同 URL 的已合并链接索引。 */
    const existingIndexByUrl = mergedLinks.findIndex((item) => item.url === link.url);

    if (existingIndexByUrl >= 0) {
      mergedLinks[existingIndexByUrl] = pickNewerItem(mergedLinks[existingIndexByUrl], link);
      return;
    }

    if (!allowAppend) {
      return;
    }

    mergedLinks.push(link);
    mergedLinkIds.add(link.id);
    mergedLinkUrls.add(link.url);
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
    addLink(link, !mergedLinkIds.has(link.id) && !mergedLinkUrls.has(link.url));
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
  /** 分组 ID 的有序集合。 */
  const groupIds = [];
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

    if (!groupIds.includes(group.id)) {
      groupIds.push(group.id);
    }
  };

  for (const group of Array.isArray(localGroups) ? localGroups : []) {
    collectGroup(group, localGroupById);
  }

  for (const group of Array.isArray(remoteGroups) ? remoteGroups : []) {
    collectGroup(group, remoteGroupById);
  }

  return groupIds.map((groupId) => mergeGroup(localGroupById.get(groupId), remoteGroupById.get(groupId)));
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
  /** 空间 ID 的有序集合。 */
  const spaceIds = [];
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

    if (!spaceIds.includes(space.id)) {
      spaceIds.push(space.id);
    }
  };

  for (const space of Array.isArray(localSpaces) ? localSpaces : []) {
    collectSpace(space, localSpaceById);
  }

  for (const space of Array.isArray(remoteSpaces) ? remoteSpaces : []) {
    collectSpace(space, remoteSpaceById);
  }

  return spaceIds.map((spaceId) => mergeSpace(localSpaceById.get(spaceId), remoteSpaceById.get(spaceId)));
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
  /** 合并后仍然存在的当前激活空间 ID。 */
  const activeSpaceId = spaces.some((space) => space.id === normalizedLocalData.activeSpaceId) ? normalizedLocalData.activeSpaceId : spaces[0].id;
  /** 合并后的全量数据。 */
  const mergedData = ensureSyncSettings({
    version: Math.max(normalizedLocalData.version || 1, normalizedRemoteData.version || 1),
    activeSpaceId,
    spaces,
    settings: normalizedLocalData.settings
  }, normalizedLocalData.settings.sync.deviceId);

  mergedData.settings.sync = {
    ...normalizedLocalData.settings.sync
  };
  return mergedData;
}

  return {
    pickNewerItem,
  mergeLinks,
  mergeGroup,
  mergeGroups,
  mergeSpace,
  mergeSpaces,
  mergeWorkspaceData
  };
});
