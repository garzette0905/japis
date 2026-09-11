// JAPIS — Jaden's Automated Personal Intelligence Service
//
// Cloudflare Worker 하나가 백엔드 전부다(wepic·가계부와 같은 얼개).
//   · 정적 화면  : web/public 을 그대로 서빙(빌드 단계 없음)
//   · 세션·잠금  : Workers KV (SESSIONS)
//   · 사용자·권한: D1 (DB) — schema.sql
//
// 이 포털의 규칙 세 가지. 어느 하나라도 클라이언트에 맡기지 않는다.
//   1. **첫 화면은 로그인뿐이다.** 어떤 주소로 들어와도 껍데기(index.html)만 나가고,
//      메뉴·서비스 목록·주소는 전부 로그인한 뒤 API로만 받는다. 그래서 주소창에
//      /admin 을 쳐도 볼 것이 없다 — 화면에 그릴 재료 자체가 서버에서 안 나간다.
//   2. **화면마다 다시 인증한다.** 서비스 주소는 응답에 담지 않는다. 실제 주소는
//      /go/<key> 가 302로만 알려주고, 그 앞에 잠금해제(재인증)를 세워 둔다.
//   3. **가입이 없다.** 관리자가 사람을 만들고, 그 사람이 볼 화면을 골라 준다.

import { GROUPS, SERVICES, serviceOf, isAlways, isReady } from './services.js';

const enc = new TextEncoder();
const nowIso = () => new Date().toISOString();

// ──────────────────────────────────────────────────────────────
// 공통 응답
// ──────────────────────────────────────────────────────────────

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

/** 실패 응답. code 는 화면이 분기에 쓴다(unauthorized · must_change_pw · locked …). */
const fail = (error, status = 400, extra = {}) => json({ error, ...extra }, status);

const text = (body, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

const redirect = (location, headers = {}) =>
  new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store', ...headers } });

// ──────────────────────────────────────────────────────────────
// 작은 도구들
// ──────────────────────────────────────────────────────────────

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s) {
  const t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomId(bytes = 24) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return b64url(a);
}

/** 길이가 달라도 일찍 빠져나가지 않는 비교. 비밀번호 해시·서명 확인에 쓴다. */
function timingSafeEqual(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= x.charCodeAt(i % (x.length || 1)) ^ y.charCodeAt(i % (y.length || 1));
  }
  return diff === 0;
}

function parseCookies(request) {
  const out = {};
  (request.headers.get('Cookie') || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

const clientIp = (request) => request.headers.get('CF-Connecting-IP') || null;
const clientUa = (request) => (request.headers.get('User-Agent') || '').slice(0, 200) || null;

/**
 * 이 요청을 어느 주소 기준으로 볼 것인가.
 * 여러 주소로 동시에 서비스되므로(운영 도메인 · *.workers.dev · 로컬), 절대주소가 필요한
 * 곳은 고정값이 아니라 들어온 주소를 쓴다. 다만 아무 Host나 믿으면 엉뚱한 주소로 링크를
 * 만들게 유도당하므로, 아는 곳(SITE_HOSTS · *.workers.dev · localhost)만 그대로 쓴다.
 */
function baseUrlOf(request, env) {
  const url = new URL(request.url);
  const host = url.hostname;
  const allow = String(env.SITE_HOSTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const local = host === 'localhost' || host === '127.0.0.1';
  if (local) return url.origin;
  if (host.endsWith('.workers.dev') || allow.includes(host.toLowerCase())) return `https://${host}`;
  return allow.length ? `https://${allow[0]}` : url.origin;
}

/**
 * CSRF 방어: 상태를 바꾸는 요청(POST/PUT/PATCH/DELETE)은 같은 출처에서 온 것만 받는다.
 * 라우팅 맨 앞에서 한 번 검사해 엔드포인트를 하나라도 빠뜨리는 일이 없게 한다.
 */
function sameOriginRequest(request) {
  const m = request.method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return true;
  const origin = request.headers.get('Origin');
  if (!origin) return true; // 브라우저가 아닌 요청(curl 등)은 세션 쿠키가 없어 어차피 막힌다
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────────────────────
// 비밀번호 — PBKDF2-HMAC-SHA256
// ──────────────────────────────────────────────────────────────

// ⚠️ Cloudflare Workers 는 PBKDF2 반복 횟수를 **10만 회로 막아 두었다**.
//    더 크게 잡으면 운영에서 NotSupportedError 로 로그인 자체가 죽는다.
//    (로컬 개발서버(miniflare)에는 이 제한이 없어 로컬에서만 멀쩡해 보인다.)
const PBKDF2_ITER = 100000;
const PBKDF2_MAX_ITER = 100000;

async function pbkdf2(password, saltBytes, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    key,
    256
  );
  return new Uint8Array(bits);
}

/** 저장 형식: 'pbkdf2$<반복수>$<salt>$<hash>' — 반복수를 값에 적어 두면 나중에 세기를 올려도 옛 비밀번호가 열린다. */
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITER);
  return `pbkdf2$${PBKDF2_ITER}$${b64url(salt)}$${b64url(hash)}`;
}

async function verifyPassword(password, stored) {
  try {
    const [scheme, iterStr, saltStr, hashStr] = String(stored || '').split('$');
    if (scheme !== 'pbkdf2') return false;
    const iter = parseInt(iterStr, 10);
    if (!Number.isFinite(iter) || iter < 1000 || iter > PBKDF2_MAX_ITER) return false;
    const got = await pbkdf2(password, b64urlToBytes(saltStr), iter);
    return timingSafeEqual(b64url(got), hashStr);
  } catch {
    return false;
  }
}

function passwordProblem(pw) {
  const s = String(pw || '');
  if (s.length < 8) return '비밀번호는 8자 이상이어야 합니다.';
  if (s.length > 200) return '비밀번호가 너무 깁니다.';
  if (!/[A-Za-z]/.test(s) || !/[0-9]/.test(s)) return '비밀번호에 영문과 숫자를 함께 넣어주세요.';
  return null;
}

// ──────────────────────────────────────────────────────────────
// 세션
// ──────────────────────────────────────────────────────────────

const COOKIE = 'jsid';
const SESSION_TTL = 60 * 60 * 24 * 14; // 14일

function sessionSecret(env) {
  const s = env.SESSION_SECRET;
  return s && String(s).length >= 16 ? String(s) : null;
}

async function signSid(env, sid) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(sessionSecret(env)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(sid));
  return b64url(new Uint8Array(sig)).slice(0, 32);
}

