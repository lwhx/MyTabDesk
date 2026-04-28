# MyTabDesk 三栏浏览器标签页工作台插件开发文档

**版本：** v1.0  
**文档日期：** 2026-04-27  
**目标形态：** 类似 TabTab 风格的三栏新标签页工作台  
**实现方式：** Chrome Extension Manifest V3 + 原生 HTML/CSS/JavaScript + chrome.storage.local

---

## 1. 项目概述

### 1.1 项目名称

**MyTabDesk**

### 1.2 项目定位

MyTabDesk 是一个浏览器新标签页工作台插件，用于替代浏览器默认新标签页，帮助用户管理当前打开的标签页、保存工作现场、按空间和分组整理网页链接，并在需要时快速恢复某个项目或任务的浏览器上下文。

新版界面采用三栏结构：

```text
左侧：空间列表
中间：当前空间下的分组与链接卡片
右侧：当前浏览器窗口打开的标签页
```

本项目可以参考 TabTab 一类工具的交互思路，但不能复制其名称、Logo、图标、文案、配色细节或像素级布局。最终产品应是一个独立实现的个人标签页工作台。

---

## 2. 产品目标

### 2.1 核心目标

用户打开新标签页后，看到一个可操作的工作台，而不是浏览器默认新标签页。

用户可以：

1. 在左侧创建和切换不同工作空间；
2. 在中间查看当前空间下的链接分组；
3. 在右侧查看当前窗口已经打开的标签页；
4. 将当前打开的标签页保存到当前空间；
5. 按空间、分组、标题和网址搜索链接；
6. 一键打开某个分组内保存的所有网页；
7. 删除不再需要的空间、分组或链接；
8. 所有数据默认保存在本地浏览器。

### 2.2 第一版交付目标

第一版不追求复杂功能，而是要实现一个稳定可用的三栏版 MVP。

必须完成：

1. 替换浏览器新标签页；
2. 三栏布局；
3. 左侧空间列表；
4. 中间分组和链接卡片；
5. 右侧当前标签列表；
6. 创建空间；
7. 创建分组；
8. 保存当前窗口标签页；
9. 打开单个链接；
10. 打开整个分组；
11. 删除空间；
12. 删除分组；
13. 删除链接；
14. 搜索链接；
15. 本地持久化数据。

暂不完成：

1. 账号系统；
2. 云同步；
3. 拖拽排序；
4. 付费功能；
5. 团队协作；
6. 浏览历史读取；
7. 收藏夹导入；
8. 多端冲突合并；
9. 远程脚本加载。

### 2.3 功能优先级

为方便开发排期和验收，第一版功能按以下优先级管理：

| 优先级 | 含义 | 示例 |
|---|---|---|
| P0 | 没有该功能就不能交付 MVP | 新标签页替换、本地存储、空间管理、分组管理、保存当前窗口标签页 |
| P1 | MVP 应该具备，影响完整体验 | 搜索、删除确认、分组折叠、批量打开提示 |
| P2 | 可以延后，不影响第一版核心闭环 | 导出入口、设置入口、当前标签搜索、单个标签保存到指定分组 |

第一版交付时，必须优先保证 P0 功能稳定可用，再补齐 P1 功能。P2 功能可以先保留入口或规划说明，但不应阻塞 v1.0.0 发布。

### 2.4 非功能需求

除了功能完整性，第一版还应满足以下非功能要求。

#### 性能要求

1. 首屏基础界面应尽快展示，避免明显白屏；
2. 当前窗口标签页数量低于 100 个时，右侧列表滚动应保持流畅；
3. 单个空间内链接数量达到 500 条时，搜索和渲染不应出现明显卡顿；
4. 批量打开链接数量超过 20 个时，必须二次确认。

#### 可用性要求

1. 所有主要操作应有明确反馈；
2. 删除类操作必须二次确认；
3. 空状态应给出下一步操作建议；
4. 按钮禁用状态应清晰可见；
5. 输入为空时不创建空间或分组，并保持当前页面状态稳定。

#### 可维护性要求

1. `newtab.js` 中的数据读写、状态管理、渲染逻辑和事件绑定应尽量按职责拆分；
2. 所有读取自 `chrome.storage.local` 的数据都需要做结构校验和默认值兜底；
3. 所有 Chrome API 调用都需要考虑失败或返回空数据的情况；
4. 后续如果功能复杂，应优先拆分模块，再考虑迁移框架。

#### 可访问性要求

1. 所有按钮必须有可理解的文本或 `aria-label`；
2. 图标按钮不能只依赖符号表达含义；
3. 输入框应提供明确的 placeholder；
4. 主要操作应支持键盘 Tab 聚焦；
5. 焦点状态必须可见。

### 2.5 关键产品规则

第一版需要明确以下产品规则，避免实现时出现歧义：

1. 删除最后一个空间时，不允许删除，并提示「至少需要保留一个空间。」；
2. 保存当前窗口标签页时，同一分组内按 URL 去重，不同分组之间允许存在相同链接；
3. 点击单个链接时，在新标签页打开该链接；
4. 点击打开整个分组时，批量创建新标签页；
5. 当前窗口标签页只过滤浏览器内部页面，不主动过滤重复网页，去重在保存分组时处理；
6. v1.0.0 可以使用浏览器原生 `prompt`、`confirm`、`alert` 降低实现成本，后续版本再替换为自定义弹窗。

---

## 3. 技术依据

本项目基于 Chrome Extension Manifest V3 实现。Chrome 官方文档说明，扩展可以使用 `chrome_url_overrides` 覆盖新标签页、书签管理器或历史页面，其中新标签页对应 `newtab` 配置项。  
参考文档：<https://developer.chrome.com/docs/extensions/develop/ui/override-chrome-pages>

当前窗口标签页读取和新标签创建使用 `chrome.tabs` API。Chrome 官方文档说明，`tabs` 权限可让扩展读取标签页对象中的敏感字段，例如 `url`、`title`、`favIconUrl` 等，这正好对应保存当前窗口标签页的需求。  
参考文档：<https://developer.chrome.com/docs/extensions/reference/api/tabs>

