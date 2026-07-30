# MyTabDesk

MyTabDesk 是一个本地优先的浏览器新标签页工作台扩展，用来保存、整理和恢复浏览器标签页。它通过“空间 - 分组 - 链接”的结构，帮助你把不同任务场景下的网页收纳起来。

## 核心功能

- 三栏新标签页工作台
- 空间创建、切换、删除和排序
- 分组创建、折叠、置顶、删除和排序
- 链接展示、打开、编辑、删除和跨分组移动
- 当前窗口标签页读取、搜索和保存
- 深色模式、左栏折叠、右栏折叠
- 批量删除链接
- 完整原生备份导入和导出
- TabTab 兼容导出与导入
- AES-GCM 加密备份导入和导出
- WebDAV / GitHub Gist 手动同步和自动同步
- 右键菜单快速保存页面或链接

## 安装方式

1. 打开 `chrome://extensions/` 或 `edge://extensions/`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择当前项目目录。
5. 打开新标签页即可使用 MyTabDesk。

## 使用说明

1. 在左侧创建或切换工作空间。
2. 在中间区域创建分组，或从右侧保存当前窗口标签页。
3. 点击链接卡片可在新标签页打开网页。
4. 点击分组的“打开全部”可恢复该分组内保存的网页。
5. 使用搜索框按分组名、链接标题或 URL 搜索。
6. 在设置页中可以导入、导出、加密备份和配置远程同步。

## 权限说明

| 权限 | 用途 |
| --- | --- |
| `tabs` | 读取当前窗口标签页、切换标签页、打开新标签页 |
| `storage` | 将空间、分组、链接和设置保存到本地浏览器 |
| `contextMenus` | 提供右键菜单快速保存入口 |
| `notifications` | 显示保存成功、失败和提示通知 |
| `activeTab` | 在当前活动标签页场景下辅助读取页面信息 |
| `favicon` | 使用浏览器内置 favicon 服务显示站点图标 |
| `https://*/*` | 访问 WebDAV 和 GitHub Gist 同步地址 |

项目默认不读取浏览历史、收藏夹或 Cookie，也不会把数据上传到自有服务器。

## 数据与隐私

所有工作台数据默认保存在 `chrome.storage.local` 中。完整原生备份会保留空间图标、布局、排序、更新时间和删除墓碑；TabTab 兼容导出只保留可见的空间、分组和链接。所有备份（包括加密备份）都会剔除 WebDAV 地址、账号、密码、GitHub Token 和同步加密密码，远程连接信息需要在新设备上重新填写。

如果启用远程同步，远程地址、账号或访问令牌只应保存在本地浏览器扩展存储中，不应写入代码仓库或公开文档。

## 开发与测试

项目不依赖构建工具，可以直接作为浏览器扩展加载。

运行核心逻辑、浏览器消息、同步网络、传输和界面文案测试：

```powershell
npm.cmd test
```

运行真实 Chromium 扩展端到端测试：

```powershell
npm.cmd run test:e2e
```

端到端测试会构建 `dist/MyTabDesk-Chrome`，真实加载扩展，验证页面初始化、空间创建、Service Worker 消息保存、`chrome.storage.local` 持久化和刷新恢复。首次运行若本机没有 Chromium，请执行 `npx playwright install chromium`；也可通过 `MYTABDESK_CHROMIUM_EXECUTABLE` 指定浏览器路径。

运行全部质量门禁：

```powershell
npm.cmd run verify
```

## 项目结构

```text
MyTabDesk/
├── assets/
├── tests/
│   ├── tabdesk-core.test.js
│   ├── browser-messaging.test.js
│   ├── sync-network.test.js
│   ├── sync-transport.test.js
│   ├── ui-copy.test.js
│   └── browser-extension.e2e.js
├── background.js
├── jsconfig.json
├── manifest.json
├── newtab-app.js
├── newtab-actions.js
├── newtab-dialogs.js
├── newtab-main.js
├── newtab-notifications.js
├── newtab-render.js
├── newtab-sync-network.js
├── newtab-sync-transport.js
├── newtab-sync.js
├── newtab-utils.js
├── newtab.html
├── newtab.css
├── package.json
├── tabdesk-core.js
└── README.md
```

## 后续计划

- 增强右键保存时的目标空间/分组选择体验
- 改进同步冲突处理和状态提示
- 逐步把全局脚本模块迁移到 ES Modules
- 持续补充测试覆盖
