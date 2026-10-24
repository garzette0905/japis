#!/usr/bin/env node
// 삼성헬스 내보내기 폴더 → D1(health_daily). 화면의 '가져오기'와 **같은 셈**을 쓴다
// (web/public/shealth-parse.js). 브라우저를 열지 않고 올리고 싶을 때, 또는 작업
// 스케줄러로 정해진 때마다 돌리고 싶을 때 쓴다.
//
//   node tools/samsung-health-import.mjs                         # ./Samsung Health, 최근 45일, 운영 D1
//   node tools/samsung-health-import.mjs "D:\폰백업\Samsung Health" --all
//   node tools/samsung-health-import.mjs --local                 # wrangler dev 의 로컬 D1
//   node tools/samsung-health-import.mjs --since 2026-01-01 --email me@example.com
//   node tools/samsung-health-import.mjs --dry                   # SQL 만 만들고 올리지 않는다
//
// 폴더 안에 내보내기가 여러 개(samsunghealth_<id>_<시각>) 있으면 **표마다 가장 최근 것**을 쓴다.
// 같은 날·같은 항목은 새 값이 이긴다 — 여러 번 돌려도 줄이 늘지 않는다.
// 기본이 '최근 45일'인 이유: 삼성헬스는 매번 전 기간을 다시 주는데, 4만 줄을 매번 다시
// 쓰면 D1 무료 쓰기 한도(하루 10만 줄)를 금방 먹는다. 처음 한 번만 --all 로 올린다.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { datasetOf } = await import(pathToFileURL(path.join(root, 'web/public/shealth-parse.js')).href);
const { parseSamsungHealthExport } = await import(pathToFileURL(path.join(root, 'web/public/shealth-extra.js')).href);

// ── 인자 ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !['--since', '--email', '--days', '--out'].includes(args[i - 1]));

const folder = path.resolve(positional[0] || path.join(root, 'Samsung Health'));
const remote = !flag('--local');
const all = flag('--all');
const dry = flag('--dry');
const days = Number(opt('--days') || 45);
const email = (opt('--email') || readAdminEmail()).toLowerCase();
const since = opt('--since') || (all ? null : new Date(Date.now() - days * 86400000).toISOString().slice(0, 10));

function readAdminEmail() {
  const toml = fs.readFileSync(path.join(root, 'wrangler.toml'), 'utf8');
  const m = /^ADMIN_EMAIL\s*=\s*"([^"]+)"/m.exec(toml);
  if (!m) throw new Error('wrangler.toml 에서 ADMIN_EMAIL 을 찾지 못했습니다. --email 로 알려 주세요.');
  return m[1];
}

// ── 파일 고르기 ────────────────────────────────────────────────
function collect(dir, depth = 0, found = new Map()) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isFile()) {
      const d = datasetOf(ent.name);
      if (!d) continue;
      const cur = found.get(d.dataset);
      if (!cur || d.stamp > cur.stamp) found.set(d.dataset, { ...d, file: p, folder: path.basename(dir) });
    } else if (ent.isDirectory() && depth < 3 && ent.name !== 'jsons' && ent.name !== 'files') {
      collect(p, depth + 1, found);
    }
  }
  return found;
}

if (!fs.existsSync(folder)) {
  console.error(`폴더가 없습니다: ${folder}`);
  process.exit(1);
}
const found = collect(folder);
if (!found.size) {
  console.error(`삼성헬스 CSV(com.samsung.….csv)를 찾지 못했습니다: ${folder}`);
  process.exit(1);
}

const files = {};
for (const f of found.values()) files[f.dataset] = fs.readFileSync(f.file, 'utf8');
const parsed = await parseSamsungHealthExport(files, async (dataset, name) => {
  if (!/^[\w.+ -]+\.json$/.test(name)) return null;
  const base = path.join(path.dirname(found.get(dataset).file), 'jsons', dataset);
  for (const f of [path.join(base,name),path.join(base,name[0],name)]) {
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f,'utf8'));
  }
  return null;
});
const { rows } = parsed;
const send = since ? rows.filter(([day]) => day >= since) : rows;
const hourly = parsed.hourly.filter(([day]) => !since || day >= since);
const records = parsed.records.filter(r => !since || r.day >= since);
const dates = [...rows.map(r=>r[0]), ...parsed.hourly.map(r=>r[0]), ...parsed.records.map(r=>r.day)].sort();
for (const warning of parsed.warnings) console.warn(warning);
const source = [...found.values()].map((f) => f.folder).sort().pop() || '';

