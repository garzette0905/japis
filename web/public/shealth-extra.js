// Shared browser/CLI importer. Only referenced attachments from the selected export are read.
import { readCsv, utcMs, localDay, offsetMin, parseSamsungHealth } from './shealth-parse.js';

export const EXTRA_DATASETS = [
  'com.samsung.health.sleep_stage', 'com.samsung.shealth.sleep_snoring',
  'com.samsung.health.advanced_glycation_endproduct', 'com.samsung.health.hrv',
  'com.samsung.health.caffeine_intake', 'com.samsung.health.food_intake',
  'com.samsung.health.nutrition', 'com.samsung.health.hba1c',
  'com.samsung.health.sleep_apnea', 'com.samsung.shealth.stand_day_summary',
];
const metric = (code, label, unit, group, memo = '', digits = 1) =>
  ({ code, label, unit, group, memo, digits, chart: 'line' });
export const EXTRA_METRICS = [
  ...['awake', 'light', 'deep', 'rem'].flatMap((s, i) => [
    metric(`sleep_${s}_min`, ['수면 중 각성', '얕은 잠', '깊은 잠', 'REM 수면'][i], '분', 'sleep'),
    metric(`sleep_${s}_pct`, ['각성 비율', '얕은 잠 비율', '깊은 잠 비율', 'REM 비율'][i], '%', 'sleep', '단계가 확인된 전체 구간 대비'),
  ]),
  metric('snore_min', '코골이 시간', '분', 'sleep'),
  metric('snore_pct', '코골이 비율', '%', 'sleep', '수면 기록과 겹치는 코골이 시간 / 수면 기록 구간'),
  metric('sleep_latency_min', '잠들기까지 시간', '분', 'sleep'),
  metric('sleep_cycles', '수면 주기', '회', 'sleep', '그날 가장 긴 수면 기록', 0),
  metric('sleep_mental', '정신 회복 점수', '점', 'sleep'),
  metric('sleep_physical', '신체 회복 점수', '점', 'sleep'),
  metric('exercise_distance', '운동 거리', 'km', 'activity'),
  metric('exercise_pace', '운동 페이스', '분/km', 'activity', '거리가 있는 운동의 총 시간 / 총 거리'),
  metric('exercise_hr', '운동 중 심박수', 'bpm', 'heart', '운동 시간으로 가중 평균'),
  metric('vo2_max', 'VO₂ max', 'ml/kg/min', 'heart', '측정일의 마지막 양수 기록'),
  metric('ages', 'AGEs 지수', '점', 'body', '같은 날 마지막으로 갱신된 기기 지수. 의학적 판정 아님', 0),
  metric('hrv_sdnn', 'HRV · SDNN', 'ms', 'heart', '세부 측정 구간의 시간 가중 평균'),
  metric('hrv_rmssd', 'HRV · RMSSD', 'ms', 'heart', '세부 측정 구간의 시간 가중 평균'),
  metric('hr_detail', '상세 심박수', 'bpm', 'heart', '세부 측정 구간의 시간 가중 평균'),
  metric('hr_detail_min', '상세 최저 심박수', 'bpm', 'heart'),
  metric('hr_detail_max', '상세 최고 심박수', 'bpm', 'heart'),
  metric('spo2_detail', '상세 혈중 산소', '%', 'heart', '세부 측정 구간의 시간 가중 평균'),
  metric('spo2_detail_min', '상세 최저 혈중 산소', '%', 'heart'),
  metric('spo2_detail_max', '상세 최고 혈중 산소', '%', 'heart'),
  metric('skin_detail', '상세 피부 온도', '°C', 'body'),
  metric('skin_detail_min', '최저 피부 온도', '°C', 'body'),
  metric('skin_detail_max', '최고 피부 온도', '°C', 'body'),
  metric('caffeine', '카페인 섭취', 'mg', 'etc'),
  metric('food_kcal', '식사 칼로리', 'kcal', 'etc'),
  metric('nutrition_kcal', '영양 기록 칼로리', 'kcal', 'etc', '식사 칼로리와 별도 기록. 합산하지 않음'),
  ...[['protein', '단백질', 'g'], ['carbohydrate', '탄수화물', 'g'], ['total_fat', '지방', 'g'], ['sodium', '나트륨', 'mg'], ['sugar', '당류', 'g']].map(([c,l,u]) => metric(`nutrition_${c}`, l, u, 'etc')),
  metric('hba1c', '당화혈색소', '%', 'body', '직접 기록된 측정값'),
];
export const DETAIL_CODES = new Set(['hrv_sdnn','hrv_rmssd','hr_detail','spo2_detail','skin_detail']);
export const RECORD_KINDS = new Set(['exercise', 'apnea', 'stand', 'food', 'nutrition']);
const num = (x) => x === '' || x == null || !Number.isFinite(Number(x)) ? null : Number(x);
const round = (n) => Math.round(n * 1000) / 1000;

