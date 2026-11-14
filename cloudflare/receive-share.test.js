import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { receiveShare } from './receive-share.js';
import { serveFile } from './wiki.js';
import worker from './index.js';
import { serviceOf } from './services.js';
import { serviceIco } from '../web/public/icons.js';

const root = new URL('../', import.meta.url);
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('schema.sql', root), 'utf8'));
  const objects = new Map();
  const env = {
    DB: {
      prepare(sql) {
        return { args: [], bind(...args) { this.args = args; return this; },
          async first() { return db.prepare(sql).get(...this.args) || null; },
          async run() { const r = db.prepare(sql).run(...this.args); return { meta: { changes: r.changes, last_row_id: r.lastInsertRowid } }; },
        };
      },
      async batch(statements) {
        db.exec('BEGIN');
        try { const r = []; for (const s of statements) r.push(await s.run()); db.exec('COMMIT'); return r; }
        catch (e) { db.exec('ROLLBACK'); throw e; }
      },
    },
    WIKI_FILES: {
      async put(key, stream, options) { objects.set(key, { body: await new Response(stream).arrayBuffer(), ...options }); },
      async get(key) { return objects.get(key); },
    },
  };
  const send = (fields = {}, files = [], uid = 1) => {
    const form = new FormData();
    form.set('shareId', '12345678-1234-1234-1234-123456789abc');
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    for (const file of files) form.append('files', file);
    return receiveShare(new Request('https://japis.test/api/wiki/receive-share', { method: 'POST', body: form }), env, uid);
  };
  return { db, env, objects, send };
}

test('one share makes one private note in 공유 자료, retaining text, URL, photos and attachments; retries are idempotent', async () => {
  const { db, env, objects, send } = fixture();
  try {
    const files = [new File(['photo'], '사진.jpg', { type: 'image/jpeg' }), new File(['<script>alert(1)</script>'], '문서.html', { type: 'text/html' })];
    const response = await send({ title: '공유 제목', text: '<script>alert(1)</script>\n#태그', url: 'https://example.com/?a=1&b=2' }, files);
    assert.equal(response.status, 201);
    const { id } = await response.json();
    const note = db.prepare('SELECT * FROM wiki_notes WHERE id = ?').get(id);
    assert.equal(db.prepare('SELECT name FROM wiki_folders WHERE id = ?').get(note.folder_id).name, '공유 자료');
    assert.equal(note.title, '공유 제목');
    assert.match(note.html, /&lt;script&gt;/);
    assert.match(note.html, /<img src="\/api\/wiki\/files\/1\//);
    assert.match(note.html, /문서.html/);
    assert.equal(note.share_token, null);
    assert.equal(note.tags, '태그');
    const second = await send({ text: 'retry' }, files);
    assert.equal((await second.json()).id, id);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM wiki_notes').get().c, 1);
    const fileId = [...objects.keys()][1];
    const download = await serveFile(env, 1, fileId);
    assert.match(download.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''/);
    assert.equal(download.headers.get('content-type'), 'application/octet-stream');
    assert.equal((await serveFile(env, 2, fileId)).status, 404);
    await send({ text: 'other account' }, [], 2);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM wiki_folders').get().c, 2);
    await send({ shareId: crypto.randomUUID(), text: 'next share' });
    assert.equal(db.prepare('SELECT COUNT(*) c FROM wiki_folders WHERE user_id=1').get().c, 1);
  } finally { db.close(); }
});

test('invalid, empty and oversized shares do not write notes; failed database save can be retried', async () => {
  const { db, env, send } = fixture();
  try {
    assert.equal((await send()).status, 400);
    assert.equal((await send({ text: 'x', shareId: '../wrong' })).status, 400);
    assert.equal((await send({ text: 'x'.repeat(200001) })).status, 413);
    assert.equal((await send({}, Array.from({ length: 21 }, () => new File(['x'], 'x.txt')))).status, 413);
    assert.equal((await send({}, [new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'large.bin')])).status, 413);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM wiki_notes').get().c, 0);
    const batch = env.DB.batch;
    env.DB.batch = async () => { throw new Error('temporary database failure'); };
    await assert.rejects(send({ text: 'preserved' }), /temporary/);
    env.DB.batch = batch;
    assert.equal((await send({ text: 'preserved' })).status, 201);
  } finally { db.close(); }
});

