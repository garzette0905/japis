import test from 'node:test';
import assert from 'node:assert/strict';

import { flagOf, deltaOf, isConcerning, CATEGORIES, KINDS } from './health.js';

// ── 판정 ────────────────────────────────────────────────────────────────
// 이 셈이 틀리면 화면의 '지켜볼 항목'이 통째로 거짓말이 된다. 경계값을 못 박아 둔다.

test('참고범위 위아래를 벗어난 값만 높음·낮음으로 읽는다', () => {
  assert.equal(flagOf(148, null, 129), 'H');   // LDL 148 (0~129)
  assert.equal(flagOf(50, 60, null), 'L');     // HDL 50 (60~)
  assert.equal(flagOf(101, 70, 99), 'H');      // 공복혈당 101 (70~99)
  assert.equal(flagOf(88, 70, 99), 'N');
});

test('경계값은 정상이다 — 참고범위는 그 값을 포함한다', () => {
  assert.equal(flagOf(99, 70, 99), 'N');
  assert.equal(flagOf(70, 70, 99), 'N');
  assert.equal(flagOf(6.7, 6.7, 8.1), 'N');    // 총단백 6.7 (6.7~8.1)
});

test('모르는 것은 정상이라고 적지 않는다', () => {
  // 글자 결과('정상'·'음성')와 참고범위가 없는 항목은 판정하지 않는다.
  // 여기서 'N' 을 돌려주면 화면의 '정상' 개수가 부풀려진다.
  assert.equal(flagOf(null, 0, 10), '');
  assert.equal(flagOf(27.0, null, null), '');
  assert.equal(flagOf(Number.NaN, 0, 10), '');
});

// ── 걱정할 쪽인가 ───────────────────────────────────────────────────────

test('좋은 쪽으로 벗어난 것은 지켜볼 항목에 올리지 않는다', () => {
  // 2025년 검진의 HDL 61 (그 검사실 기준 40~60). 결과지에 ▲ 가 찍혔고 화면도
  // '높음'이라 적는다 — 다만 HDL 은 높아서 좋은 것이라 지켜볼 목록에는 없다.
  assert.equal(isConcerning('H', 'high'), false);
  assert.equal(isConcerning('L', 'high'), true);    // 사구체여과율이 낮은 것은 걱정

  assert.equal(isConcerning('H', 'low'), true);     // LDL 이 높은 것은 걱정
  assert.equal(isConcerning('L', 'low'), false);    // 콜레스테롤이 낮은 것은 아니다
});

test('좋고 나쁨이 없는 항목은 양쪽 다 올린다', () => {
  assert.equal(isConcerning('H', 'mid'), true);
  assert.equal(isConcerning('L', 'mid'), true);
  assert.equal(isConcerning('N', 'mid'), false);
  assert.equal(isConcerning('', 'low'), false);     // 판정하지 못한 것은 걱정하지 않는다
});

// ── 증감 ────────────────────────────────────────────────────────────────

test('수치의 방향과 몸에 좋은 방향을 따로 돌려준다', () => {
  // 총콜레스테롤 216 → 203. 수치는 내려갔고(↓) 그것이 좋은 쪽이다.
  const chol = deltaOf(203, 216, 'low');
  assert.equal(chol.dir, 'down');
  assert.equal(chol.good, true);
  assert.equal(chol.diff, -13);

  // HDL 58 → 50. 역시 내려갔지만(↓) 이쪽은 나쁜 쪽이다.
  const hdl = deltaOf(50, 58, 'high');
  assert.equal(hdl.dir, 'down');
  assert.equal(hdl.good, false);
});

test('범위 안이 좋은 항목은 좋고 나쁨을 판단하지 않는다', () => {
  const sodium = deltaOf(139, 138, 'mid');
  assert.equal(sodium.dir, 'up');
  assert.equal(sodium.good, null);
});

test('변화가 없거나 비교할 값이 없으면 화살표를 세우지 않는다', () => {
  assert.equal(deltaOf(5.8, 5.8, 'low').dir, 'flat');
  assert.equal(deltaOf(101, null, 'mid'), null);
});

test('부동소수점 뺄셈이 화면에 흘러나오지 않는다', () => {
  // 0.1 - 0.3 은 그냥 빼면 -0.19999999999999998 이 된다.
  assert.equal(deltaOf(0.1, 0.3, 'low').diff, -0.2);
});

// ── 분류표 ──────────────────────────────────────────────────────────────

test('분류 키는 서로 겹치지 않고 종류는 셋이다', () => {
  const keys = CATEGORIES.map((c) => c.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(KINDS.map((k) => k.key), ['checkup', 'inbody', 'blood']);
});
