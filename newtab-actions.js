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
  markSettingsDirty
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

/**
 * 提示浏览器书签导入能力暂未开放。
 *
 * @returns {Promise<void>} 提示完成后结束。
 */
async function showBookmarksImportPlaceholder() {
  root.MyTabDeskRender.closeCreateSpaceMenu();
  await showAlert("浏览器书签导入需要启用 bookmarks 权限，后续会接入 chrome.bookmarks 读取书签。");
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
    favIconUrl
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
 * @returns {Promise<void>} 保存完成后结束。
 */
async function saveCurrentTabsToGroup() {
  /** 当前激活空间。 */
  const activeSpace = getActiveSpace();

  if (!activeSpace) {
    return;
  }

  if (!Array.isArray(state.currentTabs) || state.currentTabs.length === 0) {
    await showAlert("当前窗口没有可保存的普通网页标签。", "无法保存");
    return;
  }

  ensureActiveSpaceHasGroup(activeSpace);
  /** 当前空间中未被删除的可用分组列表。 */
  const liveGroups = activeSpace.groups.filter((group) => !group.deletedAt);

  if (liveGroups.length === 0) {
    await showAlert("请先创建一个分组，再保存当前窗口标签。", "无法保存");
    return;
  }

  /** 当前空间中可选择的分组列表。 */
  const groupNames = liveGroups.map((group, index) => `${index + 1}. ${group.name}`);
  /** 用户输入的分组序号。 */
  const answer = await showPrompt(`请选择保存到哪个分组：\n${groupNames.join("\n")}`, "1", "保存当前窗口标签");

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

  state.data = addLinksToGroup(state.data, activeSpace.id, targetGroup.id, tabsToLinks(state.currentTabs));
  await persistWithDirty();
  root.MyTabDeskRender.renderAll();
  await showAlert(`已保存到分组「${targetGroup.name}」。`);
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
  downloadTextFile(filename, exportData(state.data));

  // 显示导出成功通知
  if (root.MyTabDeskNotifications) {
    root.MyTabDeskNotifications.notifySuccess("导出成功", "数据已导出到文件");
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
    state.selectedLinkIds.clear();
    state.batchDeleteEnabled = false;
    state.lastWorkspaceSnapshot = createWorkspaceSnapshot();
    await persistWithDirtySkipSync();
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
    state.lastWorkspaceSnapshot = createWorkspaceSnapshot();
    await persistWithDirtySkipSync();
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
  root.MyTabDeskRender.renderAll();
}

root.MyTabDeskActions = {
  createBlankSpaceFromMenu,
  showBookmarksImportPlaceholder,
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
  saveSingleTabToGroup,
  downloadTextFile,
  exportCurrentData,
  exportSpace,
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
  openSettings,
  handleExportEncryptedBackup,
  requestImportEncryptedBackup,
  importEncryptedBackupFile
};
})(globalThis);
