-- Jaden AI NEWS 선호 학습 — 좋아하는 기사 주소 등록 · 카드 👍/👎 · 등록 기사에서 배운 출처.
-- 자세한 설명은 cloudflare/news-prefs.js 와 docs/AI-NEWS.md.
CREATE TABLE IF NOT EXISTS news_feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  url        TEXT    NOT NULL UNIQUE,          -- 비교용으로 정리한 주소(추적 파라미터 제거)
  link       TEXT    NOT NULL,                 -- 원래 주소
  vote       INTEGER NOT NULL,                 -- 1 좋아요 · -1 싫어요
  origin     TEXT    NOT NULL DEFAULT 'card',  -- submit(주소 등록) · card(카드 평가)
  title      TEXT    NOT NULL DEFAULT '',
  summary    TEXT    NOT NULL DEFAULT '',
  domain     TEXT    NOT NULL DEFAULT '',
  vector     TEXT,                             -- Workers AI bge-m3 임베딩(int8 base64). 실패하면 NULL(제목 특징으로 비교)
  user_id    INTEGER,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_news_feedback_vote ON news_feedback (vote, id DESC);

CREATE TABLE IF NOT EXISTS news_sources (
  domain      TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  feed_url    TEXT NOT NULL,
  format      TEXT NOT NULL,                   -- rss · html(목록 화면) · bing(사이트 검색)
  kind        TEXT NOT NULL DEFAULT 'news',    -- news · official · report
  link_prefix TEXT,                            -- html: 글 주소가 시작하는 경로
  created_at  TEXT NOT NULL
);
