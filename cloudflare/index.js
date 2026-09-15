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
import {
  PROVIDERS,
  FEED_OF,
  connectStart,
  connectCallback,
  connectionStatus,
  disconnect,
  feedFor,
} from './connect.js';
import {
  wikiOverview,
  listNotes,
  getNote,
  createNote,
  updateNote,
  deleteNote,
  emptyTrash,
  createFolder,
  updateFolder,
  deleteFolder,
  uploadFile,
  serveFile,
  exportNote,
  importFiles,
  shareNote,
  sharedNotePage,
  renderMarkdown,
  reorderFolders,
} from './wiki.js';

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
     VALUES (?, 'Jaden', NULL, 'admin', 'active', 1, ?)`
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
      account: s.account || null,
      route: s.route || null,
      links: s.links || null,
      // 오른쪽 프레임에 담아도 되는가. false 면 화면이 곧장 새 탭으로 연다.
      // null 이면 아직 모른다 — 화면이 /api/frameable 로 한 번 물어본다.
      frame: s.frame === false ? false : null,
      feed: !!FEED_OF[s.key],
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

/**
 * Jaden wiki 를 쓸 수 있는 사람만.
 *
 * 메모 화면은 포털 **안**에 있지만, 문은 다른 화면과 똑같이 'jadenwiki' 권한 하나로
 * 연다 — 관리 → 화면 권한에서 그 줄을 끄면 메뉴에서 사라지는 동시에 API도 닫힌다.
 * (화면에서만 감추고 API를 열어 두면 감춘 것이 아니다.)
 */
const requireWiki = (request, env, handler) =>
  requireLogin(request, env, async (user, sess) => {
    const s = serviceOf('jadenwiki');
    const perm = await permissionFor(env, user, s);
    if (!perm.allowed) return fail('이 화면을 볼 권한이 없습니다.', 403, { code: 'forbidden' });
    if (perm.reauth && !(await unlockedUntil(env, sess.sid, 'jadenwiki'))) {
      return fail('화면 잠금을 먼저 풀어주세요.', 403, { code: 'locked' });
    }
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
// 생체인증 (WebAuthn · 패스키)
// ──────────────────────────────────────────────────────────────
//
// 휴대폰의 지문·얼굴로 **로그인**하고, **화면 잠금도 푼다**. 비밀번호를 대신하는 것이
// 아니라 나란히 둔 두 번째 길이다 — 비밀번호는 그대로 살아 있다.
//
// 왜 이렇게 두었나
//   · 열쇠(개인키)는 휴대폰의 보안칩 밖으로 나오지 않는다. 서버가 갖는 것은 공개키뿐이라
//     이 포털이 통째로 털려도 남의 지문으로 로그인할 재료가 되지 않는다.
//   · **주소마다 열쇠가 다르다.** rpId(=호스트)를 열쇠에 함께 저장하고 검증하므로,
//     workers.dev 에서 만든 패스키는 운영 도메인에서 쓰이지 않는다(피싱 방어의 핵심).
//   · userVerification: 'required' — "기기를 갖고 있다"가 아니라 "생체인증을 통과했다"를
//     요구한다. authData 의 UV 비트로 서버가 그것을 확인한다.
//
// 등록은 **비밀번호를 한 번 더 확인한 뒤**에만 된다. 세션만 훔친 사람이 자기 지문을
// 슬쩍 등록해 두는 길을 막는다.

const WEBAUTHN_CHALLENGE_TTL = 300;   // 발급한 난수의 수명(초)
const FLAG_UP = 0x01;                 // 사용자가 기기를 만졌다
const FLAG_UV = 0x04;                 // 생체인증(또는 PIN)을 통과했다
const FLAG_AT = 0x40;                 // 등록 정보(공개키)가 함께 들어 있다

/** 패스키가 매이는 곳은 "지금 들어온 호스트"다. 여기서 만든 것은 여기서만 쓰인다. */
const rpIdOf = (request) => new URL(request.url).hostname;
const originOf = (request) => new URL(request.url).origin;

const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));

/** 난수를 KV에 맡기고 돌려준다. 되돌아온 것과 맞춰 보기 위해서다. */
async function newChallenge(env, purpose, data = {}) {
  const id = randomId(18);
  const challenge = randomId(32);
  await env.SESSIONS.put(`wa:${purpose}:${id}`, JSON.stringify({ challenge, ...data }), {
    expirationTtl: WEBAUTHN_CHALLENGE_TTL,
  });
  return { challengeId: id, challenge };
}

/** 한 번 쓰면 사라진다 — 같은 응답을 두 번 들이밀지 못하게(재생 공격). */
async function takeChallenge(env, purpose, id) {
  const k = `wa:${purpose}:${String(id || '')}`;
  const v = await env.SESSIONS.get(k, 'json');
  if (v) await env.SESSIONS.delete(k);
  return v;
}

/** 브라우저가 서명한 clientDataJSON 이 우리가 낸 문제에 대한 답이 맞는지. */
function checkClientData(b64, { type, challenge, origin }) {
  let cd;
  try {
    cd = JSON.parse(new TextDecoder().decode(b64urlToBytes(String(b64 || ''))));
  } catch {
    return '인증 데이터를 읽지 못했습니다.';
  }
  if (cd.type !== type) return '인증 요청 종류가 맞지 않습니다.';
  if (!timingSafeEqual(cd.challenge, challenge)) return '인증 시간이 지났습니다. 다시 시도해주세요.';
  if (cd.origin !== origin) return '다른 주소에서 온 인증입니다.';
  return null;
}

/** authenticatorData — 32바이트 rpIdHash · 1바이트 플래그 · 4바이트 카운터 · (등록이면 공개키 묶음) */
function parseAuthData(bytes) {
  if (!bytes || bytes.length < 37) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = { rpIdHash: bytes.slice(0, 32), flags: bytes[32], signCount: view.getUint32(33), credId: null };
  if (out.flags & FLAG_AT && bytes.length >= 55) {
    const len = view.getUint16(53);                   // 16바이트 aaguid 를 건너뛴 자리
    if (bytes.length >= 55 + len) out.credId = bytes.slice(55, 55 + len);
  }
  return out;
}

/**
 * WebAuthn 의 ECDSA 서명은 DER(ASN.1)이고 WebCrypto 는 r‖s 64바이트를 받는다.
 * 이 변환을 빠뜨리면 "서명이 틀렸다"만 반복해서 나온다.
 */
function derToRawSignature(der) {
  if (!der || der[0] !== 0x30) return null;
  let i = der[1] & 0x80 ? 2 + (der[1] & 0x7f) : 2;
  const readInt = () => {
    if (der[i++] !== 0x02) return null;
    const len = der[i++];
    const v = der.slice(i, i + len);
    i += len;
    return v.length === len ? v : null;
  };
  const r = readInt();
  const s = readInt();
  if (!r || !s) return null;
  const out = new Uint8Array(64);
  const put = (v, off) => {
    const t = v[0] === 0 ? v.slice(1) : v;            // DER 의 부호용 0x00 패딩을 걷어낸다
    if (t.length > 32) return false;
    out.set(t, off + 32 - t.length);                  // 32바이트 오른쪽 정렬
    return true;
  };
  return put(r, 0) && put(s, 32) ? out : null;
}

/** 서명 대상은 authenticatorData ‖ SHA-256(clientDataJSON) 이다. */
async function verifySignature(cred, { authData, clientDataJSON, signature }) {
  const rsa = Number(cred.alg) === -257;
  const key = await crypto.subtle.importKey(
    'spki',
    b64urlToBytes(cred.public_key),
    rsa ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } : { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
  const raw = b64urlToBytes(String(signature || ''));
  const sig = rsa ? raw : derToRawSignature(raw);
  if (!sig) return false;

  const cd = await sha256(b64urlToBytes(String(clientDataJSON || '')));
  const signed = new Uint8Array(authData.length + cd.length);
  signed.set(authData, 0);
  signed.set(cd, authData.length);

  return crypto.subtle.verify(rsa ? { name: 'RSASSA-PKCS1-v1_5' } : { name: 'ECDSA', hash: 'SHA-256' }, key, sig, signed);
}

const credView = (c) => ({
  id: c.id,
  label: c.label || '등록한 기기',
  createdAt: c.created_at,
  lastUsedAt: c.last_used_at,
  rpId: c.rp_id,
});

const listCredentials = async (env, userId) => {
  const { results } = await env.DB.prepare(
    'SELECT * FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at DESC'
  )
    .bind(userId)
    .all();
  return results || [];
};

/**
 * 사람마다 하나씩 갖는 임의의 손잡이. 패스키에 심어 두고, 로그인할 때 휴대폰이
 * 이것을 돌려주면 누구인지 안다. users.id 를 그대로 쓰지 않는 이유는 간단하다 —
 * 남의 기기에 우리 DB의 일련번호를 적어 둘 이유가 없다.
 */
async function userHandle(env, user) {
  if (user.wa_handle) return user.wa_handle;
  const handle = randomId(16);
  await env.DB.prepare('UPDATE users SET wa_handle = ? WHERE id = ?').bind(handle, user.id).run();
  return handle;
}

/**
 * 되돌아온 생체인증 결과를 검증한다. 통과하면 { cred }, 아니면 { error }.
 * userId 를 주면 그 사람의 열쇠만 받는다(화면 잠금해제).
 */
async function verifyAssertion(request, env, body, challenge, { userId = null } = {}) {
  const id = String(body.id || '');
  if (!id) return { error: '인증 정보가 없습니다.' };

  const cred = await env.DB.prepare('SELECT * FROM webauthn_credentials WHERE id = ?').bind(id).first();
  if (!cred) return { error: '등록되지 않은 기기입니다.' };
  if (userId !== null && cred.user_id !== userId) return { error: '등록되지 않은 기기입니다.' };
  if (cred.rp_id !== rpIdOf(request)) return { error: '이 주소에 등록된 기기가 아닙니다.' };

  const bad = checkClientData(body.clientDataJSON, {
    type: 'webauthn.get',
    challenge,
    origin: originOf(request),
  });
  if (bad) return { error: bad };

  const authData = b64urlToBytes(String(body.authenticatorData || ''));
  const ad = parseAuthData(authData);
  if (!ad) return { error: '인증 데이터를 읽지 못했습니다.' };
  if (b64url(ad.rpIdHash) !== b64url(await sha256(enc.encode(rpIdOf(request))))) {
    return { error: '다른 주소에서 온 인증입니다.' };
  }
  if (!(ad.flags & FLAG_UP)) return { error: '기기 확인이 되지 않았습니다.' };
  if (!(ad.flags & FLAG_UV)) return { error: '생체인증을 통과하지 못했습니다.' };

  const ok = await verifySignature(cred, {
    authData,
    clientDataJSON: body.clientDataJSON,
    signature: body.signature,
  }).catch(() => false);
  if (!ok) return { error: '생체인증에 실패했습니다.' };

  // 복제된 인증기 탐지. 휴대폰 대부분은 카운터를 늘 0으로 돌려주므로 그때는 건너뛴다.
  if (ad.signCount > 0 && ad.signCount <= cred.sign_count) {
    return { error: '인증 기기 상태가 올바르지 않습니다. 기기를 다시 등록해주세요.' };
  }
  await env.DB.prepare('UPDATE webauthn_credentials SET sign_count = ?, last_used_at = ? WHERE id = ?')
    .bind(ad.signCount, nowIso(), cred.id)
    .run();

  return { cred };
}

// ---------- 등록 ----------

/** 등록을 시작한다. **비밀번호를 한 번 더** 받는다 — 세션만으로는 열쇠를 늘릴 수 없다. */
async function apiPasskeyRegisterOptions(request, env, user) {
  const body = await request.json().catch(() => ({}));
  if (!(await verifyPassword(String(body.password || ''), user.password_hash))) {
    return fail('비밀번호가 맞지 않습니다.', 403);
  }
  const rpId = rpIdOf(request);
  const handle = await userHandle(env, user);
  const mine = await listCredentials(env, user.id);
  const { challengeId, challenge } = await newChallenge(env, 'reg', { uid: user.id, rpId });

  return json({
    challengeId,
    challenge,
    rpId,
    rpName: 'JAPIS',
    userHandle: handle,
    userName: user.email,
    userDisplayName: user.name || user.email,
    // 이미 등록한 기기에서 또 누르면 브라우저가 "이미 등록됨"이라고 알려 준다.
    excludeCredentials: mine.filter((c) => c.rp_id === rpId).map((c) => c.id),
  });
}

async function apiPasskeyRegister(request, env, ctx, user) {
  const body = await request.json().catch(() => ({}));
  const saved = await takeChallenge(env, 'reg', body.challengeId);
  if (!saved || saved.uid !== user.id) return fail('인증 시간이 지났습니다. 다시 시도해주세요.', 400);

  const rpId = rpIdOf(request);
  if (saved.rpId !== rpId) return fail('다른 주소에서 시작한 등록입니다.', 400);

  const bad = checkClientData(body.clientDataJSON, {
    type: 'webauthn.create',
    challenge: saved.challenge,
    origin: originOf(request),
  });
  if (bad) return fail(bad, 400);

  const authData = b64urlToBytes(String(body.authenticatorData || ''));
  const ad = parseAuthData(authData);
  if (!ad || !ad.credId) return fail('등록 데이터를 읽지 못했습니다.', 400);
  if (b64url(ad.rpIdHash) !== b64url(await sha256(enc.encode(rpId)))) {
    return fail('다른 주소에서 온 등록입니다.', 400);
  }
  if (!(ad.flags & FLAG_UV)) return fail('생체인증을 통과하지 못했습니다.', 400);

  const id = String(body.id || '');
  // 기기가 서명해 보낸 열쇠 번호와 브라우저가 알려준 번호가 같아야 한다.
  if (!id || b64url(ad.credId) !== id) return fail('등록 데이터가 올바르지 않습니다.', 400);

  const publicKey = String(body.publicKey || '');
  const alg = Number(body.algorithm);
  if (!publicKey) return fail('이 브라우저는 생체인증 등록을 지원하지 않습니다. 브라우저를 최신으로 올려주세요.', 400);
  if (alg !== -7 && alg !== -257) return fail('지원하지 않는 인증 방식입니다.', 400);

  const label = String(body.label || '').trim().slice(0, 40) || '등록한 기기';
  const transports = Array.isArray(body.transports) ? body.transports.join(',').slice(0, 80) : null;

  await env.DB.prepare(
    `INSERT OR REPLACE INTO webauthn_credentials
       (id, user_id, public_key, alg, rp_id, sign_count, transports, label, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
  )
    .bind(id, user.id, publicKey, alg, rpId, ad.signCount, transports, label, nowIso())
    .run();

  logAccess(env, ctx, request, { userId: user.id, email: user.email, action: 'passkey_add' });
  return json({ ok: true, credentials: (await listCredentials(env, user.id)).map(credView) });
}

