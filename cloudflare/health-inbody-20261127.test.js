import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const sql = name => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
test('November InBody import preserves other users and is repeatable', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT, role TEXT); CREATE TABLE user_services(user_id INTEGER, service_key TEXT, allowed INTEGER, reauth INTEGER);');
    for (const name of ['010_health.sql', '012_health_inbody_blood.sql', '021_health_2026_checkup.sql']) db.exec(sql(name));
    db.exec("INSERT INTO users VALUES (1,'other@example.com','admin'), (2,'garzette@paran.com','admin')");
    db.exec(sql('025_inbody_20261127.sql'));
    const rows = db.prepare('SELECT code, value_num, value_text, ref_low, ref_high FROM health_results ORDER BY code').all();
    db.exec(sql('025_inbody_20261127.sql'));
    assert.deepEqual(db.prepare('SELECT code, value_num, value_text, ref_low, ref_high FROM health_results ORDER BY code').all(), rows);
    assert.equal(db.prepare('SELECT user_id FROM health_exams').get().user_id, 2);
    assert.equal(rows.length, 44);
    for (const [code, value] of Object.entries({weight:66.3,smm:29.7,bodyfat:20.3,vfa:53.4,bmr:1510,leg_l:8.75,ecw_leg_l:0.372,adj_fat:-3.4})) assert.equal(rows.find(row => row.code === code).value_num, value, code);
    assert.equal(rows.find(row => row.code === 'bodyfat').ref_high, 20);
    assert.match(rows.find(row => row.code === 'inbody_impedance').value_text, /1000kHz:280.8/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM health_results r LEFT JOIN health_metrics m ON m.code=r.code WHERE m.code IS NULL').get().n, 0);
  } finally { db.close(); }
});
