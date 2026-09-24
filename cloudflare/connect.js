// JAPIS 협업 연동 — 바깥 서비스의 **최근 것 몇 개**를 카드 앞면에 얹는다.
//
// 포털이 하는 일은 프록시다. 브라우저는 구글·마이크로소프트에 직접 말하지 않고,
// 토큰도 만지지 않는다. Worker가 대신 물어보고 **제목·시각·썸네일 주소만** 추려서
// 돌려준다. 그래서 화면에는 메일 본문도, 파일 내용도 내려가지 않는다.
//
// 한 번에 로그인
//   구글 포토·메일·캘린더는 **연결 하나**(google)를 나눠 쓴다. 한 번 동의하면 셋 다
//   열린다. OneDrive 는 계정이 달라(garzette@naver.com) 따로 잡는다(microsoft).
//
// 토큰 보관
//   Refresh Token 은 AES-GCM 으로 싸서 D1에 둔다. 열쇠는 SESSION_SECRET 에서 뽑는다.
//   D1 백업이 흘러도 그 자체로는 남의 메일함이 열리지 않게 하기 위해서다.
//
// 설정 (없으면 카드에 '연결하기'만 뜨고, 포털의 다른 기능에는 영향이 없다)
//   GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET      — Google Cloud Console
//   MS_CLIENT_ID     · MS_CLIENT_SECRET          — Microsoft Entra (개인 계정 'consumers')
//   리디렉션 주소: https://<포털주소>/connect/<google|microsoft>/callback

const enc = new TextEncoder();
const nowIso = () => new Date().toISOString();

const b64url = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const b64urlToBytes = (s) => {
  const t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

// ──────────────────────────────────────────────────────────────
// 제공자
// ──────────────────────────────────────────────────────────────

export const PROVIDERS = {
  google: {
    label: '구글',
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    // 네 화면(포토·메일·캘린더·할일)이 이 동의 하나를 함께 쓴다. 전부 읽기 전용이다.
    //
    // ⚠️ 이 목록을 늘리면 **이미 연결해 둔 사람의 토큰에는 새 권한이 없다.** 구글은
    //    옛 토큰을 조용히 그대로 쓰다가 새 API에서만 403(insufficient scopes)을 낸다.
    //    그래서 늘린 뒤에는 '연결 끊기 → 연결하기'를 한 번 해야 한다(화면이 안내한다).
    //
    // calendar.events · tasks 는 **쓰기까지** 하는 권한이다. 대시보드의 한 줄 입력칸
    // (/api/ask)이 "내일 오후 3시 치과"를 받아 캘린더에 실제로 넣어야 하기 때문이다.
    // 나머지 둘(사진·메일)은 읽기 전용 그대로다 — 메일을 대신 보내는 일은 없다.
    scope: [
      'https://www.googleapis.com/auth/photoslibrary.readonly',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/tasks',
    ].join(' '),
    hint: 'garzette@gmail.com',
    idOf: (env) => env.GOOGLE_CLIENT_ID,
    secretOf: (env) => env.GOOGLE_CLIENT_SECRET,
    extraAuth: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
  },
  microsoft: {
    label: '마이크로소프트',
    // 개인(Outlook·Hotmail·타사 메일) 계정만 받는 'consumers' 테넌트.
    auth: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
    scope: 'offline_access User.Read Files.Read',
    hint: 'garzette@naver.com',
    idOf: (env) => env.MS_CLIENT_ID,
    secretOf: (env) => env.MS_CLIENT_SECRET,
    extraAuth: { response_mode: 'query' },
  },
};

/** 어느 화면이 어느 연결을 쓰는가. 여기 없는 화면은 미리보기가 없다. */
export const FEED_OF = {
  gphotos: 'google',
  gmail: 'google',
  gcalendar: 'google',
  gtasks: 'google',
  onedrive: 'microsoft',
};

export const providerReady = (env, name) => {
  const p = PROVIDERS[name];
  return !!(p && p.idOf(env) && p.secretOf(env));
};

const redirectUri = (env, name) => `${env.BASE_URL}/connect/${name}/callback`;

// ──────────────────────────────────────────────────────────────
// 토큰 보관 (AES-GCM)
// ──────────────────────────────────────────────────────────────

async function aesKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(String(env.SESSION_SECRET || '')));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function seal(env, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(plain)));
  const packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv, 0);
  packed.set(ct, iv.length);
  return b64url(packed);
}

async function unseal(env, packed) {
  try {
    const bytes = b64urlToBytes(packed);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12) },
      await aesKey(env),
      bytes.slice(12)
    );
    return new TextDecoder().decode(plain);
  } catch {
    // SESSION_SECRET 이 바뀌었으면 여기로 온다 — 다시 연결하면 된다.
    return null;
  }
}

