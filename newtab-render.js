(function (root) {
const app = root.MyTabDeskPage;
const { state, elements, SPACE_ICON_OPTIONS } = app;
const {
  filterGroups
} = app;
const {
  getDisplaySpaceIcon,
  getActiveSpace,
  formatDateTime,
  getDataSummary,
  clearElement,
  createTextElement,
  createFavicon,
  hasChromeTabs
} = root.MyTabDeskUtils;

/**
 * 应用主题、左右栏折叠和批量删除栏等布局状态。
 *
 * @returns {void}
 */
function applyLayoutSettings() {
  /** 当前用户界面设置。 */
  const settings = state.data.settings;
  document.body.dataset.theme = settings.theme === "dark" ? "dark" : "light";
  elements.appShell.classList.toggle("sidebar-collapsed", Boolean(settings.sidebarCollapsed));
  elements.appShell.classList.toggle("tabs-panel-collapsed", Boolean(settings.rightPanelCollapsed));
  elements.appShell.classList.toggle("settings-mode", state.viewMode === "settings");
  elements.toggleThemeBtn.textContent = settings.theme === "dark" ? "浅色模式" : "深色模式";
  elements.toggleSidebarBtn.textContent = settings.sidebarCollapsed ? "展开" : "收起";
  elements.toggleTabsPanelBtn.textContent = settings.rightPanelCollapsed ? "展开右栏" : "收起右栏";
  elements.batchBar.hidden = !state.batchDeleteEnabled;
  elements.batchDeleteBtn.textContent = state.batchDeleteEnabled ? "退出批量" : "批量删除";

  /** 是否正在显示设置页。 */
  const isSettings = state.viewMode === "settings";
  elements.createSpaceMenu.hidden = !state.createSpaceMenuOpen;
  elements.workspaceToolbar.hidden = isSettings;
  elements.batchBar.hidden = isSettings || !state.batchDeleteEnabled;
  elements.groupList.hidden = isSettings;
  elements.emptyState.hidden = isSettings || elements.emptyState.hidden;
  elements.settingsView.hidden = !isSettings;
}

/**
 * 重新渲染页面主体区域。
 *
 * @returns {void}
 */
function renderAll() {
  applyLayoutSettings();
  renderSpaces();

  if (state.viewMode === "settings") {
    renderSettingsStatus();
    return;
  }

  renderActiveSpaceHeader();
  renderGroups();
}

/**
 * 渲染左侧空间列表。
 *
 * @returns {void}
 */
function renderSpaces() {
  clearElement(elements.spaceList);

  for (const space of state.data.spaces) {
    /** 空间按钮元素。 */
    const item = document.createElement("button");
    item.type = "button";
    item.className = "space-item";
    item.title = space.name;
    item.draggable = true;
    item.dataset.spaceId = space.id;

    if (space.id === state.data.activeSpaceId) {
      item.classList.add("active");
    }

    /** 空间图标元素。 */
    const icon = createTextElement("span", "space-icon", getDisplaySpaceIcon(space.icon));
    /** 空间名称元素。 */
    const name = createTextElement("span", "space-name", space.name);
    /** 空间主体内容元素。 */
    const content = document.createElement("span");
    content.className = "space-content";
    content.append(icon, name);
    /** 空间拖拽手柄。 */
    const dragHandle = createTextElement("span", "space-drag-handle", "⠿");
    dragHandle.setAttribute("aria-hidden", "true");
    /** 空间更多操作按钮。 */
    const menuButton = document.createElement("button");
    menuButton.type = "button";
    menuButton.className = "space-menu-button";
    menuButton.textContent = "…";
    menuButton.setAttribute("aria-label", `打开空间 ${space.name} 的更多操作`);

    item.addEventListener("click", async () => {
      state.data.activeSpaceId = space.id;
      state.viewMode = "workspace";
      state.openSpaceMenuId = "";
      state.createSpaceMenuOpen = false;
      await root.MyTabDeskUtils.saveData();
      renderAll();
    });

    item.addEventListener("dragstart", (event) => {
      state.draggedSpaceId = space.id;
      event.dataTransfer.setData("text/plain", space.id);
    });

    item.addEventListener("dragover", (event) => {
      event.preventDefault();
      item.classList.add("drag-over");
    });

    item.addEventListener("dragleave", () => {
      item.classList.remove("drag-over");
    });

    item.addEventListener("drop", async (event) => {
      event.preventDefault();
      item.classList.remove("drag-over");
      await root.MyTabDeskActions.handleSpaceDrop(space.id);
    });

    menuButton.addEventListener("click", (event) => {
      event.stopPropagation();
      state.openSpaceMenuId = state.openSpaceMenuId === space.id ? "" : space.id;
      renderSpaces();
    });

    item.append(content, dragHandle, menuButton);
    elements.spaceList.appendChild(item);

    if (state.openSpaceMenuId === space.id) {
      elements.spaceList.appendChild(createSpaceMenuElement(space));
    }
  }
}

/**
 * 创建空间更多操作菜单元素。
 *
 * @param {object} space 空间数据。
 * @returns {HTMLElement} 空间菜单元素。
 */
function createSpaceMenuElement(space) {
  /** 空间菜单容器。 */
  const menu = document.createElement("div");
  menu.className = "space-menu-panel";

  /** 更改图标菜单项。 */
  const changeIconButton = createSpaceMenuButton("更改图标");
  /** 导出空间菜单项。 */
  const exportButton = createSpaceMenuButton("导出空间");
  /** 删除空间菜单项。 */
  const deleteButton = createSpaceMenuButton("删除空间", true);

  changeIconButton.addEventListener("click", () => openSpaceIconPicker(space.id));
  exportButton.addEventListener("click", () => root.MyTabDeskActions.exportSpace(space.id));
  deleteButton.addEventListener("click", () => root.MyTabDeskActions.deleteSpace(space.id));

  menu.append(changeIconButton, exportButton, deleteButton);
  return menu;
}

/**
 * 创建空间菜单按钮。
 *
 * @param {string} text 按钮文本。
 * @param {boolean} danger 是否为危险操作。
 * @returns {HTMLButtonElement} 菜单按钮元素。
 */
function createSpaceMenuButton(text, danger = false) {
  /** 菜单按钮元素。 */
  const button = document.createElement("button");
  button.type = "button";
  button.className = danger ? "space-menu-action danger" : "space-menu-action";
  button.textContent = text;
  return button;
}

/**
 * 打开空间图标选择弹窗。
 *
 * @param {string} spaceId 空间 ID。
 * @returns {void}
 */
function openSpaceIconPicker(spaceId) {
  /** 待修改图标的空间。 */
  const space = state.data.spaces.find((item) => item.id === spaceId);

  if (!space) {
    return;
  }

  state.iconPickerSpaceId = spaceId;
  state.selectedSpaceIcon = getDisplaySpaceIcon(space.icon);
  elements.spaceIconDialog.hidden = false;
  renderSpaceIconPicker();
}

/**
 * 关闭空间图标选择弹窗。
 *
 * @returns {void}
 */
function closeSpaceIconPicker() {
  state.iconPickerSpaceId = "";
  state.selectedSpaceIcon = "";
  elements.spaceIconDialog.hidden = true;
}

/**
 * 渲染空间图标选择弹窗。
 *
 * @returns {void}
 */
function renderSpaceIconPicker() {
  clearElement(elements.spaceIconGrid);

  for (const icon of SPACE_ICON_OPTIONS) {
    /** 图标按钮元素。 */
    const button = document.createElement("button");
    button.type = "button";
    button.className = "space-icon-option";
    button.textContent = icon;
    button.setAttribute("aria-label", `选择图标 ${icon}`);

    if (state.selectedSpaceIcon === icon) {
      button.classList.add("active");
    }

    button.addEventListener("click", () => {
      state.selectedSpaceIcon = icon;
      renderSpaceIconPicker();
    });
    elements.spaceIconGrid.appendChild(button);
  }
}

/**
 * 确认更改空间图标。
 *
 * @returns {Promise<void>} 保存完成后结束。
 */
async function confirmSpaceIconChange() {
  /** 待更新的空间。 */
  const space = state.data.spaces.find((item) => item.id === state.iconPickerSpaceId);

  if (!space || !state.selectedSpaceIcon) {
    closeSpaceIconPicker();
    return;
  }

  space.icon = state.selectedSpaceIcon;
  space.updatedAt = Date.now();
  closeSpaceIconPicker();
  await root.MyTabDeskUtils.saveData();
  renderAll();
}

/**
 * 渲染当前空间标题和统计信息。
 *
 * @returns {void}
 */
function renderActiveSpaceHeader() {
  /** 当前激活空间。 */
  const activeSpace = getActiveSpace();

  if (!activeSpace) {
    elements.currentSpaceName.textContent = "未找到空间";
    elements.currentSpaceMeta.textContent = "0 个分组 · 0 个链接";
    return;
  }

  /** 当前空间分组总数。 */
  const groupCount = activeSpace.groups.length;
  /** 当前空间链接总数。 */
  const linkCount = activeSpace.groups.reduce((total, group) => total + group.links.length, 0);
  elements.currentSpaceName.textContent = `${getDisplaySpaceIcon(activeSpace.icon)} ${activeSpace.name}`;
  elements.currentSpaceMeta.textContent = `${groupCount} 个分组 · ${linkCount} 个链接`;
}

/**
 * 渲染当前空间中的分组列表。
 *
 * @returns {void}
 */
function renderGroups() {
  /** 当前激活空间。 */
  const activeSpace = getActiveSpace();

  clearElement(elements.groupList);

  if (!activeSpace) {
    showEmptyState("当前没有可用空间", "请先创建一个空间。" );
    return;
  }

  /** 当前搜索关键词。 */
  const keyword = state.searchKeyword.trim().toLowerCase();
  /** 搜索过滤后的分组列表。 */
  const visibleGroups = filterGroups(activeSpace.groups, keyword);

  if (activeSpace.groups.length === 0) {
    showEmptyState("还没有分组", "点击右上角“添加分组”，开始整理你的标签页。" );
    return;
  }

  if (visibleGroups.length === 0) {
    showEmptyState("没有找到匹配结果", "请尝试更换关键词。" );
    return;
  }

  hideEmptyState();

  for (const group of visibleGroups) {
    elements.groupList.appendChild(createGroupElement(group));
  }
}

/**
 * 显示空状态内容。
 *
 * @param {string} title 空状态标题。
 * @param {string} description 空状态描述。
 * @returns {void}
 */
function showEmptyState(title, description) {
  elements.emptyState.hidden = false;
  elements.emptyState.querySelector("h2").textContent = title;
  elements.emptyState.querySelector("p").textContent = description;
}

/**
 * 隐藏空状态内容。
 *
 * @returns {void}
 */
function hideEmptyState() {
  elements.emptyState.hidden = true;
}

/**
 * 创建单个分组容器。
 *
 * @param {object} group 分组数据。
 * @returns {HTMLElement} 分组 DOM 元素。
 */
function createGroupElement(group) {
  /** 当前激活空间。 */
  const activeSpace = getActiveSpace();
  /** 分组容器元素。 */
  const groupElement = document.createElement("section");
  groupElement.className = "group-card";
  groupElement.dataset.groupId = group.id;
  groupElement.draggable = !group.pinned;

  if (group.pinned) {
    groupElement.classList.add("pinned");
  }

  /** 分组头部区域。 */
  const header = document.createElement("header");
  header.className = "group-header";
  /** 分组左侧信息区域。 */
  const headerInfo = document.createElement("div");
  headerInfo.className = "group-header-info";
  /** 分组折叠按钮。 */
  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "group-toggle-button";
  toggleButton.textContent = group.collapsed ? "▶" : "▼";
  toggleButton.setAttribute("aria-label", `${group.collapsed ? "展开" : "折叠"}分组 ${group.name}`);
  toggleButton.addEventListener("click", () => root.MyTabDeskActions.toggleGroup(group.id));
  /** 分组元信息。 */
  const meta = createTextElement("span", "group-meta", `${group.links.length} 个链接`);

  headerInfo.append(toggleButton, createGroupNameElement(group), meta);

  /** 分组操作区域。 */
  const actions = document.createElement("div");
  actions.className = "group-actions";
  /** 打开全部按钮。 */
  const openAllButton = document.createElement("button");
  openAllButton.type = "button";
  openAllButton.className = "secondary-button group-action-button";
  openAllButton.textContent = "打开全部";
  openAllButton.addEventListener("click", () => root.MyTabDeskActions.openGroup(group.id));
  /** 移动分组按钮。 */
  const moveButton = document.createElement("button");
  moveButton.type = "button";
  moveButton.className = "secondary-button group-action-button";
  moveButton.textContent = "移动";
  moveButton.addEventListener("click", (event) => {
    event.stopPropagation();
    root.MyTabDeskActions.toggleMoveGroupMenu(group.id);
  });
  /** 固定分组按钮。 */
  const pinButton = document.createElement("button");
  pinButton.type = "button";
  pinButton.className = "secondary-button group-action-button";
  pinButton.textContent = group.pinned ? "取消固定" : "固定";
  pinButton.addEventListener("click", () => root.MyTabDeskActions.toggleGroupPinned(group.id));
  /** 删除分组按钮。 */
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "secondary-button danger-text-button group-action-button";
  deleteButton.textContent = "删除";
  deleteButton.addEventListener("click", () => root.MyTabDeskActions.deleteGroup(group.id));

  actions.append(openAllButton, moveButton, pinButton, deleteButton);
  header.append(headerInfo, actions);
  groupElement.appendChild(header);

  if (state.movingGroupId === group.id) {
    groupElement.appendChild(createMoveGroupMenuElement(group));
  }

  if (!group.collapsed) {
    /** 链接网格区域。 */
    const linkGrid = document.createElement("div");
    linkGrid.className = "link-grid";

    if (!group.pinned) {
      groupElement.addEventListener("dragstart", (event) => {
        state.draggedGroupId = group.id;
        event.dataTransfer.setData("text/plain", group.id);
      });
    }

    groupElement.addEventListener("dragover", (event) => {
      event.preventDefault();
      groupElement.classList.add("drag-over");
    });

    groupElement.addEventListener("dragleave", () => {
      groupElement.classList.remove("drag-over");
    });

    groupElement.addEventListener("drop", async (event) => {
      event.preventDefault();
      groupElement.classList.remove("drag-over");
      await root.MyTabDeskActions.handleGroupDrop(activeSpace.id, group.id);
    });

    linkGrid.addEventListener("dragover", (event) => {
      event.preventDefault();
      linkGrid.classList.add("drag-over");
    });

    linkGrid.addEventListener("dragleave", () => {
      linkGrid.classList.remove("drag-over");
    });

    linkGrid.addEventListener("drop", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      linkGrid.classList.remove("drag-over");
      await root.MyTabDeskActions.handleLinkGridDrop(activeSpace.id, group.id);
    });

    if (group.links.length === 0) {
      linkGrid.appendChild(createTextElement("div", "panel-message", "这个分组还没有链接，可从右侧当前标签页中拖入或保存。"));
    } else {
      for (const link of group.links) {
        linkGrid.appendChild(createLinkElement(group.id, link));
      }
    }

    groupElement.appendChild(linkGrid);
  }

  return groupElement;
}

/**
 * 创建可编辑的分组名称元素。
 *
 * @param {object} group 分组数据。
 * @returns {HTMLElement} 分组名称元素。
 */
function createGroupNameElement(group) {
  if (state.editingGroupId === group.id) {
    /** 分组名称输入框。 */
    const input = document.createElement("input");
    input.className = "group-name-input";
    input.type = "text";
    input.value = group.name;
    input.maxLength = 64;
    input.setAttribute("aria-label", `编辑分组 ${group.name} 的名称`);

    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("keydown", async (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        await root.MyTabDeskActions.renameGroup(group.id, input.value);
      }

      if (event.key === "Escape") {
        state.editingGroupId = "";
        renderGroups();
      }
    });
    input.addEventListener("blur", () => root.MyTabDeskActions.renameGroup(group.id, input.value));
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
    return input;
  }

  /** 分组名称按钮。 */
  const button = document.createElement("button");
  button.type = "button";
  button.className = "group-name-button";
  button.title = "点击编辑分组名称";
  button.textContent = `${group.pinned ? "📌 " : ""}${group.name}`;
  button.addEventListener("click", () => {
    state.editingGroupId = group.id;
    state.movingGroupId = "";
    renderGroups();
  });
  return button;
}

