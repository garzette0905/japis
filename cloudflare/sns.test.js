import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFeed, normalizeX, normalizeThreads, parseProfiles, topicOf, snsStart, snsCallback, snsFeed, snsSettings, snsConversation } from './sns.js';
import { seal } from './connect.js';
import { postCard, safePostUrl } from '../web/public/sns.js';
import worker from './index.js';

const now = Date.parse('2026-10-02T12:00:00Z');
const post = (id, text = 'AI research', score = 1, at = now - 1000) => ({
  id, platform: 'x', author: 'Research', username: 'research', text, at: new Date(at).toISOString(),
  url: `https://x.com/i/status/${id}`, metrics: { likes: score, replies: 0, reposts: 0, quotes: 0 },
});
function mockEnv() {
  const values = new Map(), rows = new Map();
  return { values, rows, SESSION_SECRET: 'test-secret-not-for-production', BASE_URL: 'https://japis.example',
    X_CLIENT_ID: 'x-app', X_CLIENT_SECRET: 'x-secret', THREADS_CLIENT_ID: 'threads-app', THREADS_CLIENT_SECRET: 'threads-secret',
    SESSIONS: {
      async get(key, type) { const v = values.get(key); return type === 'json' ? JSON.parse(v || 'null') : v; },
      async put(key, value) { values.set(key, value); }, async delete(key) { values.delete(key); },
    },
    DB: { prepare(sql) { let args; return { bind(...v) { args = v; return this; },
      async first() { return rows.get(`${args[0]}:${args[1]}`) || null; },
      async run() {
        if (sql.startsWith('INSERT OR REPLACE')) rows.set(`${args[0]}:${args[1]}`, { refresh_token: args[2], access_token: args[3], expires_at: args[4], account: args[5] });
      },
    }; } },
  };
}
test('AI/IT 분류는 일반 일상 글과 부분 단어를 제외한다', () => {
  assert.equal(topicOf('OpenAI의 새 모델'), 'AI');
  assert.equal(topicOf('GPU 반도체 소식'), 'IT Trends');
  assert.equal(topicOf('email train daily birthday'), null);
});
test('최신순, 7일 제한, 중복 제거, 양 플랫폼 순위와 결측 수치를 처리한다', () => {
  const posts = Array.from({ length: 7 }, (_, i) => post(`${i}`, 'AI', i, now - i * 1000));
  const missing = { ...post('missing'), platform: 'threads', metrics: { likes: null, replies: null, reposts: null, quotes: null } };
  const data = buildFeed([...posts, posts[0], missing, post('old', 'AI', 999, now - 8 * 86400000), post('future', 'AI', 999, now + 1000), post('off', 'Lunch', 999)], now);
  assert.deepEqual(data.top.map((p) => p.id), ['6', '5', '4', '3', '2']);
  assert.equal(data.items.length, 8);
  assert.equal(data.items[0].id, '0');
  assert.equal(data.unranked, 1);
  assert.equal(buildFeed([post('zero', 'AI', 0)], now).top[0].score, 0);
});
test('플랫폼별 원본과 장문, 답글 관계를 보존한다', () => {
  const [x] = normalizeX({ data: [{ id: '1', author_id: 'u', text: 'short', note_tweet: { text: 'long AI' }, conversation_id: 'root', referenced_tweets: [{ type: 'replied_to', id: 'parent' }] }], includes: { users: [{ id: 'u', name: 'Author', username: 'author' }] } });
  assert.equal(x.text, 'long AI'); assert.equal(x.parent, 'parent'); assert.equal(x.metrics.likes, null);
  const [t] = normalizeThreads({ data: [{ id: '2', root_post: { id: '1' }, replied_to: { id: '1' } }] });
  assert.equal(t.root, '1'); assert.equal(t.parent, '1'); assert.equal(t.metrics.likes, null);
});
test('Threads 프로필 입력 검증 및 중복 제거', () => {
  assert.deepEqual(parseProfiles('@choi.openai, https://www.threads.com/@Choi.openai\n@other'), ['choi.openai', 'other']);
  assert.deepEqual(parseProfiles(''), []);
  assert.throws(() => parseProfiles('https://evil.example/@choi.openai'));
  assert.throws(() => parseProfiles('https://threads.com/@choi.openai/post/123'));
  assert.throws(() => parseProfiles(Array.from({ length: 21 }, (_, i) => `user${i}`).join(',')));
});
test('프로필 설정은 사용자별로 격리하며 빈 목록도 유지한다', async () => {
  const env = mockEnv();
  await snsSettings(env, 1, '@first'); await snsSettings(env, 2, '');
  assert.deepEqual(await snsSettings(env, 1), { profiles: ['first'] });
  assert.deepEqual(await snsSettings(env, 2), { profiles: [] });
});
test('OAuth state는 사용자·제공자에 바인딩되고 X는 PKCE를 사용한다', async () => {
  const env = mockEnv();
  const url = new URL(await snsStart(env, 1, 'x'));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('code_challenge'));
  const back = new URL(`https://japis.example/api/sns/x/callback?state=${url.searchParams.get('state')}&code=test`);
  await assert.rejects(snsCallback(env, 2, 'x', back), /만료/);
  await assert.rejects(snsCallback(env, 1, 'threads', back), /만료/);
});
test('X OAuth 교환, 현재 계정 조회, 암호화 저장, state 재사용 거절', async (t) => {
  const env = mockEnv();
  const start = new URL(await snsStart(env, 1, 'x'));
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return Response.json(String(url).endsWith('/token') ? { access_token: 'private-access', refresh_token: 'private-refresh', expires_in: 7200 } : { data: { id: 'me', username: 'signed_in_user' } });
  });
  const back = new URL(`https://japis.example/callback?state=${start.searchParams.get('state')}&code=test`);
  await snsCallback(env, 1, 'x', back);
  assert.ok(calls[0].options.body.get('code_verifier'));
  assert.match(calls[0].options.headers.Authorization, /^Basic /);
  const row = env.rows.get('1:sns_x');
  assert.ok(!JSON.stringify(row).includes('private-access'));
  assert.equal(JSON.parse(row.account).username, 'signed_in_user');
  await assert.rejects(snsCallback(env, 1, 'x', back), /만료/);
});
test('한 플랫폼이 실패해도 다른 플랫폼 피드를 유지하고 토큰은 응답에 없다', async (t) => {
  const env = mockEnv();
  for (const name of ['x', 'threads']) env.rows.set(`1:sns_${name}`, { access_token: await seal(env, 'private-token'), refresh_token: await seal(env, 'refresh'), expires_at: Date.now() + 30 * 86400000, account: JSON.stringify({ id: 'me', username: name }) });
  t.mock.method(globalThis, 'fetch', async (url) => String(url).includes('api.x.com')
    ? Response.json({ error: 'rate limit' }, { status: 429 })
    : Response.json({ data: [{ id: '1', text: 'AI models', username: 'choi.openai', timestamp: new Date().toISOString() }] }));
  const data = await snsFeed(env, 1);
  assert.equal(data.items.length, 1); assert.equal(data.items[0].platform, 'threads');
  assert.ok(data.sources[0].error.includes('한도')); assert.equal(data.top.length, 0);
  assert.ok(!JSON.stringify(data).includes('private-token'));
});
test('Threads 연속 글을 시간순으로 정렬하고 잘린 응답을 표시한다', async (t) => {
  const env = mockEnv();
  env.rows.set('1:sns_threads', { access_token: await seal(env, 'token'), expires_at: Date.now() + 30 * 86400000 });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ data: [{ id: '2', timestamp: '2026-10-02T02:00:00Z' }, { id: '1', timestamp: '2026-10-02T01:00:00Z' }], paging: { next: 'next' } }));
  const result = await snsConversation(env, 1, '123');
  assert.deepEqual(result.items.map((p) => p.id), ['1', '2']); assert.equal(result.partial, true);
});
test('SNS API는 로그인 없이 피드·설정·OAuth·연속 글을 공개하지 않는다', async () => {
  for (const [path, method] of [['feed', 'GET'], ['settings', 'PUT'], ['x/start', 'GET'], ['threads/conversation/123', 'GET']]) {
    const response = await worker.fetch(new Request(`https://japis.example/api/sns/${path}`, { method }), mockEnv(), {});
    assert.equal(response.status, 401);
  }
});
test('게시물 HTML을 이스케이프하고 외부/스크립트 링크를 거부한다', () => {
  assert.equal(safePostUrl('javascript:alert(1)'), '');
  assert.equal(safePostUrl('https://x.com.evil.example/1'), '');
  const html = postCard({ ...post('1'), text: '<img src=x onerror=alert(1)>', author: '<script>', url: 'javascript:alert(1)' });
  assert.ok(!html.includes('<img')); assert.ok(html.includes('&lt;img')); assert.ok(!html.includes('href="javascript:'));
});

