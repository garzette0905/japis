import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { examDetail } from './health.js';

const sql = readFileSync(new URL('../migrations/021_health_2026_checkup.sql', import.meta.url), 'utf8');
const readMigration = (name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT, role TEXT);
    CREATE TABLE user_services(user_id INTEGER,service_key TEXT,allowed INTEGER,reauth INTEGER);`);
  db.exec(readMigration('010_health.sql'));
  db.exec(readMigration('012_health_inbody_blood.sql'));
  // The owner is deliberately not the first administrator.
  db.exec(`INSERT INTO users VALUES(1,'other@example.com','admin'),(2,'garzette@paran.com','admin');
    INSERT INTO health_exams(user_id,exam_date,kind,title,created_at,updated_at)
      VALUES(1,'2026-10-01','checkup','Other user','old','old'),
            (2,'2024-09-10','checkup','Historical','old','old');
    INSERT INTO health_results(user_id,exam_id,code,value_num,created_at)
      VALUES(1,1,'ldl',99,'old'),(2,2,'ldl',148,'old');`);
  db.exec(sql);
  return db;
}
const result = (db, code, kind='checkup') => db.prepare(`SELECT r.* FROM health_results r
  JOIN health_exams e ON e.id=r.exam_id WHERE e.user_id=2 AND e.exam_date='2026-10-01'
  AND e.kind=? AND r.code=?`).get(kind,code);

test('2026 import is repeatable, targets the owner and preserves historical/other-user results', () => {
  const db=fixture();
  try {
    const before=db.prepare('SELECT * FROM health_results ORDER BY id').all();
    db.exec(sql);
    assert.deepEqual(db.prepare('SELECT * FROM health_results ORDER BY id').all(),before);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM health_exams').get().n,4);
    assert.equal(db.prepare('SELECT value_num FROM health_results WHERE exam_id=1').get().value_num,99);
    assert.equal(db.prepare('SELECT value_num FROM health_results WHERE exam_id=2').get().value_num,148);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM health_results r LEFT JOIN health_metrics m ON m.code=r.code WHERE m.code IS NULL`).get().n,0);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM health_results r JOIN health_exams e ON e.id=r.exam_id WHERE e.user_id=2 AND e.exam_date='2026-10-01'`).get().n,207);
  } finally { db.close(); }
});

test('current results retain direct/calculated LDL, source ranges and image-only appendix measurements', () => {
  const db=fixture();
  try {
    for (const [code,value] of Object.entries({ldl:161,ldl_calc:152,hba1c:5.9,glucose:92,lpa_nmol:118.4,ferritin:31.5,pdw:9.7,vitd:24.7,hr:59,hrv_hr:54.3,stress_index:92.6,fatigue:117,age_bio:53,age_ai_health:53.8,age_heart:53.2,age_lung:56,cvd_risk10:3.41,cvd_pwv_risk10:2.4})) {
      assert.equal(result(db,code).value_num,value,code);
    }
    assert.equal(result(db,'ferritin').ref_low,59);
    assert.equal(result(db,'vitd').ref_low,30.1);
    assert.equal(result(db,'weight','inbody').ref_low,57);
    assert.equal(result(db,'bmr','inbody').ref_low,1452);
    assert.equal(result(db,'smm','inbody').value_num,29.5);
    assert.equal(result(db,'ecw_arm_l','inbody').value_num,0.377);
    assert.match(result(db,'inbody_impedance','inbody').value_text,/1000kHz:282.3/);
    for (const code of ['colono','occult','carotid','ana','anti_ro','anti_la','testosterone','fai','shbg','bmd_lumbar','bmd_femur','age_health','age_target','glob','egfr']) {
      assert.equal(result(db,code),undefined,`Historical-only ${code} must not become a current result`);
    }
    assert.match(result(db,'dental').value_text,/治療|치료/);
    assert.match(result(db,'prostate_symptoms').value_text,/비뇨기과/);
    assert.match(result(db,'mental_assessment').value_text,/수면 7: 주의/);
    assert.match(result(db,'cvd_occupational').value_text,/중등도위험군/);
    assert.match(result(db,'coronary_risk').value_text,/저위험군/);
  } finally { db.close(); }
});

test('imported metrics appear in the health API with correct flags and previous-year comparison', async () => {
  const db=fixture();
  const env={ DB:{prepare(query) {
    let values=[];
    return { bind(...v){values=v;return this;}, async first(){return db.prepare(query).get(...values) || null;},
      async all(){return {results:db.prepare(query).all(...values)};} };
  }}};
  try {
    const id=db.prepare("SELECT id FROM health_exams WHERE user_id=2 AND kind='checkup' AND exam_date='2026-10-01'").get().id;
    const detail=await examDetail(env,2,id);
    const rows=detail.groups.flatMap(g=>g.rows);
    assert.equal(rows.length,167);
    for(const [code,flag] of [['ldl','H'],['hdl','L'],['ferritin','L'],['vitd','L'],['pdw','L'],['glucose','N']]) {
      assert.equal(rows.find(r=>r.code===code).flag,flag,code);
    }
    const ldl=rows.find(r=>r.code==='ldl');
    assert.equal(ldl.cells[0].num,161);
    assert.equal(ldl.cells[1].num,148);
    assert.equal(await examDetail(env,1,id),null);
  } finally { db.close(); }
});
