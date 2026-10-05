// 운영과 다른 네트워크에서 같은 검색을 재현한다. --seed는 성공한 RSS만 운영 KV에 보관한다.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { googlePopularity } from '../cloudflare/news.js';

const args = process.argv.slice(2);
const input = args[args.indexOf('--snapshot') + 1];
if (!args.includes('--snapshot') || !input) {
  console.error('Usage: node tools/news-google-check.mjs --snapshot snapshot.json [--seed]');
  process.exit(1);
}
const snapshot = JSON.parse(readFileSync(input, 'utf8').replace(/^\uFEFF/, ''));
const now = Date.now();
const values = new Map();
const SESSIONS = { async get(key) { return JSON.parse(values.get(key) || 'null'); }, async put(key, value) { values.set(key, value); } };
const rows = [];
for (const lang of ['ko', 'en']) {
  const items = snapshot.top.filter((r) => r.lang === lang).map((r) => ({ ...r, kind: 'news', at: Date.parse(r.firstAt || r.at) }));
  const groups = items.map((lead) => ({ lead, items: [lead], firstAt: lead.at, newest: lead.at }));
  const hours = snapshot.regions?.find((r) => r.lang === lang)?.windowHours || snapshot.windowHours || 24;
  rows.push(...await googlePopularity({ SESSIONS }, groups, now, hours * 3600000));
}
for (const r of rows) console.log(JSON.stringify({ title: r.lead.title, ...r.popularity }));
const failed = rows.filter((r) => !r.popularity.ok);
if (args.includes('--seed') && rows.some((r) => r.popularity.ok)) {
  const dir = mkdtempSync(join(tmpdir(), 'japis-google-'));
  try {
    const cache = JSON.parse(values.get('news:google-results:v1') || '{}');
    const cli = ['node_modules/wrangler/bin/wrangler.js'];
    // 서버의 다른 성공 결과도 보존한다.
    let old = {};
    try {
      const oldText = execFileSync(process.execPath, [...cli, 'kv', 'key', 'get', 'news:google-results:v1', '--binding', 'SESSIONS', '--remote'], { encoding: 'utf8', stdio: 'pipe' });
      if (oldText.trim()) old = JSON.parse(oldText);
    } catch (e) {
      if (!/404: Not Found/.test(String(e.stderr))) throw e;
    }
    const path = join(dir, 'cache.json');
    writeFileSync(path, JSON.stringify({ ...old, ...cache }));
    execFileSync(process.execPath, [...cli, 'kv', 'key', 'put', 'news:google-results:v1', '--binding', 'SESSIONS', '--remote', '--path', path, '--ttl', '86400'], { stdio: 'inherit' });
    console.log('검증에 성공한 Google RSS를 운영 캐시에 저장했습니다. 뉴스 화면에서 새로고침하세요.');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
if (!rows.length || failed.length) process.exitCode = 1;