本地数据持久化使用 `chrome.storage` API。Chrome 官方文档说明，`chrome.storage` 是扩展专用的数据存储 API，可用于保存、读取和监听用户数据变化，并且使用前需要在 manifest 中声明 `storage` 权限。  
参考文档：<https://developer.chrome.com/docs/extensions/reference/api/storage>

权限声明应遵循最小权限原则。Chrome 官方权限文档说明，扩展应在 manifest 的权限字段中声明需要使用的 API 和能力，部分权限可能触发用户警告。  
参考文档：<https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions>

Manifest V3 不允许扩展执行远程托管代码，扩展只能执行打包在扩展内部的 JavaScript，这对安全和审核都有影响。  
参考文档：<https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3>

---

## 4. 技术选型

### 4.1 插件规范

使用：

```json
{
  "manifest_version": 3
}
```

原因：

1. 符合当前 Chrome 扩展推荐方向；
2. 权限模型更清晰；
3. 后续更适合发布到 Chrome Web Store；
4. 与 Chromium 系浏览器兼容性较好；
5. 避免使用 Manifest V2 的旧式能力。

### 4.2 前端方案

第一版使用原生前端技术：

```text
HTML
CSS
JavaScript
Chrome Extension API
```

暂不使用：

```text
React
Vue
Vite
Tailwind
Webpack
TypeScript
```

原因：

1. 插件第一版功能可控；
2. 无需构建工具，调试简单；
3. 文件少，适合快速落地；
4. 权限和扩展 API 调试更直观；
5. 后续功能复杂后再迁移框架更安全。

### 4.3 数据存储

使用：

```text
chrome.storage.local
```

优点：

1. 适合浏览器扩展；
2. 可在扩展页面中直接使用；
3. 数据保存在本地；
4. 不需要后端服务；
5. 适合 MVP。

暂不使用：

```text
localStorage
IndexedDB
Firebase
Supabase
自建服务器
```

### 4.4 权限

第一版权限：

```json
"permissions": [
  "tabs",
  "storage"
]
```

权限用途：

| 权限 | 用途 |
|---|---|
| tabs | 读取当前窗口标签页的标题、URL、图标，并创建新标签页 |
| storage | 保存空间、分组、链接和设置数据 |

不申请：

```text
history
bookmarks
cookies
webRequest
scripting
<all_urls>
```

---

## 5. 产品信息架构

### 5.1 三栏结构

整体页面结构如下：

```text
┌─────────────────────┬────────────────────────────────────────────┬──────────────────────┐
│ 左侧空间栏           │ 中间内容区                                  │ 右侧当前标签栏         │
│                     │                                            │                      │
│ MyTabDesk           │ 当前空间名称                                │ Tabs (当前标签数量)    │
│ 搜索/新建空间        │ 搜索链接 / 添加分组 / 更多                   │ 排序 / 保存按钮        │
│                     │                                            │                      │
│ 空间 A              │ 分组 1                                      │ 当前标签 1             │
│ 空间 B              │   链接卡片 链接卡片 链接卡片                 │ 当前标签 2             │
│ 空间 C              │ 分组 2                                      │ 当前标签 3             │
│                     │   链接卡片 链接卡片                         │                      │
│ 设置入口             │                                            │                      │
└─────────────────────┴────────────────────────────────────────────┴──────────────────────┘
```

### 5.2 左侧空间栏

左侧空间栏是一级导航。

包含：

1. 产品名称；
2. 新建空间按钮；
3. 空间列表；
4. 当前选中空间状态；
5. 每个空间的更多操作入口；
6. 底部设置入口；
7. 数据导入导出入口，第二版实现。

空间项展示：

```text
[图标] 空间名称                  [更多]
```

空间项状态：

1. 默认状态；
2. 鼠标悬停状态；
3. 当前选中状态；
4. 删除确认状态；
5. 空间名称过长省略状态。

### 5.3 中间内容区

中间是主要工作区。

包含：

1. 当前空间标题；
2. 当前空间搜索框；
3. 添加分组按钮；
4. 分组列表；
5. 链接卡片；
6. 空状态；
7. 分组折叠状态；
8. 分组更多操作。

分组结构：

```text
分组名称                           [打开全部] [折叠] [更多]
[链接卡片] [链接卡片] [链接卡片] [链接卡片]
```

链接卡片结构：

```text
[网站图标] 网页标题                    [更多]
```

### 5.4 右侧当前标签栏

右侧用于展示当前浏览器窗口中已经打开的标签页。

包含：

1. 标题：`Tabs (数量)`；
2. 刷新标签按钮；
3. 保存当前标签按钮；
4. 当前标签列表；
5. 当前标签搜索，第二版实现；
6. 单个标签保存到分组，第二版实现。

当前标签项结构：

```text
[网站图标] 标签标题
         标签 URL
```

---

## 6. 核心用户流程

### 6.1 第一次使用

```text
用户安装插件
打开新标签页
看到空工作台
点击“新建空间”
输入空间名称
创建成功
右侧显示当前窗口标签页
点击“保存当前标签”
输入分组名称
当前窗口标签保存到该分组
```

### 6.2 保存当前工作现场

```text
用户打开多个网页
打开新标签页
选择一个空间
点击右侧“保存”
输入新分组名称
插件读取当前窗口标签
过滤无效页面
保存为当前空间下的新分组
中间区域立即显示链接卡片
```

### 6.3 恢复某个任务

```text
打开新标签页
在左侧选择空间
在中间找到分组
点击“打开全部”
插件批量创建新标签页
恢复这个任务的网页集合
```

### 6.4 搜索资料

```text
打开新标签页
选择空间
在中间搜索框输入关键词
匹配分组名称、网页标题、URL
显示符合条件的分组和链接
```

### 6.5 删除数据

```text
用户点击空间、分组或链接的删除按钮
插件弹出确认
用户确认
删除对应数据
写入 chrome.storage.local
重新渲染页面
```

