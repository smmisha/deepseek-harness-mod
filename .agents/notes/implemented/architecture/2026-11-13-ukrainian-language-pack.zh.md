# Agent Note: 乌克兰语语言包

Status: implemented

[English](2026-11-13-ukrainian-language-pack.md) | 中文

## Problem

Web GUI 随附八种内置语言（英语、中文、日语、西班牙语、法语、德语、俄语和巴西葡萄牙语），其词典位于拥有对应文案的包内。乌克兰语读者需要乌克兰语界面，但新增第九种内置语言意味着修改每个 Client 词典包、把 `uk` 加入随附语言门禁集及其约 300 个包元数据目录、翻译桌面外壳和 NSIS 安装程序，并把这一切作为一个庞大且无法逐步评估的 diff 提交。locale 服务已经支持语言包：`addLanguage` 添加一种可选语言，其词典查找按 key 回退；按语言的 `register` 形式允许语言包为另一个插件拥有的命名空间提供某一语言的词典。

## Decision

仓库以 Client 语言包形式提供 `@deepseek-ai/dsh-client-locale-uk`，由默认的 `@deepseek-ai/dsh-web-app` 组合包行挂载在 locale 插件旁。

- `apply` 通过 `ctx.locale.addLanguage` 注册 `{ id: 'uk', label: 'Українська', fallback: 'en' }`，然后为每个随附命名空间调用 `ctx.locale.register(namespace, 'uk', dictionary)` 注册一份 `uk` 词典。两者都是 effect，因此卸载本包只会移除它添加的内容。
- `src/client/dictionaries.ts` 将每个 locale 命名空间映射到 `src/client/locales/` 下的翻译模块。本包覆盖 Client 源码注册的全部 79 个命名空间，包括 `common` 和 `settings.locale` 命名空间以及可选的实验性 Client 面板，共 4,295 个 key。
- 词典按相同顺序保留所属包的英文 key。若本包缺少某个 key，locale 服务会沿回退链解析到英语，因此更新后的上游文案会以英文显示，而不是裸 key。
- `scripts/extract-english.cjs` 使用 TypeScript 解析器从包源码中提取英文源（解析命名空间常量、导入、再导出、展开、字符串拼接和 `Array.join()`）。一致性测试逐项比较每份跟踪的乌克兰语词典与该源：命名空间、key、key 顺序、占位符和字面 token，并要求命令 token 保持原样。
- 包展示元数据与 UI 词典彼此独立：插件卡片和设置行通过 Host 读取每个包 `locale/*.json` 中的 `meta`。因此本次变更向提供展示元数据的包（301 个目录）添加 `locale/uk.json`，而不是尝试从 Client 语言包注册它。
- 本包不进入 `SHIPPED_LOCALE_IDS`。内置词典保留其八种语言，元数据门禁保留现有语言集，新语言是一个附加的可选行。本包自身的 `locale/*.json` 携带第一方包发布的九种展示语言。

浏览器语言顺序包含 `uk` 或 `uk-UA` 时以乌克兰语打开；在「设置 → 通用」中的选择会持久化为 `locale.preference`，`<html lang>` 跟随当前语言。

## Alternatives considered

**把乌克兰语加入内置语言集。** 这是现有随附语言采用的形态，会让乌克兰语出现在包括选择器内置集合和门禁在内的所有界面。它落选，因为这会把同样的变更压进约 96 处词典注册、包含约 300 个 `uk.json` 文件的随附元数据门禁集、`apps/desktop/src/locale.ts` 和 NSIS 安装程序语言集，而且全部放在一个无法增量评估的 diff 中。待语言包术语稳定后，这仍是一种可能的后续升级路径。

**只翻译 common 和 settings 命名空间。** 这是小得多的改动，但会让聊天、插件和设置界面停留在英文，无法构成可用的乌克兰语界面。已否决。

**把语言包作为外部插件发布而不是工作区包。** 默认组合将不会包含它，直到用户安装；组装浏览器的 locale 测试也无法覆盖它。工作区包与应用版本保持同步并随默认组合挂载。已否决。

**让插件元数据保留英文。** 插件页面会在乌克兰语页面外壳中显示英文卡片标题和描述。元数据文件很小并沿用本包的术语，因此随同一次变更发布。

## Consequences

- 默认 Client 组合新增一行及其词典：约 348 KB（gzip 后 77 KB）的 Client 产物。
- 今后若把乌克兰语升级为内置语言，必须先移除本语言包，因为内置 `uk` 注册会与本包对同一 id 的语言注册冲突。
- 新的上游文案会作为缺口被一致性测试发现，而不会破坏页面：在受影响词典更新前，它显示英文。
- 桌面窗口外壳、原生菜单和安装程序仍跟随桌面 locale；本包只本地化 Web 界面。
- 提取器只是测试期工具：它解析包源码而从不执行它们，因此不会给 Client 包增加运行时依赖。
