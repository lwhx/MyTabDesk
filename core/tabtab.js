/**
 * MyTabDesk 核心模块：MyTabDeskCoreTabtab
 * 由 tabdesk-core.js 拆分而来，保持 Node（require）与浏览器（全局命名空间）双环境兼容。
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./constants.js"), require("./ids.js"), require("./normalize.js"));
  } else {
    root.MyTabDeskCoreTabtab = factory(root.MyTabDeskCoreConstants, root.MyTabDeskCoreIds, root.MyTabDeskCoreNormalize);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (constants, ids, normalize) {
  const { DEFAULT_SPACE_ID } = constants;
  const { getDefaultSpaceIcon, getCurrentTime, createId } = ids;
  const { normalizeData } = normalize;
/**
 * 判断数据是否为 tabtab 备份结构。
 *
 * @param {object} data 待识别的数据对象。
 * @returns {boolean} 是 tabtab 备份结构时返回 true，否则返回 false。
 */
function isTabTabBackupData(data) {
  return Boolean(data && typeof data === "object" && Array.isArray(data.space_list) && data.spaces && typeof data.spaces === "object" && !Array.isArray(data.spaces));
}

/**
 * 将 tabtab 标签记录转换为工作台链接数据。
 *
 * @param {object} tab tabtab 标签记录。
 * @returns {object} 工作台链接数据。
 */
function convertTabTabTabToLink(tab) {
  /** 当前时间戳，用于补齐创建和更新时间。 */
  const now = getCurrentTime();
  /** 来源 tab 的创建时间，order 缺失时用它作为排序基准。 */
  const sourceCreatedAt = tab && tab.createdAt ? tab.createdAt : now;

  return {
    id: tab && tab.id ? tab.id : createId("link"),
    title: tab && tab.title ? tab.title : tab && tab.url ? tab.url : "未命名链接",
    url: tab && tab.url ? tab.url : "",
    favIconUrl: tab && tab.favIconUrl ? tab.favIconUrl : "",
    createdAt: sourceCreatedAt,
    updatedAt: tab && tab.updatedAt ? tab.updatedAt : sourceCreatedAt,
    order: sourceCreatedAt
  };
}

/**
 * 将 tabtab 分组转换为工作台分组数据。
 *
 * @param {object} group tabtab 分组数据。
 * @returns {object} 工作台分组数据。
 */
function convertTabTabGroupToWorkspaceGroup(group) {
  /** 当前时间戳，用于补齐创建和更新时间。 */
  const now = getCurrentTime();
  /** tabtab 分组内的标签记录数组。 */
  const rawTabs = group && Array.isArray(group.tabs) ? group.tabs : [];

  return {
    id: group && group.id ? group.id : createId("group"),
    name: group && group.name ? group.name : "未命名分组",
    collapsed: false,
    pinned: Boolean(group && group.pinned),
    links: rawTabs.map(convertTabTabTabToLink).filter((link) => Boolean(link.url)),
    createdAt: group && group.createdAt ? group.createdAt : now,
    updatedAt: group && group.updatedAt ? group.updatedAt : now
  };
}

/**
 * 将 tabtab 空间转换为工作台空间数据。
 *
 * @param {object} space tabtab 空间详情。
 * @param {object} spaceMeta tabtab 空间列表元信息。
 * @returns {object} 工作台空间数据。
 */
function convertTabTabSpaceToWorkspaceSpace(space, spaceMeta) {
  /** 当前时间戳，用于补齐创建和更新时间。 */
  const now = getCurrentTime();
  /** tabtab 空间内的分组数组。 */
  const rawGroups = space && Array.isArray(space.groups) ? space.groups : [];
  /** 空间 ID，优先使用空间详情，其次使用空间列表元信息。 */
  const spaceId = space && space.id ? space.id : spaceMeta && spaceMeta.id ? spaceMeta.id : createId("space");

  return {
    id: spaceId,
    name: space && space.name ? space.name : spaceMeta && spaceMeta.name ? spaceMeta.name : "未命名空间",
    icon: getDefaultSpaceIcon(),
    groups: rawGroups.map(convertTabTabGroupToWorkspaceGroup),
    createdAt: space && space.createdAt ? space.createdAt : now,
    updatedAt: space && space.updatedAt ? space.updatedAt : now
  };
}

