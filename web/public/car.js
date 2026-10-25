import { api, esc, toast } from './util.js';
const n = value => value == null ? '미확인' : Number(value).toLocaleString('ko-KR');
const today = () => new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});
const kinds = {mileage:'주행거리',oil:'엔진오일',tire:'타이어 교체',repair:'수리·정비',inspection:'자동차 검사',diagnosis:'점검·권고',package:'쿠폰 구매','tire-purchase':'타이어 구매',quote:'가격 안내',evidence:'사진 기록',insurance:'보험',admission:'입출고'};
const sourceUrl = file => `/api/car/files/${encodeURIComponent(file)}`;

export function addMonths(date, count) {
  const d = new Date(`${date}T00:00:00Z`), day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth()+count);
  const last = new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
  d.setUTCDate(Math.min(day,last)); return d.toISOString().slice(0,10);
}
export function reminder(records, kind, kmInterval, months, current, date = today()) {
  const latest = records.filter(r=>r.kind===kind).sort((a,b)=>b.date.localeCompare(a.date) || Number(!!b.manual)-Number(!!a.manual) || (Number(b.id)||0)-(Number(a.id)||0))[0];
  if(!latest) return {latest:null, targetKm:null, targetDate:null, overdue:false};
  const targetKm = latest.km!=null && kmInterval ? latest.km+kmInterval : null;
  const targetDate = months ? addMonths(latest.date,months) : null;
  return {latest,targetKm,targetDate,overdue:(targetKm!=null && current!=null && current>=targetKm) || (targetDate!=null && date>=targetDate)};
}
function allRecords(data) {
  return [...data.records,...data.entries.map(r=>({...r,items:r.notes ? [r.notes] : [],sources:[],status:'직접 입력',manual:true}))];
}
function links(data, files) {
  return (files || []).map(file=>`<a target="_blank" rel="noopener" href="${sourceUrl(file)}">${esc(data.sources.find(s=>s.file===file)?.name || file)}</a>`).join('');
}
const field = (name,label,type='number',extra='') => `<label>${label}<input name="${name}" type="${type}" ${extra}></label>`;
function formHtml() {
  return `<details class="car-card"><summary>주행거리·교환·정비 기록 추가</summary><form id="car-entry" class="car-form">
  <label>기록 종류<select name="kind">${['mileage','oil','tire','repair'].map(k=>`<option value="${k}">${kinds[k]}</option>`).join('')}</select></label>
  ${field('date','기록일','date',`required value="${today()}" max="${today()}"`)}
  ${field('km','누적 주행거리 (km)','number','min="0" max="10000000" step="1" placeholder="현재 계기판 km" required')}
  ${field('title','정비명 / 제품명','text','maxlength="200" placeholder="예: 엔진오일 및 오일필터 교환"')}
  ${field('cost','금액 (원, 선택)','number','min="0" step="1"')}
  <label class="car-wide">메모<textarea name="notes" maxlength="10000" rows="3" placeholder="정비소, 교환 부품, 타이어 장착 수량 등을 남겨주세요."></textarea></label>
  <p class="muted car-wide">주행거리는 누적 계기판 수치를 입력하세요. 교환 당시 km를 모르면 교환·정비 기록의 km는 비워둘 수 있습니다.</p>
  <button class="btn-primary" type="submit">기록 저장</button><p class="car-error" role="alert"></p></form></details>`;
}
function infoHtml(data) {
  const p=data.profile;
  const fields=[['차량번호',p.plate],['소유자',p.owner],['최초 등록일',p.registration],['모델 연도',p.year],['차대번호',p.vin],['차종 · 용도',p.type],['형식',p.modelCode],['원동기 형식',p.engine],['연료',p.fuel],['배기량',p.displacement],['정격출력',p.power],['승차정원',p.seats],['길이 × 너비 × 높이',p.dimensions],['총중량',p.weight],['등록증 연비',p.efficiency],['다음 검사일 (검사서)',p.nextInspection],['자동차 보험',p.insurance]];
  return `<section class="car-card"><h2>자동차 등록 정보</h2><dl class="car-specs">${fields.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl><details><summary>등록증 원본 보기</summary><div class="car-sources">${links(data,p.registrationSources)}</div></details></section>
  <section class="car-card"><h2>자동차 사진</h2><div class="car-gallery">${[p.photo,p.gallery].map(f=>`<a href="${sourceUrl(f)}" target="_blank" rel="noopener"><img src="${sourceUrl(f)}" alt="내 Audi 자동차 사진" loading="lazy"></a>`).join('')}</div></section>`;
}
function maintenanceHtml(data) {
  return `<div class="car-card"><h2>전체 정비·차량 기록</h2><p class="muted">작업·구매·검사·견적을 구분했습니다. 미확인 금액과 km는 추정하지 않습니다.</p><div class="car-filters"><label>내역 검색<input id="car-search" type="search" placeholder="부품·정비소·날짜·메모 검색"></label><label>종류<select id="car-kind"><option value="">전체 종류</option>${Object.entries(kinds).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label></div><p id="car-count" aria-live="polite"></p><div id="car-records"></div></div>${formHtml()}`;
}
function recordHtml(data,r) {
  return `<details class="car-record"><summary><span class="car-record-date">${esc(r.date)}<small>${r.km==null?'km 미확인':n(r.km)+' km'}</small></span><span class="car-record-title"><span class="car-badge">${esc(kinds[r.kind] || r.kind)}</span><strong>${esc(r.title || kinds[r.kind])}</strong><small>${esc(r.status || '')}</small></span><span>${r.cost==null?'금액 미확인':n(r.cost)+'원'}</span></summary><div class="car-record-body"><ul>${(r.items || []).map(s=>`<li>${esc(s)}</li>`).join('')}</ul>${r.notes ? `<p class="car-note">${esc(r.notes)}</p>`:''}<div class="car-sources">${links(data,r.sources)}</div>${r.manual?`<button type="button" class="btn-secondary" data-delete="${Number(r.id)}">입력 기록 삭제</button>`:''}</div></details>`;
}
function planHtml(data,records) {
  const i=data.intervals;
  const manual=data.entries.filter(e=>e.kind==='mileage').sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id)[0];
  const observed=records.filter(r=>r.km!=null).sort((a,b)=>b.date.localeCompare(a.date)||(b.km-a.km))[0];
  const current = observed?.km ?? null;
  const block=(kind,km,months)=>{
    const r=reminder(records,kind,km,months,current);
    return `<section class="car-card"><div class="car-eyebrow">${esc(kinds[kind])} 관리</div><h2>${r.overdue?'설정한 교환 목표 도달':!km&&!months?'알림 주기를 설정해주세요':'다음 교환 목표'}</h2><dl class="car-specs"><div><dt>최근 확인된 교환일</dt><dd>${esc(r.latest?.date || '교환 기록 없음')}</dd></div><div><dt>교환 당시 km</dt><dd>${r.latest?.km==null?'미확인':n(r.latest.km)+' km'}</dd></div><div><dt>목표 누적 km</dt><dd>${r.targetKm==null?'교환 km·주기 입력 필요':n(r.targetKm)+' km'}</dd></div><div><dt>목표 날짜</dt><dd>${esc(r.targetDate || '교환일·개월 주기 입력 필요')}</dd></div><div><dt>목표까지 거리</dt><dd>${r.targetKm==null||current==null?'계산 대기':r.targetKm-current>=0?n(r.targetKm-current)+' km':n(current-r.targetKm)+' km 초과'}</dd></div></dl><p class="muted">설정한 거리와 날짜 중 먼저 도달하는 시점을 표시합니다.${kind==='tire'?' 구매내역은 장착 완료 기록에 포함하지 않습니다.':''}</p></section>`;
  };
  return `<div class="car-metrics"><section class="car-card"><div class="car-eyebrow">최근 직접 입력한 운행 km</div><h2>${manual?n(manual.km)+' km':'입력 대기'}</h2><p>${manual?esc(manual.date):'운행 km를 아래에서 입력해주세요.'}</p></section><section class="car-card"><div class="car-eyebrow">자료·입력 전체의 최신 주행거리</div><h2>${n(current)} ${current==null?'':'km'}</h2><p>${esc(observed?.date || '')} 당시 · 현재 계기판 수치와 다를 수 있습니다.</p></section></div>
  <div class="car-metrics">${block('oil',i.oilKm,i.oilMonths)}${block('tire',i.tireKm,i.tireMonths)}</div>
  ${formHtml()}<details class="car-card" open><summary>교환 알림 주기 설정</summary><p class="muted">정비소·차량 설명서를 확인해 원하는 주기를 입력하세요. 자동으로 제조사 권장 주기를 적용하지 않습니다.</p><form id="car-intervals" class="car-form">${field('oilKm','엔진오일 거리 주기 (km)','number',`min="1" max="1000000" step="1" value="${i.oilKm || ''}"`)}${field('oilMonths','엔진오일 기간 (개월)','number',`min="1" max="120" step="1" value="${i.oilMonths || ''}"`)}${field('tireKm','타이어 거리 주기 (km)','number',`min="1" max="1000000" step="1" value="${i.tireKm || ''}"`)}${field('tireMonths','타이어 기간 (개월)','number',`min="1" max="120" step="1" value="${i.tireMonths || ''}"`)}<button class="btn-primary" type="submit">알림 주기 저장</button><p class="car-error" role="alert"></p></form></details>
  <section class="car-card"><h2>정비 자료에서 확인할 다음 항목</h2><ul>${(data.followUps || []).map(item=>`<li>${esc(item)}</li>`).join('')}</ul></section><section class="car-card"><h2>주행·교환 기록</h2>${records.filter(r=>['mileage','oil','tire','tire-purchase'].includes(r.kind)).sort((a,b)=>b.date.localeCompare(a.date)).map(r=>recordHtml(data,r)).join('')}</section>`;
}
export async function renderCar(page,tab='info') {
  if(!['info','history','driving'].includes(tab)) tab='info';
  const route = location.hash;
  page.innerHTML='<p class="muted" role="status">자동차 기록을 불러오는 중…</p>';
  let data;
  try {data=await api('/api/car');} catch(e) {if(location.hash===route)page.innerHTML=`<div class="car-card"><h1>내 자동차 정보</h1><p role="alert">${esc(e.message)}</p><button id="car-retry" class="btn-secondary">다시 불러오기</button></div>`; page.querySelector('#car-retry')?.addEventListener('click',()=>renderCar(page,tab));return;}
  if(location.hash!==route) return;
  const records=allRecords(data);
  document.title='내 자동차 정보 · JAPIS';
  page.innerHTML=`<div class="car-page"><header class="car-hero"><img src="${sourceUrl(data.profile.photo)}" alt="내 Audi A6 자동차"><div><div class="car-eyebrow">나의 자동차</div><h1>내 자동차 정보</h1><p>${esc(data.profile.model)} · ${esc(data.profile.plate)}</p><span>차량 정보부터 다음 정비까지, 한곳에서.</span></div></header><nav class="car-tabs" aria-label="자동차 메뉴">${[['info','자동차 정보'],['history','자동차 수리정보'],['driving','주행거리 · 엔진오일']].map(([key,label])=>`<a href="#/car${key==='info'?'':'/'+key}" ${tab===key?'aria-current="page"':''}>${label}</a>`).join('')}</nav>${tab==='history'?maintenanceHtml(data):tab==='driving'?planHtml(data,records):infoHtml(data)}<section class="car-card"><h2>자료 확인</h2>${data.reviewNotes.map(s=>`<p class="muted">${esc(s)}</p>`).join('')}<details><summary>전체 원본 ${data.sources.length}개 · 중복 촬영본 포함</summary><div class="car-sources">${links(data,data.sources.map(s=>s.file))}</div></details><button type="button" id="car-export" class="btn-secondary">내 기록 내려받기 (JSON)</button></section></div>`;
  const renderList=()=>{
    const q=(page.querySelector('#car-search')?.value || '').trim().toLowerCase(), kind=page.querySelector('#car-kind')?.value;
    const filtered=records.filter(r=>(!kind || r.kind===kind) && (!q || [r.title,r.date,r.notes,...(r.items || [])].join(' ').toLowerCase().includes(q))).sort((a,b)=>b.date.localeCompare(a.date));
    page.querySelector('#car-count').textContent=`${filtered.length} / ${records.length}건`;
    page.querySelector('#car-records').innerHTML=filtered.map(r=>recordHtml(data,r)).join('') || '<p>조건에 맞는 기록이 없습니다.</p>';
  };
  if(tab==='history') {renderList();page.querySelector('#car-search').addEventListener('input',renderList);page.querySelector('#car-kind').addEventListener('change',renderList);}
  const form=page.querySelector('#car-entry');
  if(form) {
    form.elements.kind.addEventListener('change',()=>{form.elements.km.required=form.elements.kind.value==='mileage';});
    form.addEventListener('submit',async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(form));b.km=b.km===''?null:Number(b.km);b.cost=b.cost===''?null:Number(b.cost);b.title=b.title || kinds[b.kind];await save(form,'/api/car/entries',b);});
  }
  page.querySelector('#car-intervals')?.addEventListener('submit',async e=>{e.preventDefault();const b=Object.fromEntries([...new FormData(e.target)].map(([k,v])=>[k,v===''?null:Number(v)]));await save(e.target,'/api/car/intervals',b);});
  async function save(form,path,body) {const button=form.querySelector('button[type="submit"]');button.disabled=true;form.querySelector('.car-error').textContent='';try{await api(path,{method:'POST',body});toast('저장했습니다.');if(location.hash===route)await renderCar(page,tab);}catch(e){form.querySelector('.car-error').textContent=e.message;}finally{button.disabled=false;}}
  async function onDelete(e) {const btn=e.target.closest('[data-delete]');if(!btn || !page.contains(btn))return;if(!confirm('직접 입력한 이 기록을 삭제할까요? 원본 정비 이력은 유지됩니다.'))return;btn.disabled=true;try{await api('/api/car/entries/'+btn.dataset.delete,{method:'DELETE'});if(location.hash===route)await renderCar(page,tab);}catch(err){toast(err.message);btn.disabled=false;}}
  // Replace listeners when this shared page node is rendered again.
  page._carAbort?.abort(); const controller=new AbortController();page._carAbort=controller;
  page.addEventListener('click',onDelete,{signal:controller.signal});
  page.querySelector('#car-export').addEventListener('click',()=>{const u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download='my-car-records.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);});
}
