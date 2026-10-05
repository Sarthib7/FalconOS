# Obsidian as a FalconOS memory system

Source URL: https://help.obsidian.md/
Date fetched: 2026-08-28
Author: ObsidianResearch agent
Provenance: REPORTED. Distilled from the source; claims are the author's, not independently verified.

## TLDR

[REPORTED] Obsidian documents a local-first vault made from ordinary Markdown files, folders, YAML properties, links, and optional plugins. Its local files remain usable offline, while Sync adds remote copies, encryption choices, history, and shared-vault access. [INFERRED] This makes Obsidian a good human-facing advisory memory and context store, but not a complete FalconOS authority or evidence store. FalconOS must keep policy, execution state, signed receipts, and replay records in a separate controlled format, then export selected views to Obsidian.

## Vault storage and files

**Core rule:** [REPORTED] A vault is a local folder, including subfolders, where Obsidian stores Markdown notes and a vault-specific `.obsidian` configuration folder.

[REPORTED] Obsidian refreshes its view after external file changes, so another editor or file manager can manage notes. Its metadata cache supports features such as Graph and Outline, but the documentation says the cache can become out of sync and can be rebuilt. Global settings live outside the vault. The documentation warns against placing a vault in the system settings folder because corruption or data loss can result.

Do:
- [REPORTED] Keep human notes and machine-readable files under one vault root.
- [REPORTED] Treat `.obsidian` as device or vault configuration, not note content.
- [REPORTED] Rebuild the metadata cache when it no longer matches files.
- [INFERRED] Keep Falcon authority and ledger files in a clearly named subtree with separate access rules.

Do not:
- [REPORTED] Nest one vault inside another, because local links may not update correctly.
- [REPORTED] Treat the metadata cache as the durable source of note content.
- [REPORTED] Put a vault in the operating system's application settings folder.

Workflow or code shape:
- [INFERRED] Read file bytes as the durable input, then compute a content hash before a Brain context snapshot.
- [INFERRED] Record vault path, file path, byte hash, modification time, and parser version in each snapshot.
- [INFERRED] Exclude `.obsidian/workspace.json` and `.obsidian/workspaces.json` from authority calculations because they change with UI layout.

## Links and graph structure

**Core rule:** [REPORTED] Obsidian links files, headings, and blocks with Wikilinks or Markdown links, and links are local to one vault.

[REPORTED] Obsidian can update internal links after a rename. It supports file, heading, and block targets. Block references are Obsidian-specific and do not work outside Obsidian. Link suggestions change algorithm at 10,000 vault items. Unsupported or unsafe filename characters can break links.

Do:
- [REPORTED] Use Markdown links when interoperability outside Obsidian matters.
- [REPORTED] Use stable paths and simple filenames for machine-generated records.
- [INFERRED] Link a receipt to its intent, policy, state snapshot, transaction, and outcome by immutable IDs.

Do not:
- [REPORTED] Assume block references are portable Markdown.
- [REPORTED] use nested vaults as a cross-vault link mechanism.
- [INFERRED] Use display text, aliases, or link order as identity for a financial record.

Workflow or code shape:
- [INFERRED] Make IDs and hashes the authority, with links as navigation only.
- [INFERRED] Keep a link resolver that validates the target path and content hash during replay.
- [INFERRED] Use one note per decision or event when deterministic diffing matters, rather than rewriting a large narrative note.

## Properties and structured fields

**Core rule:** [REPORTED] Properties are small structured values stored at the top of a note in YAML, with one unique name per note.

[REPORTED] Supported types include text, lists, numbers, checkboxes, dates, date-times, and tags. A property name has one type across the vault. JSON input is read and saved as YAML. Obsidian intentionally does not support nested properties, Markdown rendering in properties, or full bulk editing in its property UI.

Do:
- [REPORTED] Use YAML properties for small values that humans and machines can read.
- [REPORTED] Quote internal links inside text and list properties.
- [INFERRED] Store schema version, record type, owner, and lifecycle fields as explicit properties.

Do not:
- [REPORTED] Put expressions in number properties.
- [REPORTED] Put long Markdown content in properties.
- [INFERRED] Treat a property value as authenticated merely because Obsidian parses it.

