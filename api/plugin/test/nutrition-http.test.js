import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createPlugin} from '../server.js';
import {openStore,hash,random} from '../store.js';
import {appendTrainingUpdate} from '../training.js';
test('HTTP scopes separate nutrition and health from training; confirmed saves and read-only grants',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gym-nutrition-http-')),user={id:'alice',sv:0};
 let state={unit:'kg',routines:[],workouts:[],_rev:1,_wid:'a'};
 const store=openStore(dir),tokens={};
 for(const [name,scopes] of Object.entries({training:['training:read','training:write'],read:['nutrition:read'],write:['nutrition:read','nutrition:write'],health:['health:read']})) {
  const token=random();tokens[name]=token;store.data.grants[name]={uid:user.id,sv:0,client:'fixture',exp:Date.now()+60000};store.data.tokens[hash(token)]={type:'access',grant:name,client:'fixture',scopes,exp:Date.now()+60000};
 }
 store.save();let healthUser=null;
 const app=createPlugin({origin:'https://gym.test',dataDir:dir,userById:id=>id===user.id?user:null,readSession:()=>null,read:()=>structuredClone(state),appendTraining:(u,d)=>state=appendTrainingUpdate(state,d),dailyHealth:{summary:(uid,input)=>{healthUser=uid;return {...input,days:[]}}},auditSink:()=>{}});
 const server=http.createServer(app.app);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();fs.rmSync(dir,{recursive:true,force:true})});let id=0;
 async function call(name,args,token){const r=await fetch(`http://127.0.0.1:${server.address().port}/api/plugin/mcp`,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method:'tools/call',params:{name,arguments:args}})});assert.equal(r.status,200);return (await r.json()).result}
 const range={from:'2026-10-23',to:'2026-10-23'},input={timezone:'Asia/Taipei',entries:[{date:'2026-10-23',meal:'Lunch',source:'Label',calories:500,protein:35,carbs:50,fat:null,alcohol:0}]};
 assert.equal((await call('get_nutrition',range,tokens.training)).isError,true);
 assert.equal((await call('preview_nutrition_update',input,tokens.read)).isError,true);
 const preview=await call('preview_nutrition_update',input,tokens.write);assert.ok(!preview.isError);assert.ok(!state.nutritionEntries);
 const draft=JSON.parse(preview.content[0].text),save={draft_id:draft.draft_id,confirmed:true,confirmation_summary:draft.confirmation_summary};
 assert.equal((await call('save_nutrition_update',save,tokens.read)).isError,true);
 assert.ok(!((await call('save_nutrition_update',save,tokens.write)).isError));
 const read=JSON.parse((await call('get_nutrition',range,tokens.read)).content[0].text);assert.equal(read.days[0].totals.calories.value,500);assert.equal(read.days[0].totals.fat.value,null);
 const goalPreview=await call('preview_nutrition_update',{timezone:'Asia/Taipei',goals:{calories:2200,protein:130,carbs:260,fat:70}},tokens.write);
 const gd=JSON.parse(goalPreview.content[0].text),gs={draft_id:gd.draft_id,confirmed:true,confirmation_summary:gd.confirmation_summary};
 assert.equal((await call('save_nutrition_update',gs,tokens.read)).isError,true);
 assert.ok(!(await call('save_nutrition_update',gs,tokens.write)).isError);
 assert.equal(JSON.parse((await call('get_nutrition',range,tokens.read)).content[0].text).goals.protein,130);
 assert.equal((await call('get_daily_health',{...range,timezone:'Asia/Taipei'},tokens.write)).isError,true);
 assert.ok(!(await call('get_daily_health',{...range,timezone:'Asia/Taipei'},tokens.health)).isError);assert.equal(healthUser,user.id);
});
