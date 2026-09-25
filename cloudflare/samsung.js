// 헬스정보 → 삼성헬스 탭 — 워치·폰이 매일 재는 것(걸음 · 잠 · 심박 · 체중)을 **하루 한 값**으로 둔다.
//
// 검진(health.js)과 표를 나눈 이유: 검진은 '회차 × 항목'이고 한 해에 한두 번이다.
// 이쪽은 '날짜 × 항목'이고 매일이다(11년치 4천 일 × 스무 항목 ≈ 4만 줄). 같은 표에
// 넣으면 검진 한 회차를 여는 질의가 4만 줄을 헤치게 된다.
//
// 값은 브라우저가 삼성헬스 내보내기 폴더를 읽어 **하루 한 값으로 접은 뒤** 올린다
// (web/public/shealth-parse.js). 원본(심박 11만 줄)은 서버에 오지 않는다.

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
const fail = (error, status = 400) => json({ error }, status);

/**
 * 항목 이름표. 화면은 이 목록을 받아 그린다(차례도 이 차례다).
 *
 *   chart  'bar'  하루하루가 따로 선 양(걸음 · 운동시간) — 막대
 *          'line' 이어지는 상태(체중 · 심박) — 선
 *   band   괜찮다고 널리 쓰이는 구간. 띠로만 깐다 — 판정하지 않는다.
 *   digits 화면에 적는 소수 자리
 */
export const SAMSUNG_GROUPS = [
  { key: 'activity', label: '활동' },
  { key: 'sleep',    label: '수면' },
  { key: 'heart',    label: '심장 · 호흡' },
  { key: 'body',     label: '몸' },
  { key: 'etc',      label: '그 밖' },
];

export const SAMSUNG_METRICS = [
  { code: 'steps',         label: '걸음수',         unit: '보',     group: 'activity', chart: 'bar',  digits: 0 },
  { code: 'distance',      label: '이동거리',       unit: 'km',     group: 'activity', chart: 'bar',  digits: 1 },
  { code: 'exercise_min',  label: '운동시간',       unit: '분',     group: 'activity', chart: 'bar',  digits: 0, memo: '직접 기록했거나 워치가 알아챈 운동을 시작한 날에 더한다' },
  { code: 'exercise_kcal', label: '운동 칼로리',    unit: 'kcal',   group: 'activity', chart: 'bar',  digits: 0 },
  { code: 'active_min',    label: '활동시간',       unit: '분',     group: 'activity', chart: 'bar',  digits: 0, memo: '걷기·달리기 등 몸을 움직인 시간 전부' },
  { code: 'active_kcal',   label: '활동 칼로리',    unit: 'kcal',   group: 'activity', chart: 'bar',  digits: 0 },
  { code: 'floors',        label: '오른 층수',      unit: '층',     group: 'activity', chart: 'bar',  digits: 0 },

  { code: 'sleep_h',       label: '수면시간',       unit: '시간',   group: 'sleep',    chart: 'bar',  digits: 1, band: [7, 9], memo: '깬 날에 붙인다. 낮잠·나눠 잔 잠도 더한다' },
  { code: 'sleep_score',   label: '수면점수',       unit: '점',     group: 'sleep',    chart: 'line', digits: 0, memo: '그날 가장 긴 잠의 점수' },
  { code: 'sleep_eff',     label: '수면효율',       unit: '%',      group: 'sleep',    chart: 'line', digits: 0 },

  { code: 'hr_avg',        label: '평균 심박수',    unit: 'bpm',    group: 'heart',    chart: 'line', digits: 0 },
  { code: 'hr_min',        label: '최저 심박수',    unit: 'bpm',    group: 'heart',    chart: 'line', digits: 0 },
  { code: 'hr_sleep',      label: '수면 중 심박수', unit: 'bpm',    group: 'heart',    chart: 'line', digits: 0, memo: '안정 시 심박에 가장 가까운 값' },
  { code: 'hrv_sleep',     label: '수면 중 HRV',    unit: 'ms',     group: 'heart',    chart: 'line', digits: 0, memo: '심박 간격의 흔들림. 높을수록 회복이 잘 된 것으로 본다' },
  { code: 'spo2',          label: '혈중 산소',      unit: '%',      group: 'heart',    chart: 'line', digits: 1, band: [95, 100] },
  { code: 'resp',          label: '호흡수',         unit: '회/분',  group: 'heart',    chart: 'line', digits: 1, memo: '잘 때 잰 1분 호흡 수' },

  { code: 'weight',        label: '체중',           unit: 'kg',     group: 'body',     chart: 'line', digits: 1 },
  { code: 'body_fat',      label: '체지방률',       unit: '%',      group: 'body',     chart: 'line', digits: 1 },
  { code: 'smm',           label: '골격근량',       unit: 'kg',     group: 'body',     chart: 'line', digits: 1 },
  { code: 'skin_temp',     label: '피부 온도',      unit: '°C',     group: 'body',     chart: 'line', digits: 1, memo: '잘 때 손목에서 잰 평균' },

  { code: 'energy_score',  label: '에너지 점수',    unit: '점',     group: 'etc',      chart: 'line', digits: 0, memo: '잠·활동·심박을 묶어 워치가 아침에 매기는 점수' },
  { code: 'stress',        label: '스트레스',       unit: '점',     group: 'etc',      chart: 'line', digits: 0 },
  { code: 'water',         label: '물 섭취',        unit: 'ml',     group: 'etc',      chart: 'bar',  digits: 0 },
];