Workflow or code shape:
- [INFERRED] Validate property types and required fields outside Obsidian before using a note in policy or Brain context.
- [INFERRED] Keep signed receipt payloads canonical and separate from editable YAML frontmatter.
- [INFERRED] Use properties for search facets, then use signed IDs and hashes for authority.

## Search and indexing

**Core rule:** [REPORTED] The Search core plugin searches note and Canvas contents with terms, operators, property filters, and JavaScript-style regular expressions.

[REPORTED] Excluded files do not appear in Search results. Search can target filenames, paths, content, tags, lines, blocks, sections, tasks, and properties. It can sort by filename, modified time, or created time. The data-storage page describes a local metadata cache, not a complete externally queryable index.

Do:
- [REPORTED] Use `path:`, `file:`, `content:`, property filters, and exact phrases for repeatable human searches.
- [REPORTED] Use case-sensitive matching or regular expressions when the query requires it.
- [INFERRED] Save the exact query and the included or excluded file rules with a Brain context request.

Do not:
- [REPORTED] Assume excluded files are searchable.
- [REPORTED] Treat a Search result as a complete corpus proof without checking exclusion rules and file reads.
- [INFERRED] Use search ranking as a policy decision or as proof that a record exists.

Workflow or code shape:
- [INFERRED] Build a deterministic context manifest from explicit paths and hashes, not from an unrecorded UI search.
- [INFERRED] Store parser, query, and exclusion configuration versions beside the manifest.
- [INFERRED] Re-read selected files at decision time to detect changes after search.

## Core plugins, community plugins, and API

**Core rule:** [REPORTED] Core plugins are shipped and supported by Obsidian, while community plugins run third-party code with Obsidian's access level.

[REPORTED] Restricted Mode blocks third-party code execution by default. Obsidian says it cannot reliably restrict community plugins to selected permissions. A community plugin can access computer files, connect to the internet, and install programs. Obsidian scans versions listed in its directory and shows a safety scorecard, but the documentation still recommends an independent audit for sensitive data.

[REPORTED] Developer documentation exposes a TypeScript Vault API. `read()` avoids stale writes when a plugin will modify a file, `cachedRead()` is for display, and `process()` guarantees that content does not change between read and write. Event handlers should be detached through `registerEvent()`.

Do:
- [REPORTED] Keep Restricted Mode on for sensitive vaults unless each plugin is trusted and reviewed.
- [REPORTED] Develop plugins in a separate vault, not the main vault.
- [REPORTED] Prefer `Vault.process()` for synchronous read-modify-write changes.
- [INFERRED] Run any Falcon integration as a narrow process with an explicit file allowlist.

Do not:
- [REPORTED] Assume a community plugin's directory scorecard is a permission boundary.
- [REPORTED] Give a plugin access to a production authority or signer secret.
- [INFERRED] Let plugin code decide ALLOW, RESIZE, or BLOCK.

Workflow or code shape:
- [INFERRED] Use a standalone Falcon process or Headless client for agent writes, not arbitrary plugin code.
- [INFERRED] Make the integration append-only for receipts and outcomes, with separate write paths for editable context.
- [INFERRED] Pin plugin and runtime versions, record hashes, and review upgrades before enabling them.

## Sync, offline use, and version history

**Core rule:** [REPORTED] Obsidian keeps a local vault available offline, while Sync copies changed files between local vaults and a remote vault.

[REPORTED] Sync tracks changes at file level. Offline changes queue and sync when the device reconnects and Obsidian is open. Markdown conflicts use Google's diff-match-patch algorithm by default; other files use last-modified-wins unless the user chooses conflict files. Sync settings are device-specific. File recovery snapshots are not synced. Version history can restore notes and attachments, but retention depends on the plan, and attachments have shorter retention.

Do:
- [REPORTED] Back up before setting up Headless Sync or changing sync systems.
- [REPORTED] Configure conflict strategy on every device.
- [REPORTED] Use one sync method per device and avoid mixing providers on the same vault.
- [INFERRED] Block new financial risk when a source file changes during context assembly.