---

## 7. 功能需求

## 7.1 新标签页替换

### 说明

插件安装后，浏览器新标签页显示 MyTabDesk 工作台。

### 实现方式

在 `manifest.json` 中配置：

```json
"chrome_url_overrides": {
  "newtab": "newtab.html"
}
```

### 验收标准

1. 打开新标签页后显示 `newtab.html`；
2. 页面标题正确；
3. 页面无控制台报错；
4. 刷新新标签页后仍可正常显示；
5. Chrome 和 Edge 均可加载。

---

## 7.2 空间管理

### 说明

空间是最顶层的数据容器，用于区分不同项目、任务或主题。

### 第一版功能

1. 创建空间；
2. 切换空间；
3. 删除空间；
4. 默认创建一个“默认空间”；
5. 当前空间状态持久保存。

### 空间字段

```json
{
  "id": "space-uuid",
  "name": "API中转",
  "icon": "folder",
  "groups": [],
  "createdAt": 1710000000000,
  "updatedAt": 1710000000000
}
```

### 验收标准

1. 可以创建新空间；
2. 空间名称不能为空；
3. 空间能显示在左侧；
4. 点击空间后中间区域切换；
5. 删除空间前有确认；
6. 删除当前空间后自动切换到其他空间；
7. 刷新页面后空间仍存在。

---

## 7.3 分组管理

### 说明

分组用于在一个空间中继续分类保存链接。

例如：

```text
AI 工具
论文资料
项目后台
API 文档
临时调研
```

### 第一版功能

1. 创建分组；
2. 删除分组；
3. 折叠/展开分组；
4. 打开分组内全部链接；
5. 保存当前窗口标签为新分组。

### 分组字段

```json
{
  "id": "group-uuid",
  "name": "AI工具",
  "collapsed": false,
  "links": [],
  "createdAt": 1710000000000,
  "updatedAt": 1710000000000
}
```

### 验收标准

1. 可以在当前空间创建分组；
2. 分组名称不能为空；
3. 分组展示在中间区域；
4. 可以折叠和展开；
5. 删除分组时删除其下全部链接；
6. 删除前有确认；
7. 刷新后状态保留。

---

## 7.4 链接管理

### 说明

链接是保存的网页条目。

### 第一版功能

1. 展示链接；
2. 点击链接打开网页；
3. 删除链接；
4. 显示网站图标；
5. 标题过长省略；
6. URL 作为 tooltip 或次级信息。

### 链接字段

```json
{
  "id": "link-uuid",
  "title": "Chrome Extensions Docs",
  "url": "https://developer.chrome.com/docs/extensions",
  "favIconUrl": "https://example.com/favicon.ico",
  "createdAt": 1710000000000
}
```

### 验收标准

1. 链接标题显示正确；
2. 点击链接能打开网页；
3. 删除链接前有确认；
4. 删除后数量更新；
5. 刷新后删除结果保留；
6. 长标题不撑破布局；
7. 无图标时显示默认图标。

---

## 7.5 当前标签列表

### 说明

右侧栏实时展示当前窗口打开的普通网页标签。

### 第一版功能

1. 读取当前窗口标签；
2. 展示标签标题；
3. 展示标签 URL；
4. 展示标签图标；
5. 点击当前标签切换到该标签；
6. 点击刷新按钮重新读取标签；
7. 点击保存按钮将当前窗口标签保存为分组。

### 获取标签示例

```javascript
const tabs = await chrome.tabs.query({
  currentWindow: true
});
```

### 过滤规则

不保存以下 URL：

```text
chrome://
edge://
about:
chrome-extension://
devtools://
空 URL
```

### 验收标准

1. 右侧正确显示当前窗口标签；
2. 浏览器内部页面不保存；
3. 点击标签可切换；
4. 新开或关闭标签后点击刷新可更新；
5. 保存时只保存有效网页。

---

## 7.6 保存当前窗口标签

### 说明

用户点击右侧“保存”按钮后，把当前窗口打开的网页保存到当前空间的新分组。

### 流程

```text
点击保存
读取当前窗口 tabs
过滤无效 URL
提示输入分组名称
创建新分组
把 tabs 转为 links
保存到当前空间
写入 storage
重新渲染中间区域
```

### 默认分组名

如果用户不输入，可使用：

```text
保存于 2026-04-27 14:30
```

### 验收标准

1. 能保存当前窗口多个标签；
2. 保存后中间区域出现新分组；
3. 分组内链接数量正确；
4. 无有效标签时提示用户；
5. 刷新页面后数据存在。

---

## 7.7 搜索功能

### 说明

搜索框位于中间内容区顶部。

### 搜索范围

1. 当前空间的分组名称；
2. 链接标题；
3. 链接 URL。

### 搜索规则

1. 忽略大小写；
2. 支持部分匹配；
3. 输入为空时显示全部；
4. 如果分组名匹配，显示整个分组；
5. 如果链接匹配，只显示匹配链接；
6. 无结果时显示空结果提示。

### 验收标准

1. 搜索分组名可命中；
2. 搜索链接标题可命中；
3. 搜索 URL 可命中；
4. 清空搜索恢复全部；
5. 无结果有提示。

---

## 8. 数据模型

## 8.1 推荐总结构

第一版使用一个总数据对象：

```json
{
  "version": 1,
  "activeSpaceId": "space-uuid",
  "spaces": [
    {
      "id": "space-uuid",
      "name": "API中转",
      "icon": "folder",
      "createdAt": 1710000000000,
      "updatedAt": 1710000000000,
      "groups": [
        {
          "id": "group-uuid",
          "name": "小龙虾",
          "collapsed": false,
          "createdAt": 1710000000000,
          "updatedAt": 1710000000000,
          "links": [
            {
              "id": "link-uuid",
              "title": "OpenClaw 汉化版",
              "url": "https://example.com",
              "favIconUrl": "",
              "createdAt": 1710000000000
            }
          ]
        }
      ]
    }
  ],
  "settings": {
    "theme": "light",
    "rightPanelCollapsed": false,
    "sidebarCollapsed": false
  }
}
```