async function apiPasskeyDelete(request, env, ctx, user, id) {
  const res = await env.DB.prepare('DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?')
    .bind(id, user.id)
    .run();
  if (!res.meta?.changes) return fail('없는 기기입니다.', 404);
  logAccess(env, ctx, request, { userId: user.id, email: user.email, action: 'passkey_del' });
  return json({ ok: true, credentials: (await listCredentials(env, user.id)).map(credView) });
}

// ---------- 생체인증으로 로그인 ----------

/**
 * 이메일을 묻지 않는다. 휴대폰이 "이 주소에 저장된 패스키"를 스스로 골라 내놓고,
 * 거기 실린 손잡이(userHandle)로 누구인지 알아낸다. 그래서 이 응답에는
 * **어떤 계정이 있는지 알려 주는 정보가 하나도 없다.**
 */
async function apiPasskeyLoginOptions(request, env) {
  const rpId = rpIdOf(request);
  const { challengeId, challenge } = await newChallenge(env, 'login', { rpId });
  return json({ challengeId, challenge, rpId });
}

async function apiPasskeyLogin(request, env, ctx) {
  if (!sessionSecret(env)) return fail('SESSION_SECRET 이 설정되지 않았습니다.', 500);

  const scope = `bio:${clientIp(request) || 'unknown'}`;
  if ((await tryCount(env, scope)) >= UNLOCK_TRY_MAX) {
    return fail('시도가 너무 많습니다. 잠시 후 다시 시도해주세요.', 429, { code: 'too_many' });
  }

  const body = await request.json().catch(() => ({}));
  const saved = await takeChallenge(env, 'login', body.challengeId);
  if (!saved) return fail('인증 시간이 지났습니다. 다시 시도해주세요.', 400);

  const { cred, error } = await verifyAssertion(request, env, body, saved.challenge);
  if (error) {
    await bumpTry(env, scope);
    logAccess(env, ctx, request, { action: 'login_fail', ok: false });
    return fail(error, 403);
  }

  const user = await getUser(env, cred.user_id);
  if (!user) return fail('등록되지 않은 기기입니다.', 403);
  if (user.status !== 'active') return fail('사용이 중지된 계정입니다.', 403, { code: 'blocked' });
  // 휴대폰이 손잡이를 함께 보냈다면 그것까지 맞춰 본다(보내지 않는 기기도 있다).
  if (body.userHandle && user.wa_handle && !timingSafeEqual(body.userHandle, user.wa_handle)) {
    return fail('등록되지 않은 기기입니다.', 403);
  }

  await clearTry(env, scope);
  await env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(nowIso(), user.id).run();
  const { cookie } = await createSession(env, user);
  logAccess(env, ctx, request, { userId: user.id, email: user.email, action: 'login_bio' });

  return json({ ok: true, mustChangePw: !!user.must_change_pw, me: userView(user) }, 200, {
    'Set-Cookie': cookieHeader(cookie, request),
  });
}

