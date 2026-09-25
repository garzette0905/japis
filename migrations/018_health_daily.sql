-- 018 — 헬스정보 · 삼성헬스 탭 (걸음 · 잠 · 심박 · 체중을 하루 한 값으로)
--
--   npx wrangler d1 execute japis-db --remote --file=./migrations/018_health_daily.sql
--
-- 검진 표(health_exams · health_results)와 나눈다. 저쪽은 '회차 × 항목'이고 한 해에
-- 한두 번, 이쪽은 '날짜 × 항목'이고 매일이다(11년치 ≈ 4만 줄).
--
-- 값은 브라우저가 삼성헬스 내보내기 폴더를 읽어 하루 한 값으로 접어 올린다
-- (web/public/shealth-parse.js). 항목 이름표는 코드에 있다(cloudflare/samsung.js) —
-- 스무 개 남짓이고 사람마다 다르지 않아 표로 둘 까닭이 없다.

CREATE TABLE IF NOT EXISTS health_daily (
  user_id    INTEGER NOT NULL,
  code       TEXT    NOT NULL,                  -- steps · sleep_h · hr_avg · weight …
  day        TEXT    NOT NULL,                  -- 'YYYY-MM-DD' (그곳의 날짜 — 시차를 더한 뒤 자른 것)
  value      REAL    NOT NULL,
  updated_at TEXT    NOT NULL,
  -- 항목 하나의 전 기간을 날짜 순으로 읽는 것이 거의 전부라 이 차례로 묶는다.
  PRIMARY KEY (user_id, code, day)
) WITHOUT ROWID;

-- 요약 타일이 '최근 14일'을 항목 가리지 않고 읽는다.
CREATE INDEX IF NOT EXISTS idx_health_daily_day ON health_daily (user_id, day);

-- 언제 무엇을 올렸나. 화면의 '마지막으로 가져온 때'가 이것을 읽는다.
CREATE TABLE IF NOT EXISTS health_daily_imports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  imported_at TEXT    NOT NULL,
  source      TEXT    NOT NULL DEFAULT '',      -- 내보내기 폴더 이름(samsunghealth_<id>_<시각>)
  rows        INTEGER NOT NULL DEFAULT 0,
  first_day   TEXT,
  last_day    TEXT
);
CREATE INDEX IF NOT EXISTS idx_health_daily_imports ON health_daily_imports (user_id, id DESC);