function table(files, name) {
  if (!files[name]) return [];
  const t = readCsv(files[name]);
  const seen = new Map();
  for (const r of t.rows) {
    const get = (k) => r[t.col(k)] ?? '';
    const id = get('datauuid') || JSON.stringify(r);
    if (!seen.has(id) || get('update_time') > seen.get(id)('update_time')) seen.set(id, get);
  }
  return [...seen.values()].sort((a,b) => a('update_time').localeCompare(b('update_time')) || a('datauuid').localeCompare(b('datauuid')));
}
export function unionIntervals(list) {
  const out = [];
  for (const [s,e] of list.filter(([s,e]) => Number.isFinite(s) && Number.isFinite(e) && e>s).sort((a,b)=>a[0]-b[0] || a[1]-b[1])) {
    const last = out.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1],e); else out.push([s,e]);
  }
  return out;
}
const duration = (list) => unionIntervals(list).reduce((s,[a,b])=>s+b-a,0);
const intersection = (a,b) => a.flatMap(([s,e])=>b.map(([x,y])=>[Math.max(s,x),Math.min(e,y)])).filter(([s,e])=>e>s);

// Exact interval sweep: overlapping windows/devices contribute only once. A later-starting
// window wins; ties use export update order. Split at local hour boundaries afterwards.
export function weightedIntervals(samples) {
  const events=[];
  samples.forEach((s,id)=>{ if (s.e>s.s && Number.isFinite(s.v)) {events.push([s.s,1,id],[s.e,0,id]);} });
  events.sort((a,b)=>a[0]-b[0] || a[1]-b[1]);
  const active=new Set(), out=[];
  let i=0, prev=null;
  while(i<events.length){
    const time=events[i][0];
    if(prev!==null && time>prev && active.size){
      let best=-1;
      for(const id of active) if(best<0 || samples[id].s>samples[best].s || (samples[id].s===samples[best].s && id>best)) best=id;
      out.push({...samples[best],s:prev,e:time});
    }
    while(i<events.length && events[i][0]===time){const [,on,id]=events[i++];if(on)active.add(id);else active.delete(id);}
    prev=time;
  }
  return out;
}

