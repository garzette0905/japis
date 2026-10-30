// Play Lists — '유튜브에서 가져오기'. 유튜브에서 좋아요를 누른 동영상 중 음악만 골라 담는다.
//
// 이 파일이 지키는 것.
//
//   1. **읽기만 한다.** youtube.readonly 권한으로 좋아요 목록을 읽을 뿐, 유튜브 쪽은 건드리지 않는다.
//   2. **여러 번 눌러도 같다.** 이미 담긴 동영상(주소의 v= 번호로 본다)은 건너뛴다.
//      손으로 youtu.be/… 나 music.youtube.com/… 으로 적어 둔 곡도 같은 동영상이면 같은 곡이다.
//   3. **가수는 하나로 모은다.** 같은 이름(대소문자 무시)의 가수가 있으면 그 아래에 넣는다.
//   4. **질의를 아낀다.** Worker 한 번에 D1 질의 수가 정해져 있다. 곡마다 질의하지 않고
//      한꺼번에 읽고, 넣을 것은 batch 로 묶는다.

import { accessToken, providerReady } from './connect.js';

const nowIso = () => new Date().toISOString();

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

const LIKED = 'https://www.googleapis.com/youtube/v3/videos?myRating=like&part=snippet&maxResults=50';
const MAX_PAGES = 20;       // 50 × 20 = 최근 좋아요 1,000개까지 본다
const MUSIC_CATEGORY = '10'; // 유튜브 동영상 분류 '음악'
const CHUNK = 50;

// ──────────────────────────────────────────────────────────────
// 동영상 → 가수 · 곡
// ──────────────────────────────────────────────────────────────

/** 유튜브 주소에서 동영상 번호. 유튜브 주소가 아니면 null. */
export function videoIdOf(raw) {
  let u;
  try {
    u = new URL(String(raw || ''));
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
  if (host !== 'youtube.com' && host !== 'music.youtube.com') return null;
  if (u.searchParams.get('v')) return u.searchParams.get('v');
  const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)/);
  return m ? m[1] : null;
}

const TAG_WORDS =
  /official|mv|m\/v|music video|lyric|lyrics|audio|visualizer|video|performance|live clip|teaser|hd|4k|뮤직비디오|가사|공식/i;

/** 제목의 꼬리표·따옴표를 걷어 낸다. "'Blueming' (Official MV)" → "Blueming" */
function tidyTitle(s) {
  let t = String(s || '');
  // (Official MV) · [M/V] · 【MV】 처럼 괄호 안이 꼬리표인 것만 지운다. (feat. …) 는 남긴다.
  t = t.replace(/\s*[([【]([^)\]】]*)[)\]】]/g, (all, inner) => (TAG_WORDS.test(inner) ? ' ' : all));
  t = t.replace(/\s+(?:official\s+)?(?:mv|m\/v|music video)\s*$/i, '');
  t = t.replace(/\s+/g, ' ').trim();
  const q = t.match(/^['"‘’“”](.+)['"‘’“”]$/);
  if (q) t = q[1].trim();
  return t;
}

/** 채널 이름을 가수 이름으로. "IU - Topic" → "IU", "TaylorSwiftVEVO" → "TaylorSwift" */
const tidyChannel = (s) =>
  String(s || '')
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/\s*VEVO$/i, '')
    .replace(/\s+official$/i, '')
    .trim();

/**
 * 좋아요 한 건을 곡 한 줄로. 음악이 아니면 null.
 *   · 유튜브 뮤직이 만든 'XXX - Topic' 채널 — 채널이 가수, 제목이 곡이다.
 *   · 그 밖에는 제목이 '가수 - 곡' 꼴이면 그렇게 나누고, 아니면 채널을 가수로 본다.
 */
export function trackFromVideo(v) {
  const sn = v?.snippet || {};
  const id = typeof v?.id === 'string' ? v.id : null;
  if (!id) return null;
  const channel = String(sn.channelTitle || '');
  const topic = /\s-\sTopic$/i.test(channel);
  if (sn.categoryId !== MUSIC_CATEGORY && !topic) return null;

  let artist = tidyChannel(channel);
  let title = String(sn.title || '');
  if (!topic) {
    // 앞머리의 [MV] · [Special Clip] 같은 꼬리표를 먼저 걷어야 '가수 - 곡'이 보인다.
    const bare = title.replace(/^\s*(?:[[【][^\]】]*[\]】]\s*)+/, '');
    const m = bare.match(/^(.+?)\s+[-–—_]\s+(.+)$/);
    if (m && tidyTitle(m[2])) {
      artist = tidyTitle(m[1]);
      title = m[2];
    } else {
      title = bare;
    }
  }
  title = tidyTitle(title);
  artist = artist.slice(0, 80).trim();
  title = title.slice(0, 150).trim();
  if (!artist || !title) return null;
  return { videoId: id, artist, title, url: `https://www.youtube.com/watch?v=${id}` };
}

// ──────────────────────────────────────────────────────────────
// 유튜브 좋아요 목록
// ──────────────────────────────────────────────────────────────

async function likedPage(token, pageToken) {
  const url = pageToken ? `${LIKED}&pageToken=${encodeURIComponent(pageToken)}` : LIKED;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const e = new Error(`유튜브 응답 ${res.status}`);
    e.status = res.status;
    e.body = await res.text().catch(() => '');
    throw e;
  }
  return res.json();
}

