// 헬스정보 — 검사 결과를 **항목별로 세워 보는** 화면 하나, 탭 셋.
//
//   #/health         종합검진  연 1회. 결과지와 **같은 모양**의 표를 그린다
//   #/health/inbody  인바디    체성분. 고른 항목 하나를 **선 하나**로 길게 본다
//   #/health/blood   혈액      콜레스테롤·간·신장. 인바디와 같은 얼개
//
// 처음에는 '인바디·혈액'을 옆 메뉴로 따로 뽑았다. 걷었다 — 메뉴에서 나란히 설
// 이유가 없다. 셋 다 **내 몸의 같은 기록**이고, 보는 사람은 "건강 얘기"를 하러
// 한 번 들어온다. 들어와서 탭으로 고르는 것이 맞다.
//
// ── 이 화면이 하지 않는 것 ─────────────────────────────────────────────
// 진단하지 않는다. 참고범위 대비 위치(높음·낮음)와 전보다 어느 쪽으로 움직였는지
// 까지만 적는다. "그래서 무엇을 해야 하나"는 의사의 자리다 — 화면 아래에 그 한
// 줄을 늘 적어 둔다.

import { el, esc, api, toast } from './util.js';
import { ico } from './icons.js';

const hs = {
  loaded: false,
  categories: [],
  kinds: [],
  metrics: [],          // 이름표 전부
  metricMap: new Map(),
  exams: [],            // 전 종류
  tab: 'checkup',       // 'checkup' | 'inbody' | 'blood'
  // 종합검진 탭
  examId: null,
  detail: null,
  open: new Set(),      // 펼쳐 둔 분류
  // 인바디·혈액 탭 — 고른 항목은 탭마다 따로 기억한다(오가도 보던 자리가 남는다)
  labCode: { inbody: 'weight', blood: 'ldl' },
};

const FLAG_LABEL = { H: '높음', L: '낮음', N: '정상' };

/** 숫자를 사람이 읽는 만큼만. 1.058 은 그대로, 174.80 은 174.8 로. */
const num = (v) => (v === null || v === undefined ? '' : String(Math.round(v * 1000) / 1000));

/** 값 한 칸 — 숫자가 있으면 숫자, 없으면 글자. 둘 다 없으면 빈칸('-'조차 적지 않는다). */
const cellText = (c) => (c && c.num !== null && c.num !== undefined ? num(c.num) : c && c.text ? c.text : '');

const ymd = (d) => String(d || '').replaceAll('-', '.');
const yearOf = (d) => String(d || '').slice(0, 4);

const flagPill = (flag) =>
  flag && flag !== 'N' ? `<span class="hp-flag is-${flag === 'H' ? 'hi' : 'lo'}">${FLAG_LABEL[flag]}</span>` : '';

/** 화살표는 **수치의 방향**, 색은 **몸에 좋은 방향**. 둘은 자주 어긋난다(콜레스테롤 ↓ 은 초록). */
function deltaChip(d, unit) {
  if (!d || d.dir === 'flat') return '';
  const arrow = d.dir === 'up' ? '▲' : '▼';
  const tone = d.good === true ? ' is-good' : d.good === false ? ' is-bad' : '';
  const amount = num(Math.abs(d.diff));
  return `<span class="hp-delta${tone}">${arrow} ${esc(amount)}${esc(unit || '')}</span>`;
}

const refLabel = (r) => {
  if (r.refText) return r.refText;
  if (r.refLow !== null && r.refHigh !== null) return `${num(r.refLow)}~${num(r.refHigh)}`;
  if (r.refHigh !== null) return `~${num(r.refHigh)}`;
  if (r.refLow !== null) return `${num(r.refLow)}~`;
  return '';
};

// ──────────────────────────────────────────────────────────────
// 선 하나 — 참고범위를 띠로 깔고 그 위에 값을 잇는다
// ──────────────────────────────────────────────────────────────

/**
 * 값만 이어 놓으면 오르내림은 보여도 **그것이 괜찮은 수치인지**는 보이지 않는다.
 * 그래서 참고범위를 연한 띠로 먼저 깔고, 선은 그 위에 얹는다 — 띠 밖으로 나간
 * 점만 빨갛게 찍는다. 눈이 먼저 찾는 것은 선의 모양이 아니라 띠를 벗어난 점이다.
 */
