---
description: "DeepSeek Harness Web GUI 的乌克兰语（uk）语言包：注册语言，并为随附的 Client UI 提供乌克兰语词典。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-locale-uk

[English](README.md) | 中文

## 概述

在语言列表中新增 **Українська**，并为随附的 Web UI 提供乌克兰语词典——覆盖所有拥有用户文案的 Client locale 命名空间。本包属于 [client-locale](../locale/README.zh.md) 定义的语言包：它在内置注册之上注册 `uk` 语言，并为每个命名空间注册一份乌克兰语词典，因此内置包各自保留英文/中文来源。查找会按 key 回退到英文，所以后续上游新增的文案仍会显示英文而不是裸 key。浏览器语言顺序包含 `uk` 或 `uk-UA` 时直接以乌克兰语打开；在「设置 → 通用」中的显式选择会被持久化。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

本包随默认的 `@deepseek-ai/dsh-web-app` 组合包挂载，无需配置。打开 **设置 → 通用**，在语言行中选择 **Українська**，或让浏览器根据其 `uk`/`uk-UA` 语言顺序自动选择。选择保存为 `$DSH_HOME/cordis.patch.yml` 中的 `locale.preference` 并立即生效：由 slot 渲染的文案无需刷新即可切换，`<html lang>` 变为 `uk`。

### 翻译范围

每个注册词典的随附 Client 命名空间在 `src/client/locales/` 中都有乌克兰语词典：外壳、聊天与会话、插件与技能页、设置分区、侧栏、日程、审批、提问、任务以及随应用发布的可选面板。命令 token、占位符、斜杠命令、文件路径和产品名称保持原样。

### 缺失翻译

没有乌克兰语值的 key 会沿当前语言的回退链解析到英文，再查询共享的 `common` 命名空间，最后显示 key 本身。本包相对当前源码是完整的，但更新的上游版本可能先加入新文案；这些文案会以英文显示，而不是让页面出错。当跟踪的词典与英文源不一致时，`tests/parity.client.spec.ts` 会失败。

<a id="understand-the-implementation"></a>
## 理解实现

`src/client/index.ts` 调用 `ctx.locale.addLanguage({ id: 'uk', label: 'Українська', fallback: 'en' })`，然后对 `src/client/dictionaries.ts` 中的每个命名空间调用 `ctx.locale.register(namespace, 'uk', dictionary)`。单语言注册形式专为语言包提供，不会与拥有相同命名空间的内置插件冲突：一个命名空间可以为每种语言各持有一份词典。所有注册都是 effect，因此卸载本包只会移除它添加的语言和词典。

`scripts/extract-english.cjs` 用 TypeScript 解析器读取包源码，返回每个 `ctx.locale.register` 调用背后的英文字典，包括由展开、导入常量和 `Array.join()` 文本构造的字典。一致性测试将该源与跟踪的乌克兰语文件比较：命名空间相同、key 及顺序相同、占位符与字面 token 相同。

词典位于 `src/client/locales/`，每个命名空间一个模块；`src/client/dictionaries.ts` 是插件注册时使用的映射表。本包自带 `locale/*.json` 展示元数据，因此其插件行在所有随附语言（包括乌克兰语）下都有本地标题和描述。

<a id="further-exploration"></a>
## 延伸阅读

- [client-locale](../locale/README.zh.md) —— locale 服务、语言包与词典查找链。
- [Web 客户端组](../README.zh.md) —— 浏览器插件包所在位置。
- [settings](../ui-settings/README.zh.md) —— 保存语言偏好的设置服务。

<a id="model-experience"></a>
## 模型体验

无：本浏览器包不注册任何面向模型的输入，也不改变提示词、工具 schema 或请求。

#### KV 缓存影响

无；UI 语言不进入 Provider 请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 原生桌面外壳（窗口菜单、安装程序）跟随桌面语言设置，而非本包；本包只本地化 Web 界面。
- 插件卡片的标题和描述来自各包的 `locale/uk.json`；本包不提供它们，未随包发布乌克兰语元数据的包会保留英文元数据。
- 长帮助文本遵循本包记录的术语；措辞可能与仅有英文和中文的 DeepSeek 官方文档不同。
- 复数形式为每个 key 使用一个乌克兰语形式；locale 服务不添加复数规则，因此涉及计数的值按常见情况措辞。
- 上游新增文案会回退为英文，直到重新生成词典并更新一致性测试。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护上下文——点击展开</summary>

作为程序运行时，`node scripts/extract-english.cjs` 会打印发现的命名空间和 key；模块形式则返回它们。上游文案变化后需要刷新时：运行提取器，更新受影响的 `src/client/locales/*.ts` 值与 key，然后运行 `pnpm vitest run packages/client/locale-uk`。本包自身的展示元数据需要与任何第一方包一样的随附语言覆盖。

</details>