## 8.2 Storage Key

使用一个固定 key：

```javascript
const STORAGE_KEY = "my_tab_desk_data";
```

存储结构：

```json
{
  "my_tab_desk_data": {
    "version": 1,
    "activeSpaceId": "",
    "spaces": [],
    "settings": {}
  }
}
```

## 8.3 数据版本

必须保留 `version` 字段，方便未来升级。

第一版：

```json
"version": 1
```

未来如果从 `space.tabs` 迁移到 `space.groups.links`，可以通过版本号做迁移。

数据迁移应遵循以下规则：

1. 读取数据时先检查 `version`；
2. 当前版本为 `1`；
3. 未来版本升级时通过 `migrateData(data)` 统一处理；
4. 不允许直接信任 `chrome.storage.local` 中的数据结构；
5. 数据异常时应回退默认数据，并避免页面白屏；
6. 迁移逻辑必须保持幂等，多次执行不应破坏已有数据。

建议预留迁移函数：

```javascript
function migrateData(data) {
  if (!data || typeof data !== "object") {
    return createDefaultData();
  }

  if (!data.version) {
    return normalizeData({
      ...data,
      version: 1
    });
  }

  if (data.version === 1) {
    return normalizeData(data);
  }

  return normalizeData(data);
}
```

### 8.4 数据校验与兜底

读取本地数据后，需要先执行结构校验和默认值补全，避免 storage 数据损坏导致页面不可用。

建议处理以下异常情况：

1. 数据为空；
2. 数据不是对象；
3. `spaces` 不是数组；
4. `activeSpaceId` 指向不存在的空间；
5. 空间、分组或链接缺少必要字段；
6. `settings` 缺少默认配置；
7. 用户删除到只剩 1 个空间时，应阻止删除。

建议预留标准化函数：

```javascript
function normalizeData(rawData) {
  if (!rawData || typeof rawData !== "object") {
    return createDefaultData();
  }

  if (!Array.isArray(rawData.spaces) || rawData.spaces.length === 0) {
    return createDefaultData();
  }

  const spaces = rawData.spaces.map((space) => ({
    id: space.id || crypto.randomUUID(),
    name: space.name || "未命名空间",
    icon: space.icon || "folder",
    groups: Array.isArray(space.groups) ? space.groups : [],
    createdAt: space.createdAt || Date.now(),
    updatedAt: space.updatedAt || Date.now()
  }));

  const activeSpaceExists = spaces.some(
    (space) => space.id === rawData.activeSpaceId
  );

  return {
    version: 1,
    activeSpaceId: activeSpaceExists ? rawData.activeSpaceId : spaces[0].id,
    spaces,
    settings: {
      theme: rawData.settings?.theme || "light",
      rightPanelCollapsed: Boolean(rawData.settings?.rightPanelCollapsed),
      sidebarCollapsed: Boolean(rawData.settings?.sidebarCollapsed)
    }
  };
}
```

## 8.5 默认数据

首次安装或数据为空时，创建默认数据：

```json
{
  "version": 1,
  "activeSpaceId": "default-space",
  "spaces": [
    {
      "id": "default-space",
      "name": "默认空间",
      "icon": "folder",
      "groups": [],
      "createdAt": 1710000000000,
      "updatedAt": 1710000000000
    }
  ],
  "settings": {
    "theme": "light",
    "rightPanelCollapsed": false,
    "sidebarCollapsed": false
  }
}
```

---

## 9. 项目文件结构

## 9.1 MVP 文件结构

```text
my-tab-desk/
├── manifest.json
├── newtab.html
├── newtab.css
├── newtab.js
├── README.md
└── assets/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## 9.2 文件职责

### manifest.json

插件声明文件，负责：

1. 插件名称；
2. 插件版本；
3. 插件权限；
4. 新标签页覆盖；
5. 图标声明。

### newtab.html

新标签页页面结构，负责：

1. 三栏 DOM 结构；
2. 按钮；
3. 搜索框；
4. 列表容器；
5. 弹窗结构。

### newtab.css

页面样式，负责：

1. 三栏布局；
2. 左侧空间栏；
3. 中间分组区；
4. 右侧标签栏；
5. 按钮；
6. 卡片；
7. 响应式布局；
8. 空状态。

### newtab.js

核心业务逻辑，负责：

1. 初始化；
2. 数据读取；
3. 数据保存；
4. 渲染空间；
5. 渲染分组；
6. 渲染链接；
7. 渲染当前标签；
8. 事件绑定；
9. 搜索；
10. 调用 Chrome API。

---

## 10. manifest.json 设计

```json
{
  "manifest_version": 3,
  "name": "MyTabDesk",
  "version": "1.0.0",
  "description": "A local-first new tab workspace for saving and restoring browser tabs.",
  "permissions": [
    "tabs",
    "storage"
  ],
  "chrome_url_overrides": {
    "newtab": "newtab.html"
  },
  "icons": {
    "16": "assets/icon16.png",
    "48": "assets/icon48.png",
    "128": "assets/icon128.png"
  }
}
```

### 说明

1. `manifest_version` 使用 3；
2. `permissions` 只声明 `tabs` 和 `storage`；
3. `chrome_url_overrides.newtab` 指向 `newtab.html`；
4. 暂不声明后台 service worker；
5. 暂不声明 content scripts；
6. 暂不声明 host permissions。

---

## 11. 页面结构设计

## 11.1 HTML 骨架

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MyTabDesk</title>
  <link rel="stylesheet" href="newtab.css" />
</head>
<body>
  <div class="app-shell">
    <aside class="sidebar">
      <!-- 左侧空间栏 -->
    </aside>

    <main class="main-panel">
      <!-- 中间分组内容区 -->
    </main>

    <aside class="tabs-panel">
      <!-- 右侧当前标签栏 -->
    </aside>
  </div>

  <script src="newtab.js"></script>
</body>
</html>
```

## 11.2 左侧空间栏 DOM

