import test from 'node:test';
import assert from 'node:assert/strict';

import { datasetOf, parseSamsungHealth, offsetMin, localDay, utcMs } from '../web/public/shealth-parse.js';
import { SAMSUNG_METRICS } from './samsung.js';

// 삼성헬스 CSV 모양 그대로 — 1행 이름표, 2행 머리글, 줄 끝 쉼표.
const csv = (name, header, rows) =>
  `﻿${name},7006011,1\n${header}\n${rows.map((r) => r + ',').join('\n')}\n`;
const valueOf = (rows, day, code) => rows.find((r) => r[0] === day && r[1] === code)?.[2];

test('파일 이름에서 표와 내보낸 시각을 읽는다 — raw 표와 모르는 표는 받지 않는다', () => {
  assert.deepEqual(datasetOf('com.samsung.shealth.sleep.20260920144050.csv'), {
    dataset: 'com.samsung.shealth.sleep',
    stamp: '20260920144050',
  });
  assert.equal(datasetOf('com.samsung.health.advanced_glycation_endproduct.raw.20260920144050.csv'), null);
  assert.equal(datasetOf('com.samsung.shealth.badge.20260920144050.csv'), null);
});

test('날짜는 시차를 더한 뒤 자른다 — 한국 아침 7시의 기록이 전날로 넘어가지 않는다', () => {
  assert.equal(offsetMin('UTC+0900'), 540);
  assert.equal(offsetMin('UTC-0500'), -300);
  assert.equal(offsetMin(''), 540);
  const t = utcMs('2026-09-24 22:10:00.000'); // = 9월 25일 07:10 (KST)
  assert.equal(localDay(t, 540), '2026-09-25');
  assert.equal(utcMs('1970-01-01 00:00:00.000'), null);
});

test('걸음은 모든 기기를 합친 줄(source_type -2)만 센다', () => {
  const rows = parseSamsungHealth({
    'com.samsung.shealth.step_daily_trend': csv(
      'com.samsung.shealth.step_daily_trend',
      'source_type,count,distance,day_time',
      ['-2,8000,6000,2026-09-20 00:00:00.000', '0,5000,4000,2026-09-20 00:00:00.000', '23,3000,2000,2026-09-20 00:00:00.000']
    ),
  });
  assert.equal(valueOf(rows, '2026-09-20', 'steps'), 8000);
  assert.equal(valueOf(rows, '2026-09-20', 'distance'), 6);
});

test('수면은 깬 날에 붙이고, 겹친 기록은 한 번만 센다', () => {
  // 23:00~05:00(KST) 밤잠, 같은 밤을 폰이 01:00~04:00 으로 한 번 더 적었다, 06:00~07:00 다시 잠.
  const rows = parseSamsungHealth({
    'com.samsung.shealth.sleep': csv(
      'com.samsung.shealth.sleep',
      'sleep_score,efficiency,com.samsung.health.sleep.start_time,com.samsung.health.sleep.time_offset,com.samsung.health.sleep.end_time',
      [
        '72,95,2026-09-18 14:00:00.000,UTC+0900,2026-09-18 20:00:00.000',
        ',,2026-09-18 16:00:00.000,UTC+0900,2026-09-18 19:00:00.000',
        '30,90,2026-09-18 21:00:00.000,UTC+0900,2026-09-18 22:00:00.000',
      ]
    ),
  });
  assert.equal(valueOf(rows, '2026-09-19', 'sleep_h'), 7);        // 6시간 + 1시간, 겹친 3시간은 빼고
  assert.equal(valueOf(rows, '2026-09-19', 'sleep_score'), 72);   // 가장 긴 잠의 점수
  assert.equal(valueOf(rows, '2026-09-18', 'sleep_h'), undefined);
});

test('체중은 그날 마지막 값, 내일보다 뒤의 날짜는 버린다', () => {
  const rows = parseSamsungHealth({
    'com.samsung.health.weight': csv(
      'com.samsung.health.weight',
      'start_time,weight,time_offset,body_fat,skeletal_muscle_mass',
      [
        '2026-09-16 23:00:00.000,66.0,UTC+0900,,',
        '2026-09-17 12:00:00.000,65.4,UTC+0900,21.0,',
        '2226-10-09 01:00:00.000,64.0,UTC+0900,,',
      ]
    ),
  });
  assert.equal(valueOf(rows, '2026-09-17', 'weight'), 65.4);
  assert.equal(valueOf(rows, '2026-09-17', 'body_fat'), 21);
  assert.equal(rows.some((r) => r[0] > '2100'), false);
});

test('parser 가 만드는 항목은 전부 서버 이름표에 있다', () => {
  // 서버는 이름표에 없는 code 를 조용히 버린다 — 여기서 어긋나면 값이 소리 없이 사라진다.
  const known = new Set(SAMSUNG_METRICS.map((m) => m.code));
  const src = parseSamsungHealth.toString();
  const produced = [...src.matchAll(/d\.out\('(\w+)',\s*'\w+',\s*\d+,\s*out(?:,\s*'(\w+)')?\)/g)].map((m) => m[2] || m[1]);
  assert.ok(produced.length > 15);
  for (const code of produced) assert.ok(known.has(code), code);
});
