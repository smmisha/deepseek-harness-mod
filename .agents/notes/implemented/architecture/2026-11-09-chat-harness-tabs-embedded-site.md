# Agent Note: Chat and Harness tabs with the embedded DeepSeek chat

Status: implemented

English | [中文](2026-11-09-chat-harness-tabs-embedded-site.zh.md)

## Problem

The product wanted two top-level tabs in the window: **Chat**, which is the DeepSeek chat site itself opened inside the app, where the reader signs into their own account and sees that account's history, and **Harness**, today's application unchanged. The tabs share no data: the harness never sends the site Sessions, tokens, or model calls, and the site never feeds the harness.

The site cannot be re-drawn as a harness view: it is another product with its own account and history. The only faithful Chat tab is the site in a guest browsing context. The Web build has no such context and the site refuses ordinary framing, so there the tab must offer the site instead of faking it.

Constraints taken as fixed: never inject credentials, headers, or scripts into the page; never read its DOM, cookies, or storage; never weaken the site's protections (no `X-Frame-Options` stripping, no proxying, no user-agent spoofing); do not reuse the side-browser's temporary per-workspace partitions, whose cookies die with the process; keep every harness behavior except the place for the switch.

## Decision

The mode is frame chrome, not a panel. `ui-layout` gained `ChromeMode` (`full` | `minimal`) in its root store, `ctx.layout.chrome`, and `ctx.layout.setChrome`; the frame renders the centre column alone in `minimal` and keeps every width, right-panel, and panel preference for the return. `ui-work-mode` maps Chat onto `minimal` and Harness onto `full`, and owns the tab state in the persisted `dsh.work-mode.v1` store (first run: Harness).

The switch and the guest live in one `shell.overlay` entry, the frame-wide, always-mounted layer. The capsule rides the window's top strip (`--dsh-frame-top-clearance`: the Windows caption band, macOS clearance, a floating inset elsewhere), so it is visible on every harness panel and never overlaps the site. The guest page starts below that strip.

The guest stays mounted while Harness is selected: the layer flips `opacity`, `pointer-events`, and `inert`, never `display: none` and never a DOM move, because either detaches an Electron `<webview>` and reloads the page. The site loads on the first Chat visit, not at application start. The Desktop guest additionally runs with `backgroundThrottling: false` so a running answer survives the switch.

On Desktop the guest is a `<webview>` attachment in the persistent `persist:dsh-chat` partition, approved by a main-issued lease through the existing `will-attach-webview` check: owner match, single attachment, partition match. That check was extended, not bypassed — the side-browser lease still owns its workspace partitions and its any-HTTP navigation, while the chat lease carries a main-frame allowlist from the plugin configuration (`url`, `allowedOrigins`; defaults to the site and its origin). Disallowed main-frame targets and every `window.open` go to the system browser, in packaged builds as well; refused navigations are logged as `[chat-guest] blocked navigation` only while unpackaged. The chat session grants only `clipboard-sanitized-write` (the site's copy control), denies every other permission and download, and keeps the existing application-Host request guard. A failed page load keeps its failure card until the next load starts, and **Retry** reloads the same guest; only a gone renderer retires the lease and attaches a fresh guest. Dragging a page does not navigate it, and nested webviews stay refused.

Without the Desktop bridge the tab renders a short fallback screen with the site's address, because pretending to embed it would fail against the site's own frame policy.

## Alternatives considered

- **A harness Session with a tool-free agent preset** (the previous attempt) — it is still our chat and our model, not the site the reader asked for.
- **`WebContentsView`** — a native layer above the page would cover the application's menus, dialogs, and the mode capsule, and needs renderer-driven bounds on every layout change.
- **Reusing the side-browser's temporary partitions** — cookies would not survive a restart, and sign-in is a requirement.
- **Covering the harness with an opaque layer instead of minimal chrome** — the harness stays focusable and tabbable behind the cover.
- **An iframe in the Web build** — the site's frame policy is not observable from every network and the refusal is silent; an explicit fallback is honest.

## Consequences

- Signing in with Google does not complete inside an embedded browser (Google blocks embedded user agents); email and phone sign-in do. No workaround is attempted.
- A site-rendered error page is indistinguishable from a normal page; the failure card covers network failures, cancelled loads, and renderer crashes.
- Google/third-party links leave the guest; the account session stays in the guest's own partition.
