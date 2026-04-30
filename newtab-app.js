(function (root) {
const {
  STORAGE_KEY,
  APP_VERSION,
  BACKUP_VERSION,
  createDefaultData,
  normalizeData,
  migrateData,
  createId,
  getCurrentTime,
  resolveSafeWebDavFileUrl,
  createBasicAuthHeader,
  isSyncProviderEnabled,
  getEnabledSyncProviders,
  isMyTabDeskGist,
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

root.MyTabDeskPage = {
  STORAGE_KEY,
  APP_VERSION,
  BACKUP_VERSION,
  createDefaultData,
  normalizeData,
  migrateData,
  createId,
  getCurrentTime,
  resolveSafeWebDavFileUrl,
  createBasicAuthHeader,
  isSyncProviderEnabled,
  getEnabledSyncProviders,
  isMyTabDeskGist,
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
  clearAllData,
  state,
  elements,
  SPACE_ICON_OPTIONS,
  UI_DEFAULT_SPACE_ICON
};
})(globalThis);
