---
description: "dsh 插件页面的「技能」标签：本地技能目录、分类与来源分组、筛选、详情面板，以及决定哪些技能提供给智能体的开关。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-skills

[English](README.md) | 中文

## 概述

插件页面新增第二个标签 **技能**，紧邻已安装插件与市场标签。它把 Host 扫描的本地技能来源呈现为技能卡片目录，并可按 Host 为每个技能推导的分类分组——这是默认视图——或按发现它的来源分组；工具栏中的切换器决定使用哪一种。选中一张卡片会在标签内打开详情面板，显示完整描述、其分类与来源、路径、文件与来源记录。发现状态由 Host 提供：被覆盖的同名技能、frontmatter 错误，以及目录已消失的来源，无需打开文件即可看到。

## 目录

- [使用本包](#use-this-package)
- [来源标记与许可](#source-marks-and-licences)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

## 使用本包

<a id="use-this-package"></a>

打开 **插件**，切换到 **技能**。搜索框按技能名称或描述过滤，一个仅显示图标的 **刷新** 操作重新读取清单，分裂式 **添加技能** 按钮可添加文件夹或打开目录入口，两个筛选菜单按来源与按状态（已启用、已关闭、被覆盖、有错误）缩小目录范围。筛选行末尾有一行安静的数字，说明当前显示多少条、其中多少条处于启用状态。旁边的两段式切换器决定卡片如何分组：

- **分类**（默认）按 Host 从技能 frontmatter 或名称推导的分类分组。分类标题带有本地化名称，以及当前搜索与筛选保留下来的卡片数量；分类按该数量排列，数量相同的分组保持其首张卡片出现的顺序，没有规则认领的技能在末尾形成唯一的 **其他** 分组。这里没有来源开关，因为分类不是文件夹。
- **来源** 是来源视图：每个标题带来源标记、名称、类型、目录、该来源的技能总数、读者添加文件夹的移除按钮，以及隐藏其全部技能但不忘记单个选择的开关。

离开标签再回来后，所选分组保持不变。筛选、搜索、汇总行与详情面板在两种模式下都可用。

工具栏的折叠方式与插件页面自身的动作行一致，触发宽度也相同（页面栏 600px；标签列是该页面栏减去左右内边距后的 560px）：搜索独占一行，添加按钮只保留两个图标半边，两段式切换器让位给一个图标，由它把两种模式作为菜单打开；每个控件都保留可访问名称与悬停提示。重新读取进行中（包括写入后的重读）时，刷新操作保持忙碌状态，分组菜单会说明当前生效的模式。

每个分组的折叠标题切换其卡片，折叠状态与选中的技能一样会被记住。每张技能卡片显示来源标记、技能名称（其下是来源）、作者描述、状态与开关。描述是独立区块，按阅读宽度排版，默认两行，并用 **显示完整描述** 展开到第三行；完整正文在详情面板中阅读。开关被禁用时会说明原因：来源已关闭，或同名技能被更高优先级的来源取得。frontmatter 无法读取的技能以文件夹名作标题、没有开关，并显示解析器的原因。

详情面板显示完整描述（含作者声明的语言）、来源、Host 给出的分类（若有）、带复制操作的路径、技能附带的文件（含大小与脚本标记），以及在安装器记录时显示的仓库、提交与安装日期。它是列表旁的区域而不是模态框，读者仍能看到自己点开的卡片。客户端不认识的分类（例如部署方自有规则引入的分类）显示该规则配置的标题；没有标题时回退到原始 id。

四种状态取代了原先的单行提示。加载时显示同一网格的骨架，因此行数据到达时不会重排。加载失败是就地通知并带 **重试**；成功加载之后的失败会保留已描述的行，并说明列表可能已过期。搜索或筛选没有结果时会说明并提供清除操作。完全没有技能时，会解释技能是什么，提供且仅提供三种添加方式——**添加文件夹**、**浏览目录**、**用 AI 创建**——并以一行安静的来源标记说明它读取哪些来源。同样的三个动作始终在添加按钮的菜单中；页面无法打开对话时 **用 AI 创建** 仍在但被禁用，没有文件夹选择器时 **添加文件夹** 会省略选择按钮。

切换来源或技能会调用 Host 的 `skillSources` Remote，更新 `skill-sources` 配置设置条目并使所有已挂载的提供者失效，因此下一次模型请求即可看到变化而无需重启。被关闭的技能不会出现在模型目录和 `/skill` 中；重新打开其来源会恢复单个技能的选择。

## 来源标记与许可

<a id="source-marks-and-licences"></a>

每个标记都是一个 20px 的方框、一种墨色 `--dsw-alias-label-secondary`，因此两种主题和所有行状态共用同一墨色。官方图稿按原样再现并以蒙版着色，轮廓属于厂商，颜色属于我们。它们只用于标识被扫描目录所属的应用：这些标记都不表示合作关系、背书，也不表示该应用属于 DeepSeek Harness。

| 来源 | 标记 | 图稿出处 | 许可与条件 |
|---|---|---|---|
| OpenAI Codex | OpenAI 官方标记 | https://openai.com/brand | OpenAI 商标，仅按 https://openai.com/brand 用于标识；不修改，不比我们自己的界面更醒目，不暗示背书。 |
| GitHub | GitHub 官方标记 | https://brand.github.com | GitHub® 是 GitHub, Inc. 的商标，按 GitHub Logo Policy（https://docs.github.com/en/site-policy/other-site-policies/github-logo-policy）使用；不以 octocat 作为产品标识，不暗示合作。 |
| GitHub Copilot | GitHub 官方标记 | https://brand.github.com | Copilot 的标记即 GitHub 产品标志组合，适用同一 GitHub Logo Policy 条件。 |
| OpenCode | OpenCode 官方标记 | https://github.com/anomalyco/opencode（`dev` 分支，`.github/assets/logo-ornate-dark.svg`） | MIT。Copyright (c) 2025 opencode；版权与许可声明保留在 [`src/client/assets/opencode.svg`](src/client/assets/opencode.svg)。不修改，不暗示背书。 |
| Claude Code | 本包绘制的单字母标记 | — | Anthropic 未公布标记授权，因此不附带任何 Anthropic 或 Claude 标记。「Claude Code」是 Anthropic PBC 的商标；与 Anthropic 无隶属或背书关系。 |
| Gemini CLI | 本包绘制的单字母标记 | — | Google 的授权流程面向合作伙伴，`google-gemini/gemini-cli` 未附带 logo 资源，因此不附带 Google 标记。Gemini 是 Google LLC 的商标。 |
| Google Antigravity | 本包绘制的单字母标记 | — | `antigravity.google/brand` 返回 404；不附带 Google 标记。与 Google 无隶属关系。 |
| skills.sh | 本包绘制的单字母标记 | — | 没有公开授权覆盖 skills.sh 标志；Vercel 的品牌资源只覆盖 Vercel 标记。不附带 skills.sh 或 Vercel 标记。 |
| harness 目录 | 波浪号标记；读者添加的文件夹使用线性文件夹图标 | — | 本包自有的图稿。 |

单字母标记是来源首字母加边框方框，由本包绘制。Host 配置了本包不认识的应用时，回退到其 id 的首字母。

## 理解实现

<a id="understand-the-implementation"></a>

该标签是一个 `plugins.tab` 贡献；它从 `dsh-skill-filesystem` 发布的 `skillSources` Remote 命名空间读取清单，那里为每个扫描来源和每个发现技能各报告一行，包括仅因同名被覆盖、或 frontmatter 无法解析的技能。面板中的文件列表、单行描述、作者声明的语言、来源记录、来源的应用 id，以及每个技能推导出的 `category` 与 `categoryTitle`，都来自这些行，因此标签自己不读取文件、也从不运行技能附带的内容。分类 id 由 Host 的 `skill-sources` 配置命名；标签翻译内置 id，其他 id 显示 Host 提供的标题。

写入经过同一命名空间：`setSource` 与 `setSkill` 把开关保存进 `skill-sources` 配置条目，然后使所有已挂载的提供者失效，因此下一个模型步骤会发布替换目录。分组模式、分组折叠与打开的详情面板保存在注册时声明的 store 中，其生命周期长于组件；搜索、筛选、描述展开与分页是组件状态。每次渲染都用筛选后的卡片构建分组：来源模式为每个来源生成一个分组，分类模式把同一批卡片按 `category` 分桶，按数量排列有名称的分组，并把未匹配的组放在最后。每次被接受的写入之后、工具栏的刷新操作之后、以及当前会话的项目目录变化时都会重新获取清单，被更新请求取代的响应会被丢弃。

## 延伸阅读

<a id="further-exploration"></a>

- [skill-filesystem](../../skill/skill-filesystem/README.zh.md) —— 发现、根目录、优先级、`skillSources` 命名空间，以及面板渲染的行字段。
- [tool-skill](../../skill/tool-skill/README.zh.md) —— 模型实际看到的会话目录。
- [ui-plugin-manager](../ui-plugin-manager/README.zh.md) —— 承载该标签的页面。
- [skill-sources](../../skill/skill-sources/README.zh.md) —— 拥有开关、应用列表与分类规则的配置条目。

## 模型体验

<a id="model-experience"></a>

无：本浏览器包不注册任何面向模型的输入，也不改变提示词、工具 schema 或请求。

#### KV 缓存影响

追加替换目录会保留更早的前缀；变化的条目及其之后的内容构成新的后缀，与其他目录成员变化相同。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **安装属于后续阶段。** **浏览目录** 打开的对话框说明安装稍后提供；目录搜索、预览与下载都不在此实现，skills.sh、SkillsMP 与 skills-hub 等目录来源也未涉及。
- **来源记录需要安装器。** 仓库、提交与安装日期只在安装器把它们写入技能 frontmatter 元数据时显示，本版本不写入这些字段。
- **描述展开有固定额度。** 行从两行展开到三行；更长的描述在详情面板中阅读。只要有描述就提供该控件，而不是逐行测量。
- **该标签从不读取技能正文。** 描述来自 frontmatter，只改正文不会改变该行。
- **写入是无条件的（没有修订栅栏）。** 两个同时的切换会互相覆盖；来源写入进行中会禁用其下的开关。
- **列表未虚拟化。** 包含数百个技能的来源按每页五十条分页。
- **分类不在此编辑。** 分类来自 `skill-sources` 配置与每个技能的 frontmatter。标签只显示 Host 的推导结果；手动覆盖单个技能属于后续阶段。
- **文件夹管理只在来源模式。** 没有技能的空文件夹的安静行及其移除按钮不在分类模式显示，因为分类不是文件夹；切换回来源模式即可恢复。
- **两种分组互斥。** 在一种模式下记住的折叠不会折叠另一种模式下对应的分组，因为分类分组与来源分组是不同标识。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>供维护者参考的上下文——点击展开</summary>

来源标记是本包中唯一的第三方图稿。替换或新增之前，请在上表中记录品牌公开的使用条款；宽松的仓库许可从不授予商标使用权。

</details>

`skillSources` 命名空间报告发现结果；`skill-sources` 设置条目为所有提供者实例保存开关，并提供标签用于分组的分类规则。
