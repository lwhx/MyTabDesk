/**
 * MyTabDesk 核心模块：MyTabDeskCoreReorder
 * 由 tabdesk-core.js 拆分而来，保持 Node（require）与浏览器（全局命名空间）双环境兼容。
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./ids.js"), require("./normalize.js"));
  } else {
    root.MyTabDeskCoreReorder = factory(root.MyTabDeskCoreIds, root.MyTabDeskCoreNormalize);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (ids, normalize) {
  const { getCurrentTime } = ids;
  const { normalizeLink, normalizeData } = normalize;
/**
 * 移动数组中的单个元素。
 *
 * @param {Array<*>} items 原数组。
 * @param {number} fromIndex 起始索引。
 * @param {number} toIndex 目标索引。
 * @returns {Array<*>} 重排后的新数组。
 */
function moveArrayItem(items, fromIndex, toIndex) {
  if (!Array.isArray(items)) {
    return [];
  }

  if (fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length || fromIndex === toIndex) {
    return items.slice();
  }

  /** 复制后的数组，避免直接修改输入数组。 */
  const nextItems = items.slice();
  /** 被移动的元素。 */
  const [movedItem] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, movedItem);
  return nextItems;
}

/**
 * 重排空间顺序。
 *
 * @param {object} data 当前全量数据。
 * @param {string} sourceSpaceId 被拖拽的空间 ID。
 * @param {string} targetSpaceId 放置目标空间 ID。
 * @returns {object} 重排后的全量数据。
 */
function reorderSpaces(data, sourceSpaceId, targetSpaceId) {
  /** 标准化后的下一份数据。 */
  const nextData = normalizeData(data);
  /** 被拖拽空间的索引。 */
  const fromIndex = nextData.spaces.findIndex((space) => space.id === sourceSpaceId);
  /** 放置目标空间的索引。 */
  const toIndex = nextData.spaces.findIndex((space) => space.id === targetSpaceId);
  nextData.spaces = moveArrayItem(nextData.spaces, fromIndex, toIndex);
  return nextData;
}

/**
 * 重排指定空间内的分组顺序。
 *
 * @param {object} data 当前全量数据。
 * @param {string} spaceId 空间 ID。
 * @param {string} sourceGroupId 被拖拽的分组 ID。
 * @param {string} targetGroupId 放置目标分组 ID。
 * @returns {object} 重排后的全量数据。
 */
function reorderGroups(data, spaceId, sourceGroupId, targetGroupId) {
  /** 标准化后的下一份数据。 */
  const nextData = normalizeData(data);
  /** 当前操作的空间。 */
  const space = nextData.spaces.find((item) => item.id === spaceId);

  if (!space) {
    return nextData;
  }

  /** 被拖拽分组的索引。 */
  const fromIndex = space.groups.findIndex((group) => group.id === sourceGroupId);
  /** 放置目标分组的索引。 */
  const toIndex = space.groups.findIndex((group) => group.id === targetGroupId);
  space.groups = moveArrayItem(space.groups, fromIndex, toIndex);
  space.updatedAt = getCurrentTime();
  return nextData;
}

/**
 * 重排指定分组内的链接顺序。
 *
 * @param {object} data 当前全量数据。
 * @param {string} spaceId 空间 ID。
 * @param {string} groupId 分组 ID。
 * @param {string} sourceLinkId 被拖拽的链接 ID。
 * @param {string} targetLinkId 放置目标链接 ID。
 * @returns {object} 重排后的全量数据。
 */
function reorderLinks(data, spaceId, groupId, sourceLinkId, targetLinkId) {
  /** 标准化后的下一份数据。 */
  const nextData = normalizeData(data);
  /** 当前操作的空间。 */
  const space = nextData.spaces.find((item) => item.id === spaceId);
  /** 当前操作的分组。 */
  const group = space ? space.groups.find((item) => item.id === groupId) : null;

  if (!group) {
    return nextData;
  }

  /** 被拖拽链接的索引。 */
  const fromIndex = group.links.findIndex((link) => link.id === sourceLinkId);
  /** 放置目标链接的索引。 */
  const toIndex = group.links.findIndex((link) => link.id === targetLinkId);
  group.links = moveArrayItem(group.links, fromIndex, toIndex);
  // 按新数组下标回写 order，使排序在同步后仍能保留
  group.links.forEach((link, index) => {
    link.order = index;
  });
  group.updatedAt = getCurrentTime();
  return nextData;
}

