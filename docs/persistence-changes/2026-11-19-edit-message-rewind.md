---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-19-edit-message-rewind

English | [中文](2026-11-19-edit-message-rewind.zh.md)

## Summary

Add the rewind message source for the empty user message that retracts an edited Turn and every later model-visible message.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

The rewind source is producer-owned metadata on the existing empty UserMessage representation, and the retraction itself is an existing surface replacement over earlier nodes. Updated readers derive the same model history and hide the retracted span in Chat. Older readers fold the replacement with the rules they already have, so the model-visible prefix is unchanged; they may send the empty retraction as an empty user turn, show the retracted Turns, and show an empty context row, which is presentation only. Existing event discriminators and the current Session version remain unchanged; no new required event is introduced.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/api/session-controller: 1146 tests passed, including edit-message.host.spec.ts (8 tests) and the guest-caller edit case in remote-access.host.spec.ts; commands.ts has 100% statements, branches, functions, and lines. pnpm exec vitest run packages/core/session packages/core/agent-loop: 1156 tests passed. The Conversation retraction spec (3 tests), the Chat retraction spec over the real Chat definitions (1 test), and the Chat row editing spec (17 tests) passed.

<a id="dev-note"></a>
## Dev Note

None.
