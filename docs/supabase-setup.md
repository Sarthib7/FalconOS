# Supabase mesh setup

[VERIFIED, user configuration] The selected project is `mcmxfwkhdzzsfpvldgdw`. Codex OAuth returned `Successfully logged in.` A fresh Codex process can call its Supabase MCP tools. The current conversation's tool registry did not reload after registration.

[VERIFIED, hosted application, 2026-09-27] The user approved the reviewed setup. Supabase returned `{"success":true}` and recorded migration `20260927114601`, named `falcon_mesh_initial_private`. The hosted catalog and permission comparison passed `21/21`. All five tables contain zero rows. The role remains `NOLOGIN`. See the [hosted verification](verification/2026-09-27-supabase.md#hosted-application-after-approval). This supersedes the earlier unapplied candidate state.

## Target and scope

[VERIFIED, pre-application MCP result] PostgreSQL returned `17.6`. Before application, the `falcon_mesh` schema and its five expected tables were absent. The [catalog response](verification/2026-09-27-supabase/schema-mcp.json) records the exact queries and results. The [role response](verification/2026-09-27-supabase/roles-watchers-mcp.json) contains `postgres` with `rolcreaterole: true` and no `falcon_mesh_app` role at that time.

[REPORTED, inspector metadata] Supabase's user migration list returned `[]`. A name search found no waitlist objects. That search does not inspect object contents or prove that no other signup implementation exists. See the [reported metadata](verification/2026-09-27-supabase/reported-metadata.json).

[INFERRED, setup candidate] Keep the existing Node API. Store its sources, analyses, lending intents, and lending events in Supabase PostgreSQL. The browser continues to call the API. It receives no database credential. The separate Cloudflare waitlist handler remains unchanged by this setup.

## SQL for review

[VERIFIED, repository SQL] The candidate applies these files in order:

1. [Initial schema](../mesh/schema.sql): create `falcon_mesh`, three tables, constraints, and the analysis-history index.
2. [Lending migration](../mesh/migrations/0002_lending.sql): require version 1, add two tables and three indexes, then mark version 2.
3. [Runtime permissions](../mesh/deploy/supabase-permissions.sql): create `falcon_mesh_app` with login disabled and grant the API's required operations.

[VERIFIED, repository SQL] These files contain no drops, renames, or changes to existing application tables. The permission file removes `PUBLIC`, `anon`, `authenticated`, and `service_role` access only inside `falcon_mesh`. It changes no default privileges. The new role can select and insert in the five tables. It can update only `source_heads.revision_id`. It receives no delete, truncate, schema creation, or parent role grants.

[VERIFIED, local non-superuser probe] PostgreSQL automatically grants the creator administration of the new role. The [probe](verification/2026-09-27-supabase/creator-role-proof.json) returned `admin_option: true`, `inherit_option: false`, and `set_option: false`. The application role receives no parent role. This matches PostgreSQL's documented [role creation behavior](https://www.postgresql.org/docs/17/role-attributes.html).

[INFERRED, execution boundary] Apply all three reviewed files in one transaction, only after hosted-schema approval. Schema creation fails if the schema already exists. Role creation fails if the role already exists. Inspect unexpected objects before retrying. Recheck the resulting constraints, indexes, grants, and role attributes; the application's readiness check covers only the version marker and column shape.

## Local verification

[VERIFIED, local proof] The candidate passed `41/41` migration and permission checks on disposable PostgreSQL `17.7`. The resulting catalog contains five tables, 33 columns, 26 constraints, and 13 indexes. Seeded version 1 rows retained their exact fingerprints through the lending migration. See the [proof and limits](verification/2026-09-27-supabase.md).

[VERIFIED, coordinator command] The full mesh suite returned `tests 101`, `pass 101`, `fail 0`, `skipped 0`. Each connection used the effective `falcon_mesh_app` role. This proves the tested SQL permissions, not a hosted login, TLS, or pooler connection. The hosted service runs `17.6`; its later catalog verification is recorded above.

## Runtime connection

[VERIFIED, source: `mesh/server.mjs`] The API already accepts `DATABASE_URL` and limits its pool to five connections. It needs no Supabase JavaScript client or wallet-authentication change.

[INFERRED, deployment choice] Use a direct TLS connection for an IPv6-capable persistent host. Use the session pooler on port 5432 for an IPv4-only host. Copy the exact endpoint from the project's Connect dialog. Supabase documents these [connection choices](https://supabase.com/docs/guides/database/connecting-to-postgres).

[VERIFIED, installed driver review] `pg-connection-string` accepts `sslmode=verify-full` and `sslrootcert`. The runtime needs the correct CA file and a privately configured database password before connection testing. The candidate role stays `NOLOGIN` until that configuration is ready.

[INFERRED, privacy boundary] Keep `falcon_mesh` outside the Data API's exposed schemas. PostgreSQL grants also deny the usual Data API roles access to these objects. Supabase documents custom-schema exposure separately from [schema privileges](https://supabase.com/docs/guides/api/using-custom-schemas). The API remains responsible for separating Falcon owners; the database role is shared by the API.

## Least confident decisions

1. [NOT DETERMINED] The runtime host's usable network path, exact endpoint, and TLS certificate have not been tested.
2. [NOT DETERMINED] PostgREST's external exposed-schema configuration is not established by null database settings. The setup must retain the explicit database permission boundary.
3. [NOT DETERMINED] A hosted application connection and its effective timeout values require runtime credentials. MCP catalog access does not prove that connection.
