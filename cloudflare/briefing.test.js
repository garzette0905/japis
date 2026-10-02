import test from 'node:test';
import assert from 'node:assert/strict';
import { museBriefing } from './wiki.js';
import worker from './index.js';

const now = Date.parse('2026-10-03T00:00:00Z');
function db(row) {
  const calls = [];
  return { calls, prepare(sql) { return { bind(...args) { calls.push({ sql, args }); return this; }, async first() { return row; } }; } };
}

test('Muse 요약은 내 메모 중 최근 3일 안의 Muse 폴더/데일리 브리핑 메모만 찾는다', async () => {
  const DB = db(null);
  assert.deepEqual(await museBriefing({ DB }, 7, now), { briefing: null });
  const { sql, args } = DB.calls[0];
  assert.deepEqual(args, [7, '2026-09-30T00:00:00.000Z']);
  assert.match(sql, /n\.user_id = \?/); assert.match(sql, /deleted_at IS NULL/);
  assert.match(sql, /f\.user_id = n\.user_id/, '남의 폴더 이름으로 걸리지 않는다');
  assert.match(sql, /LIKE '%muse%'/); assert.match(sql, /데일리 브리핑%/);
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
    { SESSION_SECRET: 'test-secret-not-for-production', SESSIONS: kv, DB: db(null) }, {});
  assert.equal(res.status, 401);
});
