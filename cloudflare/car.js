const reply = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' },
});
const error = message => reply({error: message}, 400);
export const carProfile = (env, uid) => env.DB.prepare('SELECT * FROM car_profiles WHERE user_id = ?').bind(uid).first();

export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
const nullableInt = (value, max) => value === null || value === '' || value === undefined
  ? null : typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : NaN;

export async function carApi(request, env, uid, path) {
  const profile = await carProfile(env, uid);
  if (!profile) return reply({error: '이 계정에 등록된 자동차가 없습니다.'}, 404);
  const data = JSON.parse(profile.data_json);
  if (path.startsWith('/api/car/files/') && request.method === 'GET') {
    const name = path.slice('/api/car/files/'.length);
    if (!data.sources.some(s => s.file === name)) return reply({error:'파일을 찾을 수 없습니다.'},404);
    const object = await env.WIKI_FILES.get(`car/${uid}/${name}`);
    if (!object) return reply({error:'원본 파일이 아직 업로드되지 않았습니다.'},404);
    return new Response(object.body, {headers: {
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff',
      'Content-Disposition': 'inline',
    }});
  }
  if (path === '/api/car' && request.method === 'GET') {
    const entries = await env.DB.prepare('SELECT * FROM car_entries WHERE user_id = ? ORDER BY date DESC,id DESC').bind(uid).all();
    return reply({ ...data, entries: entries.results, intervals: {oilKm:profile.oil_km,oilMonths:profile.oil_months,tireKm:profile.tire_km,tireMonths:profile.tire_months} });
  }
  if (request.method === 'POST' && (path === '/api/car/entries' || path === '/api/car/intervals')) {
    let b;
    try { b = await request.json(); } catch { return error('입력 내용을 확인해주세요.'); }
    if (!b || typeof b !== 'object' || Array.isArray(b)) return error('입력 내용을 확인해주세요.');
    if (path.endsWith('/intervals')) {
      const values = [nullableInt(b.oilKm,1000000),nullableInt(b.oilMonths,120),nullableInt(b.tireKm,1000000),nullableInt(b.tireMonths,120)];
      if(values.some(v=>Number.isNaN(v) || v===0)) return error('알림 주기는 양수로 입력하거나 비워주세요.');
      await env.DB.prepare('UPDATE car_profiles SET oil_km=?,oil_months=?,tire_km=?,tire_months=? WHERE user_id=?').bind(...values,uid).run();
      return reply({ok:true});
    }
    if(!['mileage','oil','tire','repair'].includes(b.kind) || !validDate(b.date) || b.date > new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'})) return error('종류와 기록 날짜를 확인해주세요.');
    const km = nullableInt(b.km,10000000), cost = nullableInt(b.cost,1000000000);
    if(Number.isNaN(km) || Number.isNaN(cost) || (b.kind==='mileage' && km===null)) return error('주행거리와 금액을 확인해주세요.');
    if(typeof b.title !== 'string' || b.title.length > 200 || typeof b.notes !== 'string' || b.notes.length > 10000) return error('제목은 200자, 메모는 10,000자 이내로 입력해주세요.');
    // Backdated entries may be inserted, but the chronological odometer must remain monotonic.
    if(km !== null) {
      const saved = (await env.DB.prepare('SELECT date,km FROM car_entries WHERE user_id=? AND km IS NOT NULL').bind(uid).all()).results;
      const readings = [...data.records.filter(r=>r.km!==null),...saved];
      if(readings.some(r => r.date < b.date && r.km > km || r.date > b.date && r.km < km)) return error('이전·이후 기록의 주행거리와 맞지 않습니다. 날짜와 km를 확인해주세요.');
    }
    const result = await env.DB.prepare('INSERT INTO car_entries(user_id,kind,date,km,title,notes,cost) VALUES(?,?,?,?,?,?,?)').bind(uid,b.kind,b.date,km,b.title.trim(),b.notes.trim(),cost).run();
    return reply({ok:true,id:result.meta.last_row_id},201);
  }
  const match=path.match(/^\/api\/car\/entries\/(\d+)$/);
  if(match && request.method==='DELETE') {
    await env.DB.prepare('DELETE FROM car_entries WHERE id=? AND user_id=?').bind(Number(match[1]),uid).run();
    return reply({ok:true});
  }
  return reply({error:'허용하지 않는 요청입니다.'},405);
}
