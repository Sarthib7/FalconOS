CREATE SCHEMA falcon_mesh;
COMMENT ON SCHEMA falcon_mesh IS 'falcon_mesh_schema_version=1';

CREATE TABLE falcon_mesh.source_revisions (
  owner_id text NOT NULL CHECK (owner_id ~ '^[a-z0-9_-]{1,64}$'),
  revision_id uuid NOT NULL,
  source_key text NOT NULL,
  source_url text NOT NULL,
  observed_at timestamptz NOT NULL,
  captured_at timestamptz NOT NULL CHECK (captured_at >= observed_at),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  content text NOT NULL CHECK (octet_length(content) <= 131072),
  PRIMARY KEY (owner_id, revision_id),
  UNIQUE (owner_id, source_key, revision_id)
);

CREATE TABLE falcon_mesh.source_heads (
  owner_id text NOT NULL,
  source_key text NOT NULL,
  revision_id uuid NOT NULL,
  PRIMARY KEY (owner_id, source_key),
  FOREIGN KEY (owner_id, source_key, revision_id)
    REFERENCES falcon_mesh.source_revisions (owner_id, source_key, revision_id)
);

CREATE TABLE falcon_mesh.analyses (
  owner_id text NOT NULL CHECK (owner_id ~ '^[a-z0-9_-]{1,64}$'),
  id uuid NOT NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  observation_id text NOT NULL,
  max_hops smallint NOT NULL CHECK (max_hops BETWEEN 1 AND 3),
  graph jsonb NOT NULL CHECK (jsonb_typeof(graph) = 'object'),
  analysis jsonb NOT NULL CHECK (jsonb_typeof(analysis) = 'object'),
  PRIMARY KEY (owner_id, id),
  UNIQUE (owner_id, request_id)
);

CREATE INDEX analyses_owner_created_at ON falcon_mesh.analyses (owner_id, created_at DESC, id DESC);