/**
 * 创建移动分组的空间选择菜单。
 *
 * @param {object} group 待移动分组。
 * @returns {HTMLElement} 移动分组菜单元素。
 */
function createMoveGroupMenuElement(group) {
  /** 当前激活空间。 */
  const activeSpace = getActiveSpace();
  /** 移动分组菜单容器。 */
  const menu = document.createElement("div");
  menu.className = "move-group-menu";

  for (const space of state.data.spaces) {
    if (!activeSpace || space.id === activeSpace.id) {
      continue;
    }

    /** 目标空间按钮。 */
    const button = document.createElement("button");
    button.type = "button";
    button.className = "move-group-space-button";
    button.textContent = `${getDisplaySpaceIcon(space.icon)} ${space.name}`;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      root.MyTabDeskActions.moveGroupToSpace(group.id, space.id);
    });
    menu.appendChild(button);
  }

  if (menu.children.length === 0) {
    menu.appendChild(createTextElement("div", "panel-message", "没有可移动到的其他空间。"));
  }

  return menu;
}

/**
 * 创建单个链接卡片 DOM 元素。
 *
 * @param {string} groupId 链接所属分组 ID。
 * @param {object} link 链接数据。
 * @returns {HTMLElement} 链接卡片元素。
 */
function createLinkElement(groupId, link) {
  /** 链接卡片容器。 */
  const card = document.createElement("article");
  card.className = "link-card";
  card.title = `${link.title}\n${link.url}`;
  card.draggable = true;
  card.dataset.linkId = link.id;

  if (state.batchDeleteEnabled) {
    card.classList.add("batch-mode");
  }

  if (state.openLinkMenuId === link.id) {
    card.classList.add("menu-open");
  }

  if (state.selectedLinkIds.has(link.id)) {
    card.classList.add("selected");
  }

  /** 链接标题和地址区域。 */
  const content = document.createElement("div");
  content.className = "link-content";
  content.append(createTextElement("div", "link-title", link.title || link.url));
  content.append(createTextElement("div", "link-url", link.url));

  /** 链接主内容按钮。 */
  const contentButton = document.createElement("button");
  contentButton.type = "button";
  contentButton.className = "link-main-button";
  contentButton.setAttribute("aria-label", `打开链接 ${link.title || link.url}`);
  contentButton.addEventListener("click", () => {
    state.movingGroupId = "";
    state.openLinkMenuId = "";

    if (state.batchDeleteEnabled) {
      root.MyTabDeskActions.toggleSelectedLink(link.id);
      return;
    }

    root.MyTabDeskActions.openLink(link.url);
  });
  contentButton.append(createFavicon(link.favIconUrl, link.title || link.url), content);

  /** 链接更多操作按钮。 */
  const moreButton = document.createElement("button");
  moreButton.type = "button";
  moreButton.className = "link-action-button";
  moreButton.textContent = "⋯";
  moreButton.setAttribute("aria-label", `打开链接 ${link.title || link.url} 的操作菜单`);
  moreButton.addEventListener("click", (event) => {
    event.stopPropagation();
    state.openLinkMenuId = state.openLinkMenuId === link.id ? "" : link.id;
    state.movingGroupId = "";
    renderGroups();
  });

  card.addEventListener("dragstart", (event) => {
    event.stopPropagation();
    state.openLinkMenuId = "";
    state.draggedLink = {
      groupId,
      linkId: link.id
    };
    event.dataTransfer.setData("text/plain", link.id);
  });

  card.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.stopPropagation();
    card.classList.add("drag-over");
  });

  card.addEventListener("dragleave", (event) => {
    event.stopPropagation();
    card.classList.remove("drag-over");
  });

  card.addEventListener("drop", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    card.classList.remove("drag-over");
    await root.MyTabDeskActions.handleLinkDrop(groupId, link.id);
  });

  if (state.batchDeleteEnabled) {
    /** 批量删除模式下的勾选状态标记。 */
    const checkbox = document.createElement("span");
    checkbox.className = "batch-check";
    checkbox.textContent = state.selectedLinkIds.has(link.id) ? "✓" : "";
    card.append(checkbox);
  }

  card.append(contentButton, moreButton);

  if (state.openLinkMenuId === link.id) {
    card.append(createLinkActionMenuElement(groupId, link));
  }

  return card;
}

