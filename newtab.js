(function () {
const {
  STORAGE_KEY,
  APP_VERSION,
  BACKUP_VERSION,
  createDefaultData,
  normalizeData,
  migrateData,
  createId,
  getCurrentTime,
  resolveWebDavSyncUrl,
  ensureSyncSettings,
  getDataUpdatedAt,
  mergeWorkspaceData,
  createEncryptedBackup,
  restoreEncryptedBackup,
  detectImportConflict,
  isValidTabUrl,
  dedupeTabsByUrl,
  filterValidTabs,
  tabsToLinks,
  filterGroups,
  filterCurrentTabs,
  exportData,
  importData,
  createBackupSafeData,
  reorderSpaces,
  reorderGroups,
  reorderLinks,
  moveLinkBetweenGroups,
  updateLink,
  addLinksToGroup,
  clearAllData
} = globalThis.MyTabDeskCore;

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
  /** 当前标签栏搜索关键词。 */
  tabSearchKeyword: "",
  /** 是否处于批量删除模式。 */
  batchDeleteEnabled: false,
  /** 批量删除模式中已选中的链接 ID 集合。 */
  selectedLinkIds: new Set(),
  /** 正在拖拽的空间 ID。 */
  draggedSpaceId: "",
  /** 正在拖拽的分组 ID。 */
  draggedGroupId: "",
  /** 正在编辑名称的分组 ID。 */
  editingGroupId: "",
  /** 正在显示移动空间菜单的分组 ID。 */
  movingGroupId: "",
  /** 正在拖拽的链接信息。 */
  draggedLink: null,
  /** 正在从右栏拖拽的浏览器标签页。 */
  draggedTab: null,
  /** 自动同步防抖定时器 ID。 */
  autoSyncTimerId: 0,
  /** 是否正在执行自动同步。 */
  autoSyncRunning: false,
  /** 最近一次已保存的工作台数据快照。 */
  lastWorkspaceSnapshot: "",
  /** 正在显示菜单的空间 ID。 */
  openSpaceMenuId: "",
  /** 正在显示菜单的链接 ID。 */
  openLinkMenuId: "",
  /** 正在编辑的链接上下文。 */
  editingLinkContext: null,
  /** 当前通用弹窗关闭后的回调函数。 */
  appDialogResolver: null,
  /** 当前页面通用弹窗类型。 */
  appDialogType: "alert",
  /** 是否正在显示创建空间方式菜单。 */
  createSpaceMenuOpen: false,
  /** 当前文件导入模式：data 表示全量数据，space 表示单空间。 */
  importMode: "data",
  /** 是否正在显示创建空间弹窗。 */
  createSpaceDialogOpen: false,
  /** 创建空间弹窗错误提示文本。 */
  createSpaceDialogError: "",
  /** 正在更改图标的空间 ID。 */
  iconPickerSpaceId: "",
  /** 图标选择弹窗中当前选中的图标。 */
  selectedSpaceIcon: "",
  /** 当前页面视图模式：workspace 表示工作台，settings 表示设置页。 */
  viewMode: "workspace"
};

/**
 * 页面 DOM 元素引用集合，初始化后由各渲染和事件函数复用。
 */
const elements = {};

/**
 * 可供空间使用的彩色图标集合，使用开源 Emoji 图标风格保证浏览器插件离线可用。
 */
const SPACE_ICON_OPTIONS = [
  "📁", "⭐", "💼", "📌", "🧭", "🚀", "🧠", "💡", "📚", "📝",
  "🔖", "🗂️", "🧰", "⚙️", "🖥️", "🖱️", "⌨️", "🌐", "🔗", "🧪",
  "🎯", "📊", "📈", "📦", "🛠️", "🔐", "☁️", "🔥", "🌈", "🍀",
  "🏠", "🏢", "🛒", "💰", "🎨", "🎵", "🎬", "📷", "🕒", "✅"
];

/**
 * 默认空间图标。
 */
const UI_DEFAULT_SPACE_ICON = "📁";

/**
 * 获取空间显示图标，兼容旧版本保存的英文图标值。
 *
 * @param {string} iconValue 空间保存的图标值。
 * @returns {string} 用于界面展示的彩色图标。
 */
function getDisplaySpaceIcon(iconValue) {
  if (!iconValue || iconValue === "folder") {
    return UI_DEFAULT_SPACE_ICON;
  }

  return iconValue;
}

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
 * 获取当前同步设置对象。
 *
 * @returns {object|null} 当前同步配置，未初始化时返回 null。
 */
function getSyncSettings() {
  return state.data && state.data.settings ? state.data.settings.sync : null;
}

/**
 * 判断当前同步服务商是否启用自动上传。
 *
 * @param {object} sync 当前同步配置。
 * @returns {boolean} 自动上传可用时返回 true。
 */
function isAutoSyncEnabled(sync) {
  if (!sync) {
    return false;
  }

  return sync.provider === "webdav" && sync.webdavAutoSyncEnabled || sync.provider === "gist" && sync.gistAutoSyncEnabled;
}

/**
 * 判断当前保存是否应该标记为待自动同步。
 *
 * @param {object} options 保存选项。
 * @returns {boolean} 需要标记自动同步时返回 true。
 */
function shouldMarkAutoSyncPending(options) {
  return !(options && options.skipAutoSync);
}

/**
 * 创建只包含工作台业务数据的快照文本。
 *
 * @returns {string} 工作台业务数据快照。
 */
function createWorkspaceSnapshot() {
  if (!state.data) {
    return "";
  }

  return JSON.stringify({
    spaces: state.data.spaces
  });
}

/**
 * 判断本地工作台业务数据是否发生变化。
 *
 * @returns {boolean} 数据发生变化时返回 true。
 */
function hasWorkspaceDataChanged() {
  /** 当前工作台业务数据快照。 */
  const snapshot = createWorkspaceSnapshot();

  if (snapshot === state.lastWorkspaceSnapshot) {
    return false;
  }

  state.lastWorkspaceSnapshot = snapshot;
  return true;
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
    await showAlert("数据读取失败，已为你恢复默认数据。");
    return createDefaultData();
  }
}

/**
 * 保存当前工作台数据到本地存储。
 *
 * @param {object} options 保存选项。
 * @returns {Promise<void>} 保存完成后结束。
 */
