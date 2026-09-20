// 헬스정보 — 건강검진 · 인바디 · 혈액검사를 **검사항목별로 한 줄에 세우는** 자리.
//
// 이 파일이 하는 일은 하나다. 흩어진 결과지의 숫자를 `code` 하나로 모아,
// "이 검사가 지난 몇 해 동안 어느 쪽으로 움직였나"를 돌려준다.
//
// ── 왜 값과 이름표를 나눴나 ────────────────────────────────────────────
// 결과지는 해마다 글자가 흔들린다(ALT · SGPT · 혈청지피티). 단위도 흔들린다
// (지단백(a)은 2022년 mg/dL, 2023년부터 nmol/L). 값 쪽에 이름을 적어 두면
// 10년치를 나란히 세울 수 없다 — 그래서 값에는 code 만 적고, 이름·단위·
// 참고범위·좋은 방향은 health_metrics(이름표)가 갖는다. migrations/010 참고.
//
// ── 판단하지 않는다 ────────────────────────────────────────────────────
// 여기서 계산하는 것은 **참고범위 대비 위치**(높음·낮음·정상)와 **전보다
// 좋아졌는지 나빠졌는지**까지다. 진단은 하지 않는다. 화면도 그렇게 적는다.

const nowIso = () => new Date().toISOString();

/**
 * 분류 — 결과지가 묶어 놓은 차례 그대로다.
 *
 * 검진 책은 이미 사람이 읽기 좋게 묶여 있다(소화기 → 만성질환 → 신체계측 → …).
 * 그것을 무시하고 우리 식으로 다시 묶으면, 종이와 화면을 번갈아 볼 때마다
 * 같은 항목을 두 군데서 찾아야 한다. 그래서 **책의 묶음을 그대로 옮긴다.**
 * hint 는 "이 묶음이 무엇을 보는 것인가"를 한 줄로 적은 것이다.
 */
export const CATEGORIES = [
  { key: 'body',        label: '신체계측',      hint: '키 · 몸무게 · 허리둘레' },
  { key: 'composition', label: '체성분',        hint: '근육과 지방이 몇 kg인가 (인바디)' },
  { key: 'bp',          label: '혈압 · 심장',   hint: '혈압 · 맥박 · 심전도' },
  { key: 'lipid',       label: '지질 · 혈관',   hint: '콜레스테롤과 동맥이 굳은 정도' },
  { key: 'sugar',       label: '당뇨 · 내분비', hint: '혈당 · 당화혈색소 · 갑상선' },
  { key: 'liver',       label: '간 · 간염',     hint: '간 효소와 간염 항체' },
  { key: 'kidney',      label: '신장 · 소변',   hint: '콩팥이 거르는 힘과 소변 검사' },
  { key: 'blood',       label: '혈액',          hint: '적혈구 · 백혈구 · 혈소판 · 철분' },
  { key: 'mineral',     label: '요산 · 전해질', hint: '통풍과 미네랄 균형' },
  { key: 'inflam',      label: '염증 · 면역',   hint: '류마티스 · 매독 선별' },
  { key: 'hormone',     label: '호르몬',        hint: '성호르몬' },
  { key: 'bone',        label: '뼈 · 비타민D',  hint: '골밀도와 비타민 D' },
  { key: 'lung',        label: '호흡기',        hint: '흉부 X선 · 폐활량 · 흡연' },
  { key: 'cancer',      label: '암 검사',       hint: '내시경 · 종양표지자' },
  { key: 'senses',      label: '눈 · 귀 · 치아', hint: '시력 · 안압 · 청력 · 치과' },
  { key: 'stress',      label: '스트레스 · 건강나이', hint: '자율신경과 건강나이' },
];

const CATEGORY_ORDER = new Map(CATEGORIES.map((c, i) => [c.key, i]));

