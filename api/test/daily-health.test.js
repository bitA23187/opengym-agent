import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseDailyHealth,dailyHealthSummary} from '../daily-health-data.js';
import {createDailyHealth} from '../daily-health.js';
const time=s=>Date.parse(s+'+08:00');
const input={metric:'hrv',unit:'ms',timezone:'Asia/Taipei',start:'2026-10-22T00:00:00+08:00',end:'2026-10-24T00:00:00+08:00',dates:'2026-10-23T01:00:00+08:00\n2026-10-23T02:00:00+08:00',values:'40\n60',sources:'Watch\nWatch'};
test('strict units, aligned columns, known categories and absolute dates',()=>{
 const p=parseDailyHealth(input);assert.equal(p.samples[0].value,40);assert.equal(p.samples[0].method,'SDNN');
 for(const patch of [{unit:'s'},{values:'40 ms\n60'},{values:'40'},{timezone:'Mars'},{dates:'2026-10-23 01:00:00\n2026-10-23T02:00:00+08:00'}])assert.throws(()=>parseDailyHealth({...input,...patch}));
 assert.throws(()=>parseDailyHealth({...input,metric:'sleep',ends:input.dates,values:'unknown\nunknown'}));
});
test('sleep crosses midnight onto wake date, merges overlapping stages and selects one source',()=>{
 const sample=(start,end,category,source='Watch')=>({start:time(start),end:time(end),category,source});
 const record={sleep:[sample('2026-10-22T22:00:00','2026-10-23T08:00:00','inBed'),sample('2026-10-22T23:00:00','2026-10-23T07:00:00','asleepUnspecified'),sample('2026-10-23T01:00:00','2026-10-23T02:00:00','asleepDeep'),sample('2026-10-22T23:30:00','2026-10-23T06:30:00','asleepUnspecified','Phone'),sample('2026-10-23T14:00:00','2026-10-23T14:30:00','asleepCore')]};
 const days=dailyHealthSummary(record,'2026-10-22','2026-10-23','Asia/Taipei');assert.equal(days.length,1);assert.equal(days[0].date,'2026-10-23');assert.equal(days[0].sleep.minutes,510);assert.equal(days[0].sleep.mainMinutes,480);assert.equal(days[0].sleep.additionalSessions,1);assert.deepEqual(days[0].sleep.otherSources,['Phone']);assert.equal(days[0].sleep.sessions.length,2);assert.equal(days[0].sleep.sessions[1].minutes,30);assert.equal(days[0].sleep.sessions[1].timeline[0].category,'asleepCore');
});
test('HRV median and latest RHR are distinct and missing sleep remains null',()=>{
 const p=parseDailyHealth(input);const record={hrv:[...p.samples,{...p.samples[1],value:200,start:p.samples[1].start+1000}],restingHeartRate:p.samples.map((s,i)=>({...s,value:55+i}))};
 const [d]=dailyHealthSummary(record,'2026-10-23','2026-10-23','Asia/Taipei');assert.equal(d.hrv.value,60);assert.equal(d.hrv.count,3);assert.equal(d.restingHeartRate.value,56);assert.equal(d.sleep,null);
});
test('dedup, isolation, dedicated upload scope, revoked credentials and persisted export',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'opengym-daily-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const users=[{id:'alice',sv:0},{id:'bob',sv:0}];
 const deps={dataDir:dir,readSession:req=>users.find(u=>u.id===req.user),getUser:id=>users.find(u=>u.id===id),readBody:async req=>req.body||{},json:(res,status,data)=>Object.assign(res,{status,data})};
 let app=createDailyHealth(deps);
 async function request(method,url,{user,token,body}={}){const res={};await app.routes[method+' '+url.split('?')[0]]({user,body,url,headers:{authorization:token?'Bearer '+token:''}},res);return res}
 const c=await request('POST','/api/daily-health/connection',{user:'alice'}),token=c.data.token;assert.equal(c.status,200);
 assert.equal((await request('POST','/api/daily-health/import',{user:'alice',body:input})).status,200);
 for(let i=0;i<2;i++)assert.equal((await request('POST','/api/daily-health/import',{token,body:input})).data.stored,2);
 app=createDailyHealth(deps);assert.equal((await request('GET','/api/daily-health/export',{user:'alice'})).data.hrv.length,2);
 assert.deepEqual((await request('GET','/api/daily-health/export',{user:'bob'})).data,{});
 assert.equal((await request('GET','/api/daily-health/export',{token})).status,401);
 await request('POST','/api/daily-health/import',{token,body:{...input,dates:'',values:'',sources:''}});assert.equal((await request('GET','/api/daily-health/export',{user:'alice'})).data.hrv.length,2,'empty reads never erase data');
 await request('DELETE','/api/daily-health/connection',{user:'alice'});assert.equal((await request('POST','/api/daily-health/import',{token,body:input})).status,401);
 await request('DELETE','/api/daily-health',{user:'alice'});assert.deepEqual((await request('GET','/api/daily-health/export',{user:'alice'})).data,{});
});

test('malformed JSON sample objects and incompatible HRV methods are validation errors',()=>{
 for(const patch of [{samples:[null]},{samples:[[]]},{method:'RMSSD'}])assert.throws(()=>parseDailyHealth({...input,...patch}),e=>e.status===400);
});
test('sleep category names cannot resolve inherited object properties',()=>{
 for(const value of ['toString','__proto__','constructor'])assert.throws(()=>parseDailyHealth({...input,metric:'sleep',samples:[{start:'2026-10-23T01:00:00+08:00',end:'2026-10-23T02:00:00+08:00',category:value,source:'Watch'}]}),e=>e.status===400);
});