async function saveData(options = {}) {
  /** 本次保存是否需要尝试标记自动同步。 */
  const shouldCheckAutoSync = shouldMarkAutoSyncPending(options);
  /** 本次保存是否存在工作台业务数据变化。 */
  const workspaceChanged = shouldCheckAutoSync && hasWorkspaceDataChanged();

  if (workspaceChanged) {
    /** 当前同步配置。 */
    const sync = getSyncSettings();

    if (isAutoSyncEnabled(sync)) {
      /** 当前时间戳。 */
      const now = getCurrentTime();
      sync.autoSyncPendingAt = now;
      sync.lastAutoSyncError = "";
    }
  }

  if (!hasChromeStorage()) {
    return;
  }

  try {
    await chrome.storage.local.set({
      [STORAGE_KEY]: state.data
    });
  } catch (error) {
    await showAlert("数据保存失败，请稍后重试。");
  }

  if (workspaceChanged) {
    scheduleAutoSync();
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
 * 统计全部工作台数据的空间、分组和链接数量。
 *
 * @param {object} data 工作台全量数据。
 * @returns {object} 统计结果对象。
 */
function getDataSummary(data) {
  /** 全部空间列表。 */
  const spaces = data && Array.isArray(data.spaces) ? data.spaces : [];
  /** 全部分组数量。 */
  const groupCount = spaces.reduce((total, space) => total + (Array.isArray(space.groups) ? space.groups.length : 0), 0);
  /** 全部链接数量。 */
  const linkCount = spaces.reduce((total, space) => total + getTotalLinks(space), 0);

  return {
    spaceCount: spaces.length,
    groupCount,
    linkCount
  };
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
 * 关闭页面通用弹窗并返回结果。
 *
 * @param {boolean} confirmed 用户是否确认。
 * @returns {void}
 */
function closeAppDialog(confirmed) {
  /** 当前通用弹窗关闭后的回调函数。 */
  const resolver = state.appDialogResolver;
  /** 当前弹窗是否为输入类型。 */
  const isPrompt = state.appDialogType === "prompt";
  /** 输入型弹窗的返回值。 */
  const promptValue = confirmed ? elements.appDialogInput.value : null;

  state.appDialogResolver = null;
  state.appDialogType = "alert";
  elements.appDialog.hidden = true;

  if (resolver) {
    resolver(isPrompt ? promptValue : confirmed);
  }
}

/**
 * 显示页面内统一弹窗。
 *
 * @param {object} options 弹窗配置。
 * @returns {Promise<boolean|string|null>} 弹窗关闭后的结果。
 */
function showAppDialog(options) {
  /** 弹窗类型。 */
  const type = options.type || "alert";
  /** 是否为确认或输入弹窗。 */
  const needsCancel = type === "confirm" || type === "prompt";

  state.appDialogType = type;
  elements.appDialogTitle.textContent = options.title || "提示";
  elements.appDialogMessage.textContent = options.message || "";
  elements.appDialogInputWrap.hidden = type !== "prompt";
  elements.appDialogInput.value = options.defaultValue || "";
  elements.appDialogInput.setAttribute("aria-label", options.inputLabel || options.title || "输入内容");
  elements.appDialogCancelBtn.hidden = !needsCancel;
  elements.appDialogCancelBtn.textContent = options.cancelText || "取消";
  elements.appDialogConfirmBtn.textContent = options.confirmText || "确认";
  elements.appDialog.hidden = false;

  return new Promise((resolve) => {
    state.appDialogResolver = resolve;
    requestAnimationFrame(() => {
      if (type === "prompt") {
        elements.appDialogInput.focus();
        elements.appDialogInput.select();
        return;
      }

      elements.appDialogConfirmBtn.focus();
    });
  });
}

/**
 * 显示页面内提示弹窗。
 *
 * @param {string} message 提示文本。
 * @param {string} title 弹窗标题。
 * @returns {Promise<boolean>} 用户确认后返回 true。
 */
function showAlert(message, title = "提示") {
  return showAppDialog({
    type: "alert",
    title,
    message,
    confirmText: "知道了"
  });
}

/**
 * 显示页面内确认弹窗。
 *
 * @param {string} message 确认文本。
 * @param {string} title 弹窗标题。
 * @returns {Promise<boolean>} 用户确认时返回 true，取消时返回 false。
 */
function showConfirm(message, title = "确认操作") {
  return showAppDialog({
    type: "confirm",
    title,
    message,
    confirmText: "确认",
    cancelText: "取消"
  });
}

/**
 * 显示页面内输入弹窗。
 *
 * @param {string} message 输入说明文本。
 * @param {string} defaultValue 默认输入值。
 * @param {string} title 弹窗标题。
 * @returns {Promise<string|null>} 用户输入文本，取消时返回 null。
 */
function showPrompt(message, defaultValue = "", title = "请输入") {
  return showAppDialog({
    type: "prompt",
    title,
    message,
    defaultValue,
    inputLabel: message,
    confirmText: "确认",
    cancelText: "取消"
  });
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
  exportButton.addEventListener("click", () => exportSpace(space.id));
  deleteButton.addEventListener("click", () => deleteSpace(space.id));

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
  state.openSpaceMenuId = "";
  renderSpaces();
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
  renderSpaceIconPicker();
}

/**
 * 渲染空间图标选择弹窗。
 *
 * @returns {void}
 */
function renderSpaceIconPicker() {
  elements.spaceIconDialog.hidden = !state.iconPickerSpaceId;

  if (!state.iconPickerSpaceId) {
    clearElement(elements.spaceIconGrid);
    return;
  }

  clearElement(elements.spaceIconGrid);

  for (const icon of SPACE_ICON_OPTIONS) {
    /** 图标选项按钮。 */
    const button = document.createElement("button");
    button.type = "button";
    button.className = "space-icon-option";
    button.textContent = icon;
    button.setAttribute("aria-label", `选择图标 ${icon}`);

    if (icon === state.selectedSpaceIcon) {
      button.classList.add("selected");
    }

    button.addEventListener("click", () => {
      state.selectedSpaceIcon = icon;
      renderSpaceIconPicker();
    });

    elements.spaceIconGrid.appendChild(button);
  }
}

/**
 * 确认修改空间图标。
 *
 * @returns {Promise<void>} 保存图标后结束。
 */
async function confirmSpaceIconChange() {
  /** 待修改图标的空间。 */
  const space = state.data.spaces.find((item) => item.id === state.iconPickerSpaceId);

  if (!space || !state.selectedSpaceIcon) {
    closeSpaceIconPicker();
    return;
  }

  space.icon = state.selectedSpaceIcon;
  space.updatedAt = Date.now();
  closeSpaceIconPicker();
  await saveData();
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
  groupElement.draggable = !group.pinned;
  groupElement.dataset.groupId = group.id;

  if (group.pinned) {
    groupElement.classList.add("pinned");
  }

  groupElement.addEventListener("dragstart", (event) => {
    if (group.pinned) {
      event.preventDefault();
      return;
    }

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
  titleBlock.append(createGroupNameElement(group));
  titleBlock.append(createTextElement("div", "group-meta", `${group.links.length} 个链接 · ${group.pinned ? "已固定" : "可拖拽排序"}`));

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

  /** 固定或取消固定当前分组的按钮。 */
  const pinButton = document.createElement("button");
  pinButton.type = "button";
  pinButton.className = "group-small-button";
  pinButton.textContent = group.pinned ? "取消固定" : "固定";
  pinButton.setAttribute("aria-label", `${group.pinned ? "取消固定" : "固定"}分组 ${group.name}`);
  pinButton.addEventListener("click", () => toggleGroupPinned(group.id));

  /** 移动当前分组到其他空间的操作容器。 */
  const moveWrap = document.createElement("div");
  moveWrap.className = "group-move-wrap";

  /** 移动当前分组到其他空间的按钮。 */
  const moveButton = document.createElement("button");
  moveButton.type = "button";
  moveButton.className = "group-small-button group-move-button";
  moveButton.textContent = "移动到空间 ›";
  moveButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMoveGroupMenu(group.id);
  });
  moveWrap.appendChild(moveButton);

  if (state.movingGroupId === group.id) {
    moveWrap.appendChild(createMoveGroupMenuElement(group));
  }

  /** 删除当前分组的按钮。 */
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "danger-button";
  deleteButton.textContent = "删除";
  deleteButton.addEventListener("click", () => deleteGroup(group.id));

  actions.append(openButton, collapseButton, pinButton, moveWrap, deleteButton);
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
        await renameGroup(group.id, input.value);
      }

      if (event.key === "Escape") {
        state.editingGroupId = "";
        renderGroups();
      }
    });
    input.addEventListener("blur", () => renameGroup(group.id, input.value));
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
      moveGroupToSpace(group.id, space.id);
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
      toggleSelectedLink(link.id);
      return;
    }

    openLink(link.url);
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
    await handleLinkDrop(groupId, link.id);
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
    openEditLinkDialog(groupId, link.id);
  });

  /** 删除链接按钮。 */
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "link-menu-action danger";
  deleteButton.textContent = "删除";
  deleteButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    state.openLinkMenuId = "";
    await deleteLink(groupId, link.id);
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
  const visibleTabs = filterCurrentTabs(state.currentTabs, tabKeyword);

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
      await saveSingleTabToGroup(tab);
    });

    item.append(createFavicon(tab.favIconUrl, tab.title || tab.url), content, saveButton);
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
 * 从创建菜单触发新建空白空间。
 *
 * @returns {Promise<void>} 创建流程结束后结束。
 */
