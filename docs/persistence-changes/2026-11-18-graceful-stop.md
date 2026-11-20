---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-18-graceful-stop

English | [中文](2026-11-18-graceful-stop.zh.md)

## Summary

Adds the `stopped` turn-ending reason for a graceful stop.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing logs remain valid, and new readers handle every historical reason. An older reader meeting `{ kind: 'stopped' }` treats it as the unknown merge-extensible reason the union already permits: every first-party switch documents a default, session-query omits unknown endings from searchable text, ACP maps unknown live endings to `end_turn`, and the transcript's turn-error node produces no failure row. The new kind is emitted only by a live graceful stop, so no reader can interpret it as an error or success it did not observe. No header version change is needed: the unknown-kind default is the safe interpretation for this merge-extensible union, and same-version readers never run a migration over these logs.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/core/agent-loop/tests/graceful-stop.spec.ts: 10 tests passed. pnpm run typecheck: host and client gates passed.

<a id="dev-note"></a>
## Dev Note

None.