/**
 * 将 tabtab 备份转换为工作台内部全量数据。
 *
 * @param {object} tabtabData tabtab 备份数据。
 * @returns {object} 工作台内部全量数据。
 */
function convertTabTabBackupToWorkspaceData(tabtabData) {
  /** tabtab 空间顺序列表。 */
  const spaceList = Array.isArray(tabtabData.space_list) ? tabtabData.space_list : [];
  /** 已按顺序转换的空间 ID 集合。 */
  const usedSpaceIds = new Set();
  /** 按 tabtab 空间列表顺序转换后的空间数组。 */
  const orderedSpaces = spaceList
    .map((spaceMeta) => {
      /** 当前空间 ID。 */
      const spaceId = spaceMeta && spaceMeta.id ? spaceMeta.id : "";
      /** 当前空间详情。 */
      const space = spaceId && tabtabData.spaces ? tabtabData.spaces[spaceId] : null;

      if (!space) {
        return null;
      }

      usedSpaceIds.add(spaceId);
      return convertTabTabSpaceToWorkspaceSpace(space, spaceMeta);
    })
    .filter(Boolean);
  /** tabtab 空间对象中未出现在 space_list 的兜底空间数组。 */
  const remainingSpaces = Object.keys(tabtabData.spaces || {})
    .filter((spaceId) => !usedSpaceIds.has(spaceId))
    .map((spaceId) => convertTabTabSpaceToWorkspaceSpace(tabtabData.spaces[spaceId], { id: spaceId }));
  /** 合并后的空间数组。 */
  const spaces = orderedSpaces.concat(remainingSpaces);

  return normalizeData({
    version: 1,
    activeSpaceId: spaces.length > 0 ? spaces[0].id : DEFAULT_SPACE_ID,
    spaces,
    settings: {}
  });
}

/**
 * 将工作台链接转换为 tabtab 标签记录。
 *
 * @param {object} link 工作台链接数据。
 * @returns {object} tabtab 标签记录。
 */
function convertLinkToTabTabTab(link) {
  return {
    kind: "record",
    id: link.id,
    title: link.title || link.url,
    favIconUrl: link.favIconUrl || "",
    url: link.url,
    pinned: Boolean(link.pinned)
  };
}

/**
 * 将工作台分组转换为 tabtab 分组数据。
 *
 * @param {object} group 工作台分组数据。
 * @returns {object} tabtab 分组数据。
 */
function convertGroupToTabTabGroup(group) {
  return {
    id: group.id,
    name: group.name,
    tabs: group.links.map(convertLinkToTabTabTab)
  };
}

/**
 * 将工作台数据转换为 tabtab 兼容备份结构。
 *
 * @param {object} data 工作台全量数据。
 * @returns {object} tabtab 兼容备份结构。
 */
function convertWorkspaceDataToTabTabBackup(data) {
  /** 标准化后的工作台数据。 */
  const normalizedData = normalizeData(data);
  /** tabtab 空间详情对象。 */
  const spaces = {};
  /** tabtab 空间顺序列表。 */
  const spaceList = normalizedData.spaces.map((space) => {
    spaces[space.id] = {
      id: space.id,
      name: space.name,
      groups: space.groups.map(convertGroupToTabTabGroup),
      pins: {}
    };

    return {
      id: space.id,
      name: space.name
    };
  });

  return {
    version: getCurrentTime(),
    space_list: spaceList,
    spaces
  };
}

  return {
    isTabTabBackupData,
  convertTabTabTabToLink,
  convertTabTabGroupToWorkspaceGroup,
  convertTabTabSpaceToWorkspaceSpace,
  convertTabTabBackupToWorkspaceData,
  convertLinkToTabTabTab,
  convertGroupToTabTabGroup,
  convertWorkspaceDataToTabTabBackup
  };
});
