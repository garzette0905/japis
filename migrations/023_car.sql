-- Vehicle facts are imported separately into the owner's row, never into Git.
CREATE TABLE IF NOT EXISTS car_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data_json TEXT NOT NULL,
  oil_km INTEGER,
  oil_months INTEGER,
  tire_km INTEGER,
  tire_months INTEGER
);
CREATE TABLE IF NOT EXISTS car_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('mileage','oil','tire','repair')),
  date TEXT NOT NULL,
  km INTEGER,
  title TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  cost INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS car_entries_owner ON car_entries(user_id,date,id);