async function fetchLiked(token) {
  const items = [];
  let pageToken = '';
  for (let i = 0; i < MAX_PAGES; i++) {
    const data = await likedPage(token, pageToken);
    items.push(...(data.items || []));
    pageToken = data.nextPageToken || '';
    if (!pageToken) return { items, truncated: false };
  }
  return { items, truncated: true };
}

// ──────────────────────────────────────────────────────────────
// 담기
// ──────────────────────────────────────────────────────────────

async function runBatch(env, stmts) {
  const out = [];
  for (let i = 0; i < stmts.length; i += CHUNK) out.push(...(await env.DB.batch(stmts.slice(i, i + CHUNK))));
  return out;
}

/** 곡 줄들을 담는다. 이미 있는 동영상은 건너뛴다. */
export async function saveTracks(env, userId, found) {
  const { results: urlRows } = await env.DB.prepare(
    "SELECT url FROM music_tracks WHERE user_id = ? AND url != ''"
  )
    .bind(userId)
    .all();
  const have = new Set((urlRows || []).map((r) => videoIdOf(r.url)).filter(Boolean));

  const fresh = [];
  for (const t of found) {
    if (have.has(t.videoId)) continue;
    have.add(t.videoId);
    fresh.push(t);
  }
  const skipped = found.length - fresh.length;
  if (!fresh.length) return { added: 0, skipped, artistsAdded: 0 };

  const { results: artistRows } = await env.DB.prepare('SELECT id, name FROM music_artists WHERE user_id = ?')
    .bind(userId)
    .all();
  const artists = new Map((artistRows || []).map((r) => [r.name.toLowerCase(), r]));

  const newNames = [...new Set(fresh.map((t) => t.artist).filter((n) => !artists.has(n.toLowerCase())))]
    .filter((n, i, all) => all.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === i);
  const at = nowIso();
  const made = await runBatch(
    env,
    newNames.map((n) =>
      env.DB.prepare(
        "INSERT INTO music_artists (user_id, name, memo, created_at) VALUES (?, ?, '', ?) RETURNING id, name"
      ).bind(userId, n, at)
    )
  );
  for (const r of made) {
    const row = r.results?.[0];
    if (row) artists.set(row.name.toLowerCase(), row);
  }

  const { results: orders } = await env.DB.prepare(
    'SELECT artist_id, MAX(sort_order) AS m FROM music_tracks WHERE user_id = ? GROUP BY artist_id'
  )
    .bind(userId)
    .all();
  const next = new Map((orders || []).map((o) => [o.artist_id, Number(o.m) || 0]));

  const stmts = [];
  for (const t of fresh) {
    const a = artists.get(t.artist.toLowerCase());
    if (!a) continue;
    const order = (next.get(a.id) || 0) + 1;
    next.set(a.id, order);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO music_tracks (user_id, artist_id, title, url, memo, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, '', ?, ?, ?)`
      ).bind(userId, a.id, t.title, t.url, order, at, at)
    );
  }
  await runBatch(env, stmts);
  return { added: stmts.length, skipped, artistsAdded: made.length };
}

/**
 * POST /api/music/youtube-import
 *   { ok, scanned, music, added, skipped, artistsAdded, truncated }
 * 연결이 없거나 권한이 모자라면 code 로 알려 준다 — 화면이 '구글 (다시) 연결하기'를 띄운다.
 */
export async function importYoutubeLikes(env, userId) {
  if (!providerReady(env, 'google')) {
    return json({ error: '구글 연결이 설정되어 있지 않습니다.', code: 'unconfigured' }, 503);
  }
  let liked;
  try {
    let token = await accessToken(env, userId, 'google');
    if (!token) return json({ error: '먼저 구글을 연결해주세요.', code: 'disconnected' }, 409);
    try {
      liked = await fetchLiked(token);
    } catch (e) {
      if (e.status !== 401) throw e;
      token = await accessToken(env, userId, 'google', { forceRefresh: true });
      if (!token) return json({ error: '먼저 구글을 연결해주세요.', code: 'disconnected' }, 409);
      liked = await fetchLiked(token);
    }
  } catch (e) {
    const body = String(e.body || e.message || '');
    console.warn('유튜브 가져오기 실패', e.status, body.slice(0, 300));
    // 클라우드 콘솔에서 YouTube Data API 를 켜지 않았으면 403 에 이 사유가 실려 온다.
    if (e.status === 403 && /accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/i.test(body)) {
      return json(
        { error: 'Google Cloud 콘솔에서 YouTube Data API v3 를 사용 설정해주세요.', code: 'api_disabled' },
        502
      );
    }
    if (e.status === 403 && /insufficient|scope/i.test(body)) {
      return json({ error: '유튜브 권한이 없습니다. 구글을 다시 연결해주세요.', code: 'reconnect' }, 409);
    }
    if ((e.status === 400 || e.status === 401) && /invalid_grant|expired|revoked|invalid|credential/i.test(body)) {
      return json({ error: '구글 연결이 만료되었습니다. 다시 연결해주세요.', code: 'reconnect' }, 409);
    }
    return json({ error: `유튜브 좋아요 목록을 읽지 못했습니다. (${e.message})` }, 502);
  }

  const found = liked.items.map(trackFromVideo).filter(Boolean);
  const saved = await saveTracks(env, userId, found);
  return json({ ok: true, scanned: liked.items.length, music: found.length, truncated: liked.truncated, ...saved });
}