```html
<aside class="sidebar">
  <header class="sidebar-header">
    <div>
      <div class="brand-name">MyTabDesk</div>
      <div class="brand-subtitle">标签页工作台</div>
    </div>
    <button id="createSpaceBtn" class="icon-button">+</button>
  </header>

  <section class="sidebar-section">
    <div class="section-title">空间</div>
    <nav id="spaceList" class="space-list"></nav>
  </section>

  <footer class="sidebar-footer">
    <button id="exportBtn" class="sidebar-footer-button">导出数据</button>
    <button id="settingsBtn" class="sidebar-footer-button">设置</button>
  </footer>
</aside>
```

## 11.3 中间区域 DOM

```html
<main class="main-panel">
  <header class="main-toolbar">
    <div>
      <h1 id="currentSpaceName">默认空间</h1>
      <p id="currentSpaceMeta">0 个分组 · 0 个链接</p>
    </div>

    <div class="main-actions">
      <input id="searchInput" class="search-input" placeholder="搜索分组、标题或网址" />
      <button id="createGroupBtn" class="secondary-button">添加分组</button>
    </div>
  </header>

  <section id="groupList" class="group-list"></section>

  <div id="emptyState" class="empty-state">
    <h2>还没有保存任何链接</h2>
    <p>你可以从右侧当前标签栏保存当前窗口的网页。</p>
  </div>
</main>
```

## 11.4 右侧标签栏 DOM

```html
<aside class="tabs-panel">
  <header class="tabs-header">
    <div>
      <div id="tabsTitle" class="tabs-title">Tabs (0)</div>
      <div class="tabs-subtitle">当前窗口</div>
    </div>

    <div class="tabs-actions">
      <button id="refreshTabsBtn" class="icon-button">刷新</button>
      <button id="saveCurrentTabsBtn" class="primary-button">保存</button>
    </div>
  </header>

  <div id="currentTabsList" class="current-tabs-list"></div>
</aside>
```

---

## 12. 样式设计

## 12.1 布局

```css
.app-shell {
  display: grid;
  grid-template-columns: 240px 1fr 320px;
  height: 100vh;
  background: #ffffff;
  color: #111827;
}
```

## 12.2 左侧栏

```css
.sidebar {
  border-right: 1px solid #e5e7eb;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
}
```

## 12.3 中间区

```css
.main-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #ffffff;
}
```

## 12.4 右侧栏

```css
.tabs-panel {
  border-left: 1px solid #e5e7eb;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
}
```

## 12.5 链接卡片

```css
.link-card {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 220px;
  height: 42px;
  padding: 0 10px;
  border: 1px solid #dbe3ef;
  border-radius: 10px;
  background: #ffffff;
  cursor: pointer;
}
```

## 12.6 视觉原则

1. 背景以白色和浅灰为主；
2. 少量边框，不使用重阴影；
3. 信息密度高但不拥挤；
4. 左侧和右侧是辅助区；
5. 中间是主操作区；
6. 按钮尺寸统一；
7. 长标题必须省略；
8. 所有 hover 状态要明显。

---

## 13. 核心逻辑设计

## 13.1 初始化流程

```text
页面加载
读取 chrome.storage.local
如果没有数据则创建默认数据
确定当前 activeSpace
渲染左侧空间列表
渲染中间分组列表
读取当前窗口标签
渲染右侧当前标签列表
绑定事件
```

伪代码：

```javascript
async function init() {
  state.data = await loadData();
  ensureDefaultData();
  renderAll();
  await refreshCurrentTabs();
  bindEvents();
}
```

## 13.2 全局状态

```javascript
const STORAGE_KEY = "my_tab_desk_data";

const state = {
  data: null,
  currentTabs: [],
  searchKeyword: ""
};
```

## 13.3 读取数据

```javascript
async function loadData() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || createDefaultData();
}
```

## 13.4 保存数据

```javascript
async function saveData() {
  await chrome.storage.local.set({
    [STORAGE_KEY]: state.data
  });
}
```

## 13.5 获取当前空间

```javascript
function getActiveSpace() {
  return state.data.spaces.find(
    (space) => space.id === state.data.activeSpaceId
  );
}
```

## 13.6 创建空间

```javascript
async function createSpace() {
  const name = prompt("请输入空间名称");
  if (!name || !name.trim()) return;

  const space = {
    id: crypto.randomUUID(),
    name: name.trim(),
    icon: "folder",
    groups: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  state.data.spaces.unshift(space);
  state.data.activeSpaceId = space.id;

  await saveData();
  renderAll();
}
```

## 13.7 创建分组

```javascript
async function createGroup() {
  const activeSpace = getActiveSpace();
  if (!activeSpace) return;

  const name = prompt("请输入分组名称");
  if (!name || !name.trim()) return;

  activeSpace.groups.unshift({
    id: crypto.randomUUID(),
    name: name.trim(),
    collapsed: false,
    links: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  });

  activeSpace.updatedAt = Date.now();

  await saveData();
  renderAll();
}
```

## 13.8 刷新当前标签

```javascript
async function refreshCurrentTabs() {
  const tabs = await chrome.tabs.query({
    currentWindow: true
  });

  state.currentTabs = tabs
    .filter((tab) => isValidTabUrl(tab.url))
    .map((tab) => ({
      tabId: tab.id,
      title: tab.title || tab.url,
      url: tab.url,
      favIconUrl: tab.favIconUrl || ""
    }));

  renderCurrentTabs();
}
```

## 13.9 保存当前标签为分组

```javascript
async function saveCurrentTabsToGroup() {
  const activeSpace = getActiveSpace();
  if (!activeSpace) return;

  if (!state.currentTabs.length) {
    alert("当前窗口没有可保存的普通网页标签。");
    return;
  }

  const defaultName = `保存于 ${formatDateTime(Date.now())}`;
  const name = prompt("请输入分组名称", defaultName);
  if (!name || !name.trim()) return;

  const group = {
    id: crypto.randomUUID(),
    name: name.trim(),
    collapsed: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    links: state.currentTabs.map((tab) => ({
      id: crypto.randomUUID(),
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl,
      createdAt: Date.now()
    }))
  };

  activeSpace.groups.unshift(group);
  activeSpace.updatedAt = Date.now();

  await saveData();
  renderAll();
}
```

