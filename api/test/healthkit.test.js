import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDailyHealth } from '../daily-health.js';
import { parseHealthKitChanges } from '../daily-health-data.js';
const id='a1223344-5566-7788-9900-112233445566';
const row={id,start:'2026-01-01T00:00:00Z',end:'2026-01-01T01:00:00Z',category:'asleepDeep',source:'Watch',sourceIdentifier:'com.apple.health'};
const batch={metric:'sleep',timezone:'Asia/Taipei',samples:[row],deleted:[]};
test('native parser preserves old corrections, UUIDs and exact source identity',()=>{
 const parsed=parseHealthKitChanges(batch);assert.equal(parsed.samples.length,1);assert.equal(parsed.samples[0].id,id);assert.equal(parsed.samples[0].sourceIdentifier,row.sourceIdentifier);
 for(const patch of [{samples:[{...row,id:'bad'}]},{deleted:['bad']},{samples:[{...row,category:'unknown'}]},{samples:[{...row,sourceIdentifier:''}]},{samples:Array(501).fill(row)}])assert.throws(()=>parseHealthKitChanges({...batch,...patch}));
 assert.equal(parseHealthKitChanges({...batch,samples:[row,{...row,category:'asleepREM'}]}).samples.length,1);
});
test('native upsert, retries, corrections, tombstones, shortcut coexistence and isolation',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gym-healthkit-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const users=[{id:'alice',sv:0},{id:'bob',sv:0}];
 const app=createDailyHealth({dataDir:dir,readSession:req=>users.find(u=>u.id===req.user),getUser:id=>users.find(u=>u.id===id),readBody:async req=>req.body||{},json:(res,status,data)=>Object.assign(res,{status,data})});
 async function req(route,{user,token,body}={}){const res={};await app.routes[route]({user,body,headers:{authorization:token?'Bearer '+token:''}},res);return res}
 const token=(await req('POST /api/daily-health/connection',{user:'alice'})).data.token;
 const native=body=>req('POST /api/daily-health/healthkit',{token,body});
 const exported=async()=> (await req('GET /api/daily-health/export',{user:'alice'})).data;
 assert.equal((await req('POST /api/daily-health/healthkit',{user:'alice',body:batch})).status,200);
 assert.equal((await native(batch)).status,200);assert.equal((await native(batch)).data.stored,1);
 assert.equal((await native({...batch,samples:[{...row,category:'asleepREM'}]})).data.stored,1);assert.equal((await exported()).sleep[0].category,'asleepREM');
 assert.deepEqual((await req('GET /api/daily-health/export',{user:'bob'})).data,{});
 const shortcut={metric:'sleep',timezone:'Asia/Taipei',start:'2026-01-01T00:00:00Z',end:'2026-01-02T00:00:00Z',samples:[{...row,category:'asleepREM'}]};
 assert.equal((await req('POST /api/daily-health/import',{token,body:shortcut})).data.stored,1);assert.equal((await exported()).sleep[0].id,id);
 assert.equal((await native({...batch,samples:[],deleted:[id]})).data.stored,0);
 assert.equal((await native({...batch,samples:[],deleted:[id]})).data.stored,0);
 assert.equal((await native(batch)).data.stored,0,'a delayed second device cannot resurrect a deleted UUID');
 assert.equal((await native({...batch,samples:[{...row,id:'bad'}]})).status,400);assert.equal((await exported()).sleep.length,0);
 await req('DELETE /api/daily-health/connection',{user:'alice'});assert.equal((await native(batch)).status,401);
});
