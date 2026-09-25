// 헬스정보 → 삼성헬스 탭 — 워치·폰이 매일 재는 것을 **날짜 순으로 길게** 본다.
//
//   위   기간(1개월 · 3개월 · 1년 · 전체)과 '폴더에서 가져오기'
//   타일 최근 7일 평균 여섯 개 — 누르면 그 항목이 아래 그래프로 온다
//   아래 왼쪽에서 항목을 고르고 오른쪽에서 길게 본다(인바디·혈액 탭과 같은 얼개)
//
// ── 가져오기 ───────────────────────────────────────────────────────────
// 삼성헬스는 바깥에서 부를 수 있는 창구(API)가 없다. 폰에서 '개인 데이터 다운로드'로
// 내보낸 CSV 폴더가 유일한 출구다. 그래서 그 폴더를 **브라우저가 직접 읽고**, 하루
// 한 값으로 접어서(shealth-parse.js) 올린다. 원본은 이 컴퓨터를 떠나지 않는다.
//
// 크롬·엣지에서는 고른 폴더를 기억해 둔다(File System Access API). 다음부터는 새로
// 내보낸 것을 그 폴더에 넣고 **'다시 읽기' 한 번**이면 된다 — 폴더 안에서 가장 최근
// 내보내기(samsunghealth_<id>_<시각>)를 스스로 고른다.

import { el, esc, api, toast } from './util.js';
import { datasetOf, parseSamsungHealth } from './shealth-parse.js';

const ss = {
  loaded: false,
  groups: [],
  metrics: [],
  metricMap: new Map(),
  lastDay: null,
  lastImport: null,
  code: 'sleep_h',
  range: '3m',
  series: new Map(),   // code → [[day, value]] (전 기간. 기간 단추는 여기서 자른다)
};

const RANGES = [
  { key: '1m',  label: '1개월', days: 30,  bucket: 'day' },
  { key: '3m',  label: '3개월', days: 91,  bucket: 'day' },
  { key: '1y',  label: '1년',   days: 365, bucket: 'week' },
  { key: 'all', label: '전체',  days: 0,   bucket: 'month' },
];
const BUCKET_LABEL = { day: '하루 단위', week: '주 평균', month: '월 평균' };

/** 맨 위 타일 — 아침에 먼저 궁금한 것부터. */
const TILES = ['sleep_h', 'sleep_score', 'steps', 'exercise_min', 'hr_sleep', 'weight'];

const DAY = 86400000;
const tsOf = (d) => Date.parse(String(d) + 'T00:00:00Z');
const dayStr = (t) => new Date(t).toISOString().slice(0, 10);
const ymd = (d) => String(d || '').replaceAll('-', '.');
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

// ──────────────────────────────────────────────────────────────
// 숫자 적기
// ──────────────────────────────────────────────────────────────

/** 수면시간은 '5.4시간'이 아니라 '5시간 24분'으로 읽힌다. 나머지는 자리수대로. */
function fmt(m, v, withUnit = true) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '-';
  if (m.code === 'sleep_h') {
    const total = Math.round(v * 60);
    const h = Math.floor(total / 60);
    const mm = total % 60;
    return withUnit ? `${h}시간 ${String(mm).padStart(2, '0')}분` : `${h}:${String(mm).padStart(2, '0')}`;
  }
  const s = Number(v).toLocaleString('ko-KR', { minimumFractionDigits: 0, maximumFractionDigits: m.digits ?? 0 });
  return withUnit && m.unit ? `${s} ${m.unit}` : s;
}

