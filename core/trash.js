/**
 * MyTabDesk 核心模块：回收站墓碑读取、恢复和永久清理。
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./ids.js"), require("./normalize.js"));
  } else {
    root.MyTabDeskCoreTrash = factory(root.MyTabDeskCoreIds, root.MyTabDeskCoreNormalize);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (ids, normalize) {
  const { getCurrentTime } = ids;
  const { normalizeData } = normalize;

  function getTrashItems(data) {
    const normalized = normalizeData(data);
    const items = [];
    for (const space of normalized.spaces) {
      if (space.purgedAt) continue;
      if (space.deletedAt) {
        items.push({ type: "space", spaceId: space.id, title: space.name, deletedAt: space.deletedAt });
        continue;
      }
      for (const group of space.groups) {
        if (group.purgedAt) continue;
        if (group.deletedAt) {
          items.push({ type: "group", spaceId: space.id, groupId: group.id, title: group.name, parentTitle: space.name, deletedAt: group.deletedAt });
          continue;
        }
        for (const link of group.links) {
          if (!link.deletedAt || link.purgedAt) continue;
          items.push({
            type: "link",
            spaceId: space.id,
            groupId: group.id,
            linkId: link.id,
            title: link.title || link.url,
            url: link.url,
            parentTitle: `${space.name} / ${group.name}`,
            deletedAt: link.deletedAt
          });
        }
      }
    }
    return items.sort((a, b) => b.deletedAt - a.deletedAt);
  }

  function restoreTrashItem(data, target) {
    const nextData = normalizeData(data);
    const restoredAt = getCurrentTime();
    const space = nextData.spaces.find((item) => item.id === target.spaceId);
    if (!space || space.purgedAt) return nextData;
    if (target.type === "space") {
      space.deletedAt = undefined;
      space.updatedAt = restoredAt;
      nextData.activeSpaceId = space.id;
      return nextData;
    }
    space.deletedAt = undefined;
    space.updatedAt = restoredAt;
    const group = space.groups.find((item) => item.id === target.groupId);
    if (!group || group.purgedAt) return nextData;
    if (target.type === "group") {
      group.deletedAt = undefined;
      group.updatedAt = restoredAt;
      return nextData;
    }
    group.deletedAt = undefined;
    group.updatedAt = restoredAt;
    const link = group.links.find((item) => item.id === target.linkId);
    if (!link || link.purgedAt) return nextData;
    link.deletedAt = undefined;
    link.updatedAt = restoredAt;
    return nextData;
  }

  function purgeTrashItem(data, target, purgedAt = getCurrentTime()) {
    const nextData = normalizeData(data);
    const space = nextData.spaces.find((item) => item.id === target.spaceId);
    if (!space) return nextData;
    if (target.type === "space") {
      space.name = "已永久删除";
      space.groups = [];
      space.deletedAt = purgedAt;
      space.purgedAt = purgedAt;
      space.updatedAt = purgedAt;
      return nextData;
    }
    const group = space.groups.find((item) => item.id === target.groupId);
    if (!group) return nextData;
    if (target.type === "group") {
      group.name = "已永久删除";
      group.links = [];
      group.deletedAt = purgedAt;
      group.purgedAt = purgedAt;
      group.updatedAt = purgedAt;
      space.updatedAt = purgedAt;
      return nextData;
    }
    const link = group.links.find((item) => item.id === target.linkId);
    if (!link) return nextData;
    link.title = "已永久删除";
    link.url = `mytabdesk-purged://${link.id}`;
    link.favIconUrl = "";
    link.note = "";
    link.deletedAt = purgedAt;
    link.purgedAt = purgedAt;
    link.updatedAt = purgedAt;
    group.updatedAt = purgedAt;
    space.updatedAt = purgedAt;
    return nextData;
  }

  function purgeExpiredTrash(data, retentionMs, now = getCurrentTime()) {
    let nextData = normalizeData(data);
    let purgedCount = 0;
    const cutoff = now - Math.max(0, Number(retentionMs) || 0);
    const expiredItems = getTrashItems(nextData).filter((item) => item.deletedAt <= cutoff);
    for (const item of expiredItems) {
      nextData = purgeTrashItem(nextData, item, now);
      purgedCount += 1;
    }
    return { data: nextData, purgedCount };
  }

  return {
    getTrashItems,
    restoreTrashItem,
    purgeTrashItem,
    purgeExpiredTrash
  };
});