function chartSvg(series, { w = 720, h = 210 } = {}) {
  const pts = (series.points || []).filter((p) => p.num !== null && p.num !== undefined);
  if (pts.length < 1) return '<p class="hp-empty">그릴 숫자가 아직 없습니다.</p>';

  const padL = 18;
  const padR = 14;
  const padT = 16;
  const padB = 28;
  const iw = w - padL - padR;
  const ih = h - padT - padB;

  // 띠는 **가장 최근 회차가 쓴 기준**으로 깐다. 검사실마다 기준이 달라서
  // (요산: 강북삼성 2.8~8.2 · GC Labs 3.4~7.0) 이름표의 범위 하나로 깔면
  // 띠 안에 있는 점이 '낮음'으로 찍히는 모순이 그대로 보인다.
  const last = pts[pts.length - 1];
  const bandLow = last.refLow ?? series.refLow ?? null;
  const bandHigh = last.refHigh ?? series.refHigh ?? null;

  const vals = pts.map((p) => p.num);
  const cands = [...vals];
  if (bandLow !== null) cands.push(bandLow);
  if (bandHigh !== null) cands.push(bandHigh);
  let lo = Math.min(...cands);
  let hi = Math.max(...cands);
  if (hi === lo) { hi = lo + 1; lo = lo - 1; }
  const room = (hi - lo) * 0.14;
  lo -= room; hi += room;

  const x = (i) => padL + (pts.length === 1 ? iw / 2 : (iw * i) / (pts.length - 1));
  const y = (v) => padT + ih - ((v - lo) / (hi - lo)) * ih;

  // 참고범위 띠
  let band = '';
  if (bandHigh !== null || bandLow !== null) {
    const bTop = bandHigh !== null ? y(bandHigh) : padT;
    const bBot = bandLow !== null ? y(bandLow) : padT + ih;
    band = `<rect class="hp-band" x="${padL}" y="${bTop}" width="${iw}" height="${Math.max(1, bBot - bTop)}"/>`;
  }

  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.num).toFixed(1)}`).join(' ');

  const dots = pts
    .map((p, i) => {
      const bad = p.flag === 'H' || p.flag === 'L';
      return `<circle class="hp-dot${bad ? ' is-bad' : ''}" cx="${x(i).toFixed(1)}" cy="${y(p.num).toFixed(1)}" r="4">
        <title>${esc(p.date)} · ${esc(num(p.num))}${esc(series.unit || '')}${bad ? ` (${FLAG_LABEL[p.flag]})` : ''}</title>
      </circle>`;
    })
    .join('');

  const labels = pts
    .map((p, i) => `<text class="hp-vx" x="${x(i).toFixed(1)}" y="${(y(p.num) - 11).toFixed(1)}">${esc(num(p.num))}</text>`)
    .join('');

  const axis = pts
    .map((p, i) => `<text class="hp-ax" x="${x(i).toFixed(1)}" y="${h - 9}">${esc(ymd(p.date).slice(2))}</text>`)
    .join('');

  // 세로축에 눈금 숫자를 적지 않는다 — 점마다 값이 이미 붙어 있고, 괜찮은 구간은
  // 띠가 말해 준다(참고범위 글자는 제목 아래에 있다). 셋을 다 적으면 서로 겹친다.
  // preserveAspectRatio 도 건드리지 않는다: 'none' 으로 늘리면 글자까지 함께 늘어난다.
  return `<svg class="hp-chart" viewBox="0 0 ${w} ${h}" role="img"
               aria-label="${esc(series.name)} 추이">
    ${band}
    <line class="hp-axis" x1="${padL}" y1="${padT + ih}" x2="${w - padR}" y2="${padT + ih}"/>
    <path class="hp-line" d="${line}"/>
    ${dots}${labels}${axis}
  </svg>`;
}

// ──────────────────────────────────────────────────────────────
// 자료 받아오기
// ──────────────────────────────────────────────────────────────

async function loadOverview(force = false) {
  if (hs.loaded && !force) return;
  const r = await api('/api/health');
  hs.categories = r.categories || [];
  hs.kinds = r.kinds || [];
  hs.metrics = r.metrics || [];
  hs.metricMap = new Map(hs.metrics.map((m) => [m.code, m]));
  hs.exams = r.exams || [];
  hs.loaded = true;
}

const checkups = () => hs.exams.filter((e) => e.kind === 'checkup');
const examsOf = (kind) => hs.exams.filter((e) => e.kind === kind);

// ══════════════════════════════════════════════════════════════
// 화면 하나, 탭 셋
// ══════════════════════════════════════════════════════════════

const TABS = [
  { key: 'checkup', label: '종합검진', hint: '연 1회 — 결과지 그대로' },
  { key: 'inbody',  label: '인바디',   hint: '체성분 · 부위별 근육' },
  { key: 'blood',   label: '혈액',     hint: '콜레스테롤 · 간 · 신장' },
];
const isTab = (k) => TABS.some((t) => t.key === k);

/** 탭의 주소. 종합검진은 맨 주소(#/health)다 — 들어오면 먼저 보이는 것이 그것이다. */
const tabHash = (key) => (key === 'checkup' ? '#/health' : `#/health/${key}`);