const getConn = (env, userId, provider) =>
  env.DB.prepare('SELECT * FROM connections WHERE user_id = ? AND provider = ?').bind(userId, provider).first();

// ──────────────────────────────────────────────────────────────
// OAuth 왕복
// ──────────────────────────────────────────────────────────────

/** 동의 화면 주소. state 는 KV에 10분만 둔다(돌아온 것이 내가 보낸 것인지 확인). */
export async function connectStart(env, user, name) {
  const p = PROVIDERS[name];
  if (!p) return null;
  if (!providerReady(env, name)) return null;

  const state = b64url(crypto.getRandomValues(new Uint8Array(18)));
  await env.SESSIONS.put(`oauth:${state}`, JSON.stringify({ uid: user.id, provider: name }), { expirationTtl: 600 });

  const q = new URLSearchParams({
    client_id: p.idOf(env),
    redirect_uri: redirectUri(env, name),
    response_type: 'code',
    scope: p.scope,
    state,
    login_hint: p.hint,
    ...p.extraAuth,
  });
  return `${p.auth}?${q}`;
}

async function exchange(env, name, params) {
  const p = PROVIDERS[name];
  const res = await fetch(p.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: p.idOf(env),
      client_secret: p.secretOf(env),
      redirect_uri: redirectUri(env, name),
      ...params,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error_description || data.error || `토큰 교환 실패 (${res.status})`);
    e.status = res.status;
    e.body = JSON.stringify(data).slice(0, 400);
    throw e;
  }
  return data;
}