const CODES = new Set(SAMSUNG_METRICS.map((m) => m.code));
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' 에서 n 일을 뺀다. */
const minusDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);

/**
 * 탭이 처음 부르는 곳 — 항목 목록과 **항목마다 얼마나 있나**, 그리고 요약 타일의 값.
 *
 * 요약은 '오늘'이 아니라 **가장 최근에 기록된 날**을 기준으로 7일을 센다. 내보내기는
 * 며칠에 한 번 하므로, 오늘을 기준으로 세면 올리기 전 며칠 동안 타일이 텅 빈다.
 */
export async function samsungOverview(env, userId) {
  const [{ results: stats }, lastImport] = await Promise.all([
    env.DB.prepare(
      `SELECT code, COUNT(*) AS n, MIN(day) AS first, MAX(day) AS last
         FROM health_daily WHERE user_id = ? GROUP BY code`
    ).bind(userId).all(),
    env.DB.prepare(
      `SELECT imported_at, source, rows, first_day, last_day
         FROM health_daily_imports WHERE user_id = ? ORDER BY id DESC LIMIT 1`
    ).bind(userId).first(),
  ]);

  const byCode = new Map((stats || []).map((s) => [s.code, s]));
  const lastDay = (stats || []).reduce((m, s) => (s.last > m ? s.last : m), '');

  // 최근 14일(이번 7일 + 그 앞 7일)만 따로 받아 평균을 낸다.
  const recent = new Map();
  if (lastDay) {
    const { results } = await env.DB.prepare(
      `SELECT code, day, value FROM health_daily WHERE user_id = ? AND day > ?`
    ).bind(userId, minusDays(lastDay, 14)).all();
    const cut = minusDays(lastDay, 7);
    for (const r of results || []) {
      let s = recent.get(r.code);
      if (!s) { s = { now: [], prev: [], latest: null }; recent.set(r.code, s); }
      (r.day > cut ? s.now : s.prev).push(r.value);
      if (!s.latest || r.day > s.latest.day) s.latest = { day: r.day, value: r.value };
    }
  }
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

  return {
    groups: SAMSUNG_GROUPS,
    metrics: SAMSUNG_METRICS.map((m) => {
      const s = byCode.get(m.code);
      const r = recent.get(m.code);
      return {
        ...m,
        count: s?.n || 0,
        first: s?.first || null,
        last: s?.last || null,
        latest: r?.latest || (s ? { day: s.last, value: null } : null),
        avg7: r ? avg(r.now) : null,
        avgPrev7: r ? avg(r.prev) : null,
      };
    }),
    lastDay: lastDay || null,
    lastImport: lastImport
      ? {
          at: lastImport.imported_at,
          source: lastImport.source || '',
          rows: lastImport.rows || 0,
          first: lastImport.first_day || null,
          last: lastImport.last_day || null,
        }
      : null,
  };
}