// ──────────────────────────────────────────────────────────────
// 화면 열기 — 재인증과 /go/<key>
// ──────────────────────────────────────────────────────────────

/** 잠긴 화면을 열기 전 단계. 그 사람이 이 주소에 등록해 둔 기기만 후보로 준다. */
async function apiUnlockOptions(request, env, user, sess) {
  const body = await request.json().catch(() => ({}));
  const key = String(body.key || '');
  const s = serviceOf(key);
  if (!s) return fail('없는 화면입니다.', 404);

  const perm = await permissionFor(env, user, s);
  if (!perm.allowed) return fail('이 화면을 볼 권한이 없습니다.', 403, { code: 'forbidden' });

  const rpId = rpIdOf(request);
  const mine = (await listCredentials(env, user.id)).filter((c) => c.rp_id === rpId);
  if (!mine.length) return fail('이 기기에 등록된 생체인증이 없습니다.', 404, { code: 'no_passkey' });

  const { challengeId, challenge } = await newChallenge(env, 'unlock', { uid: user.id, sid: sess.sid, key, rpId });
  return json({ challengeId, challenge, rpId, allowCredentials: mine.map((c) => c.id) });
}

/** 화면 잠금해제: 계정 비밀번호를 한 번 더 받는다. 생체인증으로 갈음할 수도 있다. */
async function apiUnlock(request, env, ctx, user, sess) {
  const body = await request.json().catch(() => ({}));
  const key = String(body.key || '');
  const assertion = body.assertion && typeof body.assertion === 'object' ? body.assertion : null;

  const s = serviceOf(key);
  if (!s) return fail('없는 화면입니다.', 404);

  const perm = await permissionFor(env, user, s);
  if (!perm.allowed) return fail('이 화면을 볼 권한이 없습니다.', 403, { code: 'forbidden' });
  if (!perm.reauth) return json({ ok: true, until: 0, ttl: 0 }); // 애초에 잠겨 있지 않다

  const scope = `unlock:${sess.sid}:${key}`;
  if ((await tryCount(env, scope)) >= UNLOCK_TRY_MAX) {
    return fail('시도가 너무 많습니다. 잠시 후 다시 시도해주세요.', 429, { code: 'too_many' });
  }

  if (assertion) {
    // 난수는 이 세션·이 화면에 대해 발급한 것이어야 한다. 다른 화면에서 받은 생체인증을
    // 옮겨 붙이지 못한다.
    const saved = await takeChallenge(env, 'unlock', assertion.challengeId);
    if (!saved || saved.uid !== user.id || saved.sid !== sess.sid || saved.key !== key) {
      return fail('인증 시간이 지났습니다. 다시 시도해주세요.', 400);
    }
    const { error } = await verifyAssertion(request, env, assertion, saved.challenge, { userId: user.id });
    if (error) {
      await bumpTry(env, scope);
      logAccess(env, ctx, request, { userId: user.id, email: user.email, action: 'unlock_fail', serviceKey: key, ok: false });
      return fail(error, 403);
    }
  } else if (!(await verifyPassword(String(body.password || ''), user.password_hash))) {
    // 비밀번호가 아직 없는 계정은 여기까지 오지 못한다(must_change_pw 가 앞에서 막는다).
    await bumpTry(env, scope);
    logAccess(env, ctx, request, { userId: user.id, email: user.email, action: 'unlock_fail', serviceKey: key, ok: false });
    return fail('비밀번호가 맞지 않습니다.', 403);
  }

  await clearTry(env, scope);
  await setUnlock(env, sess.sid, key, perm.ttl);
  logAccess(env, ctx, request, {
    userId: user.id,
    email: user.email,
    action: assertion ? 'unlock_bio' : 'unlock',
    serviceKey: key,
  });

  return json({ ok: true, ttl: perm.ttl, until: Date.now() + perm.ttl * 1000 });
}

