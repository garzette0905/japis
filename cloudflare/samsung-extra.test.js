import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseSamsungHealthExport, weightedIntervals, EXTRA_METRICS } from '../web/public/shealth-extra.js';
import { DATASETS } from '../web/public/shealth-parse.js';
import { samsungImport, samsungDetails, samsungOverview, SAMSUNG_METRICS } from './samsung.js';

const csv=(header,rows)=>`dataset,1,1\n${header}\n${rows.map(r=>r.join(',')).join('\n')}\n`;
const value=(r,day,code)=>r.rows.find(x=>x[0]===day&&x[1]===code)?.[2];
const fixture=()=>{
  const db=new DatabaseSync(':memory:');
  for(const file of ['018_health_daily.sql','022_health_details.sql','022_health_details.sql'])db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  const env={DB:{prepare(sql){let args=[];return {bind(...v){args=v;return this;},sql:()=>sql,args:()=>args,
    async all(){return {results:db.prepare(sql).all(...args)};},async first(){return db.prepare(sql).get(...args)||null;}};},
    async batch(stmts){db.exec('BEGIN');try{const result=stmts.map(s=>db.prepare(s.sql().replace(/\?\d+/g,'?')).run(...s.args()));db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
  }};return {db,env};
};
const request=body=>new Request('https://test/import',{method:'POST',body:JSON.stringify(body)});

test('sleep stages link to waking day, conflicting duplicate intervals do not inflate percentages, snoring is clipped and deduplicated',async()=>{
  const f={
    'com.samsung.shealth.sleep':csv('datauuid,start_time,end_time,time_offset,sleep_latency,sleep_cycle',[
      ['s1','2026-10-23 14:00:00.000','2026-10-23 22:00:00.000','UTC+0900',600000,4],
    ]),
    'com.samsung.health.sleep_stage':csv('datauuid,sleep_id,start_time,end_time,stage',[
      ['a','s1','2026-10-23 14:00:00.000','2026-10-23 18:00:00.000',40002],
      ['b','s1','2026-10-23 18:00:00.000','2026-10-23 22:00:00.000',40003],
      ['c','s1','2026-10-23 18:00:00.000','2026-10-23 22:00:00.000',40003],
      ['orphan','missing','2026-10-23 18:00:00.000','2026-10-23 22:00:00.000',40004],
    ]),
    'com.samsung.shealth.sleep_snoring':csv('datauuid,start_time,end_time',[
      ['a','2026-10-23 13:50:00.000','2026-10-23 14:10:00.000'],
      ['b','2026-10-23 14:00:00.000','2026-10-23 14:10:00.000'],
    ]),
  };
  const r=await parseSamsungHealthExport(f);
  assert.equal(value(r,'2026-10-24','sleep_light_min'),240);
  assert.equal(value(r,'2026-10-24','sleep_deep_min'),240);
  assert.equal(value(r,'2026-10-24','sleep_deep_pct'),50);
  assert.equal(value(r,'2026-10-24','snore_min'),10);
  assert.equal(value(r,'2026-10-24','sleep_latency_min'),10);
  assert.equal(value(r,'2026-10-23','sleep_light_min'),undefined);
});

test('overlapping HRV windows are counted once, time weighted and split across local midnight',async()=>{
  const t=Date.parse('2026-10-23T14:30:00Z');
  const f={'com.samsung.health.hrv':csv('datauuid,start_time,time_offset,binning_data',[
    ['a','2026-10-23 14:30:00.000','UTC+0900','a.json'],
  ])};
  const r=await parseSamsungHealthExport(f,async()=>[
    {start_time:t,end_time:t+3600000,sdnn:20,rmssd:40},
    {start_time:t+1800000,end_time:t+3600000,sdnn:40,rmssd:60},
  ]);
  assert.equal(value(r,'2026-10-23','hrv_sdnn'),20);
  assert.equal(value(r,'2026-10-24','hrv_sdnn'),40);
  assert.equal(r.hourly.find(x=>x[0]==='2026-10-24'&&x[1]==='hrv_sdnn')[6],1800000);
  const intervals=weightedIntervals([{s:0,e:10,v:10},{s:5,e:15,v:20}]);
  assert.equal(intervals.reduce((n,s)=>n+s.e-s.s,0),15);
});

test('weighted detail averages differ from sample averages and include sensor min/max',async()=>{
  const t=Date.parse('2026-10-23T15:00:00Z');
  const f={'com.samsung.shealth.tracker.oxygen_saturation':csv('datauuid,start_time,time_offset,binning',[
    ['a','2026-10-23 15:00:00.000','UTC+0900','a.json'],
  ])};
  const r=await parseSamsungHealthExport(f,async()=>[
    {start_time:t,end_time:t+60000,spo2:90,spo2_min:88,spo2_max:92},
    {start_time:t+60000,end_time:t+600000,spo2:100,spo2_min:99,spo2_max:100},
  ]);
  assert.equal(value(r,'2026-10-24','spo2_detail'),99);
  assert.equal(value(r,'2026-10-24','spo2_detail_min'),88);
  assert.equal(value(r,'2026-10-24','spo2_detail_max'),100);
});

test('exercise pacing is distance weighted, HR duration weighted, VO2 separate and AGEs uses latest update',async()=>{
  const f={
    'com.samsung.shealth.exercise':csv('datauuid,start_time,duration,distance,mean_heart_rate,vo2_max',[
      ['a','2026-10-23 15:00:00.000',600000,1000,100,40],
      ['b','2026-10-23 16:00:00.000',1200000,4000,130,50],
    ]),
    'com.samsung.health.advanced_glycation_endproduct':csv('datauuid,day_time,score,measurement_result,update_time',[
      ['b','2026-10-24 00:00:00.000',400,0,'2026-10-24 02:00:00.000'],
      ['a','2026-10-24 00:00:00.000',300,0,'2026-10-24 01:00:00.000'],
    ]),
  };
  const r=await parseSamsungHealthExport(f);
  assert.equal(value(r,'2026-10-24','exercise_pace'),6);
  assert.equal(value(r,'2026-10-24','exercise_hr'),120);
  assert.equal(value(r,'2026-10-24','vo2_max'),50);
  assert.equal(value(r,'2026-10-24','ages'),400);
  assert.equal(r.records.length,2);
});

test('sparse records retain zero codes without invented medical or time conversions; attachment failures are explicit',async()=>{
  const f={
    'com.samsung.health.sleep_apnea':csv('datauuid,start_time,result',[['a','2026-10-23 15:00:00.000',0]]),
    'com.samsung.shealth.stand_day_summary':csv('datauuid,day_time,stand_time',[['b','2026-10-24 00:00:00.000',174080]]),
    'com.samsung.health.hba1c':csv('datauuid,start_time,hba1c',[['c','2025-01-20 02:20:00.000',5.9]]),
    'com.samsung.health.hrv':csv('datauuid,start_time,binning_data',[['d','2026-10-23 15:00:00.000','missing.json']]),
  };
  const r=await parseSamsungHealthExport(f);
  assert.equal(r.records.find(x=>x.kind==='apnea').data.result,'0');
  assert.equal(r.records.find(x=>x.kind==='stand').data.stand_time,'174080');
  assert.equal(value(r,'2025-01-20','hba1c'),5.9);
  assert.equal(r.warnings.length,1);
  assert.equal(r.hourly.length,0);
});

test('repeat import updates all stores, isolates users, validates rows and paginates whole days',async()=>{
  const {db,env}=fixture();
  try{
    const body={rows:[['2026-10-24','ages',400],['2026-02-30','ages',5],['2026-10-24','unknown',1]],
      hourly:[['2026-10-24','hrv_sdnn',0,20,10,30,60000],['2026-10-24','hrv_sdnn',24,20,10,30,60000]],
      records:[{kind:'exercise',id:'a',day:'2026-10-24',data:{type:'1001',minutes:10}}]};
    const response=await samsungImport(request(body),env,1);
    assert.deepEqual(await response.json(),{ok:true,saved:1,hourly:1,records:1,skipped:3});
    await samsungImport(request(body),env,1);
    assert.equal(db.prepare('SELECT count(*) n FROM health_records').get().n,1);
    assert.equal(db.prepare('SELECT count(*) n FROM health_hourly').get().n,1);
    assert.equal(db.prepare('SELECT count(*) n FROM health_daily').get().n,1);
    const none=await samsungDetails(env,2,new URL('https://test?kind=exercise'));
    assert.deepEqual((await none.json()).records,[]);
    const own=await samsungDetails(env,1,new URL('https://test?code=hrv_sdnn&day=2026-10-24'));
    assert.equal((await own.json()).points[0].value,20);
    assert.equal((await samsungDetails(env,1,new URL('https://test?code=ages&day=2026-10-24'))).status,400);
    const records=Array.from({length:35},(_,i)=>({kind:'exercise',id:`e${i}`,day:`2026-09-${String(Math.min(i+1,30)).padStart(2,'0')}`,data:{minutes:1}}));
    await samsungImport(request({records}),env,1);
    const page=await (await samsungDetails(env,1,new URL('https://test?kind=exercise'))).json();
    const page2=await (await samsungDetails(env,1,new URL('https://test?kind=exercise&before='+page.next))).json();
    assert.equal(new Set([...page.records,...page2.records].map(r=>r.id)).size,36);
  }finally{db.close();}
});

test('new daily codes are known to the API and new CSV datasets are selectable',()=>{
  for(const m of EXTRA_METRICS)assert.ok(SAMSUNG_METRICS.some(x=>x.code===m.code));
  assert.equal(new Set(SAMSUNG_METRICS.map(m=>m.code)).size,SAMSUNG_METRICS.length);
  for(const d of ['com.samsung.health.sleep_stage','com.samsung.health.hrv','com.samsung.health.sleep_apnea'])assert.ok(DATASETS.includes(d));
});

test('overview retains the actual latest value for historical-only sparse metrics',async()=>{
  const {db,env}=fixture();
  try{
    await samsungImport(request({rows:[['2025-01-20','hba1c',5.9],['2026-10-24','ages',400]]}),env,1);
    const r=await samsungOverview(env,1);
    const m=r.metrics.find(x=>x.code==='hba1c');
    assert.deepEqual(m.latest,{day:'2025-01-20',value:5.9});
    assert.equal(m.avg7,null);
  }finally{db.close();}
});

test('CLI dry run can import a records-only export and generated SQL is idempotent',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'japis-samsung-test-'));
  const input=path.join(dir,'com.samsung.health.sleep_apnea.20261024222240.csv');
  const output=path.join(dir,'import.sql');
  const root=fileURLToPath(new URL('../',import.meta.url));
  writeFileSync(input,csv('datauuid,start_time,result',[['only-apnea','2026-10-23 15:00:00.000',0]]));
  const {db}=fixture();
  try{
    db.exec("CREATE TABLE users(id INTEGER,email TEXT);INSERT INTO users VALUES(1,'test@example.com')");
    const run=spawnSync(process.execPath,['tools/samsung-health-import.mjs',dir,'--all','--dry','--email','test@example.com','--out',output],{cwd:root,encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    const sql=readFileSync(output,'utf8');db.exec(sql);db.exec(sql);
    assert.equal(db.prepare('SELECT count(*) n FROM health_records').get().n,1);
    assert.equal(JSON.parse(db.prepare('SELECT data FROM health_records').get().data).result,'0');
    assert.equal(db.prepare('SELECT first_day FROM health_daily_imports LIMIT 1').get().first_day,'2026-10-24');
  }finally{
    db.close();unlinkSync(input);try{unlinkSync(output);}catch{}rmdirSync(dir);
  }
});

test('travel can repeat a local hour and constant samples stay within rounded extrema',async()=>{
  const f={'com.samsung.health.hrv':csv('datauuid,start_time,time_offset,binning_data',[
    ['a','2026-10-23 15:00:00.000','UTC+0900','a.json'],
    ['b','2026-10-23 16:00:00.000','UTC+0800','b.json'],
  ])};
  const t=Date.parse('2026-10-23T15:00:00Z');
  const parsed=await parseSamsungHealthExport(f,async(_ds,file)=>{
    const start=t+(file==='b.json'?3600000:0);
    return [{start_time:start,end_time:start+3600000,sdnn:89.2055,rmssd:224.1655}];
  });
  assert.equal(parsed.hourly.length,2);
  for(const r of parsed.hourly){assert.equal(r[6],7200000);assert.ok(r[3]>=r[4]&&r[3]<=r[5]);}
  const {db,env}=fixture();
  try{
    const r=await (await samsungImport(request({hourly:parsed.hourly}),env,1)).json();
    assert.equal(r.hourly,2);assert.equal(r.skipped,0);
  }finally{db.close();}
});
