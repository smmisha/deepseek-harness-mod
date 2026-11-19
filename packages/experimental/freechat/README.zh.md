---
description: "基于单会话免费网页聊天的本地 OpenAI 兼容代理：持久的本地会话记忆、自动会话轮换，以及把文本形式的调用还原为原生 tool_calls 的提示级工具桥。"
kind: "package-reference"
---

# @deepseek-ai/dsh-freechat

[English](README.md) | 中文

## 概述

免费的 DeepSeek 网页聊天为已登录账号一次只提供一个会话，没有 API，也没有 harness 可以依赖的记忆。本包把该页面变成一条本地的、OpenAI 兼容的模型路由。

它做四件事：

1. **代理。** `POST /v1/chat/completions` 在 `127.0.0.1` 上接受 OpenAI 协议，包括 server-sent events。任何 OpenAI 客户端都可以指向它；harness 通过自己的 `openai-completions` 提供方路由访问它，因此 agent 循环、会话日志与工具管线都不受影响。
2. **记忆。** 每个已提交的轮次都会追加到所配置存储目录下、按会话划分的 JSONL 文件中。网页聊天不保存 harness 信任的历史；本包负责保存。
3. **轮换。** 每轮之前，规划器把调用方历史与当前网页会话已收到的内容做差异比较，只发送增量；出现分叉、消息上限或 token 上限时，会打开新的网页会话，并把压缩后的前导内容重放进去。
4. **工具桥。** 免费页面无法输出 `tool_calls`。改为把提供的 OpenAI 工具 schema 写进系统约定，由模型以 `<tool_call name="…">{…}</tool_call>` 块作答，流解析器再把它们转回原生的 `tool_calls` 增量。harness 随后通过 `ctx.tools` 执行它们——包括 MCP 服务器注册的每一个工具。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [进一步探索](#further-exploration)
- [开发备注](#dev-note)

<a id="use-this-package"></a>

## 使用本包

在 profile 上挂载该插件，并让一条提供方路由指向它启动的代理：

```yaml
- insert:
    - id: freechat
      name: '@deepseek-ai/dsh-freechat'
      config:
        server: { host: 127.0.0.1, port: 8788, token: local-token }
        transport: { kind: cdp, pollMs: 300, idlePolls: 3, readyTimeoutMs: 60000 }
        cdp: { port: 9222, url: https://chat.deepseek.com/ }
        storage: { directory: .freechat }
        connectors: { file: mcp.servers.json }

    - id: llm-pi-ai-free-web
      name: '@deepseek-ai/dsh-llm-pi-ai'
      config:
        providers:
          free-web:
            api: openai-completions
            baseURL: http://127.0.0.1:8788/v1
            apiKeyEnv: FREECHAT_TOKEN
            models:
              - id: deepseek-web-chat
                name: DeepSeek Web Chat
                contextWindow: 128000
                maxTokens: 8192
```

本包中的 `cordis.patch.example.yml` 是该 patch 的完整版本。`FREECHAT_TOKEN` 必须与 `server.token` 取值相同；对其他凭据，代理一律返回 `401`。

端点：

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/v1/models` | 模型注册表中可用的路由。 |
| `POST` | `/v1/chat/completions` | 流式或一次性补全。 |
| `POST` | `/admin/threads/:id/reset` | 关闭某个会话的当前网页会话；下一轮会轮换。 |
| `GET` | `/admin/state` | 供脚本与其他本地客户端读取的模型描述与会话行（代次、轮次、活跃标记）。 |
| `GET` | `/healthz` | 存活检查。 |

轮换预算为 `context.maxMessages`、`context.maxTokens`、`context.replayTail` 与 `context.maxCharsPerMessage`。请求的模型若不在注册表中，会以 `400 MODEL_NOT_FOUND` 拒绝，而不会转发给账号无法使用的路由。

### 插件页卡片

`src/client/` 是浏览器端：插件页上的一张 `plugins.item` 卡片，其一句话说明介绍该桥接，其页面列出路由与每个会话一行（代次、轮次、最近更新、活跃标记），并可关闭某个会话的当前网页会话。页面通过 Host Remote `freechatAdmin`（`state` 与 `resetThread`）访问桥接，它直接读取内核与模型注册表，因此代理的 bearer token 留在 Host 上，浏览器从不访问 loopback 源。

该卡片具备 `dsh.client` 清单、`./client` 导出、`tsdown.client.ts` 打包、生成的 `./typert` 与 `./remote` 接口，以及 `tsconfig.client.json` 接口。它有意不在随附的 Web 组合中：默认产品隔离禁止在 `packages/bundle/web-app` 中放入实验性包。加载本包的 profile 需自行添加该行；没有卡片时，代理及其管理路由同样可用。

### 浏览器传输

在桌面外壳之外，可用的路径是 `transport.kind: cdp`。用持久化 profile 和调试端口启动 Chromium，然后登录聊天一次：

```text
chrome.exe --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir=<persistent-dir> https://chat.deepseek.com/
```

`CdpGuestPort` 附加到一个专用标签页并驱动现有的 DOM 传输；它从不读取 cookie 或 token。页面仍停留在登录界面时，一轮会以可操作的错误失败，而不会一直挂起。外壳提供 `freeChatGuestPort` 时仍可使用 `electron-guest`；`loopback` 不需要浏览器。

<a id="understand-the-implementation"></a>

## 理解实现

一个请求依次经过五个阶段：

1. **规范化。** `kernel/messages.ts` 把每条线上消息投影为确定的文本加指纹。工具结果变为 `<tool_result>` 块；助手的工具调用以 `<tool_call>` 文本重放。
2. **规划。** `kernel/context-window.ts` 把调用方指纹与 `ThreadState.synced` 比较。共同前缀短于已同步历史，说明调用方改写、压缩或切换了对话，计划会轮换；否则把增量发送给当前会话，并丢弃助手的回声，因为网页聊天已经保存了它们。
3. **驱动。** `kernel/kernel.ts` 在 `SessionLock` 下为每个会话持有一个当前 `WebChatSession`，因此同一账号的两个 harness 请求不会交错。传输失败会丢弃该会话；下一轮从记忆恢复，而不是继续一个已经不存在的页面。
4. **解析。** `tools/tool-parser.ts` 从回答中流式输出文本与完整的调用，并保留任何仍可能成为标签的后缀。
5. **提交。** 该轮追加到 `threads/<id>.jsonl` 与索引，流以一个 `finish` 帧结束；回答调用了工具时，其 `reason` 为 `tool_calls`。

`transport/loopback.ts` 是供测试以及只使用代理的部署所用的脚本化传输。`transport/electron-guest.ts` 通过 `GuestPort` 驱动桌面端已登录的 `<webview>`：填写输入框、提交，并轮询渲染出的回答，直到停止控件消失。该传输从不读取 cookie、存储或 token。

`connectors/registry.ts` 解析 `mcpServers` 文档，校验每个条目，并把两种形式规范化为 harness MCP 管理器使用的扁平条目：`command` 选择 stdio 传输，`url` 选择可流式 HTTP。

<a id="model-experience"></a>

## 模型体验

模型依次看到：调用方的系统约定、工具协议与目录、会话被替换时的轮换上下文前导、最近的对话，以及它所做调用的 `<tool_result>` 块。任何 UI、传输或桥接词汇都不会进入提示。

工具目录是本包唯一无条件编写的提示部分；调用方不提供工具时它为空——普通聊天请求与没有桥接时的请求逐字节相同。

#### KV Cache 影响

一次轮换会丢弃上游前缀缓存：替代的对话从新的前导开始。复用的会话只发送增量，从而保持上游缓存完好。本包不会在当前会话内重排提示，因此缓存命中恰好等于“调用方历史延伸了已投递的历史”。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与延期工作

- **桌面 guest 端口尚无提供方。** `transport.kind: electron-guest` 仍要求外壳发布 `freeChatGuestPort`。可用的浏览器路径是 `cdp`；由外壳拥有的端口仍是 `apps/desktop` 中的独立集成任务。
- **需要手动登录一次。** CDP 附加到持久化的 Chromium profile 并驱动页面，但无法完成认证。账号登录前，各轮会以可操作的消息失败。默认选择器按已登录的英文/俄文网页聊天校准；站点重新部署并更改哈希类名时需要在此重新校准。
- **存储是 JSONL，而非 SQLite。** `ThreadStore` 为每个会话拥有一个只追加文件，外加 `index.json`。该接口的存在使 `node:sqlite` 或 `dsh-storage-sqlite` 实现可以在不改动内核的情况下替换它。
- **假定只有一个网页账号。** 锁按会话而非按账号串行化，因此两个会话共用同一个已登录页面。多账号路由不在范围内。
- **工具参数原样转发。** 格式错误的 JSON 主体会原样到达 harness 解析器，而不会被修复，因为修复会改变模型所说的内容。
- **没有真实组合测试。** 覆盖由单元测试加进程内代理测试组成；面向产品可见插件所要求的、由 Loader 驱动的 `cordis.yml` 组合测试尚未编写。
- **连接器接入止步于文档。** 条目会被校验与规范化，但把它们写入运行中 MCP 管理器的设置，延期到连接器管理界面完成。

<a id="further-exploration"></a>

## 进一步探索

- [`@deepseek-ai/dsh-llm-pi-ai`](../../llm/llm-pi-ai/README.zh.md) —— 指向本代理的 `openai-completions` 提供方路由。
- [`@deepseek-ai/dsh-mcp-manager`](../../mcp/mcp-manager/README.zh.md) —— 使用规范化连接器条目的服务群。
- [`@deepseek-ai/dsh-client-ui-work-mode`](../../client/ui-work-mode/README.zh.md) —— 已嵌入已登录聊天页面的桌面 guest。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