/**
 * 실제 주소는 여기서만 알려준다.
 * 목록 API가 url 을 담지 않으므로, 페이지 소스를 뒤져도 서비스 주소가 나오지 않는다.
 * 잠금이 걸린 화면은 잠금해제 없이 이 문을 통과할 수 없다.
 */
async function goService(request, env, ctx, user, sess, key, inFrame = false) {
  const s = serviceOf(key);
  if (!s) return text('없는 화면입니다.', 404);

  const perm = await permissionFor(env, user, s);
  if (!perm.allowed) return redirect(`/?denied=${encodeURIComponent(key)}`);
  if (!isReady(s)) return redirect(`/?soon=${encodeURIComponent(key)}`);
  if (perm.reauth && !(await unlockedUntil(env, sess.sid, key))) {
    return redirect(`/?locked=${encodeURIComponent(key)}`);
  }

  logAccess(env, ctx, request, { userId: user.id, email: user.email, action: 'open', serviceKey: key });
  return redirect(inFrame ? frameUrlOf(s) : s.url, { 'Referrer-Policy': 'no-referrer' });
}

// ──────────────────────────────────────────────────────────────
// 협업 연동 — 최근 데이터 미리보기
// ──────────────────────────────────────────────────────────────

/**
 * 카드 앞면에 얹을 최근 항목.
 *
 * **잠긴 화면은 잠금을 푼 뒤에만 내용을 보여준다.** 메일 제목과 일정은 그 화면의
 * 내용이지 목차가 아니다 — 재인증을 세워 둔 화면의 속을 목록 API로 새어 나가게 하면
 * 자물쇠를 달아 둔 의미가 없다.
 */
