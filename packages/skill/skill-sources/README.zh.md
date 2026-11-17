---
description: "按配置保存的本地技能来源与单技能开关、共享的应用列表，以及技能标签页中用于分组的分类规则。"
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-sources

[English](README.md) | 中文

## 概述

这个小 Host 插件拥有技能标签页背后的开关与分组规则。它的 volatile Config 字段保存在配置设置文档中，因此选择会跨重启保留并属于用户自己的配置；每个已挂载的 `skill-filesystem` 实例读取同一个服务，并在写入后重新发布目录。关闭来源会隐藏其全部技能但不会清除单个技能的开关。分类规则与开关放在一起，使部署方无需修改提供者就能命名自己的技能族。

## 目录

- [使用本包](#use-this-package)
- [分类](#categories)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

## 使用本包

<a id="use-this-package"></a>

把它作为普通 Host 行挂载在 `skill-filesystem` 旁边；它的配置条目 id 是 `skill-sources`：

```yaml
- id: skill-sources
  name: '@deepseek-ai/dsh-skill-sources'
```

开关是普通的 volatile Config 字段，因此从配置设置文档编辑，并像其他插件配置一样被校验：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `applications` | Claude Code、Codex、GitHub Copilot、Gemini CLI、Google Antigravity、OpenCode | 其他应用的技能目录，以 `{ id, dir, title }` 条目表示，仅在目录存在时扫描，排在 harness 目录之后；每个默认关闭 |
| `categories` | 十条内置分类规则 | 分类规则，以 `{ id, title, prefixes?, namespaces? }` 条目表示；提供者按它们为自己描述的技能分组。省略即使用内置规则，`[]` 只保留作者自己声明的分类 |
| `sources` | `{}` | 按 source id 的来源开关；缺省保持该来源的默认值（harness 目录开，其他应用关） |
| `skills` | `{}` | 按 source id 与技能名的单技能开关；缺省表示启用 |
| `folders` | `[]` | 读者在技能页添加的文件夹，按添加顺序存为 `{ dir }` 条目；每个文件夹是一个默认开启、名为 `folder:<dir>` 的来源 |

`skill-filesystem` 通过 `skillSources` 服务读取它们并注册自身用于失效通知，因此下一个模型步骤会发布替换的技能目录，`/skill` 也遵循同一状态。

<a id="categories"></a>
## 分类

技能标签页默认按分类分组，而 `categories` 决定“分类”是什么。每条规则命名一个分类，以及把技能归入它的匹配词：

```yaml
- id: skill-sources
  name: '@deepseek-ai/dsh-skill-sources'
  config:
    categories:
      - id: google-cloud
        title: Google Cloud
        prefixes: [gcp, google, bigquery, gemini]
      - id: video
        title: Video and animation
        prefixes: [hyperframes, remotion, faceless, reverse, product, style, blender, media]
      - id: plugin-ckm
        title: ckm
        namespaces: [ckm]
```

提供者为每个技能解析一个分类，先匹配者生效：

1. frontmatter 声明了分类：`category`、扁平的 `metadata.category` 键，或 `metadata` 映射中的 `category` 字段。这是作者自己的词；它按规则 id、前缀或命名空间匹配，没有规则认领时会成为以该词为标题的独立分类。
2. 技能名带有插件命名空间，例如 `ckm:banner-design` → `ckm`。
3. 技能名带有前缀，即第一个 `-` 之前的部分，例如 `gcp-agent-builder` → `gcp`。
4. 没有规则认领：技能不报告分类，技能标签页把它放进自己的“其他”分组。

内置规则为 `google-cloud`（`gcp`、`google`、`bigquery`、`gemini`）、`firebase`（`firebase`）、`video`（`hyperframes`、`remotion`、`faceless`、`reverse`、`product`、`style`、`blender`、`media`）、`design`（`figma`、`ui`、`apple`）、`content`（`smm`、`ads`、`copy`、`content`、`seo`）、`office`（`office`、`pdf`、`docx`、`pptx`、`xlsx`、`jupyter`、`notebook`）、`development`（`dsh`、`gh`、`skill`、`discover`、`codex`、`extension`、`schema`、`bigtable`）、`automation`（`playwright`、`agent`、`computer`、`cua`、`android`、`xcode`）、`notes`（`notion`、`linear`、`gmail`、`calendar`、`schedule`）和 `security`（`security`）。“其他”分组没有对应规则：未被认领的技能不带分类。技能标签页会翻译每个内置 id，因此内置规则的 `title` 只是不认识该 id 的客户端的回退显示；部署方新增的规则按原样显示其 `title`。

当 id 或标题为空，或两条规则认领同一个 id、前缀或命名空间时加载失败，因为标签页按 id 分组，否则一个匹配词会同时指向两个分类。`id` 是分组标识：重命名它会让标签页在下一次加载时重新分组。

## 理解实现

<a id="understand-the-implementation"></a>

该插件存在的原因是：Web 配置停用了顶层的 `skill-filesystem` 行，并把提供者挂载在 agent preset 内。preset 作用域的行无法被配置设置服务按 id 定位，而顶层条目可以，因此开关、应用列表和分类规则放在这里，提供者只负责读取。

`setSource` 与 `setSkill` 委托给 `ctx.settings.update('skill-sources', …)`，后者把补丁合并进配置文档、重新加载本条目的 volatile Config，然后使每个通过 `register()` 注册的提供者失效。设置文档之外不保存任何状态，因此两个窗口、一次重启或一份配置副本都会看到相同的开关。`visibility()` 只读一次配置，返回开关、应用、已添加文件夹与分类规则，因此一个提供者从同一份配置快照完成过滤与分组。

## 延伸阅读

<a id="further-exploration"></a>

- [skill-filesystem](../skill-filesystem/README.zh.md) —— 发现、根目录、优先级、分类推导，以及这些开关驱动的过滤。
- [ui-skills](../../client/ui-skills/README.zh.md) —— 写入开关并渲染分组的技能标签页。

## 模型体验

<a id="model-experience"></a>

无：本 Host 包不注册任何面向模型的输入，也不改变提示词、工具 schema 或请求。

#### KV 缓存影响

无；它只保存其他包在渲染目录之前读取的开关与分组规则。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 开关按配置条目存储：第二份配置保留自己的选择，复制配置会一并复制它们。
- 只有通过服务注册的提供者才会响应写入；未注册的提供者在启动时读取一次开关。
- 写入是无条件的（没有修订栅栏）：两个同时的切换可能互相覆盖。
- 分类规则不能针对单个技能覆盖另一条规则：规则按名字匹配词归类，唯一的单技能覆盖是 frontmatter 自己的 `category` 字段。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>供维护者参考的上下文——点击展开</summary>

无。

</details>

volatile Config 字段就是存储格式：改变其形状属于设置迁移，而不是重构。