/**
 * 세션에 **그때의 비밀번호 지문**을 함께 담는다. 비밀번호를 바꾸면 해시가 바뀌어 지문이
 * 어긋나고, 그 순간 다른 곳에 열어 둔 창이 전부 끊긴다. 이게 없으면 비밀번호가 샜을 때
 * 바꾸는 의미가 없다. 세션 목록을 따로 들고 다니지 않아도 users 행 하나로 판정된다.
 */
const pwFingerprint = (hash) => String(hash || 'none').slice(-16);

async function createSession(env, user) {
  const sid = randomId(24);
  await env.SESSIONS.put(
    `sess:${sid}`,
    JSON.stringify({ uid: user.id, pwv: pwFingerprint(user.password_hash), at: nowIso() }),
    { expirationTtl: SESSION_TTL }
  );
  return { sid, cookie: `${sid}.${await signSid(env, sid)}` };
}

async function readSession(request, env) {
  if (!sessionSecret(env)) return null;
  const raw = parseCookies(request)[COOKIE];
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot < 0) return null;
  const sid = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  // 서명이 안 맞으면 KV를 들여다보지도 않는다(엉뚱한 열쇠로 KV를 훑지 못하게).
  if (!timingSafeEqual(sig, await signSid(env, sid))) return null;
  const v = await env.SESSIONS.get(`sess:${sid}`, 'json');
  return v ? { sid, ...v } : null;
}

function cookieHeader(value, request, maxAge = SESSION_TTL) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

const clearCookieHeader = (request) => cookieHeader('', request, 0);

// ──────────────────────────────────────────────────────────────
// 화면 잠금해제(재인증)
// ──────────────────────────────────────────────────────────────
//
// 세션과 **따로** 둔다. 로그인은 "포털에 들어올 수 있는가"이고, 잠금해제는 "지금 이
// 화면을 열 수 있는가"다. 잠금해제는 세션(sid)에 매달려 있으므로 로그아웃하거나 다른
// 기기로 옮기면 함께 사라진다. KV의 만료를 그대로 쓰기 때문에 따로 청소할 것이 없다.

const UNLOCK_MIN = 60;      // KV expirationTtl 최소값이 60초다
const UNLOCK_MAX = 60 * 60; // 한 시간이 넘게 열어 둘 이유가 없다

function unlockTtl(env, perm) {
  const fromPerm = Number(perm?.unlock_ttl);
  const fromEnv = Number(env.UNLOCK_TTL_SECONDS);
  const v = Number.isFinite(fromPerm) && fromPerm > 0 ? fromPerm : Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 600;
  return Math.min(UNLOCK_MAX, Math.max(UNLOCK_MIN, Math.round(v)));
}

const unlockKvKey = (sid, key) => `unlock:${sid}:${key}`;

const setUnlock = (env, sid, key, ttl) =>
  env.SESSIONS.put(unlockKvKey(sid, key), String(Date.now() + ttl * 1000), { expirationTtl: ttl });

async function unlockedUntil(env, sid, key) {
  const v = await env.SESSIONS.get(unlockKvKey(sid, key));
  const until = Number(v);
  return Number.isFinite(until) && until > Date.now() ? until : 0;
}

// 잠금해제 시도 제한 — 한 세션에서 한 화면당 창(5분) 안에 10번까지.
const UNLOCK_TRY_MAX = 10;
const UNLOCK_TRY_WINDOW = 300;
const tryKvKey = (scope) => `try:${scope}`;

