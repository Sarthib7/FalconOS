CREATE ROLE falcon_mesh_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS NOINHERIT;

REVOKE ALL ON SCHEMA falcon_mesh FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA falcon_mesh FROM PUBLIC, anon, authenticated, service_role;

GRANT CONNECT ON DATABASE postgres TO falcon_mesh_app;
GRANT USAGE ON SCHEMA falcon_mesh TO falcon_mesh_app;
GRANT SELECT, INSERT ON
  falcon_mesh.source_revisions,
  falcon_mesh.source_heads,
  falcon_mesh.analyses,
  falcon_mesh.lending_intents,
  falcon_mesh.lending_events
TO falcon_mesh_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  falcon_mesh.wallet_auth_challenges,
  falcon_mesh.wallet_auth_sessions
TO falcon_mesh_app;
GRANT UPDATE (revision_id) ON falcon_mesh.source_heads TO falcon_mesh_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  falcon_mesh.wallet_auth_challenges,
  falcon_mesh.wallet_auth_sessions
TO falcon_mesh_app;