## 13.10 打开分组

```javascript
async function openGroup(groupId) {
  const activeSpace = getActiveSpace();
  const group = activeSpace.groups.find((item) => item.id === groupId);

  if (!group || group.links.length === 0) {
    alert("这个分组里没有链接。");
    return;
  }

  for (const link of group.links) {
    await chrome.tabs.create({
      url: link.url,
      active: false
    });
  }
}
```

## 13.11 删除链接

```javascript
async function deleteLink(groupId, linkId) {
  const activeSpace = getActiveSpace();
  const group = activeSpace.groups.find((item) => item.id === groupId);
  if (!group) return;

  const confirmed = confirm("确定删除这个链接吗？");
  if (!confirmed) return;

  group.links = group.links.filter((link) => link.id !== linkId);
  group.updatedAt = Date.now();
  activeSpace.updatedAt = Date.now();

  await saveData();
  renderAll();
}
```

## 13.12 URL 过滤

```javascript
function isValidTabUrl(url) {
  if (!url) return false;

  const blockedPrefixes = [
    "chrome://",
    "edge://",
    "about:",
    "chrome-extension://",
    "devtools://"
  ];

  return !blockedPrefixes.some((prefix) => url.startsWith(prefix));
}
```

---

## 14. 渲染设计

## 14.1 renderAll

```javascript
function renderAll() {
  renderSpaces();
  renderActiveSpaceHeader();
  renderGroups();
}
```

## 14.2 渲染空间列表

空间列表按更新时间倒序展示。

```javascript
function renderSpaces() {
  const listEl = document.getElementById("spaceList");
  listEl.innerHTML = "";

  for (const space of state.data.spaces) {
    const item = document.createElement("button");
    item.className = "space-item";
    if (space.id === state.data.activeSpaceId) {
      item.classList.add("active");
    }

    item.textContent = space.name;
    item.addEventListener("click", async () => {
      state.data.activeSpaceId = space.id;
      await saveData();
      renderAll();
    });

    listEl.appendChild(item);
  }
}
```

## 14.3 渲染分组和链接

```javascript
function renderGroups() {
  const groupListEl = document.getElementById("groupList");
  const activeSpace = getActiveSpace();

  groupListEl.innerHTML = "";

  if (!activeSpace || activeSpace.groups.length === 0) {
    showEmptyState();
    return;
  }

  hideEmptyState();

  const filteredGroups = filterGroups(activeSpace.groups, state.searchKeyword);

  for (const group of filteredGroups) {
    const groupEl = createGroupElement(group);
    groupListEl.appendChild(groupEl);
  }
}
```

## 14.4 搜索过滤

```javascript
function filterGroups(groups, keyword) {
  const q = keyword.trim().toLowerCase();
  if (!q) return groups;

  return groups
    .map((group) => {
      const groupMatched = group.name.toLowerCase().includes(q);

      if (groupMatched) {
        return group;
      }

      const matchedLinks = group.links.filter((link) => {
        return (
          link.title.toLowerCase().includes(q) ||
          link.url.toLowerCase().includes(q)
        );
      });

      if (matchedLinks.length === 0) {
        return null;
      }

      return {
        ...group,
        links: matchedLinks
      };
    })
    .filter(Boolean);
}
```

---

## 15. 交互细节

### 15.1 空状态

如果没有空间：

```text
还没有空间
点击左上角 + 创建你的第一个空间
```

如果当前空间没有分组：

```text
还没有保存任何链接
你可以从右侧当前标签栏保存当前窗口的网页
```

如果搜索无结果：

```text
没有找到匹配结果
试试其他关键词
```

### 15.2 删除确认

删除空间：

```text
确定删除空间「空间名称」吗？该空间下的所有分组和链接都会被删除。
```

删除分组：

```text
确定删除分组「分组名称」吗？该分组下的所有链接都会被删除。
```

删除链接：

```text
确定删除这个链接吗？
```

### 15.3 批量打开限制

如果分组链接数量超过 20 个，建议提示：

```text
该分组包含 25 个链接，确定全部打开吗？
```

防止一次打开过多标签导致浏览器卡顿。

### 15.4 标题显示

链接标题规则：

1. 优先使用网页标题；
2. 标题为空时使用 URL；
3. 标题过长时省略；
4. 鼠标悬停显示完整标题和 URL。

### 15.5 操作反馈规范

v1.0.0 可以使用浏览器原生弹窗降低实现成本，但需要统一提示内容。

| 场景 | 提示文案 |
|---|---|
| 空间名为空 | 请输入空间名称 |
| 分组名为空 | 请输入分组名称 |
| 无可保存标签 | 当前窗口没有可保存的普通网页标签。 |
| 打开空分组 | 这个分组里没有链接。 |
| 删除最后一个空间 | 至少需要保留一个空间。 |
| 数据保存失败 | 数据保存失败，请稍后重试。 |
| 数据读取失败 | 数据读取失败，已为你恢复默认数据。 |

后续版本可以将 `prompt`、`confirm`、`alert` 替换为自定义弹窗，以提升视觉一致性和交互体验。

### 15.6 重复链接处理

保存当前窗口标签页为新分组时，需要按 URL 处理重复链接：

1. 同一分组内相同 URL 只保留 1 条；
2. 不同分组之间允许保存相同 URL；
3. URL 去重应在过滤无效 URL 之后执行；
4. 去重时优先保留第一次出现的标签页标题和图标。

### 15.7 打开链接行为

打开链接行为统一如下：

1. 点击单个链接卡片时，通过 `chrome.tabs.create({ url })` 在新标签页打开；
2. 打开整个分组时，批量创建新标签页；
3. 分组链接数量超过 20 个时，必须先二次确认；
4. 批量打开时不应关闭或覆盖当前 MyTabDesk 页面。

