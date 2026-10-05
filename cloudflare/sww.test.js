import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import worker from './index.js';
test('SWW-pro HTML·설명서·ZIP은 로그인 후에만 열리고 공유 캐시를 사용하지 않는다', async () => {
const secret = 'sww-test-session-secret';
const user = { id:1, role:'admin', status:'active', password_hash:'test-password-fingerprint', session_epoch:0, display_name:'Test' };
const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
const sign = Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('test'))).toString('base64url').slice(0,32);
const cookie = `jsid=test.${sign}`;
const env = {
 SESSION_SECRET:secret,
 SESSIONS:{get:async(k,t)=> k==='sess:test' ? (t==='json' ? {uid:1,pwv:user.password_hash.slice(-16),sev:0}:JSON.stringify({uid:1,pwv:user.password_hash.slice(-16),sev:0})) : null},
 DB:{prepare:()=>({bind(){return this;},first:async()=>user,all:async()=>({results:[]}),run:async()=>({meta:{changes:1}})})},
 ASSETS:{fetch:async req=>{
  const p = new URL(req.url).pathname;
  try { const body=await fs.readFile(path.join(process.cwd(),'web/public',p==='/'?'index.html':p));
   const ext=path.extname(p);return new Response(body,{headers:{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.zip':'application/zip','.png':'image/png'})[ext] || 'text/html'}});
  } catch {return new Response('Missing',{status:404});}
 }}
};
const ctx={waitUntil(){}};
for(const p of ['/sww-pro/prompt-builder.html','/sww-pro/user-manual.html','/sww-pro/downloads/samsung-word-writer-pro-261004_0926.zip']) {
 assert.equal((await worker.fetch(new Request('http://localhost'+p),env,ctx)).status,401);
 const res=await worker.fetch(new Request('http://localhost'+p,{headers:{Cookie:cookie}}),env,ctx);
 assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'private, no-store');
}
const opened = await worker.fetch(new Request('http://localhost/go/sww-pro?in=frame', {
  headers: { Cookie: cookie },
}), env, ctx);
assert.equal(opened.status, 302);
assert.equal(opened.headers.get('location'), '/sww-pro/prompt-builder.html');
user.role = 'user';
const denied = await worker.fetch(new Request('http://localhost/sww-pro/prompt-builder.html', {
  headers: { Cookie: cookie },
}), env, ctx);
assert.equal(denied.status, 403);
});

