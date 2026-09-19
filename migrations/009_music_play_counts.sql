-- 009 — Play Lists 재생 횟수
--
--   npx wrangler d1 execute japis-db --remote --file=./migrations/009_music_play_counts.sql
--
-- '듣기' 클릭을 누적할 칼럼을 더하고, FLO에서 옮겨 적은
-- "FLO 스트리밍 횟수: N회" 메모를 초기값으로 한 번만 복사한다.
-- 메모는 사용자가 적은 원본이므로 지우거나 바꾸지 않는다.

ALTER TABLE music_tracks ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE music_tracks ADD COLUMN last_played_at TEXT;

UPDATE music_tracks
   SET play_count = CAST(
         replace(replace(trim(memo), 'FLO 스트리밍 횟수: ', ''), '회', '')
         AS INTEGER
       )
 WHERE play_count = 0
   AND trim(memo) GLOB 'FLO 스트리밍 횟수: [0-9]*회';

CREATE INDEX IF NOT EXISTS idx_music_tracks_plays
  ON music_tracks (user_id, starred DESC, play_count DESC);
