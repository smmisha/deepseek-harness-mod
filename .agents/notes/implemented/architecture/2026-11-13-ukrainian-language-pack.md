# Agent Note: Ukrainian language pack

Status: implemented

English | [中文](2026-11-13-ukrainian-language-pack.zh.md)

## Problem

The web GUI ships eight built-in languages (English, Chinese, Japanese, Spanish, French, German, Russian, and Brazilian Portuguese) whose dictionaries live inside the packages that own the copy. Ukrainian readers needed a Ukrainian interface, but adding a ninth built-in language meant editing every Client dictionary bundle, adding `uk` to the shipped-locale gate set and its roughly 300 package metadata directories, translating the desktop shell and the NSIS installer, and landing all of it as one large, unremovable diff. The locale service already supports language packs: `addLanguage` adds a selectable language whose dictionary lookups fall back per key, and the per-locale `register` form lets a pack supply one locale's dictionary for a namespace another plugin owns.

## Decision

The repository ships `@deepseek-ai/dsh-client-locale-uk` as a Client language pack, mounted by the default `@deepseek-ai/dsh-web-app` bundle row beside the locale plugin.

- `apply` registers `{ id: 'uk', label: 'Українська', fallback: 'en' }` through `ctx.locale.addLanguage`, then registers one `uk` dictionary per shipped namespace with `ctx.locale.register(namespace, 'uk', dictionary)`. Both are effects, so unmounting the pack removes exactly what it added.
- `src/client/dictionaries.ts` maps each locale namespace to its translated module in `src/client/locales/`. The pack covers all 79 namespaces the Client sources register, including the `common` and `settings.locale` namespaces and the optional experimental Client panels, for 4,295 keys.
- Dictionaries keep the owning package's English keys in the same order. A key the pack does not carry resolves through the locale service's fallback chain to English, so a newer upstream copy renders in English instead of a bare key.
- `scripts/extract-english.cjs` extracts the English source from package sources with the TypeScript parser (resolving namespace constants, imports, re-exports, spreads, string concatenation, and `Array.join()`). The parity spec compares every tracked Ukrainian dictionary with that source for namespaces, keys, key order, placeholders and literal tokens, and requires command tokens to stay verbatim.
- Package display metadata is separate from UI dictionaries: plugin cards and settings rows read `meta` from each package's `locale/*.json` through the Host. The change therefore adds `locale/uk.json` to the packages that ship display metadata (301 directories) instead of trying to register it from the Client pack.
- The pack does not enter `SHIPPED_LOCALE_IDS`. Built-in dictionaries keep their eight languages, the metadata gate keeps its existing language set, and the new language is an additive optional row. Its own `locale/*.json` files carry the nine display languages a first-party package publishes.

A browser whose language order requests `uk` or `uk-UA` opens in Ukrainian; the Settings → General choice persists as `locale.preference`, and `<html lang>` follows the active locale.

## Alternatives considered

**Add Ukrainian to the built-in language set.** This is the shape the shipped languages use, and it would put Ukrainian on every surface including the selector's built-in set and the gates. It loses because it forces the same change into roughly 96 dictionary registrations, the shipped-metadata gate set with about 300 `uk.json` files, `apps/desktop/src/locale.ts`, and the NSIS installer locale set, while keeping all of it in one diff that cannot be evaluated incrementally. It remains a possible later promotion once the pack's terminology settles.

**Translate only the common and settings namespaces.** This is a much smaller change, but it leaves the chat, plugins, and settings surfaces in English, which is not a usable Ukrainian interface. Rejected.

**Publish the pack as an external plugin instead of a workspace package.** The default profile composition would then run without it until a user installed it, and the assembled-browser locale tests could not exercise it. A workspace package keeps versions in lockstep with the application and mounts with the default bundle. Rejected.

**Leave plugin metadata in English.** The Plugins page would show English card titles and descriptions around a Ukrainian page chrome. The metadata files are small and reuse the pack's terminology, so they ship in the same change.

## Consequences

- The default Client composition gains one row and its dictionaries: the bundle is about 348 KB (77 KB gzip) of the Client artifact.
- Promoting Ukrainian to a built-in language later must first remove this pack, because a built-in `uk` registration conflicts with the pack's language registration of the same id.
- New upstream copy is detected by the parity spec as a gap instead of breaking a page: until the affected dictionary is updated, it shows English.
- The desktop window chrome, native menus, and installer keep following the desktop locale; the pack localizes the web surface only.
- The extractor is test-time tooling only: it parses package sources and never executes them, so it adds no runtime dependency to the Client bundle.