/** 검진·측정의 종류. 화면 두 곳이 이 값으로 갈린다. */
export const KINDS = [
  { key: 'checkup', label: '종합검진' },
  { key: 'inbody',  label: '인바디' },
  { key: 'blood',   label: '혈액검사' },
];
const KIND_LABEL = new Map(KINDS.map((k) => [k.key, k.label]));
const isKind = (k) => KIND_LABEL.has(String(k || ''));

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
const fail = (error, status = 400) => json({ error }, status);

// ──────────────────────────────────────────────────────────────
// 판정 — 참고범위 대비 어디에 있나
// ──────────────────────────────────────────────────────────────

/**
 * 'H' 높음 · 'L' 낮음 · 'N' 정상 · '' 판정할 수 없음.
 *
 * 숫자가 없거나(글자 결과) 참고범위가 없으면 **아무 말도 하지 않는다.** 모르는 것을
 * '정상'이라고 적으면, 화면의 '정상' 개수가 거짓이 된다.
 */
export function flagOf(num, low, high) {
  if (num === null || num === undefined || Number.isNaN(num)) return '';
  if (low === null && high === null) return '';
  if (high !== null && high !== undefined && num > high) return 'H';
  if (low !== null && low !== undefined && num < low) return 'L';
  return 'N';
}

/**
 * 전보다 좋아졌나. 'up'·'down' 은 **수치의 방향**, good 은 **몸에 좋은 방향인가**.
 * 두 가지를 따로 돌려주는 이유 — 화살표는 수치를 따르고, 색은 좋고 나쁨을 따른다.
 * (콜레스테롤이 내려간 것은 ↓ 인데 초록이어야 한다.)
 */
export function deltaOf(num, prev, direction) {
  if (num === null || prev === null || num === undefined || prev === undefined) return null;
  const diff = Math.round((num - prev) * 1000) / 1000;
  if (diff === 0) return { diff: 0, dir: 'flat', good: null };
  const dir = diff > 0 ? 'up' : 'down';
  let good = null;
  if (direction === 'low') good = diff < 0;
  else if (direction === 'high') good = diff > 0;
  return { diff, dir, good };
}

/** 값에 적힌 참고범위가 있으면 그것이 이긴다(그 해 결과지가 실제로 적어 준 것). */
const refOf = (row) => ({
  low: row.ref_low !== null && row.ref_low !== undefined ? row.ref_low : row.m_ref_low,
  high: row.ref_high !== null && row.ref_high !== undefined ? row.ref_high : row.m_ref_high,
  text: row.ref_text || row.m_ref_text || '',
});

/** 화면에 적는 값 한 덩어리. 글자 결과(정상·음성)는 숫자 자리에 글자를 세운다. */
function shape(row) {
  const ref = refOf(row);
  const num = row.value_num === null || row.value_num === undefined ? null : Number(row.value_num);
  return {
    code: row.code,
    num,
    text: row.value_text || '',
    unit: row.unit || row.m_unit || '',
    refLow: ref.low ?? null,
    refHigh: ref.high ?? null,
    refText: ref.text,
    flag: flagOf(num, ref.low ?? null, ref.high ?? null),
    note: row.note || '',
  };
}

// ──────────────────────────────────────────────────────────────
// 읽기
// ──────────────────────────────────────────────────────────────

const METRIC_COLS = `
  m.code, m.name_ko, m.name_en, m.unit AS m_unit, m.category, m.sort_order,
  m.ref_low AS m_ref_low, m.ref_high AS m_ref_high, m.ref_text AS m_ref_text,
  m.direction, m.value_type, m.lab_group, m.memo AS m_memo`;

/** 항목 이름표 전부. 화면이 분류·단위·참고범위를 그릴 때 쓴다. */
export async function listMetrics(env) {
  const { results } = await env.DB.prepare(
    `SELECT ${METRIC_COLS} FROM health_metrics m ORDER BY m.category, m.sort_order`
  ).all();
  return (results || []).map((m) => ({
    code: m.code,
    name: m.name_ko,
    nameEn: m.name_en || '',
    unit: m.m_unit || '',
    category: m.category,
    sort: m.sort_order,
    refLow: m.m_ref_low ?? null,
    refHigh: m.m_ref_high ?? null,
    refText: m.m_ref_text || '',
    direction: m.direction,
    valueType: m.value_type,
    labGroup: m.lab_group || null,
    memo: m.m_memo || '',
  }));
}