Do not:
- [REPORTED] Treat Sync as a backup.
- [REPORTED] Assume a local or remote vault is a single primary copy during normal Sync operation.
- [INFERRED] Use automatic text merge as proof that two financial records are semantically compatible.

Workflow or code shape:
- [INFERRED] Put authoritative state in append-only records with unique event IDs, not in files where conflict merging can alter meaning.
- [INFERRED] Record every Sync conflict as an input error and require explicit reconciliation before execution.
- [INFERRED] Keep independent backup copies and test restore plus replay.

## Security and privacy

**Core rule:** [REPORTED] Obsidian's local vault is not encrypted by Obsidian, while Sync remote vaults can use standard encryption or end-to-end encryption.

[REPORTED] The Sync documentation says end-to-end encryption uses a user-held password, scrypt with salt, and AES-256-GCM. Losing that password makes the remote data unusable. Standard encryption stores the key on Obsidian servers. The documentation also says some metadata remains readable to the server, including device and time information and the mapping between encrypted paths and encrypted content. It warns that a compromised server could tamper with that mapping without revealing plaintext.

Do:
- [REPORTED] Choose end-to-end encryption for private remote vaults and protect its password separately.
- [REPORTED] Review network connections, enabled plugins, themes, and embedded online content.
- [INFERRED] Keep root wallet keys, signing credentials, and service-payment secrets outside the vault.

Do not:
- [REPORTED] Assume local files have Obsidian-provided encryption.
- [REPORTED] Assume end-to-end encryption authenticates the meaning of a file or binds path to content.
- [INFERRED] Put raw identity, portfolio, or risk-preference data in an exported public vault.

Workflow or code shape:
- [INFERRED] Encrypt or redact sensitive advisory context before export, and keep keys in a separate secret store.
- [INFERRED] Sign canonical control and evidence records before placing human-readable copies in Obsidian.
- [INFERRED] Treat every imported note as untrusted input until schema, provenance, and hash checks pass.

## Collaboration and team access

**Core rule:** [REPORTED] A shared Sync vault gives collaborators the same permissions as the owner, except only the owner can invite collaborators, and it has no live same-file editing.

[REPORTED] All collaborators need an active Sync subscription. Shared vaults support up to 20 users. Edits appear after Sync, and simultaneous edits are merged and recoverable through version history. The team documentation says there is no on-premises Sync solution at this time. Obsidian's team security page says it does not support SSO and supports 2FA for account login, not for opening the base application.

Do:
- [REPORTED] Use shared vaults for human collaboration where equal access is acceptable.
- [REPORTED] Use version history to inspect and restore synced changes.
- [INFERRED] Keep authority records in a separate service with per-role authorization.

Do not:
- [REPORTED] Assume folder sharing gives file-level or role-level permissions.
- [REPORTED] Assume another collaborator's cursor or edit is visible before Sync.
- [INFERRED] Use a shared vault as the execution authorization boundary.

Workflow or code shape:
- [INFERRED] Export redacted evidence views to a team vault, while the canonical ledger stays in a tenant-isolated service.
- [INFERRED] Require explicit owner approval for any transition from advisory note to executable intent.
- [INFERRED] Record collaborator identity from the control plane, not from note authorship or file timestamps.

## CLI, URI, Headless, and agent access

**Core rule:** [REPORTED] Obsidian exposes automation through CLI, URI actions, and an open-beta Headless client, with different runtime and trust boundaries.

[REPORTED] Obsidian CLI controls the desktop app and requires that app to run. It can read, search, create, append, prepend, move, rename, delete, inspect history, and run JavaScript in the app console. Commands can target a vault and file, and create supports overwrite. Obsidian URI can open, create, append, prepend, overwrite, and search notes, with optional callbacks. Headless Sync runs without the desktop app, requires Node.js 22 or later and an active Sync subscription, and documents use for CI, agents, automated workflows, and scheduled jobs.

Do:
- [REPORTED] Use exact vault and path parameters for automation.
- [REPORTED] Use Headless when the desktop app must not run on a server.
- [REPORTED] Use the documented `sync-config` modes, including pull-only or mirror-remote, where they fit the job.
- [INFERRED] Wrap these interfaces in a Falcon command that accepts only typed intents and approved paths.

