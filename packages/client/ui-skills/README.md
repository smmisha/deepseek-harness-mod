---
description: "The Skills tab of the dsh Plugins page: the local skill catalog, its source groups, filters, detail panel, and the switches that decide which skills reach the agent."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-skills

English | [中文](README.zh.md)

## Summary

The Plugins page gains a second tab, **Skills**, next to the installed plugins and any market tab. It presents the local skill sources the Host scans as a catalog: each source is a collapsible group whose header carries a mark, name, kind, folder, count, and the switch that owns every skill below, and each skill is a row of catalog columns — source mark, name and origin, the author's description, state, and the quiet switch. Selecting a row opens a detail panel inside the tab with the full description, path, files, and provenance. Discovery states come from the Host: an overridden duplicate, a frontmatter error, and a source whose folder disappeared are visible without opening a file.

## Table of Contents

- [Use this package](#use-this-package)
- [Source marks and licences](#source-marks-and-licences)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Use this package

<a id="use-this-package"></a>

Open **Plugins** and switch to **Skills**. A search field filters by skill name or description, the split **Add skills** button adds a folder or opens the catalog entry point, and two filter menus narrow the catalog by source and by state (enabled, off, overridden, with an error). A quiet line at the end of the filter row counts what is shown and how many of those skills are on.

Each source group header carries the disclosure triangle and name as one target, the source mark, the source's kind, its folder, the skill count, and the switch that hides all of its skills without forgetting their individual choices. Collapsing a group and opening a skill's detail panel are remembered when the reader leaves the tab and returns.

Each skill row shows the source mark, the skill name over the source it came from, the author's description, its state, and its switch. The description is its own block, measured for reading and clamped to two lines with a **Show full description** control that reveals the third; the detail panel is where the whole text lives. A row whose switch is disabled says why: its source is off, or a higher-priority source wins the name. A skill whose frontmatter could not be read shows its path as the title, no switch, and the parser's reason.

The detail panel shows the full description with the language the author declared, the source, the path with a copy action, the files the skill ships with sizes and a script mark, and — when an installer recorded it — the repository, commit, and install date. It is a region beside the list rather than a modal, so the reader keeps the row they came from.

Four states replace the former bare messages. Loading is a skeleton of the same grid, so the tab does not reflow when rows land. A failed load is an in-place notice with **Retry**; a failure after a successful load keeps the described rows on screen and says the list may be out of date. A search or filter that matches nothing says so and offers to clear it. An inventory with no skills at all explains what a skill is, offers exactly three ways to add one — **Add folder**, **Browse catalog**, and **Create with AI** — and a quiet row of the source marks it reads. The same three actions are always in the add button's menu; **Create with AI** is present but disabled when the page cannot open a chat, and **Add folder** omits the chooser when no chooser is available.

Switching a source or a skill calls the Host `skillSources` Remote, which updates the `skill-sources` profile settings entry and invalidates every mounted provider, so the next model request sees the change without a restart. A skill switched off is absent from the model catalog and from `/skill`; switching its source back on restores the per-skill choices.

## Source marks and licences

<a id="source-marks-and-licences"></a>

Every mark is one 20px box in `--dsw-alias-label-secondary`, so both themes and every row state share one ink. Official artwork is reproduced unmodified and masked, so the silhouette is the vendor's and the colour is ours. It is used only to identify the application whose folder is scanned: none of these marks implies a partnership, endorsement, or that the application is part of DeepSeek Harness.

| Source | Mark | Source of the artwork | Licence and conditions |
|---|---|---|---|
| OpenAI Codex | Official OpenAI mark | https://openai.com/brand | OpenAI trademark, used for identification only under https://openai.com/brand. Unmodified, never more prominent than our own UI, no endorsement implied. |
| GitHub | Official GitHub mark | https://brand.github.com | GitHub® trademark of GitHub, Inc., used per the GitHub Logo Policy (https://docs.github.com/en/site-policy/other-site-policies/github-logo-policy). No octocat as product identity, no partnership implied. |
| GitHub Copilot | Official GitHub mark | https://brand.github.com | The GitHub product lockup is the Copilot mark; the same GitHub Logo Policy conditions apply. |
| OpenCode | Official OpenCode mark | https://github.com/anomalyco/opencode (`dev`, `.github/assets/logo-ornate-dark.svg`) | MIT. Copyright (c) 2025 opencode; the copyright and permission notice is kept in [`src/client/assets/opencode.svg`](src/client/assets/opencode.svg). Unmodified, no endorsement implied. |
| Claude Code | Monogram drawn here | — | Anthropic publishes no mark grant, so no Anthropic or Claude mark is bundled. "Claude Code" is a trademark of Anthropic PBC; not affiliated with or endorsed by Anthropic. |
| Gemini CLI | Monogram drawn here | — | Google's permission chain is partner-gated and `google-gemini/gemini-cli` ships no logo asset, so no Google mark is bundled. Gemini is a trademark of Google LLC. |
| Google Antigravity | Monogram drawn here | — | `antigravity.google/brand` returns 404; no Google mark is bundled. Not affiliated with Google. |
| skills.sh | Monogram drawn here | — | No published grant covers the skills.sh lockup; Vercel's brand assets cover Vercel marks only. No skills.sh or Vercel mark is bundled. |
| Harness folders | Home monogram, and a line folder glyph for a folder the reader added | — | Artwork of this package. |

A monogram is the source's initial in a bordered box, drawn by this package. An application the Host configures but this package does not know falls back to the first letter of its id.

## Understand the implementation

<a id="understand-the-implementation"></a>

The tab is a `plugins.tab` contribution; it reads its inventory from the `skillSources` Remote namespace published by `dsh-skill-filesystem`, which reports one row per scanned source and one row per discovered skill, including skills that only lost a duplicate name or whose frontmatter did not parse. The panel's file list, single-line description, author-declared language, provenance, and the source's application id all come from those rows, so the tab renders no file itself and never runs anything a skill ships.

Writes go through the same namespace: `setSource` and `setSkill` persist into the `skill-sources` profile entry and then invalidate every mounted provider, so the next model step publishes a replacement catalog. Group collapse and the open detail panel live in a store declared at registration, which outlives the component; the search, filters, description expansion, and paging are component state. The inventory is refetched after each accepted write and when the open session's project folder changes, and a response that a newer request superseded is dropped.

## Further Exploration

<a id="further-exploration"></a>

- [skill-filesystem](../../skill/skill-filesystem/README.md) — discovery, roots, ranks, the `skillSources` namespace, and the row fields the panel renders.
- [tool-skill](../../skill/tool-skill/README.md) — the session catalog the model actually sees.
- [ui-plugin-manager](../ui-plugin-manager/README.md) — the page that hosts this tab.
- [skill-sources](../../skill/skill-sources/README.md) — the profile entry that owns the switches and the application list.

## Model Experience

None, as this browser package registers no model-facing input and changes no prompt, tool schema, or request.

#### KV Cache effect

Appending the replacement catalog keeps the earlier prefix; the changed entries and everything after them form a new suffix, as with any catalog membership change.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Installation is a later stage.** **Browse catalog** opens a dialog that states installation arrives later; catalog search, preview, and download are not implemented here, and the skills.sh, SkillsMP, and skills-hub catalog sources are untouched.
- **Provenance needs an installer.** The repository, commit, and install date render only when an installer recorded them in the skill's frontmatter metadata, which nothing in this release writes.
- **The description toggle has a fixed budget.** Rows expand from two lines to three; a longer description is read in the detail panel. The control is offered whenever a description exists rather than measured per row.
- **A skill body is never read by this tab.** Descriptions come from frontmatter, and a body-only edit does not change the row.
- **The write is unconditional (no revision fence).** Two simultaneous toggles overwrite each other; a source write disables the switches below it while it is in flight.
- **The list is not virtualized.** A source with hundreds of skills pages by fifty entries instead.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintenance context — click to expand</summary>

The source marks are the only third-party artwork in this package. Before replacing or adding one, record the brand's published terms in the table above; a permissive repository licence never grants trademark use.

</details>

The `skillSources` namespace reports discovery; the `skill-sources` settings entry stores the switches for every provider instance.
