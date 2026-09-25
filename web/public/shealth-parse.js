// 삼성헬스 '개인 데이터 다운로드' 폴더 → **하루 한 값**으로 접는다.
//
// 이 파일은 DOM 을 모른다. 브라우저(헬스정보 → 삼성헬스 탭의 '폴더에서 가져오기')와
// node(tools/samsung-health-import.mjs)가 **같은 셈**을 쓰게 하려고 따로 떼어 두었다.
// 둘이 다르게 세면, 어느 쪽으로 넣었느냐에 따라 같은 날의 걸음수가 달라진다.
//
// ── 삼성헬스 CSV 의 생김새 ─────────────────────────────────────────────
//   1행  com.samsung.shealth.tracker.heart_rate,7006011,3   ← 이름표(버린다)
//   2행  머리글. 표마다 'com.samsung.health.heart_rate.start_time' 처럼 앞에 이름이
//        붙기도 하고 안 붙기도 한다 → 끝 글자로 찾는다(col('start_time')).
//   3행~ 값. 줄 끝에 쉼표가 하나 더 붙어 있다.
//
// 시각은 **UTC** 로 적혀 있고, 그때 있던 곳의 시차가 time_offset('UTC+0900')에 따로
// 있다. 날짜는 반드시 시차를 더한 뒤에 자른다 — 그러지 않으면 아침 8시 전의 기록이
// 전부 전날로 넘어간다(한국은 UTC+9). day_time 이 있는 '하루 요약' 표는 이미 그 날의
// 날짜라 그대로 쓴다.
//
// ── 하루 한 값 ─────────────────────────────────────────────────────────
// 원본은 심박수만 11만 줄이다. 화면이 보고 싶은 것은 "그날 어땠나"이므로 여기서
// 하루 한 값으로 접어서 올린다. 원본을 서버에 올리지 않는다 — 무겁기도 하지만,
// 몇 시 몇 분의 맥박까지 서버에 둘 이유가 없다.

/** 화면이 그리는 항목. 서버(cloudflare/samsung.js)도 같은 목록으로 거른다. */
export const DATASETS = [
  'com.samsung.shealth.step_daily_trend',
  'com.samsung.shealth.tracker.pedometer_day_summary',
  'com.samsung.shealth.activity.day_summary',
  'com.samsung.shealth.tracker.floors_day_summary',
  'com.samsung.shealth.exercise',
  'com.samsung.shealth.sleep',
  'com.samsung.shealth.tracker.heart_rate',
  'com.samsung.shealth.vitality_score',
  'com.samsung.shealth.tracker.oxygen_saturation',
  'com.samsung.health.respiratory_rate',
  'com.samsung.health.skin_temperature',
  'com.samsung.shealth.stress',
  'com.samsung.health.weight',
  'com.samsung.health.water_intake',
];

/**
 * 파일 이름 → { dataset, stamp }. 내보낼 때마다 이름 끝의 시각(14자리)이 바뀐다.
 *   com.samsung.shealth.sleep.20260920144050.csv
 * '.raw.' 가 붙은 표(원시 측정값)는 받지 않는다 — 같은 값을 두 번 센다.
 */
export function datasetOf(fileName) {
  const m = /^(com\.samsung\.[\w.]+?)\.(\d{14})\.csv$/.exec(String(fileName || ''));
  if (!m || !DATASETS.includes(m[1])) return null;
  return { dataset: m[1], stamp: m[2] };
}

// ──────────────────────────────────────────────────────────────
// CSV
// ──────────────────────────────────────────────────────────────

/** 따옴표가 있는 줄만 제대로 가른다. 삼성헬스 CSV 는 거의 따옴표가 없어 빠른 길이 대부분이다. */
function splitLine(line) {
  if (line.indexOf('"') < 0) return line.split(',');
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 1; } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * 표 하나를 읽는다. 돌려주는 것은 { col(name), rows } — rows 는 문자열 배열의 배열.
 * col 은 머리글의 **끝 글자**로 찾는다('start_time' → 'com.samsung.health.sleep.start_time').
 */