Do not:
- [REPORTED] Assume CLI is a standalone server interface.
- [REPORTED] Allow URI or CLI overwrite, permanent delete, or JavaScript evaluation from an untrusted model.
- [INFERRED] Give Headless credentials broader access than the selected vault.

Workflow or code shape:
- [INFERRED] Use a read-only Headless or file-export path for Brain context, and a separate controlled writer for evidence.
- [INFERRED] Log command, arguments, client version, vault ID, file hashes, and exit result in Falcon's own receipt.
- [INFERRED] Treat the open-beta status and subscription requirement as deployment risks, not as authority guarantees.

## Backup and portability

**Core rule:** [REPORTED] Obsidian says Sync and file recovery are not backups, so a dedicated one-way backup is required.

[REPORTED] Obsidian recommends a proper backup system because local data can be corrupted or lost. A backup should copy data to another location without changing the source. The documentation lists external drives, operating-system backups, NAS, cloud backup, and Git as possible approaches, with security trade-offs for cloud hosting.

Do:
- [REPORTED] Create independent one-way copies of the vault.
- [REPORTED] Test restoring a copy before depending on it.
- [REPORTED] Prefer plain Markdown and standard links when migration matters.

Do not:
- [REPORTED] Rely on Sync version history as the only recovery plan.
- [INFERRED] Make Obsidian-specific block references the only reference to a receipt or outcome.
- [INFERRED] Let a backup job mutate the source vault.

Workflow or code shape:
- [INFERRED] Generate a replay bundle from canonical records, then export a human-readable Obsidian view.
- [INFERRED] Include schema versions, source URLs, hashes, signatures, and parser versions in the bundle.
- [INFERRED] Keep migration tests for YAML, Markdown links, and any Obsidian-specific syntax used by the export.

## FalconOS fit

### Phase 0 fit

- [REPORTED] Local Markdown files, external editing, properties, links, search, and offline use match the need for human-readable notes and Brain context.
- [REPORTED] CLI and Headless Sync provide documented paths for scripts, CI, agents, and scheduled jobs. CLI requires the desktop app, while Headless is standalone and open beta.
- [REPORTED] Sync version history and independent backups help recovery, but Sync itself is not a backup.
- [INFERRED] Obsidian is suitable as a human review surface and advisory memory cache for Phoenix notes, protocol facts, runbooks, and redacted decision summaries.

### Required separation

- **Authoritative control state:** [INFERRED] Keep typed intent, versioned policy, capability scope, budgets, expiry, account locks, queue state, and signer permissions in Falcon's controlled store. Obsidian properties are editable and unauthenticated, so they cannot be the final authority.
- **Signed replay evidence:** [INFERRED] Keep canonical state snapshots, Brain output, verifier verdicts, transaction bindings, confirmations, reconciliations, and outcome records in append-only signed records. Obsidian can receive a readable export, but its links, YAML, Sync history, and plugin metadata do not provide Falcon's required signature and replay contract.
- **Advisory agent memory:** [INFERRED] Use Obsidian for user-edited context, protocol notes, explanations, research, and non-authoritative Brain hints. Tag provenance and freshness, then revalidate all facts before a live action.

### Gaps and risks

1. [INFERRED] No reviewed Obsidian page documents signed decision receipts, transaction-bound receipts, deterministic policy enforcement, or a public replay verifier.
2. [INFERRED] Plain files and properties do not authenticate authorship, ordering, freshness, or semantic intent.
3. [REPORTED] Community plugins have broad access, and Sync metadata does not cryptographically bind encrypted path to encrypted content.
4. [REPORTED] Sync conflict handling can merge Markdown or choose last-modified-wins for other files. [INFERRED] This is unsafe for authoritative financial events without a separate reconciliation gate.
5. [REPORTED] Shared vaults have equal collaborator permissions, no live same-file editing, a 20-user limit, and no on-premises Sync. [INFERRED] These constrain later Cloud tenancy and role isolation.
6. [REPORTED] Local vault data is not encrypted by Obsidian. [INFERRED] Cloud workers need OS, disk, process, and secret-store controls beyond the vault format.
7. [INFERRED] Obsidian-specific block references, plugin APIs, `.obsidian` settings, and Sync behavior create migration work even though Markdown lowers basic export risk.
8. [INFERRED] Headless Sync can feed a Cloud worker, but its open-beta status, subscription dependency, and file-level conflict semantics require a tested fallback.