console.log(`읽은 표 ${found.size}개 · ${source}`);
console.log(`모은 값 ${rows.length.toLocaleString()}개 (${rows[0]?.[0]} ~ ${rows[rows.length - 1]?.[0]})`);
console.log(`시간별 요약 ${hourly.length.toLocaleString()}개 · 개별 기록 ${records.length.toLocaleString()}개`);
console.log(`올릴 값 ${send.length.toLocaleString()}개${since ? ` (${since} 부터)` : ' (전체)'} → ${remote ? '운영' : '로컬'} D1, ${email}`);
if (!send.length && !hourly.length && !records.length) process.exit(0);

// ── SQL ────────────────────────────────────────────────────────
// 줄마다 사용자를 찾지 않게 users 와 한 번 묶는다. 문장 하나는 100KB 를 넘지 않게 500줄씩.
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const ts = new Date().toISOString();
const parts = [];
for (let i = 0; i < send.length; i += 500) {
  const values = send.slice(i, i + 500).map(([d, c, v]) => `(${q(d)},${q(c)},${Number(v)})`).join(',\n');
  parts.push(
    `INSERT INTO health_daily (user_id, code, day, value, updated_at)
SELECT u.id, v.column2, v.column1, v.column3, ${q(ts)}
  FROM (VALUES
${values}) AS v, users u
 WHERE u.email = ${q(email)}
ON CONFLICT (user_id, code, day) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
WHERE health_daily.value IS NOT excluded.value;`
  );
}
parts.push(
  `INSERT INTO health_daily_imports (user_id, imported_at, source, rows, first_day, last_day)
SELECT id, ${q(ts)}, ${q(`${source} (cli)`)}, ${send.length}, ${q(dates[0])}, ${q(dates.at(-1))}
  FROM users WHERE email = ${q(email)};`
);

// Keep every statement below D1's statement-size limit, including record JSON.
function jsonStatements(items, statement) {
  let batch=[], bytes=2;
  for (const item of items) {
    const size=Buffer.byteLength(JSON.stringify(item))+1;
    if (batch.length && bytes+size > 55000) {
      parts.splice(parts.length-1,0,statement(q(JSON.stringify(batch))));batch=[];bytes=2;
    }
    batch.push(item);bytes+=size;
  }
  if(batch.length)parts.splice(parts.length-1,0,statement(q(JSON.stringify(batch))));
}
jsonStatements(hourly, data => `INSERT INTO health_hourly(user_id,code,day,hour,value,minimum,maximum,duration_ms,updated_at)
SELECT u.id,json_extract(j.value,'$[1]'),json_extract(j.value,'$[0]'),json_extract(j.value,'$[2]'),json_extract(j.value,'$[3]'),json_extract(j.value,'$[4]'),json_extract(j.value,'$[5]'),json_extract(j.value,'$[6]'),${q(ts)}
FROM json_each(${data}) j, users u WHERE u.email=${q(email)}
ON CONFLICT(user_id,code,day,hour) DO UPDATE SET value=excluded.value,minimum=excluded.minimum,maximum=excluded.maximum,duration_ms=excluded.duration_ms,updated_at=excluded.updated_at
WHERE health_hourly.value IS NOT excluded.value OR health_hourly.minimum IS NOT excluded.minimum OR health_hourly.maximum IS NOT excluded.maximum OR health_hourly.duration_ms IS NOT excluded.duration_ms;`);
jsonStatements(records, data => `INSERT INTO health_records(user_id,kind,source_id,day,data,updated_at)
SELECT u.id,json_extract(j.value,'$.kind'),json_extract(j.value,'$.id'),json_extract(j.value,'$.day'),json_extract(j.value,'$.data'),${q(ts)}
FROM json_each(${data}) j, users u WHERE u.email=${q(email)}
ON CONFLICT(user_id,kind,source_id) DO UPDATE SET day=excluded.day,data=excluded.data,updated_at=excluded.updated_at
WHERE health_records.day IS NOT excluded.day OR health_records.data IS NOT excluded.data;`);

const sqlFile = opt('--out') ? path.resolve(opt('--out')) : path.join(os.tmpdir(), `japis-shealth-${Date.now()}.sql`);
fs.writeFileSync(sqlFile, parts.join('\n\n') + '\n');
if (dry) {
  console.log(`SQL 만 만들었습니다: ${sqlFile}`);
  process.exit(0);
}

const r = spawnSync(
  process.execPath,
  [path.join(root, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', 'japis-db', remote ? '--remote' : '--local', `--file=${sqlFile}`, '--yes'],
  { cwd: root, stdio: 'inherit' }
);
fs.rmSync(sqlFile, { force: true });
process.exit(r.status ?? 1);