/**
 * 创建链接卡片的更多操作菜单。
 *
 * @param {string} groupId 链接所属分组 ID。
 * @param {object} link 链接数据。
 * @returns {HTMLElement} 链接操作菜单元素。
 */
function createLinkActionMenuElement(groupId, link) {
  /** 链接操作菜单容器。 */
  const menu = document.createElement("div");
  menu.className = "link-action-menu";

  /** 编辑链接按钮。 */
  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "link-menu-action";
  editButton.textContent = "编辑";
  editButton.addEventListener("click", (event) => {
    event.stopPropagation();
    root.MyTabDeskActions.openEditLinkDialog(groupId, link.id);
  });

  /** 删除链接按钮。 */
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "link-menu-action danger";
  deleteButton.textContent = "删除";
  deleteButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    state.openLinkMenuId = "";
    await root.MyTabDeskActions.deleteLink(groupId, link.id);
  });

  menu.append(editButton, deleteButton);
  return menu;
}

/**
 * 渲染右侧当前窗口标签页列表。
 *
 * @returns {void}
 */
function renderCurrentTabs() {
  elements.tabsTitle.textContent = `Tabs (${state.currentTabs.length})`;
  clearElement(elements.currentTabsList);

  if (!hasChromeTabs()) {
    elements.currentTabsList.appendChild(createTextElement("div", "panel-message", "当前页面未运行在浏览器扩展环境中，无法读取窗口标签页。"));
    return;
  }

  if (state.currentTabs.length === 0) {
    elements.currentTabsList.appendChild(createTextElement("div", "panel-message", "当前窗口没有可保存的普通网页标签。"));
    return;
  }

  /** 统一小写后的当前标签搜索关键词。 */
  const tabKeyword = state.tabSearchKeyword.trim().toLowerCase();
  /** 当前需要展示的标签页列表。 */
  const visibleTabs = root.MyTabDeskPage.filterCurrentTabs(state.currentTabs, tabKeyword);

  if (visibleTabs.length === 0) {
    elements.currentTabsList.appendChild(createTextElement("div", "panel-message", "没有找到匹配的当前标签。"));
    return;
  }

  for (const tab of visibleTabs) {
    /** 当前标签页按钮。 */
    const item = document.createElement("button");
    item.type = "button";
    item.className = "current-tab-item";
    item.title = `${tab.title}\n${tab.url}`;
    item.draggable = true;

    /** 当前标签页标题和地址区域。 */
    const content = document.createElement("div");
    content.className = "tab-content";
    content.append(createTextElement("div", "tab-title", tab.title));
    content.append(createTextElement("div", "tab-url", tab.url));

    /** 单个当前标签保存按钮。 */
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "tab-save-button";
    saveButton.textContent = "保存";
    saveButton.setAttribute("aria-label", `保存标签 ${tab.title || tab.url}`);
    saveButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      await root.MyTabDeskActions.saveSingleTabToGroup(tab);
    });

    item.append(createFavicon(tab.favIconUrl, tab.title || tab.url), content, saveButton);
    item.addEventListener("click", () => root.MyTabDeskActions.activateTab(tab.tabId));
    item.addEventListener("dragstart", (event) => {
      event.stopPropagation();
      state.draggedTab = tab;
      event.dataTransfer.setData("text/plain", tab.url);
    });
    elements.currentTabsList.appendChild(item);
  }
}

