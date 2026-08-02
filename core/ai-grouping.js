/**
 * MyTabDesk AI 分组纯逻辑模块。
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./normalize.js"), require("./ids.js"));
  } else {
    root.MyTabDeskCoreAiGrouping = factory(root.MyTabDeskCoreNormalize, root.MyTabDeskCoreIds);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (normalize, ids) {
  const { normalizeData } = normalize;
  const { createId, getCurrentTime } = ids;
  const MAX_GROUPS = 30;
  const MAX_GROUP_NAME_LENGTH = 40;

  function parseJsonObject(text) {
    for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let index = start; index < text.length; index += 1) {
        const character = text[index];
        if (inString) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === "\"") inString = false;
          continue;
        }
        if (character === "\"") inString = true;
        else if (character === "{") depth += 1;
        else if (character === "}") depth -= 1;
        if (depth === 0) {
          try {
            const value = JSON.parse(text.slice(start, index + 1));
            if (value && typeof value === "object" && !Array.isArray(value)) return value;
          } catch {
            break;
          }
        }
      }
    }
    throw new Error("AI 返回内容中没有有效的 JSON 对象。");
  }

  function parseAiGroupingResponse(content) {
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("AI 返回内容为空。");
    }
    const trimmed = content.trim();
    try {
      const value = JSON.parse(trimmed);
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {
      // 继续从 Markdown 围栏或前后说明文字中提取 JSON。
    }
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) {
      try {
        const value = JSON.parse(fenceMatch[1].trim());
        if (value && typeof value === "object" && !Array.isArray(value)) return value;
      } catch {
        // 围栏内容不是完整 JSON 时，继续使用平衡括号提取。
      }
    }
    return parseJsonObject(fenceMatch ? fenceMatch[1] : trimmed);
  }

  function validateAiGroupingSuggestions(raw, validLinkIds) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.groups)) {
      throw new Error("AI 分组结果格式无效。");
    }
    const validIds = new Set(Array.isArray(validLinkIds) ? validLinkIds.filter((id) => typeof id === "string") : []);
    const assignedIds = new Set();
    const groups = [];
    for (const group of raw.groups) {
      const name = typeof group?.name === "string"
        ? group.name.trim().slice(0, MAX_GROUP_NAME_LENGTH)
        : "";
      if (!name || !Array.isArray(group.linkIds)) continue;
      const linkIds = [];
      for (const linkId of group.linkIds) {
        if (typeof linkId !== "string" || !validIds.has(linkId) || assignedIds.has(linkId)) continue;
        assignedIds.add(linkId);
        linkIds.push(linkId);
      }
      if (linkIds.length > 0) groups.push({ name, linkIds });
      if (groups.length === MAX_GROUPS) break;
    }
    if (groups.length === 0) {
      throw new Error("AI 没有返回包含有效链接的分组建议。");
    }
    return { groups };
  }

  function createGroup(name, timestamp) {
    return {
      id: createId("group"),
      name,
      collapsed: false,
      pinned: false,
      color: "",
      links: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: undefined,
      purgedAt: undefined
    };
  }

  function applyAiGroupingSuggestions(data, spaceId, suggestions) {
    const nextData = normalizeData(data);
    const space = nextData.spaces.find((item) => item.id === spaceId && !item.deletedAt);
    if (!space) return nextData;

    const activeLinks = new Map();
    for (const group of space.groups) {
      if (group.deletedAt) continue;
      for (const link of group.links) {
        if (!link.deletedAt && !activeLinks.has(link.id)) activeLinks.set(link.id, link);
      }
    }
    const validated = validateAiGroupingSuggestions(suggestions, Array.from(activeLinks.keys()));
    const movedIds = new Set(validated.groups.flatMap((group) => group.linkIds));
    const timestamp = getCurrentTime();

    for (const group of space.groups) {
      if (group.deletedAt) continue;
      const previousLength = group.links.length;
      group.links = group.links.filter((link) => link.deletedAt || !movedIds.has(link.id));
      if (group.links.length !== previousLength) group.updatedAt = timestamp;
    }

    for (const suggestion of validated.groups) {
      let target = space.groups.find((group) => !group.deletedAt && group.name.trim() === suggestion.name);
      if (!target) {
        target = createGroup(suggestion.name, timestamp);
        space.groups.push(target);
      }
      for (const linkId of suggestion.linkIds) {
        const link = activeLinks.get(linkId);
        if (link) target.links.push({ ...link, updatedAt: timestamp });
      }
      target.updatedAt = timestamp;
    }
    space.updatedAt = timestamp;
    return nextData;
  }

  return {
    parseAiGroupingResponse,
    validateAiGroupingSuggestions,
    applyAiGroupingSuggestions
  };
});
