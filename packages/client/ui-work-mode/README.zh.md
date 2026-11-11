---
description: "dsh Web 客户端的「对话 / Harness」标签：对话标签在桌面外壳中内嵌 DeepSeek 聊天站点，Harness 保留完整产品，两者不共享数据。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-work-mode

[English](README.md) | 中文

## 概述

窗口顶部条带承载两段切换：「对话」与「Harness」。选择「对话」会在覆盖整帧的层中内嵌 `https://chat.deepseek.com/`，并向框架请求精简外壳；选择「Harness」恢复完整外壳。内嵌页面是站点自己的产品：用户在那里登录并查看该账号的历史，本包从不向它发送 harness 会话、令牌或模型调用。桌面端在持久分区中挂载 Electron `<webview>`，其他客户端则改为显示站点地址。下次启动会恢复上次的选择。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

## 使用本包

<a id="use-this-package"></a>

只有「对话」模式隐藏外壳：插件调用 `ctx.layout.setChrome('minimal')`，框架只渲染中间一列，覆盖层用 guest 填满这一列。选择「Harness」调用 `setChrome('full')`，先前的侧栏、面板与所选面板原样恢复。选择保存在持久化存储 `dsh.work-mode.v1` 中；首次启动进入 Harness。

guest 只挂载一次，插件存活期间绝不移动或卸载：切到 Harness 只是用 `opacity` 与 `inert` 隐藏覆盖层（而不是 `display: none`，后者会分离 guest 并导致重载），因此已打开的对话、滚动位置、草稿以及正在生成的回答都会跨切换保留。桌面外壳同样让隐藏状态的渲染进程不被节流。站点只在首次打开「对话」标签时加载，而不是在应用启动时。

「对话」标签加载配置中的地址：`url`（默认 `https://chat.deepseek.com/`）、`allowedOrigins`（默认站点自身 origin）、`loginHosts`（默认 `accounts.youtube.com` 与 `appleid.apple.com`）以及 `loginHostSuffixes`（默认 `accounts.google.`）。跳转到已配置提供方主机的主框架导航保留在 guest 内，因此 Google 的重定向链及其返回站点的跳转都在同一页面内完成；Apple 的 `window.open` 弹窗获得对话分区上的真实子窗口，并保留 opener。其他主框架目标在系统浏览器中打开，其他 `window.open` 调用也同样外送。对于拒绝内嵌浏览器的提供方，提供 **通过浏览器登录** 操作：Desktop 外壳复用用户自己的 Chrome 或 Edge 配置文件（要求该浏览器已关闭，否则显示本地化的「请关闭 Chrome 后重试」错误），在其中打开对话页，等到站点自身把非空的 `localStorage.userToken` 写入后（而不是等待地址变化），把浏览器 Cookie 以及 `userToken`、`__appKit_userInfo`、`deepseek-device-id:chat` 写入 guest 并重新加载。只有找不到浏览器配置文件时才使用专用配置文件。配置文件被占用时，界面提供 **关闭 Chrome 并登录**：外壳停止正在运行的浏览器，导入会话，然后重新打开浏览器。`browserLoginTimeoutMs` 与 `browserLoginPollMs` 限定等待时间。被拒绝的导航与提供方窗口决策会以不含 token 或 Cookie 的形式追加到 Desktop 登录日志（userData 下的 `logs/chat-login.log`）。guest 加载失败或渲染进程崩溃时，标签显示本地化的卡片，带 **重试** 与 **在浏览器中打开**：加载失败在同一 guest 内重试，只有渲染进程崩溃才重建 guest。

## 理解实现

<a id="understand-the-implementation"></a>

`apply` 注册字典、把持久化模式映射到框架外壳，并贡献一个 `shell.overlay` 条目，使切换器与 guest 位于跨面板切换仍然挂载的整帧层中。覆盖层条目在窗口顶部条带渲染胶囊（桌面端是标题栏区域，其他环境以浮层内缩），guest 页面位于其下方。

桌面端 guest 是 `<webview>`，使用主进程签发的 lease 和持久分区 `persist:dsh-chat`。`apps/desktop` 在 `will-attach-webview` 校验该 lease，强制 sandbox、上下文隔离、无 Node、无 preload、禁止嵌套 webview 与对话框，并安装会话策略：只授予 `clipboard-sanitized-write`，让站点的复制控件可用而不开放剪贴板读取；摄像头、麦克风、屏幕捕获、定位与通知一律拒绝，下载被取消，站点主机无法访问应用 Host。提供方跳转与 Apple 子窗口经过同一套主进程策略；子窗口使用对话 User-Agent，并拒绝自身再开弹窗。外壳从不向页面注入凭据或请求头，也不读取其 DOM、Cookie 或存储。

没有桌面桥接时，插件渲染 Web 回退页面：站点拒绝在普通框架中嵌入，因此标签提供在新浏览器标签页中打开其地址，而不是假装可以嵌入。

## 延伸阅读

<a id="further-exploration"></a>

- [ui-layout](../ui-layout/README.zh.md) —— 框架、`shell.overlay`，以及切换器驱动的 `ChromeMode`。
- [ui-sidebar-browser](../ui-sidebar-browser/README.zh.md) —— 本 guest 所沿用的右侧栏浏览器 lease 与 DOM 生命周期。
- [桌面应用](../../../apps/desktop/README.zh.md) —— guest 校验、持久分区与权限策略。

## 模型体验

<a id="model-experience"></a>

无。本包不注册任何面向模型的输入，也不改变提示词、工具 schema 或请求。

#### KV 缓存影响

无；切换器改变框架外壳，内嵌页面从不进入模型请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 提供方登录的完成属于站点流程：策略允许 Google 的重定向链与 Apple 的弹窗在 guest 内运行，但提供方是否接受内嵌浏览器不受本插件控制。Desktop 登录日志会记录哪些跳转与窗口被允许，浏览器回退路径负责处理拒绝。
- 浏览器回退复制站点自身的会话，而不是新签 token。`deepseek-device-id:chat` 与 `userToken` 一起传输，因为站点的 `auth_token/check_device` 会拒绝在另一台设备上创建的会话；缺少它时，复制的登录会在下次检查时被丢弃。token 只由主进程写入对话 origin 的 `localStorage`，从不记录日志，也不传给 harness 渲染进程。
- 只检查主框架导航；站点的子资源除应用 Host 守卫外不做代理或过滤。
- 站点自己渲染的错误页（HTTP 5xx 文档）对 guest 来说与普通页面无异；失败卡片只覆盖网络失败、被取消的加载与渲染进程崩溃。
- Web 构建无法嵌入站点；那里的「对话」标签就是回退页面。
- 聊天页面的下载会被取消；站点的复制与附件流程不需要下载。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>供维护者参考的上下文——点击展开</summary>

无。

</details>

模式属于框架外壳，因此其他功能也可能驱动 `ctx.layout.setChrome`；只有本包负责把「对话 / Harness」产品模式映射到它上面。
