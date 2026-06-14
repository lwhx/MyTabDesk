/**
 * MyTabDesk 核心模块：MyTabDeskCoreTabs
 * 由 tabdesk-core.js 拆分而来，保持 Node（require）与浏览器（全局命名空间）双环境兼容。
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./ids.js"));
  } else {
    root.MyTabDeskCoreTabs = factory(root.MyTabDeskCoreIds);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (ids) {
  const { getCurrentTime, createId } = ids;
/**
 * 判断标签页 URL 是否允许保存。
 *
 * @param {string} url 标签页 URL。
 * @returns {boolean} 可以保存时返回 true，否则返回 false。
 */
function isValidTabUrl(url) {
  if (!url || typeof url !== "string") {
    return false;
  }

  /** 去除前后空白后的标签页 URL。 */
  const normalizedUrl = url.trim();

  try {
    /** 解析后的标准 URL 对象。 */
    const parsedUrl = new URL(normalizedUrl);
    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  } catch (error) {
    return false;
  }
}

/**
 * 按 URL 对标签页数组去重。
 *
 * @param {Array<object>} tabs 标签页数组。
 * @returns {Array<object>} 去重后的标签页数组。
 */
function dedupeTabsByUrl(tabs) {
  /** 已出现过的 URL 集合。 */
  const visitedUrls = new Set();
  /** 去重后的标签页数组。 */
  const uniqueTabs = [];

  for (const tab of tabs) {
    if (!tab || !tab.url || visitedUrls.has(tab.url)) {
      continue;
    }

    visitedUrls.add(tab.url);
    uniqueTabs.push(tab);
  }

  return uniqueTabs;
}

/**
 * 过滤出允许保存的普通网页标签页。
 *
 * @param {Array<object>} tabs 原始标签页数组。
 * @returns {Array<object>} 过滤后的标签页数组。
 */
function filterValidTabs(tabs) {
  if (!Array.isArray(tabs)) {
    return [];
  }

  return tabs.filter((tab) => tab && isValidTabUrl(tab.url));
}

/**
 * 将浏览器标签页转换为链接数据。
 *
 * @param {Array<object>} tabs 标签页数组。
 * @returns {Array<object>} 链接数组。
 */
function tabsToLinks(tabs) {
  /** 当前时间戳，作为新链接的创建时间与初始 order 值。 */
  const now = getCurrentTime();

  return dedupeTabsByUrl(filterValidTabs(tabs)).map((tab) => ({
    id: createId("link"),
    title: tab.title || tab.url,
    url: tab.url,
    favIconUrl: tab.favIconUrl || "",
    createdAt: now,
    order: now
  }));
}

/**
 * 根据关键词过滤分组和链接。
 *
 * @param {Array<object>} groups 分组数组。
 * @param {string} keyword 搜索关键词。
 * @returns {Array<object>} 匹配的分组数组。
 */
function filterGroups(groups, keyword) {
  /** 统一转为小写后的搜索关键词。 */
  const q = String(keyword || "").trim().toLowerCase();

  if (!q) {
    return groups;
  }

  return groups
    .map((group) => {
      /** 分组名称是否命中关键词。 */
      const groupMatched = group.name.toLowerCase().includes(q);

      if (groupMatched) {
        return group;
      }

      /** 当前分组内命中关键词的链接。 */
      const matchedLinks = group.links.filter((link) => {
        return link.title.toLowerCase().includes(q) || link.url.toLowerCase().includes(q);
      });

      if (matchedLinks.length === 0) {
        return null;
      }

      return {
        ...group,
        links: matchedLinks
      };
    })
    .filter(Boolean);
}

/**
 * 根据关键词过滤当前窗口标签页。
 *
 * @param {Array<object>} tabs 当前窗口标签页数组。
 * @param {string} keyword 搜索关键词。
 * @returns {Array<object>} 匹配的当前标签页数组。
 */
function filterCurrentTabs(tabs, keyword) {
  /** 统一小写后的搜索关键词。 */
  const q = String(keyword || "").trim().toLowerCase();

  if (!Array.isArray(tabs)) {
    return [];
  }

  if (!q) {
    return tabs;
  }

  return tabs.filter((tab) => {
    /** 标签标题。 */
    const title = tab && tab.title ? tab.title.toLowerCase() : "";
    /** 标签 URL。 */
    const url = tab && tab.url ? tab.url.toLowerCase() : "";

    return title.includes(q) || url.includes(q);
  });
}

  return {
    isValidTabUrl,
  dedupeTabsByUrl,
  filterValidTabs,
  tabsToLinks,
  filterGroups,
  filterCurrentTabs
  };
});
