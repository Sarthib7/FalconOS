CREATE TABLE waitlist_email_outbox (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE REFERENCES waitlist_entries(email),
  request_body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'inflight', 'accepted', 'failed', 'unknown')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  claim_id TEXT,
  first_attempt_at INTEGER,
  retry_until INTEGER,
  lease_until INTEGER,
  provider_email_id TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
