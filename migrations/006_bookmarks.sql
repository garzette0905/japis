-- 006 — 북마크 (사내·사외로 나눠 담는 주소록)
--
--   npx wrangler d1 execute japis-db --remote --file=./migrations/006_bookmarks.sql
--
-- 설계
--   · **사내와 사외를 먼저 가른다**(scope). 사내 주소는 회사 망 안에서만 열리므로
--     밖에서 눌러 봐야 시간만 버린다. 한 목록에 섞어 두고 눈으로 고르게 하지 않는다.
--   · 폴더는 **한 겹 더 들어간다**(parent_id). 두 겹이면 '어디에 넣었더라'가 시작되고,
--     한 겹도 없으면 스무 개가 넘는 순간 목록이 무너진다. 그 사이가 하나 들어간 폴더다.
--   · 북마크는 사람마다 따로다 — 모든 질의의 WHERE 에 user_id 가 붙는다(메모와 같다).
--   · 폴더를 지워도 그 안의 것은 지우지 않는다. '폴더 없음'으로 올려 두고,
--     지우는 일은 한 줄씩 사람이 한다.

CREATE TABLE IF NOT EXISTS bookmark_folders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  scope      TEXT    NOT NULL DEFAULT 'out',   -- 'in' 사내 | 'out' 사외
  parent_id  INTEGER,                          -- NULL = 맨 위 (한 겹까지만)
  name       TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bm_folders_user ON bookmark_folders (user_id, scope, sort_order);

CREATE TABLE IF NOT EXISTS bookmarks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL,
  scope          TEXT    NOT NULL DEFAULT 'out',
  folder_id      INTEGER,                       -- NULL = 폴더 없음
  title          TEXT    NOT NULL,
  url            TEXT    NOT NULL,
  memo           TEXT    NOT NULL DEFAULT '',
  pinned         INTEGER NOT NULL DEFAULT 0,    -- 1 = 목록 맨 위
  opens          INTEGER NOT NULL DEFAULT 0,    -- 몇 번 열었나(자주 쓰는 것을 위로)
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL,
  last_opened_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_user   ON bookmarks (user_id, scope, folder_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_opened ON bookmarks (user_id, last_opened_at);

-- 이미 Jaden wiki 를 쓰는 사람에게는 북마크도 함께 열어 준다. 둘은 같은 성격의
-- 개인 서비스이고, 새 화면이 늘 때마다 관리자가 권한표를 다시 짚어야 한다면
-- 화면을 늘리는 일이 번거로워진다. (관리자는 권한표와 무관하게 모두 본다.)
INSERT OR IGNORE INTO user_services (user_id, service_key, allowed, reauth)
  SELECT user_id, 'bookmarks', 1, 0
    FROM user_services
   WHERE service_key = 'jadenwiki' AND allowed = 1;