export async function renderHealth(page, sub) {
  hs.tab = isTab(sub) ? sub : 'checkup';

  page.innerHTML = `
    <div class="page-head tight">
      <h1 class="page-title">헬스정보</h1>
      <p class="page-lead">검진 · 체성분 · 피검사를 검사항목별로 세워 봅니다. 항목 이름을 누르면 그 항목만 길게 볼 수 있습니다.</p>
    </div>
    <div class="hp">
      <nav class="hp-tabs" id="hp-tabs" aria-label="헬스정보 갈래"></nav>
      <div id="hp-tabbody"><div class="hp-loading">불러오는 중…</div></div>
    </div>`;

  paintTabs();
  try {
    await loadOverview();
  } catch (e) {
    el('hp-tabbody').innerHTML = `<p class="hp-empty">${esc(e.message)}</p>`;
    return;
  }
  await paintTabBody();
}

/**
 * 탭은 단추가 아니라 **링크**다. 주소가 갈리면 뒤로 가기가 살고, 그 탭을 눌러
 * 둔 채 새로고침해도 같은 자리에 선다(라우터가 sub 를 그대로 돌려준다).
 */
function paintTabs() {
  const box = el('hp-tabs');
  if (!box) return;
  box.innerHTML = TABS.map(
    (t) => `<a class="hp-tab${t.key === hs.tab ? ' is-on' : ''}" href="${tabHash(t.key)}"
              aria-current="${t.key === hs.tab ? 'page' : 'false'}">
        <span class="hp-tab-n">${esc(t.label)}</span>
        <span class="hp-tab-h">${esc(t.hint)}</span>
      </a>`
  ).join('');
}

async function paintTabBody() {
  const box = el('hp-tabbody');
  if (!box) return;

  if (hs.tab === 'checkup') {
    box.innerHTML = `
      <div class="hp-years" id="hp-years"></div>
      <div id="hp-body"><div class="hp-loading">불러오는 중…</div></div>`;
    const list = checkups();
    if (!hs.examId || !list.some((e) => e.id === hs.examId)) hs.examId = list[0]?.id ?? null;
    paintYears();
    await paintDetail();
    return;
  }

  // 인바디·혈액 — 왼쪽에서 항목을 고르고 오른쪽에서 길게 본다
  box.innerHTML = `
    <div class="hl">
      <aside class="hl-side"><div class="hl-codes" id="hl-codes"></div></aside>
      <div class="hl-main">
        <div id="hl-trend"><div class="hp-loading">불러오는 중…</div></div>
        <div id="hl-exams"></div>
      </div>
    </div>`;
  paintLabSide();
  paintLabExams();
  await paintLabTrend();
}

function paintYears() {
  const box = el('hp-years');
  if (!box) return;
  const list = checkups();

  box.innerHTML = `
    <div class="hp-year-row" role="tablist" aria-label="검진 회차">
      ${list
        .map(
          (e) => `<button class="hp-year${e.id === hs.examId ? ' is-on' : ''}" type="button" role="tab"
                    aria-selected="${e.id === hs.examId}" data-exam="${e.id}">
            <span class="hp-year-n">${esc(yearOf(e.date))}</span>
            <span class="hp-year-d">${esc(ymd(e.date).slice(5))}</span>
            ${e.abnormal ? `<span class="hp-year-bad">${e.abnormal}</span>` : ''}
          </button>`
        )
        .join('')}
      <button class="hp-year is-add" type="button" id="hp-add-exam" title="검진 회차 추가">${ico('plus')}</button>
    </div>`;

  box.querySelectorAll('[data-exam]').forEach((b) =>
    b.addEventListener('click', async () => {
      hs.examId = Number(b.dataset.exam);
      paintYears();
      await paintDetail();
    })
  );
  el('hp-add-exam')?.addEventListener('click', () => openExamDialog('checkup'));
}

