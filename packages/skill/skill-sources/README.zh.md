---
description: "按配置保存的本地技能来源与单技能开关，所有已挂载的 skill-filesystem 提供者共用，由技能标签页写入。"
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-sources

[English](README.md) | 中文

## 概述

这个小 Host 插件拥有技能标签页背后的开关。它的 volatile Config 字段保存在配置设置文档中，因此选择会跨重启保留并属于用户自己的配置；每个已挂载的 `skill-filesystem` 实例读取同一个服务，并在写入后重新发布目录。关闭来源会隐藏其全部技能但不会清除单个技能的开关。

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

把它作为普通 Host 行挂载在 `skill-filesystem` 旁边；它的配置条目 id 是 `skill-sources`：

```yaml
- id: skill-sources
  name: '@deepseek-ai/dsh-skill-sources'
```

开关是普通的 volatile Config 字段，因此从配置设置文档编辑，并像其他插件配置一样被校验：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `sources` | `{}` | 按 source id 的来源开关；缺省保持该来源的默认值（harness 目录开，其他应用关） |
| `skills` | `{}` | 按 source id 与技能名的单技能开关；缺省表示启用 |
| `folders` | `[]` | 读者在技能页添加的文件夹，按添加顺序存为 `{ dir }` 条目；每个文件夹是一个默认开启、名为 `folder:<dir>` 的来源 |

`skill-filesystem` 通过 `skillSources` 服务读取它们并注册自身用于失效通知，因此下一个模型步骤会发布替换的技能目录，`/skill` 也遵循同一状态。

## 理解实现

<a id="understand-the-implementation"></a>

该插件存在的原因是：Web 配置停用了顶层的 `skill-filesystem` 行，并把提供者挂载在 agent preset 内。preset 作用域的行无法被配置设置服务按 id 定位，而顶层条目可以，因此开关放在这里，提供者只负责读取。

`setSource` 与 `setSkill` 委托给 `ctx.settings.update('skill-sources', …)`，后者把补丁合并进配置文档、重新加载本条目的 volatile Config，然后使每个通过 `register()` 注册的提供者失效。设置文档之外不保存任何状态，因此两个窗口、一次重启或一份配置副本都会看到相同的开关。

## 延伸阅读

<a id="further-exploration"></a>

- [skill-filesystem](../skill-filesystem/README.zh.md) —— 发现、根目录、优先级，以及这些开关驱动的过滤。
- [ui-skills](../../client/ui-skills/README.zh.md) —— 写入开关的技能标签页。

## 模型体验

<a id="model-experience"></a>

无：本 Host 包不注册任何面向模型的输入，也不改变提示词、工具 schema 或请求。

#### KV 缓存影响

无；它只保存其他包在渲染目录之前读取的开关。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 开关按配置条目存储：第二份配置保留自己的选择，复制配置会一并复制它们。
- 只有通过服务注册的提供者才会响应写入；未注册的提供者在启动时读取一次开关。
- 写入是无条件的（没有修订栅栏）：两个同时的切换可能互相覆盖。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>供维护者参考的上下文——点击展开</summary>

无。

</details>

volatile Config 字段就是存储格式：改变其形状属于设置迁移，而不是重构。
