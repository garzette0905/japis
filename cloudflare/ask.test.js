import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeAiParse, parseAskWithAI } from './ask.js';

const NOW = { y: 2026, m: 9, d: 19, hh: 10, mi: 30, dow: 6 };

test('AI가 해석한 일정 생성값을 안전한 내부 형식으로 바꾼다', () => {
  const parsed = normalizeAiParse(
    {
      intent: 'create',
      kind: 'event',
      date: '2026-09-21',
      time: '15:30',
      range_from: null,
      range_to: null,
      range_label: null,
      title: '치과 검진',
    },
    '월요일 오후 3시 반에 치과 검진 잡아줘'
  );

  assert.deepEqual(parsed.date, { y: 2026, m: 9, d: 21 });
  assert.deepEqual(parsed.time, { hh: 15, mi: 30 });
  assert.equal(parsed.kind, 'event');
  assert.equal(parsed.title, '치과 검진');
  assert.equal(parsed.parsedBy, 'ai');
});

test('AI 응답을 이용해 규칙에 없는 표현도 할 일로 읽는다', async () => {
  const env = {
    AI: {
      run: async () => ({
        response: JSON.stringify({
          intent: 'create',
          kind: 'task',
          date: '2026-09-22',
          time: null,
          range_from: null,
          range_to: null,
          range_label: null,
          title: '자동차 보험 갱신',
        }),
      }),
    },
  };

  const parsed = await parseAskWithAI('화요일까지 자동차 보험 갱신 챙겨줘', env, NOW);
  assert.equal(parsed.intent, 'create');
  assert.equal(parsed.kind, 'task');
  assert.deepEqual(parsed.date, { y: 2026, m: 9, d: 22 });
  assert.equal(parsed.parsedBy, 'ai');
});

test('잘못된 AI 응답은 규칙 파서로 자동 복귀한다', async () => {
  const env = { AI: { run: async () => ({ response: 'not json' }) } };
  const parsed = await parseAskWithAI('내일 오후 3시 치과', env, NOW);

  assert.equal(parsed.intent, 'create');
  assert.equal(parsed.kind, 'event');
  assert.deepEqual(parsed.date, { y: 2026, m: 9, d: 20 });
  assert.deepEqual(parsed.time, { hh: 15, mi: 0 });
  assert.equal(parsed.parsedBy, 'rule');
});

test('유효하지 않은 날짜와 생성 종류는 거부한다', () => {
  assert.equal(
    normalizeAiParse({ intent: 'create', kind: 'mail', date: null, time: null, title: '메일 보내기' }, '메일 보내기'),
    null
  );
  assert.equal(
    normalizeAiParse({ intent: 'create', kind: 'task', date: '2026-02-30', time: null, title: '신청' }, '신청'),
    null
  );
});