async function tryCount(env, scope) {
  return Number((await env.SESSIONS.get(tryKvKey(scope))) || 0);
}
async function bumpTry(env, scope) {
  const n = (await tryCount(env, scope)) + 1;
  await env.SESSIONS.put(tryKvKey(scope), String(n), { expirationTtl: UNLOCK_TRY_WINDOW });
  return n;
}
const clearTry = (env, scope) => env.SESSIONS.delete(tryKvKey(scope));

// ──────────────────────────────────────────────────────────────
// 사용자
// ──────────────────────────────────────────────────────────────

const userView = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  status: u.status,
  mustChangePw: !!u.must_change_pw,
  hasPassword: !!u.password_hash,
  createdAt: u.created_at,
  lastLoginAt: u.last_login_at,
  note: u.note || '',
});

const getUser = (env, id) => env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
const getUserByEmail = (env, email) =>
  env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(String(email || '').trim().toLowerCase()).first();

const isEmailLike = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || ''));

/**
 * users 표가 비어 있으면 최초 관리자를 만든다.
 *
 * **비밀번호를 심지 않는다(password_hash = NULL).** 요구사항대로 이 계정은 처음 한 번
 * 비밀번호 없이 들어오고, 들어오자마자 비밀번호를 정한다(must_change_pw = 1).
 * 비밀번호가 정해지는 순간 password_hash 가 채워지므로 이 문은 스스로 닫힌다.
 *
 * 한 명이라도 있으면 두 번 다시 동작하지 않는다 — 나중에 관리자를 지워도 되살아나지 않는다.
 */
