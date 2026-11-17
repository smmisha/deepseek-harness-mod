---
description: "Downloads skills from a GitHub repository or an imported .zip, previews them, installs them into the harness home's skills folder switched off, and removes the ones it installed."
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-install

English | [中文](README.zh.md)

## Summary

The Skills tab's installer. A reader pastes `owner/repo`, a GitHub URL, or an `npx skills add …` command, or drops a `.zip` or a folder onto the tab. The Host resolves the source, previews the `SKILL.md`, the file list, the source, and whether the skill ships scripts, and writes nothing until the reader confirms. A confirmed install copies the files into `~/.dsh/skills/<name>` and records the skill switched off, so it reaches the model only after the reader turns it on.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

## Use this package

<a id="use-this-package"></a>

Mount it as an ordinary Host row beside `skill-sources`; its profile entry id is `skill-install`:

```yaml
- id: skill-install
  name: '@deepseek-ai/dsh-skill-install'
```

The row registers the `skillInstall` Remote namespace and stays off where no profile is mounted, because an install records its switch in the profile's settings document.

Every deployment-varying choice is configuration:

| Field | Default | Meaning |
|---|---|---|
| `installRoot` | the harness home's `skills` folder (`~/.dsh/skills`) | Folder installed skills are written to; must be absolute |
| `catalogs` | GitHub, Anthropic skills, skills.sh, SkillsMP, skills-hub.ai | Catalog rows as `{ id, title, homepage, searchable, kind, repository? }` |
| `allowedHosts` | `api.github.com`, `raw.githubusercontent.com` | Hosts outbound requests may target, exactly or through a `*.` entry |
| `requestTimeoutMs` | `15000` | Milliseconds one request may take |
| `maxRedirects` | `3` | Redirect hops one request may follow; each hop is validated again |
| `maxResponseBytes` | `8388608` | Largest response body accepted, in bytes |
| `maxUploadBytes` | `16777216` | Largest upload a drop or file choice may carry, in bytes |
| `maxArchiveEntries` | `2000` | Most entries one archive may declare |
| `maxUncompressedBytes` | `67108864` | Largest total uncompressed size one import may declare |
| `maxFiles` | `200` | Most files one skill folder may hold |
| `maxBundles` | `20` | Most skills one archive or dropped folder may carry |
| `maxPreviews` | `16` | Most previews kept installable at once |
| `previewTtlMs` | `600000` | How long one preview stays installable |

A catalog whose `kind` is `github` accepts the reader's repository text; `recommended` lists a fixed repository; `link` is opened in the browser and never fetched. This release holds no client for the skills.sh, SkillsMP, or skills-hub.ai APIs, so those rows ship as link-only entries and are listed under Known Limitations.

### Licences and provenance

A skill keeps the licence its own repository or archive carries. Installing copies every file of the skill folder, including a `LICENSE.txt` beside the `SKILL.md` when the source has one, and writes the origin into the installed frontmatter:

```yaml
metadata:
  repository: https://github.com/anthropics/skills
  commit: 2c5958ecac7cee2b583967a2c4981d0f4a75c579
  installedAt: 2026-11-17T10:00:00.000Z
```

The `anthropics/skills` folders are Apache-2.0 **per folder**, and not every folder ships a licence file: `skills/pdf/LICENSE.txt` and its siblings exist, `skills/doc-coach…` and `template/` carry none. A deployment that offers that repository as a curated catalog must copy each folder's `LICENSE.txt` with the skill and must not present an unlicensed folder as recommended; the installer copies what the folder holds and does not invent a licence.

## Understand the implementation

<a id="understand-the-implementation"></a>

`SkillInstallController` is the plugin entry: it owns the `skillInstall` Remote namespace and translates every `SkillInstallError` into the namespace's `skill-install/*` code. `SkillInstaller` is the service behind it.

An install is one transaction over two folders. The files are written into `<harness home>/.skill-install-<uuid>`, the skill's switch is recorded off in `ctx.skillSources` **before** the folder appears, and only then is the staging folder renamed into `skills/<name>`; a replacement first renames the old folder aside and restores it if the publish fails. A failure therefore leaves the skills folder as it was.

An archive is read from its central directory before one byte is inflated: the entry count, every entry name, the declared sizes, and the Unix mode are checked first, so a `..` path, an absolute path, a drive letter, a backslash, a symbolic link, a device entry, an encrypted entry, an unsupported compression method, too many entries, or a total over the cap is refused before extraction. Each accepted entry must then expand to exactly the size the directory declared.

Every request passes `validateRequestUrl` (HTTPS only, no embedded credentials, allowlisted host) and the `HttpClient`, which follows redirects manually so each hop is validated the same way, bounds each hop by the timeout, and caps the body. Nothing is executed from downloaded content: no script, no postinstall, and no YAML beyond the `SKILL.md` frontmatter the skill itself declares.

## Further Exploration

<a id="further-exploration"></a>

- [skill-sources](../skill-sources/README.md) — the switches an install writes and the folders the reader added.
- [skill-filesystem](../skill-filesystem/README.md) — the provider that discovers the installed skills under `user-dsh`.
- [ui-skills](../../client/ui-skills/README.md) — the tab that previews, confirms, and removes.

## Model Experience

### Installed skills

#### What the model sees

Nothing while a reader previews or installs: this package registers no tool, prompt section, or schema input. An installed skill reaches the model only through the `user-dsh` source's catalog, and only after the reader turns it on; the install record, the source URL, the commit, and the archive name stay on the Host and never enter a request.

#### Token effect

No request changes during a preview or an install. Turning an installed skill on adds that skill's name and description to the catalog the next request carries, exactly like the Skills tab's own switch.

#### KV Cache effect

None for preview, install, and removal. A catalog that gains or loses an installed skill appends a replacement catalog, so the earlier prefix of the request stays cached.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No API client for skills.sh, SkillsMP, or skills-hub.ai.** The audit allows them (skills.sh only as a link plus repository paste), but this release ships them as `kind: 'link'` catalog rows: the tab opens the site in the browser and the Host never fetches it. A future release adds search clients behind the same typed Config row.
- **Unlicensed folders are copied as they are.** The installer records provenance and copies a folder's `LICENSE.txt` when one exists; it cannot add a licence a repository does not carry.
- **Unauthenticated GitHub only.** The installer resolves a repository's default-branch head and a tree, and reads files from `raw.githubusercontent.com`; it sends no token, so GitHub's 60-requests-per-hour limit applies per address and a rate-limited answer is reported with a "wait an hour" action.
- **Preview resolution is repeated.** Confirming a repository preview re-resolves the folder list, because the preview cache holds the planned files rather than a second listing.
- **A replacement does not preserve a previous skill's switches beyond its name.** Replacing `pdf` keeps the `pdf` switch entry, so a skill that was on stays on after a replacement.
- **One name, one folder.** A skill whose frontmatter name is not kebab-case is installed under the slug derived from it, so the installed name can differ from the declared one.
