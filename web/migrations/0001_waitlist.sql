CREATE TABLE IF NOT EXISTS waitlist_entries (
  email TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS waitlist_entries_ip_created_idx
  ON waitlist_entries (ip_hash, created_at);

CREATE TABLE IF NOT EXISTS waitlist_rate_limits (
  ip_hash TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
