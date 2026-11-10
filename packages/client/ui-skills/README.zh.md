---
description: "dsh 插件页面的「技能」标签：本地技能来源及其技能、来源与单技能开关，以及 Host 报告的发现状态。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-skills

[English](README.md) | 中文

## 概述

插件页面新增第二个标签 **技能**，紧邻已安装插件与市场标签。它列出 Host 扫描的本地技能来源——harness 自己的项目与用户目录，以及其他应用的技能目录——并允许用户整体关闭某个来源，或关闭其中的单个技能。关闭来源会隐藏它的全部技能，但不会忘记单个技能的开关。发现状态由 Host 提供：被更高优先级来源覆盖的技能、frontmatter 错误、以及目录已消失的来源都无需打开文件即可看到。

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

打开 **插件**，切换到 **技能**。每个来源行显示名称、属于 harness 还是其他应用、目录，以及「已启用 N / M」。展开后列出发现的技能：名称、描述、文件路径和开关；搜索框按名称或描述过滤。较长的来源一次渲染五十个技能，其余通过 **显示更多** 展开。

切换来源或技能会调用 Host 的 `skillSources` Remote，更新 `skill-sources` 配置设置条目并使所有已挂载的提供者失效，因此下一次模型请求即可看到变化而无需重启，会话日志会记录变化后的目录。被关闭的技能不会出现在模型目录和 `/skill` 中；重新打开其来源会恢复单个技能的选择。

### 用户会看到什么

- **两个标签。** 插件页面保留插件列表标签，并新增 **技能**；只有挂载本包时该标签才出现。
- **默认值。** harness 自己的目录（项目的 `.dsh/skills`、`.agents/skills`，以及 `~/.dsh/skills`、`~/.agents/skills` 和内置目录）默认启用。其他应用的目录仅在存在时出现，并保持**关闭**直到手动开启。
- **开关会写入设置。** 每个开关都保存在 `skill-sources` 配置条目中，因此重启后仍保留，同一配置下的 Web 与 Desktop 共用。
- **关闭来源或单个技能。** 来源开关会隐藏其全部技能但记住各自的开关；再次启用时恢复。已启用来源中新发现的技能默认启用。
- **被覆盖的行。** `被 <source> 覆盖` 表示同名技能来自更高优先级的来源，模型看到的是后者。
- **损坏的行。** `Frontmatter 错误` 显示解析消息，该技能被忽略；`文件夹未找到` 标记目录已消失的来源。
- **关掉就看不到。** 被关闭的技能在下一次请求时不会出现在会话目录与 `/skill` 中，无需重启。

## 理解实现

<a id="understand-the-implementation"></a>

该标签是一个 `plugins.tab` 贡献；它从 `dsh-skill-filesystem` 发布的 `skillSources` Remote 命名空间读取清单，那里为每个扫描来源和每个发现技能各报告一行，包括仅因同名被覆盖、或 frontmatter 无法解析的技能。写入不经过该命名空间：Host 把开关保存在 `skill-sources` 配置设置条目中，所有提供者实例共用，并在每次写入后使目录缓存失效。

搜索、展开和分页是展示状态，保存在组件内；每次写入后重新获取清单。

## 延伸阅读

<a id="further-exploration"></a>

- [skill-filesystem](../../skill/skill-filesystem/README.zh.md) —— 发现、根目录、优先级，以及 `skillSources` 命名空间。
- [tool-skill](../../skill/tool-skill/README.zh.md) —— 模型实际看到的会话目录。
- [ui-plugin-manager](../ui-plugin-manager/README.zh.md) —— 承载该标签的页面。

## 模型体验

<a id="model-experience"></a>

无：本浏览器包不注册任何面向模型的输入，也不改变提示词、工具 schema 或请求。

#### KV 缓存影响

追加替换目录会保留更早的前缀；变化的条目及其之后的内容构成新的后缀，与其他目录成员变化相同。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 标签不解析*当前*会话的项目根：清单向 Host 请求时不带工作目录，因此项目的 `.dsh/skills` 与 `.agents/skills` 只有在 Host 的查找经由其他路径到达时才出现。
- 该标签从不读取技能正文；描述来自 frontmatter，只改正文不会改变该行。
- 写入是无条件的（没有修订栅栏）：两个同时的切换会互相覆盖。
- 行未虚拟化；包含数百个技能的来源按每页五十条分页。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>供维护者参考的上下文——点击展开</summary>

无。

</details>

`skillSources` 命名空间报告发现结果；`skill-sources` 设置条目为所有提供者实例保存开关。