test('share endpoint uses login and same-origin gates', async () => {
  const request = origin => new Request('https://japis.test/api/wiki/receive-share', { method: 'POST', headers: { Origin: origin } });
  assert.equal((await worker.fetch(request('https://evil.test'), {}, {})).status, 403);
  assert.equal((await worker.fetch(request('https://japis.test'), { SESSION_SECRET: 'test-session-secret-long-enough' }, {})).status, 401);
});

test('service worker captures file bytes before redirect, handles failure, and leaves other requests alone', async () => {
  const listeners = {};
  const saved = new Map();
  const context = {
    self: { location: { origin: 'https://japis.test' }, addEventListener: (name, callback) => { listeners[name] = callback; } },
    importScripts() {}, crypto, URL, Response,
    japisShareStore: async (mode, id, value) => { saved.set(id, value); },
  };
  vm.runInNewContext(fs.readFileSync(new URL('web/public/sw.js', root), 'utf8'), context);
  const manifest = JSON.parse(fs.readFileSync(new URL('web/public/manifest.json', root), 'utf8'));
  assert.equal(manifest.share_target.action, '/share-target');
  const form = new FormData();
  form.set('text', '공유 텍스트'); form.append('files', new File(['original bytes'], '사진.png', { type: 'image/png' }));
  let result;
  listeners.fetch({ request: new Request('https://japis.test/share-target', { method: 'POST', body: form }), respondWith(promise) { result = promise; } });
  const response = await result;
  assert.equal(response.status, 303);
  const id = new URL(response.headers.get('location')).searchParams.get('share');
  assert.equal(saved.get(id).text, '공유 텍스트');
  assert.equal(await saved.get(id).files[0].text(), 'original bytes');
  listeners.fetch({ request: new Request('https://japis.test/api/status'), respondWith() { assert.fail('must not intercept API'); } });
  context.japisShareStore = async () => { throw new Error('quota exceeded'); };
  listeners.fetch({ request: new Request('https://japis.test/share-target', { method: 'POST', body: form }), respondWith(promise) { result = promise; } });
  assert.match((await result).headers.get('location'), /shareError=storage/);
});

test('AI 활용 갤러리 replaces the old menu and has a distinct icon', () => {
  assert.equal(serviceOf('damoang').label, 'AI 활용 갤러리');
  assert.equal(new URL(serviceOf('damoang').url).searchParams.get('id'), 'ai_utilize');
  assert.equal(serviceOf('damoang').frame, false);
  assert.notEqual(serviceIco('damoang'), serviceIco('thesingularity'));
  assert.match(serviceIco('damoang'), /#7543b5/);
});

test('migration preserves existing notes and allows independent shares for each account', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE wiki_notes (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT); INSERT INTO wiki_notes VALUES (1, 1, \'existing\');');
    db.exec(fs.readFileSync(new URL('migrations/024_received_shares.sql', root), 'utf8'));
    assert.equal(db.prepare('SELECT title FROM wiki_notes WHERE id = 1').get().title, 'existing');
    db.prepare('INSERT INTO wiki_notes (user_id, received_share_id) VALUES (?, ?)').run(1, 'same');
    assert.throws(() => db.prepare('INSERT INTO wiki_notes (user_id, received_share_id) VALUES (?, ?)').run(1, 'same'), /UNIQUE/);
    db.prepare('INSERT INTO wiki_notes (user_id, received_share_id) VALUES (?, ?)').run(2, 'same');
  } finally { db.close(); }
});
