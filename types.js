/**
 * MyTabDesk 核心类型定义
 *
 * 本文件使用 JSDoc 类型注解，可在 JavaScript 项目中提供 TypeScript 级别的类型检查。
 * 在 VS Code 等 IDE 中会自动识别并提供智能提示。
 */

/**
 * @typedef {Object} Link
 * @description 单个链接（书签）数据
 * @property {string} id - 链接唯一标识符
 * @property {string} title - 链接显示标题
 * @property {string} url - 链接 URL 地址
 * @property {string} favIconUrl - 网站图标 URL
 * @property {number} createdAt - 创建时间戳（毫秒）
 * @property {number} [updatedAt] - 更新时间戳（毫秒）
 * @property {number} [order] - 分组内排序值，缺失时按 createdAt 回落，用于保留拖拽顺序
 */

/**
 * @typedef {Object} Group
 * @description 分组数据，用于组织链接
 * @property {string} id - 分组唯一标识符
 * @property {string} name - 分组名称
 * @property {boolean} collapsed - 是否折叠
 * @property {boolean} pinned - 是否固定（固定分组不可拖拽排序）
 * @property {Link[]} links - 分组内的链接列表
 * @property {number} createdAt - 创建时间戳
 * @property {number} updatedAt - 更新时间戳
 */

/**
 * @typedef {Object} Space
 * @description 空间数据，顶层容器
 * @property {string} id - 空间唯一标识符
 * @property {string} name - 空间名称
 * @property {string} icon - 空间图标（ Emoji 字符）
 * @property {Group[]} groups - 空间内的分组列表
 * @property {number} createdAt - 创建时间戳
 * @property {number} updatedAt - 更新时间戳
 */

/**
 * @typedef {Object} SyncSettings
 * @description 同步配置
 * @property {string} deviceId - 设备唯一标识
 * @property {string} deviceName - 设备显示名称
 * @property {string} mode - 同步模式：manual | auto
 * @property {number} lastBackupAt - 上次备份时间
 * @property {number} lastImportAt - 上次导入时间
 * @property {string} provider - 同步服务商：none | webdav | gist | both
 * @property {string} webdavUrl - WebDAV 服务器地址
 * @property {string} webdavUsername - WebDAV 用户名
 * @property {string} webdavPassword - WebDAV 密码
 * @property {string} webdavFilename - WebDAV 同步文件名
 * @property {boolean} webdavAutoSyncEnabled - WebDAV 自动同步是否启用
 * @property {string} gistToken - GitHub Gist Token
 * @property {string} gistId - GitHub Gist ID
 * @property {string} gistFilename - Gist 同步文件名
 * @property {boolean} gistAutoSyncEnabled - Gist 自动同步是否启用
 * @property {number} stateUpdatedAt - 同步运行状态独立版本时间
 * @property {number} autoSyncPendingAt - 待自动同步时间戳
 * @property {number} lastAutoSyncAt - 上次自动同步时间戳
 * @property {string} lastAutoSyncError - 上次自动同步错误信息
 * @property {number} lastSyncAt - 上次同步时间戳
 */

/**
 * @typedef {Object} Settings
 * @description 应用设置
 * @property {'light'|'dark'} theme - 主题：light（浅色）或 dark（深色）
 * @property {boolean} rightPanelCollapsed - 右侧面板是否折叠
 * @property {boolean} sidebarCollapsed - 侧边栏是否折叠
 * @property {boolean} compactLinks - 链接卡片是否使用紧凑视图（只显示图标和标题）
 * @property {SyncSettings} sync - 同步配置
 */

/**
 * @typedef {Object} WorkspaceData
 * @description 工作台全量数据
 * @property {number} version - 数据版本号
 * @property {string} activeSpaceId - 当前激活空间 ID
 * @property {Space[]} spaces - 全部空间列表
 * @property {Settings} settings - 应用设置
 */

/**
 * @typedef {Object} TabInfo
 * @description 浏览器标签页信息
 * @property {number} tabId - Chrome 标签页 ID
 * @property {string} title - 标签页标题
 * @property {string} url - 标签页 URL
 * @property {string} favIconUrl - 标签页图标 URL
 */

/**
 * @typedef {'alert'|'confirm'|'prompt'} DialogType
 * @description 弹窗类型
 */

/**
 * @typedef {'none'|'webdav'|'gist'|'both'} SyncProvider
 * @description 同步服务商类型
 */

/**
 * @typedef {'success'|'error'|'info'|'warning'} NotificationType
 * @description 通知类型
 */

/**
 * @typedef {Object} NotificationConfig
 * @description 通知配置
 * @property {number} duration - 显示时长（毫秒）
 * @property {string} icon - 图标名称
 */