/** 검진·측정 목록. 그 회차에 몇 항목이 있고 몇 개가 범위를 벗어났는지까지 센다. */
export async function listExams(env, userId, kinds) {
  const ks = (kinds && kinds.length ? kinds : ['checkup', 'inbody', 'blood']).filter(isKind);
  if (!ks.length) return [];
  const holes = ks.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT e.id, e.exam_date, e.kind, e.provider, e.title, e.memo,
            (SELECT COUNT(*) FROM health_results r WHERE r.exam_id = e.id) AS n
       FROM health_exams e
      WHERE e.user_id = ? AND e.kind IN (${holes})
      ORDER BY e.exam_date DESC, e.id DESC`
  ).bind(userId, ...ks).all();

  return (results || []).map((e) => ({
    id: e.id,
    date: e.exam_date,
    kind: e.kind,
    kindLabel: KIND_LABEL.get(e.kind) || e.kind,
    provider: e.provider || '',
    title: e.title || '',
    memo: e.memo || '',
    count: e.n || 0,
  }));
}

/** 그 회차의 벗어난 항목 수. 목록의 뱃지에 쓴다(전부 세면 질의가 무거워 한 번에 센다). */
async function abnormalCounts(env, userId) {
  const { results } = await env.DB.prepare(
    `SELECT r.exam_id, r.value_num,
            COALESCE(r.ref_low,  m.ref_low)  AS lo,
            COALESCE(r.ref_high, m.ref_high) AS hi
       FROM health_results r
       JOIN health_metrics m ON m.code = r.code
      WHERE r.user_id = ? AND r.value_num IS NOT NULL`
  ).bind(userId).all();

  const out = new Map();
  for (const r of results || []) {
    const f = flagOf(Number(r.value_num), r.lo ?? null, r.hi ?? null);
    if (f === 'H' || f === 'L') out.set(r.exam_id, (out.get(r.exam_id) || 0) + 1);
  }
  return out;
}

/**
 * 화면이 처음 부르는 곳 — 분류표 · 이름표 · 회차 목록을 한 번에 준다.
 * 화면이 뜰 때마다 세 번 왕복하지 않게 묶어 둔다(느린 망에서 그 차이가 크다).
 */
export async function healthOverview(env, userId, url) {
  const kinds = String(url.searchParams.get('kind') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const [exams, metrics, bad] = await Promise.all([
    listExams(env, userId, kinds),
    listMetrics(env),
    abnormalCounts(env, userId),
  ]);
  for (const e of exams) e.abnormal = bad.get(e.id) || 0;
  return { categories: CATEGORIES, kinds: KINDS, metrics, exams };
}

/**
 * 검진 한 회차 — **결과지와 같은 모양**으로 돌려준다.
 *
 *   항목 | 참고범위 | 이번 | 지난번 | 그 전
 *
 * 병원 결과지가 이미 이 모양이다. 화면이 다른 모양이면 종이와 대조할 때마다
 * 눈이 두 번 일한다. 비교 열은 **같은 종류(kind)의 바로 앞 회차** 둘이다.
 */
export async function examDetail(env, userId, id) {
  const exam = await env.DB.prepare(
    `SELECT id, exam_date, kind, provider, title, memo FROM health_exams WHERE id = ? AND user_id = ?`
  ).bind(id, userId).first();
  if (!exam) return null;

  const { results: siblings } = await env.DB.prepare(
    `SELECT id, exam_date FROM health_exams
      WHERE user_id = ? AND kind = ? AND exam_date < ?
      ORDER BY exam_date DESC LIMIT 2`
  ).bind(userId, exam.kind, exam.exam_date).all();

  const cols = [{ id: exam.id, date: exam.exam_date }, ...(siblings || []).map((s) => ({ id: s.id, date: s.exam_date }))];
  const holes = cols.map(() => '?').join(',');

  const { results: rows } = await env.DB.prepare(
    `SELECT r.exam_id, r.code, r.value_num, r.value_text, r.unit, r.ref_low, r.ref_high, r.ref_text, r.note,
            ${METRIC_COLS}
       FROM health_results r
       JOIN health_metrics m ON m.code = r.code
      WHERE r.user_id = ? AND r.exam_id IN (${holes})`
  ).bind(userId, ...cols.map((c) => c.id)).all();

  // code → { meta, byExam }
  const byCode = new Map();
  for (const row of rows || []) {
    let slot = byCode.get(row.code);
    if (!slot) {
      slot = {
        code: row.code,
        name: row.name_ko,
        nameEn: row.name_en || '',
        unit: row.m_unit || '',
        category: row.category,
        sort: row.sort_order,
        direction: row.direction,
        valueType: row.value_type,
        memo: row.m_memo || '',
        values: {},
      };
      byCode.set(row.code, slot);
    }
    slot.values[row.exam_id] = shape(row);
  }

  // 이번 회차에 값이 없는 항목은 싣지 않는다 — 안 한 검사를 빈칸으로 늘어놓으면
  // 표만 길어지고 읽히지 않는다(무엇을 안 했는지는 회차 메모에 적는다).
  const groups = [];
  for (const cat of CATEGORIES) {
    const rowsOfCat = [...byCode.values()]
      .filter((s) => s.category === cat.key && s.values[exam.id])
      .sort((a, b) => a.sort - b.sort);
    if (!rowsOfCat.length) continue;

    groups.push({
      ...cat,
      rows: rowsOfCat.map((s) => {
        const cur = s.values[exam.id];
        const prev = cols[1] ? s.values[cols[1].id] || null : null;
        return {
          code: s.code,
          name: s.name,
          nameEn: s.nameEn,
          unit: cur.unit || s.unit,
          direction: s.direction,
          valueType: s.valueType,
          memo: s.memo,
          refLow: cur.refLow,
          refHigh: cur.refHigh,
          refText: cur.refText,
          flag: cur.flag,
          delta: prev ? deltaOf(cur.num, prev.num, s.direction) : null,
          cells: cols.map((c) => {
            const v = s.values[c.id];
            return v ? { date: c.date, num: v.num, text: v.text, flag: v.flag } : { date: c.date, num: null, text: '', flag: '' };
          }),
        };
      }),
    });
  }
  groups.sort((a, b) => (CATEGORY_ORDER.get(a.key) ?? 99) - (CATEGORY_ORDER.get(b.key) ?? 99));

  // 요약 — 이번 회차에서 범위를 벗어난 것만 모은다. 화면 맨 위에 세운다.
  const watch = [];
  for (const g of groups) {
    for (const r of g.rows) {
      if (r.flag === 'H' || r.flag === 'L') {
        watch.push({ code: r.code, name: r.name, category: g.key, categoryLabel: g.label, flag: r.flag, cells: r.cells, unit: r.unit, refText: r.refText, delta: r.delta });
      }
    }
  }

  const counted = groups.reduce((n, g) => n + g.rows.filter((r) => r.flag).length, 0);

  return {
    exam: {
      id: exam.id,
      date: exam.exam_date,
      kind: exam.kind,
      kindLabel: KIND_LABEL.get(exam.kind) || exam.kind,
      provider: exam.provider || '',
      title: exam.title || '',
      memo: exam.memo || '',
    },
    columns: cols,
    groups,
    watch,
    summary: { total: groups.reduce((n, g) => n + g.rows.length, 0), judged: counted, abnormal: watch.length },
  };
}

/**
 * 한 항목의 **전 기간**. 종류를 가리지 않는다 — 연 1회 검진에서 잰 혈당과
 * 수시로 잰 혈당은 같은 선 위에 있어야 한다. 그것이 이 기능의 전부다.
 */
export async function trend(env, userId, codes) {
  const list = codes.filter(Boolean).slice(0, 8);
  if (!list.length) return { series: [] };
  const holes = list.map(() => '?').join(',');

  const { results } = await env.DB.prepare(
    `SELECT r.code, r.value_num, r.value_text, r.unit, r.ref_low, r.ref_high, r.ref_text,
            e.id AS exam_id, e.exam_date, e.kind, e.provider,
            ${METRIC_COLS}
       FROM health_results r
       JOIN health_exams   e ON e.id   = r.exam_id
       JOIN health_metrics m ON m.code = r.code
      WHERE r.user_id = ? AND r.code IN (${holes})
      ORDER BY e.exam_date ASC`
  ).bind(userId, ...list).all();

  const byCode = new Map();
  for (const row of results || []) {
    let s = byCode.get(row.code);
    if (!s) {
      s = {
        code: row.code,
        name: row.name_ko,
        nameEn: row.name_en || '',
        unit: row.m_unit || '',
        category: row.category,
        direction: row.direction,
        valueType: row.value_type,
        refLow: row.m_ref_low ?? null,
        refHigh: row.m_ref_high ?? null,
        refText: row.m_ref_text || '',
        memo: row.m_memo || '',
        points: [],
      };
      byCode.set(row.code, s);
    }
    const v = shape(row);
    s.points.push({
      examId: row.exam_id,
      date: row.exam_date,
      kind: row.kind,
      kindLabel: KIND_LABEL.get(row.kind) || row.kind,
      provider: row.provider || '',
      num: v.num,
      text: v.text,
      flag: v.flag,
      // 그 회차에 실제로 쓴 참고범위. 검사실마다 다르므로 **점마다** 딸려 보낸다 —
      // 이름표의 범위 하나로 띠를 깔면, 띠 안에 있는 점이 '낮음'으로 찍히는
      // 모순이 화면에 그대로 뜬다(요산: 강북삼성 2.8~8.2 · GC Labs 3.4~7.0).
      refLow: v.refLow,
      refHigh: v.refHigh,
      refText: v.refText,
    });
  }

  // 부른 차례대로 돌려준다(화면이 고른 순서를 지킨다).
  return { series: list.map((c) => byCode.get(c)).filter(Boolean) };
}

// ──────────────────────────────────────────────────────────────
// 쓰기
// ──────────────────────────────────────────────────────────────

const str = (v, max = 400) => String(v ?? '').trim().slice(0, max);
const numOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function createExam(request, env, userId) {
  const body = await request.json().catch(() => ({}));
  const date = str(body.date, 10);
  if (!DATE_RE.test(date)) return fail('날짜를 YYYY-MM-DD 로 적어주세요.');
  const kind = isKind(body.kind) ? body.kind : 'checkup';

  const ts = nowIso();
  try {
    const r = await env.DB.prepare(
      `INSERT INTO health_exams (user_id, exam_date, kind, provider, title, memo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(userId, date, kind, str(body.provider, 120), str(body.title, 160), str(body.memo, 2000), ts, ts).run();
    return json({ ok: true, id: r.meta?.last_row_id });
  } catch (e) {
    // (user_id, kind, exam_date) 가 유일하다 — 같은 날 같은 종류를 두 번 만들지 않는다.
    if (String(e?.message || '').includes('UNIQUE')) {
      return fail('그 날짜에 같은 종류의 기록이 이미 있습니다.', 409);
    }
    throw e;
  }
}