/**
 * 更新指定链接的标题、地址和图标。
 *
 * @param {object} data 当前全量数据。
 * @param {string} spaceId 空间 ID。
 * @param {string} groupId 分组 ID。
 * @param {string} linkId 链接 ID。
 * @param {object} patch 链接更新字段。
 * @returns {object} 更新链接后的全量数据。
 * @throws {Error} 当链接地址为空时抛出错误。
 */
function updateLink(data, spaceId, groupId, linkId, patch) {
  /** 标准化后的下一份数据。 */
  const nextData = normalizeData(data);
  /** 当前操作的空间。 */
  const space = nextData.spaces.find((item) => item.id === spaceId);
  /** 当前操作的分组。 */
  const group = space ? space.groups.find((item) => item.id === groupId) : null;
  /** 当前操作的链接。 */
  const link = group ? group.links.find((item) => item.id === linkId) : null;

  if (!link) {
    return nextData;
  }

  /** 去除前后空格后的链接地址。 */
  const nextUrl = String(patch && patch.url ? patch.url : "").trim();

  if (!nextUrl) {
    throw new Error("请输入链接地址。");
  }

  /** 去除前后空格后的链接标题。 */
  const nextTitle = String(patch && patch.title ? patch.title : "").trim();
  /** 去除前后空格后的图标地址。 */
  const nextFavIconUrl = String(patch && patch.favIconUrl ? patch.favIconUrl : "").trim();

  link.title = nextTitle || nextUrl;
  link.url = nextUrl;
  link.favIconUrl = nextFavIconUrl;
  link.updatedAt = getCurrentTime();
  group.updatedAt = getCurrentTime();
  space.updatedAt = getCurrentTime();
  return nextData;
}

/**
 * 在同一空间内跨分组移动链接。
 *
 * @param {object} data 当前全量数据。
 * @param {string} spaceId 空间 ID。
 * @param {string} sourceGroupId 源分组 ID。
 * @param {string} targetGroupId 目标分组 ID。
 * @param {string} sourceLinkId 被拖拽的链接 ID。
 * @param {string} targetLinkId 放置目标链接 ID，为空时追加到目标分组末尾。
 * @returns {object} 移动链接后的全量数据。
 */
function moveLinkBetweenGroups(data, spaceId, sourceGroupId, targetGroupId, sourceLinkId, targetLinkId) {
  /** 标准化后的下一份数据。 */
  const nextData = normalizeData(data);
  /** 当前操作的空间。 */
  const space = nextData.spaces.find((item) => item.id === spaceId);

  if (!space || sourceGroupId === targetGroupId) {
    return nextData;
  }

  /** 源分组。 */
  const sourceGroup = space.groups.find((item) => item.id === sourceGroupId);
  /** 目标分组。 */
  const targetGroup = space.groups.find((item) => item.id === targetGroupId);

  if (!sourceGroup || !targetGroup) {
    return nextData;
  }

  /** 被移动链接在源分组中的索引。 */
  const sourceIndex = sourceGroup.links.findIndex((link) => link.id === sourceLinkId);

  if (sourceIndex < 0) {
    return nextData;
  }

  /** 当前移动版本时间。 */
  const movedAt = getCurrentTime();
  /** 被移动的原始链接数据。 */
  const originalLink = sourceGroup.links[sourceIndex];
  /** 源位置删除墓碑，阻止旧设备把链接补回原分组。 */
  sourceGroup.links[sourceIndex] = {
    id: originalLink.id,
    title: originalLink.title,
    url: originalLink.url,
    createdAt: originalLink.createdAt,
    updatedAt: movedAt,
    deletedAt: movedAt,
    order: originalLink.order
  };
  /** 目标位置活动副本。 */
  const movedLink = {
    ...originalLink,
    updatedAt: movedAt,
    deletedAt: undefined
  };
  /** 目标链接在目标分组中的索引。 */
  const targetIndex = targetGroup.links.findIndex((link) => link.id === targetLinkId);

  if (targetIndex < 0) {
    targetGroup.links.push(movedLink);
  } else {
    targetGroup.links.splice(targetIndex, 0, movedLink);
  }

  // 移动后，源分组和目标分组的 link 顺序都发生了变化，按下标回写 order
  let sourceOrder = 0;
  sourceGroup.links.forEach((link) => {
    if (!link.deletedAt) {
      link.order = sourceOrder;
      sourceOrder += 1;
    }
  });
  let targetOrder = 0;
  targetGroup.links.forEach((link) => {
    if (!link.deletedAt) {
      link.order = targetOrder;
      targetOrder += 1;
    }
  });

  sourceGroup.updatedAt = movedAt;
  targetGroup.updatedAt = movedAt;
  space.updatedAt = movedAt;
  return nextData;
}