async function ensureBootstrapAdmin(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  if (row && row.n > 0) return;
  const email = String(env.ADMIN_EMAIL || 'garzette@paran.com').trim().toLowerCase();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (email, name, password_hash, role, status, must_change_pw, created_at)
     VALUES (?, '관리자', NULL, 'admin', 'active', 1, ?)`
  )
    .bind(email, nowIso())
    .run();
}

// ──────────────────────────────────────────────────────────────
// 화면 권한
// ──────────────────────────────────────────────────────────────

/** user_services 를 Map(service_key → row)으로. 관리자에게도 그대로 읽어 재인증 설정을 쓴다. */
async function loadPerms(env, userId) {
  const { results } = await env.DB.prepare('SELECT * FROM user_services WHERE user_id = ?').bind(userId).all();
  return new Map((results || []).map((r) => [r.service_key, r]));
}

/**
 * 이 사람에게 보이는 화면 목록. **주소(url)는 담지 않는다** — 주소는 /go/<key> 만 안다.
 *
 * 관리자는 권한표와 상관없이 모두 본다. 스스로에게서 권한을 지워 포털에 못 들어가는
 * 상황을 만들지 않기 위해서다. 재인증은 관리자에게도 그대로 걸린다.
 */
async function visibleServices(env, user, sid) {
  const perms = await loadPerms(env, user.id);
  const admin = user.role === 'admin';
  const out = [];
  for (const s of SERVICES) {
    const perm = perms.get(s.key);
    const allowed = isAlways(s) || admin || (perm ? !!perm.allowed : false);
    if (!allowed) continue;
    const reauth = isAlways(s) ? false : perm ? !!perm.reauth : !!s.reauth;
    const ready = isReady(s);
    out.push({
      key: s.key,
      label: s.label,
      group: s.group,
      desc: s.desc,
      accent: s.accent,
      icon: s.icon,
      repo: s.repo || null,
      external: !!s.external,
      ready,
      reauth,
      unlockTtl: reauth ? unlockTtl(env, perm) : 0,
      unlockedUntil: reauth && ready && sid ? await unlockedUntil(env, sid, s.key) : 0,
    });
  }
  return out;
}

/** /go/<key> 에서 쓰는 판정 — 볼 수 있는가, 재인증이 필요한가. */
async function permissionFor(env, user, s) {
  const perms = await loadPerms(env, user.id);
  const perm = perms.get(s.key) || null;
  const allowed = isAlways(s) || user.role === 'admin' || (perm ? !!perm.allowed : false);
  const reauth = isAlways(s) ? false : perm ? !!perm.reauth : !!s.reauth;
  return { allowed, reauth, ttl: unlockTtl(env, perm) };
}

// ──────────────────────────────────────────────────────────────
// 접속 기록
// ──────────────────────────────────────────────────────────────

/**
 * 실패해도 흐름을 멈추지 않는다 — 기록을 못 남긴다고 로그인이 안 되면 곤란하다.
 * ctx.waitUntil 로 응답 뒤에 쓴다.
 */
function logAccess(env, ctx, request, { userId = null, email = null, action, serviceKey = null, ok = true }) {
  const p = env.DB.prepare(
    `INSERT INTO access_log (user_id, email, action, service_key, ok, ip, ua, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(userId, email, action, serviceKey, ok ? 1 : 0, clientIp(request), clientUa(request), nowIso())
    .run()
    .catch((e) => console.warn('access_log 실패:', e.message));
  if (ctx) ctx.waitUntil(p);
  return p;
}

// ──────────────────────────────────────────────────────────────
// 접근 통제
// ──────────────────────────────────────────────────────────────

/**
 * 로그인한 사람만.
 * 비밀번호를 아직 정하지 않았으면(must_change_pw) 비밀번호 설정 외의 모든 문을 닫는다 —
 * 이게 "최초 로그인 뒤 반드시 비밀번호를 바꾼다"를 서버에서 강제하는 자리다.
 */
async function requireLogin(request, env, handler, { allowPwChange = false } = {}) {
  if (!sessionSecret(env)) {
    return fail('SESSION_SECRET 이 설정되지 않았습니다. `npx wrangler secret put SESSION_SECRET` 로 등록하세요.', 500);
  }
  const sess = await readSession(request, env);
  if (!sess) return fail('로그인이 필요합니다.', 401, { code: 'unauthorized' });

  const user = await getUser(env, sess.uid);
  if (!user) return fail('로그인이 필요합니다.', 401, { code: 'unauthorized' });
  if (user.status !== 'active') return fail('사용이 중지된 계정입니다.', 403, { code: 'blocked' });

  // 비밀번호가 바뀌었으면(또는 지문이 없는 옛 세션이면) 여기서 끊는다.
  if (sess.pwv !== pwFingerprint(user.password_hash)) {
    await env.SESSIONS.delete(`sess:${sess.sid}`);
    return fail('비밀번호가 바뀌었습니다. 다시 로그인해주세요.', 401, { code: 'unauthorized' });
  }

  if (user.must_change_pw && !allowPwChange) {
    return fail('최초 로그인입니다. 비밀번호를 먼저 설정해주세요.', 403, { code: 'must_change_pw' });
  }
  return handler(user, sess);
}

const requireAdmin = (request, env, handler) =>
  requireLogin(request, env, (user, sess) => {
    if (user.role !== 'admin') return fail('관리자만 쓸 수 있습니다.', 403, { code: 'forbidden' });
    return handler(user, sess);
  });

// ──────────────────────────────────────────────────────────────
// 인증 API
// ──────────────────────────────────────────────────────────────

/**
 * 화면이 맨 처음 부르는 곳. 로그인 전에는 **아무 재료도 내주지 않는다** —
 * { loggedIn:false } 한 줄뿐이라, 로그인하지 않은 사람이 어떤 메뉴가 있는지조차 알 수 없다.
 */
async function apiStatus(request, env) {
  const configured = !!sessionSecret(env);
  const sess = configured ? await readSession(request, env) : null;
  const user = sess ? await getUser(env, sess.uid) : null;

  if (!user || user.status !== 'active' || sess.pwv !== pwFingerprint(user.password_hash)) {
    return json({ loggedIn: false, configured });
  }
  if (user.must_change_pw) {
    // 비밀번호를 정하기 전에는 메뉴를 주지 않는다. 화면은 설정 폼만 띄운다.
    return json({ loggedIn: true, mustChangePw: true, needsFirstPassword: !user.password_hash, me: userView(user) });
  }
  return json({
    loggedIn: true,
    mustChangePw: false,
    me: userView(user),
    groups: GROUPS,
    services: await visibleServices(env, user, sess.sid),
  });
}

// 로그인 시도 제한 — 이메일+IP 조합으로 창(5분) 안에 10번.
const loginScope = (request, email) => `login:${email}:${clientIp(request) || 'unknown'}`;

async function apiLogin(request, env, ctx) {
  if (!sessionSecret(env)) {
    return fail('SESSION_SECRET 이 설정되지 않았습니다. `npx wrangler secret put SESSION_SECRET` 로 등록하세요.', 500);
  }
  await ensureBootstrapAdmin(env);

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email) return fail('이메일을 입력해주세요.');

  const scope = loginScope(request, email);
  if ((await tryCount(env, scope)) >= UNLOCK_TRY_MAX) {
    return fail('로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.', 429, { code: 'too_many' });
  }

  const user = await getUserByEmail(env, email);

  // 계정이 없어도 해시 한 번은 돌린다 — 응답이 빨리 돌아오는 것으로 "없는 이메일"을
  // 구분해 낼 수 없게 한다.
  if (!user) {
    await verifyPassword(password, await hashPassword('_'));
    await bumpTry(env, scope);
    logAccess(env, ctx, request, { email, action: 'login_fail', ok: false });
    return fail('이메일 또는 비밀번호가 맞지 않습니다.', 401);
  }
  if (user.status !== 'active') {
    logAccess(env, ctx, request, { userId: user.id, email, action: 'login_fail', ok: false });
    return fail('사용이 중지된 계정입니다.', 403, { code: 'blocked' });
  }

  // 아직 비밀번호가 없는 계정(최초 관리자, 관리자가 비밀번호 없이 만든 사용자)은
  // 비밀번호를 묻지 않고 들여보낸다. 대신 들어오자마자 비밀번호를 정해야 한다.
  const firstTime = !user.password_hash;
  if (!firstTime && !(await verifyPassword(password, user.password_hash))) {
    await bumpTry(env, scope);
    logAccess(env, ctx, request, { userId: user.id, email, action: 'login_fail', ok: false });
    return fail('이메일 또는 비밀번호가 맞지 않습니다.', 401);
  }

  await clearTry(env, scope);
  await env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(nowIso(), user.id).run();
  const { cookie } = await createSession(env, user);
  logAccess(env, ctx, request, { userId: user.id, email, action: 'login' });

  return json(
    { ok: true, mustChangePw: !!user.must_change_pw, needsFirstPassword: firstTime, me: userView(user) },
    200,
    { 'Set-Cookie': cookieHeader(cookie, request) }
  );
}