---

## 16. 测试计划

## 16.1 功能测试

| 编号 | 测试项 | 操作 | 预期结果 |
|---|---|---|---|
| F-001 | 新标签页覆盖 | 打开新标签页 | 显示 MyTabDesk |
| F-002 | 创建空间 | 点击 + 输入名称 | 左侧出现新空间 |
| F-003 | 切换空间 | 点击左侧空间 | 中间内容切换 |
| F-004 | 创建分组 | 点击添加分组 | 当前空间出现分组 |
| F-005 | 读取当前标签 | 打开多个网页后刷新 | 右侧显示当前标签 |
| F-006 | 保存当前标签 | 点击保存 | 当前空间出现新分组 |
| F-007 | 打开链接 | 点击链接卡片 | 新标签页打开网页 |
| F-008 | 打开分组 | 点击打开全部 | 批量打开分组链接 |
| F-009 | 搜索链接 | 输入关键词 | 过滤分组和链接 |
| F-010 | 删除链接 | 点击删除链接 | 链接消失 |
| F-011 | 删除分组 | 点击删除分组 | 分组消失 |
| F-012 | 删除空间 | 点击删除空间 | 空间消失 |
| F-013 | 持久化 | 刷新页面 | 数据仍存在 |

## 16.2 异常测试

| 编号 | 场景 | 预期 |
|---|---|---|
| E-001 | 首次安装无数据 | 自动创建默认空间 |
| E-002 | 当前窗口只有 chrome:// 页面 | 提示无可保存标签 |
| E-003 | 创建空间输入空名称 | 不创建 |
| E-004 | 创建分组输入空名称 | 不创建 |
| E-005 | 删除当前空间 | 自动切换到其他空间 |
| E-006 | 删除最后一个空间 | 阻止删除，并提示至少需要保留一个空间 |
| E-007 | 链接标题为空 | 使用 URL 作为标题 |
| E-008 | 分组为空时点击打开全部 | 提示无链接 |
| E-009 | storage 数据损坏 | 回退默认数据 |
| E-010 | 一次打开很多链接 | 二次确认 |
| E-011 | 保存当前窗口标签时存在重复 URL | 同一分组内只保留 1 条 |
| E-012 | activeSpaceId 指向不存在的空间 | 自动切换到第一个可用空间 |
| E-013 | settings 字段缺失 | 自动补齐默认设置 |

## 16.3 兼容性测试

建议测试：

1. Chrome 最新稳定版；
2. Microsoft Edge 最新稳定版；
3. Brave 最新稳定版；
4. 其他 Chromium 浏览器。

---

## 17. 安全与隐私设计

### 17.1 隐私原则

MyTabDesk 应遵守：

1. 不上传用户标签页数据；
2. 不采集浏览历史；
3. 不读取 Cookie；
4. 不注入网页脚本；
5. 不接入统计 SDK；
6. 不接入广告；
7. 不加载远程 JavaScript；
8. 不申请不必要权限；
9. 所有数据默认仅保存在本地。

### 17.2 权限说明文案

```text
MyTabDesk 需要 tabs 权限，用于在用户主动保存时读取当前窗口已打开网页的标题、URL 和图标，并将其保存为工作空间链接。

MyTabDesk 需要 storage 权限，用于把用户创建的空间、分组和链接保存在本地浏览器。

MyTabDesk 不会上传、出售或共享用户数据。
```

插件只在以下情况下读取当前窗口标签页：

1. 页面初始化时，用于展示右侧当前窗口标签页列表；
2. 用户点击「刷新」按钮时；
3. 用户点击「保存」按钮时。

插件不会在后台持续读取标签页，不会读取浏览历史，也不会上传标签页数据。

### 17.3 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| `tabs` 权限带来用户顾虑 | 影响安装转化 | 在权限说明中明确只用于展示和保存当前窗口标签页 |
| 批量打开大量链接 | 浏览器卡顿 | 超过 20 个链接时二次确认 |
| storage 数据损坏 | 页面白屏或数据异常 | 读取时执行数据校验，异常时回退默认数据 |
| 用户误删空间或分组 | 数据丢失 | 删除前二次确认，后续增加导出和备份能力 |
| 图标加载失败 | 页面观感下降 | 使用默认图标兜底 |
| 重复保存同一批标签页 | 数据冗余 | 同一分组内按 URL 去重，不同分组允许重复 |

### 17.4 数据风险

本地数据可能因为以下原因丢失：

1. 用户卸载插件；
2. 用户清除浏览器扩展数据；
3. 浏览器配置损坏；
4. 换电脑未迁移；
5. 用户误删空间。

解决方案：

1. v1.1 增加导出 JSON；
2. v1.2 增加导入 JSON；
3. v2.0 增加可选同步；
4. 所有删除操作增加确认。

---

## 18. 版本规划

### v1.0.0：三栏 MVP

功能：

1. 三栏布局；
2. 空间管理；
3. 分组管理；
4. 链接管理；
5. 当前标签读取；
6. 保存当前标签；
7. 搜索；
8. 本地存储。

### v1.1.0：数据备份

功能：

1. 导出 JSON；
2. 导入 JSON；
3. 清空数据；
4. 数据结构校验；
5. 备份文件版本号。

### v1.2.0：体验增强

功能：

1. 深色模式；
2. 折叠左侧栏；
3. 折叠右侧栏；
4. 分组内链接排序；
5. 空间排序；
6. 批量删除。

### v1.3.0：拖拽版

功能：

1. 空间拖拽排序；
2. 分组拖拽排序；
3. 链接拖拽排序；
4. 从右侧标签拖到中间分组保存。

### v2.0.0：同步版

功能：

1. WebDAV 同步；
2. GitHub Gist 同步；
3. 手动同步；
4. 同步冲突处理；
5. 加密备份。

---

## 19. 开发里程碑

### 第 1 阶段：基础插件

目标：

```text
能打开自定义新标签页
```

任务：

