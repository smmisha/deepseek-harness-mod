---
description: "从 GitHub 仓库或导入的 .zip 下载技能，先预览再安装到 harness home 的 skills 文件夹并保持关闭状态，也可删除本应用安装的技能。"
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-install

[English](README.md) | 中文

## Summary

技能页的安装器。读者粘贴 `owner/repo`、GitHub 网址或 `npx skills add …` 命令，或者把 `.zip` 或文件夹拖到页面上。Host 解析来源，预览 `SKILL.md`、文件列表、来源，以及技能是否包含脚本；在读者确认之前不写任何文件。确认后的安装会把文件复制到 `~/.dsh/skills/<name>`，并把该技能记录为关闭状态，只有读者打开后它才会进入模型目录。

## Table of Contents

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

-----

## 使用此包

<a id="use-this-package"></a>

它作为普通 Host 行挂在 `skill-sources` 旁边；其 profile 条目 id 为 `skill-install`：

```yaml
- id: skill-install
  name: '@deepseek-ai/dsh-skill-install'
```

该行注册 `skillInstall` Remote 命名空间，并在没有挂载 profile 时保持关闭，因为安装要把开关写进 profile 的设置文档。

所有随部署而变的选项都是配置：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `installRoot` | harness home 的 `skills` 文件夹（`~/.dsh/skills`） | 安装技能写入的文件夹；必须是绝对路径 |
| `catalogs` | GitHub、Anthropic skills、skills.sh、SkillsMP、skills-hub.ai | 目录行，形如 `{ id, title, homepage, searchable, kind, repository? }` |
| `allowedHosts` | `api.github.com`、`raw.githubusercontent.com` | 出站请求可以访问的主机，精确匹配或以 `*.` 匹配子域 |
| `requestTimeoutMs` | `15000` | 单个请求允许的毫秒数 |
| `maxRedirects` | `3` | 单个请求可跟随的重定向跳数；每一跳都会重新校验 |
| `maxResponseBytes` | `8388608` | 可接受的响应体上限（字节） |
| `maxUploadBytes` | `16777216` | 一次拖入或选择文件可携带的上限（字节） |
| `maxArchiveEntries` | `2000` | 一个压缩包可声明的条目上限 |
| `maxUncompressedBytes` | `67108864` | 一次导入可声明的总解压大小上限 |
| `maxFiles` | `200` | 单个技能文件夹可包含的文件上限 |
| `maxBundles` | `20` | 一个压缩包或拖入文件夹可包含的技能上限 |
| `maxPreviews` | `16` | 同时保持可安装的预览上限 |
| `previewTtlMs` | `600000` | 一次预览可保持可安装的时长 |

`kind` 为 `github` 的目录接受读者输入的仓库文本；`recommended` 列出固定仓库；`link` 只在浏览器中打开，Host 从不抓取。本版本没有 skills.sh、SkillsMP 或 skills-hub.ai 的 API 客户端，因此这些行只作为链接条目，并在已知限制中列出。

### 许可与来源

技能保留其所在仓库或压缩包自带的许可。安装会复制技能文件夹里的每个文件，包括来源中与 `SKILL.md` 相邻的 `LICENSE.txt`，并把来源写入已安装的 frontmatter：

```yaml
metadata:
  repository: https://github.com/anthropics/skills
  commit: 2c5958ecac7cee2b583967a2c4981d0f4a75c579
  installedAt: 2026-11-17T10:00:00.000Z
```

`anthropics/skills` 的文件夹**逐个**采用 Apache-2.0，而且并非每个文件夹都附带许可文件：`skills/pdf/LICENSE.txt` 及其同类存在，`skills/doc-coach…` 与 `template/` 则没有。把该仓库作为精选目录提供的部署必须把每个文件夹的 `LICENSE.txt` 与技能一起复制，并且不得把没有许可的文件夹标为推荐；安装器只复制文件夹里已有的内容，不会自行生成许可。

## 理解实现

<a id="understand-the-implementation"></a>

