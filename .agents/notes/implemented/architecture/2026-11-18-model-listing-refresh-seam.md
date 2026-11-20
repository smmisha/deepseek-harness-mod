# Agent Note: A namespace-keyed refresh offer reloads the model listing a route follows

Status: implemented

English | [中文](2026-11-18-model-listing-refresh-seam.zh.md)

## Problem

Both DeepSeek routes serve a `/models` listing from an in-memory cache in the Host adapter: the official route while its catalog is the built-in one ([official listing decision](2026-10-22-deepseek-official-model-listing.md)), the account route always ([account catalog](2026-09-24-deepseek-account-remote-model-catalog.md)). After first use the cache refreshes automatically every `modelsMaxAgeMs` (ten minutes by default), including while the page is idle, so a model published after a load reaches an open page only after the next background refresh, and a user who knows the list changed has no way to ask for it now. The page cannot reload the cache itself: the cache lives in the adapter, the browser never holds the endpoint credential, and the existing model-discovery seam interrogates a draft endpoint and returns candidates without touching a route's cache. The page's only other catalog action, **Restore defaults**, changes configuration.

## Decision

`LlmRuntime.registerListingRefresh(settingsNs, refresh)` offers one reload per settings namespace, registered and disposed with the owning fiber; an empty namespace fails with `INVALID_LISTING_REFRESH` and a second offer for the same namespace with `DUPLICATE_LISTING_REFRESH`. `LlmRuntime.refreshListing(settingsNs, provider, signal)` uses that offer, fails with `NO_LISTING_REFRESH` when none exists, and otherwise awaits the owner's reload. Neither method reads or writes settings or credentials. `@Remote('refreshListing')` exposes the operation to the Client and turns every refusal into `RemoteError` `llm/model-listing-refresh-rejected` carrying the settings namespace and route. `LlmConfigurableProvider.listingRefresh: true` declares the capability on a directory entry so a configuration surface can offer the action.

### The namespace is the key

The configurable-provider directory already gives every settings surface a profile's namespace, and each adapter plugin owns every route in its own namespace. Registering once per namespace lets the offer exist before a route does — a hand-declared pi-ai route is created later — and survive route replacement, while a namespace that serves several routes passes the route at call time. Keying by provider route would make a surface enumerate routes to find the reload owner and would drop the offer whenever that route was replaced. Model discovery uses the same key for the same reason, so a surface resolves both per-profile adapter operations from one directory entry.

### Each route owns its refusal diagnostics

The runtime cannot tell why a route follows no listing: its catalog may be customized, its endpoint may be a gateway, its account may be signed out, or its key may be missing. Each provider resolves its current configuration and refuses with the diagnostic that names the repair: `LISTING_NOT_FOLLOWED` on the official route while `models` differs from the built-in catalog or the Messages origin is not the official API, `MISSING_CREDENTIAL` without a usable key, `ACCOUNT_SIGN_IN_REQUIRED` on the account route without a token, and `LISTING_REFRESH_FAILED` when the load itself fails and the bundled catalog stays in use. A generic reload failure would flatten those states into one message that cannot say whether to restore defaults, fix the endpoint, store a key, or sign in. The Client renders the Host message inline under the row and adds no copy of its own.

### The row and the editor share one read

The Models row offers the action only when the directory declares `listingRefresh` and the user layer stores no `models` — the same read the editor uses to label **Customized model catalog**, so the row and the editor cannot disagree. On the official route, storing a user-layer `models` hides the action until **Restore defaults** unsets it, and the account route has no `models` field, so its action stays while the row is shown; third-party routes declare no capability. A reload that proceeds discards the cached listing before loading, waits for the new listing up to the route's `modelsTimeoutMs`, and publishes `llm/models-updated` on success, which reloads open model selectors; configuration and the page snapshot do not change. The row reports the outcome locally: **Refreshing…** while it runs, a transient **Models reloaded** status on success, and the Host's refusal inline until the next attempt.

## Alternatives considered

**One generic provider-adapter method, `reloadListing(provider)`.** It would put a cached-listing obligation on every adapter, including routes whose models are configuration alone, and force every provider to invent a reload answer. The capability flag plus a registered offer keeps the operation optional and leaves refusal wording with the route that knows its states.

**Reuse the model-discovery seam.** `discoverModels` describes a draft endpoint with a one-shot credential and returns candidate metadata for adoption; it never discards a route's cache, and the page would have to name an endpoint instead of the configured route. Reloading through it would also bypass the route's own configuration and refusal diagnostics.

**Refetch the settings or the catalog from the Client.** The cache lives in the Host adapter process, so a new page snapshot or a `listModels` read returns the same cached listing; the browser holds no endpoint credential to fetch the listing itself. The reload has to run where the cache is.

**Key the offer by provider route.** A route may not exist yet when its plugin registers, and one namespace can own several routes. Route-keyed registration would need a registration per route, would lose the offer on route replacement, and would make the surface enumerate routes to find the owner.

**A single failure code for every refusal.** One `LISTING_REFRESH_FAILED` for a customized catalog, a non-official endpoint, a missing key, and a signed-out account would leave the user without the repair, because each state needs a different action. The routes' own codes let the row show the diagnostic that names it.

**Refresh on page open or a shorter background interval.** Reloading whenever the page appears spends requests for users who never look, and a shorter interval still cannot answer a user who just published a model. The existing `modelsMaxAgeMs` refresh covers ordinary staleness; the explicit action answers the moment the user asks.

## Consequences

- The action never changes configuration: a route that stops following its listing needs **Restore defaults**, a correct endpoint, a stored key, or a sign-in, and the refusal names which.
- Visibility follows the user layer's `models`, not the adapter's resolved catalog. A list equal to the built-in catalog stored in the user layer hides the action although the route still serves the listing, and a catalog customized in the profile patch leaves the action visible until the reload refuses with `LISTING_NOT_FOLLOWED`. The editor labels those states as the row does, the accepted cost of one shared read instead of two judgments that can disagree.
- Both DeepSeek routes expose the action; third-party providers that cache no followed listing declare nothing and gain no control.
- The seam does not serialize reloads. A second reload discards the first call's in-flight load, so the Models row disables every refresh button while one runs; a Remote caller outside the page can still start another.
- A successful reload always republishes `llm/models-updated` because the discarded cache makes the following listing a change, so open selectors reload even when the listing content is unchanged.
