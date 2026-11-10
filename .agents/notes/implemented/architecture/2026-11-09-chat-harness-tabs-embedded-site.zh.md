# Agent Note: Chat 与 Harness 标签，内嵌 DeepSeek 站点

Status: implemented

[English](2026-11-09-chat-harness-tabs-embedded-site.md) | 中文

## Problem

产品需要在窗口中提供两个顶层标签：**Chat** 是内嵌在应用里的 DeepSeek 聊天站点本身，用户在那里登录自己的账号并看到该账号的历史；**Harness** 是今天的应用本身，保持不变。两个标签不共享数据：harness 从不向站点发送会话、令牌或模型调用，站点也不向 harness 提供任何数据。

站点不能被重画成 harness 的视图：它是另一个产品，有自己的账号与历史。唯一忠实的 Chat 标签是在 guest 浏览上下文中打开该站点。Web 构建没有该上下文，且站点拒绝普通框架嵌入，因此在那里标签必须提供站点入口，而不是假装嵌入。

固定约束：绝不向页面注入凭据、请求头或脚本；绝不读取其 DOM、Cookie 或存储；绝不削弱站点保护（不剥离 `X-Frame-Options`、不代理、不伪造 User-Agent）；不复用侧栏浏览器按工作区临时分配的、随进程消亡的分区；除切换器的位置外，保持 harness 的一切行为。

## Decision

模式是框架外壳状态，而不是面板。`ui-layout` 在根存储中加入 `ChromeMode`（`full` | `minimal`）、`ctx.layout.chrome` 与 `ctx.layout.setChrome`；`minimal` 只渲染中间一列，并保留所有宽度、右侧面板与面板偏好以便返回。`ui-work-mode` 把 Chat 映射为 `minimal`、Harness 映射为 `full`，并以持久化的 `dsh.work-mode.v1` 存储拥有标签状态（首次运行：Harness）。

切换器与 guest 位于同一个 `shell.overlay` 条目，即整帧、始终挂载的层。胶囊位于窗口顶部条带（`--dsh-frame-top-clearance`：Windows 标题栏区域、macOS 预留区，其他环境为浮层内缩），因此在任何 harness 面板上都可见，也不会遮挡站点。guest 页面从该条带下方开始。

选择 Harness 时 guest 保持挂载：层只翻转 `opacity`、`pointer-events` 与 `inert`，绝不使用 `display: none`，也绝不在 DOM 中移动元素，因为两者都会分离 Electron `<webview>` 并重载页面。站点只在首次打开「对话」时加载，而不是在应用启动时。桌面 guest 还启用 `backgroundThrottling: false`，让正在生成的回答跨切换保留。

桌面端 guest 是持久分区 `persist:dsh-chat` 中的 `<webview>` 挂载，通过既有的 `will-attach-webview` 校验接受主进程签发的租约：归属窗口匹配、只允许一次挂载、分区匹配。该校验是被扩展而非绕过——侧栏浏览器租约仍拥有其工作区分区与任意 HTTP 导航，而 chat 租约携带来自插件配置的主框架白名单（`url`、`allowedOrigins`；默认站点及其 origin）。被拒绝的主框架目标与所有 `window.open` 都交给系统浏览器——打包构建中同样如此；被拒绝的导航只在未打包时记录为 `[chat-guest] blocked navigation`。chat 会话只授予 `clipboard-sanitized-write`（站点的复制控件），拒绝其他所有权限与下载，并保留既有的应用 Host 请求守卫。加载失败的状态保持到下一次加载开始，**重试** 在同一 guest 内重新加载；只有渲染进程消失才作废旧租约并挂载新的 guest。拖拽不会导航页面，嵌套 webview 仍被拒绝。

没有桌面桥接时，标签渲染一个带站点地址的简短回退页面，因为假装嵌入会撞上站点自身的框架策略。

## Alternatives considered

- **带无工具 agent preset 的 harness 会话**（上一次尝试）——那仍是我们的聊天与我们的模型，而不是用户要求的站点。
- **`WebContentsView`**——位于页面之上的原生层会遮挡应用菜单、对话框与模式胶囊，并且需要在每次布局变化时由渲染进程同步边界。
- **复用侧栏浏览器的临时分区**——Cookie 无法跨重启保存，而登录是硬性要求。
- **用不透明层覆盖 harness 代替精简外壳**——harness 仍在覆盖层之后可聚焦、可 Tab 到达。
- **Web 构建中的 iframe**——站点的框架策略并非在所有网络下都可观测，且拒绝是静默的；显式回退更诚实。

## Consequences

- 在内嵌浏览器中 Google 登录无法完成（Google 阻止内嵌用户代理）；邮箱与手机号登录可以完成，且不尝试任何绕过。
- 站点自行渲染的错误页与正常页面无法区分；失败卡片只覆盖网络失败、被取消的加载与渲染进程崩溃。
- Google 等第三方链接会离开 guest；账号会话仍保存在 guest 自己的分区中。
