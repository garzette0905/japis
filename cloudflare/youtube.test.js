import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { trackFromVideo, videoIdOf, importYoutubeLikes } from './youtube.js';
import { seal } from './connect.js';

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const table = (name) => schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\([\\s\\S]*?\\n\\);`))[0];

function fixture() {
  const db = new DatabaseSync(':memory:');
  for (const t of ['connections', 'music_artists', 'music_tracks']) db.exec(table(t));
  const stmt = (sql) => {
    let args = [];
    return {
      bind(...v) { args = v; return this; },
      sql: () => sql, args: () => args,
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async first() { return db.prepare(sql).get(...args) || null; },
      async run() { return { meta: db.prepare(sql).run(...args) }; },
    };
  };
  const env = {
    SESSION_SECRET: 'test', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret',
    DB: {
      prepare: stmt,
      async batch(list) { return list.map((s) => ({ results: db.prepare(s.sql()).all(...s.args()) })); },
    },
  };
  return { db, env };
}

const video = (id, title, channelTitle, categoryId = '10') => ({ id, snippet: { title, channelTitle, categoryId } });

test('좋아요 동영상에서 가수와 곡 이름을 나누고 음악이 아닌 것은 버린다', () => {
  assert.deepEqual(
    trackFromVideo(video('a1', 'Blueming', 'IU - Topic', '10')),
    { videoId: 'a1', artist: 'IU', title: 'Blueming', url: 'https://www.youtube.com/watch?v=a1' }
  );
  const mv = trackFromVideo(video('a2', "[MV] IU(아이유) - 'Celebrity' (Official MV)", '1theK (원더케이)'));
  assert.equal(mv.artist, 'IU(아이유)');
  assert.equal(mv.title, 'Celebrity');
  const plain = trackFromVideo(video('a3', 'Anti-Hero (Official Music Video)', 'TaylorSwiftVEVO'));
  assert.equal(plain.artist, 'TaylorSwift');
  assert.equal(plain.title, 'Anti-Hero');
  assert.equal(trackFromVideo(video('a4', 'Song (feat. X) [Lyrics]', 'Some - Topic', '22')).title, 'Song (feat. X)');
  assert.equal(trackFromVideo(video('a5', '요리 브이로그', '채널', '22')), null);
});

test('유튜브 주소 여러 꼴에서 같은 동영상 번호를 읽는다', () => {
  assert.equal(videoIdOf('https://youtu.be/abc?t=3'), 'abc');
  assert.equal(videoIdOf('https://music.youtube.com/watch?v=abc&list=LM'), 'abc');
  assert.equal(videoIdOf('https://m.youtube.com/shorts/abc'), 'abc');
  assert.equal(videoIdOf('https://www.melon.com/song?v=abc'), null);
});

test('가져오기는 페이지를 끝까지 읽고, 이미 담긴 곡은 건너뛰며 같은 가수 아래 모은다', async () => {
  const { db, env } = fixture();
  const original = globalThis.fetch;
  try {
    db.prepare(
      "INSERT INTO connections (user_id, provider, refresh_token, access_token, expires_at, updated_at) VALUES (1, 'google', 'r', ?, ?, 'now')"
    ).run(await seal(env, 'tok'), Date.now() + 3600e3);
    db.exec("INSERT INTO music_artists (user_id, name, created_at) VALUES (1, 'iu', 'x')");
    db.exec("INSERT INTO music_tracks (user_id, artist_id, title, url, sort_order, created_at, updated_at) VALUES (1, 1, 'Old', 'https://youtu.be/old', 1, 'x', 'x')");

    const pages = {
      '': { items: [video('old', 'Old', 'IU - Topic'), video('n1', 'Blueming', 'IU - Topic')], nextPageToken: 'p2' },
      p2: { items: [video('n2', 'Hype Boy', 'NewJeans - Topic'), video('n3', 'Cat video', 'Pets', '15'), video('n1', 'Blueming', 'IU - Topic')] },
    };
    const seen = [];
    globalThis.fetch = async (url, init) => {
      const u = new URL(url);
      seen.push(init.headers.Authorization);
      assert.equal(u.searchParams.get('myRating'), 'like');
      return new Response(JSON.stringify(pages[u.searchParams.get('pageToken') || '']));
    };

    let r = await (await importYoutubeLikes(env, 1)).json();
    assert.deepEqual(
      { scanned: r.scanned, music: r.music, added: r.added, skipped: r.skipped, artistsAdded: r.artistsAdded },
      { scanned: 5, music: 4, added: 2, skipped: 2, artistsAdded: 1 }
    );
    assert.deepEqual(seen, ['Bearer tok', 'Bearer tok']);
    const rows = db.prepare(
      'SELECT a.name, t.title, t.sort_order FROM music_tracks t JOIN music_artists a ON a.id = t.artist_id ORDER BY t.id'
    ).all().map((x) => ({ ...x }));
    assert.deepEqual(rows, [
      { name: 'iu', title: 'Old', sort_order: 1 },
      { name: 'iu', title: 'Blueming', sort_order: 2 },
      { name: 'NewJeans', title: 'Hype Boy', sort_order: 1 },
    ]);

    r = await (await importYoutubeLikes(env, 1)).json();
    assert.equal(r.added, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM music_tracks').get().n, 3);
  } finally {
    globalThis.fetch = original;
    db.close();
  }
});

test('연결이 없거나 YouTube API 가 꺼져 있으면 무엇을 할지 알려 준다', async () => {
  const { db, env } = fixture();
  const original = globalThis.fetch;
  try {
    let res = await importYoutubeLikes(env, 1);
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, 'disconnected');

    db.prepare(
      "INSERT INTO connections (user_id, provider, refresh_token, access_token, expires_at, updated_at) VALUES (1, 'google', 'r', ?, ?, 'now')"
    ).run(await seal(env, 'tok'), Date.now() + 3600e3);
    globalThis.fetch = async () =>
      new Response('{"error":{"errors":[{"reason":"accessNotConfigured"}]}}', { status: 403 });
    assert.equal((await (await importYoutubeLikes(env, 1)).json()).code, 'api_disabled');

    globalThis.fetch = async () =>
      new Response('{"error":{"message":"Request had insufficient authentication scopes."}}', { status: 403 });
    assert.equal((await (await importYoutubeLikes(env, 1)).json()).code, 'reconnect');
  } finally {
    globalThis.fetch = original;
    db.close();
  }
});

test('곡 출처는 주소로 가른다 — 유튜브 · FLO · 직접 입력', async () => {
  const { sourceOf } = await import('../web/public/playlists.js');
  assert.equal(sourceOf({ url: 'https://www.youtube.com/watch?v=a' }), 'youtube');
  assert.equal(sourceOf({ url: 'https://youtu.be/a' }), 'youtube');
  assert.equal(sourceOf({ url: 'https://music.youtube.com/watch?v=a' }), 'youtube');
  assert.equal(sourceOf({ url: 'https://www.music-flo.com/detail/track/1' }), 'flo');
  assert.equal(sourceOf({ url: '', memo: 'FLO 스트리밍 횟수: 3회' }), 'flo');
  assert.equal(sourceOf({ url: '', memo: '' }), 'manual');
  assert.equal(sourceOf({ url: 'https://www.melon.com/song/1' }), 'manual');
  assert.equal(sourceOf({ url: 'https://notyoutube.com.evil/x' }), 'manual');
});