/**
 * 把分组跨空间移动，并在源空间保留删除墓碑。
 *
 * @param {object} data 当前全量数据。
 * @param {string} sourceSpaceId 源空间 ID。
 * @param {string} targetSpaceId 目标空间 ID。
 * @param {string} groupId 分组 ID。
 * @returns {object} 移动后的全量数据。
 */
function moveGroupBetweenSpaces(data, sourceSpaceId, targetSpaceId, groupId) {
  const nextData = normalizeData(data);
  const sourceSpace = nextData.spaces.find((space) => space.id === sourceSpaceId && !space.deletedAt);
  const targetSpace = nextData.spaces.find((space) => space.id === targetSpaceId && !space.deletedAt);

  if (!sourceSpace || !targetSpace || sourceSpace.id === targetSpace.id) {
    return nextData;
  }

  const sourceIndex = sourceSpace.groups.findIndex((group) => group.id === groupId && !group.deletedAt);
  if (sourceIndex < 0) {
    return nextData;
  }

  const movedAt = getCurrentTime();
  const originalGroup = sourceSpace.groups[sourceIndex];
  sourceSpace.groups[sourceIndex] = {
    id: originalGroup.id,
    name: originalGroup.name,
    createdAt: originalGroup.createdAt,
    updatedAt: movedAt,
    deletedAt: movedAt,
    links: []
  };
  targetSpace.groups.push({
    ...originalGroup,
    updatedAt: movedAt,
    deletedAt: undefined
  });
  sourceSpace.updatedAt = movedAt;
  targetSpace.updatedAt = movedAt;
  return nextData;
}

/**
 * 向指定分组添加链接，并按 URL 跳过重复链接。
 *
 * @param {object} data 当前全量数据。
 * @param {string} spaceId 空间 ID。
 * @param {string} groupId 分组 ID。
 * @param {Array<object>} rawLinks 待添加的原始链接数组。
 * @returns {object} 添加链接后的全量数据。
 */
function addLinksToGroup(data, spaceId, groupId, rawLinks) {
  /** 标准化后的下一份数据。 */
  const nextData = normalizeData(data);
  /** 当前操作的空间。 */
  const space = nextData.spaces.find((item) => item.id === spaceId);
  /** 当前操作的分组。 */
  const group = space ? space.groups.find((item) => item.id === groupId) : null;

  if (!group) {
    return nextData;
  }

  /** 分组内尚未删除的 URL 集合；墓碑 URL 允许用户重新添加。 */
  const existingUrls = new Set(group.links.filter((link) => !link.deletedAt).map((link) => link.url));
  /** 本次真正需要新增的链接数组。 */
  const nextLinks = [];

  for (const rawLink of rawLinks) {
    /** 标准化后的待添加链接。 */
    const link = normalizeLink(rawLink);

    if (!link.url || existingUrls.has(link.url)) {
      continue;
    }

    existingUrls.add(link.url);
    nextLinks.push(link);
  }

  group.links = group.links.concat(nextLinks);
  // 按最终数组下标回写 order，保证新增链接排在末尾且 order 连续
  group.links.forEach((link, index) => {
    link.order = index;
  });
  group.updatedAt = getCurrentTime();
  space.updatedAt = getCurrentTime();
  return nextData;
}

  return {
    moveArrayItem,
  reorderSpaces,
  reorderGroups,
  reorderLinks,
  updateLink,
  moveGroupBetweenSpaces,
  moveLinkBetweenGroups,
  addLinksToGroup
  };
});
