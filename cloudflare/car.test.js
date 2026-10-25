import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import {carApi,validDate} from './car.js';
import {reminder,addMonths} from '../web/public/car.js';
import worker from './index.js';

function fixture() {
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY); INSERT INTO users VALUES (1),(2);');
  db.exec(fs.readFileSync(new URL('../migrations/023_car.sql',import.meta.url),'utf8'));
  const data={profile:{model:'Test car'},records:[{date:'2024-01-01',km:10000,kind:'oil'},{date:'2025-01-01',km:null,kind:'oil'},{date:'2025-02-01',km:20000,kind:'inspection'}],sources:[{file:'hero.jpg',name:'Private photo'}]};
  db.prepare('INSERT INTO car_profiles(user_id,data_json) VALUES(1,?)').run(JSON.stringify(data));
  const env={DB:{prepare(sql){return {bind(...params){return {first:async()=>db.prepare(sql).get(...params)||null,all:async()=>({results:db.prepare(sql).all(...params)}),run:async()=>({meta:db.prepare(sql).run(...params)})};}}}},WIKI_FILES:{get:async key=>key==='car/1/hero.jpg'?{body:'private bytes',httpMetadata:{contentType:'image/jpeg'}}:null}};
  const call=(path,method='GET',body,uid=1)=>carApi(new Request('https://test.example'+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined}),env,uid,path);
  return {db,env,call};
}
test('car data and originals belong to one account, use private caching, and reject unknown filenames',async()=>{
  const {db,call}=fixture();try{
    let res=await call('/api/car');assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'private, no-store');
    assert.equal((await call('/api/car','GET',null,2)).status,404);
    assert.equal((await call('/api/car/files/hero.jpg','GET',null,2)).status,404);
    res=await call('/api/car/files/hero.jpg');assert.equal(await res.text(),'private bytes');assert.equal(res.headers.get('cache-control'),'private, no-store');
    assert.equal((await call('/api/car/files/../other')).status,404);
  }finally{db.close();}
});
test('car writes validate chronology and input; deletion is scoped; records persist and intervals can be cleared',async()=>{
  const {db,call}=fixture();try{
    const entry={kind:'mileage',date:'2025-03-01',km:21000,cost:null,title:'Reading',notes:''};
    assert.equal((await call('/api/car/entries','POST',{...entry,km:19000})).status,400);
    assert.equal((await call('/api/car/entries','POST',{...entry,date:'2024-02-01',km:25000})).status,400);
    assert.equal((await call('/api/car/entries','POST',{...entry,date:'2025-02-30'})).status,400);
    assert.equal((await call('/api/car/entries','POST',{...entry,km:1.5})).status,400);
    assert.equal((await call('/api/car/entries','POST',{...entry,km:null})).status,400);
    assert.equal((await call('/api/car/entries','POST',{...entry,date:'2099-01-01'})).status,400);
    assert.equal((await call('/api/car/entries','POST',entry)).status,201);
    let data=await (await call('/api/car')).json();assert.equal(data.entries.length,1);assert.equal(data.entries[0].km,21000);
    // A second owner cannot delete the first owner's entry.
    db.prepare('INSERT INTO car_profiles(user_id,data_json) SELECT 2,data_json FROM car_profiles WHERE user_id=1').run();
    await call('/api/car/entries/1','DELETE',null,2);
    assert.equal((await (await call('/api/car')).json()).entries.length,1);
    assert.equal((await call('/api/car/intervals','POST',{oilKm:10000,oilMonths:12,tireKm:0})).status,400);
    assert.equal((await call('/api/car/intervals','POST',{oilKm:10000,oilMonths:12})).status,200);
    data=await(await call('/api/car')).json();assert.equal(data.intervals.oilKm,10000);
    await call('/api/car/intervals','POST',{});assert.equal((await(await call('/api/car')).json()).intervals.oilKm,null);
    await call('/api/car/entries/1','DELETE');assert.equal((await(await call('/api/car')).json()).entries.length,0);
    assert.equal((await call('/api/car/entries','POST',{...entry,kind:'oil',km:null})).status,201);
  }finally{db.close();}
});
test('oil reminders use latest actual replacement without falling back to older known km; purchases never count as mounting',()=>{
  const records=[{date:'2023-01-01',km:10000,kind:'oil'},{date:'2024-01-31',km:null,kind:'oil'},{date:'2023-11-16',km:null,kind:'tire-purchase'}];
  const r=reminder(records,'oil',10000,1,50000,'2024-03-01');
  assert.equal(r.targetKm,null);assert.equal(r.targetDate,'2024-02-29');assert.equal(r.overdue,true);
  assert.equal(reminder(records,'tire',40000,60,50000).latest,null);
  assert.equal(addMonths('2023-01-31',1),'2023-02-28');
  const corrected=reminder([...records,{date:'2024-01-31',km:30000,kind:'oil',manual:true,id:1}],'oil',10000,1,35000,'2024-02-01');
  assert.equal(corrected.targetKm,40000);
  assert.equal(reminder([{date:'2024-01-01',km:10000,kind:'oil'}],'oil',10000,null,20000,'2024-01-02').overdue,true);
  assert.equal(validDate('2024-02-29'),true);assert.equal(validDate('2023-02-29'),false);
});

test('signed-in users still need car permission; allowed accounts only see their own profile',async()=>{
  const user={id:2,role:'user',status:'active',password_hash:'test-password-fingerprint',session_epoch:0};
  const secret='car-test-session-secret';
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('test'))).toString('base64url').slice(0,32);
  let allowed=false;
  const env={SESSION_SECRET:secret,SESSIONS:{get:async()=>({uid:2,pwv:user.password_hash.slice(-16),sev:0})},DB:{prepare(sql){return {bind(){return this;},all:async()=>({results:allowed?[{service_key:'car',allowed:1,reauth:0}]:[]}),first:async()=>sql.includes('FROM users')?user:sql.includes('FROM user_services')?(allowed?{allowed:1,reauth:0}:null):null};}}};
  const request=path=>new Request('http://localhost'+path,{headers:{Cookie:`jsid=test.${sig}`}});
  assert.equal((await worker.fetch(request('/api/car'),env,{})).status,403);
  assert.equal((await worker.fetch(request('/api/car/files/hero.jpg'),env,{})).status,403);
  allowed=true;
  assert.equal((await worker.fetch(request('/api/car'),env,{})).status,404);
  user.must_change_pw=1;
  assert.equal((await worker.fetch(request('/api/car'),env,{})).status,403);
});
test('every car route requires login and cross-origin mutations are rejected before reaching storage',async()=>{
  for(const path of ['/api/car','/api/car/files/hero.jpg','/api/car/entries','/api/car/intervals']) {
    const res=await worker.fetch(new Request('http://localhost'+path),{SESSION_SECRET:'test-secret-not-for-production',SESSIONS:{get:async()=>null}},{});
    assert.equal(res.status,401,path);
  }
  const res=await worker.fetch(new Request('http://localhost/api/car/entries',{method:'POST',headers:{Origin:'https://other.example'}}),{},{});
  assert.equal(res.status,403);
});
