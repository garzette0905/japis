import test from 'node:test';
import assert from 'node:assert/strict';
import { museBriefing } from './wiki.js';
import worker from './index.js';

const now = Date.parse('2026-10-03T00:00:00Z');
function db(...rows) {
  const calls = [];
  return { calls, prepare(sql) { return { bind(...args) { calls.push({ sql, args }); return this; }, async first() { return rows.shift() ?? null; } }; } };
}

test('Muse 요약은 Muse 폴더의 가장 최근 메모를 날짜 제한 없이 고른다', async () => {
  const DB = db({ id: 9, title: '오래된 브리핑', html: '<p>a</p>', updated_at: '2026-01-01T00:00:00Z' });
  const { briefing } = await museBriefing({ DB }, 7, now);
  assert.equal(briefing.id, 9);
  assert.equal(DB.calls.length, 1, '폴더에서 찾으면 제목 검색은 하지 않는다');
  const { sql, args } = DB.calls[0];
  assert.deepEqual(args, [7]);
  assert.match(sql, /n\.user_id = \?/); assert.match(sql, /deleted_at IS NULL/);
  assert.match(sql, /f\.user_id = n\.user_id/, '남의 폴더 이름으로 걸리지 않는다');
  assert.match(sql, /LIKE '%muse%'/); assert.match(sql, /ORDER BY n\.updated_at DESC/);
});

test('Muse 폴더에 메모가 없으면 최근 3일의 데일리 브리핑 제목 메모로 대신한다', async () => {
  const DB = db(null, null);
  assert.deepEqual(await museBriefing({ DB }, 7, now), { briefing: null });
  assert.match(DB.calls[1].sql, /데일리 브리핑%/);
  assert.deepEqual(DB.calls[1].args, [7, '2026-09-30T00:00:00.000Z']);
});

test('Muse 요약 본문은 한 번 더 씻어서 내보낸다', async () => {
  const DB = db({ id: 3, title: '데일리 브리핑 (10/3 토요일)', html: '<p>수면</p><script>alert(1)</script><img src=x onerror=alert(1)>', updated_at: '2026-10-02T22:00:00Z' });
  const { briefing } = await museBriefing({ DB }, 1, now);
  assert.equal(briefing.id, 3); assert.equal(briefing.title, '데일리 브리핑 (10/3 토요일)');
  assert.ok(briefing.html.includes('<p>수면</p>'));
  assert.ok(!/<script|onerror/i.test(briefing.html));
});

test('Muse 요약 API는 로그인 없이 열리지 않는다', async () => {
  const kv = { async get() { return null; }, async put() {} };
  const res = await worker.fetch(new Request('https://japis.example/api/wiki/briefing'),
    { SESSION_SECRET: 'test-secret-not-for-production', SESSIONS: kv, DB: db() }, {});
  assert.equal(res.status, 401);
});