test('query boundaries preserve overlapping intervals and skip only non-overlapping samples',()=>{
 const p=parseDailyHealth({...input,start:'2026-10-23T01:00:00+08:00',end:'2026-10-23T02:00:00+08:00',samples:[
  {start:'2026-10-23T00:59:00+08:00',end:'2026-10-23T01:01:00+08:00',value:40,source:'Watch'},
  {start:'2026-10-23T02:00:00+08:00',value:50,source:'Watch'},
  {start:'2026-10-22T20:00:00+08:00',value:60,source:'Watch'}]});
 assert.equal(p.samples.length,2);assert.equal(p.skippedOutsideWindow,1);assert.equal(p.samples[0].start,time('2026-10-23T00:59:00'));
});
test('a current-day resting heart rate reporting interval may end at the next midnight',()=>{
 const now=time('2026-10-23T12:00:00');const body={...input,metric:'restingHeartRate',unit:'bpm',start:'2026-10-22T12:00:00+08:00',end:'2026-10-23T12:00:00+08:00',samples:[{start:'2026-10-23T00:00:00+08:00',end:'2026-10-24T00:00:00+08:00',value:55,source:'Watch'}]};
 assert.equal(parseDailyHealth(body,now).samples[0].end,time('2026-10-24T00:00:00'));
 assert.throws(()=>parseDailyHealth({...body,metric:'hrv',unit:'ms'},now),e=>e.code==='invalid_sample_interval'&&e.details.reason==='end_in_future');
 assert.throws(()=>parseDailyHealth({...body,samples:[{...body.samples[0],end:'2026-10-25T00:00:00+08:00'}]},now));
});
test('invalid intervals explain the row and reason without exposing values',()=>{
 assert.throws(()=>parseDailyHealth({...input,samples:[{start:'2026-10-23T02:00:00+08:00',end:'2026-10-23T01:00:00+08:00',value:50,source:'Watch'}]}),e=>e.details.item===1&&e.details.reason==='end_before_start'&&!JSON.stringify(e.details).includes('50'));
});

test('row JSON keeps sleep categories aligned when a source is unavailable',()=>{
 const rows=[{start:'2026-10-22T23:00:00+08:00',end:'2026-10-23T01:00:00+08:00',value:'Core',source:''},{start:'2026-10-23T01:00:00+08:00',end:'2026-10-23T02:00:00+08:00',value:'Asleep (Deep)',source:'Watch "A"\n健康'}];
 const p=parseDailyHealth({...input,metric:'sleep',samplesJson:JSON.stringify(rows)});
 assert.equal(p.samples.length,2);assert.equal(p.samples[0].category,'asleepCore');assert.equal(p.samples[0].source,'Apple Health (source unavailable)');assert.equal(p.samples[1].category,'asleepDeep');assert.equal(p.samples[1].source,rows[1].source);
 const missing=structuredClone(rows);missing[0].value='';assert.throws(()=>parseDailyHealth({...input,metric:'sleep',samplesJson:JSON.stringify(missing)}),e=>e.status===400);
 for(const samplesJson of ['{','{}','null'])assert.throws(()=>parseDailyHealth({...input,samplesJson}),e=>e.status===400);
 assert.throws(()=>parseDailyHealth({...input,values:'40'}),e=>e.code==='unaligned_sample_columns'&&e.details.counts.dates===2&&e.details.counts.values===1);
});


test('Apple Shortcuts Simplified and Traditional Chinese sleep labels stay explicit',()=>{
 for(const [value,category] of [['睡眠时间','asleepUnspecified'],['睡眠時間','asleepUnspecified'],['核心睡眠','asleepCore'],['深度睡眠','asleepDeep'],['深睡','asleepDeep'],['快速动眼睡眠','asleepREM'],['快速動眼期','asleepREM'],['清醒时间','awake'],['卧床时间','inBed'],['床上時間','inBed']]) {
  const p=parseDailyHealth({...input,metric:'sleep',samplesJson:JSON.stringify([{start:'2026-10-22T23:00:00+08:00',end:'2026-10-23T01:00:00+08:00',value,source:''}])});
  assert.equal(p.samples[0].category,category);
 }
});

test('stage totals partition generic envelopes, retain awake gaps and exclude other sources',()=>{
 const make=(a,b,category,source='Watch')=>({start:time(`2026-10-23T${a}:00`),end:time(`2026-10-23T${b}:00`),category,source});
 const sleep=[make('00:00','01:00','asleepUnspecified'),make('00:00','00:30','asleepDeep'),make('01:00','01:10','awake'),make('01:10','02:00','asleepREM'),make('00:00','03:00','inBed'),make('00:00','00:20','asleepCore','Phone')];
 const [d]=dailyHealthSummary({sleep},'2026-10-23','2026-10-23','Asia/Taipei');
 assert.deepEqual(d.sleep.stageMinutes,{awake:10,asleepREM:50,asleepCore:0,asleepDeep:30,asleepUnspecified:30});
 assert.equal(d.sleep.minutes,110);assert.equal(d.sleep.timeline.length,4);
 assert.equal(d.sleep.timeline[0].start,'2026-10-22T16:00:00.000Z');
});
test('conflicting explicit stages remain unspecified rather than inflating totals',()=>{
 const start=time('2026-10-23T01:00:00'),end=start+3600000;
 const [d]=dailyHealthSummary({sleep:['asleepCore','asleepDeep'].map(category=>({start,end,category,source:'Watch'}))},'2026-10-23','2026-10-23','Asia/Taipei');
 assert.equal(d.sleep.minutes,60);assert.equal(d.sleep.stageMinutes.asleepUnspecified,60);assert.equal(d.sleep.stageMinutes.asleepDeep,0);
});
