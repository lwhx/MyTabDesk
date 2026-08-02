(function (root) {
const app = root.MyTabDeskPage;
const { state, elements } = app;
const {
  createId,
  getCurrentTime,
  normalizeData,
  createEncryptedBackup,
  restoreEncryptedBackup,
  detectImportConflict,
  isValidTabUrl,
  tabsToLinks,
  exportData,
  exportNativeBackup,
  createVisibleWorkspaceData,
  importData,
  clearAllData,
  reorderSpaces,
  reorderGroups,
  reorderLinks,
  moveGroupBetweenSpaces,
  moveLinkBetweenGroups,
  updateLink,
  addLinksToGroup,
  findDuplicateLinks,
  deduplicateLinks,
  findSpace,
  findGroupInSpace,
  findLinkInGroup
} = app;
const {
  getActiveSpace,
  createWorkspaceSnapshot,
  hasChromeTabs,
  saveData,
  formatDateTime,
  markDirty,
  markSettingsDirty,
  markSyncStateDirty
} = root.MyTabDeskUtils;
const { showAlert, showConfirm, showPrompt } = root.MyTabDeskDialogs;

/**
 * 从创建菜单触发新建空白空间。
 *
 * @returns {Promise<void>} 创建流程结束后结束。
 */
async function createBlankSpaceFromMenu() {
  root.MyTabDeskRender.openCreateSpaceDialog();
}

/**
 * 保存数据并标记为脏，用于数据变更后的统一保存。
 *
 * @param {object} options 保存选项。
 * @returns {Promise<void>}
 */
async function persistWithDirty(options) {
  markDirty();
  try {
    await saveData(options);
  } catch (error) {
    await showAlert(error.message || "数据保存失败，请稍后重试。");
    throw error;
  }
}

function recordSaveUsage(linkCount, spaceId) {
  chrome.runtime.sendMessage({
    type: "record-usage-event",
    eventType: "save",
    linkCount,
    spaceId
  }).catch((error) => console.warn("记录保存统计失败:", error));
}

/**
 * 带脏标记的跳过自动同步保存。
 *
 * @param {object} options 保存选项。
 * @returns {Promise<void>}
 */
async function persistWithDirtySkipSync(options) {
  markDirty();
  try {
    await saveData({ ...(options || {}), skipAutoSync: true });
  } catch (error) {
    await showAlert(error.message || "数据保存失败，请稍后重试。");
    throw error;
  }
}

function createDefaultInboxGroup() {
  const now = getCurrentTime();

  return {
    id: createId("group"),
    name: "收集箱",
    collapsed: false,
    pinned: false,
    links: [],
    createdAt: now,
    updatedAt: now
  };
}

function ensureActiveSpaceHasGroup(activeSpace) {
  if (!activeSpace || !Array.isArray(activeSpace.groups)) {
    return null;
  }

  const liveGroup = activeSpace.groups.find((group) => !group.deletedAt);
  if (liveGroup) {
    return liveGroup;
  }

  const group = createDefaultInboxGroup();
  activeSpace.groups.push(group);
  activeSpace.updatedAt = getCurrentTime();
  return group;
}

function collectBookmarkGroups(node, path = [], output = []) {
  const children = Array.isArray(node && node.children) ? node.children : [];
  const directLinks = children.filter((child) => child.url && isValidTabUrl(child.url));
  const folderName = path.length > 0 ? path.join(" / ") : "未分类书签";
  if (directLinks.length > 0) {
    output.push({
      name: folderName,
      links: directLinks.map((bookmark) => ({
        title: bookmark.title || bookmark.url,
        url: bookmark.url,
        favIconUrl: ""
      }))
    });
  }
  for (const child of children.filter((item) => !item.url && Array.isArray(item.children))) {
    collectBookmarkGroups(child, [...path, child.title || "未命名文件夹"], output);
  }
  return output;
}

/** 从浏览器书签树选择目录并导入当前空间。 */
async function importBrowserBookmarks() {
  root.MyTabDeskRender.closeCreateSpaceMenu();
  if (!chrome.bookmarks || !chrome.bookmarks.getTree) {
    await showAlert("当前浏览器不支持读取书签。", "无法导入");
    return false;
  }
  const tree = await chrome.bookmarks.getTree();
  const roots = (tree[0] && Array.isArray(tree[0].children) ? tree[0].children : [])
    .filter((node) => Array.isArray(node.children));
  if (roots.length === 0) {
    await showAlert("浏览器中没有可导入的书签目录。", "无法导入");
    return false;
  }
  const answer = await showPrompt(
    `请选择导入目录：\n${roots.map((node, index) => `${index + 1}. ${node.title || "未命名目录"}`).join("\n")}`,
    "1",
    "从浏览器书签导入"
  );
  if (answer === null) return false;
  const selectedRoot = roots[Number(answer) - 1];
  if (!selectedRoot) {
    await showAlert("请输入有效的目录序号。", "无法导入");
    return false;
  }
  const activeSpace = getActiveSpace();
  if (!activeSpace) return false;
  const activeSpaceId = activeSpace.id;
  const importedGroups = collectBookmarkGroups(selectedRoot);
  if (importedGroups.length === 0) {
    await showAlert("所选目录中没有可导入的 HTTP/HTTPS 书签。", "没有可导入内容");
    return false;
  }
  const now = getCurrentTime();
  let importedCount = 0;
  for (const imported of importedGroups) {
    const currentSpace = findSpace(state.data, activeSpaceId);
    let target = currentSpace.groups.find((group) => !group.deletedAt && group.name === imported.name);
    if (!target) {
      target = {
        id: createId("group"), name: imported.name, collapsed: false, pinned: false,
        links: [], createdAt: now, updatedAt: now
      };
      currentSpace.groups.push(target);
    }
    const before = target.links.filter((link) => !link.deletedAt).length;
    state.data = addLinksToGroup(state.data, activeSpaceId, target.id, tabsToLinks(imported.links));
    const updatedSpace = findSpace(state.data, activeSpaceId);
    const updatedGroup = findGroupInSpace(updatedSpace, target.id);
    importedCount += updatedGroup.links.filter((link) => !link.deletedAt).length - before;
  }
  await persistWithDirty();
  root.MyTabDeskRender.renderAll();
  await showAlert(`已导入 ${importedCount} 个书签到 ${importedGroups.length} 个分组。`, "导入完成");
  return true;
}

/**
 * 提交创建空间弹窗。
 *
 * @returns {Promise<void>} 创建完成后结束。
 */
async function submitCreateSpaceDialog() {
  await createSpace(elements.createSpaceNameInput.value);
}

/**
 * 新建空间。
 *
 * @param {string} name 用户输入的空间名称。
 * @returns {Promise<void>} 创建并保存后结束。
 */
async function createSpace(name) {
  if (!name || !name.trim()) {
    state.createSpaceDialogError = "请输入空间名称";
    root.MyTabDeskRender.renderCreateSpaceDialog();
    elements.createSpaceNameInput.focus();
    return;
  }

  /** 去除前后空格后的空间名称。 */
  const trimmedName = name.trim();
  /** 是否已经存在同名空间。 */
  const nameExists = state.data.spaces.some((space) => space.name.trim() === trimmedName);

  if (nameExists) {
    state.createSpaceDialogError = "空间名称已存在，请换一个名称。";
    root.MyTabDeskRender.renderCreateSpaceDialog();
    elements.createSpaceNameInput.select();
    return;
  }

  /** 当前时间戳。 */
  const now = getCurrentTime();
  /** 新空间数据。 */
  const space = {
    id: createId("space"),
    name: trimmedName,
    icon: app.UI_DEFAULT_SPACE_ICON,
    groups: [],
    createdAt: now,
    updatedAt: now
  };

  state.data.spaces.push(space);
  state.data.activeSpaceId = space.id;
  root.MyTabDeskRender.closeCreateSpaceDialog();
  await persistWithDirty();
  root.MyTabDeskRender.renderAll();
}

/**
 * 删除指定空间。
 *
 * @param {string} spaceId 待删除空间 ID。
 * @returns {Promise<void>} 删除并保存后结束。
 */
async function deleteSpace(spaceId) {
  /** 待删除空间。 */
  const space = findSpace(state.data, spaceId);

  if (!space) {
    return;
  }

  if (state.data.spaces.length <= 1) {
    await showAlert("至少需要保留一个空间。");
    return;
  }

  const liveSpacesBefore = state.data.spaces.filter((s) => !s.deletedAt);
  if (liveSpacesBefore.length <= 1) {
    await showAlert("至少需要保留一个空间。");
    return;
  }

  /** 用户删除确认结果。 */
  const confirmed = await showConfirm(`确定删除空间「${space.name}」吗？该空间下的所有分组和链接都会被删除。`);

  if (!confirmed) {
    return;
  }

  state.data.spaces = state.data.spaces.filter((item) => item.id !== spaceId);
  // 写入删除墓碑，用于跨设备同步时阻止已删除空间被旧远端数据复活
  state.data.spaces.push({ ...space, deletedAt: getCurrentTime(), updatedAt: getCurrentTime() });

  if (state.data.activeSpaceId === spaceId) {
    // 激活第一个非墓碑空间
    const liveSpaces = state.data.spaces.filter((s) => !s.deletedAt);
    state.data.activeSpaceId = liveSpaces[0].id;
  }

  state.openSpaceMenuId = "";
  await persistWithDirty();
  root.MyTabDeskRender.renderAll();
}

/**
 * 在当前空间中新建分组。
 *
 * @returns {Promise<void>} 创建并保存后结束。
 */
async function createGroup() {
  /** 当前激活空间。 */
  const activeSpace = getActiveSpace();

  if (!activeSpace) {
    return;
  }

  /** 用户输入的分组名称。 */
  const name = await showPrompt("请输入分组名称", "", "添加分组");

  if (!name || !name.trim()) {
    if (name !== null) {
      await showAlert("请输入分组名称");
    }
    return;
  }

  /** 当前时间戳。 */
  const now = getCurrentTime();
  activeSpace.groups.unshift({
    id: createId("group"),
    name: name.trim(),
    collapsed: false,
    pinned: false,
    links: [],
    createdAt: now,
    updatedAt: now
  });
  activeSpace.updatedAt = now;

  await persistWithDirty();
  root.MyTabDeskRender.renderAll();
}

/**
 * 删除当前空间内的指定分组。
 *
 * @param {string} groupId 待删除分组 ID。
 * @returns {Promise<void>} 删除并保存后结束。
 */
async function deleteGroup(groupId) {
  /** 当前激活空间。 */
  const activeSpace = getActiveSpace();
  /** 待删除分组。 */
  const group = findGroupInSpace(activeSpace, groupId);

  if (!activeSpace || !group) {
    return;
  }

  /** 用户删除确认结果。 */
  const confirmed = await showConfirm(`确定删除分组「${group.name}」吗？该分组下的所有链接都会被删除。`);

  if (!confirmed) {
    return;
  }

  activeSpace.groups = activeSpace.groups.filter((item) => item.id !== groupId);
  // 写入删除墓碑，用于跨设备同步时阻止已删除分组被旧远端数据复活
  activeSpace.groups.push({ ...group, deletedAt: getCurrentTime(), updatedAt: getCurrentTime() });
  activeSpace.updatedAt = getCurrentTime();

  await persistWithDirty();
  root.MyTabDeskRender.renderAll();
}

/**
 * 切换分组折叠状态。
 *
 * @param {string} groupId 分组 ID。
 * @returns {Promise<void>} 切换并保存后结束。
 */
async function toggleGroup(groupId) {
  /** 当前激活空间。 */
  const activeSpace = getActiveSpace();
  /** 待切换的分组。 */
  const group = findGroupInSpace(activeSpace, groupId);

  if (!group) {
    return;
  }

  group.collapsed = !group.collapsed;
  group.updatedAt = getCurrentTime();
  activeSpace.updatedAt = getCurrentTime();

  await persistWithDirty();
  root.MyTabDeskRender.renderAll();
}

/**
 * 固定或取消固定当前空间内的分组。
 *
 * @param {string} groupId 分组 ID。
 * @returns {Promise<void>} 切换并保存后结束。
 */
async function toggleGroupPinned(groupId) {
  /** 当前激活空间。 */
  const activeSpace = getActiveSpace();
  /** 待切换固定状态的分组。 */
  const group = findGroupInSpace(activeSpace, groupId);

  if (!group) {
    return;
  }

  group.pinned = !group.pinned;
  group.updatedAt = getCurrentTime();
  activeSpace.updatedAt = getCurrentTime();
  state.draggedGroupId = "";

  await persistWithDirty();
  root.MyTabDeskRender.renderAll();
}

/**
 * 切换移动分组菜单显示状态。
 *
 * @param {string} groupId 分组 ID。
 * @returns {void}
 */
function toggleMoveGroupMenu(groupId) {
  state.movingGroupId = state.movingGroupId === groupId ? "" : groupId;
  state.openLinkMenuId = "";
  state.editingGroupId = "";
  root.MyTabDeskRender.renderGroups();
}

/**
 * 关闭移动分组菜单。
 *
 * @returns {void}
 */
function closeMoveGroupMenu() {
  if (!state.movingGroupId) {
    return;
  }

  state.movingGroupId = "";
  root.MyTabDeskRender.renderGroups();
}

/**
 * 将当前空间内的分组原样移动到指定空间末尾。
 *
 * @param {string} groupId 待移动分组 ID。
 * @param {string} targetSpaceId 目标空间 ID。
 * @returns {Promise<void>} 移动并保存后结束。
 */
async function moveGroupToSpace(groupId, targetSpaceId) {
  /** 当前激活空间。 */
  const sourceSpace = getActiveSpace();
  /** 目标空间。 */
  const targetSpace = state.data.spaces.find((space) => space.id === targetSpaceId);
  /** 待移动分组索引。 */
  const sourceGroupIndex = sourceSpace ? sourceSpace.groups.findIndex((group) => group.id === groupId) : -1;

  if (!sourceSpace || !targetSpace || sourceSpace.id === targetSpace.id || sourceGroupIndex < 0) {
    return;
  }

  /** 待移动分组。 */
  const group = sourceSpace.groups[sourceGroupIndex];
  /** 分组链接数量。 */
  const linkCount = Array.isArray(group.links) ? group.links.length : 0;
  /** 确认弹窗提示文本。 */
  const confirmMessage = `将把“${group.name}”移动到“${targetSpace.name}”。\n该分组包含 ${linkCount} 个链接，移动后当前空间将不再显示它。\n分组名称会保持不变，是否继续？`;
  /** 用户是否确认移动。 */
  const confirmed = await showConfirm(confirmMessage, "移动分组");

  if (!confirmed) {
    state.movingGroupId = "";
    root.MyTabDeskRender.renderGroups();
    return;
  }

  state.data = moveGroupBetweenSpaces(state.data, sourceSpace.id, targetSpace.id, group.id);
  state.movingGroupId = "";
  state.draggedGroupId = "";

  await persistWithDirty();
  root.MyTabDeskRender.renderAll();
  await showAlert(`已将“${group.name}”移动到“${targetSpace.name}”，分组名称未修改。`, "移动完成");
}

/**
 * 修改当前空间内的分组名称。
 *
 * @param {string} groupId 分组 ID。
 * @param {string} name 用户输入的新分组名称。
 * @returns {Promise<void>} 修改并保存后结束。
 */
async function renameGroup(groupId, name) {
  /** 当前激活空间。 */
  const activeSpace = getActiveSpace();
  /** 待重命名的分组。 */
  const group = findGroupInSpace(activeSpace, groupId);

  if (!group) {
    return;
  }

  /** 去除前后空格后的分组名称。 */
  const trimmedName = String(name || "").trim();
  state.editingGroupId = "";

  if (!trimmedName || trimmedName === group.name) {
    root.MyTabDeskRender.renderGroups();
    return;
  }

  group.name = trimmedName;
  group.updatedAt = getCurrentTime();
  activeSpace.updatedAt = getCurrentTime();

  await persistWithDirty();
  root.MyTabDeskRender.renderAll();
}

async function setGroupColor(groupId, color) {
  const activeSpace = getActiveSpace();
  const group = findGroupInSpace(activeSpace, groupId);
  if (!activeSpace || !group) return;
  const changedAt = getCurrentTime();
  group.color = app.normalizeColor(color);
  group.updatedAt = changedAt;
  activeSpace.updatedAt = changedAt;
  await persistWithDirty();
  root.MyTabDeskRender.renderAll();
}

/**
 * 打开编辑链接弹窗。
 *
 * @param {string} groupId 链接所属分组 ID。
 * @param {string} linkId 链接 ID。
 * @returns {void}
 */
function openEditLinkDialog(groupId, linkId) {
  /** 当前激活空间。 */
  const activeSpace = getActiveSpace();
  /** 链接所属分组。 */
  const group = findGroupInSpace(activeSpace, groupId);
  /** 待编辑链接。 */
  const link = findLinkInGroup(group, linkId);

  if (!activeSpace || !group || !link) {
    return;
  }

  state.editingLinkContext = {
    spaceId: activeSpace.id,
    groupId,
    linkId
  };
  state.openLinkMenuId = "";
  elements.editLinkTitleInput.value = link.title || "";
  elements.editLinkUrlInput.value = link.url || "";
  elements.editLinkIconInput.value = link.favIconUrl || "";
  elements.editLinkNoteInput.value = link.note || "";
  elements.editLinkColorInput.value = link.color || "";
  elements.editLinkError.textContent = "";
  elements.editLinkDialog.hidden = false;
  root.MyTabDeskRender.renderGroups();
  requestAnimationFrame(() => {
    elements.editLinkTitleInput.focus();
    elements.editLinkTitleInput.select();
  });
}

/**
 * 强制刷新单个链接图标。仅更新内存中的刷新时间戳，不持久化到 storage。
 *
 * @param {string} groupId 链接所属分组 ID。
 * @param {string} linkId 链接 ID。
 * @returns {void}
 */
function refreshLinkIcon(groupId, linkId) {
  /** 当前激活空间。 */
  const activeSpace = getActiveSpace();
  /** 链接所属分组。 */
  const group = findGroupInSpace(activeSpace, groupId);
  /** 待刷新链接。 */
  const link = findLinkInGroup(group, linkId);

  if (!activeSpace || !group || !link) {
    return;
  }

  state.faviconRefreshAt[linkId] = Date.now();
  state.openLinkMenuId = "";
  root.MyTabDeskRender.renderGroups();
}

/**
 * 强制刷新指定分组内全部链接图标。仅更新内存中的刷新时间戳，不持久化到 storage。
 *
 * @param {string} groupId 分组 ID。
 * @returns {void}
 */
function refreshGroupIcons(groupId) {
  /** 当前激活空间。 */
  const activeSpace = getActiveSpace();
  /** 待刷新图标的分组。 */
  const group = findGroupInSpace(activeSpace, groupId);

  if (!activeSpace || !group || !Array.isArray(group.links)) {
    return;
  }

  const refreshAt = Date.now();
  for (const link of group.links) {
    if (link && link.id) {
      state.faviconRefreshAt[link.id] = refreshAt;
    }
  }
  root.MyTabDeskRender.renderGroups();
}

/**
 * 关闭编辑链接弹窗。
 *
 * @returns {void}
 */
function closeEditLinkDialog() {
  state.editingLinkContext = null;
  elements.editLinkTitleInput.value = "";
  elements.editLinkUrlInput.value = "";
  elements.editLinkIconInput.value = "";
  elements.editLinkNoteInput.value = "";
  elements.editLinkColorInput.value = "";
  elements.editLinkError.textContent = "";
  elements.editLinkDialog.hidden = true;
}

/**
 * 提交编辑链接弹窗。
 *
 * @returns {Promise<void>} 保存完成后结束。
 */
async function submitEditLinkDialog() {
  if (!state.editingLinkContext) {
    closeEditLinkDialog();
    return;
  }

  /** 去除前后空格后的链接标题。 */
  const title = elements.editLinkTitleInput.value.trim();
  /** 去除前后空格后的链接地址。 */
  const url = elements.editLinkUrlInput.value.trim();
  /** 去除前后空格后的链接图标地址。 */
  const favIconUrl = elements.editLinkIconInput.value.trim();

  if (!url) {
    elements.editLinkError.textContent = "请输入链接地址。";
    elements.editLinkUrlInput.focus();
    return;
  }

  if (!isValidTabUrl(url)) {
    elements.editLinkError.textContent = "仅支持保存 http 或 https 网页地址。";
    elements.editLinkUrlInput.focus();
    return;
  }

  state.data = updateLink(state.data, state.editingLinkContext.spaceId, state.editingLinkContext.groupId, state.editingLinkContext.linkId, {
    title: title || url,
    url,
    favIconUrl,
    note: elements.editLinkNoteInput.value.trim(),
    color: elements.editLinkColorInput.value
  });
  closeEditLinkDialog();
  await persistWithDirty();
  root.MyTabDeskRender.renderAll();
}

/**
 * 删除指定链接。
 *
 * @param {string} groupId 分组 ID。
 * @param {string} linkId 链接 ID。
 * @returns {Promise<void>} 删除并保存后结束。
 */
async function deleteLink(groupId, linkId) {
  /** 当前激活空间。 */
  const activeSpace = getActiveSpace();
  /** 目标分组。 */
  const group = findGroupInSpace(activeSpace, groupId);
  /** 目标链接。 */
  const link = findLinkInGroup(group, linkId);

  if (!activeSpace || !group || !link) {
    return;
  }

  state.openLinkMenuId = "";
  root.MyTabDeskRender.renderGroups();

  /** 用户删除确认结果。 */
  const confirmed = await showConfirm(`确定删除链接「${link.title || link.url}」吗？`);

  if (!confirmed) {
    return;
  }

  group.links = group.links.filter((item) => item.id !== linkId);
  // 写入删除墓碑，用于跨设备同步时阻止已删除链接被旧远端数据复活
  group.links.push({ ...link, deletedAt: getCurrentTime(), updatedAt: getCurrentTime() });
  group.updatedAt = getCurrentTime();
  activeSpace.updatedAt = getCurrentTime();
  state.selectedLinkIds.delete(linkId);
  await persistWithDirty();
  root.MyTabDeskRender.renderAll();
  root.MyTabDeskNotifications.showInAppToast(`已删除“${link.title || link.url}”`, "success", 5000, {
    actionText: "撤销",
    onAction: async () => {
      state.data = app.restoreTrashItem(state.data, {
        type: "link",
        spaceId: activeSpace.id,
        groupId,
        linkId
      });
      await persistWithDirty();
      root.MyTabDeskRender.renderAll();
    }
  });
}


/**
 * 打开链接。
 *
 * @param {string} url 链接地址。
 * @returns {Promise<void>} 打开完成后结束。
 */
async function openLink(url) {
  if (!isValidTabUrl(url)) {
    await showAlert("仅支持打开 http 或 https 网页地址。", "无法打开");
    return;
  }

  if (hasChromeTabs()) {
    await chrome.tabs.create({ url });
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * 打开指定分组中的全部链接。
 *
 * @param {string} groupId 分组 ID。
 * @returns {Promise<void>} 打开完成后结束。
 */
async function openGroup(groupId) {
  /** 当前激活空间。 */
  const activeSpace = getActiveSpace();
  /** 目标分组。 */
  const group = findGroupInSpace(activeSpace, groupId);

  /** 可打开的活动链接。 */
  const liveLinks = group && Array.isArray(group.links) ? group.links.filter((link) => !link.deletedAt) : [];

  if (liveLinks.length === 0) {
    await showAlert("该分组没有可打开的链接。", "无法打开");
    return;
  }

  for (const link of liveLinks) {
    if (isValidTabUrl(link.url)) {
      await openLink(link.url);
    }
  }
}

/**
 * 刷新右侧当前窗口标签页列表。
 *
 * @returns {Promise<void>} 刷新完成后结束。
 */
async function refreshCurrentTabs() {
  if (!hasChromeTabs()) {
    state.currentTabs = [];
    root.MyTabDeskRender.renderCurrentTabs();
    return;
  }

  /** 当前浏览器窗口中的标签页。 */
  const tabs = await chrome.tabs.query({
    currentWindow: true
  });

  state.currentTabs = tabs.filter((tab) => isValidTabUrl(tab.url)).map((tab) => ({
    tabId: tab.id,
    windowId: tab.windowId,
    title: tab.title || tab.url,
    url: tab.url,
    favIconUrl: tab.favIconUrl || ""
  }));

  root.MyTabDeskRender.renderCurrentTabs();
}

/**
 * 激活指定浏览器标签页。
 *
 * @param {number} tabId 标签页 ID。
 * @returns {Promise<void>} 激活完成后结束。
 */
async function activateTab(tabId) {
  if (!hasChromeTabs()) {
    return;
  }

  await chrome.tabs.update(tabId, {
    active: true
  });
}

/**
 * 将当前窗口全部普通网页标签页保存到指定分组。
 *
 * @returns {Promise<boolean>} 成功保存时返回 true。
 */
async function saveCurrentTabsToGroup() {
  /** 当前激活空间。 */
  const activeSpace = getActiveSpace();

  if (!activeSpace) {
    return false;
  }

  if (!Array.isArray(state.currentTabs) || state.currentTabs.length === 0) {
    await showAlert("当前窗口没有可保存的普通网页标签。", "无法保存");
    return false;
  }

  ensureActiveSpaceHasGroup(activeSpace);
  /** 当前空间中未被删除的可用分组列表。 */
  const liveGroups = activeSpace.groups.filter((group) => !group.deletedAt);

  if (liveGroups.length === 0) {
    await showAlert("请先创建一个分组，再保存当前窗口标签。", "无法保存");
    return false;
  }

  /** 当前空间中可选择的分组列表。 */
  const groupNames = liveGroups.map((group, index) => `${index + 1}. ${group.name}`);
  /** 用户输入的分组序号。 */
  const answer = await showPrompt(`请选择保存到哪个分组：\n${groupNames.join("\n")}`, "1", "保存当前窗口标签");

  if (answer === null) {
    return false;
  }

  /** 用户输入对应的分组序号。 */
  const index = Number(answer) - 1;
  /** 目标分组。 */
  const targetGroup = liveGroups[index];

  if (!targetGroup) {
    await showAlert("请输入有效的分组序号。", "无法保存");
    return false;
  }

  state.data = addLinksToGroup(state.data, activeSpace.id, targetGroup.id, tabsToLinks(state.currentTabs));
  await persistWithDirty();
  recordSaveUsage(state.currentTabs.length, activeSpace.id);
  root.MyTabDeskRender.renderAll();
  await showAlert(`已保存到分组「${targetGroup.name}」。`);
  return true;
}

/** 保存当前窗口标签后关闭或休眠安全目标。 */
async function saveCurrentTabsAndCleanup(mode) {
  const savedTabs = state.currentTabs
    .filter((tab) => Number.isInteger(tab.tabId) && Number.isInteger(tab.windowId))
    .map((tab) => ({ tabId: tab.tabId, url: tab.url, windowId: tab.windowId }));
  const saved = await saveCurrentTabsToGroup();
  if (!saved) return false;
  const response = await chrome.runtime.sendMessage({
    type: mode === "close" ? "close-saved-tabs" : "discard-saved-tabs",
    savedTabs
  });
  if (!response || !response.success) {
    await showAlert(response && response.error || "标签处理失败，已保存的数据不会丢失。", "处理失败");
    return false;
  }
  await refreshCurrentTabs();
  root.MyTabDeskNotifications.showToast(
    mode === "close" ? `已关闭 ${response.affected} 个标签` : `已休眠 ${response.affected} 个标签`,
    "success"
  );
  return true;
}

function saveCurrentTabsAndClose() {
  return saveCurrentTabsAndCleanup("close");
}

function saveCurrentTabsAndDiscard() {
  return saveCurrentTabsAndCleanup("discard");
}

/**
 * 将单个当前标签页保存到指定分组。
 *
 * @param {object} tab 当前标签页数据。
 * @returns {Promise<void>} 保存完成后结束。
 */
async function saveSingleTabToGroup(tab) {
  /** 当前激活空间。 */
  const activeSpace = getActiveSpace();

  if (!activeSpace) {
    return;
  }

  ensureActiveSpaceHasGroup(activeSpace);
  /** 当前空间中未被删除的可用分组列表。 */
  const liveGroups = activeSpace.groups.filter((group) => !group.deletedAt);

  if (liveGroups.length === 0) {
    await showAlert("请先创建一个分组，再保存当前标签。", "无法保存");
    return;
  }

  /** 当前空间中可选择的分组列表。 */
  const groupNames = liveGroups.map((group, index) => `${index + 1}. ${group.name}`);
  /** 用户输入的分组序号。 */
  const answer = await showPrompt(`请选择保存到哪个分组：\n${groupNames.join("\n")}`, "1", "保存当前标签");

  if (answer === null) {
    return;
  }

  /** 用户输入对应的分组序号。 */
  const index = Number(answer) - 1;
  /** 目标分组。 */
  const targetGroup = liveGroups[index];

  if (!targetGroup) {
    await showAlert("请输入有效的分组序号。", "无法保存");
    return;
  }

  state.data = addLinksToGroup(state.data, activeSpace.id, targetGroup.id, tabsToLinks([tab]));
  await persistWithDirty();
  recordSaveUsage(1, activeSpace.id);
  root.MyTabDeskRender.renderAll();
  await showAlert(`已保存标签到分组「${targetGroup.name}」。`);
}

/**
 * 下载文本文件到本地。
 *
 * @param {string} filename 文件名。
 * @param {string} content 文件文本内容。
 * @returns {void}
 */
function downloadTextFile(filename, content) {
  /** 下载文件 Blob 对象。 */
  const blob = new Blob([content], {
    type: "application/json;charset=utf-8"
  });
  /** 临时对象 URL。 */
  const url = URL.createObjectURL(blob);
  /** 临时下载链接。 */
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * 导出当前工作台数据。
 *
 * @returns {void}
 */
function exportCurrentData() {
  /** 备份文件名。 */
  const filename = `mytabdesk-backup-${formatDateTime(getCurrentTime()).replace(/[: ]/g, "-")}.json`;
  downloadTextFile(filename, exportNativeBackup(state.data));

  // 显示导出成功通知
  if (root.MyTabDeskNotifications) {
    root.MyTabDeskNotifications.notifySuccess("导出成功", "完整备份已导出到文件");
  }
}

/**
 * 导出仅用于兼容 TabTab 的可见空间、分组和链接数据。
 *
 * @returns {void}
 */
function exportTabTabData() {
  const filename = `mytabdesk-tabtab-${formatDateTime(getCurrentTime()).replace(/[: ]/g, "-")}.json`;
  downloadTextFile(filename, exportData(state.data));

  if (root.MyTabDeskNotifications) {
    root.MyTabDeskNotifications.notifySuccess("导出成功", "TabTab 兼容数据已导出");
  }
}

/**
 * 导出指定空间数据。
 *
 * @param {string} spaceId 空间 ID。
 * @returns {void}
 */
function exportSpace(spaceId) {
  /** 待导出的空间。 */
  const space = findSpace(state.data, spaceId);

  if (!space) {
    return;
  }

  /** 当前时间戳。 */
  const now = getCurrentTime();
  /** 空间导出文件名。 */
  const filename = `mytabdesk-space-${space.name}-${formatDateTime(now).replace(/[: ]/g, "-")}.json`;
  /** 空间导出数据包。 */
  const visibleSpace = createVisibleWorkspaceData({
    version: state.data.version,
    activeSpaceId: space.id,
    spaces: [space],
    settings: state.data.settings
  }).spaces[0];
  const payload = JSON.stringify({
    backupVersion: app.BACKUP_VERSION,
    appVersion: app.APP_VERSION,
    exportedAt: now,
    type: "space",
    space: visibleSpace
  }, null, 2);

  state.openSpaceMenuId = "";
  root.MyTabDeskRender.renderSpaces();
  downloadTextFile(filename, payload);
}

/**
 * 转义 HTML 特殊字符，防止 XSS。
 *
 * 转义 < > & " ' 五个字符，使用 textContent 等价的方式构建安全字符串。
 * 单独抽出以便复用且可被静态测试覆盖。
 *
 * @param {string} text 原始文本。
 * @returns {string} 转义后的安全文本，可安全拼入 HTML。
 */
function escapeHtml(text) {
  /** 转义映射表，覆盖 < > & " ' 五个高危字符。 */
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };
  return String(text == null ? "" : text).replace(/[&<>"']/g, (ch) => map[ch]);
}

/**
 * 导出当前激活空间为完全独立的可分享 HTML 页面。
 *
 * 生成内联 CSS、不依赖任何外部资源的 HTML 文件，包含空间名、
 * 每个分组的名称及其中链接（标题、URL、备注）。链接可直接点击打开。
 * 跳过已标记删除（deletedAt）的分组与链接。使用 escapeHtml 构建安全字符串，
 * 不使用 innerHTML，避免 XSS。
 *
 * @returns {void}
 */
function exportSpaceAsHtml() {
  /** 当前激活空间。 */
  const space = getActiveSpace();

  if (!space) {
    if (root.MyTabDeskNotifications) {
      root.MyTabDeskNotifications.notifyError("导出失败", "没有可导出的空间");
    }
    return;
  }

  // 关闭已打开的"更多"菜单
  state.openSpaceMenuId = "";
  root.MyTabDeskRender.renderSpaces();

  /** 导出时间戳。 */
  const now = getCurrentTime();
  /** 空间名（已转义）。 */
  const spaceName = escapeHtml(space.name);
  /** 文件名中的安全空间名，剔除文件系统非法字符。 */
  const safeNameForFile = String(space.name).replace(/[<>:"/\\|?*]/g, "_").trim() || "space";
  /** 导出文件名。 */
  const filename = `mytabdesk-${safeNameForFile}-${formatDateTime(now).replace(/[: ]/g, "-")}.html`;
  /** 导出时间显示文本（已转义）。 */
  const exportTime = escapeHtml(formatDateTime(now));

  // 构建分组 HTML 片段，跳过已删除分组
  const groupsHtml = (space.groups || [])
    .filter((group) => !group.deletedAt)
    .map((group) => {
      /** 分组名（已转义）。 */
      const groupName = escapeHtml(group.name);
      // 构建链接列表，跳过已删除链接
      const linksHtml = (group.links || [])
        .filter((link) => !link.deletedAt)
        .map((link) => {
          /** 链接标题（已转义）。 */
          const title = escapeHtml(link.title || link.url || "");
          /** 链接 URL（已转义）。 */
          const url = escapeHtml(link.url || "");
          /** 备注行（仅当存在备注时渲染）。 */
          const noteLine = link.note
            ? `        <div class="link-note">${escapeHtml(link.note)}</div>\n`
            : "";
          return `      <li class="link-item">
        <a class="link-title" href="${url}" target="_blank" rel="noopener noreferrer">${title}</a>
        <div class="link-url">${url}</div>
${noteLine}      </li>`;
        })
        .join("\n");

      /** 分组内链接计数。 */
      const count = (group.links || []).filter((link) => !link.deletedAt).length;
      /** 空分组占位文本。 */
      const placeholder = linksHtml
        ? ""
        : '      <p class="empty-hint">此分组暂无链接</p>';

      return `    <section class="group">
      <h2 class="group-name">${groupName} <span class="group-count">(${count})</span></h2>
      <ul class="link-list">
${linksHtml}
      </ul>
${placeholder}
    </section>`;
    })
    .join("\n");

  /** 完整独立 HTML，内联 CSS、无外部依赖。 */
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${spaceName} - MyTabDesk</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f5f5f7;
      --card: #ffffff;
      --text: #1d1d1f;
      --muted: #6e6e73;
      --border: #d2d2d7;
      --accent: #0071e3;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1c1c1e;
        --card: #2c2c2e;
        --text: #f5f5f7;
        --muted: #98989d;
        --border: #3a3a3c;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
    }
    .container {
      max-width: 820px;
      margin: 0 auto;
      padding: 32px 20px 64px;
    }
    header.page-header {
      margin-bottom: 32px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
    }
    header.page-header h1 {
      margin: 0 0 6px;
      font-size: 28px;
      font-weight: 700;
    }
    header.page-header .meta {
      color: var(--muted);
      font-size: 13px;
    }
    header.page-header .badge {
      display: inline-block;
      margin-bottom: 8px;
      padding: 2px 10px;
      background: var(--accent);
      color: #fff;
      border-radius: 10px;
      font-size: 12px;
      letter-spacing: 0.3px;
    }
    .group {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px 24px;
      margin-bottom: 20px;
    }
    .group-name {
      margin: 0 0 16px;
      font-size: 18px;
      font-weight: 600;
    }
    .group-count {
      color: var(--muted);
      font-weight: 400;
      font-size: 14px;
    }
    .link-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .link-item {
      padding: 12px 0;
      border-top: 1px solid var(--border);
    }
    .link-item:first-child {
      border-top: none;
      padding-top: 0;
    }
    .link-title {
      color: var(--accent);
      text-decoration: none;
      font-weight: 500;
      font-size: 15px;
      word-break: break-word;
    }
    .link-title:hover {
      text-decoration: underline;
    }
    .link-url {
      margin-top: 2px;
      color: var(--muted);
      font-size: 13px;
      word-break: break-all;
    }
    .link-note {
      margin-top: 4px;
      color: var(--text);
      font-size: 13px;
      opacity: 0.85;
    }
    .empty-hint {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
      font-style: italic;
    }
    footer.page-footer {
      margin-top: 40px;
      padding-top: 16px;
      border-top: 1px solid var(--border);
      color: var(--muted);
      font-size: 12px;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <header class="page-header">
      <span class="badge">MyTabDesk 空间导出</span>
      <h1>${spaceName}</h1>
      <div class="meta">导出于 ${exportTime}</div>
    </header>
    <main>
${groupsHtml}
    </main>
    <footer class="page-footer">
      由 MyTabDesk 生成 · 此页面为静态独立文件，可离线分享
    </footer>
  </div>
</body>
</html>`;

  downloadTextFile(filename, html);

  if (root.MyTabDeskNotifications) {
    root.MyTabDeskNotifications.notifySuccess("导出成功", "空间已导出为 HTML 页面");
  }
}

/**
 * 请求选择导入文件。
 *
 * @returns {void}
 */
function requestImportData() {
  state.importMode = "data";
  elements.importFileInput.value = "";
  elements.importFileInput.click();
}

/**
 * 请求选择单空间导入文件。
 *
 * @returns {void}
 */
function requestImportSpace() {
  state.importMode = "space";
  state.createSpaceMenuOpen = false;
  elements.createSpaceMenu.hidden = true;
  elements.importFileInput.value = "";
  elements.importFileInput.click();
}

/**
 * 导入用户选择的 JSON 备份文件。
 *
 * @param {Event} event 文件选择事件。
 * @returns {Promise<void>} 导入完成后结束。
 */
async function importSelectedFile(event) {
  /** 用户选择的文件。 */
  const file = event.target.files && event.target.files[0];

  if (!file) {
    return;
  }

  try {
    /** 文件文本内容。 */
    const text = await file.text();

    if (state.importMode === "space") {
      await importSpaceFromText(text);
      return;
    }

    /** 解析并迁移后的导入数据。 */
    const importedData = importData(text);
    /** 导入数据与本地数据的冲突检测结果。 */
    const conflict = detectImportConflict(state.data, importedData);
    /** 覆盖当前数据前的确认提示列表。 */
    const confirmMessages = ["导入会覆盖当前所有本地数据，确定继续吗？"];

    if (conflict.isOlder) {
      confirmMessages.push("导入文件可能旧于当前本地数据，继续导入可能覆盖新数据。");
    }

    if (conflict.isDifferentDevice) {
      confirmMessages.push("该备份来自另一台设备。");
    }

    /** 覆盖当前数据前的用户确认结果。 */
    const confirmed = await showConfirm(confirmMessages.join("\n"));

    if (!confirmed) {
      return;
    }

    state.data = importedData;
    state.data.settings.sync.lastImportAt = getCurrentTime();
    markSyncStateDirty(["lastImportAt"]);
    state.selectedLinkIds.clear();
    state.batchDeleteEnabled = false;
    state.lastWorkspaceSnapshot = createWorkspaceSnapshot();
    await persistWithDirtySkipSync({ replaceStoredData: true });
    root.MyTabDeskRender.renderAll();
    await showAlert("数据导入成功。");
  } catch (error) {
    let errorMessage = "数据导入失败，请检查文件内容。";
    if (error.message) {
      if (error.message.includes("JSON")) {
        errorMessage = "文件格式错误，请选择有效的 JSON 文件。";
      } else if (error.message.includes("version")) {
        errorMessage = "备份文件版本不支持，请升级应用。";
      } else {
        errorMessage = "导入失败：" + error.message;
      }
    }
    await showAlert(errorMessage);
  } finally {
    state.importMode = "data";
  }
}

/**
 * 从文本导入单个空间。
 *
 * @param {string} text 单空间 JSON 文本。
 * @returns {Promise<void>} 导入完成后结束。
 * @throws {Error} 当文件内容不是有效空间导出文件时抛出错误。
 */
async function importSpaceFromText(text) {
  /** 解析后的空间导入包。 */
  let parsedData;

  try {
    parsedData = JSON.parse(text);
  } catch (error) {
    throw new Error("导入空间文件不是有效的 JSON", { cause: error });
  }

  /** 待导入的空间数据。 */
  const importedSpace = parsedData && parsedData.type === "space" && parsedData.space ? parsedData.space : null;

  if (!importedSpace || !importedSpace.name || !Array.isArray(importedSpace.groups)) {
    throw new Error("请选择由导出空间功能生成的 JSON 文件。");
  }

  /** 去除前后空格后的空间名称。 */
  const trimmedName = importedSpace.name.trim();
  /** 是否已存在同名空间。 */
  const nameExists = state.data.spaces.some((space) => space.name.trim() === trimmedName);

  if (nameExists) {
    throw new Error("空间名称已存在，请先重命名后再导入。");
  }

  /** 当前时间戳。 */
  const now = getCurrentTime();
  /** 标准化后的临时数据。 */
  const normalizedData = normalizeData({
    version: 1,
    activeSpaceId: importedSpace.id || createId("space"),
    spaces: [
      {
        ...importedSpace,
        id: importedSpace.id || createId("space"),
        name: trimmedName,
        icon: importedSpace.icon || app.UI_DEFAULT_SPACE_ICON,
        createdAt: importedSpace.createdAt || now,
        updatedAt: importedSpace.updatedAt || now
      }
    ],
    settings: {}
  });
  /** 标准化后的空间。 */
  const space = normalizedData.spaces[0];

  state.data.spaces.push(space);
  state.data.activeSpaceId = space.id;
  await persistWithDirty();
  root.MyTabDeskRender.renderAll();
  await showAlert("空间导入成功。");
}

/**
 * 清空所有数据并恢复默认空间。
 *
 * @returns {Promise<void>} 清空并保存后结束。
 */
async function clearData() {
  /** 清空数据前的用户确认结果。 */
  const confirmed = await showConfirm("确定清空所有数据并恢复默认空间吗？该操作不可撤销，建议先导出备份。");

  if (!confirmed) {
    return;
  }

  const clearedData = clearAllData();
  const clearedAt = getCurrentTime();
  const freshSpace = clearedData.spaces[0];
  // 清空工作台内容不应清除本地同步连接配置，否则删除墓碑无法继续上传。
  clearedData.settings = state.data.settings;
  freshSpace.id = createId("space");
  freshSpace.createdAt = clearedAt;
  freshSpace.updatedAt = clearedAt;
  clearedData.activeSpaceId = freshSpace.id;
  clearedData.spaces.push(...state.data.spaces.map((space) => ({
    ...space,
    deletedAt: clearedAt,
    updatedAt: clearedAt
  })));
  state.data = clearedData;
  state.selectedLinkIds.clear();
  state.batchDeleteEnabled = false;
  await persistWithDirty();
  root.MyTabDeskRender.renderAll();
}

/**
 * 切换浅色和深色主题。
 *
 * @returns {Promise<void>} 切换并保存后结束。
 */
async function toggleTheme() {
  state.data.settings.theme = state.data.settings.theme === "dark" ? "light" : "dark";
  markSettingsDirty();
  await persistWithDirty();
  root.MyTabDeskRender.renderAll();
}

/**
 * 切换左侧空间栏折叠状态。
 *
 * @returns {Promise<void>} 切换并保存后结束。
 */
async function toggleSidebar() {
  state.data.settings.sidebarCollapsed = !state.data.settings.sidebarCollapsed;
  markSettingsDirty();
  await persistWithDirty();
  root.MyTabDeskRender.renderAll();
}

/**
 * 切换右侧标签页栏折叠状态。
 *
 * @returns {Promise<void>} 切换并保存后结束。
 */
async function toggleTabsPanel() {
  state.data.settings.rightPanelCollapsed = !state.data.settings.rightPanelCollapsed;
  markSettingsDirty();
  await persistWithDirty();
  root.MyTabDeskRender.renderAll();
}

/**
 * 切换链接卡片紧凑视图（隐藏域名、缩小卡片高度，单页容纳更多链接）。
 *
 * @returns {Promise<void>} 切换并保存后结束。
 */
async function toggleCompactLinks() {
  state.data.settings.compactLinks = !state.data.settings.compactLinks;
  markSettingsDirty();
  await persistWithDirty();
  root.MyTabDeskRender.renderAll();
}

/**
 * 切换批量删除模式。
 *
 * @returns {void}
 */
function toggleBatchDelete() {
  state.batchDeleteEnabled = !state.batchDeleteEnabled;

  if (!state.batchDeleteEnabled) {
    state.selectedLinkIds.clear();
  }

  root.MyTabDeskRender.renderAll();
}

/**
 * 切换指定链接的批量选择状态。
 *
 * @param {string} linkId 链接 ID。
 * @returns {void}
 */
function toggleSelectedLink(linkId) {
  if (state.selectedLinkIds.has(linkId)) {
    state.selectedLinkIds.delete(linkId);
  } else {
    state.selectedLinkIds.add(linkId);
  }

  root.MyTabDeskRender.renderGroups();
}

/**
 * 确认删除批量选中的链接。
 *
 * @returns {Promise<void>} 删除并保存后结束。
 */
async function confirmBatchDelete() {
  if (state.selectedLinkIds.size === 0) {
    await showAlert("请先选择需要删除的链接。");
    return;
  }

  /** 批量删除前的用户确认结果。 */
  const confirmed = await showConfirm(`确定删除选中的 ${state.selectedLinkIds.size} 个链接吗？`);

  if (!confirmed) {
    return;
  }

  /** 当前激活空间。 */
  const activeSpace = getActiveSpace();
  const deletedAt = getCurrentTime();

  for (const group of activeSpace.groups) {
    group.links = group.links.map((link) => state.selectedLinkIds.has(link.id)
      ? { ...link, deletedAt, updatedAt: deletedAt }
      : link);
    group.updatedAt = deletedAt;
  }

  activeSpace.updatedAt = deletedAt;
  state.selectedLinkIds.clear();
  state.batchDeleteEnabled = false;
  await persistWithDirty();
  root.MyTabDeskRender.renderAll();
}

/**
 * 处理空间拖拽放置。
 *
 * @param {string} targetSpaceId 放置目标空间 ID。
 * @returns {Promise<void>} 重排并保存后结束。
 */
async function handleSpaceDrop(targetSpaceId) {
  if (!state.draggedSpaceId || state.draggedSpaceId === targetSpaceId) {
    return;
  }

  state.data = reorderSpaces(state.data, state.draggedSpaceId, targetSpaceId);
  state.draggedSpaceId = "";
  await persistWithDirty();
  root.MyTabDeskRender.renderAll();
}

/**
 * 处理分组拖拽放置，或从右栏拖入标签页。
 *
 * @param {string} spaceId 空间 ID。
 * @param {string} targetGroupId 放置目标分组 ID。
 * @returns {Promise<void>} 放置处理完成后结束。
 */
async function handleGroupDrop(spaceId, targetGroupId) {
  if (state.draggedTab) {
    await addDraggedTabToGroup(spaceId, targetGroupId);
    return;
  }

  if (!state.draggedGroupId || state.draggedGroupId === targetGroupId) {
    return;
  }

  /** 当前操作空间。 */
  const space = findSpace(state.data, spaceId);
  /** 正在拖拽的分组。 */
  const sourceGroup = findGroupInSpace(space, state.draggedGroupId);
  /** 放置目标分组。 */
  const targetGroup = findGroupInSpace(space, targetGroupId);

  if (!sourceGroup || !targetGroup || sourceGroup.pinned || targetGroup.pinned) {
    state.draggedGroupId = "";
    root.MyTabDeskRender.renderGroups();
    return;
  }

  state.data = reorderGroups(state.data, spaceId, state.draggedGroupId, targetGroupId);
  state.draggedGroupId = "";
  await persistWithDirty();
  root.MyTabDeskRender.renderAll();
}

/**
 * 处理链接网格空白区域放置。
 *
 * @param {string} spaceId 空间 ID。
 * @param {string} groupId 分组 ID。
 * @returns {Promise<void>} 放置处理完成后结束。
 */
async function handleLinkGridDrop(spaceId, groupId) {
  if (state.draggedTab) {
    await addDraggedTabToGroup(spaceId, groupId);
    return;
  }

  if (!state.draggedLink || state.draggedLink.groupId === groupId) {
    return;
  }

  state.data = moveLinkBetweenGroups(state.data, spaceId, state.draggedLink.groupId, groupId, state.draggedLink.linkId, "");
  state.draggedLink = null;
  await persistWithDirty();
  root.MyTabDeskRender.renderAll();
}

/**
 * 处理链接卡片拖拽放置。
 *
 * @param {string} groupId 分组 ID。
 * @param {string} targetLinkId 放置目标链接 ID。
 * @returns {Promise<void>} 重排或添加完成后结束。
 */
async function handleLinkDrop(groupId, targetLinkId) {
  /** 当前激活空间。 */
  const activeSpace = getActiveSpace();

  if (state.draggedTab) {
    await addDraggedTabToGroup(activeSpace.id, groupId);
    return;
  }

  if (!state.draggedLink || state.draggedLink.linkId === targetLinkId) {
    return;
  }

  if (state.draggedLink.groupId !== groupId) {
    state.data = moveLinkBetweenGroups(state.data, activeSpace.id, state.draggedLink.groupId, groupId, state.draggedLink.linkId, targetLinkId);
    state.draggedLink = null;
    await persistWithDirty();
    root.MyTabDeskRender.renderAll();
    return;
  }

  state.data = reorderLinks(state.data, activeSpace.id, groupId, state.draggedLink.linkId, targetLinkId);
  state.draggedLink = null;
  await persistWithDirty();
  root.MyTabDeskRender.renderAll();
}

/**
 * 将右侧拖拽中的标签页添加到指定分组。
 *
 * @param {string} spaceId 空间 ID。
 * @param {string} groupId 分组 ID。
 * @returns {Promise<void>} 添加并保存后结束。
 */
async function addDraggedTabToGroup(spaceId, groupId) {
  if (!state.draggedTab) {
    return;
  }

  state.data = addLinksToGroup(state.data, spaceId, groupId, tabsToLinks([state.draggedTab]));
  state.draggedTab = null;
  await persistWithDirty();
  recordSaveUsage(1, spaceId);
  root.MyTabDeskRender.renderAll();
}

/**
 * 切换到设置页视图。
 *
 * @returns {void}
 */
function openSettings() {
  state.viewMode = "settings";
  // 进入设置页时清除表单脏标记，确保用最新数据回填一次表单
  state.settingsFormDirty = false;
  root.MyTabDeskRender.renderAll();
  root.MyTabDeskLifecycle.loadLifecycleConfig().catch((error) => console.warn("读取生命周期设置失败:", error));
  root.MyTabDeskAiGrouping.loadConfigToForm().catch((error) => console.warn("读取 AI 分组配置失败:", error));
  loadScheduledSaveConfig().catch((error) => console.warn("读取定时保存配置失败:", error));
}

function loadScheduledSaveConfigOptions() {
  const spaces = state.data.spaces.filter((space) => !space.deletedAt);
  elements.scheduledSaveSpaceSelect.replaceChildren();
  for (const space of spaces) {
    const option = document.createElement("option");
    option.value = space.id;
    option.textContent = space.name;
    elements.scheduledSaveSpaceSelect.appendChild(option);
  }
  const selectedSpaceId = elements.scheduledSaveSpaceSelect.value || state.data.activeSpaceId;
  const space = spaces.find((item) => item.id === selectedSpaceId);
  elements.scheduledSaveGroupSelect.replaceChildren();
  if (space) {
    for (const group of space.groups.filter((group) => !group.deletedAt)) {
      const option = document.createElement("option");
      option.value = group.id;
      option.textContent = group.name;
      elements.scheduledSaveGroupSelect.appendChild(option);
    }
  }
}

async function loadScheduledSaveConfig() {
  const config = state.data.settings.scheduledSave || { enabled: false, time: "09:00", spaceId: "", groupId: "" };
  loadScheduledSaveConfigOptions();
  elements.scheduledSaveEnabledInput.checked = Boolean(config.enabled);
  elements.scheduledSaveTimeInput.value = config.time || "09:00";
  if (config.spaceId) elements.scheduledSaveSpaceSelect.value = config.spaceId;
  loadScheduledSaveConfigOptions();
  if (config.groupId) {
    elements.scheduledSaveGroupSelect.value = Array.from(elements.scheduledSaveGroupSelect.options).some((opt) => opt.value === config.groupId)
      ? config.groupId : "";
  }
}

async function saveScheduledSaveConfig() {
  const config = {
    enabled: elements.scheduledSaveEnabledInput.checked,
    time: elements.scheduledSaveTimeInput.value || "09:00",
    spaceId: elements.scheduledSaveSpaceSelect.value,
    groupId: elements.scheduledSaveGroupSelect.value
  };
  state.data.settings.scheduledSave = config;
  state.data.settings.updatedAt = getCurrentTime();
  await persistWithDirty();
  await chrome.runtime.sendMessage({ type: "set-scheduled-save-config", config });
  root.MyTabDeskNotifications.showToast("定时保存设置已保存", "success");
}

/**
 * 触发加密备份导出。
 *
 * @returns {Promise<void>} 导出完成后结束。
 */
async function handleExportEncryptedBackup() {
  /** 用户输入的备份密码。 */
  const password = elements.backupPasswordInput.value;

  if (!password) {
    await showAlert("请先输入备份密码。");
    return;
  }

  try {
    /** 当前同步设置中的设备 ID。 */
    const deviceId = state.data.settings.sync ? state.data.settings.sync.deviceId : "";
    /** 加密备份文本。 */
    const backupText = await createEncryptedBackup(state.data, password, deviceId);
    /** 备份文件名中的时间戳。 */
    const timestamp = new Date().toISOString().slice(0, 10);
    /** 下载用临时链接。 */
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([backupText], { type: "application/json" }));
    link.download = `mytabdesk-encrypted-${timestamp}.json`;
    link.click();
    URL.revokeObjectURL(link.href);

    state.data.settings.sync.lastBackupAt = getCurrentTime();
    markSyncStateDirty(["lastBackupAt"]);
    await persistWithDirtySkipSync();
    root.MyTabDeskRender.renderSettingsStatus();
    await showAlert("加密备份已导出。");
  } catch (error) {
    await showAlert("加密备份导出失败：" + (error.message || "未知错误"));
  }
}

/**
 * 请求选择加密备份文件进行导入。
 *
 * @returns {Promise<void>} 触发完成后结束。
 */
async function requestImportEncryptedBackup() {
  /** 用户输入的备份密码。 */
  const password = elements.backupPasswordInput.value;

  if (!password) {
    await showAlert("请先输入备份密码。");
    return;
  }

  elements.encryptedBackupFileInput.click();
}

/**
 * 处理选中的加密备份文件导入。
 *
 * @param {Event} event 文件选择事件。
 * @returns {Promise<void>} 导入完成后结束。
 */
async function importEncryptedBackupFile(event) {
  /** 用户选择的文件。 */
  const file = event.target.files && event.target.files[0];

  if (!file) {
    return;
  }

  /** 用户输入的备份密码。 */
  const password = elements.backupPasswordInput.value;

  if (!password) {
    await showAlert("请先输入备份密码。");
    elements.encryptedBackupFileInput.value = "";
    return;
  }

  try {
    /** 文件文本内容。 */
    const text = await file.text();
    /** 解密后的数据。 */
    const importedData = await restoreEncryptedBackup(text, password);
    /** 冲突检测结果。 */
    const conflict = detectImportConflict(state.data, importedData);

    if (conflict.requiresConfirm) {
      /** 冲突确认消息。 */
      const messages = [];

      if (conflict.isOlder) {
        messages.push("导入文件可能旧于当前本地数据，继续导入可能覆盖新数据。");
      }

      if (conflict.isDifferentDevice) {
        messages.push("该备份来自另一台设备。");
      }

      /** 是否继续导入冲突备份。 */
      const confirmed = await showConfirm(messages.join("\n") + "\n是否继续导入？");

      if (!confirmed) {
        elements.encryptedBackupFileInput.value = "";
        return;
      }
    }

    state.data = importedData;
    state.data.settings.sync.lastImportAt = getCurrentTime();
    markSyncStateDirty(["lastImportAt"]);
    state.lastWorkspaceSnapshot = createWorkspaceSnapshot();
    await persistWithDirtySkipSync({ replaceStoredData: true });
    root.MyTabDeskRender.renderAll();
    await showAlert("加密备份已成功导入。");
  } catch (error) {
    await showAlert("导入失败：" + (error.message || "密码错误或文件损坏"));
  }

  elements.encryptedBackupFileInput.value = "";
}

/**
 * 从外部（右键菜单）添加单个链接到第一个可用分组。
 *
 * @param {Object} externalData - 外部数据，包含 url, title, favIconUrl
 * @returns {Promise<void>} 添加完成后结束。
 */
async function addExternalLink(externalData) {
  if (!externalData || !externalData.url) {
    return;
  }

  /** 当前激活空间。 */
  const activeSpace = getActiveSpace();

  if (!activeSpace) {
    return;
  }

  /** 目标分组，默认为第一个可用分组。 */
  const targetGroup = ensureActiveSpaceHasGroup(activeSpace);

  if (!targetGroup) {
    return;
  }

  /** 链接数据。 */
  const linkData = {
    id: createId("link"),
    title: externalData.title || externalData.url,
    url: externalData.url,
    favIconUrl: externalData.favIconUrl || "",
    createdAt: getCurrentTime()
  };

  state.data = addLinksToGroup(state.data, activeSpace.id, targetGroup.id, [linkData]);
  await persistWithDirty();
  recordSaveUsage(1, activeSpace.id);
  root.MyTabDeskRender.renderAll();
}

async function saveCurrentSpaceAsTemplate() {
  const space = getActiveSpace();
  if (!space) return;
  const name = await showPrompt("请输入模板名称：", `${space.name}模板`, "保存为空间模板");
  if (name === null || !name.trim()) return;
  const template = app.normalizeSpaceTemplate({
    id: createId("template"),
    name: name.trim(),
    icon: space.icon,
    groups: space.groups.filter((group) => !group.deletedAt).map((group) => ({
      name: group.name,
      links: group.links.filter((link) => !link.deletedAt).map((link) => ({
        title: link.title,
        url: link.url,
        favIconUrl: link.favIconUrl || "",
        note: link.note || "",
        color: link.color || ""
      }))
    }))
  });
  state.data.settings.spaceTemplates = state.data.settings.spaceTemplates || [];
  state.data.settings.spaceTemplates.push(template);
  state.data.settings.updatedAt = getCurrentTime();
  await persistWithDirty();
  elements.createFromTemplateBtn.hidden = false;
  root.MyTabDeskNotifications.showToast(`已保存模板“${template.name}”`, "success");
}

async function createSpaceFromSelectedTemplate() {
  const templates = state.data.settings.spaceTemplates || [];
  if (templates.length === 0) {
    await showAlert("还没有空间模板，请先将当前空间保存为模板。", "空间模板");
    return;
  }
  const options = templates.map((template, index) => `${index + 1}. ${template.name}`).join("\n");
  const answer = await showPrompt(`请选择模板：\n${options}`, "1", "从模板创建空间");
  if (answer === null) return;
  const template = templates[Number(answer) - 1];
  if (!template) {
    await showAlert("请输入有效的模板序号。", "空间模板");
    return;
  }
  const spaceName = await showPrompt("请输入新空间名称：", template.name, "从模板创建空间");
  if (spaceName === null) return;
  state.data = app.createSpaceFromTemplate(state.data, template, spaceName, template.icon);
  await persistWithDirty();
  state.viewMode = "workspace";
  state.createSpaceMenuOpen = false;
  root.MyTabDeskRender.renderAll();
}

async function scanAndDeduplicateLinks() {
  const activeSpace = getActiveSpace();
  if (!activeSpace) return;
  const duplicateGroups = findDuplicateLinks(state.data, { spaceId: activeSpace.id });
  const removedCount = duplicateGroups.reduce((total, item) => total + item.duplicates.length, 0);
  if (removedCount === 0) {
    await showAlert("当前空间没有发现重复链接。", "重复链接扫描");
    return;
  }
  const confirmed = await showConfirm(
    `发现 ${duplicateGroups.length} 组重复 URL，将保留每组最新的一条并清理 ${removedCount} 条重复链接。是否继续？`,
    "清理重复链接"
  );
  if (!confirmed) return;
  const result = deduplicateLinks(state.data, { spaceId: activeSpace.id });
  state.data = result.data;
  await persistWithDirty();
  root.MyTabDeskRender.renderAll();
  root.MyTabDeskNotifications.showToast(`已清理 ${result.removedCount} 条重复链接`, "success");
}

root.MyTabDeskActions = {
  createBlankSpaceFromMenu,
  importBrowserBookmarks,
  collectBookmarkGroups,
  submitCreateSpaceDialog,
  createSpace,
  deleteSpace,
  createGroup,
  deleteGroup,
  toggleGroup,
  toggleGroupPinned,
  toggleMoveGroupMenu,
  closeMoveGroupMenu,
  moveGroupToSpace,
  renameGroup,
  setGroupColor,
  openEditLinkDialog,
  refreshLinkIcon,
  refreshGroupIcons,
  closeEditLinkDialog,
  submitEditLinkDialog,
  deleteLink,
  openLink,
  openGroup,
  refreshCurrentTabs,
  activateTab,
  saveCurrentTabsToGroup,
  saveCurrentTabsAndClose,
  saveCurrentTabsAndDiscard,
  saveSingleTabToGroup,
  downloadTextFile,
  exportCurrentData,
  exportTabTabData,
  exportSpace,
  exportSpaceAsHtml,
  requestImportData,
  requestImportSpace,
  importSelectedFile,
  importSpaceFromText,
  clearData,
  toggleTheme,
  toggleSidebar,
  toggleTabsPanel,
  toggleCompactLinks,
  toggleBatchDelete,
  toggleSelectedLink,
  confirmBatchDelete,
  handleSpaceDrop,
  handleGroupDrop,
  handleLinkGridDrop,
  handleLinkDrop,
  addDraggedTabToGroup,
  addExternalLink,
  saveCurrentSpaceAsTemplate,
  createSpaceFromSelectedTemplate,
  scanAndDeduplicateLinks,
  loadScheduledSaveConfig,
  loadScheduledSaveConfigOptions,
  saveScheduledSaveConfig,
  openSettings,
  handleExportEncryptedBackup,
  requestImportEncryptedBackup,
  importEncryptedBackupFile
};
})(globalThis);
