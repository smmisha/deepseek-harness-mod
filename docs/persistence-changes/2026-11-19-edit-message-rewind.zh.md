---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-19-edit-message-rewind

[English](2026-11-19-edit-message-rewind.md) | 中文

## 概述

为撤回被编辑轮次及其后所有模型可见消息的空用户消息新增 rewind 消息来源。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-19-edit-message-rewind
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-27-retry-control-input"
    after: "85af22ef5a7f6d64a3513ced41822d06e5f51d0310d6daa29db62a4390040fcf"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-27-retry-control-input"
    after: "9013ee7727e9f2c60ed3ef4948053470e91a83a6d1ba9806582e4258ab40be74"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-27-retry-control-input"
    after: "1838ad62586cc38a15c0a2438a484e9c3b370a9df1fc8d20c239137dcca802dc"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-27-retry-control-input"
    after: "4899f77dc280e6e338a3d7fed8801b7a4525b22903a6522a9d6e7d7e2c97e7d1"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

rewind 来源是现有空 UserMessage 表示上由生产方拥有的元数据，撤回本身是对更早节点的现有 surface 替换。更新后的读取方派生相同的模型历史，并在 Chat 中隐藏被撤回的范围。旧读取方按已有规则折叠该替换，因此模型可见前缀不变；它们可能把空撤回作为空用户轮次发送、显示被撤回的轮次并显示空的上下文行，这些只影响展示。现有事件判别字段和当前 Session 版本保持不变；不引入新的必需事件。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/api/session-controller：1146 个测试通过，包括 edit-message.host.spec.ts（8 个测试）以及 remote-access.host.spec.ts 中的访客编辑用例；commands.ts 的语句、分支、函数和行覆盖率均为 100%。pnpm exec vitest run packages/core/session packages/core/agent-loop：1156 个测试通过。Conversation 撤回测试（3 个）、基于真实 Chat 定义的 Chat 撤回测试（1 个）和 Chat 行编辑测试（17 个）均通过。

<a id="dev-note"></a>
## 开发备注

无。
