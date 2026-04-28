/**
 * 页面运行时状态，集中保存数据、搜索词、批量选择和拖拽中的对象。
 */
const state = {
  /** 当前工作台全量数据。 */
  data: null,
  /** 当前浏览器窗口中可保存的标签页列表。 */
  currentTabs: [],
  /** 当前主区域搜索关键词。 */
  searchKeyword: "",
  /** 是否处于批量删除模式。 */
  batchDeleteEnabled: false,
  /** 批量删除模式中已选中的链接 ID 集合。 */
  selectedLinkIds: new Set(),
  /** 正在拖拽的空间 ID。 */
  draggedSpaceId: "",
  /** 正在拖拽的分组 ID。 */
  draggedGroupId: "",
  /** 正在拖拽的链接信息。 */
  draggedLink: null,
  /** 正在从右栏拖拽的浏览器标签页。 */
  draggedTab: null,
  /** 当前页面视图模式：workspace 表示工作台，settings 表示设置页。 */
  viewMode: "workspace"
};

/**
 * 页面 DOM 元素引用集合，初始化后由各渲染和事件函数复用。
 */
const elements = {};

/**
 * 根据 ID 获取页面元素。
 *
 * @param {string} id 元素 ID。
 * @returns {HTMLElement|null} 匹配到的页面元素，没有找到时返回 null。
 */
function getElement(id) {
  return document.getElementById(id);
}

/**
 * 判断当前环境是否支持 Chrome 本地存储 API。
 *
 * @returns {boolean} 支持 chrome.storage.local 时返回 true。
 */
function hasChromeStorage() {
  return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
}

/**
 * 判断当前环境是否支持 Chrome 标签页 API。
 *
 * @returns {boolean} 支持 chrome.tabs 时返回 true。
 */
function hasChromeTabs() {
  return typeof chrome !== "undefined" && chrome.tabs;
}

/**
 * 从本地存储读取工作台数据。
 *
 * @returns {Promise<object>} 迁移并标准化后的工作台数据。
 */
async function loadData() {
  if (!hasChromeStorage()) {
    return createDefaultData();
  }

  try {
    /** Chrome 本地存储读取结果。 */
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return migrateData(result[STORAGE_KEY]);
  } catch (error) {
    alert("数据读取失败，已为你恢复默认数据。");
    return createDefaultData();
  }
}

/**
 * 保存当前工作台数据到本地存储。
 *
 * @returns {Promise<void>} 保存完成后结束。
 */
async function saveData() {
  if (!hasChromeStorage()) {
    return;
  }

  try {
    await chrome.storage.local.set({
      [STORAGE_KEY]: state.data
    });
  } catch (error) {
    alert("数据保存失败，请稍后重试。");
  }
}

/**
 * 获取当前激活空间。
 *
 * @returns {object|null} 当前激活空间，无法获取时返回 null。
 */
function getActiveSpace() {
  if (!state.data || !Array.isArray(state.data.spaces)) {
    return null;
  }

  return state.data.spaces.find((space) => space.id === state.data.activeSpaceId) || state.data.spaces[0] || null;
}

/**
 * 格式化时间戳为本地日期时间文本。
 *
 * @param {number} timestamp 毫秒级时间戳。
 * @returns {string} 格式化后的日期时间字符串。
 */
