---
description: "Local OpenAI-compatible proxy over a single-session free web chat: durable local thread memory, automatic session rotation, and a prompt-level tool bridge that turns text-emitted calls back into native tool_calls."
kind: "package-reference"
---

# @deepseek-ai/dsh-freechat

English | [中文](README.zh.md)

## Summary

The free DeepSeek web chat gives a signed-in account one conversation at a time, no API, and no memory the harness can rely on. This package turns that page into a local, OpenAI-compatible model route.

It does four things:

1. **Proxy.** `POST /v1/chat/completions` accepts the OpenAI protocol, including server-sent events, on `127.0.0.1`. Any OpenAI client can target it; the harness reaches it through its own `openai-completions` provider route, so the agent loop, the session log, and the tool pipeline are untouched.
2. **Memory.** Every committed turn is appended to a JSONL file per thread under the configured storage directory. The web chat holds no history the harness trusts; this package does.
3. **Rotation.** Before each turn the planner diffs the caller history against what the live web session already received. It sends only the delta; a divergence, a message cap, or a token cap opens a new web conversation and replays a compacted preamble into it.
4. **Tool bridge.** The free page cannot emit `tool_calls`. The offered OpenAI tool schemas are rendered into the system contract instead, and the model answers with `<tool_call name="…">{…}</tool_call>` blocks, which the stream parser converts back into native `tool_calls` deltas. The harness then executes them through `ctx.tools` — including every tool an MCP server registered.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)

## Use this package

Mount the plugin on a profile and point a provider route at the proxy it starts:

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

`cordis.patch.example.yml` in this package is the complete version of that patch. `FREECHAT_TOKEN` must hold the same value as `server.token`; the proxy answers `401` for any other credential.

