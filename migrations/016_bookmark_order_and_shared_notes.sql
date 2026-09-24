-- 북마크의 수동 순서와 공유 화면 메뉴 권한.
ALTER TABLE bookmarks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO user_services (user_id, service_key, allowed, reauth)
  SELECT user_id, 'sharednotes', 1, 0
    FROM user_services
   WHERE service_key = 'jadenwiki' AND allowed = 1;