/** 동의를 마치고 돌아온 자리. 성공하면 연결이 저장된다. */
export async function connectCallback(env, user, name, code, state) {
  const saved = await env.SESSIONS.get(`oauth:${String(state || '')}`, 'json');
  if (!saved || saved.uid !== user.id || saved.provider !== name) throw new Error('연결 요청이 만료되었습니다.');
  await env.SESSIONS.delete(`oauth:${state}`);

  const tok = await exchange(env, name, { code, grant_type: 'authorization_code' });
  if (!tok.refresh_token) {
    throw new Error('갱신 토큰을 받지 못했습니다. 제공자 화면에서 이 앱의 접근 권한을 지운 뒤 다시 연결해주세요.');
  }

  const expiresAt = Date.now() + Math.max(60, Number(tok.expires_in) || 3600) * 1000;
  await env.DB.prepare(
    `INSERT OR REPLACE INTO connections
       (user_id, provider, refresh_token, access_token, expires_at, account, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      user.id,
      name,
      await seal(env, tok.refresh_token),
      await seal(env, tok.access_token || ''),
      expiresAt,
      PROVIDERS[name].hint,
      nowIso()
    )
    .run();
}

export async function disconnect(env, userId, name) {
  await env.DB.prepare('DELETE FROM connections WHERE user_id = ? AND provider = ?').bind(userId, name).run();
  const list = await env.SESSIONS.list({ prefix: `feed:${userId}:` });
  await Promise.all((list.keys || []).map((k) => env.SESSIONS.delete(k.name)));
}

/**
 * 그 화면의 미리보기 캐시를 버린다.
 * 방금 넣은 일정이 5분(캐시 수명) 뒤에야 '오늘' 칸에 나타나면 넣은 것 같지가 않다 —
 * 무언가를 만든 쪽에서 이 함수를 불러 다음 번에 새로 받아 오게 한다.
 */
export const dropFeedCache = (env, userId, keys) =>
  Promise.all([].concat(keys).map((k) => env.SESSIONS.delete(`feed:${userId}:${k}`).catch(() => {})));

export async function connectionStatus(env, userId) {
  const { results } = await env.DB.prepare('SELECT * FROM connections WHERE user_id = ?').bind(userId).all();
  const byName = new Map((results || []).map((r) => [r.provider, r]));
  return Object.entries(PROVIDERS).map(([name, p]) => ({
    provider: name,
    label: p.label,
    account: byName.get(name)?.account || p.hint,
    configured: providerReady(env, name),
    connected: byName.has(name),
    updatedAt: byName.get(name)?.updated_at || null,
  }));
}

/**
 * 쓸 수 있는 액세스 토큰. 만료가 가까우면 조용히 갱신해 둔다.
 * 대시보드의 한 줄 입력칸(ask.js)도 같은 문을 쓴다 — 토큰을 다루는 곳은 여기 하나다.
 */
export async function accessToken(env, userId, name, { forceRefresh = false } = {}) {
  const row = await getConn(env, userId, name);
  if (!row) return null;

  if (!forceRefresh && row.expires_at && Number(row.expires_at) - Date.now() > 120000) {
    const live = await unseal(env, row.access_token);
    if (live) return live;
  }

  const refresh = await unseal(env, row.refresh_token);
  if (!refresh) return null;

  const tok = await exchange(env, name, { refresh_token: refresh, grant_type: 'refresh_token' });
  const expiresAt = Date.now() + Math.max(60, Number(tok.expires_in) || 3600) * 1000;
  await env.DB.prepare(
    `UPDATE connections SET access_token = ?, expires_at = ?, refresh_token = ?, updated_at = ?
     WHERE user_id = ? AND provider = ?`
  )
    .bind(
      await seal(env, tok.access_token || ''),
      expiresAt,
      // 구글은 갱신할 때 refresh_token 을 다시 주지 않는다 — 그때는 갖고 있던 것을 그대로 둔다.
      tok.refresh_token ? await seal(env, tok.refresh_token) : row.refresh_token,
      nowIso(),
      userId,
      name
    )
    .run();
  return tok.access_token || null;
}

const authed = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

const askJson = async (url, token) => {
  const res = await fetch(url, authed(token));
  if (!res.ok) {
    const e = new Error(`${new URL(url).hostname} 응답 ${res.status}`);
    e.status = res.status;
    // 스코프를 늘린 뒤 옛 토큰으로 새 API를 부르면 여기로 온다. 본문의 사유까지 본다.
    e.body = await res.text().catch(() => '');
    throw e;
  }
  return res.json();
};

// ──────────────────────────────────────────────────────────────
// 미리보기 — 화면별로 '최근 것' 몇 개
// ──────────────────────────────────────────────────────────────

const FEED_MAX = 10;

/** Gmail 은 목록과 내용을 따로 준다. 안 읽은 것 5개의 제목·보낸이만 추린다. */
async function gmailFeed(token) {
  const list = await askJson(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${FEED_MAX}&q=${encodeURIComponent('is:unread in:inbox')}`,
    token
  );
  const ids = (list.messages || []).slice(0, FEED_MAX).map((m) => m.id);
  const items = await Promise.all(
    ids.map(async (id) => {
      const m = await askJson(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        token
      );
      const head = (name) => (m.payload?.headers || []).find((h) => h.name === name)?.value || '';
      const from = head('From').replace(/\s*<[^>]*>$/, '').replace(/^"|"$/g, '');
      // 목록에서 이 줄을 누르면 **그 메일**이 열려야 한다. 받은편지함만 열어 주면
      // 다시 찾아 들어가야 하므로 대화 번호를 그대로 주소에 박는다.
      return {
        title: head('Subject') || '(제목 없음)',
        sub: from,
        at: head('Date') || null,
        link: 'https://mail.google.com/mail/u/0/#inbox/' + encodeURIComponent(m.threadId || id),
      };
    })
  );
  return { items, note: items.length ? null : '안 읽은 메일이 없습니다.' };
}