Endpoints:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/models` | Playable routes from the model registry. |
| `POST` | `/v1/chat/completions` | Streaming or one-shot completion. |
| `POST` | `/admin/threads/:id/reset` | Drop the live web conversation of one thread; the next turn rotates. |
| `GET` | `/admin/state` | Model descriptors and thread rows (generation, turns, live flag) for scripts and other local clients. |
| `GET` | `/healthz` | Liveness. |

The rotation budgets are `context.maxMessages`, `context.maxTokens`, `context.replayTail`, and `context.maxCharsPerMessage`. A request that names a model outside the registry is refused with `400 MODEL_NOT_FOUND` rather than forwarded to a route the account cannot play.

### Plugins page card

`src/client/` holds the browser half: a `plugins.item` card on the Plugins page whose one-liner describes the bridge and whose page lists the routes and one row per thread (generation, turns, last update, live flag) and resets one thread's live web conversation. The page reaches the bridge through the `freechatAdmin` Host Remote (`state` and `resetThread`), which reads the kernel and the model registry directly, so the proxy's bearer token stays on the Host and the browser never calls the loopback origin.

The card has its `dsh.client` manifest, `./client` export, `tsdown.client.ts` bundle, generated `./typert` and `./remote` faces, and `tsconfig.client.json` face. It is deliberately absent from the shipped Web composition: default-product isolation forbids experimental packages in `packages/bundle/web-app`. A profile that loads the package adds the row itself; the proxy and its admin routes work without the card.

### Browser transport

`transport.kind: cdp` is the working path outside the desktop shell. Start Chromium with a persistent profile and a debugging port, then sign in to the chat once:

```text
chrome.exe --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir=<persistent-dir> https://chat.deepseek.com/
```

`CdpGuestPort` attaches to a dedicated tab and drives the existing DOM transport; it never reads cookies or tokens. While the page is still on the sign-in screen, a turn fails with an actionable error instead of hanging. `electron-guest` remains available when a shell provides `freeChatGuestPort`; `loopback` needs no browser.

## Understand the implementation

One request travels through five stages:

1. **Normalize.** `kernel/messages.ts` projects each wire message onto deterministic text plus a fingerprint. Tool results become `<tool_result>` blocks; an assistant tool call is replayed as `<tool_call>` text.
2. **Plan.** `kernel/context-window.ts` compares the caller fingerprints against `ThreadState.synced`. A shared prefix shorter than the synced history means the caller rewrote, compacted, or switched conversations, and the plan rotates. Otherwise the delta is sent to the live session, with assistant echoes dropped because the web chat already holds them.
3. **Drive.** `kernel/kernel.ts` holds one live `WebChatSession` per thread under a `SessionLock`, so two harness requests for one account never interleave. A transport failure drops the session; the next turn restores from memory instead of continuing a page that is no longer there.
4. **Parse.** `tools/tool-parser.ts` streams text and complete calls out of the answer, holding back any suffix that could still become a tag.
5. **Commit.** The turn is appended to `threads/<id>.jsonl` and the index, and the stream ends with a `finish` frame whose `reason` is `tool_calls` when the answer called a tool.

`transport/loopback.ts` is a scripted transport for tests and for a deployment that only exercises the proxy. `transport/electron-guest.ts` drives the desktop's signed-in `<webview>` through a `GuestPort`: it fills the composer, submits, and polls the rendered answer until the stop control disappears. The transport never reads cookies, storage, or tokens.

`connectors/registry.ts` parses the `mcpServers` document, validates every entry, and normalizes both forms into the flat entry the harness MCP manager consumes: `command` selects the stdio transport, `url` selects streamable HTTP.

## Model Experience

The model sees, in this order: the caller's system contract, the tool protocol and catalog, the rotated-context preamble when a session was replaced, the recent conversation, and `<tool_result>` blocks for calls it made. No UI, transport, or bridge vocabulary reaches a prompt.

The tool catalog is the only prompt section this package authors unconditionally, and it is empty when the caller offers no tools — a plain chat request stays byte-identical to a request without the bridge.

#### KV Cache effect

A rotation discards the upstream prefix cache: the replacement conversation starts with a fresh preamble. A reused session sends only the delta, which keeps the upstream cache intact. The package performs no prompt reordering inside a live session, so a cache hit is exactly "the caller history extended the delivered history".

## Known Limitations and Deferred Work

- **The desktop guest port has no provider yet.** `transport.kind: electron-guest` still requires the shell to publish `freeChatGuestPort`. The working browser path is `cdp`; a shell-owned port remains a separate integration task in `apps/desktop`.
- **One manual sign-in is required.** CDP attaches to a persistent Chromium profile and drives the page, but it cannot authenticate. Until the account is signed in, turns fail with an actionable message. The default selectors are calibrated against the signed-in English/Russian web chat; a site redeploy with renamed hashed classes needs calibration here.
- **Storage is JSONL, not SQLite.** `ThreadStore` owns one append-only file per thread plus `index.json`. The interface exists so a `node:sqlite` or `dsh-storage-sqlite` implementation can replace it without touching the kernel.
- **One web account is assumed.** The lock serializes per thread, not per account, so two threads share the one signed-in page. Multi-account routing is out of scope.
- **Tool arguments are forwarded verbatim.** A malformed JSON body reaches the harness parser as-is instead of being repaired, because repair would change what the model said.
- **No real-composition test.** Coverage is unit tests plus an in-process proxy test; the Loader-driven `cordis.yml` composition test required for a product-visible plugin is not written.
- **Connector wiring stops at the document.** Entries are validated and normalized, but writing them into the running MCP manager's settings is deferred to the connector management surface.

## Further Exploration

- [`@deepseek-ai/dsh-llm-pi-ai`](../../llm/llm-pi-ai/README.md) — the `openai-completions` provider route that points at this proxy.
- [`@deepseek-ai/dsh-mcp-manager`](../../mcp/mcp-manager/README.md) — the fleet that consumes the normalized connector entries.
- [`@deepseek-ai/dsh-client-ui-work-mode`](../../client/ui-work-mode/README.md) — the desktop guest that already embeds the signed-in chat page.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