/** 세로 눈금 — 수면은 '8:00' 보다 '8시간'이 읽힌다. 큰 수는 '1.2만'처럼 줄인다(자리가 좁다). */
function axisFmt(m, v) {
  if (m.code === 'sleep_h') return `${Math.round(v * 10) / 10}시간`;
  if (Math.abs(v) >= 10000) return `${Math.round(v / 1000) / 10}만`;
  return Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

/** 괜찮다고 널리 쓰이는 구간의 글자. */
function bandText(m) {
  const [a, b] = m.band;
  if (m.code === 'sleep_h') return `${a}~${b}시간 (성인 권장)`;
  return `${a}~${b}${m.unit}`;
}

/** 지난 7일 대비. 좋고 나쁨은 따지지 않는다 — 걸음이 준 것이 나쁜지는 그 주의 사정이 안다. */
function diffChip(m, now, prev) {
  if (now === null || prev === null || now === undefined || prev === undefined) return '';
  const diff = now - prev;
  const f = 10 ** (m.digits ?? 0);
  if (Math.round(diff * f) === 0) return '<span class="hp-delta">지난주와 같음</span>';
  const arrow = diff > 0 ? '▲' : '▼';
  const amount = m.code === 'sleep_h' ? `${Math.round(Math.abs(diff) * 60)}분` : fmt(m, Math.abs(diff));
  return `<span class="hp-delta">${arrow} ${esc(amount)}</span>`;
}

// ──────────────────────────────────────────────────────────────
// 자료
// ──────────────────────────────────────────────────────────────

let overviewInflight = null;
async function loadOverview(force = false) {
  if (ss.loaded && !force) return;
  // 화면이 뜰 때 라우터가 두 번 부르는 일이 있다 — 같은 물음은 한 번만 보낸다.
  if (!force && overviewInflight) return overviewInflight;
  overviewInflight = fetchOverview().finally(() => { overviewInflight = null; });
  return overviewInflight;
}
async function fetchOverview() {
  const r = await api('/api/health/daily');
  ss.groups = r.groups || [];
  ss.metrics = r.metrics || [];
  ss.metricMap = new Map(ss.metrics.map((m) => [m.code, m]));
  ss.lastDay = r.lastDay;
  ss.lastImport = r.lastImport;
  ss.loaded = true;
}

async function loadSeries(code) {
  if (ss.series.has(code)) return ss.series.get(code);
  const r = await api(`/api/health/daily/series?code=${encodeURIComponent(code)}`);
  ss.series.set(code, r.points || []);
  return r.points || [];
}

const hasData = () => ss.metrics.some((m) => m.count > 0);

// ══════════════════════════════════════════════════════════════
// 탭 그리기
// ══════════════════════════════════════════════════════════════

export async function renderSamsung(box) {
  box.innerHTML = '<div class="hp-loading">불러오는 중…</div>';
  try {
    await loadOverview();
  } catch (e) {
    box.innerHTML = `<p class="hp-empty">${esc(e.message)}</p>`;
    return;
  }

  if (!hasData()) {
    box.innerHTML = `
      <div class="hp-blank sh-blank">
        <p><b>아직 가져온 삼성헬스 기록이 없습니다.</b></p>
        <p class="faint">휴대폰 삼성헬스에서 내보낸 폴더를 한 번 지정하면, 걸음 · 수면 · 심박 · 체중이 하루 단위로 쌓입니다.</p>
        ${howToHtml()}
        <div class="sh-blank-act"><button class="btn-primary" type="button" id="sh-import">폴더에서 가져오기</button></div>
      </div>`;
    el('sh-import')?.addEventListener('click', openImportDialog);
    return;
  }

  // 고른 항목에 기록이 없으면 기록이 있는 첫 항목으로 옮긴다.
  if (!ss.metricMap.get(ss.code)?.count) ss.code = ss.metrics.find((m) => m.count)?.code || ss.code;

  box.innerHTML = `
    <div class="sh">
      <div class="sh-bar">
        <div class="sh-ranges" role="tablist" aria-label="기간" id="sh-ranges"></div>
        <div class="sh-src" id="sh-src"></div>
      </div>
      <div class="sh-tiles" id="sh-tiles"></div>
      <div class="hl">
        <aside class="hl-side"><div class="hl-codes" id="sh-codes"></div></aside>
        <div class="hl-main"><div id="sh-chart"><div class="hp-loading">불러오는 중…</div></div></div>
      </div>
    </div>`;

  paintRanges();
  paintSource();
  paintTiles();
  paintSide();
  await paintChart();
}

function paintRanges() {
  const box = el('sh-ranges');
  if (!box) return;
  box.innerHTML = RANGES.map(
    (r) => `<button class="sh-range${r.key === ss.range ? ' is-on' : ''}" type="button" role="tab"
              aria-selected="${r.key === ss.range}" data-range="${r.key}">${esc(r.label)}</button>`
  ).join('');
  box.querySelectorAll('[data-range]').forEach((b) =>
    b.addEventListener('click', async () => {
      ss.range = b.dataset.range;
      paintRanges();
      await paintChart();
    })
  );
}

function paintSource() {
  const box = el('sh-src');
  if (!box) return;
  const li = ss.lastImport;
  const when = li ? new Date(li.at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) : '';
  box.innerHTML = `
    <span class="sh-src-t">${ss.lastDay ? `${esc(ymd(ss.lastDay))}까지 기록` : ''}${li ? ` · ${esc(when)} 가져옴` : ''}</span>
    <button class="btn-secondary btn-sm" type="button" id="sh-import">가져오기</button>`;
  el('sh-import')?.addEventListener('click', openImportDialog);
}

function paintTiles() {
  const box = el('sh-tiles');
  if (!box) return;
  box.innerHTML = TILES.map((code) => ss.metricMap.get(code))
    .filter((m) => m && m.count)
    .map((m) => {
      // 체중은 7일 평균보다 **마지막으로 잰 값**이 궁금하다(매일 재지 않는다).
      const isLatest = m.code === 'weight' || m.avg7 === null;
      const v = isLatest ? m.latest?.value : m.avg7;
      const sub = isLatest
        ? (m.latest?.day ? `${ymd(m.latest.day).slice(5)} 측정` : '')
        : '최근 7일 평균';
      return `<button class="sh-tile${m.code === ss.code ? ' is-on' : ''}" type="button" data-code="${esc(m.code)}">
        <span class="hp-tile-l">${esc(m.label)}</span>
        <strong class="hp-tile-v">${esc(fmt(m, v))}</strong>
        <span class="hp-tile-s">${esc(sub)} ${isLatest ? '' : diffChip(m, m.avg7, m.avgPrev7)}</span>
      </button>`;
    })
    .join('');
  box.querySelectorAll('[data-code]').forEach((b) => b.addEventListener('click', () => pick(b.dataset.code)));
}

function paintSide() {
  const box = el('sh-codes');
  if (!box) return;
  box.innerHTML = ss.groups
    .map((g) => {
      const items = ss.metrics.filter((m) => m.group === g.key && m.count);
      if (!items.length) return '';
      return `<div class="hl-cat"><h4>${esc(g.label)}</h4><ul>${items
        .map(
          (m) => `<li><button class="hl-code${m.code === ss.code ? ' is-on' : ''}" type="button" data-code="${esc(m.code)}">
            <span>${esc(m.label)}</span><em>${esc(m.unit)}</em>
          </button></li>`
        )
        .join('')}</ul></div>`;
    })
    .join('');
  box.querySelectorAll('[data-code]').forEach((b) => b.addEventListener('click', () => pick(b.dataset.code)));
}

async function pick(code) {
  ss.code = code;
  paintTiles();
  paintSide();
  await paintChart();
}

// ──────────────────────────────────────────────────────────────
// 기간 자르기 · 묶기
// ──────────────────────────────────────────────────────────────

/** 그 날이 속한 묶음의 시작. 주는 월요일에 시작한다. */
function bucketStart(t, kind) {
  if (kind === 'day') return t;
  const d = new Date(t);
  if (kind === 'week') return t - ((d.getUTCDay() + 6) % 7) * DAY;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}
function bucketEnd(start, kind) {
  if (kind === 'day') return start + DAY;
  if (kind === 'week') return start + 7 * DAY;
  const d = new Date(start);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/**
 * 기간의 끝은 '오늘'이 아니라 **기록된 마지막 날**이다. 내보내기는 며칠에 한 번이라,
 * 오늘로 끊으면 그래프 오른쪽 끝이 늘 비어 있어 '요즘 안 걸었나' 하고 읽힌다.
 */
function windowOf(points, range) {
  const r = RANGES.find((x) => x.key === range) || RANGES[1];
  const end = ss.lastDay || points[points.length - 1]?.[0];
  const from = r.days ? dayStr(tsOf(end) - (r.days - 1) * DAY) : points[0]?.[0];
  const inRange = points.filter(([d]) => d >= from && d <= end);
  return { r, from, end, inRange };
}

/** 하루 값들을 묶음마다 평균 낸다. 기록이 없는 날은 평균에 넣지 않는다. */
function bucketize(points, kind) {
  const map = new Map();
  for (const [d, v] of points) {
    const s = bucketStart(tsOf(d), kind);
    let b = map.get(s);
    if (!b) { b = { start: s, end: bucketEnd(s, kind), sum: 0, n: 0 }; map.set(s, b); }
    b.sum += v; b.n += 1;
  }
  return [...map.values()].sort((a, b) => a.start - b.start).map((b) => ({ ...b, v: b.sum / b.n }));
}

/** 눈금을 1 · 2 · 5 · 10 단위로 끊는다(3,712 같은 눈금은 읽히지 않는다). */
function niceTicks(lo, hi, n = 4) {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const e = raw / mag;
  const step = (e >= 7.5 ? 10 : e >= 3.5 ? 5 : e >= 1.5 ? 2 : 1) * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

// ──────────────────────────────────────────────────────────────
// 그래프
// ──────────────────────────────────────────────────────────────

const W = 860;
const H = 280;
const PAD = { l: 46, r: 12, t: 16, b: 30 };

function chartSvg(m, buckets, kind, from, end, avg) {
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const t0 = bucketStart(tsOf(from), kind);
  const t1 = bucketEnd(bucketStart(tsOf(end), kind), kind);
  const X = (t) => PAD.l + (iw * (t - t0)) / (t1 - t0);

  const vals = buckets.map((b) => b.v);
  const isBar = m.chart === 'bar';
  let lo;
  let hi;
  if (isBar) {
    lo = 0;
    hi = Math.max(...vals, m.band ? m.band[0] : 0) * 1.08;
  } else {
    lo = Math.min(...vals);
    hi = Math.max(...vals);
    if (m.band) { lo = Math.min(lo, m.band[0]); hi = Math.max(hi, m.band[1]); }
    const pad = (hi - lo) * 0.12 || Math.max(1, Math.abs(hi) * 0.05);
    lo -= pad; hi += pad;
  }
  const ticks = niceTicks(lo, hi);
  if (isBar && ticks[ticks.length - 1] < hi) hi = ticks[ticks.length - 1] + (ticks[1] - ticks[0] || 1);
  const Y = (v) => PAD.t + ih - ((v - lo) / (hi - lo)) * ih;

  // 가로 눈금 — 기간에 맞춰 날 · 달 · 해로 바꾼다.
  let xgrid = '';
  let xlab = '';
  const tick = (t, label) => {
    const gx = X(t);
    if (gx < PAD.l - 0.5 || gx > W - PAD.r + 0.5) return;
    xgrid += `<line class="hp-grid" x1="${gx.toFixed(1)}" y1="${PAD.t}" x2="${gx.toFixed(1)}" y2="${PAD.t + ih}"/>`;
    xlab += `<text class="hp-ax" x="${gx.toFixed(1)}" y="${H - 10}">${esc(label)}</text>`;
  };
  const span = (t1 - t0) / DAY;
  if (span <= 40) {
    for (let t = tsOf(end); t >= t0; t -= 7 * DAY) {
      const d = new Date(t);
      tick(t, `${d.getUTCMonth() + 1}.${d.getUTCDate()}`);
    }
  } else if (span <= 400) {
    const d0 = new Date(t0);
    for (let mth = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1); mth < t1; mth = Date.UTC(new Date(mth).getUTCFullYear(), new Date(mth).getUTCMonth() + 1, 1)) {
      const d = new Date(mth);
      tick(mth, d.getUTCMonth() === 0 ? `${d.getUTCFullYear()}년` : `${d.getUTCMonth() + 1}월`);
    }
  } else {
    const y0 = new Date(t0).getUTCFullYear();
    const y1 = new Date(t1).getUTCFullYear();
    const step = Math.max(1, Math.ceil(44 / (iw / Math.max(1, span / 365))));
    for (let y = y0 + 1; y <= y1; y += 1) if ((y - y0 - 1) % step === 0) tick(Date.UTC(y, 0, 1), String(y));
  }

  const ygrid = ticks
    .filter((v) => v >= lo && v <= hi)
    .map((v) => `<line class="hp-grid" x1="${PAD.l}" y1="${Y(v).toFixed(1)}" x2="${W - PAD.r}" y2="${Y(v).toFixed(1)}"/>
      <text class="sh-yax" x="${PAD.l - 6}" y="${(Y(v) + 3.5).toFixed(1)}">${esc(axisFmt(m, v))}</text>`)
    .join('');

  let band = '';
  if (m.band) {
    const top = Y(Math.min(m.band[1], hi));
    const bot = Y(Math.max(m.band[0], lo));
    if (bot > top) band = `<rect class="hp-band" x="${PAD.l}" y="${top.toFixed(1)}" width="${iw}" height="${(bot - top).toFixed(1)}"/>`;
  }

  let marks = '';
  if (isBar) {
    marks = buckets
      .map((b) => {
        const x0 = X(b.start);
        const bw = X(b.end) - x0;
        const gap = Math.min(bw * 0.18, 3);
        const y = Y(b.v);
        return `<rect class="sh-bar-r" x="${(x0 + gap / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0.8, bw - gap).toFixed(1)}" height="${Math.max(0, PAD.t + ih - y).toFixed(1)}"/>`;
      })
      .join('');
  } else {
    const pts = buckets.map((b) => [X((b.start + b.end) / 2), Y(b.v)]);
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    marks = `<path class="hp-line" d="${d}"/>`;
    if (pts.length <= 70) {
      marks += pts.map(([x, y]) => `<circle class="hp-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${pts.length > 35 ? 2.4 : 3.2}"/>`).join('');
    }
  }

  const avgLine = avg !== null
    ? `<line class="sh-avg" x1="${PAD.l}" y1="${Y(avg).toFixed(1)}" x2="${W - PAD.r}" y2="${Y(avg).toFixed(1)}"/>
       <text class="sh-avg-t" x="${W - PAD.r - 4}" y="${(Y(avg) - 5).toFixed(1)}">평균 ${esc(fmt(m, avg))}</text>`
    : '';

  return `<div class="sh-plot">
    <svg class="sh-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(m.label)} 추이">
      ${band}${ygrid}${xgrid}
      <line class="hp-axis" x1="${PAD.l}" y1="${PAD.t + ih}" x2="${W - PAD.r}" y2="${PAD.t + ih}"/>
      ${marks}${avgLine}${xlab}
      <line class="sh-guide" id="sh-guide" x1="0" y1="${PAD.t}" x2="0" y2="${PAD.t + ih}" visibility="hidden"/>
      <rect class="sh-hit" id="sh-hit" x="${PAD.l}" y="${PAD.t}" width="${iw}" height="${ih}"/>
    </svg>
    <div class="sh-tip" id="sh-tip" hidden></div>
  </div>`;
}

/** 손가락·마우스가 닿은 자리에서 가장 가까운 묶음의 값을 띄운다. */
function wireHover(m, buckets, kind, from, end) {
  const svg = document.querySelector('.sh-chart');
  const hit = el('sh-hit');
  const guide = el('sh-guide');
  const tip = el('sh-tip');
  if (!svg || !hit || !buckets.length) return;
  const iw = W - PAD.l - PAD.r;
  const t0 = bucketStart(tsOf(from), kind);
  const t1 = bucketEnd(bucketStart(tsOf(end), kind), kind);
  const centers = buckets.map((b) => PAD.l + (iw * ((b.start + b.end) / 2 - t0)) / (t1 - t0));

  const label = (b) => {
    const d = new Date(b.start);
    if (kind === 'day') return `${ymd(dayStr(b.start))} (${WEEK[d.getUTCDay()]})`;
    if (kind === 'week') return `${ymd(dayStr(b.start)).slice(5)} ~ ${ymd(dayStr(b.end - DAY)).slice(5)} 주 평균`;
    return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 평균`;
  };

  const move = (ev) => {
    const rect = svg.getBoundingClientRect();
    const vx = ((ev.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < centers.length; i += 1) if (Math.abs(centers[i] - vx) < Math.abs(centers[best] - vx)) best = i;
    const b = buckets[best];
    guide.setAttribute('x1', centers[best]);
    guide.setAttribute('x2', centers[best]);
    guide.setAttribute('visibility', 'visible');
    tip.innerHTML = `<span>${esc(label(b))}</span><b>${esc(fmt(m, b.v))}</b>${kind !== 'day' ? `<em>${b.n}일 기록</em>` : ''}`;
    tip.hidden = false;
    const pct = Math.min(88, Math.max(12, (centers[best] / W) * 100));
    tip.style.left = `${pct}%`;
  };
  const leave = () => {
    guide.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', leave);
}

async function paintChart() {
  const box = el('sh-chart');
  const m = ss.metricMap.get(ss.code);
  if (!box || !m) return;
  box.innerHTML = '<div class="hp-loading">불러오는 중…</div>';
  let points;
  try {
    points = await loadSeries(m.code);
  } catch (e) {
    box.innerHTML = `<p class="hp-empty">${esc(e.message)}</p>`;
    return;
  }
  if (ss.code !== m.code) return; // 기다리는 사이 다른 항목을 눌렀다

  const { r, from, end, inRange } = windowOf(points, ss.range);
  const totalDays = Math.round((tsOf(end) - tsOf(from)) / DAY) + 1;

  let body;
  let stats = '';
  if (!inRange.length) {
    body = `<p class="hp-empty">이 기간에는 ${esc(m.label)} 기록이 없습니다. 마지막 기록은 ${esc(ymd(m.last))} 입니다 — 기간을 넓혀 보세요.</p>`;
  } else {
    const buckets = bucketize(inRange, r.bucket);
    const vals = inRange.map((p) => p[1]);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const maxP = inRange.reduce((a, b) => (b[1] > a[1] ? b : a));
    const minP = inRange.reduce((a, b) => (b[1] < a[1] ? b : a));
    const first = inRange[0];
    const last = inRange[inRange.length - 1];
    const stat = (l, v, s) => `<div class="hp-tile"><span class="hp-tile-l">${esc(l)}</span><strong class="sh-stat-v">${esc(v)}</strong><span class="hp-tile-s">${esc(s || '')}</span></div>`;
    const change = last[1] - first[1];
    stats = `<div class="hp-tiles sh-stats">
      ${stat('기간 평균', fmt(m, avg), `하루 기준`)}
      ${stat('가장 높은 날', fmt(m, maxP[1]), ymd(maxP[0]))}
      ${stat('가장 낮은 날', fmt(m, minP[1]), ymd(minP[0]))}
      ${m.chart === 'line'
        ? stat('처음 → 마지막', `${change > 0 ? '+' : change < 0 ? '−' : ''}${fmt(m, Math.abs(change))}`, `${ymd(first[0]).slice(2)} → ${ymd(last[0]).slice(2)}`)
        : stat('기록한 날', `${inRange.length}일`, `기간 ${totalDays}일 중`)}
    </div>`;
    body = chartSvg(m, buckets, r.bucket, from, end, avg);
    queueMicrotask(() => wireHover(m, buckets, r.bucket, from, end));
  }

  box.innerHTML = `
    <div class="hp-trend-card">
      <div class="hp-trend-head">
        <div>
          <h2 class="hp-trend-title">${esc(m.label)} <span class="hp-unit">(${esc(m.unit)})</span></h2>
          <p class="hp-trend-sub">${esc(ymd(from))} ~ ${esc(ymd(end))} · ${esc(BUCKET_LABEL[r.bucket])}${
            m.band ? ` · <span class="hp-refnote">초록 띠 ${esc(bandText(m))}</span>` : ''
          }</p>
        </div>
        <span class="hp-trend-n">전체 ${m.count.toLocaleString('ko-KR')}일 · ${esc(ymd(m.first).slice(0, 4))}~</span>
      </div>
      ${m.memo ? `<p class="hp-trend-memo">${esc(m.memo)}</p>` : ''}
      ${stats}
      ${body}
    </div>
    <p class="hp-disclaimer">워치·휴대폰이 잰 값을 하루 한 값으로 모은 것입니다. 기기를 바꾸거나 차지 않은 날은 값이 튀거나 비어 있을 수 있습니다.</p>`;
}

// ══════════════════════════════════════════════════════════════
// 가져오기
// ══════════════════════════════════════════════════════════════

function howToHtml() {
  return `
    <ol class="sh-howto">
      <li>휴대폰 <b>삼성헬스</b> → 오른쪽 위 <b>⋮</b> → <b>설정</b> → <b>개인 데이터 다운로드</b></li>
      <li>폰의 <b>내 파일 › 다운로드 › Samsung Health</b> 에 <code>samsunghealth_…</code> 폴더가 생깁니다. 이 폴더를 PC로 옮깁니다(OneDrive 폴더에 두면 편합니다).</li>
      <li>여기서 그 폴더(또는 여러 번 내보낸 것을 모아 둔 <b>상위 폴더</b>)를 지정합니다. 가장 최근 것을 알아서 고릅니다.</li>
    </ol>`;
}

// ── 고른 폴더 기억하기 (크롬 · 엣지) ─────────────────────────────
// 폴더 '손잡이'는 IndexedDB 에만 담을 수 있다(localStorage 에는 글자만 들어간다).
// 손잡이는 이 브라우저 안에서만 쓸모가 있고, 폴더 안의 내용이 아니라 **위치**다.

const IDB = { db: 'japis-shealth', store: 'kv', key: 'dir' };
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(IDB.db, 1);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => req.result.createObjectStore(IDB.store);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction(IDB.store, mode);
      const r = fn(tx.objectStore(IDB.store));
      tx.oncomplete = () => resolve(r?.result);
      tx.onerror = () => reject(tx.error);
    };
  });
}
const savedDir = () => idb('readonly', (s) => s.get(IDB.key)).catch(() => null);
const saveDir = (h) => idb('readwrite', (s) => s.put(h, IDB.key)).catch(() => {});

const canPickDir = () => typeof window.showDirectoryPicker === 'function';

/**
 * 폴더 안을 뒤져 **표마다 가장 최근 내보내기**의 파일을 고른다.
 * jsons · files 아래는 들어가지 않는다 — 수천 개의 작은 파일이 있고 쓰지 않는다.
 */
async function collectFromHandle(dir, depth = 0, path = '', found = new Map()) {
  for await (const [name, h] of dir.entries()) {
    if (h.kind === 'file') {
      const d = datasetOf(name);
      if (!d) continue;
      const cur = found.get(d.dataset);
      if (!cur || d.stamp > cur.stamp) found.set(d.dataset, { ...d, getFile: () => h.getFile(), folder: path || dir.name });
    } else if (depth < 3 && name !== 'jsons' && name !== 'files') {
      await collectFromHandle(h, depth + 1, name, found);
    }
  }
  return found;
}

function collectFromList(fileList) {
  const found = new Map();
  for (const f of fileList) {
    const d = datasetOf(f.name);
    if (!d) continue;
    const parts = (f.webkitRelativePath || '').split('/');
    const cur = found.get(d.dataset);
    if (!cur || d.stamp > cur.stamp) found.set(d.dataset, { ...d, getFile: async () => f, folder: parts[parts.length - 2] || '' });
  }
  return found;
}

window.addEventListener('hashchange', () => {
  document.querySelectorAll('dialog.sh-dialog[open]').forEach((d) => d.close());
});

async function openImportDialog() {
  const handle = canPickDir() ? await savedDir() : null;
  const d = document.createElement('dialog');
  d.className = 'hp-dialog sh-dialog';
  d.innerHTML = `
    <div class="hp-form">
      <h2 class="modal-title">삼성헬스 기록 가져오기</h2>
      <p class="modal-lead">내보낸 폴더를 이 브라우저가 직접 읽어 <b>하루 한 값</b>으로 모아 올립니다. 원본 파일은 올라가지 않습니다.</p>
      ${howToHtml()}
      <label class="sh-check"><input type="checkbox" id="sh-all"> 전체 기간 다시 올리기 <span class="faint">(보통은 새로 생긴 날만 올립니다)</span></label>
      <div class="sh-prog" id="sh-prog" hidden><div class="sh-prog-bar"><span id="sh-prog-fill"></span></div><p id="sh-prog-t"></p></div>
      <p class="form-error" data-err hidden></p>
      <div class="modal-actions sh-actions">
        <button type="button" class="btn-secondary" data-close>닫기</button>
        ${handle ? `<button type="button" class="btn-primary" id="sh-reread" title="${esc(handle.name)}">'${esc(handle.name)}' 다시 읽기</button>` : ''}
        <button type="button" class="${handle ? 'btn-secondary' : 'btn-primary'}" id="sh-pick">${handle ? '다른 폴더 지정' : '폴더 지정'}</button>
        <input type="file" id="sh-files" webkitdirectory directory multiple hidden>
      </div>
    </div>`;
  document.body.appendChild(d);
  d.addEventListener('close', () => d.remove());
  d.addEventListener('cancel', (ev) => { if (d.dataset.busy) ev.preventDefault(); });
  d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { if (!d.dataset.busy) d.close(); }));
  d.showModal();

  const err = d.querySelector('[data-err]');
  const showErr = (msg) => { err.textContent = msg; err.hidden = false; };

  const run = async (found) => {
    err.hidden = true;
    d.dataset.busy = '1';
    d.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      await importFound(found, el('sh-all').checked, progress);
      delete d.dataset.busy;
      d.close();
    } catch (e) {
      showErr(e.message);
    } finally {
      delete d.dataset.busy;
      d.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    }
  };

  d.querySelector('#sh-reread')?.addEventListener('click', async () => {
    try {
      // 권한은 **누른 그 순간**에만 물을 수 있다(브라우저 규칙). 그래서 여기서 묻는다.
      const ok = (await handle.queryPermission({ mode: 'read' })) === 'granted'
        || (await handle.requestPermission({ mode: 'read' })) === 'granted';
      if (!ok) { showErr('폴더를 읽을 권한을 받지 못했습니다.'); return; }
      await run(await collectFromHandle(handle));
    } catch (e) {
      showErr(`폴더를 열 수 없습니다 — 옮겨졌거나 이름이 바뀌었을 수 있습니다. '다른 폴더 지정'으로 다시 골라 주세요. (${e.message})`);
    }
  });

  d.querySelector('#sh-pick').addEventListener('click', async () => {
    if (!canPickDir()) { d.querySelector('#sh-files').click(); return; }
    let h;
    try {
      h = await window.showDirectoryPicker({ id: 'japis-shealth', mode: 'read' });
    } catch {
      return; // 골라 놓고 취소했다
    }
    await saveDir(h);
    await run(await collectFromHandle(h));
  });

  d.querySelector('#sh-files').addEventListener('change', async (ev) => {
    const list = ev.target.files;
    if (list && list.length) await run(collectFromList(list));
  });

  function progress(pct, text) {
    el('sh-prog').hidden = false;
    el('sh-prog-fill').style.width = `${Math.round(pct * 100)}%`;
    el('sh-prog-t').textContent = text;
  }
}

/** 읽기 → 접기 → (새로 생긴 날만) 나눠 올리기. */
async function importFound(found, all, progress) {
  if (!found.size) throw new Error('그 폴더에서 삼성헬스 CSV(com.samsung.….csv)를 찾지 못했습니다. samsunghealth_… 폴더나 그 상위 폴더를 골라 주세요.');

  const entries = [...found.values()];
  const files = {};
  let i = 0;
  for (const e of entries) {
    i += 1;
    progress((i / entries.length) * 0.4, `파일 읽는 중 ${i}/${entries.length} — ${e.dataset.replace(/^com\.samsung\.(s?health)\./, '')}`);
    files[e.dataset] = await (await e.getFile()).text();
  }
  progress(0.42, '하루 단위로 모으는 중…');
  await new Promise((r) => setTimeout(r, 30)); // 글자가 먼저 그려지게 한 박자 쉰다
  const rows = parseSamsungHealth(files);
  if (!rows.length) throw new Error('읽은 파일에서 모을 값이 없었습니다.');

  // 새로 생긴 날만 — 항목마다 서버에 있는 마지막 날의 **일주일 전부터** 다시 올린다.
  // 마지막 며칠은 내보낼 때 아직 하루가 끝나지 않아 값이 덜 찼을 수 있어서다.
  await loadOverview(true);
  const cut = new Map();
  if (!all) for (const m of ss.metrics) if (m.last) cut.set(m.code, dayStr(tsOf(m.last) - 7 * DAY));
  const send = rows.filter(([day, code]) => !cut.has(code) || day >= cut.get(code));

  const source = entries.map((e) => e.folder).sort().pop() || '';
  const CHUNK = 3000;
  const total = Math.max(1, Math.ceil(send.length / CHUNK));
  for (let k = 0; k < total; k += 1) {
    progress(0.45 + (0.55 * k) / total, `올리는 중 ${k + 1}/${total}`);
    const part = send.slice(k * CHUNK, (k + 1) * CHUNK);
    const isLast = k === total - 1;
    await api('/api/health/daily/import', {
      method: 'POST',
      body: {
        rows: part,
        ...(isLast ? { final: { source, rows: send.length, first: rows[0][0], last: rows[rows.length - 1][0] } } : {}),
      },
    });
  }
  progress(1, '다 올렸습니다.');

  ss.series.clear();
  await loadOverview(true);
  toast(`${send.length.toLocaleString('ko-KR')}개 값을 반영했습니다 (${ymd(rows[0][0])} ~ ${ymd(rows[rows.length - 1][0])})`);
  const box = el('hp-tabbody');
  if (box) await renderSamsung(box);
}
