DO $$
BEGIN
  IF (SELECT obj_description(oid, 'pg_namespace') FROM pg_namespace WHERE nspname = 'falcon_mesh')
      IS DISTINCT FROM 'falcon_mesh_schema_version=3' THEN
    RAISE EXCEPTION 'MCP OAuth migration requires Falcon mesh schema version 3';
  END IF;
END
$$;

CREATE TABLE falcon_mesh.oauth_authorization_requests (
  request_hash text PRIMARY KEY CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  client_id text NOT NULL CHECK (octet_length(client_id) BETWEEN 1 AND 2048),
  client_name text NOT NULL CHECK (octet_length(client_name) BETWEEN 1 AND 128),
  redirect_uri text NOT NULL CHECK (octet_length(redirect_uri) BETWEEN 1 AND 2048),
  state text NOT NULL CHECK (octet_length(state) BETWEEN 1 AND 512),
  code_challenge text NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  resource text NOT NULL CHECK (octet_length(resource) BETWEEN 1 AND 512),
  scope text NOT NULL CHECK (scope = 'falcon'),
  challenge_id uuid,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes'),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX oauth_authorization_requests_expiry
  ON falcon_mesh.oauth_authorization_requests (expires_at);

CREATE TABLE falcon_mesh.oauth_authorization_codes (
  code_hash text PRIMARY KEY CHECK (code_hash ~ '^[a-f0-9]{64}$'),
  client_id text NOT NULL CHECK (octet_length(client_id) BETWEEN 1 AND 2048),
  redirect_uri text NOT NULL CHECK (octet_length(redirect_uri) BETWEEN 1 AND 2048),
  code_challenge text NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  resource text NOT NULL CHECK (octet_length(resource) BETWEEN 1 AND 512),
  scope text NOT NULL CHECK (scope = 'falcon'),
  owner_id text NOT NULL CHECK (owner_id ~ '^wallet_[a-f0-9]{56}$'),
  wallet_address text NOT NULL CHECK (wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '2 minutes')
);

CREATE INDEX oauth_authorization_codes_expiry
  ON falcon_mesh.oauth_authorization_codes (expires_at);

CREATE TABLE falcon_mesh.oauth_access_tokens (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  client_id text NOT NULL CHECK (octet_length(client_id) BETWEEN 1 AND 2048),
  resource text NOT NULL CHECK (octet_length(resource) BETWEEN 1 AND 512),
  scope text NOT NULL CHECK (scope = 'falcon'),
  owner_id text NOT NULL CHECK (owner_id ~ '^wallet_[a-f0-9]{56}$'),
  wallet_address text NOT NULL CHECK (wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 minutes'),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX oauth_access_tokens_expiry
  ON falcon_mesh.oauth_access_tokens (expires_at);

COMMENT ON SCHEMA falcon_mesh IS 'falcon_mesh_schema_version=4';