async function apiFeed(request, env, ctx, user, sess, key) {
  const s = serviceOf(key);
  if (!s || !FEED_OF[key]) return fail('미리보기가 없는 화면입니다.', 404);

  const perm = await permissionFor(env, user, s);
  if (!perm.allowed) return fail('이 화면을 볼 권한이 없습니다.', 403, { code: 'forbidden' });
  if (perm.reauth && !(await unlockedUntil(env, sess.sid, key))) {
    return json({ state: 'locked', items: [] });
  }
  return json(await feedFor(env, ctx, user.id, key));
}

/** 동의 화면으로 보낸다. 돌아오는 곳은 /connect/<provider>/callback 하나뿐이다. */
async function apiConnectStart(request, env, user, name) {
  if (!PROVIDERS[name]) return text('없는 연결입니다.', 404);
  const to = await connectStart(env, user, name);
  if (!to) return redirect('/?connect=unconfigured#/g/collab');
  return redirect(to);
}

async function apiConnectCallback(request, env, ctx, user, name, url) {
  const err = url.searchParams.get('error');
  if (err) return redirect(`/?connect=${encodeURIComponent(err)}#/g/collab`);
  try {
    await connectCallback(env, user, name, url.searchParams.get('code'), url.searchParams.get('state'));
    logAccess(env, ctx, request, { userId: user.id, email: user.email, action: 'connect', serviceKey: name });
    return redirect('/?connect=ok#/g/collab');
  } catch (e) {
    return redirect(`/?connect=${encodeURIComponent(e.message)}#/g/collab`);
  }
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
// 오른쪽 프레임에 담을 수 있는가
// ──────────────────────────────────────────────────────────────
//
// 브라우저는 프레임이 막혔다는 것을 자바스크립트에 알려주지 않는다(막힌 프레임도
// onload 가 그냥 뜬다). 그래서 **서버가 대신 한 번 열어 보고** 응답 헤더를 읽는다.
//   · X-Frame-Options: DENY | SAMEORIGIN        → 담을 수 없다
//   · Content-Security-Policy: frame-ancestors … → 우리 주소가 없으면 담을 수 없다
//
// 이 결과를 미리 알아 두어야 하는 이유: 누를 때 비로소 물어보면, 답이 온 뒤에
// 여는 새 탭을 브라우저가 팝업으로 보고 막는다. 그래서 화면이 들어올 때 한 번
// 물어 두고, 누르는 순간에는 이미 알고 있는 것으로 결정한다.
//
// 결과는 KV에 하루 담아 둔다. 남의 사이트를 우리가 반복해서 두드릴 이유가 없다.

const FRAME_TTL = 86400;

/** 프레임에 넣을 주소. 따로 내주는 것이 있으면 그것을, 없으면 본 주소를 쓴다. */
const frameUrlOf = (s) => s.frameUrl || s.url;

/** 캐시 키에 섞을 짧은 지문. 주소가 바뀌면 옛 판정이 딸려 오지 않게 한다. */
async function shortHash(text) {
  const bits = await crypto.subtle.digest('SHA-256', enc.encode(String(text)));
  return b64url(new Uint8Array(bits)).slice(0, 12);
}

/** 헤더만 보고 판단한다. 본문은 읽지 않고 곧바로 버린다. */
function frameAllowed(res, origin) {
  const xfo = String(res.headers.get('X-Frame-Options') || '').trim().toLowerCase();
  if (xfo === 'deny' || xfo === 'sameorigin' || xfo.startsWith('allow-from')) return false;

  const csp = String(res.headers.get('Content-Security-Policy') || '');
  const m = csp.match(/frame-ancestors([^;]*)/i);
  if (m) {
    const list = m[1].trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!list.length || list.includes("'none'")) return false;
    const host = new URL(origin).host;
    const ok = list.some(
      (v) => v === '*' || v === origin.toLowerCase() || v === host || (v.startsWith('*.') && host.endsWith(v.slice(1)))
    );
    if (!ok) return false;
  }
  return true;
}