async function createBlankSpaceFromMenu() {
  openCreateSpaceDialog();
}

/**
 * 提示 Toby 导入能力暂未开放。
 *
 * @returns {void}
 */
/**
 * 提示浏览器书签导入能力暂未开放。
 *
 * @returns {void}
 */
async function showBookmarksImportPlaceholder() {
  closeCreateSpaceMenu();
  await showAlert("浏览器书签导入需要启用 bookmarks 权限，后续会接入 chrome.bookmarks 读取书签。");
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
    renderCreateSpaceDialog();
    elements.createSpaceNameInput.focus();
    return;
  }

  /** 去除前后空格后的空间名称。 */
  const trimmedName = name.trim();
  /** 是否已经存在同名空间。 */
  const nameExists = state.data.spaces.some((space) => space.name.trim() === trimmedName);

  if (nameExists) {
    state.createSpaceDialogError = "空间名称已存在，请换一个名称。";
    renderCreateSpaceDialog();
    elements.createSpaceNameInput.select();
    return;
  }

  /** 当前时间戳。 */
  const now = Date.now();
  /** 新空间数据。 */
  const space = {
    id: createId("space"),
    name: trimmedName,
    icon: UI_DEFAULT_SPACE_ICON,
    groups: [],
    createdAt: now,
    updatedAt: now
  };

  state.data.spaces.push(space);
  state.data.activeSpaceId = space.id;
  closeCreateSpaceDialog();
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
    await showAlert("至少需要保留一个空间。");
    return;
  }

  /** 用户删除确认结果。 */
  const confirmed = await showConfirm(`确定删除空间「${space.name}」吗？该空间下的所有分组和链接都会被删除。`);

  if (!confirmed) {
    return;
  }

  state.data.spaces = state.data.spaces.filter((item) => item.id !== spaceId);

  if (state.data.activeSpaceId === spaceId) {
    state.data.activeSpaceId = state.data.spaces[0].id;
  }

  state.openSpaceMenuId = "";
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
  const name = await showPrompt("请输入分组名称", "", "添加分组");

  if (!name || !name.trim()) {
    if (name !== null) {
      await showAlert("请输入分组名称");
    }
    return;
  }

  /** 当前时间戳。 */
  const now = Date.now();
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
  const confirmed = await showConfirm(`确定删除分组「${group.name}」吗？该分组下的所有链接都会被删除。`);

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
 * 固定或取消固定当前空间内的分组。
 *
 * @param {string} groupId 分组 ID。
 * @returns {Promise<void>} 切换并保存后结束。
 */
async function toggleGroupPinned(groupId) {
  /** 当前激活空间。 */
  const activeSpace = getActiveSpace();
  /** 待切换固定状态的分组。 */
  const group = activeSpace && activeSpace.groups.find((item) => item.id === groupId);

  if (!group) {
    return;
  }

  group.pinned = !group.pinned;
  group.updatedAt = Date.now();
  activeSpace.updatedAt = Date.now();
  state.draggedGroupId = "";

  await saveData();
  renderAll();
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
  renderGroups();
}