async function paintDetail() {
  const body = el('hp-body');
  if (!body) return;
  if (!hs.examId) {
    body.innerHTML = `
      <div class="hp-blank">
        <p>아직 담아 둔 검진이 없습니다.</p>
        <p class="faint">위의 <b>+</b> 를 눌러 회차를 만들고, 결과지의 숫자를 옮겨 적으면 그때부터 연도별로 이어집니다.</p>
      </div>`;
    return;
  }

  body.innerHTML = '<div class="hp-loading">불러오는 중…</div>';
  let d;
  try {
    d = await api(`/api/health/exams/${hs.examId}`);
  } catch (e) {
    body.innerHTML = `<p class="hp-empty">${esc(e.message)}</p>`;
    return;
  }
  hs.detail = d;

  const cols = d.columns || [];
  const head = cols.map((c, i) => `<th class="hp-v${i === 0 ? ' is-now' : ''}">${esc(ymd(c.date))}</th>`).join('');

  body.innerHTML = `
    ${summaryHtml(d)}
    ${watchHtml(d)}
    <div class="hp-groups">
      ${d.groups
        .map(
          (g) => `
        <section class="hp-group${hs.open.has(g.key) ? ' is-open' : ''}" data-group="${esc(g.key)}">
          <button class="hp-group-head" type="button" aria-expanded="${hs.open.has(g.key)}">
            <span class="hp-group-name">${esc(g.label)}</span>
            <span class="hp-group-hint">${esc(g.hint)}</span>
            ${countBadge(g)}
            <span class="hp-caret" aria-hidden="true">${ico('back')}</span>
          </button>
          <div class="hp-table-wrap">
            <table class="hp-table">
              <thead><tr><th class="hp-n">항목</th><th class="hp-r">참고범위</th>${head}</tr></thead>
              <tbody>${g.rows.map((r) => rowHtml(r, cols)).join('')}</tbody>
            </table>
          </div>
        </section>`
        )
        .join('')}
    </div>
    <p class="hp-disclaimer">
      이 화면은 검사값이 <b>참고범위 어디에 있는지</b>와 <b>전보다 어느 쪽으로 움직였는지</b>만 적습니다.
      해석과 판단은 진료로 받으세요.
    </p>`;

  body.querySelectorAll('.hp-group-head').forEach((btn) =>
    btn.addEventListener('click', () => {
      const sec = btn.closest('.hp-group');
      const key = sec.dataset.group;
      if (hs.open.has(key)) hs.open.delete(key);
      else hs.open.add(key);
      sec.classList.toggle('is-open', hs.open.has(key));
      btn.setAttribute('aria-expanded', String(hs.open.has(key)));
    })
  );
  body.querySelectorAll('[data-trend]').forEach((b) =>
    b.addEventListener('click', () => openTrend(b.dataset.trend))
  );
  el('hp-edit')?.addEventListener('click', () => openValueDialog(hs.examId));
  el('hp-del')?.addEventListener('click', () => removeExam(hs.examId));
}

const countBadge = (g) => {
  const bad = g.rows.filter((r) => r.flag === 'H' || r.flag === 'L').length;
  return bad
    ? `<span class="hp-group-bad">${bad}</span>`
    : `<span class="hp-group-n">${g.rows.length}</span>`;
};

function rowHtml(r, cols) {
  return `<tr class="${r.flag === 'H' || r.flag === 'L' ? 'is-off' : ''}">
    <th class="hp-n" scope="row">
      <button class="hp-name" type="button" data-trend="${esc(r.code)}" title="${esc(r.memo || r.nameEn || '')}">
        ${esc(r.name)}
      </button>
      <span class="hp-en">${esc(r.nameEn)}${r.unit ? ` <span class="hp-unit">(${esc(r.unit)})</span>` : ''}</span>
    </th>
    <td class="hp-r">${esc(refLabel(r))}</td>
    ${cols
      .map((c, i) => {
        const cell = r.cells[i];
        const txt = cellText(cell);
        if (i > 0) return `<td class="hp-v">${esc(txt)}</td>`;
        return `<td class="hp-v is-now">
          <span class="hp-val">${esc(txt)}</span>${flagPill(r.flag)}${deltaChip(r.delta, '')}
        </td>`;
      })
      .join('')}
  </tr>`;
}

function summaryHtml(d) {
  const at = (code) => {
    const g = d.groups.find((x) => x.rows.some((r) => r.code === code));
    return g ? g.rows.find((r) => r.code === code) : null;
  };
  const weight = at('weight');
  const bmi = at('bmi');
  const ageH = at('age_health');
  const ageR = at('age_real');

  const tile = (label, value, sub) =>
    `<div class="hp-tile"><span class="hp-tile-l">${esc(label)}</span>
       <strong class="hp-tile-v">${esc(value)}</strong>
       <span class="hp-tile-s">${esc(sub || '')}</span></div>`;

  return `
    <div class="hp-sum">
      <div class="hp-sum-head">
        <div>
          <h2 class="hp-sum-title">${esc(d.exam.title || `${yearOf(d.exam.date)}년 ${d.exam.kindLabel}`)}</h2>
          <p class="hp-sum-sub">${esc(ymd(d.exam.date))}${d.exam.provider ? ` · ${esc(d.exam.provider)}` : ''}</p>
        </div>
        <div class="hp-sum-act">
          <button class="btn-secondary btn-sm" type="button" id="hp-edit">값 넣고 고치기</button>
          <button class="btn-text btn-sm" type="button" id="hp-del">회차 삭제</button>
        </div>
      </div>
      ${d.exam.memo ? `<p class="hp-sum-memo">${esc(d.exam.memo)}</p>` : ''}
      <div class="hp-tiles">
        ${tile('담긴 항목', `${d.summary.total}`, `판정 가능 ${d.summary.judged}`)}
        ${tile('범위를 벗어남', `${d.summary.abnormal}`, d.summary.abnormal ? '아래 지켜볼 항목' : '모두 범위 안')}
        ${weight ? tile('체중', `${cellText(weight.cells[0])} kg`, bmi ? `BMI ${cellText(bmi.cells[0])}` : '') : ''}
        ${ageH ? tile('건강나이', `${cellText(ageH.cells[0])} 세`, ageR ? `실제 ${cellText(ageR.cells[0])} 세` : '') : ''}
      </div>
    </div>`;
}