test('로그인해도 SNS 화면 권한이 없거나 재인증 잠금이면 API를 거절한다', async () => {
  const env = mockEnv();
  const user = { id: 1, role: 'user', status: 'active', password_hash: 'test-password-hash', session_epoch: 0 };
  const sid = 'sns-session';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(sid))).toString('base64url').slice(0, 32);
  env.values.set(`sess:${sid}`, JSON.stringify({ uid: 1, pwv: user.password_hash.slice(-16), sev: 0 }));
  let perms = [];
  env.DB.prepare = () => ({ bind() { return this; }, async first() { return user; }, async all() { return { results: perms }; } });
  const request = () => new Request('https://japis.example/api/sns/feed', { headers: { Cookie: `jsid=${sid}.${signature}` } });
  const denied = await worker.fetch(request(), env, {});
  assert.equal(denied.status, 403); assert.equal((await denied.json()).code, 'forbidden');
  perms = [{ service_key: 'sns', allowed: 1, reauth: 1 }];
  const locked = await worker.fetch(request(), env, {});
  assert.equal(locked.status, 403); assert.equal((await locked.json()).code, 'locked');
});

test('Threads OAuth는 장기 토큰과 현재 계정을 저장한다', async (t) => {
  const env = mockEnv();
  const start = new URL(await snsStart(env, 1, 'threads'));
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('/oauth/access_token')) return Response.json({ access_token: 'short' });
    if (String(url).includes('/access_token?')) return Response.json({ access_token: 'long', expires_in: 60 * 86400 });
    return Response.json({ id: '123', username: 'current_threads_user' });
  });
  await snsCallback(env, 1, 'threads', new URL(`https://japis.example/callback?state=${start.searchParams.get('state')}&code=test`));
  const row = env.rows.get('1:sns_threads');
  assert.equal(JSON.parse(row.account).username, 'current_threads_user');
  assert.ok(row.expires_at > Date.now() + 59 * 86400000);
});