/**
 * 将当前空间内的分组移动到指定空间末尾。
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
  /** 当前时间戳。 */
  const now = Date.now();
  sourceSpace.groups.splice(sourceGroupIndex, 1);
  targetSpace.groups.push({
    ...group,
    updatedAt: now
  });
  sourceSpace.updatedAt = now;
  targetSpace.updatedAt = now;
  state.movingGroupId = "";
  state.draggedGroupId = "";

  await saveData();
  renderAll();
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
  const group = activeSpace && activeSpace.groups.find((item) => item.id === groupId);

  if (!group) {
    return;
  }

  /** 去除前后空格后的分组名称。 */
  const trimmedName = String(name || "").trim();
  state.editingGroupId = "";

  if (!trimmedName || trimmedName === group.name) {
    renderGroups();
    return;
  }

  group.name = trimmedName;
  group.updatedAt = Date.now();
  activeSpace.updatedAt = Date.now();

  await saveData();
  renderAll();
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
  const group = activeSpace && activeSpace.groups.find((item) => item.id === groupId);
  /** 待编辑链接。 */
  const link = group && group.links.find((item) => item.id === linkId);

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
  renderGroups();
  requestAnimationFrame(() => {
    elements.editLinkTitleInput.focus();
    elements.editLinkTitleInput.select();
  });
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
    elements.editLinkError.textContent = "这个链接地址不能保存，请输入普通网页链接。";
    elements.editLinkUrlInput.focus();
    return;
  }

  try {
    /** 当前编辑上下文。 */
    const context = state.editingLinkContext;
    state.data = updateLink(state.data, context.spaceId, context.groupId, context.linkId, {
      title,
      url,
      favIconUrl
    });
    closeEditLinkDialog();
    await saveData();
    renderAll();
  } catch (error) {
    elements.editLinkError.textContent = error.message || "保存失败，请检查输入内容。";
  }
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
  const confirmed = await showConfirm("确定删除这个链接吗？");

  if (!confirmed) {
    return;
  }

  group.links = group.links.filter((link) => link.id !== linkId);
  group.updatedAt = Date.now();
  activeSpace.updatedAt = Date.now();
  state.selectedLinkIds.delete(linkId);
  state.openLinkMenuId = "";

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
    await showAlert("这个分组里没有链接。");
    return;
  }

  if (group.links.length > 20) {
    /** 大批量打开前的用户确认结果。 */
    const confirmed = await showConfirm(`该分组包含 ${group.links.length} 个链接，确定全部打开吗？`);

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
    await showAlert("当前窗口没有可保存的普通网页标签。");
    return;
  }

  /** 默认分组名称。 */
  const defaultName = `保存于 ${formatDateTime(Date.now())}`;
  /** 用户输入的分组名称。 */
  const name = await showPrompt("请输入分组名称", defaultName, "保存当前标签页");

  if (!name || !name.trim()) {
    return;
  }

  /** 当前时间戳。 */
  const now = Date.now();
  activeSpace.groups.unshift({
    id: createId("group"),
    name: name.trim(),
    collapsed: false,
    pinned: false,
    createdAt: now,
    updatedAt: now,
    links
  });
  activeSpace.updatedAt = now;

  await saveData();
  renderAll();
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

  if (!activeSpace || !tab) {
    return;
  }

  if (activeSpace.groups.length === 0) {
    await showAlert("请先创建一个分组，再保存单个标签。");
    return;
  }

  /** 分组选择提示文本。 */
  const groupOptions = activeSpace.groups.map((group, index) => `${index + 1}. ${group.name}`).join("\n");
  /** 用户输入的分组序号。 */
  const input = await showPrompt(`请输入要保存到的分组序号：\n${groupOptions}`, "1", "保存到分组");

  if (!input) {
    return;
  }

  /** 用户选择的分组索引。 */
  const groupIndex = Number(input) - 1;
  /** 用户选择的目标分组。 */
  const targetGroup = activeSpace.groups[groupIndex];

  if (!Number.isInteger(groupIndex) || !targetGroup) {
    await showAlert("请输入有效的分组序号。");
    return;
  }

  state.data = addLinksToGroup(state.data, activeSpace.id, targetGroup.id, tabsToLinks([tab]));
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
 * 导出指定空间数据。
 *
 * @param {string} spaceId 空间 ID。
 * @returns {void}
 */