1. 创建项目目录；
2. 编写 manifest；
3. 编写 HTML 骨架；
4. 加载扩展；
5. 打开新标签页验证。

### 第 2 阶段：三栏 UI

目标：

```text
三栏布局完整显示
```

任务：

1. 编写 CSS Grid；
2. 完成左侧空间栏；
3. 完成中间内容区；
4. 完成右侧标签栏；
5. 完成空状态。

### 第 3 阶段：本地数据

目标：

```text
空间、分组、链接可保存
```

任务：

1. 实现默认数据；
2. 实现 loadData；
3. 实现 saveData；
4. 实现空间创建；
5. 实现分组创建；
6. 实现页面刷新后数据保留。

### 第 4 阶段：标签页能力

目标：

```text
能读取和保存当前窗口标签
```

任务：

1. 调用 chrome.tabs.query；
2. 过滤无效 URL；
3. 渲染当前标签；
4. 保存当前标签为分组；
5. 点击标签切换；
6. 批量打开分组链接。

### 第 5 阶段：管理能力

目标：

```text
能长期使用
```

任务：

1. 删除空间；
2. 删除分组；
3. 删除链接；
4. 搜索；
5. 异常处理；
6. UI 优化；
7. README 编写。

### 开发任务拆分表

| 阶段 | 文件 | 任务 | 优先级 | 验收标准 |
|---|---|---|---|---|
| 基础插件 | `manifest.json` | 配置 Manifest V3、权限和新标签页覆盖 | P0 | 可以在 Chrome 中加载扩展，打开新标签页显示自定义页面 |
| 页面骨架 | `newtab.html` | 搭建左中右三栏 DOM 结构 | P0 | 页面包含空间栏、分组内容区、当前窗口标签页栏 |
| 三栏样式 | `newtab.css` | 实现 CSS Grid 布局、按钮、卡片和空状态 | P0 | 页面在常见宽度下不溢出，信息层级清晰 |
| 数据基础 | `newtab.js` | 实现默认数据、读取数据、保存数据 | P0 | 首次打开自动创建默认空间，刷新后数据保留 |
| 数据健壮性 | `newtab.js` | 实现数据校验、默认值兜底和版本迁移入口 | P0 | storage 数据缺失或损坏时页面不白屏 |
| 空间管理 | `newtab.js` | 实现创建、切换、删除空间 | P0 | 空间操作后左侧和中间区域同步更新 |
| 分组管理 | `newtab.js` | 实现创建、删除、折叠和打开分组 | P0/P1 | 分组状态可保存，打开空分组有提示 |
| 链接管理 | `newtab.js` | 实现链接展示、打开和删除 | P0 | 链接可在新标签页打开，删除后持久化 |
| 当前标签页 | `newtab.js` | 调用 `chrome.tabs.query` 读取当前窗口标签页 | P0 | 右侧正确展示标题、URL 和图标 |
| 保存标签页 | `newtab.js` | 保存当前窗口标签页为新分组，并处理无效 URL 和重复 URL | P0 | 保存后中间出现新分组，同一分组内 URL 不重复 |
| 搜索 | `newtab.js` | 按分组名、链接标题和 URL 搜索 | P1 | 输入关键词后只展示匹配结果，清空后恢复全部 |
| 交互反馈 | `newtab.js` | 补齐确认、提示和错误处理 | P1 | 删除、保存失败、无结果等场景均有明确反馈 |
| 文档 | `README.md` | 编写安装、使用和隐私说明 | P1 | 用户可按 README 完成本地安装和基础使用 |

---

## 20. README 建议

```markdown
# MyTabDesk

MyTabDesk 是一个本地优先的浏览器新标签页工作台插件，用于保存、整理和恢复浏览器标签页。

## 功能

- 三栏新标签页工作台
- 空间管理
- 分组管理
- 当前窗口标签页读取
- 一键保存当前标签页
- 一键打开分组
- 本地数据存储
- 链接搜索

## 安装

1. 打开 chrome://extensions/
2. 开启开发者模式
3. 点击“加载已解压的扩展程序”
4. 选择项目文件夹
5. 打开新标签页

## 隐私

所有数据默认保存在本地浏览器，不上传服务器。

## 开发计划

- 导入导出 JSON
- 深色模式
- 拖拽排序
- WebDAV 同步
```

---

## 21. 最终交付标准

v1.0.0 完成时，项目应满足：

1. 可以本地加载到 Chrome；
2. 新标签页被替换；
3. 页面是稳定的三栏布局；
4. 左侧可以创建、切换、删除空间；
5. 中间可以创建、展示、删除分组；
6. 中间可以展示、打开、删除链接；
7. 右侧可以显示当前窗口标签；
8. 可以保存当前窗口标签为分组；
9. 可以搜索当前空间下的分组和链接；
10. 刷新页面后数据不丢失；
11. 不申请多余权限；
12. 不上传任何数据；
13. 不复制任何第三方产品的品牌资产；
14. 代码结构清晰，后续可维护。

---

## 22. 开发注意事项

1. 不要使用 TabTab 的名称、Logo、图标、文案和专有视觉资产；
2. 可以参考三栏信息架构，但必须自己设计视觉表达；
3. 不要申请不必要权限；
4. 不要引入远程脚本；
5. 不要把用户数据上传服务器；
6. 所有删除操作都要二次确认；
7. 本地存储数据要做空值和异常处理；
8. 批量打开链接要限制数量或提示；
9. 初期代码宁可简单，不要过度工程化；
10. 第一版优先保证稳定可用。

---

## 23. 结论

MyTabDesk v1.0 的目标是做出一个完整可用的三栏浏览器标签页工作台。它的核心价值不是复杂功能，而是帮助用户把混乱的浏览器标签页整理成“空间 - 分组 - 链接”的结构。

第一版只要做到：

```text
打开新标签页
选择空间
保存当前窗口标签
按分组查看链接
搜索链接
一键恢复网页
本地保存数据
```

就已经具备长期使用价值。后续再逐步加入导入导出、拖拽排序、深色模式和同步能力。