/**
 * 切换创建空间方式菜单显示状态。
 *
 * @returns {void}
 */
function toggleCreateSpaceMenu() {
  state.createSpaceMenuOpen = !state.createSpaceMenuOpen;
  state.openSpaceMenuId = "";
  elements.createSpaceMenu.hidden = !state.createSpaceMenuOpen;
}

/**
 * 关闭创建空间方式菜单。
 *
 * @returns {void}
 */
function closeCreateSpaceMenu() {
  state.createSpaceMenuOpen = false;
  elements.createSpaceMenu.hidden = true;
}

/**
 * 打开创建空间弹窗。
 *
 * @returns {void}
 */
function openCreateSpaceDialog() {
  closeCreateSpaceMenu();
  state.createSpaceDialogOpen = true;
  state.createSpaceDialogError = "";
  elements.createSpaceNameInput.value = "";
  renderCreateSpaceDialog();
  requestAnimationFrame(() => elements.createSpaceNameInput.focus());
}

/**
 * 关闭创建空间弹窗。
 *
 * @returns {void}
 */
function closeCreateSpaceDialog() {
  state.createSpaceDialogOpen = false;
  state.createSpaceDialogError = "";
  elements.createSpaceNameInput.value = "";
  renderCreateSpaceDialog();
}

/**
 * 渲染创建空间弹窗状态。
 *
 * @returns {void}
 */