async function apiLogout(request, env, ctx) {
  const sess = await readSession(request, env);
  if (sess) {
    await env.SESSIONS.delete(`sess:${sess.sid}`);
    // 이 세션으로 열어 둔 화면 잠금해제도 함께 걷어낸다.
    const list = await env.SESSIONS.list({ prefix: `unlock:${sess.sid}:` });
    await Promise.all((list.keys || []).map((k) => env.SESSIONS.delete(k.name)));
    logAccess(env, ctx, request, { userId: sess.uid, action: 'logout' });
  }
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookieHeader(request) });
}

/**
 * 비밀번호 설정/변경.
 * 이미 비밀번호가 있는 사람은 현재 비밀번호를 함께 받는다. 아직 없는 사람(최초 로그인)은
 * 새 비밀번호만 받는다 — 그 자리가 바로 "비밀번호 없이 들어와 암호를 만드는" 순간이다.
 */
async function apiSetPassword(request, env, ctx, user) {
  const body = await request.json().catch(() => ({}));
  const next = String(body.next || '');
  const current = String(body.current || '');

  if (user.password_hash && !(await verifyPassword(current, user.password_hash))) {
    return fail('현재 비밀번호가 맞지 않습니다.', 403);
  }
  const problem = passwordProblem(next);
  if (problem) return fail(problem);
  if (user.password_hash && (await verifyPassword(next, user.password_hash))) {
    return fail('이전과 다른 비밀번호로 정해주세요.');
  }

  const hash = await hashPassword(next);
  await env.DB.prepare('UPDATE users SET password_hash = ?, must_change_pw = 0 WHERE id = ?').bind(hash, user.id).run();

  // 비밀번호 지문이 바뀌었으니 지금 세션도 끊긴다 → 새 세션을 바로 발급해 이어 준다.
  // (다른 기기에 열려 있던 창은 여기서 끊긴다 — 그게 비밀번호를 바꾸는 이유다.)
  const { cookie } = await createSession(env, { id: user.id, password_hash: hash });
  logAccess(env, ctx, request, { userId: user.id, email: user.email, action: 'password_set' });

  return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader(cookie, request) });
}

// ──────────────────────────────────────────────────────────────
// 화면 열기 — 재인증과 /go/<key>
// ──────────────────────────────────────────────────────────────

/** 화면 잠금해제: 계정 비밀번호를 한 번 더 받는다. */
async function apiUnlock(request, env, ctx, user, sess) {
  const body = await request.json().catch(() => ({}));
  const key = String(body.key || '');
  const password = String(body.password || '');

  const s = serviceOf(key);
  if (!s) return fail('없는 화면입니다.', 404);

  const perm = await permissionFor(env, user, s);
  if (!perm.allowed) return fail('이 화면을 볼 권한이 없습니다.', 403, { code: 'forbidden' });
  if (!perm.reauth) return json({ ok: true, until: 0, ttl: 0 }); // 애초에 잠겨 있지 않다

  const scope = `unlock:${sess.sid}:${key}`;
  if ((await tryCount(env, scope)) >= UNLOCK_TRY_MAX) {
    return fail('시도가 너무 많습니다. 잠시 후 다시 시도해주세요.', 429, { code: 'too_many' });
  }

  // 비밀번호가 아직 없는 계정은 여기까지 오지 못한다(must_change_pw 가 앞에서 막는다).
  if (!(await verifyPassword(password, user.password_hash))) {
    await bumpTry(env, scope);
    logAccess(env, ctx, request, { userId: user.id, email: user.email, action: 'unlock_fail', serviceKey: key, ok: false });
    return fail('비밀번호가 맞지 않습니다.', 403);
  }

  await clearTry(env, scope);
  await setUnlock(env, sess.sid, key, perm.ttl);
  logAccess(env, ctx, request, { userId: user.id, email: user.email, action: 'unlock', serviceKey: key });

  return json({ ok: true, ttl: perm.ttl, until: Date.now() + perm.ttl * 1000 });
}