async function calendarFeed(token) {
  const q = new URLSearchParams({
    timeMin: new Date().toISOString(),
    maxResults: String(FEED_MAX),
    singleEvents: 'true',
    orderBy: 'startTime',
  });
  const data = await askJson(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`, token);
  const items = (data.items || []).map((e) => ({
    title: e.summary || '(제목 없음)',
    sub: e.location || '',
    at: e.start?.dateTime || e.start?.date || null,
    allDay: !e.start?.dateTime,
    link: e.htmlLink || null,
  }));
  return { items, note: items.length ? null : '앞으로 잡힌 일정이 없습니다.' };
}

async function photosFeed(token) {
  const data = await askJson(`https://photoslibrary.googleapis.com/v1/mediaItems?pageSize=${FEED_MAX}`, token);
  const items = (data.mediaItems || []).map((m) => ({
    title: m.filename || '사진',
    at: m.mediaMetadata?.creationTime || null,
    // baseUrl 은 한 시간쯤 뒤 만료된다 — 그래서 캐시를 짧게 잡는다.
    thumb: m.baseUrl ? `${m.baseUrl}=w320-h320-c` : null,
    link: m.productUrl || null,
  }));
  return { items, note: items.length ? null : '최근 사진이 없습니다.' };
}

async function oneDriveFeed(token) {
  const data = await askJson(`https://graph.microsoft.com/v1.0/me/drive/recent?$top=${FEED_MAX}`, token);
  const items = (data.value || []).slice(0, FEED_MAX).map((f) => ({
    title: f.name || '파일',
    sub: f.remoteItem?.parentReference?.name || f.parentReference?.name || '',
    at: f.lastModifiedDateTime || null,
    link: f.webUrl || f.remoteItem?.webUrl || null,
  }));
  return { items, note: items.length ? null : '최근에 연 문서가 없습니다.' };
}

/** 아직 안 끝낸 할 일 몇 개. 기한이 있는 것이 먼저 온다. */
async function tasksFeed(token) {
  const q = new URLSearchParams({
    showCompleted: 'false',
    showHidden: 'false',
    maxResults: String(FEED_MAX * 2),   // 완료된 것이 섞여 와도 열 개는 남게 넉넉히
  });
  const data = await askJson(`https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?${q}`, token);

  const items = (data.items || [])
    .filter((t) => t.status !== 'completed' && t.title)
    // 기한이 있는 것을 앞에, 그 안에서는 빠른 것부터. 기한 없는 것은 뒤로 민다.
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'))
    .slice(0, FEED_MAX)
    .map((t) => ({
      title: t.title,
      sub: t.notes ? String(t.notes).replace(/[\r\n]+/g, ' ').trim().slice(0, 40) : '',
      at: t.due || null,
      allDay: true,                     // 구글 할일의 기한은 날짜까지다(시각이 없다)
      // 할일 API 는 항목별 주소를 줄 때도 있고 안 줄 때도 있다. 없으면 할일 화면으로.
      link: t.webViewLink || 'https://tasks.google.com/',
    }));

  return { items, note: items.length ? null : '남은 할 일이 없습니다.' };
}

const FEEDS = {
  gmail: gmailFeed,
  gcalendar: calendarFeed,
  gphotos: photosFeed,
  gtasks: tasksFeed,
  onedrive: oneDriveFeed,
};

/**
 * 카드 앞면에 얹을 것.
 *   { state: 'ok' | 'unconfigured' | 'disconnected' | 'error', items, note }
 * 무슨 일이 생겨도 던지지 않는다 — 미리보기가 안 나오는 것과 포털이 멈추는 것은 다르다.
 */
export async function feedFor(env, ctx, userId, key, { fresh = false } = {}) {
  const provider = FEED_OF[key];
  const fetcher = FEEDS[key];
  if (!provider || !fetcher) return { state: 'none', items: [] };
  if (!providerReady(env, provider)) return { state: 'unconfigured', items: [], provider };

  const cacheKey = `feed:${userId}:${key}`;
  // 사람이 새로 고침을 눌렀으면 담아 둔 것을 보지 않는다 — 그러려고 누른 것이다.
  const hit = fresh ? null : await env.SESSIONS.get(cacheKey, 'json');
  if (hit) return hit;

  try {
    let token = await accessToken(env, userId, provider);
    if (!token) return { state: 'disconnected', items: [], provider };

    let result;
    try {
      result = await fetcher(token);
    } catch (e) {
      // 저장된 만료 시각보다 Google의 실제 만료가 먼저 온 경우가 있다.
      // 한 번만 강제 갱신해 재시도하고, 그래도 실패하면 아래에서 재연결을 안내한다.
      if (e.status !== 401) throw e;
      token = await accessToken(env, userId, provider, { forceRefresh: true });
      if (!token) return { state: 'disconnected', items: [], provider };
      result = await fetcher(token);
    }
    const { items, note } = result;
    const out = { state: 'ok', provider, items, note, at: nowIso() };
    // 5분만 들고 있는다. 사진 썸네일 주소가 한 시간이면 만료되기 때문이기도 하다.
    const put = env.SESSIONS.put(cacheKey, JSON.stringify(out), { expirationTtl: 300 });
    if (ctx) ctx.waitUntil(put);
    else await put;
    return out;
  } catch (e) {
    console.warn('feed 실패', key, e.message);
    // 스코프를 늘린 뒤 옛 토큰으로 부르면 403이 온다. "불러오지 못했습니다"로 뭉뚱그리면
    // 무엇을 해야 하는지 알 수 없다 — 다시 연결하라고 그대로 말해 준다.
    if (
      (e.status === 401 && /expired|revoked|invalid|credential|token/i.test(String(e.body || e.message || ''))) ||
      (e.status === 400 && /invalid_grant|expired|revoked|invalid/i.test(String(e.body || e.message || '')))
    ) {
      return { state: 'reconnect', items: [], provider };
    }
    if (e.status === 403 && /insufficient|scope/i.test(String(e.body || ''))) {
      return { state: 'reconnect', items: [], provider };
    }
    return { state: 'error', items: [], provider, note: e.message };
  }
}