function watchHtml(d) {
  if (!d.watch.length) {
    return `<div class="hp-watch is-clear">${ico('star')} <span>이번 회차에서 참고범위를 벗어난 항목이 없습니다.</span></div>`;
  }
  return `
    <div class="hp-watch">
      <h3 class="hp-watch-title">지켜볼 항목 <span>${d.watch.length}</span></h3>
      <ul class="hp-watch-list">
        ${d.watch
          .map(
            (w) => `<li class="hp-watch-item">
              <button class="hp-name" type="button" data-trend="${esc(w.code)}">${esc(w.name)}</button>
              <span class="hp-watch-cat">${esc(w.categoryLabel)}</span>
              <span class="hp-watch-v">${esc(cellText(w.cells[0]))}${esc(w.unit ? ` ${w.unit}` : '')}</span>
              ${flagPill(w.flag)}
              <span class="hp-watch-ref">기준 ${esc(w.refText || '-')}</span>
              ${deltaChip(w.delta, '')}
            </li>`
          )
          .join('')}
      </ul>
    </div>`;
}

// ══════════════════════════════════════════════════════════════
// 인바디 · 혈액 탭 — 수시 측정
// ══════════════════════════════════════════════════════════════

/** 지금 탭에서 고른 항목. 탭마다 따로 기억한다. */
const curCode = () => hs.labCode[hs.tab];

function paintLabSide() {
  const box = el('hl-codes');
  if (!box) return;

  const list = hs.metrics.filter((m) => m.labGroup === hs.tab);
  if (list.length && !list.some((m) => m.code === curCode())) {
    hs.labCode[hs.tab] = list[0].code;
  }

  const byCat = new Map();
  for (const m of list) {
    if (!byCat.has(m.category)) byCat.set(m.category, []);
    byCat.get(m.category).push(m);
  }

  box.innerHTML = [...byCat.entries()]
    .map(([cat, items]) => {
      const label = hs.categories.find((c) => c.key === cat)?.label || cat;
      return `<div class="hl-cat"><h4>${esc(label)}</h4><ul>${items
        .map(
          (m) => `<li><button class="hl-code${m.code === curCode() ? ' is-on' : ''}" type="button" data-code="${esc(m.code)}">
            <span>${esc(m.name)}</span>${m.unit ? `<em>${esc(m.unit)}</em>` : ''}
          </button></li>`
        )
        .join('')}</ul></div>`;
    })
    .join('');

  box.querySelectorAll('[data-code]').forEach((b) =>
    b.addEventListener('click', async () => {
      hs.labCode[hs.tab] = b.dataset.code;
      paintLabSide();
      await paintLabTrend();
    })
  );
}

async function paintLabTrend() {
  const box = el('hl-trend');
  const code = curCode();
  if (!box || !code) return;
  box.innerHTML = '<div class="hp-loading">불러오는 중…</div>';
  let r;
  try {
    r = await api(`/api/health/trend?code=${encodeURIComponent(code)}`);
  } catch (e) {
    box.innerHTML = `<p class="hp-empty">${esc(e.message)}</p>`;
    return;
  }
  const s = r.series[0];
  if (!s) {
    const m = hs.metricMap.get(code);
    box.innerHTML = `<div class="hp-blank"><p>${esc(m?.name || code)} 는 아직 잰 기록이 없습니다.</p>
      <p class="faint">아래 <b>측정 기록</b>에서 회차를 만들고 값을 넣으면 여기에 선이 그려집니다.</p></div>`;
    return;
  }
  box.innerHTML = trendCardHtml(s);
}