/**
 * 실제 주소는 여기서만 알려준다.
 * 목록 API가 url 을 담지 않으므로, 페이지 소스를 뒤져도 서비스 주소가 나오지 않는다.
 * 잠금이 걸린 화면은 잠금해제 없이 이 문을 통과할 수 없다.
 */
async function goService(request, env, ctx, user, sess, key) {
  const s = serviceOf(key);
  if (!s) return text('없는 화면입니다.', 404);

  const perm = await permissionFor(env, user, s);
  if (!perm.allowed) return redirect(`/?denied=${encodeURIComponent(key)}`);
  if (!isReady(s)) return redirect(`/?soon=${encodeURIComponent(key)}`);
  if (perm.reauth && !(await unlockedUntil(env, sess.sid, key))) {
    return redirect(`/?locked=${encodeURIComponent(key)}`);
  }

  logAccess(env, ctx, request, { userId: user.id, email: user.email, action: 'open', serviceKey: key });
  return redirect(s.url, { 'Referrer-Policy': 'no-referrer' });
}

// ──────────────────────────────────────────────────────────────
// 관리자 API
// ──────────────────────────────────────────────────────────────

/** 관리자 화면이 쓰는 전체 화면 목록(권한을 고를 재료). 여기에는 주소를 담아도 된다. */
const catalogView = () =>
  SERVICES.filter((s) => !isAlways(s)).map((s) => ({
    key: s.key,
    label: s.label,
    group: s.group,
    desc: s.desc,
    icon: s.icon,
    accent: s.accent,
    ready: isReady(s),
    url: s.url || null,
    repo: s.repo || null,
    defaultReauth: !!s.reauth,
  }));

async function adminUsers(env) {
  const { results } = await env.DB.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  const rows = results || [];
  // 사람마다 몇 개 화면을 열어 두었는지 한 번에 세어 목록에 붙인다(N+1 질의 회피).
  const { results: perms } = await env.DB.prepare(
    'SELECT user_id, COUNT(*) AS n FROM user_services WHERE allowed = 1 GROUP BY user_id'
  ).all();
  const counts = new Map((perms || []).map((r) => [r.user_id, r.n]));
  return json({
    users: rows.map((u) => ({
      ...userView(u),
      serviceCount: u.role === 'admin' ? SERVICES.length - 1 : counts.get(u.id) || 0,
    })),
    catalog: catalogView(),
    groups: GROUPS,
  });
}

async function adminCreateUser(request, env, ctx, admin) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim().slice(0, 60) || null;
  const role = body.role === 'admin' ? 'admin' : 'user';
  const note = String(body.note || '').trim().slice(0, 300) || null;
  const password = body.password === undefined || body.password === null ? '' : String(body.password);

  if (!isEmailLike(email)) return fail('이메일 형식이 올바르지 않습니다.');
  if (await getUserByEmail(env, email)) return fail('이미 있는 이메일입니다.');

  // 비밀번호를 비워 두면 그 사람도 **최초 1회 비밀번호 없이** 들어와 직접 정한다
  // (최초 관리자와 같은 흐름). 값을 주면 그 값으로 시작하되 첫 로그인에 바꾸게 한다.
  let hash = null;
  if (password) {
    const problem = passwordProblem(password);
    if (problem) return fail(problem);
    hash = await hashPassword(password);
  }

  const res = await env.DB.prepare(
    `INSERT INTO users (email, name, password_hash, role, status, must_change_pw, created_at, created_by, note)
     VALUES (?, ?, ?, ?, 'active', 1, ?, ?, ?)`
  )
    .bind(email, name, hash, role, nowIso(), admin.id, note)
    .run();

  const userId = res.meta?.last_row_id;
  const keys = Array.isArray(body.services) ? body.services : [];
  if (userId && keys.length) await writePerms(env, userId, keys.map((k) => ({ key: k })));

  logAccess(env, ctx, request, { userId: admin.id, email: admin.email, action: 'admin_user_create' });
  const created = await getUser(env, userId);
  return json({ ok: true, user: userView(created) });
}