export function readCsv(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const lines = src.split(/\r?\n/);
  const header = splitLine(lines[1] || '');
  const index = new Map();
  header.forEach((h, i) => {
    index.set(h, i);
    const tail = h.slice(h.lastIndexOf('.') + 1);
    if (!index.has(tail)) index.set(tail, i);
  });
  const rows = [];
  for (let i = 2; i < lines.length; i += 1) {
    if (lines[i]) rows.push(splitLine(lines[i]));
  }
  const col = (name) => (index.has(name) ? index.get(name) : -1);
  return { col, rows };
}

// ──────────────────────────────────────────────────────────────
// 시각
// ──────────────────────────────────────────────────────────────

const toNum = (s) => {
  if (s === undefined || s === null || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** 'UTC+0900' → 분. 비어 있으면 한국 시각으로 본다(이 데이터 대부분이 그렇다). */
export function offsetMin(s) {
  const m = /UTC([+-])(\d{2})(\d{2})/.exec(String(s || ''));
  if (!m) return 540;
  const v = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -v : v;
}

/** '2026-09-18 14:01:00.000'(UTC) → 밀리초. 1970년 같은 빈 값은 null. */
export function utcMs(s) {
  const t = Date.parse(String(s || '').replace(' ', 'T') + 'Z');
  return Number.isFinite(t) && t > 946684800000 ? t : null; // 2000-01-01 이전은 버린다
}

/** UTC 밀리초 + 시차 → 그곳의 'YYYY-MM-DD'. */
export const localDay = (ms, offMin) => new Date(ms + offMin * 60000).toISOString().slice(0, 10);

const dayOf = (s) => {
  const d = String(s || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= '2000-01-01' ? d : null;
};

// ──────────────────────────────────────────────────────────────
// 모으는 그릇
// ──────────────────────────────────────────────────────────────

/** code → day → 값. 모으는 방법(합·평균·최대·마지막)은 부르는 쪽이 정한다. */
class Daily {
  // 기기 시계가 틀어져 200년 뒤 날짜로 적힌 줄이 실제로 있다(체중 2226-10-09).
  // 내일보다 뒤의 날짜는 받지 않는다.
  constructor() { this.m = new Map(); this.maxDay = new Date(Date.now() + 86400000).toISOString().slice(0, 10); }
  slot(code, day) {
    let c = this.m.get(code);
    if (!c) { c = new Map(); this.m.set(code, c); }
    let s = c.get(day);
    if (!s) { s = { sum: 0, n: 0, max: -Infinity, min: Infinity, last: null, lastAt: -Infinity }; c.set(day, s); }
    return s;
  }
  add(code, day, v, at = 0) {
    if (!day || day > this.maxDay || v === null || !Number.isFinite(v)) return;
    const s = this.slot(code, day);
    s.sum += v; s.n += 1;
    if (v > s.max) s.max = v;
    if (v < s.min) s.min = v;
    if (at >= s.lastAt) { s.last = v; s.lastAt = at; }
  }
  has(code, day) { return !!this.m.get(code)?.has(day); }
  /** how: 'sum' | 'avg' | 'max' | 'min' | 'last' */
  out(code, how, digits, into, target = code) {
    const c = this.m.get(code);
    if (!c) return;
    const f = 10 ** digits;
    for (const [day, s] of c) {
      if (!s.n) continue;
      const v = how === 'sum' ? s.sum : how === 'avg' ? s.sum / s.n : how === 'max' ? s.max : how === 'min' ? s.min : s.last;
      into.push([day, target, Math.round(v * f) / f]);
    }
  }
}

// ──────────────────────────────────────────────────────────────
// 표마다 읽는 법
// ──────────────────────────────────────────────────────────────

/**
 * files: { [dataset]: csvText } — 있는 것만 넣으면 된다.
 * 돌려주는 것: [[day, code, value], ...] (day 오름차순)
 */
export function parseSamsungHealth(files) {
  const d = new Daily();
  const get = (name) => (files[name] ? readCsv(files[name]) : null);

  // ── 걸음 · 거리 ──────────────────────────────────────────────
  // step_daily_trend 의 source_type -2 가 **모든 기기를 합친** 그날의 걸음이다
  // (폰과 워치가 따로 센 줄이 함께 들어 있어, 그냥 더하면 두 배가 된다).
  const trend = get('com.samsung.shealth.step_daily_trend');
  if (trend) {
    const [cSrc, cDay, cCnt, cDist] = ['source_type', 'day_time', 'count', 'distance'].map(trend.col);
    for (const r of trend.rows) {
      if (r[cSrc] !== '-2') continue;
      const day = dayOf(r[cDay]);
      d.add('steps', day, toNum(r[cCnt]));
      const dist = toNum(r[cDist]);
      if (dist !== null) d.add('distance', day, dist / 1000);
    }
  }
  // 합친 줄이 없는 옛날(2015~)은 기기별 하루 요약 중 **가장 많이 센 것**으로 메운다.
  const ped = get('com.samsung.shealth.tracker.pedometer_day_summary');
  if (ped) {
    const [cDay, cCnt, cDist] = ['day_time', 'step_count', 'distance'].map(ped.col);
    const fill = new Daily();
    for (const r of ped.rows) {
      const day = dayOf(r[cDay]);
      fill.add('steps', day, toNum(r[cCnt]));
      const dist = toNum(r[cDist]);
      if (dist !== null) fill.add('distance', day, dist / 1000);
    }
    for (const code of ['steps', 'distance']) {
      for (const [day, s] of fill.m.get(code) || []) {
        if (!d.has(code, day) && s.n) d.add(code, day, s.max);
      }
    }
  }

  // ── 활동 요약 — 활동시간 · 활동 칼로리 · 층수 ──────────────────
  const act = get('com.samsung.shealth.activity.day_summary');
  if (act) {
    const [cDay, cAct, cCal, cFloor] = ['day_time', 'active_time', 'calorie', 'floor_count'].map(act.col);
    for (const r of act.rows) {
      const day = dayOf(r[cDay]);
      const ms = toNum(r[cAct]);
      if (ms !== null) d.add('active_min', day, ms / 60000);
      d.add('active_kcal', day, toNum(r[cCal]));
      const fl = toNum(r[cFloor]);
      if (fl && fl <= 300) d.add('floors_act', day, fl);
    }
  }
  const floors = get('com.samsung.shealth.tracker.floors_day_summary');
  if (floors) {
    const [cDay, cFl] = ['day_time', 'floor_count'].map(floors.col);
    for (const r of floors.rows) {
      const fl = toNum(r[cFl]);
      if (fl !== null && fl <= 300) d.add('floors', dayOf(r[cDay]), fl);   // 하루 17,730층 같은 값은 센서 오류다
    }
  }
  for (const [day, s] of d.m.get('floors_act') || []) {
    if (!d.has('floors', day)) d.add('floors', day, s.max);
  }

  // ── 운동 — 기록한 운동의 시간을 그날(시작한 날)에 더한다 ─────────
  const ex = get('com.samsung.shealth.exercise');
  if (ex) {
    const [cStart, cOff, cDur, cCal] = ['start_time', 'time_offset', 'duration', 'calorie'].map(ex.col);
    for (const r of ex.rows) {
      const t = utcMs(r[cStart]);
      const dur = toNum(r[cDur]);
      if (t === null || !dur || dur < 60000) continue;       // 1분이 안 되는 것은 잘못 누른 것이다
      const day = localDay(t, offsetMin(r[cOff]));
      d.add('exercise_min', day, dur / 60000);
      const cal = toNum(r[cCal]);
      if (cal) d.add('exercise_kcal', day, cal);
    }
  }

  // ── 수면 — **깬 날**에 붙인다 ───────────────────────────────────
  // 9월 18일 밤 11시에 잠들어 19일 아침에 깼다면 '19일의 잠'이다. 앱도 그렇게 적는다.
  // 폰과 워치가 같은 잠을 따로 적어 겹치는 일이 있어, 시간은 **구간의 합집합**으로 센다.
  // 점수·효율은 그날 가장 긴 잠의 것을 쓴다(낮잠 점수가 밤잠을 덮지 않게).
  const sl = get('com.samsung.shealth.sleep');
  if (sl) {
    const [cS, cE, cOff, cScore, cEff] = ['start_time', 'end_time', 'time_offset', 'sleep_score', 'efficiency'].map(sl.col);
    const nights = new Map(); // day → [{s,e,score,eff}]
    for (const r of sl.rows) {
      const s = utcMs(r[cS]);
      const e = utcMs(r[cE]);
      if (s === null || e === null || e <= s || e - s > 20 * 3600000) continue;
      const day = localDay(e, offsetMin(r[cOff]));
      if (!nights.has(day)) nights.set(day, []);
      nights.get(day).push({ s, e, score: toNum(r[cScore]), eff: toNum(r[cEff]) });
    }
    for (const [day, list] of nights) {
      list.sort((a, b) => a.s - b.s);
      let total = 0;
      let cs = list[0].s;
      let ce = list[0].e;
      for (const it of list.slice(1)) {
        if (it.s <= ce) ce = Math.max(ce, it.e);
        else { total += ce - cs; cs = it.s; ce = it.e; }
      }
      total += ce - cs;
      if (total < 30 * 60000) continue;                       // 30분이 안 되면 잠으로 치지 않는다
      d.add('sleep_h', day, total / 3600000);
      const scored = list.filter((x) => x.score > 0).sort((a, b) => (b.e - b.s) - (a.e - a.s))[0];
      if (scored) d.add('sleep_score', day, scored.score);
      const withEff = list.filter((x) => x.eff > 0).sort((a, b) => (b.e - b.s) - (a.e - a.s))[0];
      if (withEff) d.add('sleep_eff', day, withEff.eff);
    }
  }

  // ── 심박수 — 하루 평균 · 최저 ──────────────────────────────────
  const hr = get('com.samsung.shealth.tracker.heart_rate');
  if (hr) {
    const [cS, cOff, cHr] = ['start_time', 'time_offset', 'heart_rate'].map(hr.col);
    for (const r of hr.rows) {
      const t = utcMs(r[cS]);
      const v = toNum(r[cHr]);
      if (t === null || v === null || v < 30 || v > 220) continue;
      const day = localDay(t, offsetMin(r[cOff]));
      d.add('hr', day, v);
    }
  }

  // ── 에너지 점수 · 수면 중 심박 · 수면 중 HRV (워치가 아침에 매기는 것) ──
  const vit = get('com.samsung.shealth.vitality_score');
  if (vit) {
    const [cDay, cTot, cShr, cHrv] = ['day_time', 'total_score', 'shr_value', 'shrv_value'].map(vit.col);
    for (const r of vit.rows) {
      const day = dayOf(r[cDay]);
      const tot = toNum(r[cTot]);
      if (tot > 0) d.add('energy_score', day, tot);
      const shr = toNum(r[cShr]);
      if (shr > 20) d.add('hr_sleep', day, shr);
      const hrv = toNum(r[cHrv]);
      if (hrv > 0) d.add('hrv_sleep', day, hrv);
    }
  }

  // ── 혈중 산소 · 호흡수 · 피부 온도 · 스트레스 ──────────────────
  const spo = get('com.samsung.shealth.tracker.oxygen_saturation');
  if (spo) {
    const [cS, cOff, cV] = ['start_time', 'time_offset', 'spo2'].map(spo.col);
    for (const r of spo.rows) {
      const t = utcMs(r[cS]);
      const v = toNum(r[cV]);
      if (t === null || v === null || v < 70 || v > 100) continue;
      d.add('spo2', localDay(t, offsetMin(r[cOff])), v);
    }
  }
  const resp = get('com.samsung.health.respiratory_rate');
  if (resp) {
    const [cE, cOff, cV] = ['end_time', 'time_offset', 'average'].map(resp.col);
    for (const r of resp.rows) {
      const t = utcMs(r[cE]);
      const v = toNum(r[cV]);
      if (t === null || !(v > 0)) continue;
      d.add('resp', localDay(t, offsetMin(r[cOff])), v);
    }
  }
  const skin = get('com.samsung.health.skin_temperature');
  if (skin) {
    const [cE, cOff, cV] = ['end_time', 'time_offset', 'temperature'].map(skin.col);
    for (const r of skin.rows) {
      const t = utcMs(r[cE]);
      const v = toNum(r[cV]);
      if (t === null || !(v > 25 && v < 42)) continue;
      d.add('skin_temp', localDay(t, offsetMin(r[cOff])), v);
    }
  }
  const st = get('com.samsung.shealth.stress');
  if (st) {
    const [cS, cOff, cV] = ['start_time', 'time_offset', 'score'].map(st.col);
    for (const r of st.rows) {
      const t = utcMs(r[cS]);
      const v = toNum(r[cV]);
      if (t === null || v === null || v < 0) continue;
      d.add('stress', localDay(t, offsetMin(r[cOff])), v);
    }
  }

  // ── 체중 · 체지방률 · 골격근량 — 그날 **마지막으로 잰 것** ──────────
  const wt = get('com.samsung.health.weight');
  if (wt) {
    const [cS, cOff, cW, cF, cM] = ['start_time', 'time_offset', 'weight', 'body_fat', 'skeletal_muscle_mass'].map(wt.col);
    for (const r of wt.rows) {
      const t = utcMs(r[cS]);
      if (t === null) continue;
      const day = localDay(t, offsetMin(r[cOff]));
      const w = toNum(r[cW]);
      if (w > 20 && w < 300) d.add('weight', day, w, t);
      const f = toNum(r[cF]);
      if (f > 0 && f < 70) d.add('body_fat', day, f, t);
      const m = toNum(r[cM]);
      if (m > 5 && m < 100) d.add('smm', day, m, t);
    }
  }

  // ── 물 ──────────────────────────────────────────────────────
  const water = get('com.samsung.health.water_intake');
  if (water) {
    const [cS, cOff, cV] = ['start_time', 'time_offset', 'amount'].map(water.col);
    for (const r of water.rows) {
      const t = utcMs(r[cS]);
      const v = toNum(r[cV]);
      if (t === null || !(v > 0)) continue;
      d.add('water', localDay(t, offsetMin(r[cOff])), v);
    }
  }

  const out = [];
  d.out('steps', 'max', 0, out);
  d.out('distance', 'max', 2, out);
  d.out('active_min', 'max', 0, out);
  d.out('active_kcal', 'max', 0, out);
  d.out('floors', 'max', 0, out);
  d.out('exercise_min', 'sum', 0, out);
  d.out('exercise_kcal', 'sum', 0, out);
  d.out('sleep_h', 'last', 2, out);
  d.out('sleep_score', 'last', 0, out);
  d.out('sleep_eff', 'last', 1, out);
  d.out('hr', 'avg', 0, out, 'hr_avg');
  d.out('hr', 'min', 0, out, 'hr_min');
  d.out('hr_sleep', 'last', 0, out);
  d.out('hrv_sleep', 'last', 0, out);
  d.out('energy_score', 'last', 0, out);
  d.out('spo2', 'avg', 1, out);
  d.out('resp', 'avg', 1, out);
  d.out('skin_temp', 'avg', 2, out);
  d.out('stress', 'avg', 0, out);
  d.out('weight', 'last', 1, out);
  d.out('body_fat', 'last', 1, out);
  d.out('smm', 'last', 1, out);
  d.out('water', 'sum', 0, out);
  out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return out;
}