function exportSpace(spaceId) {
  /** 待导出的空间。 */
  const space = state.data.spaces.find((item) => item.id === spaceId);

  if (!space) {
    return;
  }

  /** 当前时间戳。 */
  const now = getCurrentTime();
  /** 空间导出文件名。 */
  const filename = `mytabdesk-space-${space.name}-${formatDateTime(now).replace(/[: ]/g, "-")}.json`;
  /** 空间导出数据包。 */
  const payload = JSON.stringify({
    backupVersion: BACKUP_VERSION,
    appVersion: APP_VERSION,
    exportedAt: now,
    type: "space",
    space
  }, null, 2);

  state.openSpaceMenuId = "";
  renderSpaces();
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
    /** 覆盖当前数据前的用户确认结果。 */
    const confirmed = await showConfirm("导入会覆盖当前所有本地数据，确定继续吗？");

    if (!confirmed) {
      return;
    }

    state.data = importedData;
    state.selectedLinkIds.clear();
    state.batchDeleteEnabled = false;
    state.lastWorkspaceSnapshot = createWorkspaceSnapshot();
    await saveData({ skipAutoSync: true });
    renderAll();
    await showAlert("数据导入成功。");
  } catch (error) {
    await showAlert(error.message || "数据导入失败，请检查文件内容。");
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
  let parsedData = null;

  try {
    parsedData = JSON.parse(text);
  } catch (error) {
    throw new Error("导入空间文件不是有效的 JSON");
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
        icon: importedSpace.icon || UI_DEFAULT_SPACE_ICON,
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
  await saveData();
  renderAll();
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

  /** 当前操作空间。 */
  const space = state.data.spaces.find((item) => item.id === spaceId);
  /** 正在拖拽的分组。 */
  const sourceGroup = space && space.groups.find((item) => item.id === state.draggedGroupId);
  /** 放置目标分组。 */
  const targetGroup = space && space.groups.find((item) => item.id === targetGroupId);

  if (!sourceGroup || !targetGroup || sourceGroup.pinned || targetGroup.pinned) {
    state.draggedGroupId = "";
    renderGroups();
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
 * 获取自动同步状态展示文本。
 *
 * @param {object} sync 当前同步配置。
 * @returns {string} 自动同步状态文本。
 */
function getAutoSyncStatusText(sync) {
  if (!isAutoSyncEnabled(sync)) {
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
  const updatedAt = getDataUpdatedAt(state.data);
  /** 当前数据统计信息。 */
  const summary = getDataSummary(state.data);
  /** 当前同步服务商。 */
  const provider = sync.provider || "none";

  elements.settingsVersionValue.textContent = state.data.version || "-";
  elements.settingsSpaceCountValue.textContent = summary.spaceCount;
  elements.settingsGroupCountValue.textContent = summary.groupCount;
  elements.settingsLinkCountValue.textContent = summary.linkCount;
  elements.syncModeValue.textContent = provider !== "none" ? `手动同步：${provider}` : "手动同步基础版";
  elements.syncDeviceIdValue.textContent = sync.deviceId || "-";
  elements.syncLastModifiedValue.textContent = updatedAt > 0 ? formatDateTime(updatedAt) : "-";
  elements.syncLastBackupValue.textContent = sync.lastBackupAt > 0 ? formatDateTime(sync.lastBackupAt) : "从未备份";
  elements.syncLastImportValue.textContent = sync.lastImportAt > 0 ? formatDateTime(sync.lastImportAt) : sync.lastSyncAt > 0 ? `最近同步 ${formatDateTime(sync.lastSyncAt)}` : "从未导入";
  elements.syncAutoStatusValue.textContent = getAutoSyncStatusText(sync);
  elements.gistSyncSwitch.checked = provider === "gist";
  elements.webdavSyncSwitch.checked = provider === "webdav";
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
    await saveData({ skipAutoSync: true });
    renderSettingsStatus();
    await showAlert("加密备份已导出。");
  } catch (error) {
    await showAlert("加密备份导出失败：" + (error.message || "未知错误"));
  }
}

/**
 * 请求选择加密备份文件进行导入。
 *
 * @returns {void}
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
    await saveData({ skipAutoSync: true });
    renderAll();
    await showAlert("加密备份已成功导入。");
  } catch (error) {
    await showAlert("导入失败：" + (error.message || "密码错误或文件损坏"));
  }

  elements.encryptedBackupFileInput.value = "";
}

/**
 * 从设置表单读取同步配置。
 *
 * @returns {object} 表单中的同步配置对象。
 */
function readSyncSettingsForm() {
  /** 表单中选中的同步服务商。 */
  const provider = elements.webdavSyncSwitch.checked ? "webdav" : elements.gistSyncSwitch.checked ? "gist" : "none";

  return {
    provider,
    webdavUrl: elements.webdavUrlInput.value.trim(),
    webdavUsername: elements.webdavUsernameInput.value.trim(),
    webdavPassword: elements.webdavPasswordInput.value,
    webdavFilename: elements.webdavFilenameInput.value.trim(),
    webdavAutoSyncEnabled: elements.webdavAutoSyncSwitch.checked,
    gistToken: elements.gistTokenInput.value.trim(),
    gistId: elements.gistIdInput.value.trim(),
    gistFilename: elements.gistFilenameInput.value.trim() || "mytabdesk-sync.json",
    gistAutoSyncEnabled: elements.gistAutoSyncSwitch.checked
  };
}

/**
 * 保存同步配置到本地数据。
 *
 * @returns {Promise<void>} 保存完成后结束。
 */
async function saveSyncSettingsFromForm() {
  /** 表单同步配置。 */
  const form = readSyncSettingsForm();
  /** 当前同步配置。 */
  const sync = state.data.settings.sync;

  Object.assign(sync, form);
  await saveData({ skipAutoSync: true });
  renderSettingsStatus();
}

/**
 * 切换启用的远程同步服务商。
 *
 * @param {string} provider 需要启用的同步服务商。
 * @returns {void}
 */
function selectSyncProvider(provider) {
  if (provider === "gist") {
    elements.gistSyncSwitch.checked = true;
    elements.webdavSyncSwitch.checked = false;
  } else if (provider === "webdav") {
    elements.gistSyncSwitch.checked = false;
    elements.webdavSyncSwitch.checked = true;
  } else {
    elements.gistSyncSwitch.checked = false;
    elements.webdavSyncSwitch.checked = false;
  }
}

/**
 * 保存同步配置并提示用户。
 *
 * @returns {Promise<void>} 保存完成后结束。
 */
async function handleSaveSyncSettings() {
  await saveSyncSettingsFromForm();
  await showAlert("同步配置已保存。");
}

/**
 * 创建用于云端同步的普通备份文本。
 *
 * @returns {string} JSON 备份文本。
 */
function createSyncPayload() {
  return exportData(state.data);
}

/**
 * 自动上传本地数据到当前远程服务商。
 *
 * @param {object} sync 当前同步配置。
 * @returns {Promise<void>} 上传完成后结束。
 */
async function uploadAutoSync(sync) {
  /** 自动同步备份文本。 */
  const payload = createSyncPayload();

  if (sync.provider === "webdav") {
    await uploadWebDav(sync, payload);
    return;
  }

  /** 上传后返回的 Gist ID。 */
  const gistId = await uploadGist(sync, payload);
  state.data.settings.sync.gistId = gistId;

  if (elements.gistIdInput) {
    elements.gistIdInput.value = gistId;
  }
}

/**
 * 从当前远程服务商下载云端同步数据。
 *
 * @param {object} sync 当前同步配置。
 * @returns {Promise<object|null>} 解析后的远端数据，远端不存在时返回 null。
 */
async function downloadRemoteSyncData(sync) {
  try {
    /** 云端备份文本。 */
    const payload = sync.provider === "webdav" ? await downloadWebDav(sync) : await downloadGist(sync);
    return importData(payload);
  } catch (error) {
    /** 错误消息文本。 */
    const message = error && error.message ? error.message : "";
    /** 是否为远端文件不存在错误。 */
    const isMissingRemote = message.includes("404") || message.includes("未找到指定同步文件") || message.includes("请先填写 Gist ID");

    if (isMissingRemote) {
      return null;
    }

    throw error;
  }
}

/**
 * 将同步配置状态更新为已完成。
 *
 * @param {object} sync 当前同步配置。
 * @param {number} syncedAt 同步完成时间戳。
 * @returns {void}
 */
function markSyncCompleted(sync, syncedAt) {
  sync.lastSyncAt = syncedAt;
  sync.lastBackupAt = syncedAt;
  sync.lastImportAt = syncedAt;
  sync.lastAutoSyncAt = syncedAt;
  sync.autoSyncPendingAt = 0;
  sync.lastAutoSyncError = "";
}

/**
 * 执行一次自动双向同步，先拉取远端数据，再自动合并并上传合并结果。
 *
 * @param {object} sync 当前同步配置。
 * @returns {Promise<void>} 同步完成后结束。
 */
async function runBidirectionalSync(sync) {
  /** 本地同步配置副本。 */
  const localSync = Object.assign({}, state.data.settings.sync);
  /** 远端工作台数据。 */
  const remoteData = await downloadRemoteSyncData(sync);

  if (remoteData) {
    state.data = mergeWorkspaceData(state.data, remoteData, localSync.deviceId);
    Object.assign(state.data.settings.sync, localSync, {
      provider: sync.provider
    });
  }

  await uploadAutoSync(state.data.settings.sync);
  markSyncCompleted(state.data.settings.sync, getCurrentTime());
  state.lastWorkspaceSnapshot = createWorkspaceSnapshot();
  await saveData({ skipAutoSync: true });
}

/**
 * 立即执行一次待处理自动同步。
 *
 * @returns {Promise<void>} 同步尝试完成后结束。
 */
async function runAutoSyncNow() {
  /** 当前同步配置。 */
  const sync = getSyncSettings();

  if (state.autoSyncRunning || !isAutoSyncEnabled(sync) || !sync.autoSyncPendingAt) {
    return;
  }

  state.autoSyncRunning = true;

  try {
    validateSyncSettings();
    await runBidirectionalSync(sync);
  } catch (error) {
    sync.lastAutoSyncError = error.message || "自动同步失败";
    await saveData({ skipAutoSync: true });
  } finally {
    state.autoSyncRunning = false;
    renderSettingsStatus();
  }
}

/**
 * 延迟调度一次自动同步，避免连续改动时重复上传。
 *
 * @returns {void}
 */
function scheduleAutoSync() {
  /** 当前同步配置。 */
  const sync = getSyncSettings();

  if (!isAutoSyncEnabled(sync) || !sync.autoSyncPendingAt) {
    return;
  }

  if (state.autoSyncTimerId) {
    clearTimeout(state.autoSyncTimerId);
  }

  state.autoSyncTimerId = window.setTimeout(() => {
    state.autoSyncTimerId = 0;
    runAutoSyncNow();
  }, 1200);
}

/**
 * 校验当前同步服务商配置。
 *
 * @returns {object} 当前同步配置。
 * @throws {Error} 当同步配置不完整时抛出错误。
 */
function validateSyncSettings() {
  /** 当前同步配置。 */
  const sync = state.data.settings.sync || {};

  if (sync.provider === "webdav") {
    if (!sync.webdavUrl || !sync.webdavUsername || !sync.webdavPassword) {
      throw new Error("请先完整填写 WebDAV 地址、用户名和密码。");
    }
  } else if (sync.provider === "gist") {
    if (!sync.gistToken) {
      throw new Error("请先填写 GitHub Gist Token。");
    }
  } else {
    throw new Error("请先选择 WebDAV 或 GitHub Gist 同步方式。");
  }

  return sync;
}

/**
 * 上传备份文本到 WebDAV。
 *
 * @param {object} sync 同步配置。
 * @param {string} payload 待上传的备份文本。
 * @returns {Promise<void>} 上传完成后结束。
 * @throws {Error} 当服务端返回失败状态时抛出错误。
 */
async function uploadWebDav(sync, payload) {
  /** 解析后的 WebDAV 同步文件地址。 */
  const fileUrl = resolveWebDavSyncUrl(sync.webdavUrl, sync.webdavFilename);
  /** WebDAV 上传响应。 */
  const response = await fetch(fileUrl, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${btoa(`${sync.webdavUsername}:${sync.webdavPassword}`)}`,
      "Content-Type": "application/json;charset=utf-8"
    },
    body: payload
  });

  if (!response.ok) {
    throw new Error(`WebDAV 上传失败：${response.status}`);
  }
}

/**
 * 从 WebDAV 下载备份文本。
 *
 * @param {object} sync 同步配置。
 * @returns {Promise<string>} 下载得到的备份文本。
 * @throws {Error} 当服务端返回失败状态时抛出错误。
 */
async function downloadWebDav(sync) {
  /** 解析后的 WebDAV 同步文件地址。 */
  const fileUrl = resolveWebDavSyncUrl(sync.webdavUrl, sync.webdavFilename);
  /** WebDAV 下载响应。 */
  const response = await fetch(fileUrl, {
    method: "GET",
    headers: {
      Authorization: `Basic ${btoa(`${sync.webdavUsername}:${sync.webdavPassword}`)}`
    }
  });

  if (!response.ok) {
    throw new Error(`WebDAV 下载失败：${response.status}`);
  }

  return response.text();
}

/**
 * 上传备份文本到 GitHub Gist。
 *
 * @param {object} sync 同步配置。
 * @param {string} payload 待上传的备份文本。
 * @returns {Promise<string>} 上传后使用的 Gist ID。
 * @throws {Error} 当服务端返回失败状态时抛出错误。
 */
async function uploadGist(sync, payload) {
  /** Gist 文件名。 */
  const filename = sync.gistFilename || "mytabdesk-sync.json";
  /** Gist 请求地址。 */
  const url = sync.gistId ? `https://api.github.com/gists/${sync.gistId}` : "https://api.github.com/gists";
  /** Gist 上传响应。 */
  const response = await fetch(url, {
    method: sync.gistId ? "PATCH" : "POST",
    headers: {
      Authorization: `Bearer ${sync.gistToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json;charset=utf-8"
    },
    body: JSON.stringify({
      description: "MyTabDesk manual sync backup",
      public: false,
      files: {
        [filename]: {
          content: payload
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`GitHub Gist 上传失败：${response.status}`);
  }

  /** Gist 响应数据。 */
  const result = await response.json();
  return result.id || sync.gistId;
}

/**
 * 从 GitHub Gist 下载备份文本。
 *
 * @param {object} sync 同步配置。
 * @returns {Promise<string>} 下载得到的备份文本。
 * @throws {Error} 当服务端返回失败状态时抛出错误。
 */
async function downloadGist(sync) {
  if (!sync.gistId) {
    throw new Error("请先填写 Gist ID，或先上传一次自动创建 Gist。");
  }

  /** Gist 下载响应。 */
  const response = await fetch(`https://api.github.com/gists/${sync.gistId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${sync.gistToken}`,
      Accept: "application/vnd.github+json"
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub Gist 下载失败：${response.status}`);
  }

  /** Gist 响应数据。 */
  const result = await response.json();
  /** Gist 文件名。 */
  const filename = sync.gistFilename || "mytabdesk-sync.json";
  /** 目标 Gist 文件。 */
  const file = result.files && result.files[filename] ? result.files[filename] : null;

  if (!file || typeof file.content !== "string") {
    throw new Error("Gist 中未找到指定同步文件。");
  }

  return file.content;
}

/**
 * 手动上传当前数据到云端。
 *
 * @returns {Promise<void>} 上传完成后结束。
 */
async function uploadManualSync(provider) {
  try {
    selectSyncProvider(provider);
    await saveSyncSettingsFromForm();
    /** 当前同步配置。 */
    const sync = validateSyncSettings();
    /** 同步备份文本。 */
    const payload = createSyncPayload();

    if (sync.provider === "webdav") {
      await uploadWebDav(sync, payload);
    } else {
      /** 上传后返回的 Gist ID。 */
      const gistId = await uploadGist(sync, payload);
      state.data.settings.sync.gistId = gistId;
      elements.gistIdInput.value = gistId;
    }

    state.data.settings.sync.lastSyncAt = getCurrentTime();
    state.data.settings.sync.lastBackupAt = state.data.settings.sync.lastSyncAt;
    state.data.settings.sync.autoSyncPendingAt = 0;
    state.data.settings.sync.lastAutoSyncAt = state.data.settings.sync.lastSyncAt;
    state.data.settings.sync.lastAutoSyncError = "";
    await saveData({ skipAutoSync: true });
    renderSettingsStatus();
    await showAlert("已上传到云端。");
  } catch (error) {
    await showAlert(error.message || "上传到云端失败。");
  }
}

/**
 * 从云端下载数据并导入本地。
 *
 * @returns {Promise<void>} 下载导入完成后结束。
 */
async function downloadManualSync(provider) {
  try {
    selectSyncProvider(provider);
    await saveSyncSettingsFromForm();
    /** 当前同步配置。 */
    const sync = validateSyncSettings();
    await runBidirectionalSync(sync);
    renderAll();
    await showAlert("已从云端下载、自动合并并回传云端。");
  } catch (error) {
    await showAlert(error.message || "从云端下载失败。");
  }
}

/**
 * 绑定页面级事件。
 *
 * @returns {void}
 */
function bindEvents() {
  elements.appDialog.addEventListener("click", (event) => {
    if (event.target === elements.appDialog) {
      closeAppDialog(state.appDialogType === "alert");
    }
  });
  elements.appDialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAppDialog(state.appDialogType === "alert");
    }
  });
  elements.appDialogCancelBtn.addEventListener("click", () => closeAppDialog(false));
  elements.appDialogConfirmBtn.addEventListener("click", () => closeAppDialog(true));
  elements.appDialogInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      closeAppDialog(true);
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeAppDialog(false);
    }
  });
  elements.editLinkDialog.addEventListener("click", (event) => {
    if (event.target === elements.editLinkDialog) {
      closeEditLinkDialog();
    }
  });
  elements.editLinkDialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeEditLinkDialog();
    }
  });
  elements.closeEditLinkDialogBtn.addEventListener("click", closeEditLinkDialog);
  elements.cancelEditLinkBtn.addEventListener("click", closeEditLinkDialog);
  elements.confirmEditLinkBtn.addEventListener("click", submitEditLinkDialog);

  for (const input of [elements.editLinkTitleInput, elements.editLinkUrlInput, elements.editLinkIconInput]) {
    input.addEventListener("input", () => {
      elements.editLinkError.textContent = "";
    });
    input.addEventListener("keydown", async (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        await submitEditLinkDialog();
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeEditLinkDialog();
      }
    });
  }
  elements.createSpaceBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleCreateSpaceMenu();
  });
  elements.createBlankSpaceBtn.addEventListener("click", createBlankSpaceFromMenu);
  elements.importSpaceBtn.addEventListener("click", requestImportSpace);
  elements.importBookmarksBtn.addEventListener("click", showBookmarksImportPlaceholder);
  elements.closeSpaceIconDialogBtn.addEventListener("click", closeSpaceIconPicker);
  elements.cancelSpaceIconBtn.addEventListener("click", closeSpaceIconPicker);
  elements.confirmSpaceIconBtn.addEventListener("click", confirmSpaceIconChange);
  elements.createSpaceDialog.addEventListener("click", (event) => {
    if (event.target === elements.createSpaceDialog) {
      closeCreateSpaceDialog();
    }
  });
  elements.closeCreateSpaceDialogBtn.addEventListener("click", closeCreateSpaceDialog);
  elements.cancelCreateSpaceBtn.addEventListener("click", closeCreateSpaceDialog);
  elements.confirmCreateSpaceBtn.addEventListener("click", submitCreateSpaceDialog);
  elements.createSpaceNameInput.addEventListener("input", () => {
    state.createSpaceDialogError = "";
    renderCreateSpaceDialog();
  });
  elements.createSpaceNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      submitCreateSpaceDialog();
    }

    if (event.key === "Escape") {
      closeCreateSpaceDialog();
    }
  });
  elements.spaceIconDialog.addEventListener("click", (event) => {
    if (event.target === elements.spaceIconDialog) {
      closeSpaceIconPicker();
    }
  });
  elements.createGroupBtn.addEventListener("click", createGroup);
  elements.refreshTabsBtn.addEventListener("click", refreshCurrentTabs);
  elements.saveCurrentTabsBtn.addEventListener("click", saveCurrentTabsToGroup);
  elements.importFileInput.addEventListener("change", importSelectedFile);
  elements.toggleThemeBtn.addEventListener("click", toggleTheme);
  elements.toggleSidebarBtn.addEventListener("click", toggleSidebar);
  elements.toggleTabsPanelBtn.addEventListener("click", toggleTabsPanel);
  elements.batchDeleteBtn.addEventListener("click", toggleBatchDelete);
  elements.confirmBatchDeleteBtn.addEventListener("click", confirmBatchDelete);
  elements.cancelBatchDeleteBtn.addEventListener("click", toggleBatchDelete);
  elements.settingsBtn.addEventListener("click", openSettings);
  elements.offlineExportBtn.addEventListener("click", exportCurrentData);
  elements.offlineImportBtn.addEventListener("click", requestImportData);
  elements.exportEncryptedBtn.addEventListener("click", handleExportEncryptedBackup);
  elements.importEncryptedBtn.addEventListener("click", requestImportEncryptedBackup);
  elements.saveSyncSettingsBtn.addEventListener("click", handleSaveSyncSettings);
  elements.gistSyncSwitch.addEventListener("change", async () => {
    selectSyncProvider(elements.gistSyncSwitch.checked ? "gist" : "none");
    await saveSyncSettingsFromForm();
  });
  elements.webdavSyncSwitch.addEventListener("change", async () => {
    selectSyncProvider(elements.webdavSyncSwitch.checked ? "webdav" : "none");
    await saveSyncSettingsFromForm();
  });
  elements.gistAutoSyncSwitch.addEventListener("change", saveSyncSettingsFromForm);
  elements.webdavAutoSyncSwitch.addEventListener("change", saveSyncSettingsFromForm);
  elements.gistUploadSyncBtn.addEventListener("click", () => uploadManualSync("gist"));
  elements.gistDownloadSyncBtn.addEventListener("click", () => downloadManualSync("gist"));
  elements.webdavUploadSyncBtn.addEventListener("click", () => uploadManualSync("webdav"));
  elements.webdavDownloadSyncBtn.addEventListener("click", () => downloadManualSync("webdav"));
  elements.encryptedBackupFileInput.addEventListener("change", importEncryptedBackupFile);
  elements.searchInput.addEventListener("input", (event) => {
    state.searchKeyword = event.target.value;
    renderGroups();
  });
  elements.tabSearchInput.addEventListener("input", (event) => {
    state.tabSearchKeyword = event.target.value;
    renderCurrentTabs();
  });
  document.addEventListener("dragend", () => {
    state.draggedSpaceId = "";
    state.draggedGroupId = "";
    state.draggedLink = null;
    state.draggedTab = null;
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".space-item") && !event.target.closest(".space-menu-panel")) {
      state.openSpaceMenuId = "";
      renderSpaces();
    }

    if (!event.target.closest(".create-space-wrap")) {
      closeCreateSpaceMenu();
    }

    if (!event.target.closest(".link-card") && state.openLinkMenuId) {
      state.openLinkMenuId = "";
      renderGroups();
    }
  });
}

/**
 * 绑定页面 DOM 元素引用。
 *
 * @returns {void}
 */
function bindElements() {
  elements.appShell = getElement("appShell");
  elements.appDialog = getElement("appDialog");
  elements.appDialogTitle = getElement("appDialogTitle");
  elements.appDialogMessage = getElement("appDialogMessage");
  elements.appDialogInputWrap = getElement("appDialogInputWrap");
  elements.appDialogInput = getElement("appDialogInput");
  elements.appDialogCancelBtn = getElement("appDialogCancelBtn");
  elements.appDialogConfirmBtn = getElement("appDialogConfirmBtn");
  elements.editLinkDialog = getElement("editLinkDialog");
  elements.editLinkTitleInput = getElement("editLinkTitleInput");
  elements.editLinkUrlInput = getElement("editLinkUrlInput");
  elements.editLinkIconInput = getElement("editLinkIconInput");
  elements.editLinkError = getElement("editLinkError");
  elements.closeEditLinkDialogBtn = getElement("closeEditLinkDialogBtn");
  elements.cancelEditLinkBtn = getElement("cancelEditLinkBtn");
  elements.confirmEditLinkBtn = getElement("confirmEditLinkBtn");
  elements.importFileInput = getElement("importFileInput");
  elements.encryptedBackupFileInput = getElement("encryptedBackupFileInput");
  elements.createSpaceBtn = getElement("createSpaceBtn");
  elements.createSpaceMenu = getElement("createSpaceMenu");
  elements.createBlankSpaceBtn = getElement("createBlankSpaceBtn");
  elements.importSpaceBtn = getElement("importSpaceBtn");
  elements.importBookmarksBtn = getElement("importBookmarksBtn");
  elements.toggleSidebarBtn = getElement("toggleSidebarBtn");
  elements.spaceList = getElement("spaceList");
  elements.spaceIconDialog = getElement("spaceIconDialog");
  elements.spaceIconGrid = getElement("spaceIconGrid");
  elements.createSpaceDialog = getElement("createSpaceDialog");
  elements.createSpaceNameInput = getElement("createSpaceNameInput");
  elements.createSpaceError = getElement("createSpaceError");
  elements.closeCreateSpaceDialogBtn = getElement("closeCreateSpaceDialogBtn");
  elements.cancelCreateSpaceBtn = getElement("cancelCreateSpaceBtn");
  elements.confirmCreateSpaceBtn = getElement("confirmCreateSpaceBtn");
  elements.closeSpaceIconDialogBtn = getElement("closeSpaceIconDialogBtn");
  elements.cancelSpaceIconBtn = getElement("cancelSpaceIconBtn");
  elements.confirmSpaceIconBtn = getElement("confirmSpaceIconBtn");
  elements.settingsBtn = getElement("settingsBtn");
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
  elements.offlineExportBtn = getElement("offlineExportBtn");
  elements.offlineImportBtn = getElement("offlineImportBtn");
  elements.backupPasswordInput = getElement("backupPasswordInput");
  elements.exportEncryptedBtn = getElement("exportEncryptedBtn");
  elements.importEncryptedBtn = getElement("importEncryptedBtn");
  elements.gistSyncSwitch = getElement("gistSyncSwitch");
  elements.webdavSyncSwitch = getElement("webdavSyncSwitch");
  elements.gistAutoSyncSwitch = getElement("gistAutoSyncSwitch");
  elements.webdavAutoSyncSwitch = getElement("webdavAutoSyncSwitch");
  elements.webdavUrlInput = getElement("webdavUrlInput");
  elements.webdavUsernameInput = getElement("webdavUsernameInput");
  elements.webdavPasswordInput = getElement("webdavPasswordInput");
  elements.webdavFilenameInput = getElement("webdavFilenameInput");
  elements.gistTokenInput = getElement("gistTokenInput");
  elements.gistIdInput = getElement("gistIdInput");
  elements.gistFilenameInput = getElement("gistFilenameInput");
  elements.saveSyncSettingsBtn = getElement("saveSyncSettingsBtn");
  elements.gistUploadSyncBtn = getElement("gistUploadSyncBtn");
  elements.gistDownloadSyncBtn = getElement("gistDownloadSyncBtn");
  elements.webdavUploadSyncBtn = getElement("webdavUploadSyncBtn");
  elements.webdavDownloadSyncBtn = getElement("webdavDownloadSyncBtn");
  elements.syncModeValue = getElement("syncModeValue");
  elements.syncDeviceIdValue = getElement("syncDeviceIdValue");
  elements.syncLastModifiedValue = getElement("syncLastModifiedValue");
  elements.syncLastBackupValue = getElement("syncLastBackupValue");
  elements.syncLastImportValue = getElement("syncLastImportValue");
  elements.syncAutoStatusValue = getElement("syncAutoStatusValue");
  elements.settingsVersionValue = getElement("settingsVersionValue");
  elements.settingsSpaceCountValue = getElement("settingsSpaceCountValue");
  elements.settingsGroupCountValue = getElement("settingsGroupCountValue");
  elements.settingsLinkCountValue = getElement("settingsLinkCountValue");
  elements.tabsTitle = getElement("tabsTitle");
  elements.tabSearchInput = getElement("tabSearchInput");
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
  state.lastWorkspaceSnapshot = createWorkspaceSnapshot();
  await saveData({ skipAutoSync: true });
  bindEvents();
  renderAll();
  scheduleAutoSync();
  await refreshCurrentTabs();
}

document.addEventListener("DOMContentLoaded", init);
})();