/**
 * 한 항목의 **전 기간** — [[day, value], ...]. 기간 자르기·주/월 묶기는 화면이 한다.
 * 4천 일이어도 80KB 남짓이라, 기간 단추를 누를 때마다 다시 묻지 않게 통째로 준다.
 */
export async function samsungSeries(env, userId, code) {
  if (!CODES.has(code)) return fail('모르는 항목입니다.', 404);
  const { results } = await env.DB.prepare(
    `SELECT day, value FROM health_daily WHERE user_id = ? AND code = ? ORDER BY day`
  ).bind(userId, code).all();
  return json({ code, points: (results || []).map((r) => [r.day, r.value]) });
}

/** 한 번에 받는 줄 수. 브라우저가 이만큼씩 나눠 보낸다(요청 하나 ≈ 100KB). */
export const IMPORT_CHUNK = 3000;

/**
 * 올리기 — body: { rows: [[day, code, value], ...], final?: { source, rows, first, last } }
 *
 * 줄마다 문장을 하나씩 만들지 않는다. D1 은 요청 하나에 부를 수 있는 질의 수가 정해져
 * 있어서, 3천 줄을 3천 문장으로 보내면 한도에 걸린다. 대신 줄 전부를 JSON 글자 하나로
 * 묶어 **문장 하나**(json_each)로 넣는다. 같은 날·같은 항목은 새 값이 이긴다 —
 * 삼성헬스는 내보낼 때마다 전 기간을 다시 주므로, 겹쳐 올려도 늘어나지 않는다.
 */
export async function samsungImport(request, env, userId) {
  const body = await request.json().catch(() => ({}));
  const raw = Array.isArray(body.rows) ? body.rows : [];
  if (raw.length > IMPORT_CHUNK) return fail(`한 번에 ${IMPORT_CHUNK}줄까지만 받습니다.`, 413);

  const rows = [];
  for (const r of raw) {
    if (!Array.isArray(r)) continue;
    const [day, code, value] = r;
    if (!DAY_RE.test(String(day)) || !CODES.has(code)) continue;
    const v = Number(value);
    if (!Number.isFinite(v)) continue;
    rows.push([day, code, v]);
  }

  const ts = new Date().toISOString();
  if (rows.length) {
    await env.DB.prepare(
      `INSERT INTO health_daily (user_id, code, day, value, updated_at)
       SELECT ?1, json_extract(j.value, '$[1]'), json_extract(j.value, '$[0]'), json_extract(j.value, '$[2]'), ?2
         FROM json_each(?3) AS j
        WHERE 1
       ON CONFLICT (user_id, code, day) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).bind(userId, ts, JSON.stringify(rows)).run();
  }

  // 마지막 조각에만 딸려 온다 — '언제 무엇을 올렸나'를 한 줄 남긴다.
  const f = body.final;
  if (f && typeof f === 'object') {
    await env.DB.prepare(
      `INSERT INTO health_daily_imports (user_id, imported_at, source, rows, first_day, last_day)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      userId, ts,
      String(f.source || '').slice(0, 200),
      Math.max(0, Math.floor(Number(f.rows) || 0)),
      DAY_RE.test(String(f.first)) ? f.first : null,
      DAY_RE.test(String(f.last)) ? f.last : null
    ).run();
  }
  return json({ ok: true, saved: rows.length, skipped: raw.length - rows.length });
}
