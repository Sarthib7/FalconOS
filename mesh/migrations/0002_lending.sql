DO $$
BEGIN
  IF (SELECT obj_description(oid, 'pg_namespace') FROM pg_namespace WHERE nspname = 'falcon_mesh')
      IS DISTINCT FROM 'falcon_mesh_schema_version=1' THEN
    RAISE EXCEPTION 'Lending migration requires Falcon mesh schema version 1';
  END IF;
END
$$;

CREATE TABLE falcon_mesh.lending_intents (
  owner_id text NOT NULL CHECK (owner_id ~ '^[a-z0-9_-]{1,64}$'),
  id uuid NOT NULL,
  request_id uuid NOT NULL,
  analysis_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  request jsonb NOT NULL CHECK (jsonb_typeof(request) = 'object' AND octet_length(request::text) <= 4096),
  intent jsonb NOT NULL CHECK (jsonb_typeof(intent) = 'object' AND octet_length(intent::text) <= 1048576),
  PRIMARY KEY (owner_id, id),
  UNIQUE (owner_id, request_id),
  FOREIGN KEY (owner_id, analysis_id) REFERENCES falcon_mesh.analyses (owner_id, id)
);

CREATE TABLE falcon_mesh.lending_events (
  owner_id text NOT NULL CHECK (owner_id ~ '^[a-z0-9_-]{1,64}$'),
  intent_id uuid NOT NULL,
  id uuid NOT NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  kind text NOT NULL CHECK (length(kind) <= 16 AND kind IN ('SUBMITTED', 'RECEIPT')),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 1048576),
  PRIMARY KEY (owner_id, id),
  UNIQUE (owner_id, request_id),
  FOREIGN KEY (owner_id, intent_id) REFERENCES falcon_mesh.lending_intents (owner_id, id)
);

CREATE UNIQUE INDEX lending_events_one_submission ON falcon_mesh.lending_events (owner_id, intent_id)
  WHERE kind = 'SUBMITTED';
CREATE INDEX lending_intents_owner_created ON falcon_mesh.lending_intents (owner_id, created_at DESC, id DESC);
CREATE INDEX lending_events_intent_created ON falcon_mesh.lending_events (owner_id, intent_id, created_at, id);

COMMENT ON SCHEMA falcon_mesh IS 'falcon_mesh_schema_version=2';
