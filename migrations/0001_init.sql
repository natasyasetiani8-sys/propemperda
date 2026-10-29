CREATE TABLE IF NOT EXISTS records (
  kind TEXT NOT NULL CHECK (kind IN ('propemperda', 'ranperda')),
  id TEXT NOT NULL,
  year INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);
CREATE INDEX IF NOT EXISTS records_by_kind_order ON records(kind, sort_order);
CREATE INDEX IF NOT EXISTS records_by_kind_year ON records(kind, year);

CREATE TABLE IF NOT EXISTS surveys (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS surveys_by_date ON surveys(at, id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS daily_visits (
  day TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  session_version INTEGER NOT NULL DEFAULT 1
);
