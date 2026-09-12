-- 001 — 생체인증 · 협업 연동 · 메뉴 재구성
--
-- 이미 돌아가고 있는 D1에 적용합니다(schema.sql 의 CREATE TABLE IF NOT EXISTS 는
-- 표가 있으면 통째로 건너뛰므로, 나중에 더한 컬럼은 그쪽으로 생기지 않습니다).
--
--   npx wrangler d1 execute japis-db --remote --file=./migrations/001_biometric_connect_menu.sql
--
-- ⚠️ 한 번만 실행합니다. 다시 돌리면 ALTER TABLE 에서 "duplicate column" 으로 멈춥니다.
-- ⚠️ push 하기 전에 먼저 적용하세요 — 새 코드가 읽을 표가 배포 시점에 있어야 합니다.

-- ── 생체인증(WebAuthn 패스키) ────────────────────────────────────────────
ALTER TABLE users ADD COLUMN wa_handle TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wa_handle ON users (wa_handle);

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id           TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL,
  public_key   TEXT    NOT NULL,
  alg          INTEGER NOT NULL,
  rp_id        TEXT    NOT NULL,
  sign_count   INTEGER NOT NULL DEFAULT 0,
  transports   TEXT,
  label        TEXT,
  created_at   TEXT    NOT NULL,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_webauthn_user ON webauthn_credentials (user_id);

-- ── 협업 연동 토큰 ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS connections (
  user_id       INTEGER NOT NULL,
  provider      TEXT    NOT NULL,
  refresh_token TEXT    NOT NULL,
  access_token  TEXT,
  expires_at    INTEGER,
  account       TEXT,
  updated_at    TEXT    NOT NULL,
  PRIMARY KEY (user_id, provider)
);

-- ── 없어진 화면의 권한 정리 ──────────────────────────────────────────────
-- 온라인 갤러리·개인 위키·기업정보 에이전트는 목록에서 뺐고, 'google' 한 덩어리는
-- 포토·메일·캘린더 셋으로 나눴습니다. 남아 있어 봐야 아무 화면과도 이어지지 않습니다.
DELETE FROM user_services WHERE service_key IN ('gallery', 'wiki', 'enterprise', 'google');