test('만료 직전 X 토큰을 갱신해 팔로우 타임라인을 읽는다', async (t) => {
  const env = mockEnv();
  env.rows.set('1:sns_x', { access_token: await seal(env, 'old-access'), refresh_token: await seal(env, 'old-refresh'), expires_at: Date.now(), account: JSON.stringify({ id: 'user-id', username: 'me' }) });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (String(url).endsWith('/token')) {
      assert.equal(options.body.get('refresh_token'), 'old-refresh');
      return Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 7200 });
    }
    assert.equal(options.headers.Authorization, 'Bearer new-access');
    return Response.json({ data: [{ id: '1', text: 'AI research', created_at: new Date().toISOString(), public_metrics: { like_count: 10, reply_count: 2, retweet_count: 1, quote_count: 0 } }] });
  });
  const feed = await snsFeed(env, 1);
  assert.equal(feed.top[0].score, 13);
  assert.ok(calls[1].url.includes('/users/user-id/timelines/reverse_chronological'));
});

test('Threads 400 필드 오류는 최소 필드로 재시도해 공개 글을 표시한다', async (t) => {
  const env = mockEnv();
  env.rows.set('1:sns_threads', { access_token: await seal(env, 'token'), expires_at: Date.now() + 30 * 86400000, account: JSON.stringify({ id: 'me', username: 'reader' }) });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const u = new URL(url); calls.push(u);
    if (u.searchParams.get('fields').includes('has_replies')) return Response.json({ error: { code: 100, message: 'unsupported field' } }, { status: 400 });
    return Response.json({ data: [{ id: 'public', text: 'AI news', username: 'choi.openai', timestamp: new Date().toISOString() }] });
  });
  const result = await snsFeed(env, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].searchParams.get('username'), 'choi.openai');
  assert.equal(result.items[0].id, 'public');
  assert.deepEqual(result.sources[1].warnings, []);
});

test('Threads 권한/토큰 오류는 재시도하지 않고 조치 방법을 안내한다', async (t) => {
  const env = mockEnv();
  env.rows.set('1:sns_threads', { access_token: await seal(env, 'token'), expires_at: Date.now() + 30 * 86400000, account: JSON.stringify({ id: 'me', username: 'reader' }) });
  let calls = 0, code = 10;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ error: { code, message: 'private diagnostic' } }, { status: 400 }); });
  let result = await snsFeed(env, 1);
  assert.match(result.sources[1].warnings[0], /threads_profile_discovery/);
  assert.equal(calls, 1);
  code = 190;
  result = await snsFeed(env, 1);
  assert.match(result.sources[1].warnings[0], /다시 연결/);
  assert.equal(calls, 2);
  assert.ok(!JSON.stringify(result).includes('private diagnostic'));
});

test('자신의 Threads 계정은 공개 프로필 검색 권한 없이 본인 글 API를 사용한다', async (t) => {
  const env = mockEnv();
  env.rows.set('1:sns_threads', { access_token: await seal(env, 'token'), expires_at: Date.now() + 30 * 86400000, account: JSON.stringify({ id: 'me', username: 'choi.openai' }) });
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(new URL(url).pathname, '/v1.0/me/threads');
    assert.equal(new URL(url).searchParams.has('username'), false);
    return Response.json({ data: [] });
  });
  assert.deepEqual((await snsFeed(env, 1)).sources[1].warnings, []);
});