function renderCreateSpaceDialog() {
  elements.createSpaceDialog.hidden = !state.createSpaceDialogOpen;
  elements.createSpaceError.textContent = state.createSpaceDialogError;
}

/**
 * 获取自动同步状态展示文本。
 *
 * @param {object} sync 当前同步配置。
 * @returns {string} 自动同步状态文本。
 */
function getAutoSyncStatusText(sync) {
  if (!root.MyTabDeskUtils.isAutoSyncEnabled(sync)) {
    return "未启用";
  }

  if (sync.lastAutoSyncError) {
    return `失败：${sync.lastAutoSyncError}`;
  }

  if (sync.autoSyncPendingAt > 0) {
    return `待同步 ${formatDateTime(sync.autoSyncPendingAt)}`;
  }

  if (sync.lastAutoSyncAt > 0) {
    return `已同步 ${formatDateTime(sync.lastAutoSyncAt)}`;
  }

  return "已启用，等待本地变动";
}

/**
 * 渲染设置页同步状态信息。
 *
 * @returns {void}
 */
function renderSettingsStatus() {
  /** 当前同步设置。 */
  const sync = state.data.settings.sync || {};
  /** 全量数据最近更新时间。 */
  const updatedAt = root.MyTabDeskPage.getDataUpdatedAt(state.data);
  /** 当前数据统计信息。 */
  const summary = getDataSummary(state.data);
  /** 已启用同步服务商列表。 */
  const enabledProviders = root.MyTabDeskPage.getEnabledSyncProviders(sync);
  /** 已启用同步服务商显示文本。 */
  const enabledProviderText = enabledProviders.length > 0 ? enabledProviders.join(" + ") : "未启用";

  elements.settingsVersionValue.textContent = state.data.version || "-";
  elements.settingsSpaceCountValue.textContent = summary.spaceCount;
  elements.settingsGroupCountValue.textContent = summary.groupCount;
  elements.settingsLinkCountValue.textContent = summary.linkCount;
  elements.syncModeValue.textContent = enabledProviders.length > 0 ? `远程同步：${enabledProviderText}` : "手动同步基础版";
  elements.syncDeviceIdValue.textContent = sync.deviceId || "-";
  elements.syncLastModifiedValue.textContent = updatedAt > 0 ? formatDateTime(updatedAt) : "-";
  elements.syncLastBackupValue.textContent = sync.lastBackupAt > 0 ? formatDateTime(sync.lastBackupAt) : "从未备份";
  elements.syncLastImportValue.textContent = sync.lastImportAt > 0 ? formatDateTime(sync.lastImportAt) : sync.lastSyncAt > 0 ? `最近同步 ${formatDateTime(sync.lastSyncAt)}` : "从未导入";
  elements.syncAutoStatusValue.textContent = getAutoSyncStatusText(sync);
  elements.gistSyncSwitch.checked = root.MyTabDeskPage.isSyncProviderEnabled(sync, "gist");
  elements.webdavSyncSwitch.checked = root.MyTabDeskPage.isSyncProviderEnabled(sync, "webdav");
  elements.gistAutoSyncSwitch.checked = Boolean(sync.gistAutoSyncEnabled);
  elements.webdavAutoSyncSwitch.checked = Boolean(sync.webdavAutoSyncEnabled);
  elements.webdavUrlInput.value = sync.webdavUrl || "";
  elements.webdavUsernameInput.value = sync.webdavUsername || "";
  elements.webdavPasswordInput.value = sync.webdavPassword || "";
  elements.webdavFilenameInput.value = sync.webdavFilename || "";
  elements.gistTokenInput.value = sync.gistToken || "";
  elements.gistIdInput.value = sync.gistId || "";
  elements.gistFilenameInput.value = sync.gistFilename || "mytabdesk-sync.json";
}

root.MyTabDeskRender = {
  applyLayoutSettings,
  renderAll,
  renderSpaces,
  createSpaceMenuElement,
  createSpaceMenuButton,
  openSpaceIconPicker,
  closeSpaceIconPicker,
  renderSpaceIconPicker,
  confirmSpaceIconChange,
  renderActiveSpaceHeader,
  renderGroups,
  showEmptyState,
  hideEmptyState,
  createGroupElement,
  createGroupNameElement,
  createMoveGroupMenuElement,
  createLinkElement,
  createLinkActionMenuElement,
  renderCurrentTabs,
  toggleCreateSpaceMenu,
  closeCreateSpaceMenu,
  openCreateSpaceDialog,
  closeCreateSpaceDialog,
  renderCreateSpaceDialog,
  getAutoSyncStatusText,
  renderSettingsStatus
};
})(globalThis);