async function probeFrame(env, s) {
  if (s.frame === false) return false;
  if (!isReady(s)) return false;
  // frame: true 는 "조사하지 말고 담아라"다. 로그인해야 보이는 임베드는 서버가
  // 로그인하지 않은 채로 두드려서 구글 로그인 화면(DENY)을 보게 된다.
  if (s.frame === true) return true;
  const url = frameUrlOf(s);           // 프레임에 실제로 들어갈 주소를 조사해야 한다
  let target;
  try {
    target = new URL(url);
  } catch {
    return false;                       // 상대 주소(포털 안 화면) — 프레임을 쓸 일이 없다
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return false;  // obsidian:// 등

  // 주소를 고치면 옛 판정이 남지 않게 캐시 키에 주소를 섞는다.
  const cacheKey = `frame:${s.key}:${await shortHash(url)}`;
  const hit = await env.SESSIONS.get(cacheKey, 'json').catch(() => null);
  if (hit && typeof hit.ok === 'boolean') return hit.ok;

  let ok = true;
  try {
    // redirect:'manual' 로 두면 중간 302에 헤더가 없어 오판한다 — 끝까지 따라간다.
    const res = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': 'JAPIS/1.0' } });
    ok = frameAllowed(res, env.BASE_URL);
    if (res.body) await res.body.cancel();
  } catch (e) {
    // 열어 보지도 못했으면 프레임에 담아 봐야 빈 칸이다.
    console.warn('frame 조사 실패', s.key, e.message);
    ok = false;
  }
  await env.SESSIONS.put(cacheKey, JSON.stringify({ ok, at: nowIso() }), { expirationTtl: FRAME_TTL });
  return ok;
}

/** 이 사람에게 보이는 화면들을 한 번에 조사해 { key: true|false } 로 돌려준다. */
async function apiFrameable(env, user) {
  const perms = await loadPerms(env, user.id);
  const admin = user.role === 'admin';
  const mine = SERVICES.filter(
    (s) => !isAlways(s) && s.external && (admin || !!perms.get(s.key)?.allowed)
  );
  const out = {};
  await Promise.all(
    mine.map(async (s) => {
      out[s.key] = await probeFrame(env, s);
    })
  );
  return json({ frameable: out });
}

// ──────────────────────────────────────────────────────────────
// 날씨 — 상단 메뉴의 "지금"
// ──────────────────────────────────────────────────────────────
//
// 왜 Worker를 거치는가: 브라우저가 바깥 날씨 서버에 직접 말하면 그 서버가 우리 사용자의
// IP를 보게 된다. 개인 포털에서 굳이 그럴 이유가 없다. 여기서 한 번 물어보고 KV에
// 10분 담아 두면, 몇 명이 몇 번을 새로 고치든 바깥으로 나가는 요청은 10분에 한 번이다.
//
// Open-Meteo 는 키가 필요 없다(그래서 등록할 시크릿이 없다). 위치는 [vars] 에서 바꾼다.

const WEATHER_TTL = 600;

/** WMO 기상코드 → 사람 말과 그림 하나. 표에 없는 코드는 그냥 '흐림'으로 둔다. */
const WMO = {
  0:  ['맑음', '☀️'],   1:  ['대체로 맑음', '🌤️'], 2:  ['구름 조금', '⛅'], 3:  ['흐림', '☁️'],
  45: ['안개', '🌫️'],  48: ['안개', '🌫️'],
  51: ['이슬비', '🌦️'], 53: ['이슬비', '🌦️'],      55: ['이슬비', '🌦️'],
  56: ['언 비', '🌧️'],  57: ['언 비', '🌧️'],
  61: ['약한 비', '🌧️'], 63: ['비', '🌧️'],          65: ['강한 비', '🌧️'],
  66: ['언 비', '🌧️'],  67: ['언 비', '🌧️'],
  71: ['약한 눈', '🌨️'], 73: ['눈', '🌨️'],          75: ['많은 눈', '❄️'], 77: ['싸락눈', '🌨️'],
  80: ['소나기', '🌦️'], 81: ['소나기', '🌧️'],       82: ['강한 소나기', '⛈️'],
  85: ['소나기눈', '🌨️'], 86: ['소나기눈', '🌨️'],
  95: ['천둥번개', '⛈️'], 96: ['천둥번개', '⛈️'],     99: ['천둥번개', '⛈️'],
};

async function apiWeather(env, ctx) {
  const lat = Number(env.WEATHER_LAT) || 37.5665;       // 기본값: 서울시청
  const lon = Number(env.WEATHER_LON) || 126.978;
  const place = String(env.WEATHER_PLACE || '서울');
  const cacheKey = `weather:${lat},${lon}`;

  const hit = await env.SESSIONS.get(cacheKey, 'json').catch(() => null);
  if (hit) return json(hit, 200, { 'Cache-Control': 'no-store' });

  try {
    const q = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current: 'temperature_2m,apparent_temperature,weather_code',
      daily: 'temperature_2m_max,temperature_2m_min',
      timezone: 'Asia/Seoul',
      forecast_days: '1',
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
    if (!res.ok) throw new Error(`날씨 응답 ${res.status}`);
    const d = await res.json();

    const code = Number(d.current?.weather_code);
    const [label, icon] = WMO[code] || ['흐림', '☁️'];
    const out = {
      state: 'ok',
      place,
      icon,
      label,
      temp: Math.round(Number(d.current?.temperature_2m)),
      feels: Math.round(Number(d.current?.apparent_temperature)),
      high: Math.round(Number(d.daily?.temperature_2m_max?.[0])),
      low: Math.round(Number(d.daily?.temperature_2m_min?.[0])),
      at: nowIso(),
    };
    const put = env.SESSIONS.put(cacheKey, JSON.stringify(out), { expirationTtl: WEATHER_TTL });
    if (ctx) ctx.waitUntil(put);
    else await put;
    return json(out, 200, { 'Cache-Control': 'no-store' });
  } catch (e) {
    // 날씨가 안 나오는 것과 포털이 멈추는 것은 다르다 — 조용히 비워서 돌려준다.
    console.warn('날씨 실패', e.message);
    return json({ state: 'error', place, note: e.message }, 200, { 'Cache-Control': 'no-store' });
  }
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

      // ---- 생체인증(패스키) ----
      // 로그인 전에 열려 있는 둘. 어떤 계정이 있는지는 알려주지 않는다.
      if (path === '/api/webauthn/login/options' && method === 'POST') return apiPasskeyLoginOptions(request, env);
      if (path === '/api/webauthn/login' && method === 'POST') return apiPasskeyLogin(request, env, ctx);

      if (path === '/api/webauthn/register/options' && method === 'POST') {
        return requireLogin(request, env, (user) => apiPasskeyRegisterOptions(request, env, user));
      }
      if (path === '/api/webauthn/register' && method === 'POST') {
        return requireLogin(request, env, (user) => apiPasskeyRegister(request, env, ctx, user));
      }
      if (path === '/api/webauthn/credentials' && method === 'GET') {
        return requireLogin(request, env, async (user) =>
          json({ credentials: (await listCredentials(env, user.id)).map(credView), rpId: rpIdOf(request) })
        );
      }
      const mCred = path.match(/^\/api\/webauthn\/credentials\/([A-Za-z0-9_-]{1,255})$/);
      if (mCred && method === 'DELETE') {
        return requireLogin(request, env, (user) => apiPasskeyDelete(request, env, ctx, user, mCred[1]));
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
      if (path === '/api/unlock/options' && method === 'POST') {
        return requireLogin(request, env, (user, sess) => apiUnlockOptions(request, env, user, sess));
      }

      // ---- 오른쪽 프레임에 담을 수 있는 화면이 어느 것인지 ----
      if (path === '/api/frameable' && method === 'GET') {
        return requireLogin(request, env, (user) => apiFrameable(env, user));
      }

      // ---- 상단 메뉴의 '지금' (날짜·시간은 브라우저가, 날씨만 여기서) ----
      if (path === '/api/weather' && method === 'GET') {
        return requireLogin(request, env, () => apiWeather(env, ctx));
      }

      // ---- 협업 연동 ----
      if (path === '/api/connect' && method === 'GET') {
        return requireLogin(request, env, async (user) => json({ connections: await connectionStatus(env, user.id) }));
      }
      const mConn = path.match(/^\/api\/connect\/([a-z]{1,20})$/);
      if (mConn && method === 'DELETE') {
        return requireLogin(request, env, async (user) => {
          await disconnect(env, user.id, mConn[1]);
          return json({ ok: true, connections: await connectionStatus(env, user.id) });
        });
      }
      const mFeed = path.match(/^\/api\/feed\/([a-z0-9_-]{1,40})$/i);
      if (mFeed && method === 'GET') {
        return requireLogin(request, env, (user, sess) => apiFeed(request, env, ctx, user, sess, mFeed[1]));
      }
      const mStart = path.match(/^\/connect\/([a-z]{1,20})\/start$/);
      if (mStart && method === 'GET') {
        return requireLogin(request, env, (user) => apiConnectStart(request, env, user, mStart[1]));
      }
      const mBack = path.match(/^\/connect\/([a-z]{1,20})\/callback$/);
      if (mBack && method === 'GET') {
        return requireLogin(request, env, (user) => apiConnectCallback(request, env, ctx, user, mBack[1], url));
      }

      // ---- 실제 서비스로 나가는 유일한 문 ----
      const mGo = path.match(/^\/go\/([a-z0-9_-]{1,40})$/i);
      if (mGo && method === 'GET') {
        // ?in=frame 이면 오른쪽 프레임이 부른 것이다 — frameUrl 이 있으면 그쪽으로 보낸다.
        const inFrame = url.searchParams.get('in') === 'frame';
        return requireLogin(request, env, (user, sess) => goService(request, env, ctx, user, sess, mGo[1], inFrame));
      }

      // ---- Jaden wiki (포털 안 메모) ----
      // 문은 'jadenwiki' 권한 하나다(requireWiki). 메모는 사람마다 따로이므로
      // 아래 함수들은 전부 user.id 를 받아 질의의 WHERE 에 붙인다.
      if (path === '/api/wiki' && method === 'GET') {
        return requireWiki(request, env, async (user) => json(await wikiOverview(env, user.id)));
      }
      if (path === '/api/wiki/notes' && method === 'GET') {
        return requireWiki(request, env, async (user) => json({ notes: await listNotes(env, user.id, url) }));
      }
      if (path === '/api/wiki/notes' && method === 'POST') {
        return requireWiki(request, env, (user) => createNote(request, env, user.id));
      }
      if (path === '/api/wiki/trash' && method === 'DELETE') {
        return requireWiki(request, env, (user) => emptyTrash(env, user.id));
      }
      // .md 한 덩어리를 html 로만 바꿔 받는다(저장하지 않는다 — 편집기가 덧붙일 때 쓴다).
      if (path === '/api/wiki/render' && method === 'POST') {
        return requireWiki(request, env, () => renderMarkdown(request, env));
      }
      if (path === '/api/wiki/import' && method === 'POST') {
        return requireWiki(request, env, (user) => importFiles(request, env, user.id));
      }
      if (path === '/api/wiki/files' && method === 'POST') {
        return requireWiki(request, env, (user) => uploadFile(request, env, user.id));
      }
      // 파일 이름에 '/'가 들어간다(<user_id>/<uuid>.<확장자>) — 여기만 남은 경로를 통째로 받는다.
      const mFile = path.match(/^\/api\/wiki\/files\/(\d+\/[A-Za-z0-9._-]{1,120})$/);
      if (mFile && method === 'GET') {
        return requireWiki(request, env, (user) => serveFile(env, user.id, decodeURIComponent(mFile[1])));
      }
      const mNote = path.match(/^\/api\/wiki\/notes\/(\d+)$/);
      if (mNote && method === 'GET') {
        return requireWiki(request, env, (user) => getNote(env, user.id, Number(mNote[1])));
      }
      if (mNote && method === 'PATCH') {
        return requireWiki(request, env, (user) => updateNote(request, env, user.id, Number(mNote[1])));
      }
      if (mNote && method === 'DELETE') {
        return requireWiki(request, env, (user) =>
          deleteNote(env, user.id, Number(mNote[1]), url.searchParams.get('purge') === '1')
        );
      }
      const mExport = path.match(/^\/api\/wiki\/notes\/(\d+)\/export$/);
      if (mExport && method === 'GET') {
        return requireWiki(request, env, (user) => exportNote(env, user.id, Number(mExport[1])));
      }
      // 공유 켜기(POST) · 끄기(DELETE). 켠 뒤의 주소는 아래 /s/<이름표> 다.
      const mShare = path.match(/^\/api\/wiki\/notes\/(\d+)\/share$/);
      if (mShare && (method === 'POST' || method === 'DELETE')) {
        return requireWiki(request, env, (user) =>
          shareNote(env, user.id, Number(mShare[1]), method === 'POST')
        );
      }
      if (path === '/api/wiki/folders' && method === 'POST') {
        return requireWiki(request, env, (user) => createFolder(request, env, user.id));
      }
      // 끌어다 놓은 폴더 차례. /folders/<번호> 보다 **먼저** 본다 — 'order' 는 번호가 아니다.
      if (path === '/api/wiki/folders/order' && method === 'PUT') {
        return requireWiki(request, env, (user) => reorderFolders(request, env, user.id));
      }
      const mFolder = path.match(/^\/api\/wiki\/folders\/(\d+)$/);
      if (mFolder && method === 'PATCH') {
        return requireWiki(request, env, (user) => updateFolder(request, env, user.id, Number(mFolder[1])));
      }
      if (mFolder && method === 'DELETE') {
        return requireWiki(request, env, (user) => deleteFolder(env, user.id, Number(mFolder[1])));
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

      // ---- 공유된 메모 한 장 (로그인 없이 열리는 **유일한** 화면) ----
      // 주소에 메모 번호가 없다 — 32자 무작위 이름표 하나뿐이라 옆 것을 눌러 볼 수 없다.
      // 포털 껍데기를 주지 않고 그 메모만 담은 html 한 장을 그 자리에서 만들어 보낸다.
      const mShared = path.match(/^\/s\/([a-f0-9]{32})$/);
      if (mShared && (method === 'GET' || method === 'HEAD')) {
        return sharedNotePage(env, mShared[1]);
      }

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
