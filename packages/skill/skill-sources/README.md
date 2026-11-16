---
description: "Profile-owned on/off switches for local skill sources and individual skills, shared by every mounted filesystem skill provider and written by the Skills tab."
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-sources

English | [中文](README.zh.md)

## Summary

One small Host plugin owns the switches behind the Skills tab. Its volatile Config fields live in the profile settings document, so the choice survives restarts and belongs to the reader's profile; every mounted `skill-filesystem` instance reads the same service and re-publishes the catalog after a write. A source switch hides all of its skills without erasing their individual switches.

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

Mount it as an ordinary Host row beside `skill-filesystem`; its profile entry id is `skill-sources`:

```yaml
- id: skill-sources
  name: '@deepseek-ai/dsh-skill-sources'
```

The switches are ordinary volatile Config fields, so they are edited from the profile settings document and validated like any other plugin config:

| Field | Default | Meaning |
|---|---|---|
| `applications` | Claude Code, Codex, GitHub Copilot, Gemini CLI, Google Antigravity, and OpenCode | Other applications' skill folders as `{ id, dir, title }` entries, scanned only when the folder exists and ranked after the harness roots; each starts switched off |
| `sources` | `{}` | Source switches by source id; absent keeps the source's default (harness folders on, other applications off) |
| `skills` | `{}` | Per-skill switches by source id and skill name; absent means enabled |
| `folders` | `[]` | Folders the reader added from the Skills tab, as `{ dir }` entries in the order they were added; each is a source named `folder:<dir>` that starts on |

`skill-filesystem` reads them through the `skillSources` service and registers itself for invalidation, so the next model step publishes a replacement skill catalog and `/skill` follows the same state.

## Understand the implementation

<a id="understand-the-implementation"></a>

The plugin exists because the Web profile disables the top-level `skill-filesystem` row and mounts providers inside agent presets. A preset-scoped row cannot be addressed by the profile settings service, while a top-level entry can, so the switches live here and the providers only consult them.

`setSource` and `setSkill` delegate to `ctx.settings.update('skill-sources', …)`, which merges the patch into the profile document, reloads this entry's volatile Config, and then invalidates every provider that registered through `register()`. No state is kept outside the settings document, so two windows, a restart, or a profile copy all see the same switches.

## Further Exploration

<a id="further-exploration"></a>

- [skill-filesystem](../skill-filesystem/README.md) — discovery, roots, ranks, and the filtering these switches drive.
- [ui-skills](../../client/ui-skills/README.md) — the Skills tab that writes them.

## Model Experience

None, as this Host package registers no model-facing input and changes no prompt, tool schema, or request.

#### KV Cache effect

None; it only stores switches that other packages consult before rendering the catalog.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Switches are stored per profile entry: a second profile keeps its own choices, and copying a profile copies them.
- Only providers that register through the service react to a write; a provider mounted without it keeps the switches it read at startup.
- Writes are unconditional (no revision fence): two simultaneous toggles can overwrite each other.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintenance context — click to expand</summary>

None.

</details>

The volatile Config fields are the storage format: changing their shape is a settings migration, not a refactor.