export async function updateExam(request, env, userId, id) {
  const body = await request.json().catch(() => ({}));
  const cur = await env.DB.prepare(
    `SELECT id FROM health_exams WHERE id = ? AND user_id = ?`
  ).bind(id, userId).first();
  if (!cur) return fail('없는 기록입니다.', 404);

  const sets = [];
  const args = [];
  if (body.date !== undefined) {
    const d = str(body.date, 10);
    if (!DATE_RE.test(d)) return fail('날짜를 YYYY-MM-DD 로 적어주세요.');
    sets.push('exam_date = ?'); args.push(d);
  }
  if (body.kind !== undefined && isKind(body.kind)) { sets.push('kind = ?'); args.push(body.kind); }
  if (body.provider !== undefined) { sets.push('provider = ?'); args.push(str(body.provider, 120)); }
  if (body.title !== undefined) { sets.push('title = ?'); args.push(str(body.title, 160)); }
  if (body.memo !== undefined) { sets.push('memo = ?'); args.push(str(body.memo, 2000)); }
  if (!sets.length) return json({ ok: true });

  sets.push('updated_at = ?'); args.push(nowIso());
  await env.DB.prepare(`UPDATE health_exams SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
    .bind(...args, id, userId).run();
  return json({ ok: true });
}

export async function deleteExam(env, userId, id) {
  const cur = await env.DB.prepare(
    `SELECT id FROM health_exams WHERE id = ? AND user_id = ?`
  ).bind(id, userId).first();
  if (!cur) return fail('없는 기록입니다.', 404);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM health_results WHERE exam_id = ? AND user_id = ?`).bind(id, userId),
    env.DB.prepare(`DELETE FROM health_exams   WHERE id = ?      AND user_id = ?`).bind(id, userId),
  ]);
  return json({ ok: true });
}

