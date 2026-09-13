-- 004 — Jaden wiki (포털 안 메모)
--
-- 로드맵의 "네이버 메모 자체 제작" 자리다. 메모·폴더·첨부파일 이름표 세 표를 만든다.
--
--   npx wrangler d1 execute japis-db --remote --file=./migrations/004_wiki.sql
--
-- 설계
--   · 메모는 **사람마다 따로다**(user_id). 같은 포털을 쓰는 다른 사람의 메모는
--     목록 질의 자체에 걸리지 않는다 — 권한 검사를 잊어도 새지 않게 WHERE 에 늘 붙인다.
--   · 본문은 html 과 plain 을 나란히 둔다. 화면에 그리는 것은 html, 검색이 훑는 것은
--     plain 이다(태그 사이에 낀 글자를 LIKE 로 찾으면 <b>를 걸러내지 못한다).
--   · 지운 메모는 지우지 않는다. deleted_at 에 시각을 적어 휴지통으로 옮기고,
--     거기서 한 번 더 눌러야 진짜 사라진다.
--   · 그림 파일 자체는 R2(WIKI_FILES)에 있고, 이 표에는 이름표만 둔다.

CREATE TABLE IF NOT EXISTS wiki_folders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  name       TEXT    NOT NULL,
  color      TEXT    NOT NULL DEFAULT 'sky',   -- 왼쪽 목록의 점 색(장식 전용)
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wiki_folders_user ON wiki_folders (user_id, sort_order);

CREATE TABLE IF NOT EXISTS wiki_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  folder_id  INTEGER,                          -- NULL = 폴더 없음('내 메모'로 뜬다)
  title      TEXT    NOT NULL DEFAULT '',
  html       TEXT    NOT NULL DEFAULT '',      -- 서버에서 한 번 씻어 낸 본문
  plain      TEXT    NOT NULL DEFAULT '',      -- 검색용 민글자
  tags       TEXT    NOT NULL DEFAULT '',      -- '#여행 #메모' — 본문의 #태그를 뽑아 둔다
  starred    INTEGER NOT NULL DEFAULT 0,       -- 1 = 중요
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  deleted_at TEXT                              -- NULL 이 아니면 휴지통
);

CREATE INDEX IF NOT EXISTS idx_wiki_notes_user    ON wiki_notes (user_id, deleted_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_wiki_notes_folder  ON wiki_notes (user_id, folder_id);

CREATE TABLE IF NOT EXISTS wiki_files (
  id         TEXT    PRIMARY KEY,              -- R2 안에서의 이름이기도 하다
  user_id    INTEGER NOT NULL,
  name       TEXT,
  mime       TEXT    NOT NULL,
  size       INTEGER NOT NULL,
  created_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wiki_files_user ON wiki_files (user_id, created_at);
