---
description: "Web Chat/Harness tabs for the dsh web client: the Chat tab embeds the DeepSeek chat site in a Desktop guest, Harness keeps the full product, and the two tabs share no data."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-work-mode

English | [中文](README.zh.md)

## Summary

The window's top strip carries a two-segment switch between Chat and Harness. Chat embeds `https://chat.deepseek.com/` in a frame-wide layer and asks the frame for minimal chrome; Harness restores the full shell. The embedded page is the site's own product: the reader signs in there and sees that account's history, and this package never sends it harness Sessions, tokens, or model calls. Desktop mounts an Electron `<webview>` in a persistent partition; other clients show the site's address instead. The last selection is restored on the next launch.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Use this package

<a id="use-this-package"></a>

Chat is the only mode that hides chrome: the plugin calls `ctx.layout.setChrome('minimal')`, the frame renders the centre column alone, and the layer covers that column with the guest. Harness calls `setChrome('full')` and the previous sidebar, panels, and selected panel come back untouched. The plugin stores the selection in the persisted `dsh.work-mode.v1` store; first launch starts in Harness.

The guest is attached once and never moved or unmounted while the plugin lives: switching to Harness hides the layer with `opacity` and `inert` (not `display: none`, which detaches the guest and reloads it), so an open chat, its scroll position, a typed draft, and a running answer survive the switch. The Desktop shell keeps the guest's renderer unthrottled while it is hidden for the same reason. The site loads on the first Chat visit, not at application start.

The Chat tab loads what the profile configures: `url` (default `https://chat.deepseek.com/`) and `allowedOrigins` (default the site's own origin). Any other main-frame target opens in the system browser, and the window's `window.open` calls are handed there as well. A navigation the allowlist refuses during development is logged as `[chat-guest] blocked navigation <url>` so a profile can add the origin the site actually needs. When the guest fails to load or its renderer crashes, the tab shows a localized card with **Retry** and **Open in browser**: Retry reloads the same guest after a failed load and rebuilds it only after a renderer crash.

## Understand the implementation

<a id="understand-the-implementation"></a>

`apply` registers the dictionaries, maps the persisted mode onto the frame chrome, and contributes one `shell.overlay` entry, so the switch and the guest live in the frame-wide layer that stays mounted across panel switches. The overlay entry renders the capsule in the window's top strip — the caption band on Desktop, a floating inset elsewhere — and the guest page below it.

On Desktop the guest is a `<webview>` configured with a main-issued lease and the persistent partition `persist:dsh-chat`. `apps/desktop` validates that lease in `will-attach-webview`, forces sandbox, context isolation, no Node, no preload, no nested webview, and no dialogs, and installs the session policy: only `clipboard-sanitized-write` is granted so the site's copy control works without giving it clipboard reads; camera, microphone, screen capture, geolocation, and notifications are denied, downloads are cancelled, and the site host cannot reach the application Host. The shell never injects credentials or headers into the page and never reads its DOM, cookies, or storage.

Without the Desktop bridge the plugin renders the Web fallback screen instead: the site refuses to be embedded in a plain frame, so the tab offers its address in a new browser tab rather than pretending to embed it.

## Further Exploration

<a id="further-exploration"></a>

- [ui-layout](../ui-layout/README.md) — the frame, `shell.overlay`, and the `ChromeMode` the switch drives.
- [ui-sidebar-browser](../ui-sidebar-browser/README.md) — the right-Sidebar browser this guest follows for lease and DOM lifecycle.
- [Desktop application](../../../apps/desktop/README.md) — the guest checks, the persistent partition, and the permission policy.

## Model Experience

None, as this browser package registers no model-facing input and changes no prompt, tool schema, or request.

#### KV Cache effect

None; the switch changes frame chrome and the embedded page never enters a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Google sign-in does not complete inside an embedded browser, because Google blocks embedded user agents; signing in with the account's email or phone does. The plugin never works around that refusal.
- Only main-frame navigations are policy-checked; the site's own subresources are not proxied or filtered beyond the application-Host guard.
- A site-rendered error page (an HTTP 5xx document) looks like a normal page to the guest; the failure card covers network failures, cancelled loads, and renderer crashes only.
- The Web build cannot embed the site; the fallback screen is the whole Chat tab there.
- Downloads from the chat page are cancelled; the site's copy and attachment flows do not need them.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintenance context — click to expand</summary>

None.

</details>

The mode is frame chrome, so another feature may also drive `ctx.layout.setChrome`; only this package maps the Chat/Harness product modes onto it.
