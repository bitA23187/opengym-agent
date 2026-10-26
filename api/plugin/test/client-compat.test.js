import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {boundPort} from '../../test/helpers.mjs';
import {preservePluginState,PLUGIN_FIELDS} from '../client-state.js';
import {mergeStates,stampChange} from '../../../frontend/src/lib/sync-merge.js';
import {appendTrainingUpdate} from '../training.js';
import {reconcileWorkoutChange} from '../reconcile.js';
import {editCompletedSession,saveWorkoutEdit} from '../../../frontend/src/lib/session-edit.js';

test('Plugin correction totals, PRs and kept loads match the unmodified upstream 1.4.1 editor',()=>{
  const original={id:'w',d:'2026-10-14',start:1,end:60001,prs:['0293'],entries:[{id:'0293',target:{mode:'reps',sets:1,reps:10,weight:100},topW:100,sets:[{w:100,r:10,done:true,phase:'work'}]}]};
  const initial={unit:'kg',workouts:[original],exWeights:{'0293':{w:100,d:original.d}}};
  const ui=structuredClone(initial);editCompletedSession(ui,'w');ui.active.entries[0].sets[0].w=10;saveWorkoutEdit(ui,Date.now());
  const plugin=structuredClone(initial),record=plugin.workouts[0];record.entries[0].sets[0].w=10;reconcileWorkoutChange(plugin,original,record);
  assert.equal(plugin.workouts[0].vol,ui.workouts[0].vol);assert.deepEqual(plugin.workouts[0].prs,ui.workouts[0].prs);assert.deepEqual(plugin.exWeights,ui.exWeights);
});

test('upstream 1.4.1 merge accepts server-owned context after an old client drops or rewrites extension fields',()=>{
  const current={unit:'kg',routines:[],workouts:[],bodyweight:[],week:{},dayPlan:{},trainingNotes:{note:{text:'Keep',priority:'important',status:'active'}},pluginTrainingHistory:[{id:'version'}],_ts:10,edited:{trainingNotes:10}};
  const phone=structuredClone(current);delete phone.trainingNotes;phone.pluginTrainingHistory=[];phone.bodyweight.push({d:'2026-10-18',w:70,t:20});phone._ts=20;
  stampChange(current,phone,20);
  const incoming=structuredClone(phone);assert.equal(preservePluginState(current,incoming),true);
  assert.deepEqual(incoming.trainingNotes,current.trainingNotes);assert.deepEqual(incoming.pluginTrainingHistory,current.pluginTrainingHistory);
  assert.equal(incoming.bodyweight[0].w,70);assert.ok(incoming.edited.trainingNotes>phone.edited.trainingNotes);
  const merged=mergeStates(phone,incoming);assert.deepEqual(merged.trainingNotes,current.trainingNotes);assert.deepEqual(merged.pluginTrainingHistory,current.pluginTrainingHistory);
  assert.equal(preservePluginState(incoming,structuredClone(incoming)),false);
  const reset={unit:'kg',workouts:[],routines:[],resetAt:Date.now()+1,...Object.fromEntries(PLUGIN_FIELDS.map(k=>[k,current[k]||{}]))};
  preservePluginState(current,reset);for(const field of PLUGIN_FIELDS)assert.equal(Object.hasOwn(reset,field),false);
});

test('official 1.4.1 merge keeps post-workout Agent imports, body metrics and existing note formats through offline conflict resolution',()=>{
  const before={unit:'kg',routines:[],workouts:[],bodyweight:[],measurements:[],week:{},dayPlan:{},exNotes:{},_ts:1,_rev:1,_wid:'old'};
  const phone=structuredClone(before);phone.workouts.push({id:'phone',d:'2026-10-13',entries:[]});stampChange(before,phone,Date.now()+100);phone._ts=Date.now()+100;
  const server=appendTrainingUpdate(before,{rev:1,wid:'old',summary:'Synthetic completed workout',workout:{id:'agent',d:'2026-10-14',name:'Completed after training',entries:[{id:'0293',target:{mode:'reps',sets:1,reps:10,weight:12},sets:[{w:12,r:10,done:true,phase:'work'}]}]},
    changeDayNote:true,date:'2026-10-14',dayNote:'Synthetic day note',exerciseNotes:[{exercise_id:'0293',note:'Seat 4'}],contextNotes:[{id:'context',after:{text:'User-reported limitation',priority:'important',status:'active'}}],bodyUpdate:{entries:[{date:'2026-10-14',weight:72,measurements:{waist:81}}]}});
  const merged=mergeStates(phone,server);
  assert.deepEqual(merged.workouts.map(w=>w.id),['phone','agent']);assert.equal(merged.workouts[1].entries[0].sets[0].w,12);assert.equal(merged.workouts[1].entries[0].sets[0].r,10);
  assert.equal(merged.bodyweight[0].w,72);assert.equal(merged.measurements[0].waist,81);assert.equal(merged.dayNotes['2026-10-14'].text,'Synthetic day note');assert.equal(merged.exNotes['0293'],'Seat 4');
  assert.equal(merged.trainingNotes.context.text,'User-reported limitation');assert.equal(merged.active,undefined);
});

