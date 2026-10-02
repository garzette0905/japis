import { seal, unseal } from './connect.js';

const THREADS = 'https://graph.threads.net/v1.0';
const providers = {
  x: { id: 'X_CLIENT_ID', secret: 'X_CLIENT_SECRET', auth: 'https://x.com/i/oauth2/authorize',
    token: 'https://api.x.com/2/oauth2/token', scope: 'tweet.read users.read follows.read offline.access' },
  threads: { id: 'THREADS_CLIENT_ID', secret: 'THREADS_CLIENT_SECRET', auth: 'https://threads.net/oauth/authorize',
    token: 'https://graph.threads.net/oauth/access_token', scope: 'threads_basic,threads_profile_discovery,threads_read_replies' },
};
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const ready = (env, name) => !!(env[providers[name].id] && env[providers[name].secret]);
const callback = (env, name) => `${env.BASE_URL}/api/sns/${name}/callback`;
const conn = (env, uid, name) => env.DB.prepare('SELECT * FROM connections WHERE user_id = ? AND provider = ?').bind(uid, `sns_${name}`).first();
const settingsKey = (uid) => `sns:settings:${uid}`;

async function requestJson(url, options = {}) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const e = new Error(res.status === 429 ? '요청 한도에 도달했습니다. 잠시 후 새로고침해주세요.'
      : res.status === 401 ? '연결이 만료되었습니다. 계정을 다시 연결해주세요.'
      : res.status === 403 ? '앱의 읽기 권한 또는 API 이용 권한을 확인해주세요.'
      : `SNS 요청에 실패했습니다 (${res.status}). 연결과 앱 권한을 확인해주세요.`);
    e.status = res.status;
    throw e;
  }
  return data;
}
const get = (url, token) => requestJson(url, { headers: { Authorization: `Bearer ${token}` } });
async function exchange(env, name, params) {
  const p = providers[name];
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (name === 'x') headers.Authorization = `Basic ${btoa(`${encodeURIComponent(env[p.id])}:${encodeURIComponent(env[p.secret])}`)}`;
  return requestJson(p.token, { method: 'POST', headers, body: new URLSearchParams({
    client_id: env[p.id], ...(name === 'threads' ? { client_secret: env[p.secret] } : {}), ...params,
  }) });
}
async function save(env, uid, name, tok, account, previousRefresh = '') {
  if (!tok.access_token) throw new Error('계정 연결 토큰을 받지 못했습니다.');
  await env.DB.prepare(`INSERT OR REPLACE INTO connections
    (user_id, provider, refresh_token, access_token, expires_at, account, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(uid, `sns_${name}`, await seal(env, tok.refresh_token || previousRefresh), await seal(env, tok.access_token),
      Date.now() + (Number(tok.expires_in) || 3600) * 1000, JSON.stringify(account), new Date().toISOString()).run();
}
export async function snsStart(env, uid, name) {
  if (!ready(env, name)) throw new Error('관리자가 SNS 앱 연결 설정을 먼저 완료해야 합니다.');
  const state = b64(crypto.getRandomValues(new Uint8Array(24)));
  const verifier = b64(crypto.getRandomValues(new Uint8Array(48)));
  await env.SESSIONS.put(`sns:oauth:${state}`, JSON.stringify({ uid, name, verifier }), { expirationTtl: 600 });
  const q = new URLSearchParams({ client_id: env[providers[name].id], redirect_uri: callback(env, name),
    response_type: 'code', scope: providers[name].scope, state });
  if (name === 'x') {
    q.set('code_challenge_method', 'S256');
    q.set('code_challenge', b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  }
  return `${providers[name].auth}?${q}`;
}
export async function snsCallback(env, uid, name, url) {
  const state = url.searchParams.get('state') || '';
  const saved = await env.SESSIONS.get(`sns:oauth:${state}`, 'json');
  if (!saved || saved.uid !== uid || saved.name !== name) throw new Error('연결 요청이 만료되었습니다. 다시 연결해주세요.');
  await env.SESSIONS.delete(`sns:oauth:${state}`);
  if (url.searchParams.has('error') || !url.searchParams.get('code')) throw new Error('계정 연결을 취소했습니다.');
  let tok = await exchange(env, name, { grant_type: 'authorization_code', code: url.searchParams.get('code'),
    redirect_uri: callback(env, name), ...(name === 'x' ? { code_verifier: saved.verifier } : {}) });
  if (name === 'threads') {
    const q = new URLSearchParams({ grant_type: 'th_exchange_token', client_secret: env.THREADS_CLIENT_SECRET, access_token: tok.access_token });
    tok = await requestJson(`https://graph.threads.net/access_token?${q}`);
  }
  const me = await get(name === 'x' ? 'https://api.x.com/2/users/me' : `${THREADS}/me?fields=id,username`, tok.access_token);
  const account = name === 'x' ? me.data : me;
  if (!account?.id || !account?.username) throw new Error('연결한 계정을 확인하지 못했습니다.');
  await save(env, uid, name, tok, { id: account.id, username: account.username });
}
async function tokenFor(env, uid, name, row) {
  const token = await unseal(env, row.access_token);
  if (!token) throw new Error('계정을 다시 연결해주세요.');
  // Threads long-lived tokens can be refreshed after 24 hours, before expiry.
  const margin = name === 'threads' ? 7 * 86400000 : 120000;
  if (Number(row.expires_at) > Date.now() + margin) return token;
  if (name === 'threads' && Number(row.expires_at) <= Date.now()) throw new Error('Threads 연결이 만료되었습니다. 다시 연결해주세요.');
  const refresh = await unseal(env, row.refresh_token);
  const tok = name === 'x'
    ? await exchange(env, name, { grant_type: 'refresh_token', refresh_token: refresh || '' })
    : await requestJson(`https://graph.threads.net/refresh_access_token?${new URLSearchParams({ grant_type: 'th_refresh_token', access_token: token })}`);
  await save(env, uid, name, tok, JSON.parse(row.account), refresh || '');
  return tok.access_token;
}
export function parseProfiles(input) {
  const parts = String(input || '').split(/[\s,]+/).filter(Boolean);
  const names = parts.map((part) => {
    let name = part;
    if (/^https?:\/\//i.test(part)) {
      const url = new URL(part);
      if (!['threads.net', 'www.threads.net', 'threads.com', 'www.threads.com'].includes(url.hostname)) throw new Error('Threads 프로필 주소만 입력해주세요.');
      if (!/^\/@[\w.]+\/?$/.test(url.pathname)) throw new Error('게시물 주소 대신 Threads 프로필 주소를 입력해주세요.');
      name = url.pathname.replace(/\/$/, '').slice(1);
    }
    name = name.replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_.]{1,30}$/.test(name)) throw new Error('Threads 사용자명을 확인해주세요.');
    return name;
  });
  const unique = [...new Set(names)];
  if (unique.length > 20) throw new Error('관심 계정은 최대 20개까지 등록할 수 있습니다.');
  return unique;
}
export async function snsSettings(env, uid, input) {
  if (input !== undefined) {
    const profiles = parseProfiles(input);
    await env.SESSIONS.put(settingsKey(uid), JSON.stringify({ profiles }));
    return { profiles };
  }
  return await env.SESSIONS.get(settingsKey(uid), 'json') || { profiles: ['choi.openai'] };
}
export async function snsDisconnect(env, uid, name) {
  await env.DB.prepare('DELETE FROM connections WHERE user_id = ? AND provider = ?').bind(uid, `sns_${name}`).run();
}
const AI = /\b(ai|agi|llms?|gpt[\w.-]*|chatgpt|claude|gemini|openai|anthropic|deepseek|qwen|llama|mistral|copilot|codex|machine learning|deep learning|neural|transformers?|diffusion|agents?|rag)\b|인공지능|생성형|머신러닝|딥러닝|언어모델|언어 모델|에이전트|클로드|챗지피티|제미나이/i;
const IT = /\b(tech|technology|software|developer|coding|programming|cloud|cybersecurity|semiconductor|gpu|nvidia|robotics?|chips?|api|github|open.source)\b|반도체|소프트웨어|개발자|클라우드|코딩|로봇|정보보안|오픈소스|기술 트렌드/i;
export const topicOf = (text) => AI.test(text) ? 'AI' : IT.test(text) ? 'IT Trends' : null;
const metric = (n) => Number.isFinite(n) && n >= 0 ? n : null;
export const scoreOf = (p) => Object.values(p.metrics).every((v) => v !== null) ? Object.values(p.metrics).reduce((a, b) => a + b, 0) : null;
export function normalizeX(data) {
  const users = new Map((data.includes?.users || []).map((u) => [u.id, u]));
  return (data.data || []).map((p) => {
    const u = users.get(p.author_id) || {};
    const m = p.public_metrics || {};
    return { id: p.id, platform: 'x', author: u.name || u.username || 'X', username: u.username || '',
      text: p.note_tweet?.text || p.text || '', at: p.created_at, url: `https://x.com/i/status/${encodeURIComponent(p.id)}`,
      metrics: { likes: metric(m.like_count), replies: metric(m.reply_count), reposts: metric(m.retweet_count), quotes: metric(m.quote_count) },
      root: p.conversation_id || p.id, parent: p.referenced_tweets?.find((r) => r.type === 'replied_to')?.id || null };
  });
}
export function normalizeThreads(data) {
  return (data.data || []).map((p) => ({ id: p.id, platform: 'threads', author: p.username || 'Threads', username: p.username || '',
    text: p.text || '', at: p.timestamp, url: p.permalink || '', root: p.root_post?.id || p.id, parent: p.replied_to?.id || null,
    hasReplies: !!p.has_replies, metrics: { likes: null, replies: null, reposts: null, quotes: null } }));
}
export function buildFeed(posts, now = Date.now()) {
  const unique = [...new Map(posts.map((p) => [`${p.platform}:${p.id}`, p])).values()];
  const recent = unique.filter((p) => Number.isFinite(Date.parse(p.at)) && Date.parse(p.at) >= now - 7 * 86400000 && Date.parse(p.at) <= now);
  const items = recent.map((p) => ({ ...p, topic: topicOf(p.text), score: scoreOf(p) })).filter((p) => p.topic)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id));
  const top = items.filter((p) => p.score !== null).sort((a, b) => b.score - a.score || Date.parse(b.at) - Date.parse(a.at)).slice(0, 5);
  return { items, top, scanned: unique.length, unranked: items.filter((p) => p.score === null).length };
}
async function xPosts(token, id) {
  const posts = [];
  let next;
  for (let page = 0; page < 1; page++) {
    const q = new URLSearchParams({ max_results: '50', 'tweet.fields': 'created_at,public_metrics,conversation_id,referenced_tweets,note_tweet',
      expansions: 'author_id', 'user.fields': 'name,username', ...(next ? { pagination_token: next } : {}) });
    const data = await get(`https://api.x.com/2/users/${encodeURIComponent(id)}/timelines/reverse_chronological?${q}`, token);
    posts.push(...normalizeX(data));
    next = data.meta?.next_token;
    if (!next) break;
  }
  return { posts, truncated: !!next };
}
const fields = 'id,text,username,timestamp,permalink,has_replies';
async function threadsPosts(token, profiles) {
  const results = await Promise.allSettled(profiles.map(async (username) => {
    const data = await get(`${THREADS}/profile_posts?${new URLSearchParams({ username, fields, limit: '50' })}`, token);
    return { posts: normalizeThreads(data), truncated: !!data.paging?.next };
  }));
  return { posts: results.flatMap((r) => r.status === 'fulfilled' ? r.value.posts : []),
    truncated: results.some((r) => r.status === 'fulfilled' && r.value.truncated),
    warnings: results.flatMap((r, i) => r.status === 'rejected' ? [`@${profiles[i]}: ${r.reason.message}`] : []) };
}
export async function snsFeed(env, uid, only = null) {
  const settings = await snsSettings(env, uid);
  const names = Object.hasOwn(providers, only ?? '') ? [only] : Object.keys(providers);
  const results = await Promise.all(names.map(async (name) => {
    const status = { platform: name, configured: ready(env, name), connected: false, account: null, warnings: [] };
    try {
      const row = await conn(env, uid, name);
      status.connected = !!row;
      if (row) status.account = JSON.parse(row.account).username;
      if (!status.configured || !row) return { status, posts: [] };
      const token = await tokenFor(env, uid, name, row);
      const result = name === 'x' ? await xPosts(token, JSON.parse(row.account).id) : await threadsPosts(token, settings.profiles);
      status.warnings = result.warnings || [];
      status.truncated = result.truncated;
      status.fetchedAt = new Date().toISOString();
      return { status, posts: result.posts };
    } catch (e) {
      status.error = e.name === 'TimeoutError' ? '응답이 지연되고 있습니다. 다시 시도해주세요.' : e.message;
      return { status, posts: [] };
    }
  }));
  return { ...buildFeed(results.flatMap((r) => r.posts)), settings, sources: results.map((r) => r.status), fetchedAt: new Date().toISOString() };
}
export async function snsConversation(env, uid, id) {
  const row = await conn(env, uid, 'threads');
  if (!row) throw new Error('Threads 계정을 먼저 연결해주세요.');
  const token = await tokenFor(env, uid, 'threads', row);
  // Meta may deny conversations belonging to other users. Do not pretend a failed lookup is a complete thread.
  const q = new URLSearchParams({ fields: `${fields},root_post,replied_to,is_reply`, reverse: 'false', limit: '100' });
  const data = await get(`${THREADS}/${encodeURIComponent(id)}/conversation?${q}`, token);
  return { items: normalizeThreads(data).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)), partial: !!data.paging?.next };
}