### Recommended architecture

[INFERRED] Use a one-way boundary: Falcon writes signed canonical evidence and a sanitized Markdown projection; humans may edit advisory notes, but those edits enter Falcon through a parser, schema validation, provenance check, and fresh-state verifier. Agents receive read-only context by default. A typed Falcon command may request a write, but no Obsidian plugin, CLI, URI, or Headless credential can bypass Falcon's policy and signer boundary.

## Rules to adopt

1. [INFERRED] Treat Obsidian as advisory memory and human review, never as the final capital authority.
2. [INFERRED] Keep typed intent, policy, capability, queue, lock, and signer state outside the vault.
3. [INFERRED] Keep signed receipts and replay bundles outside editable Markdown, then publish readable projections.
4. [INFERRED] Bind every exported evidence view to canonical IDs and content hashes.
5. [REPORTED] Store notes in plain Markdown and keep paths stable for portability.
6. [REPORTED] Keep one vault root and avoid vaults within vaults.
7. [INFERRED] Use YAML properties only for small, validated indexing fields.
8. [INFERRED] Keep signatures, hashes, and canonical payloads out of mutable display fields.
9. [REPORTED] Use Markdown links when records must work outside Obsidian.
10. [INFERRED] Treat Obsidian block references as optional navigation, never as identity.
11. [REPORTED] Keep Restricted Mode on unless each community plugin has a documented trust decision.
12. [INFERRED] Do not grant plugin, CLI, URI, or Headless access to root keys or unrestricted financial tools.
13. [INFERRED] Record exact file hashes and parser versions for every Brain context snapshot.
14. [INFERRED] Re-read and revalidate selected files immediately before a live decision.
15. [REPORTED] Configure one Sync method per device and keep independent backups.
16. [INFERRED] Treat Sync conflicts, stale caches, missing files, and offline queues as input failures for new risk.
17. [REPORTED] Use Headless only with its documented Node.js, subscription, and open-beta constraints.
18. [INFERRED] Give Cloud workers read-only vault access unless a typed Falcon write is required.
19. [INFERRED] Export only redacted advisory context to shared or public vaults.
20. [INFERRED] Test migration for YAML, links, block references, plugin settings, and replay bundles before changing storage providers.

## Source coverage and unresolved fetches

Fetched and read:

- https://help.obsidian.md/
- https://help.obsidian.md/vault
- https://help.obsidian.md/create-note
- https://help.obsidian.md/link-notes
- https://help.obsidian.md/sync-notes
- https://help.obsidian.md/data-storage
- https://help.obsidian.md/links
- https://help.obsidian.md/properties
- https://help.obsidian.md/plugins
- https://help.obsidian.md/community-plugins
- https://help.obsidian.md/plugin-security
- https://help.obsidian.md/plugins/search
- https://help.obsidian.md/backup
- https://help.obsidian.md/sync
- https://help.obsidian.md/sync/vault-types
- https://help.obsidian.md/sync/settings
- https://help.obsidian.md/sync/version-history
- https://help.obsidian.md/sync/security
- https://help.obsidian.md/sync/collaborate
- https://help.obsidian.md/sync/headless
- https://help.obsidian.md/teams
- https://help.obsidian.md/teams/sync
- https://help.obsidian.md/teams/security
- https://help.obsidian.md/cli
- https://help.obsidian.md/uri
- https://docs.obsidian.md/
- https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin
- https://docs.obsidian.md/Plugins/Getting+started/Anatomy+of+a+plugin
- https://docs.obsidian.md/Plugins/Events
- https://docs.obsidian.md/Plugins/Vault

Could not fetch, and did not use as evidence:

- FreeCodeCamp's Practical Regex guide, linked by the Search page.
- Mozilla's regular expressions guide, linked by the Search page.
- Worldbackupday.com, linked by the backup page.
- Obsidian's external security audit reports and status page, linked by Sync security pages.
- Community plugin repositories and individual plugin code, because this report evaluates official documentation rather than plugin implementations.