function formatDateTime(timestamp) {
  /** 日期对象。 */
  const date = new Date(timestamp);
  /** 年份文本。 */
  const year = date.getFullYear();
  /** 月份文本。 */
  const month = String(date.getMonth() + 1).padStart(2, "0");
  /** 日期文本。 */
  const day = String(date.getDate()).padStart(2, "0");
  /** 小时文本。 */
  const hour = String(date.getHours()).padStart(2, "0");
  /** 分钟文本。 */
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hour}:${minute}`;
}

/**
 * 统计空间下的链接总数。
 *
 * @param {object} space 空间数据。
 * @returns {number} 链接总数。
 */
function getTotalLinks(space) {
  if (!space || !Array.isArray(space.groups)) {
    return 0;
  }

  return space.groups.reduce((total, group) => total + group.links.length, 0);
}

/**
 * 清空指定 DOM 容器。
 *
 * @param {HTMLElement} element 待清空的页面元素。
 * @returns {void}
 */
function clearElement(element) {
  element.innerHTML = "";
}

/**
 * 创建带文本内容的 DOM 元素。
 *
 * @param {string} tagName 标签名称。
 * @param {string} className CSS 类名。
 * @param {string} text 文本内容。
 * @returns {HTMLElement} 创建好的 DOM 元素。
 */
function createTextElement(tagName, className, text) {
  /** 新创建的 DOM 元素。 */
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

/**
 * 创建站点图标元素，加载失败时自动回退为首字母图标。
 *
 * @param {string} src 图标地址。
 * @param {string} title 链接或标签标题。
 * @returns {HTMLElement} 图标或兜底图标元素。
 */
function createFavicon(src, title) {
  if (!src) {
    /** 无图标地址时显示的兜底图标。 */
    const fallback = document.createElement("div");
    fallback.className = "fallback-icon";
    fallback.textContent = title ? title.slice(0, 1).toUpperCase() : "⌁";
    return fallback;
  }

  /** 站点图标图片元素。 */
  const image = document.createElement("img");
  image.className = "favicon";
  image.src = src;
  image.alt = "";
  image.referrerPolicy = "no-referrer";
  image.addEventListener("error", () => {
    /** 图片加载失败时创建的兜底图标。 */
    const fallback = createFavicon("", title);
    image.replaceWith(fallback);
  });
  return image;
}

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
  elements.toggleThemeBtn.textContent = settings.theme === "dark" ? "浅色模式" : "深色模式";
  elements.toggleSidebarBtn.textContent = settings.sidebarCollapsed ? "展开" : "收起";
  elements.toggleTabsPanelBtn.textContent = settings.rightPanelCollapsed ? "展开右栏" : "收起右栏";
  elements.batchBar.hidden = !state.batchDeleteEnabled;
  elements.batchDeleteBtn.textContent = state.batchDeleteEnabled ? "退出批量" : "批量删除";

  /** 是否正在显示设置页。 */
  const isSettings = state.viewMode === "settings";
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
  renderActiveSpaceHeader();
  renderGroups();

  if (state.viewMode === "settings") {
    renderSettingsStatus();
  }
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

    /** 空间名称元素。 */
    const name = createTextElement("span", "space-name", space.name);
    /** 空间删除按钮。 */
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "space-delete-button";
    deleteButton.textContent = "×";
    deleteButton.setAttribute("aria-label", `删除空间 ${space.name}`);

    item.addEventListener("click", async () => {
      state.data.activeSpaceId = space.id;
      await saveData();
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
      await handleSpaceDrop(space.id);
    });

    deleteButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      await deleteSpace(space.id);
    });

    item.append(name, deleteButton);
    elements.spaceList.appendChild(item);
  }
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
    elements.currentSpaceName.textContent = "暂无空间";
    elements.currentSpaceMeta.textContent = "0 个分组 · 0 个链接";
    return;
  }

  elements.currentSpaceName.textContent = activeSpace.name;
  elements.currentSpaceMeta.textContent = `${activeSpace.groups.length} 个分组 · ${getTotalLinks(activeSpace)} 个链接`;
}

/**
 * 渲染主区域分组列表。
 *
 * @returns {void}
 */
function renderGroups() {
  /** 当前激活空间。 */
  const activeSpace = getActiveSpace();
  clearElement(elements.groupList);

  if (!activeSpace || activeSpace.groups.length === 0) {
    showEmptyState("还没有保存任何链接", "你可以从右侧当前窗口标签页栏保存当前窗口的网页。");
    return;
  }

  /** 搜索过滤后的分组列表。 */
  const filteredGroups = filterGroups(activeSpace.groups, state.searchKeyword);

  if (filteredGroups.length === 0) {
    showEmptyState("没有找到匹配结果", "试试其他关键词。");
    return;
  }

  hideEmptyState();

  for (const group of filteredGroups) {
    elements.groupList.appendChild(createGroupElement(group));
  }
}

/**
 * 显示空状态区域。
 *
 * @param {string} title 空状态标题。
 * @param {string} description 空状态说明。
 * @returns {void}
 */
function showEmptyState(title, description) {
  /** 空状态标题元素。 */
  const titleElement = elements.emptyState.querySelector("h2");
  /** 空状态说明元素。 */
  const descriptionElement = elements.emptyState.querySelector("p");
  titleElement.textContent = title;
  descriptionElement.textContent = description;
  elements.emptyState.hidden = false;
}

/**
 * 隐藏空状态区域。
 *
 * @returns {void}
 */
function hideEmptyState() {
  elements.emptyState.hidden = true;
}

/**
 * 创建单个分组 DOM 元素。
 *
 * @param {object} group 分组数据。
 * @returns {HTMLElement} 分组 DOM 元素。
 */
function createGroupElement(group) {
  /** 当前激活空间。 */
  const activeSpace = getActiveSpace();
  /** 分组外层元素。 */
  const groupElement = document.createElement("article");
  groupElement.className = "group-section";
  groupElement.draggable = true;
  groupElement.dataset.groupId = group.id;

  groupElement.addEventListener("dragstart", (event) => {
    state.draggedGroupId = group.id;
    event.dataTransfer.setData("text/plain", group.id);
  });

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
    await handleGroupDrop(activeSpace.id, group.id);
  });

  /** 分组头部元素。 */
  const header = document.createElement("header");
  header.className = "group-header";

  /** 分组标题区域。 */
  const titleBlock = document.createElement("div");
  titleBlock.className = "group-title-block";
  titleBlock.append(createTextElement("h2", "group-name", group.name));
  titleBlock.append(createTextElement("div", "group-meta", `${group.links.length} 个链接 · 可拖拽排序`));

  /** 分组操作按钮区域。 */
  const actions = document.createElement("div");
  actions.className = "group-actions";

  /** 打开当前分组所有链接的按钮。 */
  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "secondary-button";
  openButton.textContent = "打开全部";
  openButton.addEventListener("click", () => openGroup(group.id));

  /** 折叠或展开当前分组的按钮。 */
  const collapseButton = document.createElement("button");
  collapseButton.type = "button";
  collapseButton.className = "group-small-button";
  collapseButton.textContent = group.collapsed ? "展开" : "折叠";
  collapseButton.setAttribute("aria-label", `${group.collapsed ? "展开" : "折叠"}分组 ${group.name}`);
  collapseButton.addEventListener("click", () => toggleGroup(group.id));

  /** 删除当前分组的按钮。 */
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "danger-button";
  deleteButton.textContent = "删除";
  deleteButton.addEventListener("click", () => deleteGroup(group.id));

  actions.append(openButton, collapseButton, deleteButton);
  header.append(titleBlock, actions);
  groupElement.appendChild(header);

  if (!group.collapsed) {
    /** 当前分组的链接网格。 */
    const linkGrid = document.createElement("div");
    linkGrid.className = "link-grid";
    linkGrid.dataset.groupId = group.id;

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
      await handleLinkGridDrop(activeSpace.id, group.id);
    });

    if (group.links.length === 0) {
      linkGrid.appendChild(createTextElement("div", "panel-message", "这个分组里还没有链接，可以把右侧标签拖进来。"));
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
 * 创建单个链接卡片 DOM 元素。
 *
 * @param {string} groupId 链接所属分组 ID。
 * @param {object} link 链接数据。
 * @returns {HTMLElement} 链接卡片元素。
 */
function createLinkElement(groupId, link) {
  /** 链接卡片按钮。 */
  const card = document.createElement("button");
  card.type = "button";
  card.className = "link-card";
  card.title = `${link.title}\n${link.url}`;
  card.draggable = true;
  card.dataset.linkId = link.id;

  if (state.batchDeleteEnabled) {
    card.classList.add("batch-mode");
  }

  if (state.selectedLinkIds.has(link.id)) {
    card.classList.add("selected");
  }

  /** 链接标题和地址区域。 */
  const content = document.createElement("div");
  content.className = "link-content";
  content.append(createTextElement("div", "link-title", link.title || link.url));
  content.append(createTextElement("div", "link-url", link.url));

  /** 单个链接删除按钮。 */
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "link-action-button";
  deleteButton.textContent = "×";
  deleteButton.setAttribute("aria-label", `删除链接 ${link.title || link.url}`);

  card.addEventListener("click", () => {
    if (state.batchDeleteEnabled) {
      toggleSelectedLink(link.id);
      return;
    }

    openLink(link.url);
  });

  card.addEventListener("dragstart", (event) => {
    event.stopPropagation();
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
    await handleLinkDrop(groupId, link.id);
  });

  deleteButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    await deleteLink(groupId, link.id);
  });

  if (state.batchDeleteEnabled) {
    /** 批量删除模式下的勾选状态标记。 */
    const checkbox = document.createElement("span");
    checkbox.className = "batch-check";
    checkbox.textContent = state.selectedLinkIds.has(link.id) ? "✓" : "";
    card.append(checkbox);
  }

  card.append(createFavicon(link.favIconUrl, link.title || link.url), content, deleteButton);
  return card;
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

  for (const tab of state.currentTabs) {
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

    item.append(createFavicon(tab.favIconUrl, tab.title || tab.url), content);
    item.addEventListener("click", () => activateTab(tab.tabId));
    item.addEventListener("dragstart", (event) => {
      event.stopPropagation();
      state.draggedTab = tab;
      event.dataTransfer.setData("text/plain", tab.url);
    });
    elements.currentTabsList.appendChild(item);
  }
}

/**
 * 新建空间。
 *
 * @returns {Promise<void>} 创建并保存后结束。
 */
async function createSpace() {
  /** 用户输入的空间名称。 */
  const name = prompt("请输入空间名称");

  if (!name || !name.trim()) {
    if (name !== null) {
      alert("请输入空间名称");
    }
    return;
  }

  /** 当前时间戳。 */
  const now = Date.now();
  /** 新空间数据。 */
  const space = {
    id: createId("space"),
    name: name.trim(),
    icon: "folder",
    groups: [],
    createdAt: now,
    updatedAt: now
  };

  state.data.spaces.unshift(space);
  state.data.activeSpaceId = space.id;
  await saveData();
  renderAll();
}

/**
 * 删除指定空间。
 *
 * @param {string} spaceId 待删除空间 ID。
 * @returns {Promise<void>} 删除并保存后结束。
 */
async function deleteSpace(spaceId) {
  /** 待删除空间。 */
  const space = state.data.spaces.find((item) => item.id === spaceId);

  if (!space) {
    return;
  }

  if (state.data.spaces.length <= 1) {
    alert("至少需要保留一个空间。");
    return;
  }

  /** 用户删除确认结果。 */
  const confirmed = confirm(`确定删除空间「${space.name}」吗？该空间下的所有分组和链接都会被删除。`);

  if (!confirmed) {
    return;
  }

  state.data.spaces = state.data.spaces.filter((item) => item.id !== spaceId);

  if (state.data.activeSpaceId === spaceId) {
    state.data.activeSpaceId = state.data.spaces[0].id;
  }

  await saveData();
  renderAll();
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
  const name = prompt("请输入分组名称");

  if (!name || !name.trim()) {
    if (name !== null) {
      alert("请输入分组名称");
    }
    return;
  }

  /** 当前时间戳。 */
  const now = Date.now();
  activeSpace.groups.unshift({
    id: createId("group"),
    name: name.trim(),
    collapsed: false,
    links: [],
    createdAt: now,
    updatedAt: now
  });
  activeSpace.updatedAt = now;

  await saveData();
  renderAll();
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
  const group = activeSpace && activeSpace.groups.find((item) => item.id === groupId);

  if (!activeSpace || !group) {
    return;
  }

  /** 用户删除确认结果。 */
  const confirmed = confirm(`确定删除分组「${group.name}」吗？该分组下的所有链接都会被删除。`);

  if (!confirmed) {
    return;
  }

  activeSpace.groups = activeSpace.groups.filter((item) => item.id !== groupId);
  activeSpace.updatedAt = Date.now();

  await saveData();
  renderAll();
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
  const group = activeSpace && activeSpace.groups.find((item) => item.id === groupId);

  if (!group) {
    return;
  }

  group.collapsed = !group.collapsed;
  group.updatedAt = Date.now();
  activeSpace.updatedAt = Date.now();

  await saveData();
  renderAll();
}

/**
 * 删除指定链接。
 *
 * @param {string} groupId 链接所属分组 ID。
 * @param {string} linkId 待删除链接 ID。
 * @returns {Promise<void>} 删除并保存后结束。
 */
async function deleteLink(groupId, linkId) {
  /** 当前激活空间。 */
  const activeSpace = getActiveSpace();
  /** 链接所属分组。 */
  const group = activeSpace && activeSpace.groups.find((item) => item.id === groupId);

  if (!group) {
    return;
  }

  /** 用户删除确认结果。 */
  const confirmed = confirm("确定删除这个链接吗？");

  if (!confirmed) {
    return;
  }

  group.links = group.links.filter((link) => link.id !== linkId);
  group.updatedAt = Date.now();
  activeSpace.updatedAt = Date.now();
  state.selectedLinkIds.delete(linkId);

  await saveData();
  renderAll();
}

/**
 * 打开指定 URL。
 *
 * @param {string} url 待打开链接地址。
 * @returns {Promise<void>} 打开后结束。
 */
async function openLink(url) {
  if (!url) {
    return;
  }

  if (hasChromeTabs()) {
    await chrome.tabs.create({ url });
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * 打开指定分组内的所有链接。
 *
 * @param {string} groupId 分组 ID。
 * @returns {Promise<void>} 打开完成后结束。
 */
async function openGroup(groupId) {
  /** 当前激活空间。 */
  const activeSpace = getActiveSpace();
  /** 待打开的分组。 */
  const group = activeSpace && activeSpace.groups.find((item) => item.id === groupId);

  if (!group || group.links.length === 0) {
    alert("这个分组里没有链接。");
    return;
  }

  if (group.links.length > 20) {
    /** 大批量打开前的用户确认结果。 */
    const confirmed = confirm(`该分组包含 ${group.links.length} 个链接，确定全部打开吗？`);

    if (!confirmed) {
      return;
    }
  }

  for (const link of group.links) {
    await openLink(link.url);
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
    renderCurrentTabs();
    return;
  }

  /** 当前浏览器窗口中的标签页。 */
  const tabs = await chrome.tabs.query({
    currentWindow: true
  });

  state.currentTabs = filterValidTabs(tabs).map((tab) => ({
    tabId: tab.id,
    title: tab.title || tab.url,
    url: tab.url,
    favIconUrl: tab.favIconUrl || ""
  }));

  renderCurrentTabs();
}

/**
 * 激活浏览器中的指定标签页。
 *
 * @param {number} tabId 浏览器标签页 ID。
 * @returns {Promise<void>} 激活后结束。
 */
async function activateTab(tabId) {
  if (!hasChromeTabs() || typeof tabId !== "number") {
    return;
  }

  await chrome.tabs.update(tabId, {
    active: true
  });
}

/**
 * 将当前窗口所有可保存标签页保存为一个新分组。
 *
 * @returns {Promise<void>} 保存完成后结束。
 */
async function saveCurrentTabsToGroup() {
  /** 当前激活空间。 */
  const activeSpace = getActiveSpace();

  if (!activeSpace) {
    return;
  }

  /** 从当前标签页转换得到的链接数组。 */
  const links = tabsToLinks(state.currentTabs);

  if (links.length === 0) {
    alert("当前窗口没有可保存的普通网页标签。");
    return;
  }

  /** 默认分组名称。 */
  const defaultName = `保存于 ${formatDateTime(Date.now())}`;
  /** 用户输入的分组名称。 */
  const name = prompt("请输入分组名称", defaultName);

  if (!name || !name.trim()) {
    return;
  }

  /** 当前时间戳。 */
  const now = Date.now();
  activeSpace.groups.unshift({
    id: createId("group"),
    name: name.trim(),
    collapsed: false,
    createdAt: now,
    updatedAt: now,
    links
  });
  activeSpace.updatedAt = now;

  await saveData();
  renderAll();
}

/**
 * 下载文本文件。
 *
 * @param {string} filename 下载文件名。
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
  const filename = `mytabdesk-backup-${formatDateTime(Date.now()).replace(/[: ]/g, "-")}.json`;
  downloadTextFile(filename, exportData(state.data));
}

/**
 * 请求选择导入文件。
 *
 * @returns {void}
 */
function requestImportData() {
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
    /** 解析并迁移后的导入数据。 */
    const importedData = importData(text);
    /** 覆盖当前数据前的用户确认结果。 */
    const confirmed = confirm("导入会覆盖当前所有本地数据，确定继续吗？");

    if (!confirmed) {
      return;
    }

    state.data = importedData;
    state.selectedLinkIds.clear();
    state.batchDeleteEnabled = false;
    await saveData();
    renderAll();
    alert("数据导入成功。");
  } catch (error) {
    alert(error.message || "数据导入失败，请检查文件内容。");
  }
}

/**
 * 清空所有数据并恢复默认空间。
 *
 * @returns {Promise<void>} 清空并保存后结束。
 */
async function clearData() {
  /** 清空数据前的用户确认结果。 */
  const confirmed = confirm("确定清空所有数据并恢复默认空间吗？该操作不可撤销，建议先导出备份。");

  if (!confirmed) {
    return;
  }

  state.data = clearAllData();
  state.selectedLinkIds.clear();
  state.batchDeleteEnabled = false;
  await saveData();
  renderAll();
}

/**
 * 切换浅色和深色主题。
 *
 * @returns {Promise<void>} 切换并保存后结束。
 */
async function toggleTheme() {
  state.data.settings.theme = state.data.settings.theme === "dark" ? "light" : "dark";
  await saveData();
  renderAll();
}

/**
 * 切换左侧空间栏折叠状态。
 *
 * @returns {Promise<void>} 切换并保存后结束。
 */
async function toggleSidebar() {
  state.data.settings.sidebarCollapsed = !state.data.settings.sidebarCollapsed;
  await saveData();
  renderAll();
}

/**
 * 切换右侧标签页栏折叠状态。
 *
 * @returns {Promise<void>} 切换并保存后结束。
 */
async function toggleTabsPanel() {
  state.data.settings.rightPanelCollapsed = !state.data.settings.rightPanelCollapsed;
  await saveData();
  renderAll();
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

  renderAll();
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

  renderGroups();
}

/**
 * 确认删除批量选中的链接。
 *
 * @returns {Promise<void>} 删除并保存后结束。
 */
async function confirmBatchDelete() {
  if (state.selectedLinkIds.size === 0) {
    alert("请先选择需要删除的链接。");
    return;
  }

  /** 批量删除前的用户确认结果。 */
  const confirmed = confirm(`确定删除选中的 ${state.selectedLinkIds.size} 个链接吗？`);

  if (!confirmed) {
    return;
  }

  /** 当前激活空间。 */
  const activeSpace = getActiveSpace();

  for (const group of activeSpace.groups) {
    group.links = group.links.filter((link) => !state.selectedLinkIds.has(link.id));
    group.updatedAt = Date.now();
  }

  activeSpace.updatedAt = Date.now();
  state.selectedLinkIds.clear();
  state.batchDeleteEnabled = false;
  await saveData();
  renderAll();
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
  await saveData();
  renderAll();
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

  state.data = reorderGroups(state.data, spaceId, state.draggedGroupId, targetGroupId);
  state.draggedGroupId = "";
  await saveData();
  renderAll();
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
  await saveData();
  renderAll();
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
    await saveData();
    renderAll();
    return;
  }

  state.data = reorderLinks(state.data, activeSpace.id, groupId, state.draggedLink.linkId, targetLinkId);
  state.draggedLink = null;
  await saveData();
  renderAll();
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
  await saveData();
  renderAll();
}

/**
 * 切换到设置页视图。
 *
 * @returns {void}
 */
function openSettings() {
  state.viewMode = "settings";
  renderAll();
}

/**
 * 从设置页返回工作台视图。
 *
 * @returns {void}
 */
function closeSettings() {
  state.viewMode = "workspace";
  renderAll();
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
  const updatedAt = getDataUpdatedAt(state.data);

  elements.syncModeValue.textContent = "手动同步基础版";
  elements.syncDeviceIdValue.textContent = sync.deviceId || "-";
  elements.syncLastModifiedValue.textContent = updatedAt > 0 ? formatDateTime(updatedAt) : "-";
  elements.syncLastBackupValue.textContent = sync.lastBackupAt > 0 ? formatDateTime(sync.lastBackupAt) : "从未备份";
  elements.syncLastImportValue.textContent = sync.lastImportAt > 0 ? formatDateTime(sync.lastImportAt) : "从未导入";
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
    alert("请先输入备份密码。");
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
    await saveData();
    renderSettingsStatus();
    alert("加密备份已导出。");
  } catch (error) {
    alert("加密备份导出失败：" + (error.message || "未知错误"));
  }
}

/**
 * 请求选择加密备份文件进行导入。
 *
 * @returns {void}
 */
function requestImportEncryptedBackup() {
  /** 用户输入的备份密码。 */
  const password = elements.backupPasswordInput.value;

  if (!password) {
    alert("请先输入备份密码。");
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
    alert("请先输入备份密码。");
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

      if (!confirm(messages.join("\n") + "\n是否继续导入？")) {
        elements.encryptedBackupFileInput.value = "";
        return;
      }
    }

    state.data = importedData;
    state.data.settings.sync.lastImportAt = getCurrentTime();
    await saveData();
    renderAll();
    alert("加密备份已成功导入。");
  } catch (error) {
    alert("导入失败：" + (error.message || "密码错误或文件损坏"));
  }

  elements.encryptedBackupFileInput.value = "";
}

/**
 * 绑定页面级事件。
 *
 * @returns {void}
 */
function bindEvents() {
  elements.createSpaceBtn.addEventListener("click", createSpace);
  elements.createGroupBtn.addEventListener("click", createGroup);
  elements.refreshTabsBtn.addEventListener("click", refreshCurrentTabs);
  elements.saveCurrentTabsBtn.addEventListener("click", saveCurrentTabsToGroup);
  elements.exportBtn.addEventListener("click", exportCurrentData);
  elements.importBtn.addEventListener("click", requestImportData);
  elements.importFileInput.addEventListener("change", importSelectedFile);
  elements.clearDataBtn.addEventListener("click", clearData);
  elements.toggleThemeBtn.addEventListener("click", toggleTheme);
  elements.toggleSidebarBtn.addEventListener("click", toggleSidebar);
  elements.toggleTabsPanelBtn.addEventListener("click", toggleTabsPanel);
  elements.batchDeleteBtn.addEventListener("click", toggleBatchDelete);
  elements.confirmBatchDeleteBtn.addEventListener("click", confirmBatchDelete);
  elements.cancelBatchDeleteBtn.addEventListener("click", toggleBatchDelete);
  elements.settingsBtn.addEventListener("click", openSettings);
  elements.backToWorkspaceBtn.addEventListener("click", closeSettings);
  elements.exportEncryptedBtn.addEventListener("click", handleExportEncryptedBackup);
  elements.importEncryptedBtn.addEventListener("click", requestImportEncryptedBackup);
  elements.encryptedBackupFileInput.addEventListener("change", importEncryptedBackupFile);
  elements.searchInput.addEventListener("input", (event) => {
    state.searchKeyword = event.target.value;
    renderGroups();
  });
  document.addEventListener("dragend", () => {
    state.draggedSpaceId = "";
    state.draggedGroupId = "";
    state.draggedLink = null;
    state.draggedTab = null;
  });
}

/**
 * 绑定页面 DOM 元素引用。
 *
 * @returns {void}
 */
function bindElements() {
  elements.appShell = getElement("appShell");
  elements.importFileInput = getElement("importFileInput");
  elements.encryptedBackupFileInput = getElement("encryptedBackupFileInput");
  elements.createSpaceBtn = getElement("createSpaceBtn");
  elements.toggleSidebarBtn = getElement("toggleSidebarBtn");
  elements.spaceList = getElement("spaceList");
  elements.exportBtn = getElement("exportBtn");
  elements.importBtn = getElement("importBtn");
  elements.settingsBtn = getElement("settingsBtn");
  elements.clearDataBtn = getElement("clearDataBtn");
  elements.currentSpaceName = getElement("currentSpaceName");
  elements.currentSpaceMeta = getElement("currentSpaceMeta");
  elements.searchInput = getElement("searchInput");
  elements.toggleThemeBtn = getElement("toggleThemeBtn");
  elements.toggleTabsPanelBtn = getElement("toggleTabsPanelBtn");
  elements.batchDeleteBtn = getElement("batchDeleteBtn");
  elements.createGroupBtn = getElement("createGroupBtn");
  elements.batchBar = getElement("batchBar");
  elements.confirmBatchDeleteBtn = getElement("confirmBatchDeleteBtn");
  elements.cancelBatchDeleteBtn = getElement("cancelBatchDeleteBtn");
  elements.groupList = getElement("groupList");
  elements.emptyState = getElement("emptyState");
  elements.workspaceToolbar = getElement("workspaceToolbar");
  elements.settingsView = getElement("settingsView");
  elements.backToWorkspaceBtn = getElement("backToWorkspaceBtn");
  elements.backupPasswordInput = getElement("backupPasswordInput");
  elements.exportEncryptedBtn = getElement("exportEncryptedBtn");
  elements.importEncryptedBtn = getElement("importEncryptedBtn");
  elements.syncModeValue = getElement("syncModeValue");
  elements.syncDeviceIdValue = getElement("syncDeviceIdValue");
  elements.syncLastModifiedValue = getElement("syncLastModifiedValue");
  elements.syncLastBackupValue = getElement("syncLastBackupValue");
  elements.syncLastImportValue = getElement("syncLastImportValue");
  elements.tabsTitle = getElement("tabsTitle");
  elements.refreshTabsBtn = getElement("refreshTabsBtn");
  elements.saveCurrentTabsBtn = getElement("saveCurrentTabsBtn");
  elements.currentTabsList = getElement("currentTabsList");
}

/**
 * 初始化新标签页应用。
 *
 * @returns {Promise<void>} 初始化完成后结束。
 */
async function init() {
  bindElements();
  state.data = ensureSyncSettings(await loadData());
  await saveData();
  bindEvents();
  renderAll();
  await refreshCurrentTabs();
}

document.addEventListener("DOMContentLoaded", init);
