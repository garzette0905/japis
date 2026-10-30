import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { feedFor, connectStart } from './connect.js';

test('포토는 만료 토큰이나 과거 reconnect 캐시와 무관하게 정책 제한을 안내한다', async () => {
  // 어떤 환경 접근도 허용하지 않아 토큰 갱신·캐시·API 호출에 의존하지 않음을 확인한다.
  const env = new Proxy({}, { get() { throw new Error('포토는 연동 환경에 접근하면 안 된다'); } });
  for (const fresh of [false, true]) {
    const result = await feedFor(env, null, 1, 'gphotos', { fresh });
    assert.equal(result.state, 'unsupported');
    assert.deepEqual(result.items, []);
    assert.match(result.note, /Google 정책/);
  }
});

test('새 Google 동의 URL에서 폐지된 Photos 권한을 요청하지 않는다', async () => {
  const env = {
    BASE_URL: 'https://example.com', GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret',
    SESSIONS: { put: async () => {} },
  };
  const url = new URL(await connectStart(env, { id: 1 }, 'google'));
  const scopes = url.searchParams.get('scope');
  assert.doesNotMatch(scopes, /photoslibrary|photospicker/);
  for (const scope of ['gmail.readonly', 'calendar.readonly', 'calendar.events', 'tasks']) {
    assert.ok(scopes.split(' ').includes(`https://www.googleapis.com/auth/${scope}`));
  }
});

test('포토 정책 제한 UI에 재연결 버튼이 없고 카드 열기는 유지한다', async () => {
  const source = readFileSync(new URL('../web/public/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('function feedHtml(');
  const end = source.indexOf('\nfunction ', start + 1);
  const render = vm.runInNewContext(`${source.slice(start, end)}\nfeedHtml`, { esc: s => s });
  const html = render('gphotos', await feedFor({}, null, 1, 'gphotos'));
  assert.match(html, /자동 미리보기/);
  assert.doesNotMatch(html, /connect\/google|다시 연결/);
  const cardStart = source.indexOf('function liveCardHtml(');
  const cardEnd = source.indexOf('\nfunction ', cardStart + 1);
  const card = vm.runInNewContext(`${source.slice(cardStart, cardEnd)}\nliveCardHtml`, {
    esc: s => s, cardMark: () => '', cardTag: () => '', popBtn: () => '',
  })({ key: 'gphotos', ready: true });
  assert.match(card, /data-key="gphotos"[^>]*>\s*열기/);
  assert.doesNotMatch(card, /disabled/);
});
