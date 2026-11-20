---
description: "Token usage per day and model read from the Session logs, rolling five-hour, weekly, and monthly token budgets per provider that warn without blocking, and the DeepSeek account balance."
kind: "package-reference"
---

# @deepseek-ai/dsh-usage

English | [中文](README.zh.md)

## Summary

The harness already records every billed model call in the Session logs, but nothing sums them. This package does, and adds a Usage section to Settings.

It shows three things:

1. **Balance.** The DeepSeek account balance from the official `GET /user/balance` endpoint, read with the same credential the DeepSeek route uses. Other providers publish no balance API, so they show usage only.
2. **Budgets.** An optional token budget per provider for the last five hours, seven days, and thirty days. Budgets only warn: a bar turns yellow at 80% and red at 100%, and a notice appears once per crossed threshold. Requests are never blocked.
3. **Statistics.** Tokens per local day and model for the last 7 or 30 days, split into uncached input, cache hits, cache writes, and output, with call counts and totals.

Every number is an estimate taken from the logs, not the provider bill.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)

## Use this package

Mount the plugin on a profile:

```yaml
- insert:
    - id: usage
      name: '@deepseek-ai/dsh-usage'
      config:
        ledgerFile: usage-ledger.json
        deepseek: { apiKeyEnv: DEEPSEEK_API_KEY, baseURL: https://api.deepseek.com }
        limits:
          deepseek: { fiveHours: 2000000, month: 50000000 }
```

The row id must be `usage`: the Settings section reads and writes `limits` through the `usage` settings form. `ledgerFile` resolves against the profile directory. Without a DeepSeek key the balance card says so and the rest of the page works.

`limits` is keyed by provider route id and is a live Settings field: the page writes it without reloading the plugin, and a hand edit works the same way. A budget with no window set is dropped.

## Understand the implementation

The Host half has three parts:

1. **Fold.** `fold.ts` replays one raw Session log with the rules of token-meter's `tokenUsage` projection. `request/context` names the provider and model of the next call. Each assistant settlement contributes the last usage sample of its attempt, and a later sample of the same attempt replaces the earlier one. `llm/retry-started` opens a new attempt, so every billed retry counts on its own. Raw events are read, so turns a rewind retracted still count.
2. **Ledger.** `ledger.ts` keeps the folded calls per Session and reads only the events added since the last refresh. A Session that was not live at its last read is not read again. A fork's inherited prefix only primes the fold, so the parent's calls are never counted twice. The ledger is persisted atomically with owner-only permissions; a file of another version is read as empty and rebuilt.
3. **Remote.** `UsageService` exposes `view(since)` (quarter-hour rows since `since` plus rolling totals ending now) and `balance()` (cached for 60 seconds, 10-second timeout).

The browser half in `src/client/` registers a `settings.section` and a `shell.overlay` notice. `UsageController` sums quarter-hour rows into local days in the viewer's time zone, writes budgets through the settings form, and re-reads usage every five minutes while the app is open, so a crossed threshold is noticed without the section open.

## Known Limitations and Deferred Work

- **Estimates, not bills.** Tokens come from the usage the provider streamed back; an attempt that reported no usage is not counted. Budgets count all four buckets, cache hits included, although providers price them differently.
- **Balance is DeepSeek-only.** Other providers have no public balance endpoint.
- **Budgets warn only.** Blocking requests over a budget would need a hook in the request pipeline; it is out of scope.
- **Not in the shipped composition.** Default-product isolation keeps experimental packages out of `packages/bundle/web-app`; a profile adds the row itself.

## Further Exploration

- [`@deepseek-ai/dsh-session-query`](../../session-query/session-query/README.md) — the Session log reads the ledger is built on.
- [`@deepseek-ai/dsh-llm-deepseek`](../../llm/llm-deepseek/README.md) — the credential the balance read shares.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