/**
 * 한 회차의 값을 한꺼번에 넣고 고친다.
 *
 * 값 하나마다 왕복하지 않는다 — 검진 한 회차는 항목이 백 개가 넘는다.
 * **비워서 보낸 항목은 지운다**(오타로 넣은 줄을 화면에서 지울 방법이 있어야 한다).
 * 이름표에 없는 code 는 조용히 버린다 — 표에는 이름표가 있는 것만 들어간다.
 */
export async function putResults(request, env, userId, id) {
  const exam = await env.DB.prepare(
    `SELECT id FROM health_exams WHERE id = ? AND user_id = ?`
  ).bind(id, userId).first();
  if (!exam) return fail('없는 기록입니다.', 404);

  const body = await request.json().catch(() => ({}));
  const items = Array.isArray(body.results) ? body.results.slice(0, 400) : [];
  if (!items.length) return fail('담을 값이 없습니다.');

  const { results: known } = await env.DB.prepare(`SELECT code FROM health_metrics`).all();
  const codes = new Set((known || []).map((k) => k.code));

  const ts = nowIso();
  const stmts = [];
  let saved = 0;
  let removed = 0;

  for (const it of items) {
    const code = str(it.code, 40);
    if (!codes.has(code)) continue;
    const num = numOrNull(it.num ?? it.value_num);
    const text = str(it.text ?? it.value_text, 400);

    if (num === null && !text) {
      stmts.push(env.DB.prepare(`DELETE FROM health_results WHERE user_id = ? AND exam_id = ? AND code = ?`)
        .bind(userId, id, code));
      removed += 1;
      continue;
    }
    stmts.push(env.DB.prepare(
      `INSERT INTO health_results (user_id, exam_id, code, value_num, value_text, unit, ref_low, ref_high, ref_text, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(exam_id, code) DO UPDATE SET
         value_num = excluded.value_num, value_text = excluded.value_text,
         unit = excluded.unit, ref_low = excluded.ref_low, ref_high = excluded.ref_high,
         ref_text = excluded.ref_text, note = excluded.note`
    ).bind(
      userId, id, code, num, text,
      str(it.unit, 24), numOrNull(it.refLow ?? it.ref_low), numOrNull(it.refHigh ?? it.ref_high),
      str(it.refText ?? it.ref_text, 60), str(it.note, 400), ts
    ));
    saved += 1;
  }

  if (!stmts.length) return fail('아는 검사항목이 하나도 없습니다.');
  await env.DB.batch(stmts);
  await env.DB.prepare(`UPDATE health_exams SET updated_at = ? WHERE id = ? AND user_id = ?`)
    .bind(ts, id, userId).run();
  return json({ ok: true, saved, removed });
}