async function adminUpdateUser(request, env, ctx, admin, id) {
  const target = await getUser(env, id);
  if (!target) return fail('없는 사용자입니다.', 404);

  const body = await request.json().catch(() => ({}));
  const sets = [];
  const binds = [];

  if (body.name !== undefined) {
    sets.push('name = ?');
    binds.push(String(body.name || '').trim().slice(0, 60) || null);
  }
  if (body.note !== undefined) {
    sets.push('note = ?');
    binds.push(String(body.note || '').trim().slice(0, 300) || null);
  }
  if (body.role !== undefined) {
    const role = body.role === 'admin' ? 'admin' : 'user';
    // 마지막 관리자가 스스로 권한을 내려놓으면 아무도 사용자를 만들 수 없게 된다.
    if (target.id === admin.id && role !== 'admin') return fail('자기 자신의 관리자 권한은 내릴 수 없습니다.', 400);
    sets.push('role = ?');
    binds.push(role);
  }
  if (body.status !== undefined) {
    const status = body.status === 'blocked' ? 'blocked' : 'active';
    if (target.id === admin.id && status === 'blocked') return fail('자기 자신을 중지할 수 없습니다.', 400);
    sets.push('status = ?');
    binds.push(status);
  }
  // 비밀번호 초기화. 값을 주면 그 값으로, 빈 값이면 "비밀번호 없음"으로 되돌린다
  // (그 사람은 다시 한 번 비밀번호 없이 들어와 직접 정하게 된다).
  if (body.password !== undefined) {
    const pw = body.password === null ? '' : String(body.password);
    if (pw) {
      const problem = passwordProblem(pw);
      if (problem) return fail(problem);
      sets.push('password_hash = ?', 'must_change_pw = 1');
      binds.push(await hashPassword(pw));
    } else {
      sets.push('password_hash = NULL', 'must_change_pw = 1');
    }
  }

  if (!sets.length) return fail('바꿀 내용이 없습니다.');
  binds.push(target.id);
  await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

  logAccess(env, ctx, request, { userId: admin.id, email: admin.email, action: 'admin_user_update' });
  return json({ ok: true, user: userView(await getUser(env, target.id)) });
}