function trendCardHtml(s) {
  const pts = [...s.points].reverse();

  // 가장 최근 회차가 쓴 기준을 적는다. 회차마다 기준이 달랐다면 그 사실도 적는다 —
  // 말없이 하나만 보여 주면 옛 값의 판정이 틀린 것처럼 읽힌다.
  const refs = [...new Set(s.points.map((p) => p.refText || '').filter(Boolean))];
  const refNow = pts[0]?.refText || s.refText || '';
  const mixed = refs.length > 1;

  return `
    <div class="hp-trend-card">
      <div class="hp-trend-head">
        <div>
          <h2 class="hp-trend-title">${esc(s.name)}${s.unit ? ` <span class="hp-unit">(${esc(s.unit)})</span>` : ''}</h2>
          <p class="hp-trend-sub">${esc(s.nameEn)}${refNow ? ` · 참고범위 ${esc(refNow)}` : ''}${
            mixed ? ' <span class="hp-refnote">검사실마다 기준이 달라, 띠와 판정은 회차별 기준을 따릅니다</span>' : ''
          }</p>
        </div>
        <span class="hp-trend-n">${s.points.length}회</span>
      </div>
      ${s.memo ? `<p class="hp-trend-memo">${esc(s.memo)}</p>` : ''}
      ${chartSvg(s)}
      <table class="hp-table hp-trend-table">
        <thead><tr><th>측정일</th><th>종류</th><th>값</th>${mixed ? '<th>그때 기준</th>' : ''}<th>판정</th><th>직전 대비</th></tr></thead>
        <tbody>
          ${pts
            .map((p, i) => {
              const before = pts[i + 1];
              const d = before ? deltaOfClient(p.num, before.num, s.direction) : null;
              return `<tr class="${p.flag === 'H' || p.flag === 'L' ? 'is-off' : ''}">
                <td>${esc(ymd(p.date))}</td>
                <td class="faint">${esc(p.kindLabel)}</td>
                <td class="hp-val">${esc(p.num !== null ? num(p.num) : p.text)}</td>
                ${mixed ? `<td class="hp-r">${esc(p.refText || '-')}</td>` : ''}
                <td>${flagPill(p.flag) || '<span class="faint">-</span>'}</td>
                <td>${deltaChip(d, '') || '<span class="faint">-</span>'}</td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>`;
}

/** 서버의 deltaOf 와 같은 셈. 트렌드 표는 '직전 대비'를 화면에서 계산한다. */
function deltaOfClient(v, prev, direction) {
  if (v === null || prev === null || v === undefined || prev === undefined) return null;
  const diff = Math.round((v - prev) * 1000) / 1000;
  if (diff === 0) return { diff: 0, dir: 'flat', good: null };
  const dir = diff > 0 ? 'up' : 'down';
  const good = direction === 'low' ? diff < 0 : direction === 'high' ? diff > 0 : null;
  return { diff, dir, good };
}

function paintLabExams() {
  const box = el('hl-exams');
  if (!box) return;
  // 이 탭의 기록만 싣는다 — 인바디 탭에서 피검사 줄을 헤칠 이유가 없다.
  const list = examsOf(hs.tab);
  const what = hs.tab === 'inbody' ? '인바디' : '피검사';
  box.innerHTML = `
    <div class="hl-exams">
      <div class="hl-exams-head">
        <h3>${esc(what)} 기록</h3>
        <button class="btn-secondary btn-sm" type="button" id="hl-add">기록 추가</button>
      </div>
      ${
        list.length
          ? `<ul class="hl-exam-list">${list
              .map(
                (e) => `<li class="hl-exam">
                  <span class="hl-exam-date">${esc(ymd(e.date))}</span>
                  <span class="hl-exam-title">${esc(e.title || e.provider || '')}</span>
                  <span class="hl-exam-n">${e.count}항목</span>
                  ${e.abnormal ? `<span class="hp-flag is-hi">${e.abnormal}</span>` : ''}
                  <button class="btn-text btn-sm" type="button" data-edit="${e.id}">값</button>
                  <button class="btn-text btn-sm" type="button" data-del="${e.id}">삭제</button>
                </li>`
              )
              .join('')}</ul>`
          : `<p class="hp-empty">아직 ${esc(what)} 기록이 없습니다. 결과지를 받으면 <b>기록 추가</b>로 한 줄 만들어 두세요.</p>`
      }
    </div>`;

  el('hl-add')?.addEventListener('click', () => openExamDialog(hs.tab));
  box.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openValueDialog(Number(b.dataset.edit))));
  box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => removeExam(Number(b.dataset.del))));
}

// ══════════════════════════════════════════════════════════════
// 묻는 창 — 전부 <dialog> 다
// ══════════════════════════════════════════════════════════════
//
// window.prompt/confirm 은 PWA 로 설치해 홈 화면에서 띄운 창이나 앱 안 브라우저
// (카카오·슬랙)에서 **조용히 무시된다.** 물어봤다고 생각했는데 아무 일도 일어나지
// 않는다 — 메모·북마크가 같은 이유로 먼저 <dialog> 로 옮겼다.

// 화면을 떠나면 열려 있던 창은 걷는다. <dialog> 는 본문(page) 이 아니라 body 에
// 붙어 있어서, 라우터가 본문을 갈아끼워도 **혼자 남는다** — 다른 화면 위에 남의
// 검사표가 덮여 있는 꼴이 된다(오른쪽 프레임을 닫는 것과 같은 이유다).
window.addEventListener('hashchange', () => {
  document.querySelectorAll('dialog.hp-dialog[open]').forEach((d) => d.close());
});

function dialog(html, onMount) {
  const d = document.createElement('dialog');
  d.className = 'hp-dialog';
  d.innerHTML = html;
  document.body.appendChild(d);
  d.addEventListener('close', () => d.remove());
  d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => d.close()));
  d.showModal();
  onMount?.(d);
  return d;
}

/** 회차 만들기 — 날짜와 종류만 받는다. 값은 그 다음 창에서 넣는다. */
function openExamDialog(defaultKind) {
  const today = new Date().toISOString().slice(0, 10);
  dialog(
    `<form method="dialog" class="hp-form">
      <h2 class="modal-title">기록 추가</h2>
      <p class="modal-lead">날짜와 종류만 먼저 정합니다. 값은 만든 뒤에 넣습니다.</p>
      <label class="field"><span class="field-label">날짜</span>
        <input type="date" name="date" value="${today}" required></label>
      <label class="field"><span class="field-label">종류</span>
        <select name="kind">
          ${hs.kinds.map((k) => `<option value="${esc(k.key)}"${k.key === defaultKind ? ' selected' : ''}>${esc(k.label)}</option>`).join('')}
        </select></label>
      <label class="field"><span class="field-label">검사기관</span>
        <input type="text" name="provider" placeholder="강북삼성병원 종합건진센터"></label>
      <label class="field"><span class="field-label">제목</span>
        <input type="text" name="title" placeholder="2025년 종합건강검진"></label>
      <label class="field"><span class="field-label">메모</span>
        <textarea name="memo" rows="2" placeholder="종합소견에 적힌 한두 줄"></textarea></label>
      <p class="form-error" data-err hidden></p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" data-close>취소</button>
        <button type="submit" class="btn-primary">만들기</button>
      </div>
    </form>`,
    (d) => {
      d.querySelector('form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const f = new FormData(ev.target);
        try {
          const r = await api('/api/health/exams', {
            method: 'POST',
            body: {
              date: f.get('date'),
              kind: f.get('kind'),
              provider: f.get('provider'),
              title: f.get('title'),
              memo: f.get('memo'),
            },
          });
          d.close();
          await loadOverview(true);
          if (hs.tab === 'checkup') {
            hs.examId = r.id;
            paintYears();
            await paintDetail();
          } else {
            paintLabExams();
          }
          openValueDialog(r.id);
        } catch (e) {
          const p = d.querySelector('[data-err]');
          p.textContent = e.message;
          p.hidden = false;
        }
      });
    }
  );
}

/**
 * 값 넣기 — 한 회차의 항목을 **한 창에서 전부** 받는다.
 *
 * 항목마다 창을 여닫게 하면 검진 한 회차(백 개가 넘는다)를 넣다가 그만둔다.
 * 비워 둔 칸은 담지 않고, 이미 있던 값을 지우면 그 줄이 지워진다.
 */
async function openValueDialog(examId) {
  let d;
  try {
    d = await api(`/api/health/exams/${examId}`);
  } catch (e) {
    toast(e.message);
    return;
  }
  const have = new Map();
  for (const g of d.groups) for (const r of g.rows) have.set(r.code, r.cells[0]);

  // 인바디·혈액 회차에서는 **그 결과지에 실제로 찍혀 나오는 항목**만 먼저 권한다.
  // 검진 전용 항목(내시경·청력)까지 늘어놓으면 스무 칸 채우려고 백오십 칸을 지난다.
  // 다만 결과지가 늘 같지는 않으므로, 나머지는 접어서 아래에 둔다 — 감추지는 않는다.
  const kind = d.exam.kind;
  const inPanel = (m) => m.labGroup === kind || have.has(m.code);
  const pool = kind === 'checkup' ? hs.metrics : hs.metrics.filter(inPanel);
  const rest = kind === 'checkup' ? [] : hs.metrics.filter((m) => !inPanel(m));

  const fieldHtml = (m) => {
    const cur = have.get(m.code);
    const v = cur && cur.num !== null && cur.num !== undefined ? num(cur.num) : '';
    const t = cur ? cur.text || '' : '';
    return `<label class="hp-in">
      <span class="hp-in-l">${esc(m.name)}${m.unit ? ` <em>${esc(m.unit)}</em>` : ''}</span>
      ${
        m.valueType === 'num'
          ? `<input type="text" inputmode="decimal" data-code="${esc(m.code)}" data-f="num" value="${esc(v)}" placeholder="${esc(m.refText || '')}">`
          : `<input type="text" data-code="${esc(m.code)}" data-f="text" value="${esc(t)}" placeholder="${esc(m.refText || '정상 · 음성 …')}">`
      }
    </label>`;
  };

  const groupHtml = (list) => {
    const byCat = new Map();
    for (const m of list) {
      if (!byCat.has(m.category)) byCat.set(m.category, []);
      byCat.get(m.category).push(m);
    }
    return [...byCat.entries()]
      .map(([cat, items]) => {
        const c = hs.categories.find((x) => x.key === cat);
        return `<fieldset class="hp-fs">
          <legend>${esc(c?.label || cat)}</legend>
          <div class="hp-fs-grid">${items.map(fieldHtml).join('')}</div>
        </fieldset>`;
      })
      .join('');
  };

  const catHtml = groupHtml(pool);
  const restHtml = rest.length
    ? `<details class="hp-more">
         <summary>결과지에 다른 항목이 더 있나요? — 나머지 ${rest.length}개 펼치기</summary>
         ${groupHtml(rest)}
       </details>`
    : '';

  dialog(
    `<form method="dialog" class="hp-form hp-form-wide">
      <h2 class="modal-title">${esc(ymd(d.exam.date))} ${esc(d.exam.kindLabel)} — 값 넣기</h2>
      <p class="modal-lead">결과지에 적힌 숫자를 그대로 옮겨 적습니다. 빈칸은 담지 않고, 있던 값을 지우면 그 줄이 사라집니다.</p>
      <div class="hp-form-body">${catHtml}${restHtml}</div>
      <p class="form-error" data-err hidden></p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" data-close>닫기</button>
        <button type="submit" class="btn-primary">저장</button>
      </div>
    </form>`,
    (dlg) => {
      dlg.querySelector('form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const rows = [];
        dlg.querySelectorAll('[data-code]').forEach((inp) => {
          const code = inp.dataset.code;
          const raw = inp.value.trim();
          const was = have.get(code);
          const had = !!was && (was.num !== null || !!was.text);
          if (!raw && !had) return;              // 처음부터 없던 칸은 건드리지 않는다
          if (inp.dataset.f === 'num') {
            const n = raw === '' ? null : Number(raw.replace(/[^\d.\-]/g, ''));
            rows.push({ code, num: Number.isFinite(n) ? n : null, text: Number.isFinite(n) ? '' : raw });
          } else {
            rows.push({ code, num: null, text: raw });
          }
        });
        if (!rows.length) {
          dlg.close();
          return;
        }
        try {
          const r = await api(`/api/health/exams/${examId}/results`, { method: 'PUT', body: { results: rows } });
          dlg.close();
          toast(`${r.saved}항목 저장${r.removed ? ` · ${r.removed}항목 삭제` : ''}`);
          await loadOverview(true);
          if (hs.tab === 'checkup') {
            paintYears();
            await paintDetail();
          } else {
            paintLabExams();
            await paintLabTrend();
          }
        } catch (e) {
          const p = dlg.querySelector('[data-err]');
          p.textContent = e.message;
          p.hidden = false;
        }
      });
    }
  );
}

/** 한 항목의 전 기간을 큰 창으로. 표의 항목 이름을 누르면 여기로 온다. */
async function openTrend(code) {
  let r;
  try {
    r = await api(`/api/health/trend?code=${encodeURIComponent(code)}`);
  } catch (e) {
    toast(e.message);
    return;
  }
  const s = r.series[0];
  if (!s) {
    toast('이 항목은 아직 기록이 하나뿐입니다.');
    return;
  }
  dialog(
    `<div class="hp-form hp-form-wide">
      ${trendCardHtml(s)}
      <div class="modal-actions"><button type="button" class="btn-primary" data-close>닫기</button></div>
    </div>`
  );
}

async function removeExam(id) {
  const e = hs.exams.find((x) => x.id === id);
  dialog(
    `<form method="dialog" class="hp-form">
      <h2 class="modal-title">회차를 지울까요?</h2>
      <p class="modal-lead">${esc(e ? `${ymd(e.date)} ${e.kindLabel}` : '')} 의 값 ${e ? e.count : 0}개가 함께 사라집니다. 되돌릴 수 없습니다.</p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" data-close>그대로 둔다</button>
        <button type="submit" class="btn-primary is-danger">지운다</button>
      </div>
    </form>`,
    (d) => {
      d.querySelector('form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try {
          await api(`/api/health/exams/${id}`, { method: 'DELETE' });
          d.close();
          toast('지웠습니다.');
          await loadOverview(true);
          if (hs.tab === 'checkup') {
            const list = checkups();
            hs.examId = list[0]?.id ?? null;
            paintYears();
            await paintDetail();
          } else {
            paintLabExams();
            await paintLabTrend();
          }
        } catch (err) {
          toast(err.message);
        }
      });
    }
  );
}
