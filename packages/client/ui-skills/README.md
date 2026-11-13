---
description: "The Skills tab of the dsh Plugins page: local skill sources with their skills, source and per-skill switches, and the discovery states the Host reports."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-skills

English | [中文](README.zh.md)

## Summary

The Plugins page gains a second tab, **Skills**, next to the installed plugins and any market tab. It lists the local skill sources the Host scans — the harness's own project and user folders plus the skill folders of other applications — as groups whose skills render as cards with the switch that owns each one. A source switch hides all of its skills without forgetting the per-skill switches. Discovery states come from the Host: a skill shadowed by a higher-priority source, a frontmatter error, and a source whose folder disappeared are visible without opening a file.

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

Open **Plugins** and switch to **Skills**. Each source is a group heading with its name, whether it belongs to the harness or another application, its folder, and `enabled N of M`; its discovered skills render as cards with name, description, file path, and a switch. A search field filters by name or description. Long sources render fifty skills at a time behind a **Show more** action.

Switching a source or a skill calls the Host `skillSources` Remote, which updates the `skill-sources` profile settings entry and invalidates every mounted provider, so the next model request sees the change without a restart and the session log records the changed catalog. A skill switched off is absent from the model catalog and from `/skill`; switching its source back on restores the per-skill choices.

### What a reader sees

- **Two tabs.** The Plugins page keeps its plugin list tab and adds **Skills**; the tab appears only when this package is mounted.
- **Defaults.** The harness's own folders (project `.dsh/skills`, `.agents/skills`, `~/.dsh/skills`, `~/.agents/skills`, bundled) are on. Another application's folder appears only when it exists and stays **off** until enabled.
- **A switch writes settings.** Every toggle is stored in the `skill-sources` profile entry, so it survives a restart and is shared by Web and Desktop on the same profile.
- **Switch a source or one skill.** The source switch hides all of its skills but remembers their individual choices; enabling it again restores them. A new skill in an enabled source starts enabled.
- **Overridden rows.** `Overridden by <source>` means a skill with the same name comes from a higher-priority source and the model sees that one.
- **Broken rows.** `Frontmatter error` shows the parser message; the skill is ignored. `Folder not found` marks a source whose folder disappeared.
- **Switch it off and it is gone.** A disabled skill is absent from the session catalog and from `/skill` on the next request; nothing restarts.

## Understand the implementation

<a id="understand-the-implementation"></a>

The tab is a `plugins.tab` contribution; it reads its inventory from the `skillSources` Remote namespace published by `dsh-skill-filesystem`, which reports one row per scanned source and one row per discovered skill, including skills that only lost a duplicate name or whose frontmatter did not parse. Writes go through the same namespace: `setSource` and `setSkill` persist into the `skill-sources` profile entry and then invalidate every mounted provider, so the next model step publishes a replacement catalog.

Search and pagination are presentation state and live in the component; the inventory is refetched after each write.

## Further Exploration

<a id="further-exploration"></a>

- [skill-filesystem](../../skill/skill-filesystem/README.md) — discovery, roots, ranks, and the `skillSources` namespace.
- [tool-skill](../../skill/tool-skill/README.md) — the session catalog the model actually sees.
- [ui-plugin-manager](../ui-plugin-manager/README.md) — the page that hosts this tab.

## Model Experience

None, as this browser package registers no model-facing input and changes no prompt, tool schema, or request.

#### KV Cache effect

Appending the replacement catalog keeps the earlier prefix; the changed entries and everything after them form a new suffix, as with any catalog membership change.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A skill body is never read by this tab; descriptions come from frontmatter, and a body-only edit does not change the row.
- The write is unconditional (no revision fence): two simultaneous toggles overwrite each other.
- The list is not virtualized; a source with hundreds of skills pages by fifty entries instead.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintenance context — click to expand</summary>

None.

</details>

The `skillSources` namespace reports discovery; the `skill-sources` settings entry stores the switches for every provider instance.
