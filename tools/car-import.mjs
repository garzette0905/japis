// Import a reviewed private manifest and its originals; never place those inputs in Git.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const at=a.indexOf('=');return [a.slice(0,at),a.slice(at+1)];}));
if(!args['--data'] || !args['--originals'] || !args['--email']) throw Error('Use --data=private.json --originals=folder --email=owner@example.com');
const data=JSON.parse(fs.readFileSync(args['--data'],'utf8'));
const folder=path.resolve(args['--originals']);
const quote=s=>`'${s.replaceAll("'","''")}'`;
const cli=path.resolve('node_modules/wrangler/bin/wrangler.js');
const wrangler=(...a)=>execFileSync(process.execPath,[cli,...a],{encoding:'utf8',env:{...process.env,WRANGLER_LOG_PATH:path.resolve('.wrangler/logs')},maxBuffer:10*1024*1024});
// Check every input before the first upload.
for(const s of data.sources) {
  if(!/^[a-z0-9-]+\.(jpg|png|pdf)$/.test(s.file)) throw Error('Invalid original filename');
  const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(folder,s.file))).digest('hex');
  if(hash!==s.sha256)throw Error(`Hash mismatch: ${s.file}`);
}
const owners=JSON.parse(wrangler('d1','execute','japis-db','--remote','--json',`--command=SELECT id FROM users WHERE lower(email)=lower(${quote(args['--email'])})`));
const uid=owners[0]?.results?.[0]?.id;
if(!Number.isInteger(uid))throw Error('Owner account not found');
const checkpointPath=path.join(path.dirname(args['--data']),`uploaded-${uid}.json`);
const checkpoint=fs.existsSync(checkpointPath)?JSON.parse(fs.readFileSync(checkpointPath,'utf8')):{};
for(let i=0;i<data.sources.length;i++) {
  const s=data.sources[i];
  if(checkpoint[s.file]===s.sha256)continue;
  const type=s.file.endsWith('.pdf')?'application/pdf':s.file.endsWith('.png')?'image/png':'image/jpeg';
  wrangler('r2','object','put',`japis-wiki/car/${uid}/${s.file}`,`--file=${path.join(folder,s.file)}`,`--content-type=${type}`,'--remote');
  checkpoint[s.file]=s.sha256;fs.writeFileSync(checkpointPath,JSON.stringify(checkpoint,null,2));
  console.log(`Originals uploaded: ${i+1}/${data.sources.length}`);
}
wrangler('d1','execute','japis-db','--remote','--file=migrations/023_car.sql');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'japis-car-'));
try {
  const sql=`INSERT INTO car_profiles(user_id,data_json) VALUES(${uid},${quote(JSON.stringify(data))}) ON CONFLICT(user_id) DO UPDATE SET data_json=excluded.data_json;`;
  const filename=path.join(tmp,'import.sql');fs.writeFileSync(filename,sql);
  wrangler('d1','execute','japis-db','--remote',`--file=${filename}`);
  console.log(`Imported ${data.records.length} records and ${data.sources.length} originals for owner ${uid}. Existing manual entries and intervals preserved.`);
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
