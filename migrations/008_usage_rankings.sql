-- 008 — 메뉴·북마크·메모 폴더 사용량과 하루 단위 확정 순위
--
-- 클릭할 때는 click_count 만 올리고, Worker의 하루 한 번 예약 작업이 sort_rank 를
-- 갱신한다. 따라서 화면을 열 때마다 목록이 흔들리지 않는다.

CREATE TABLE IF NOT EXISTS usage_rankings (
  user_id            INTEGER NOT NULL,
  item_type          TEXT    NOT NULL,
  item_key           TEXT    NOT NULL,
  click_count        INTEGER NOT NULL DEFAULT 0,
  ranked_click_count INTEGER NOT NULL DEFAULT 0,
  sort_rank          INTEGER NOT NULL DEFAULT 2147483647,
  updated_at         TEXT    NOT NULL,
  ranked_at          TEXT,
  PRIMARY KEY (user_id, item_type, item_key)
);

CREATE INDEX IF NOT EXISTS idx_usage_rankings_order
  ON usage_rankings (user_id, item_type, sort_rank);
