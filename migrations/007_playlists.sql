-- 007 — Play Lists (가수와 곡) · 네이버 메모 화면 정리
--
--   npx wrangler d1 execute japis-db --remote --file=./migrations/007_playlists.sql
--
-- 설계
--   · 표를 둘로 나눈다 — **가수**(music_artists)와 **곡**(music_tracks). 곡 한 줄에
--     가수 이름을 적어 두는 편이 표는 하나로 끝나지만, 그러면 '이름을 고쳐 적은 순간'
--     같은 가수가 둘이 된다("아이유" / "IU"). 가수를 먼저 세우면 이름은 한 곳에만 있다.
--   · 곡이 없는 가수도 있을 수 있다. 먼저 이름만 적어 두고 나중에 채우는 일이 흔하다.
--   · 들을 주소(url)는 곡마다 **선택**이다. 멜론이든 유튜브든 적어 두면 한 번에 열리고,
--     안 적어도 목록은 목록대로 산다 — 이 화면의 본업은 재생이 아니라 **적어 두기**다.
--   · 사람마다 따로다. 모든 질의의 WHERE 에 user_id 가 붙는다(메모·북마크와 같다).

CREATE TABLE IF NOT EXISTS music_artists (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  name       TEXT    NOT NULL,
  memo       TEXT    NOT NULL DEFAULT '',       -- '발라드' · '운동할 때' 같은 한 마디
  created_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_music_artists_user ON music_artists (user_id, name);

CREATE TABLE IF NOT EXISTS music_tracks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  artist_id  INTEGER NOT NULL,
  title      TEXT    NOT NULL,
  url        TEXT    NOT NULL DEFAULT '',       -- 들을 주소(선택) — 멜론·유튜브 무엇이든
  memo       TEXT    NOT NULL DEFAULT '',
  starred    INTEGER NOT NULL DEFAULT 0,        -- 1 = 목록 맨 위
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_music_tracks_user   ON music_tracks (user_id, artist_id, sort_order);

-- Jaden wiki 를 쓰는 사람에게는 Play Lists 도 함께 열어 준다(북마크와 같은 이유).
INSERT OR IGNORE INTO user_services (user_id, service_key, allowed, reauth)
  SELECT user_id, 'playlists', 1, 0
    FROM user_services
   WHERE service_key = 'jadenwiki' AND allowed = 1;

-- ── 없어진 화면의 권한 정리 ──────────────────────────────────────────────
-- 네이버 메모는 목록에서 뺐습니다. 자체 제작(Jaden wiki)이 그 자리를 대신하고,
-- 네이버는 메모 API를 열지 않아 링크 한 줄 이상이 될 수 없었습니다.
-- 남겨 두어 봐야 아무 화면과도 이어지지 않습니다.
DELETE FROM user_services WHERE service_key = 'naver';
