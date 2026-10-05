DO $$
BEGIN
  IF (SELECT obj_description(oid, 'pg_namespace') FROM pg_namespace WHERE nspname = 'falcon_mesh')
      IS DISTINCT FROM 'falcon_mesh_schema_version=2' THEN
    RAISE EXCEPTION 'Wallet auth migration requires Falcon mesh schema version 2';
  END IF;
END
$$;

CREATE TABLE falcon_mesh.wallet_auth_challenges (
  challenge_id uuid PRIMARY KEY,
  wallet_address text NOT NULL CHECK (wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  origin text NOT NULL CHECK (octet_length(origin) BETWEEN 1 AND 255),
  message text NOT NULL CHECK (octet_length(message) BETWEEN 1 AND 4096),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes')
);

CREATE INDEX wallet_auth_challenges_expiry
  ON falcon_mesh.wallet_auth_challenges (expires_at);

CREATE TABLE falcon_mesh.wallet_auth_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  wallet_address text NOT NULL CHECK (wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  owner_id text NOT NULL CHECK (owner_id ~ '^wallet_[a-f0-9]{56}$'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 minutes'),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX wallet_auth_sessions_expiry
  ON falcon_mesh.wallet_auth_sessions (expires_at);

COMMENT ON SCHEMA falcon_mesh IS 'falcon_mesh_schema_version=3';