async function adminDeleteUser(request, env, ctx, admin, id) {
  const target = await getUser(env, id);
  if (!target) return fail('없는 사용자입니다.', 404);
  if (target.id === admin.id) return fail('자기 자신은 삭제할 수 없습니다.', 400);

  await env.DB.batch([
    env.DB.prepare('DELETE FROM user_services WHERE user_id = ?').bind(target.id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(target.id),
  ]);
  // 접속 기록은 남긴다(누가 무엇을 열었는지는 계정이 사라져도 사실이다) — email 로만 남는다.
  await env.DB.prepare('UPDATE access_log SET user_id = NULL WHERE user_id = ?').bind(target.id).run();

  logAccess(env, ctx, request, { userId: admin.id, email: admin.email, action: 'admin_user_delete' });
  return json({ ok: true });
}

/** 권한 통째 쓰기. 목록에 없는 화면은 지운다 — 화면에서 체크를 푼 것이 곧 삭제다. */
async function writePerms(env, userId, items) {
  const stmts = [env.DB.prepare('DELETE FROM user_services WHERE user_id = ?').bind(userId)];
  for (const it of items) {
    const s = serviceOf(it.key);
    if (!s || isAlways(s)) continue;
    const reauth = it.reauth === undefined ? !!s.reauth : !!it.reauth;
    const ttlRaw = Number(it.unlockTtl);
    const ttl = Number.isFinite(ttlRaw) && ttlRaw > 0 ? Math.min(UNLOCK_MAX, Math.max(UNLOCK_MIN, Math.round(ttlRaw))) : null;
    stmts.push(
      env.DB.prepare(
        'INSERT INTO user_services (user_id, service_key, allowed, reauth, unlock_ttl) VALUES (?, ?, 1, ?, ?)'
      ).bind(userId, s.key, reauth ? 1 : 0, ttl)
    );
  }
  await env.DB.batch(stmts);
}

async function adminGetPerms(env, id) {
  const target = await getUser(env, id);
  if (!target) return fail('없는 사용자입니다.', 404);
  const perms = await loadPerms(env, target.id);
  return json({
    user: userView(target),
    catalog: catalogView(),
    groups: GROUPS,
    perms: [...perms.values()].map((r) => ({
      key: r.service_key,
      allowed: !!r.allowed,
      reauth: !!r.reauth,
      unlockTtl: r.unlock_ttl || null,
    })),
  });
}

async function adminPutPerms(request, env, ctx, admin, id) {
  const target = await getUser(env, id);
  if (!target) return fail('없는 사용자입니다.', 404);
  const body = await request.json().catch(() => ({}));
  const items = Array.isArray(body.services) ? body.services : [];
  await writePerms(env, target.id, items);
  logAccess(env, ctx, request, { userId: admin.id, email: admin.email, action: 'admin_perms_update' });
  return adminGetPerms(env, target.id);
}

async function adminLogs(env, url) {
  const limit = Math.min(300, Math.max(1, parseInt(url.searchParams.get('limit') || '100', 10) || 100));
  const { results } = await env.DB.prepare(
    `SELECT a.*, u.name AS user_name FROM access_log a
     LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.id DESC LIMIT ?`
  )
    .bind(limit)
    .all();
  return json({
    logs: (results || []).map((r) => ({
      id: r.id,
      at: r.created_at,
      email: r.email,
      name: r.user_name || null,
      action: r.action,
      service: r.service_key,
      ok: !!r.ok,
      ip: r.ip,
    })),
  });
}

// ──────────────────────────────────────────────────────────────
// 라우터
// ──────────────────────────────────────────────────────────────

/** 정적 자산으로 내보낼 파일. 그 외의 모든 주소는 껍데기(index.html) 하나로 받는다. */
const ASSET_RE = /\.(css|js|mjs|map|png|jpe?g|gif|svg|webp|ico|woff2?|json|txt|xml)$/i;

async function shell(request, env) {
  // 어떤 주소로 들어오든 같은 껍데기를 준다. 껍데기에는 메뉴도, 서비스 목록도 없다 —
  // 로그인 화면을 그리고 /api/status 를 물어본 뒤에야 나머지가 채워진다.
  //
  // ⚠️ '/index.html' 이 아니라 '/' 를 달라고 해야 한다. 자산 라우터는 '/index.html' 을
  //    '/' 로 **되돌려 보내고**(307), 그 응답은 본문이 비어 있다. 그걸 그대로 200으로
  //    바꿔 내보내면 화면이 새하얗게 뜬다(실제로 그랬다).
  const res = await env.ASSETS.fetch(new Request(new URL('/', request.url), { method: 'GET' }));
  if (!res.ok) return text('화면 파일을 찾을 수 없습니다.', 500);
  return new Response(res.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();
    env = { ...env, BASE_URL: baseUrlOf(request, env) };

    try {
      if (!sameOriginRequest(request)) return fail('잘못된 요청 출처입니다.', 403);

      // ---- 인증 ----
      if (path === '/api/status' && method === 'GET') return apiStatus(request, env);
      if (path === '/api/login' && method === 'POST') return apiLogin(request, env, ctx);
      if (path === '/api/logout' && method === 'POST') return apiLogout(request, env, ctx);
      // 비밀번호 설정은 must_change_pw 상태에서도 열려 있어야 한다 — 유일한 예외다.
      if (path === '/api/me/password' && method === 'POST') {
        return requireLogin(request, env, (user) => apiSetPassword(request, env, ctx, user), { allowPwChange: true });
      }

      // ---- 화면 목록 · 잠금해제 ----
      if (path === '/api/services' && method === 'GET') {
        return requireLogin(request, env, async (user, sess) =>
          json({ groups: GROUPS, services: await visibleServices(env, user, sess.sid) })
        );
      }
      if (path === '/api/unlock' && method === 'POST') {
        return requireLogin(request, env, (user, sess) => apiUnlock(request, env, ctx, user, sess));
      }

      // ---- 실제 서비스로 나가는 유일한 문 ----
      const mGo = path.match(/^\/go\/([a-z0-9_-]{1,40})$/i);
      if (mGo && method === 'GET') {
        return requireLogin(request, env, (user, sess) => goService(request, env, ctx, user, sess, mGo[1]));
      }

      // ---- 관리자 ----
      if (path === '/api/admin/users' && method === 'GET') return requireAdmin(request, env, () => adminUsers(env));
      if (path === '/api/admin/users' && method === 'POST') {
        return requireAdmin(request, env, (admin) => adminCreateUser(request, env, ctx, admin));
      }
      const mUser = path.match(/^\/api\/admin\/users\/(\d+)$/);
      if (mUser && method === 'PATCH') {
        return requireAdmin(request, env, (admin) => adminUpdateUser(request, env, ctx, admin, Number(mUser[1])));
      }
      if (mUser && method === 'DELETE') {
        return requireAdmin(request, env, (admin) => adminDeleteUser(request, env, ctx, admin, Number(mUser[1])));
      }
      const mPerms = path.match(/^\/api\/admin\/users\/(\d+)\/services$/);
      if (mPerms && method === 'GET') return requireAdmin(request, env, () => adminGetPerms(env, Number(mPerms[1])));
      if (mPerms && method === 'PUT') {
        return requireAdmin(request, env, (admin) => adminPutPerms(request, env, ctx, admin, Number(mPerms[1])));
      }
      if (path === '/api/admin/logs' && method === 'GET') return requireAdmin(request, env, () => adminLogs(env, url));

      // 여기까지 오지 못한 /api/* 는 없는 주소다(껍데기 HTML을 돌려주면 화면이 헷갈린다).
      if (path.startsWith('/api/')) return fail('없는 주소입니다.', 404);

      // ---- 정적 자산 ----
      if (method === 'GET' || method === 'HEAD') {
        if (ASSET_RE.test(path)) return env.ASSETS.fetch(request);
        return shell(request, env);
      }
      return fail('허용하지 않는 요청입니다.', 405);
    } catch (err) {
      const detail = (err && (err.message || err.name)) || String(err) || '알 수 없는 오류';
      console.error('worker error', path, detail, err && err.stack);
      return fail(`서버 오류: ${detail}`, 500);
    }
  },

  async scheduled(event, env, ctx) {
    // 접속 기록은 90일만 둔다. 오래된 것을 계속 쌓아 둘 이유가 없고,
    // IP가 섞인 기록을 무기한 보관하고 싶지도 않다.
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    ctx.waitUntil(
      env.DB.prepare('DELETE FROM access_log WHERE created_at < ?')
        .bind(cutoff)
        .run()
        .catch((e) => console.warn('접속기록 정리 실패:', e.message))
    );
  },
};
