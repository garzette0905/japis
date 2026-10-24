-- Idempotent, additive storage for hourly summaries and individual export records.
CREATE TABLE IF NOT EXISTS health_hourly (
  user_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  day TEXT NOT NULL,
  hour INTEGER NOT NULL CHECK(hour BETWEEN 0 AND 23),
  value REAL NOT NULL,
  minimum REAL NOT NULL,
  maximum REAL NOT NULL,
  duration_ms REAL NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, code, day, hour)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS health_records (
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  day TEXT NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, kind, source_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_health_records_day ON health_records(user_id, kind, day);
