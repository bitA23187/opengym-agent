import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {createHealthUploadCredentials} from '../health-upload-credentials.js';
import {createHeartRate} from '../heart-rate.js';
import {createDailyHealth} from '../daily-health.js';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function harness(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gym-shared-health-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const users=[{id:'alice',sv:0},{id:'bob',sv:0}],deps={dataDir:dir,getUser:id=>users.find(u=>u.id===id),readSession:r=>users.find(u=>u.id===r.user&&!u.disabled),readState:()=>({workouts:[]}),readBody:async r=>r.body||{},json:(res,status,data)=>Object.assign(res,{status,data})};
 const heart=createHeartRate(deps),daily=createDailyHealth(deps),service=createHealthUploadCredentials(deps);
 const req=async(method,url,{user,token,body}={})=>{const res={};await (url.includes('heart-rate')?heart:daily).routes[method+' '+url]({method,url,user,body,headers:{authorization:token?'Bearer '+token:''}},res);return res};
 function legacy(user,kind){const root=path.join(dir,kind==='ogh_'?'heart-rate':'daily-health'),token=kind+crypto.randomBytes(32).toString('base64url'),c={uid:user.id,sv:user.sv,keyHash:hash(token),expiresAt:Date.now()+180*86400000};for(const f of [path.join(root,hash(user.id),'connection.json'),path.join(root,'keys',hash(token)+'.json')]){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(c))}return token}
 return {dir,users,service,req,legacy};
}
test('legacy heart/daily credentials both work without migration writes and replacement invalidates both',async t=>{
 const h=harness(t),[alice,bob]=h.users,oldHeart=h.legacy(alice,'ogh_'),oldDaily=h.legacy(alice,'ogd_'),bobToken=h.legacy(bob,'ogd_');
 const fingerprint=()=>JSON.stringify(fs.readdirSync(h.dir,{recursive:true}).filter(f=>String(f).endsWith('.json')).sort().map(f=>[f,hash(fs.readFileSync(path.join(h.dir,f)))]));const before=fingerprint();
 for(const token of [oldHeart,oldDaily])assert.equal(h.service.authenticate({headers:{authorization:'Bearer '+token}}),alice);
 assert.equal(h.service.status(alice).credentialCount,2);assert.equal(fingerprint(),before,'no migration writes on startup or read');
 const created=await h.req('POST','/api/daily-health/connection',{user:'alice'});assert.equal(created.status,200);const token=created.data.token;
 assert.ok(token.startsWith('ogh_'));assert.equal(created.data.expiresAt,null);assert.equal(created.data.lifetimeDays,null);
 for(const old of [oldHeart,oldDaily])assert.throws(()=>h.service.authenticate({headers:{authorization:'Bearer '+old}}));
 assert.equal(h.service.authenticate({headers:{authorization:'Bearer '+bobToken}}),bob);
 assert.equal((await h.req('POST','/api/heart-rate/pending',{token})).status,200);
 const payload={metric:'restingHeartRate',unit:'bpm',timezone:'Asia/Taipei',start:'2026-10-23T00:00:00+08:00',end:'2026-10-24T00:00:00+08:00',samples:[{start:'2026-10-23T07:00:00+08:00',value:55,source:'Fixture'}]};
 assert.equal((await h.req('POST','/api/daily-health/import',{token,body:payload})).status,200);
 assert.equal((await h.req('GET','/api/daily-health/export',{token})).status,401,'upload cannot read saved data');
 for(const url of ['/api/heart-rate/connection','/api/daily-health/connection'])assert.equal((await h.req('GET',url,{user:'alice'})).data.connected,true);
 await h.req('DELETE','/api/heart-rate/connection',{user:'alice'});assert.equal((await h.req('POST','/api/daily-health/import',{token,body:payload})).status,401);
 assert.equal((await h.req('GET','/api/daily-health/connection',{user:'alice'})).data.connected,false);
 const next=(await h.req('POST','/api/heart-rate/connection',{user:'alice'})).data.token;
 await h.req('DELETE','/api/daily-health/connection',{user:'alice'});assert.equal((await h.req('POST','/api/heart-rate/pending',{token:next})).status,401);
});
test('credentials have no expiry while account disabling, logout-all and revocation remain effective',t=>{
 const h=harness(t),alice=h.users[0],token=h.service.issue(alice).token,r={headers:{authorization:'Bearer '+token}};
 alice.sv++;assert.throws(()=>h.service.authenticate(r));alice.sv--;alice.disabled=true;assert.throws(()=>h.service.authenticate(r));alice.disabled=false;
 const file=path.join(h.dir,'heart-rate','keys',hash(token)+'.json'),c=JSON.parse(fs.readFileSync(file));c.expiresAt=Date.now()-1;fs.writeFileSync(file,JSON.stringify(c));fs.writeFileSync(path.join(h.dir,'heart-rate',hash(alice.id),'connection.json'),JSON.stringify(c));assert.equal(h.service.authenticate(r),alice);assert.equal(h.service.status(alice).expiresAt,null);h.service.revoke(alice.id);assert.throws(()=>h.service.authenticate(r));
});

test('webpage Shortcut grants are temporary, account-bound and limited to sync endpoints',async t=>{
 const h=harness(t),alice=h.users[0],legacy=h.service.issue(alice).token;
 assert.equal((await h.req('POST','/api/heart-rate/shortcut-session')).status,401);
 const issued=await h.req('POST','/api/heart-rate/shortcut-session',{user:'alice'});
 assert.equal(issued.status,200);const token=issued.data.token;
 assert.match(token,/^ogs_[A-Za-z0-9_-]{43}$/);
 assert.ok(issued.data.expiresAt>Date.now()&&issued.data.expiresAt<=Date.now()+30*60000);
 assert.equal(h.service.authenticate({headers:{authorization:'Bearer '+legacy}}),alice,'does not rotate existing credentials');
 assert.equal((await h.req('POST','/api/heart-rate/pending',{token})).status,200);
 const payload={metric:'restingHeartRate',unit:'bpm',timezone:'Asia/Taipei',start:'2026-10-23T00:00:00+08:00',end:'2026-10-24T00:00:00+08:00',samples:[{start:'2026-10-23T07:00:00+08:00',value:55,source:'Fixture'}]};
 assert.equal((await h.req('POST','/api/daily-health/import',{token,body:payload})).status,200);
 for(const [method,url] of [['GET','/api/daily-health/export'],['DELETE','/api/daily-health'],['POST','/api/daily-health/healthkit'],['POST','/api/heart-rate/shortcut-session']])assert.equal((await h.req(method,url,{token,body:payload})).status,401,url);
 assert.equal((await h.req('GET','/api/daily-health/export',{user:'bob'})).data.restingHeartRate,undefined);
 alice.sv++;assert.equal((await h.req('POST','/api/heart-rate/pending',{token})).status,401);alice.sv--;
 alice.disabled=true;assert.equal((await h.req('POST','/api/heart-rate/pending',{token})).status,401);alice.disabled=false;
 const expired=createHealthUploadCredentials({dataDir:h.dir,getUser:id=>h.users.find(u=>u.id===id),now:()=>issued.data.expiresAt});
 assert.throws(()=>expired.authenticate({method:'POST',url:'/api/heart-rate/pending',headers:{authorization:'Bearer '+token}}));
});