`SkillInstallController` 是插件入口：它拥有 `skillInstall` Remote 命名空间——`catalogs`、`repository`、`previewRepository`、`previewArchive`、`previewFolder`、`installSkill` 和 `removeSkill`——并把每个 `SkillInstallError` 翻译成该命名空间的 `skill-install/*` 代码。两个写入方法带上所操作的技能，因为 Client gateway 保留了裸名 `install` 与 `remove`。`SkillInstaller` 是它背后的服务。

一次安装是两个文件夹上的一次事务。文件先写入 `<harness home>/.skill-install-<uuid>`，技能的开关会在文件夹出现**之前**记录为关闭（写入 `ctx.skillSources`），然后才把暂存文件夹重命名到 `skills/<name>`；替换会先把旧文件夹改名移开，发布失败时再恢复。因此失败后 skills 文件夹与之前完全一样。

压缩包在解压任何一个字节之前先读取其中央目录：条目数量、每个条目名、声明大小和 Unix 模式都先检查，因此 `..` 路径、绝对路径、盘符、反斜杠、符号链接、设备条目、加密条目、不支持的压缩方法、条目过多或总大小超限都会在解压前被拒绝。每个被接受的条目还必须精确解压为目录所声明的大小。

每个请求都先经过 `validateRequestUrl`（仅 HTTPS、不含内嵌凭据、主机在允许列表内）和 `HttpClient`：后者手动跟随重定向以便用同样的规则校验每一跳、按超时约束每一跳并限制响应体。下载内容中不会执行任何东西：没有脚本、没有 postinstall，除技能自己声明的 `SKILL.md` frontmatter 外也不做任何 YAML 解析。

## 进一步探索

<a id="further-exploration"></a>

- [skill-sources](../skill-sources/README.zh.md) —— 安装写入的开关和读者添加的文件夹。
- [skill-filesystem](../skill-filesystem/README.zh.md) —— 发现 `user-dsh` 下已安装技能的 provider。
- [ui-skills](../../client/ui-skills/README.zh.md) —— 负责预览、确认和删除的页面。

## 模型体验

<a id="model-experience"></a>

### 已安装技能

<a id="installed-skills"></a>

#### 模型看到什么

读者预览或安装期间没有影响：此包不注册任何工具、提示段或 schema 输入。已安装技能只通过 `user-dsh` 来源的目录进入模型，而且只有读者打开之后才会进入；安装记录、来源网址、提交和压缩包名称都留在 Host 上，从不进入请求。

#### Token 影响

预览或安装期间请求不变。打开已安装技能会让下一个请求携带的目录多出该技能的名称与描述，与页面上的开关完全一致。

#### KV Cache 影响

<a id="kv-cache-effect"></a>

预览、安装和删除都没有影响。目录增加或减少一个已安装技能时会追加替换目录，因此请求中更早的前缀仍然留在缓存中。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **没有 skills.sh、SkillsMP 或 skills-hub.ai 的 API 客户端。** 审计允许使用它们（skills.sh 仅限链接加仓库粘贴），但本版本把它们作为 `kind: 'link'` 目录行提供：页面在浏览器中打开站点，Host 从不抓取。后续版本会在同一份带类型的 Config 行后加入搜索客户端。
- **无许可的文件夹按原样复制。** 安装器记录来源，并在存在 `LICENSE.txt` 时复制它；它无法补上仓库本身没有的许可。
- **仅支持未认证的 GitHub。** 安装器解析仓库默认分支的头部和文件树，并从 `raw.githubusercontent.com` 读取文件；它不发送令牌，因此 GitHub 每小时 60 次的限制按地址计算，被限流时会以“等一小时”的动作报告。
- **预览解析会重复。** 确认仓库预览会重新解析文件夹列表，因为预览缓存保存的是计划写入的文件而不是第二份列表。
- **替换不会保留旧技能除名称以外的开关。** 替换 `pdf` 会保留 `pdf` 的开关条目，因此原本开启的技能在替换后仍然开启。
- **一个名称对应一个文件夹。** frontmatter 名称不是 kebab-case 的技能会以由它派生的 slug 安装，因此安装名可能与声明名不同。