export async function parseSamsungHealthExport(files, readAttachment = async () => null, progress = () => {}) {
  const rows = parseSamsungHealth(files), hourly=[], records=[], warnings=[];
  const daily=new Map();
  const maxDay=new Date(Date.now()+86400000).toISOString().slice(0,10);
  const add=(day,code,v,how='last',at=0,weight=1)=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day||'') || day<'2000-01-01' || day>maxDay || !Number.isFinite(v))return;
    const key=day+'|'+code, old=daily.get(key);
    if(!old)daily.set(key,{day,code,v,at,w:weight,how});
    else if(how==='sum')old.v+=v;
    else if(how==='avg'){old.v+=v*weight;old.w+=weight;}
    else if(how==='min')old.v=Math.min(old.v,v);
    else if(how==='max')old.v=Math.max(old.v,v);
    else if(at>=old.at){old.v=v;old.at=at;}
    if(!old && how==='avg')daily.get(key).v=v*weight;
  };
  const rec=(kind,g,day,data)=>{if(day && day<=maxDay && day>='2000-01-01')records.push({kind,id:g('datauuid')||`${kind}:${g('start_time')||g('day_time')}`,day,data});};
  const day=(g)=>{const t=utcMs(g('start_time'));return t===null?null:localDay(t,offsetMin(g('time_offset')));};
  const nights=new Map(), sleepIds=new Map();
  for(const g of table(files,'com.samsung.shealth.sleep')){
    const s=utcMs(g('start_time')),e=utcMs(g('end_time')),off=offsetMin(g('time_offset'));
    if(s===null||e===null||e<=s||e-s>20*3600000)continue;
    const d=localDay(e,off),n={s,e,d,g};sleepIds.set(g('datauuid'),n);
    if(!nights.has(d))nights.set(d,[]);nights.get(d).push(n);
  }
  for(const [d,ns] of nights){
    const n=[...ns].sort((a,b)=>(b.e-b.s)-(a.e-a.s))[0];
    for(const [field,code,scale] of [['sleep_latency','sleep_latency_min',60000],['sleep_cycle','sleep_cycles',1],['mental_recovery','sleep_mental',1],['physical_recovery','sleep_physical',1]]){
      const v=num(n.g(field));if(v!==null && v>=0)add(d,code,v/scale);
    }
  }
  const stages=new Map();
  for(const g of table(files,'com.samsung.health.sleep_stage')){
    const n=sleepIds.get(g('sleep_id')),s=utcMs(g('start_time')),e=utcMs(g('end_time'));
    const code=({40001:'awake',40002:'light',40003:'deep',40004:'rem'})[g('stage')];
    if(!n||s===null||e===null||!code)continue;
    if(!stages.has(n.d))stages.set(n.d,[]);
    stages.get(n.d).push({s:Math.max(s,n.s),e:Math.min(e,n.e),v:Number(g('stage')),code});
  }
  for(const [d,ss] of stages){
    const clean=weightedIntervals(ss),total=clean.reduce((a,s)=>a+s.e-s.s,0);
    if(!total)continue;
    for(const code of ['awake','light','deep','rem']){const ms=clean.filter(s=>s.code===code).reduce((a,s)=>a+s.e-s.s,0);add(d,`sleep_${code}_min`,ms/60000);add(d,`sleep_${code}_pct`,100*ms/total);}
  }
  // Existing CSV REM/light totals are a fallback when linked stages are absent.
  for(const [d,ns] of nights)for(const [field,code] of [['total_rem_duration','rem'],['total_light_duration','light']]){
    if(stages.has(d))continue;
    const n=[...ns].sort((a,b)=>(b.e-b.s)-(a.e-a.s))[0],v=num(n.g(field));
    if(v!==null&&v>=0&&v<=(n.e-n.s)/60000)add(d,`sleep_${code}_min`,v);
  }
  const snores=table(files,'com.samsung.shealth.sleep_snoring').map(g=>[utcMs(g('start_time')),utcMs(g('end_time'))]).filter(([s,e])=>s!==null&&e!==null&&e>s);
  for(const [d,ns] of nights){
    const bed=unionIntervals(ns.map(n=>[n.s,n.e]));
    const clips=intersection(snores,bed),ms=duration(clips);
    if(clips.length){add(d,'snore_min',ms/60000);add(d,'snore_pct',100*ms/duration(bed));}
  }
  for(const g of table(files,'com.samsung.shealth.exercise')){
    const d=day(g),t=utcMs(g('start_time')),ms=num(g('duration'));
    if(!d||!ms||ms<60000)continue;
    const dist=num(g('distance')),hr=num(g('mean_heart_rate')),vo2=num(g('vo2_max'));
    const data={start:g('start_time'),end:g('end_time'),offset:g('time_offset'),type:g('exercise_type'),minutes:round(ms/60000),distance_km:dist>0?round(dist/1000):null,pace:dist>0?round(ms/60000/(dist/1000)):null,heart_rate:hr>=30&&hr<=220?hr:null,vo2_max:vo2>0&&vo2<100?vo2:null};
    rec('exercise',g,d,data);
    if(dist>0){add(d,'exercise_distance',dist/1000,'sum');add(d,'exercise_pace',ms/60000/(dist/1000),'avg',0,dist/1000);}
    if(hr>=30&&hr<=220)add(d,'exercise_hr',hr,'avg',0,ms);
    if(vo2>0&&vo2<100)add(d,'vo2_max',vo2,'last',t);
  }
  for(const g of table(files,'com.samsung.health.advanced_glycation_endproduct')){
    const v=num(g('score'));if(v!==null&&v>0 && g('measurement_result')==='0')add(g('day_time').slice(0,10),'ages',v,'last',utcMs(g('update_time'))||0);
  }
  for(const [dataset,field,code,how] of [
    ['caffeine_intake','amount','caffeine','sum'],['food_intake','calorie','food_kcal','sum'],['hba1c','hba1c','hba1c','last'],
  ])for(const g of table(files,'com.samsung.health.'+dataset)){
    const v=num(g(field)),d=day(g);if(v!==null&&v>=0)add(d,code,v,how,utcMs(g('start_time'))||0);
    if(dataset==='food_intake')rec('food',g,d,{name:g('name'),calorie:v,amount:num(g('amount')),meal_type:g('meal_type')});
  }
  for(const g of table(files,'com.samsung.health.nutrition')){
    const data={};for(const field of ['calorie','protein','carbohydrate','total_fat','sodium','sugar']){
      const v=num(g(field));if(v!==null&&v>=0){data[field]=v;add(day(g),field==='calorie'?'nutrition_kcal':'nutrition_'+field,v,'sum');}
    }
    // Preserve less common nutrients without guessing their units or adding them to meals.
    data.other={};
    for(const field of ['magnesium','potassium','vitamin_a','vitamin_c','vitamin_d','vitamin_e','vitamin_k','cholesterol','vitamin_b12','biotin','phosphorus','copper','thiamin','folate','iodine','niacin','molybdenum','folic_acid','dietary_fiber','caffeine','monosaturated_fat','manganese','polysaturated_fat','iron','zinc','riboflavin','added_sugar','calories_from_fat','calcium','polyunsaturated_fat','saturated_fat','trans_fat','selenium','vitamin_b6','unsaturated_fat','chloride','pantothenic_acid','chromium']){
      const v=num(g(field));if(v!==null&&v>=0)data.other[field]=v;
    }
    rec('nutrition',g,day(g),data);
  }
  for(const g of table(files,'com.samsung.health.sleep_apnea'))rec('apnea',g,day(g),{result:g('result'),note:'원본 결과 코드 · 삼성헬스 모니터에서 결과 확인'});
  for(const g of table(files,'com.samsung.shealth.stand_day_summary'))rec('stand',g,g('day_time').slice(0,10),{stand_time:g('stand_time'),note:'원본 stand_time 값 · 시간 단위로 환산하지 않음'});

  // Retain hourly summaries, not all raw samples. Missing/malformed attachments are reported.
  const detailSpecs=[
    ['com.samsung.health.hrv','binning_data',[['sdnn','hrv_sdnn',0,500],['rmssd','hrv_rmssd',0,500]]],
    ['com.samsung.shealth.tracker.heart_rate','binning_data',[['heart_rate','hr_detail',30,220]]],
    ['com.samsung.shealth.tracker.oxygen_saturation','binning_data',[['spo2','spo2_detail',70,100]]],
    ['com.samsung.health.skin_temperature','binning_data',[['mean','skin_detail',25,42]]],
  ];
  for(const [dataset,field,specs] of detailSpecs){
    const samples=new Map(specs.map(([,code])=>[code,[]]));
    const src=table(files,dataset);let done=0,missing=0;
    for(const g of src){
      const name=g(field)||g('binning');if(!name)continue;
      let json;try{json=await readAttachment(dataset,name);}catch{missing++;continue;}
      if(!Array.isArray(json)){missing++;continue;}
      const off=offsetMin(g('time_offset'));
      for(const sample of json){
        const s=Number(sample.start_time),e=Number(sample.end_time);
        if(!Number.isFinite(s)||!Number.isFinite(e)||s<946684800000||e<=s||e-s>3600000)continue;
        for(const [field,code,lo,hi] of specs){const v=num(sample[field]);if(v===null||v<lo||v>hi)continue;
          const prefix=field==='heart_rate'?'heart_rate':field==='spo2'?'spo2':'';
          const mn=num(sample[prefix?prefix+'_min':'min']),mx=num(sample[prefix?prefix+'_max':'max']);
          samples.get(code).push({s,e,v,off,min:mn!==null&&mn>=lo&&mn<=v?mn:v,max:mx!==null&&mx>=v&&mx<=hi?mx:v});
        }
      }
      if(++done%100===0)progress(dataset,done,src.length);
    }
    if(missing)warnings.push(`${dataset}: 세부 첨부 ${missing}개 누락 또는 형식 오류`);
    for(const [code,list] of samples){
      const hours=new Map();
      for(const s of weightedIntervals(list)){
        let t=s.s;
        while(t<s.e){
          const local=t+s.off*60000,boundary=(Math.floor(local/3600000)+1)*3600000-s.off*60000,end=Math.min(s.e,boundary);
          const d=localDay(t,s.off);if(d>maxDay){t=end;continue;}
          const hour=new Date(local).getUTCHours(),key=`${d}|${hour}`;
          const h=hours.get(key)||{d,hour,sum:0,ms:0,min:Infinity,max:-Infinity};
          h.sum+=s.v*(end-t);h.ms+=end-t;h.min=Math.min(h.min,s.min);h.max=Math.max(h.max,s.max);hours.set(key,h);t=end;
        }
      }
      for(const h of hours.values()){
        // Avoid a floating-point sum rounding just outside a constant sensor range.
        const mean=Math.min(h.max,Math.max(h.min,h.sum/h.ms));
        hourly.push([h.d,code,h.hour,round(mean),round(h.min),round(h.max),h.ms]);
        add(h.d,code,mean,'avg',0,h.ms);
        if(!code.startsWith('hrv_')){add(h.d,code+'_min',h.min,'min');add(h.d,code+'_max',h.max,'max');}
      }
    }
  }
  for(const s of daily.values())rows.push([s.day,s.code,round(s.how==='avg'?s.v/s.w:s.v)]);
  rows.sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1]));
  return {rows,hourly,records,warnings};
}
