import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { listMusic, playTrack, updateTrack } from './music.js';
import { musicTimestamp, listeningLink } from '../web/public/playlists.js';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec("INSERT INTO music_artists(id,user_id,name,created_at) VALUES(1,1,'Singer','2026-01-01'),(2,2,'Other','2026-01-01')");
  const insert = db.prepare(`INSERT INTO music_tracks(id,user_id,artist_id,title,play_count,starred,created_at,updated_at,last_played_at) VALUES(?,?,?,?,?,?,?,?,?)`);
  insert.run(1, 1, 1, 'Before midnight', 9, 0, '2026-11-13T15:00:00.000Z', '2026-11-14T14:59:59.999Z', '2026-11-14T01:00:00.000Z');
  insert.run(2, 1, 1, 'Start of day', 1, 0, '2026-11-14T15:00:00.000Z', '2026-11-14T15:00:00.000Z', '2026-11-14T10:00:00.000Z');
  insert.run(3, 1, 1, 'End of day', 4, 0, '2026-11-14T16:00:00.000Z', '2026-11-15T14:59:59.999Z', null);
  insert.run(4, 1, 1, 'Next day', 4, 0, '2026-11-15T15:00:00.000Z', '2026-11-15T15:00:00.000Z', null);
  insert.run(5, 1, 1, 'Pinned', 0, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', null);
  insert.run(6, 2, 2, 'Private', 100, 0, '2026-11-15T00:00:00.000Z', '2026-11-15T00:00:00.000Z', null);
  const env = { DB: { prepare(sql) { return {
    args: [], bind(...args) { this.args = args; return this; },
    async first() { return db.prepare(sql).get(...this.args) || null; },
    async all() { return { results: db.prepare(sql).all(...this.args) }; },
  }; } } };
  const list = async query => (await listMusic(env, 1, new URL('https://japis.test/api/music?' + query))).json();
  return { db, env, list };
}

test('music sorting supports views, latest viewed, registration in both directions and update time, keeping pinned tracks first', async () => {
  const { db, list } = fixture();
  try {
    for (const [sort, expected] of [
      ['views', [5, 1, 4, 3, 2]], ['viewed', [5, 2, 1, 4, 3]],
      ['newest', [5, 4, 3, 2, 1]], ['oldest', [5, 1, 2, 3, 4]], ['updated', [5, 4, 3, 2, 1]],
      ['invalid SQL', [5, 1, 4, 3, 2]],
    ]) {
      const result = await list('sort=' + encodeURIComponent(sort));
      assert.deepEqual(result.tracks.map(t => t.id), expected, sort);
      assert.equal(result.total, 5);
    }
  } finally { db.close(); }
});

test('date search includes the entire Korean day, combines with text and artist filters, and separates creation from modification', async () => {
  const { db, list } = fixture();
  try {
    assert.deepEqual((await list('from=2026-11-15&to=2026-11-15')).tracks.map(t => t.id), [3, 2]);
    assert.deepEqual((await list('dateField=created&from=2026-11-15&to=2026-11-15&sort=oldest')).tracks.map(t => t.id), [2, 3]);
    assert.deepEqual((await list('from=2026-11-15&to=2026-11-15&q=Start')).tracks.map(t => t.id), [2]);
    assert.deepEqual((await list('from=2026-11-15&artist=2')).tracks, []);
    assert.deepEqual((await list('to=2026-11-14')).tracks.map(t => t.id), [5, 1]);
    assert.deepEqual((await list('from=2026-11-17')).tracks, []);
    for (const query of ['from=2026-02-30', 'to=wrong', 'from=2026-11-16&to=2026-11-15']) {
      const response = await listMusic({}, 1, new URL('https://japis.test/api/music?' + query));
      assert.equal(response.status, 400);
    }
  } finally { db.close(); }
});

test('viewing records a view without changing modification time; editing updates time and never accesses another account', async () => {
  const { db, env } = fixture();
  const request = body => new Request('https://japis.test/api/music/tracks/2', { method: 'PATCH', body: JSON.stringify(body) });
  try {
    const before = db.prepare('SELECT * FROM music_tracks WHERE id=2').get();
    const played = await (await playTrack(env, 1, 2)).json();
    assert.equal(played.track.playCount, 2);
    assert.equal(played.track.updatedAt, before.updated_at);
    const edited = await (await updateTrack(request({ memo: 'Changed' }), env, 1, 2)).json();
    assert.equal(edited.track.createdAt, before.created_at);
    assert.notEqual(edited.track.updatedAt, before.updated_at);
    assert.equal((await updateTrack(request({ title: 'Wrong' }), env, 2, 2)).status, 404);
    assert.equal((await playTrack(env, 2, 2)).status, 404);
  } finally { db.close(); }
});

test('timestamps display Korean local dates and minutes, including midnight, with a safe missing-value label', () => {
  assert.equal(musicTimestamp('2026-11-14T15:01:00.000Z'), '2026-11-15 00:01');
  assert.equal(musicTimestamp('2026-11-15T14:59:00.000Z'), '2026-11-15 23:59');
  assert.equal(musicTimestamp(null), '기록 없음');
  assert.equal(musicTimestamp('invalid'), '기록 없음');
});

test('FLO listening opens an exact track URL, or an encoded artist/title search when the captured track has no URL', () => {
  const exact = 'https://www.music-flo.com/detail/track/512384615/details';
  assert.deepEqual(listeningLink({ url: exact }), { url: exact, search: false });
  const link = listeningLink({ artistName: 'Ryan Gosling & Emma Stone', title: 'City Of Stars', memo: 'FLO 재생목록 캡처에서 등록' });
  assert.equal(link.search, true);
  assert.equal(new URL(link.url).searchParams.get('keyword'), 'Ryan Gosling & Emma Stone City Of Stars');
  assert.equal(listeningLink({ title: 'Manual song', memo: '' }), null);
  assert.equal(listeningLink({ title: '', memo: 'FLO' }), null);
});
