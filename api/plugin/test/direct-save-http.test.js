import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createPlugin} from '../server.js';
import {openStore,hash,random} from '../store.js';
import {appendPlan,appendPlanEdit} from '../state.js';
import {appendTrainingUpdate} from '../training.js';

test('HTTP account standing authorization saves food/meal batches and plan changes, while unresolved questions block writes',async t=>{
 const variables=['PLUGIN_PLAN_AUTO_SAVE_USER_IDS','PLUGIN_NUTRITION_AUTO_SAVE_USER_IDS'],previous=variables.map(k=>process.env[k]);
 for(const k of variables)process.env[k]='alice';
 t.after(()=>variables.forEach((k,i)=>previous[i]===undefined?delete process.env[k]:process.env[k]=previous[i]));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gym-direct-save-')),users={alice:{id:'alice',sv:0},bob:{id:'bob',sv:0}},store=openStore(dir),tokens={};
 const states=Object.fromEntries(Object.keys(users).map(id=>[id,{unit:'kg',routines:[],workouts:[],_rev:1,_wid:id}]));
 for(const id of Object.keys(users)){
  const token=random();tokens[id]=token;store.data.grants[id]={uid:id,sv:0,client:'fixture',exp:Date.now()+60000};store.data.tokens[hash(token)]={type:'access',grant:id,client:'fixture',scopes:['plan:read','plan:write','nutrition:read','nutrition:write'],exp:Date.now()+60000};
 }
 store.save();
 const plugin=createPlugin({origin:'https://gym.test',dataDir:dir,userById:id=>users[id],readSession:()=>null,read:u=>structuredClone(states[u.id]),append:(u,d)=>{states[u.id]=appendPlan(states[u.id],d);return {saved:true};},appendEdit:(u,d)=>{states[u.id]=appendPlanEdit(states[u.id],d);return {saved:true};},appendTraining:(u,d)=>states[u.id]=appendTrainingUpdate(states[u.id],d),auditSink:()=>{}});
 const server=http.createServer(plugin.app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();server.close();fs.rmSync(dir,{recursive:true,force:true});});let id=0;
 async function call(name,args,uid='alice'){
  const r=await fetch(`http://127.0.0.1:${server.address().port}/api/plugin/mcp`,{method:'POST',headers:{authorization:'Bearer '+tokens[uid],'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method:'tools/call',params:{name,arguments:args}})});
  assert.equal(r.status,200);return (await r.json()).result;
 }
 const value=r=>{assert.ok(!r.isError,JSON.stringify(r));return JSON.parse(r.content[0].text);},args=p=>({draft_id:p.draft_id,confirmed:true,confirmation_summary:p.confirmation_summary});
 const food={timezone:'Asia/Taipei',foods:[{operation:'upsert',id:'milk',food:{name:'Milk',basis:{quantity:100,unit:'ml'},nutrients:{calories:35,protein:3.5},source:'Label'}}],entries:[{date:'2026-10-23',meal:'Snack',source:'Label',items:[{item_id:'bottle',food_id:'milk',quantity:250,unit:'ml'}]}]};
 let p=value(await call('preview_nutrition_update',food));assert.equal(p.authorization.requires_user_confirmation,false);assert.equal(value(await call('save_nutrition_update',args(p))).saved,true);assert.equal(Object.values(states.alice.nutritionEntries)[0].protein,8.8);
 assert.equal(value(await call('preview_nutrition_update',food,'bob')).authorization.requires_user_confirmation,true);assert.equal(states.bob.foods,undefined);
 const plan={unit:'kg',routines:[{name:'Upper',exercises:[{exercise_id:'0293',sets:3,reps:10,weight:12}]}]};
 p=value(await call('preview_plan',plan));assert.equal(p.authorization.requires_user_confirmation,false);assert.equal((await call('save_plan',args(p),'bob')).isError,true);value(await call('save_plan',args(p)));
 const edit={routine_id:states.alice.routines[0].id,operations:[{type:'update_exercise',index:0,fields:{weight:15}}]};
 p=value(await call('preview_plan_edit',edit));assert.equal(p.authorization.requires_user_confirmation,false);value(await call('save_plan_edit',args(p)));assert.equal(states.alice.routines[0].ex[0].weight,15);
 p=value(await call('preview_plan_edit',{...edit,review_questions:['Did you mean 15 or 150 kg?']}));assert.equal(p.authorization.requires_user_confirmation,true);const rev=states.alice._rev;assert.equal((await call('save_plan_edit',args(p))).isError,true);assert.equal(states.alice._rev,rev);
 assert.equal(value(await call('preview_plan',plan,'bob')).authorization.requires_user_confirmation,true);
});
