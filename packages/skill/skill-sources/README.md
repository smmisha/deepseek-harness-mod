---
description: "Profile-owned on/off switches for local skill sources and individual skills, the shared application list, and the category rules that group skills in the Skills tab."
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-sources

English | [中文](README.zh.md)

## Summary

One small Host plugin owns the switches and grouping rules behind the Skills tab. Its volatile Config fields live in the profile settings document, so the choice survives restarts and belongs to the reader's profile; every mounted `skill-filesystem` instance reads the same service and re-publishes the catalog after a write. A source switch hides all of its skills without erasing their individual switches. The category rules live beside the switches so a deployment names its own skill families without editing a provider.

## Table of Contents

- [Use this package](#use-this-package)
- [Categories](#categories)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Use this package

<a id="use-this-package"></a>

Mount it as an ordinary Host row beside `skill-filesystem`; its profile entry id is `skill-sources`:

```yaml
- id: skill-sources
  name: '@deepseek-ai/dsh-skill-sources'
```

The switches are ordinary volatile Config fields, so they are edited from the profile settings document and validated like any other plugin config:

| Field | Default | Meaning |
|---|---|---|
| `applications` | Claude Code, Codex, GitHub Copilot, Gemini CLI, Google Antigravity, and OpenCode | Other applications' skill folders as `{ id, dir, title }` entries, scanned only when the folder exists and ranked after the harness roots; each starts switched off |
| `categories` | the ten built-in category rules | Category rules as `{ id, title, prefixes?, namespaces? }` entries; the provider groups the skills it describes by them. Omitted ships the built-ins, `[]` keeps only the categories authors declare |
| `sources` | `{}` | Source switches by source id; absent keeps the source's default (harness folders on, other applications off) |
| `skills` | `{}` | Per-skill switches by source id and skill name; absent means enabled |
| `folders` | `[]` | Folders the reader added from the Skills tab, as `{ dir }` entries in the order they were added; each is a source named `folder:<dir>` that starts on |

`skill-filesystem` reads them through the `skillSources` service and registers itself for invalidation, so the next model step publishes a replacement skill catalog and `/skill` follows the same state.

<a id="categories"></a>
## Categories

The Skills tab groups skills by category by default, and `categories` decides what a category is. Each rule names one category and the tokens that claim a skill for it:

```yaml
- id: skill-sources
  name: '@deepseek-ai/dsh-skill-sources'
  config:
    categories:
      - id: google-cloud
        title: Google Cloud
        prefixes: [gcp, google, bigquery, gemini]
      - id: video
        title: Video and animation
        prefixes: [hyperframes, remotion, faceless, reverse, product, style, blender, media]
      - id: plugin-ckm
        title: ckm
        namespaces: [ckm]
```

A provider resolves one category per skill, and the first match wins:

1. The frontmatter declares one: `category`, a flat `metadata.category` key, or a `category` field inside the `metadata` mapping. This is the author's own word; it is matched against a rule id, prefix, or namespace, and a word no rule claims becomes its own category titled with that word.
2. The skill name carries a plugin namespace, such as `ckm:banner-design` → `ckm`.
3. The skill name carries a prefix, the part before its first `-`, such as `gcp-agent-builder` → `gcp`.
4. Nothing claims the skill: it reports no category, and the Skills tab files it under its own "Other" group.

The shipped rules are `google-cloud` (`gcp`, `google`, `bigquery`, `gemini`), `firebase` (`firebase`), `video` (`hyperframes`, `remotion`, `faceless`, `reverse`, `product`, `style`, `blender`, `media`), `design` (`figma`, `ui`, `apple`), `content` (`smm`, `ads`, `copy`, `content`, `seo`), `office` (`office`, `pdf`, `docx`, `pptx`, `xlsx`, `jupyter`, `notebook`), `development` (`dsh`, `gh`, `skill`, `discover`, `codex`, `extension`, `schema`, `bigtable`), `automation` (`playwright`, `agent`, `computer`, `cua`, `android`, `xcode`), `notes` (`notion`, `linear`, `gmail`, `calendar`, `schedule`), and `security` (`security`). There is no rule for the "Other" group: an unmatched skill carries no category. The Skills tab translates every built-in id, so a built-in `title` is a fallback for clients that do not know it; a rule a deployment adds shows its `title` as written.

Load fails when an id or title is blank or two rules claim the same id, prefix, or namespace, because the tab groups by the id and a token would otherwise name two categories. An `id` is a grouping identity: renaming one regroups the tab on the next load.

## Understand the implementation

<a id="understand-the-implementation"></a>

The plugin exists because the Web profile disables the top-level `skill-filesystem` row and mounts providers inside agent presets. A preset-scoped row cannot be addressed by the profile settings service, while a top-level entry can, so the switches, application list, and category rules live here and the providers only consult them.

`setSource` and `setSkill` delegate to `ctx.settings.update('skill-sources', …)`, which merges the patch into the profile document, reloads this entry's volatile Config, and then invalidates every provider that registered through `register()`. No state is kept outside the settings document, so two windows, a restart, or a profile copy all see the same switches. `visibility()` returns one read of the switches, applications, added folders, and category rules, so a provider groups and filters from one configuration snapshot.

## Further Exploration

<a id="further-exploration"></a>

- [skill-filesystem](../skill-filesystem/README.md) — discovery, roots, ranks, the category derivation, and the filtering these switches drive.
- [ui-skills](../../client/ui-skills/README.md) — the Skills tab that writes them and renders the groups.

## Model Experience

None, as this Host package registers no model-facing input and changes no prompt, tool schema, or request.

#### KV Cache effect

None; it only stores switches and grouping rules that other packages consult before rendering the catalog.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Switches are stored per profile entry: a second profile keeps its own choices, and copying a profile copies them.
- Only providers that register through the service react to a write; a provider mounted without it keeps the switches it read at startup.
- Writes are unconditional (no revision fence): two simultaneous toggles can overwrite each other.
- A category rule cannot override another rule per skill: rules match by name token, and the only per-skill override is the frontmatter's own `category` field.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintenance context — click to expand</summary>

None.

</details>

The volatile Config fields are the storage format: changing their shape is a settings migration, not a refactor.
