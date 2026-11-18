---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-18-graceful-stop

[English](2026-11-18-graceful-stop.md) | 中文

## 概述

为优雅停止新增 `stopped` 轮次结束原因。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-18-graceful-stop
baseline: false
changes:
  - root: "event:turn/end"
    previous: "2026-09-16-session-format-v4"
    after: "4424d8c4d0609e3c5d541831c074642cb6489288fa7c564fa715b9ceb83b8a5e"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有日志保持有效，新读取方也能处理全部历史原因。旧读取方遇到 `{ kind: 'stopped' }` 时按该可合并扩展联合类型已有的未知原因处理：第一方每个 switch 都有文档化的 default，session-query 不把未知结束原因纳入可搜索文本，ACP 把未知的实时结束映射为 `end_turn`，transcript 的 turn-error 节点不产生失败行。新原因只由实时优雅停止产生，因此任何读取方都不会把它误读为未观察到的错误或成功。无需提升 header 版本：未知原因的 default 已经是该可合并扩展联合类型的安全解释，同版本读取方不会对这些日志执行迁移。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/core/agent-loop/tests/graceful-stop.spec.ts：9 个测试通过。pnpm run typecheck：host 与 client 门禁通过。

<a id="dev-note"></a>
## 开发备注

无。