test('real paired-phone PUT: stale revision is rejected; incomplete metadata is restored and force-pulled without losing phone edits',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'opengym-old-phone-')),secret='synthetic-compat-secret',uid='fixture';
  const initial={unit:'kg',_rev:1,_wid:'first',routines:[],workouts:[{id:'agent',d:'2026-10-14',entries:[]}],bodyweight:[],week:{},dayPlan:{},
    trainingNotes:{note:{text:'User reports a limitation',priority:'important',status:'active',_ts:10}},pluginPlanHistory:[{id:'plan'}],pluginTrainingHistory:[{id:'workout'}],sessionAdjustments:{'2026-10-14':{name:'Inert legacy snapshot'}}};
  fs.writeFileSync(path.join(dir,'secret'),secret);fs.writeFileSync(path.join(dir,'db.json'),JSON.stringify({users:[{id:uid,name:'Fixture'}],creds:[],subs:[],invites:[]}));fs.writeFileSync(path.join(dir,'state-'+uid+'.json'),JSON.stringify(initial));
  const child=spawn(process.execPath,[new URL('../../server.js',import.meta.url).pathname],{env:{...process.env,PORT:'0',DATA_DIR:dir,ORIGIN:'https://gym.test',RP_ID:'gym.test',PLUGIN_ENABLED:'1',COACH_DISABLED:'1',FIRST_USER_ADMIN:'0'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
  t.after(async()=>{child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));fs.rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+await boundPort(child,()=>output),origin='https://gym.test';
  const value=`${uid}:${Date.now()+86400000}:0`,cookie='gymsid='+value+'.'+crypto.createHmac('sha256',secret).update(value).digest('base64url');
  const post=(url,body,headers={})=>fetch(base+url,{method:'POST',headers:{'content-type':'application/json',origin,...headers},body:JSON.stringify(body)});
  const code=(await(await post('/api/pair/create',{}, {cookie})).json()).code;
  const paired=await(await post('/api/pair/redeem',{code})).json();assert.ok(paired.token);
  const headers={authorization:'Bearer '+paired.token,'content-type':'application/json',origin};
  const read=async()=>{const r=await fetch(base+'/api/data',{headers});assert.equal(r.status,200);return r.json();};
  const put=body=>fetch(base+'/api/data',{method:'PUT',headers,body:JSON.stringify(body)});
  const stale=await put({state:{unit:'kg',routines:[],workouts:[]},baseRev:0,stamped:true});assert.equal(stale.status,409);assert.equal((await stale.json()).state.workouts[0].id,'agent');
  let snapshot=await read(),state=structuredClone(snapshot.state);
  for(const field of PLUGIN_FIELDS)delete state[field];state.bodyweight.push({d:'2026-10-14',w:71,t:Date.now()});state.workouts.push({id:'phone',d:'2026-10-15',entries:[]});state._ts=Date.now();
  const saved=await put({state,baseRev:snapshot.rev,baseWid:snapshot.state._wid,stamped:true});assert.equal(saved.status,200);const acknowledged=await saved.json();
  snapshot=await read();assert.ok(snapshot.rev>acknowledged.rev,'Server-corrected payload must force an old phone to pull the protected copy');
  assert.equal(snapshot.state.trainingNotes.note.text,initial.trainingNotes.note.text);assert.deepEqual(snapshot.state.pluginTrainingHistory,initial.pluginTrainingHistory);assert.equal(snapshot.state.bodyweight[0].w,71);assert.deepEqual(snapshot.state.workouts.map(w=>w.id),['agent','phone']);
  state=structuredClone(snapshot.state);state.trainingNotes.note.status='resolved';state.pluginPlanHistory=[];state.bodyweight[0].w=70;
  assert.equal((await put({state,baseRev:snapshot.rev,baseWid:snapshot.state._wid,stamped:true})).status,200);snapshot=await read();
  assert.equal(snapshot.state.trainingNotes.note.status,'active');assert.deepEqual(snapshot.state.pluginPlanHistory,initial.pluginPlanHistory);assert.equal(snapshot.state.bodyweight[0].w,70);
  state={unit:'kg',routines:[],workouts:[],bodyweight:[],resetAt:Date.now()+1000};
  assert.equal((await put({state,baseRev:snapshot.rev,baseWid:snapshot.state._wid,stamped:true})).status,200);snapshot=await read();for(const field of PLUGIN_FIELDS)assert.equal(Object.hasOwn(snapshot.state,field),false);
});
