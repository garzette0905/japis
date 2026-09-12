-- JAPIS — Cloudflare D1 스키마 (사용자·화면권한·접속기록)
--
-- 적용 방법:
--   로컬(개발):  npx wrangler d1 execute japis-db --local  --file=./schema.sql
--   운영(배포):  npx wrangler d1 execute japis-db --remote --file=./schema.sql
--
-- 설계 원칙
--   · 회원가입이 없다. **관리자가 사람을 만든다.** 그래서 users 에는 초대한 흔적
--     (created_by)과 관리자만 보는 메모(note)가 함께 있다.
--   · 비밀번호는 PBKDF2-HMAC-SHA256 해시로만 둔다(cloudflare/index.js 의 hashPassword).
--     password_hash 가 NULL 이면 "아직 비밀번호를 정하지 않은 계정" — 그 사람은
--     비밀번호 없이 한 번 들어와 그 자리에서 비밀번호를 만든다.
--   · 서비스(화면) 목록 자체는 DB가 아니라 코드(cloudflare/services.js)에 있다.
--     화면이 늘어나는 일은 배포와 함께 일어나므로, 표를 손대지 않고 파일 한 줄로 는다.
--     이 표에는 "누가 어떤 화면을 볼 수 있는가"만 담는다.

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,

  email          TEXT NOT NULL UNIQUE,               -- 소문자로 정규화해 저장
  name           TEXT,

  -- NULL = 아직 비밀번호가 없다(최초 1회 비밀번호 없이 로그인 → 즉시 설정).
  -- 형식: 'pbkdf2$<반복수>$<salt>$<hash>'
  password_hash  TEXT,

  role           TEXT NOT NULL DEFAULT 'user',       -- 'admin' | 'user'
  status         TEXT NOT NULL DEFAULT 'active',     -- 'active' | 'blocked'

  -- 1이면 로그인해도 비밀번호를 바꾸기 전에는 아무 화면도 열리지 않는다.
  -- 최초 관리자와, 관리자가 비밀번호를 정해 준 새 사용자가 여기에 해당한다.
  must_change_pw INTEGER NOT NULL DEFAULT 1,

  created_at     TEXT NOT NULL,                      -- ISO8601
  last_login_at  TEXT,
  created_by     INTEGER,                            -- 이 사람을 만든 관리자 users.id
  note           TEXT,                               -- 관리자만 보는 메모

  -- 생체인증(패스키)에 심어 두는 임의의 손잡이. 휴대폰이 로그인할 때 이것을 돌려주면
  -- 누구인지 안다. users.id 를 남의 기기에 적어 두지 않으려고 따로 둔다.
  wa_handle      TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wa_handle ON users (wa_handle);

-- 누가 어떤 화면을 볼 수 있는가. 행이 **없으면 못 본다**(기본 거부).
--   · allowed = 1 이어야 상단 메뉴에 뜨고 /go/<key> 가 열린다.
--   · reauth  = 1 이면 그 화면에 들어갈 때마다 비밀번호를 한 번 더 받는다.
--   · unlock_ttl 은 그 재인증이 유지되는 초. NULL 이면 환경변수 기본값(600초).
--
-- 관리자(role='admin')는 이 표와 무관하게 모든 화면을 본다 — 권한을 스스로에게서
-- 지워 포털에 못 들어가는 상황을 만들지 않기 위해서다. 다만 재인증은 관리자에게도
-- 걸린다(아래 reauth 기본값은 services.js 가 정한다).
CREATE TABLE IF NOT EXISTS user_services (
  user_id     INTEGER NOT NULL,
  service_key TEXT    NOT NULL,
  allowed     INTEGER NOT NULL DEFAULT 1,
  reauth      INTEGER NOT NULL DEFAULT 1,
  unlock_ttl  INTEGER,
  PRIMARY KEY (user_id, service_key)
);

-- 접속·잠금해제 기록. "누가 언제 어느 화면을 열었나"를 관리자 화면에서 본다.
-- 비밀번호나 세션값은 담지 않는다. ip 는 진단용으로만 쓰고 90일 뒤 크론이 지운다.
CREATE TABLE IF NOT EXISTS access_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  email       TEXT,                                  -- 로그인 실패는 user_id 가 없어 이메일만 남는다
  action      TEXT NOT NULL,                         -- 'login' | 'login_fail' | 'logout' | 'unlock' | 'unlock_fail' | 'open'
  service_key TEXT,
  ok          INTEGER NOT NULL DEFAULT 1,
  ip          TEXT,
  ua          TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_access_log_created ON access_log (created_at);
CREATE INDEX IF NOT EXISTS idx_access_log_user ON access_log (user_id, created_at);

-- 생체인증(WebAuthn 패스키). 여기 있는 것은 **공개키뿐**이다 — 지문도, 개인키도
-- 휴대폰의 보안칩 밖으로 나오지 않는다. 이 표가 통째로 새어도 남의 계정으로
-- 로그인할 재료가 되지 않는다.
--
--   id       인증기가 만든 열쇠 번호(b64url). 주소마다 다른 열쇠가 만들어진다.
--   rp_id    그 열쇠가 매인 호스트. 여기서 만든 것은 여기서만 쓴다(피싱 방어).
--   alg      COSE 서명 알고리즘. -7(ES256) 또는 -257(RS256)만 받는다.
--   sign_count 복제된 인증기 탐지용. 휴대폰 대부분은 늘 0을 돌려준다.
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id           TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL,
  public_key   TEXT    NOT NULL,                     -- SPKI DER, b64url
  alg          INTEGER NOT NULL,
  rp_id        TEXT    NOT NULL,
  sign_count   INTEGER NOT NULL DEFAULT 0,
  transports   TEXT,                                 -- 'internal,hybrid' 같은 참고값
  label        TEXT,                                 -- 사람이 알아볼 기기 이름
  created_at   TEXT    NOT NULL,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_webauthn_user ON webauthn_credentials (user_id);

-- 협업 연동(구글·마이크로소프트)의 토큰. AES-GCM 으로 싸서 넣는다
-- (열쇠는 SESSION_SECRET 에서 뽑는다 — cloudflare/connect.js 의 seal/unseal).
-- 구글 포토·메일·캘린더는 provider='google' 하나를 나눠 쓴다.
CREATE TABLE IF NOT EXISTS connections (
  user_id       INTEGER NOT NULL,
  provider      TEXT    NOT NULL,                    -- 'google' | 'microsoft'
  refresh_token TEXT    NOT NULL,
  access_token  TEXT,
  expires_at    INTEGER,                             -- epoch ms
  account       TEXT,
  updated_at    TEXT    NOT NULL,
  PRIMARY KEY (user_id, provider)
);
