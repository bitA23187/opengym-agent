import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { createPlugin } from '../server.js';
import { appendPlan, appendPlanEdit } from '../state.js';
import { appendTrainingUpdate } from '../training.js';
import { searchCatalogue } from '../catalogue.js';
const issuer='https://gym.test', prefix='/api/plugin', resource=issuer+prefix+'/mcp';
const client='https://chatgpt.com/oauth/client.json', callback='https://chatgpt.com/connector_platform_oauth_redirect';
const digest=s=>createHash('sha256').update(s).digest('base64url');
test('Chinese search matches non-contiguous equipment and movement; preserves ambiguity',()=>{
 const r=searchCatalogue('哑铃划船');assert.ok(r.total>0);assert.ok(r.requires_disambiguation);assert.ok(r.candidates.every(e=>e.equipment==='dumbbell'));assert.ok(r.candidates.some(e=>e.name_zh.includes('划船')));
 assert.equal(searchCatalogue('nonexistentfoobar').total,0);
});
test('OAuth + MCP end-to-end: scopes, consent, PKCE, append, conflict, revocation',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'opengym-plugin-'));
 const user={id:'fixture',name:'Test <user>',sv:0};
 let state={unit:'kg',routines:[{id:'old',name:'Old',ex:[{id:'0293',sets:3,reps:10,weight:12,restSec:90}]}],week:{1:'old'},workouts:[{id:'history',d:'2026-10-14',name:'Earlier',entries:[]}],bodyweight:[{d:'2026-10-14',w:80}],exWeights:{'0293':{w:12}},unknown:{preserve:true},_rev:7,_wid:'oldwid'};
 const before=structuredClone(state);
 const audits=[];
 const plugin=createPlugin({defaultTimezone:'Asia/Taipei',auditSink:e=>audits.push(e),origin:issuer,dataDir:dir,userById:id=>id===user.id?user:undefined,
  readSession:req=>req.headers.cookie==='fixture=valid'?user:null,read:()=>structuredClone(state),
  append:(u,d)=>{state=appendPlan(state,d);return{saved:true,revision:state._rev};},
  appendEdit:(u,d)=>{state=appendPlanEdit(state,d);return{saved:true,revision:state._rev};},
  appendTraining:(u,d)=>{state=appendTrainingUpdate(state,d);return state;}});
 const server=http.createServer(plugin.app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();server.close();fs.rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port;
 const req=(p,options={})=>fetch(base+p,{redirect:'manual',...options});
 const post=(p,body,headers={})=>req(p,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',...headers},body:new URLSearchParams(body)});
 let response=await req('/.well-known/oauth-authorization-server');let meta=await response.json();
 assert.equal(meta.issuer,issuer);assert.equal(meta.authorization_response_iss_parameter_supported,true);
 response=await req('/.well-known/oauth-protected-resource'+prefix+'/mcp');assert.equal((await response.json()).resource,resource);
 // Invalid redirects must be rejected before redirecting. No open redirect or SSRF.
 response=await req(prefix+'/oauth/authorize?'+new URLSearchParams({client_id:client,redirect_uri:'https://evil.test/cb'}));assert.equal(response.status,400);
 response=await req(prefix+'/oauth/authorize?'+new URLSearchParams({client_id:client,redirect_uri:callback,response_type:'code',code_challenge:'x'.repeat(43),code_challenge_method:'plain'}));
 assert.equal(new URL(response.headers.get('location')).searchParams.get('iss'),issuer);
 response=await req(prefix+'/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({redirect_uris:['https://evil.test/cb'],token_endpoint_auth_method:'none'})});assert.equal(response.status,400);
 response=await req(prefix+'/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({redirect_uris:[callback],token_endpoint_auth_method:'client_secret_post',grant_types:['authorization_code','refresh_token'],response_types:['code']})});
 assert.equal(response.status,201);const registered=await response.json();assert.ok(registered.client_secret);assert.ok(registered.client_id);
 async function authorize(scope='plan:read plan:write training:read training:write', oauthClient=client) {
   const verifier='a'.repeat(43);
   const params={client_id:oauthClient,redirect_uri:callback,response_type:'code',code_challenge:digest(verifier),code_challenge_method:'S256',scope,state:'test-state',resource};
   const start=await req(prefix+'/oauth/authorize?'+new URLSearchParams(params));assert.equal(start.status,302);
   const consent=start.headers.get('location');
   assert.ok((await(await req(consent)).text()).includes('请先登录'));
   const consentResponse=await req(consent,{headers:{cookie:'fixture=valid'}});
   assert.ok(consentResponse.headers.get('content-security-policy').includes("form-action 'self' https://chatgpt.com;"),'Browser must permit the exact OAuth callback origin through the POST redirect');
   assert.equal(consentResponse.headers.get('referrer-policy'),'strict-origin');
   const page=await consentResponse.text();assert.ok(page.includes('Test &lt;user&gt;'));
   assert.ok(consentResponse.headers.get('content-security-policy').includes("script-src 'nonce-"));
   const fields={request:new URL(consent,issuer).searchParams.get('request'),nonce:page.match(/name="nonce" value="([^"]+)/)[1],decision:'allow'};
   const csrf=await post(prefix+'/consent',fields,{cookie:'fixture=valid',origin:'https://evil.test'});assert.equal(csrf.status,403);
   const approved=await post(prefix+'/consent',fields,{cookie:'fixture=valid',origin:issuer});assert.equal(approved.status,303);
   const receipt=await req(approved.headers.get('location'),{headers:{cookie:'fixture=valid'}});assert.equal(receipt.status,200);
   const url=new URL((await receipt.text()).match(/id="return-to-chatgpt" href="([^"]+)/)[1].replaceAll('&amp;','&'));assert.equal(url.searchParams.get('state'),'test-state');assert.equal(url.searchParams.get('iss'),issuer);
   const body={grant_type:'authorization_code',client_id:oauthClient,code:url.searchParams.get('code'),code_verifier:verifier,redirect_uri:callback,resource};
   const bad=await post(prefix+'/oauth/token',{...body,code_verifier:'b'.repeat(43)});assert.equal(bad.status,400);
   const wrong=await post(prefix+'/oauth/token',{...body,resource:'https://evil.test/mcp'});assert.equal(wrong.status,400);
   const tokens=await post(prefix+'/oauth/token',body);assert.equal(tokens.status,200);const value=await tokens.json();assert.ok(value.access_token);
   assert.equal((await post(prefix+'/oauth/token',body)).status,400);
   return value;
 }
 // Independent clients keep simultaneous grants for scope/isolation checks.
 async function separateClient(scope) {
   const response=await req(prefix+'/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({redirect_uris:[callback],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})});
   assert.equal(response.status,201);
   return authorize(scope,(await response.json()).client_id);
 }
 let id=0;
 async function rpc(method,params,token) {
   const r=await req(prefix+'/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
   return {status:r.status,value:await r.json()};
 }
 const list=await rpc('tools/list',{});assert.equal(list.status,200);assert.equal(list.value.result.tools.length,27);
 const trainingDescriptor=list.value.result.tools.find(t=>t.name==='preview_training_update');
 assert.ok(trainingDescriptor.inputSchema.properties.timezone);
 assert.ok(!trainingDescriptor.inputSchema.required.includes('timezone'),'Older cached clients must not need a new field');
 assert.ok(trainingDescriptor.inputSchema.properties.workout.properties.exercises.items.properties.sets.items.properties.drops);
 const saveDescriptor=list.value.result.tools.find(x=>x.name==='save_plan');assert.equal(saveDescriptor.annotations.readOnlyHint,false);assert.equal(saveDescriptor.annotations.destructiveHint,false);assert.ok(saveDescriptor.inputSchema.required.includes('confirmation_summary'));
 assert.equal(list.value.result.tools.find(x=>x.name==='preview_plan').annotations.idempotentHint,false);
 const unauth=await rpc('tools/call',{name:'get_current_plan',arguments:{}});assert.equal(unauth.value.result.isError,true);assert.ok(unauth.value.result._meta['mcp/www_authenticate']);
 const publicSearch=await rpc('tools/call',{name:'search_exercises',arguments:{query:'哑铃划船'}});assert.ok(JSON.parse(publicSearch.value.result.content[0].text).total>0);
 const tokens=await authorize();
 const current=await rpc('tools/call',{name:'get_current_plan',arguments:{}},tokens.access_token);assert.equal(JSON.parse(current.value.result.content[0].text).unit,'kg');assert.ok(!current.value.result.content[0].text.includes('history'));
 const args={unit:'kg',routines:[{name:'New',exercises:[{exercise_id:'0293',sets:3,reps:10,weight:12}]}]};
 const badPlan=await rpc('tools/call',{name:'preview_plan',arguments:{...args,routines:[{name:'Bad',exercises:[{exercise_id:'fake',sets:3,reps:10}]}]}},tokens.access_token);assert.equal(badPlan.value.result.isError,true);
 const preview=await rpc('tools/call',{name:'preview_plan',arguments:args},tokens.access_token);assert.ok(!preview.value.result.isError,JSON.stringify(preview.value));
 const draftInfo=JSON.parse(preview.value.result.content[0].text),draft=draftInfo.draft_id,confirmation_summary=draftInfo.confirmation_summary;
 assert.ok(confirmation_summary.includes('dumbbell bent over row'));assert.ok(confirmation_summary.includes('12 kg'));
assert.equal(state.routines.length,1);
 const unconfirmed=await rpc('tools/call',{name:'save_plan',arguments:{draft_id:draft,confirmation_summary,confirmed:false}},tokens.access_token);assert.ok(unconfirmed.value.result.isError);
 const mismatch=await rpc('tools/call',{name:'save_plan',arguments:{draft_id:draft,confirmed:true,confirmation_summary:'Different changes'}},tokens.access_token);
 assert.equal(mismatch.value.result.isError,true);assert.equal(state.routines.length,1);
 const saved=await rpc('tools/call',{name:'save_plan',arguments:{draft_id:draft,confirmation_summary,confirmed:true}},tokens.access_token);assert.ok(!saved.value.result.isError,JSON.stringify(saved.value));assert.equal(state.routines.length,2);assert.equal(state._rev,8);
 for(const k of ['workouts','bodyweight','exWeights','week','unknown'])assert.deepEqual(state[k],before[k]);assert.deepEqual(state.routines[0],before.routines[0]);
 const repeated=await rpc('tools/call',{name:'save_plan',arguments:{draft_id:draft,confirmation_summary,confirmed:true}},tokens.access_token);assert.equal(JSON.parse(repeated.value.result.content[0].text).already_saved,true);assert.equal(state.routines.length,2);
 const p2=await rpc('tools/call',{name:'preview_plan',arguments:args},tokens.access_token);const d2=JSON.parse(p2.value.result.content[0].text).draft_id;state._rev++;
 const conflict=await rpc('tools/call',{name:'save_plan',arguments:{draft_id:d2,confirmation_summary:JSON.parse(p2.value.result.content[0].text).confirmation_summary,confirmed:true}},tokens.access_token);assert.equal(conflict.value.result.isError,true);assert.equal(state.routines.length,2);
 const edits={routine_id:'old',operations:[
  {type:'rename_routine',name:'Updated Day'},
  {type:'update_exercise',index:0,fields:{weight:15,note:'Keep elbow tucked'}},
  {type:'set_weekday',weekday:2,routine_ids:['old']},
  {type:'set_date',date:'2026-10-15',routine_id:'old'}
 ]};
 const editPreview=await rpc('tools/call',{name:'preview_plan_edit',arguments:edits},tokens.access_token);
 assert.ok(!editPreview.value.result.isError,JSON.stringify(editPreview.value));
 const editDraft=JSON.parse(editPreview.value.result.content[0].text);
 assert.ok(editDraft.confirmation_summary.includes('Keep elbow tucked'));
 const editSaved=await rpc('tools/call',{name:'save_plan_edit',arguments:{draft_id:editDraft.draft_id,confirmed:true,confirmation_summary:editDraft.confirmation_summary}},tokens.access_token);
 assert.ok(!editSaved.value.result.isError,JSON.stringify(editSaved.value));
 assert.equal(state.routines[0].name,'Updated Day');assert.equal(state.routines[0].ex[0].weight,15);
 assert.equal(state.week[2],'old');assert.equal(state.dayPlan['2026-10-15'],'old');
 const training={timezone:'Asia/Taipei',date:'2026-10-15',day_note:'Right elbow felt uncomfortable after pressing.',day_note_tag:'injured',
  exercise_notes:[{exercise_id:'0293',note:'Keep elbow tucked'}],
  workout:{routine_id:'old',name:'Upper',started_at:'2026-10-15T18:30:00+08:00',duration_minutes:48,session_note:'Stopped before pain increased.',
   exercises:[
    {exercise_id:'0293',mode:'reps',sets:[{weight:15,reps:10},{weight:15,reps:9},{weight:15,reps:8}],note:'Elbow felt sore on the last set.',note_pin:true},
    {exercise_id:'0293',mode:'reps',per_side:true,sets:[{weight:15,reps:10}]},
    {exercise_id:'0293',mode:'time',per_side:true,sets:[{weight:15,seconds:45}]}
   ]}};
 const trainingPreview=await rpc('tools/call',{name:'preview_training_update',arguments:training},tokens.access_token);
 assert.ok(!trainingPreview.value.result.isError,JSON.stringify(trainingPreview.value));
 const trainingDraft=JSON.parse(trainingPreview.value.result.content[0].text);
 const {timezone:_unused,...legacyTraining}=training;
 const legacyPreview=await rpc('tools/call',{name:'preview_training_update',arguments:legacyTraining},tokens.access_token);
 assert.ok(!legacyPreview.value.result.isError,JSON.stringify(legacyPreview.value));
 assert.equal(JSON.parse(legacyPreview.value.result.content[0].text).timezone,'Asia/Taipei');
 assert.equal(state.workouts.length,1,'Preview, including a compatibility probe, must not save history');
 assert.ok(trainingDraft.confirmation_summary.includes('Right elbow felt uncomfortable'));
 assert.ok(trainingDraft.confirmation_summary.includes('15 kg × 9'));
 assert.ok(trainingDraft.confirmation_summary.includes('10 each side'));
 const trainingSaved=await rpc('tools/call',{name:'save_training_update',arguments:{draft_id:trainingDraft.draft_id,confirmed:true,confirmation_summary:trainingDraft.confirmation_summary}},tokens.access_token);
 assert.ok(!trainingSaved.value.result.isError,JSON.stringify(trainingSaved.value));
 assert.equal(state.workouts.length,2);assert.equal(state.workouts[1].d,'2026-10-15');
 assert.equal(state.workouts[1].start,Date.parse('2026-10-15T18:30:00+08:00'));
 assert.equal(state.workouts[1].end-state.workouts[1].start,48*60000);
 assert.equal(state.workouts[1].entries[0].sets[1].r,9);assert.equal(state.workouts[1].entries[0].notePin,true);
 assert.equal(state.workouts[1].entries[1].sets[0].r,20);assert.equal(state.workouts[1].entries[1].sets[0].sides.L.r,10);
 assert.equal(state.workouts[1].entries[1].target.side,true);
 assert.deepEqual(state.workouts[1].entries[2].sets.map(x=>x.side),['L','R']);
 assert.equal(state.dayNotes['2026-10-15'].text,'Right elbow felt uncomfortable after pressing.');
 assert.equal(state.exNotes['0293'],'Keep elbow tucked');
 // Read the imported evidence through the real OAuth/MCP boundary.
 const readCases=[['get_training_session',{timezone:'Asia/Taipei',date:'2026-10-15'}],['list_training_history',{from:'2026-10-01',to:'2026-10-31',limit:1}],['get_training_workout',{workout_id:state.workouts[1].id}],['get_training_summary',{from:'2026-10-01',to:'2026-10-31'}],['get_plan_versions',{}]];
 for(const [name,args] of readCases) {
   const r=await rpc('tools/call',{name,arguments:args},tokens.access_token);
   assert.ok(!r.value.result.isError,JSON.stringify(r.value));
   assert.ok(!r.value.result.content[0].text.includes('"bw"'));
 }
 const historyOnly=await separateClient('training:read');
 assert.ok(!(await rpc('tools/call',{name:'get_training_summary',arguments:{from:'2026-10-01',to:'2026-10-31'}},historyOnly.access_token)).value.result.isError);
 assert.ok((await rpc('tools/call',{name:'get_current_plan',arguments:{}},historyOnly.access_token)).value.result.isError);
 const oldWrite=await separateClient('plan:read plan:write training:write');
 for(const [name,args] of readCases.slice(0,4))assert.ok((await rpc('tools/call',{name,arguments:args},oldWrite.access_token)).value.result.isError,'Old write grant must not gain history access');
 const correctionDenied=await rpc('tools/call',{name:'preview_training_update',arguments:{timezone:'Asia/Taipei',date:'2026-10-15',workout_id:state.workouts[1].id,delete_workout:true}},oldWrite.access_token);
 assert.ok(correctionDenied.value.result.isError);assert.equal(state.workouts.length,2);
 const duplicate=await rpc('tools/call',{name:'preview_training_update',arguments:training},tokens.access_token);
 const duplicateDraft=JSON.parse(duplicate.value.result.content[0].text);
 const duplicateSave=await rpc('tools/call',{name:'save_training_update',arguments:{draft_id:duplicateDraft.draft_id,confirmed:true,confirmation_summary:duplicateDraft.confirmation_summary}},tokens.access_token);
 assert.equal(duplicateSave.value.result.isError,true);assert.equal(state.workouts.length,2);
 const incomplete=await rpc('tools/call',{name:'preview_training_update',arguments:{timezone:'Asia/Taipei',date:'2026-10-15',workout:{exercises:[{exercise_id:'0293',mode:'reps',sets:[{reps:10}]}]}}},tokens.access_token);
 assert.equal(incomplete.value.result.isError,true);assert.equal(state.workouts.length,2);
 const noStart=await rpc('tools/call',{name:'preview_training_update',arguments:{timezone:'Asia/Taipei',date:'2026-10-15',workout:{duration_minutes:40,exercises:[{exercise_id:'0293',mode:'reps',sets:[{weight:15,reps:10}]}]}}},tokens.access_token);
 assert.equal(noStart.value.result.isError,true);
 const tooFuture=new Date();tooFuture.setUTCDate(tooFuture.getUTCDate()+3);
 const futureNote=await rpc('tools/call',{name:'preview_training_update',arguments:{timezone:'Asia/Taipei',date:tooFuture.toISOString().slice(0,10),day_note:'Future note.'}},tokens.access_token);
 assert.equal(futureNote.value.result.isError,true);
 const readOnly=await separateClient('plan:read');const denied=await rpc('tools/call',{name:'preview_plan',arguments:args},readOnly.access_token);assert.equal(denied.value.result.isError,true);
 const noTraining=await separateClient('plan:read plan:write');
 const trainingDenied=await rpc('tools/call',{name:'preview_training_update',arguments:{timezone:'Asia/Taipei',date:'2026-10-15',day_note:'Not authorized yet.'}},noTraining.access_token);
 assert.equal(trainingDenied.value.result.isError,true);
 assert.ok(audits.some(e=>e.tool==='save_plan'&&e.phase==='received'));
 assert.ok(audits.some(e=>e.tool==='save_plan'&&e.phase==='tool_succeeded'&&e.saved));
 assert.ok(audits.some(e=>e.reason==='confirmation_mismatch'));
 assert.ok(!JSON.stringify(audits).includes(tokens.access_token));assert.ok(!JSON.stringify(audits).includes(confirmation_summary));assert.ok(!JSON.stringify(audits).includes('fixture'));
 assert.ok(!JSON.stringify(audits).includes('Right elbow felt uncomfortable'));
 // The persisted OAuth store contains hashes, never raw access/refresh tokens.
 const disk=fs.readFileSync(path.join(dir,'plugin-oauth.json'),'utf8');assert.ok(!disk.includes(tokens.access_token));assert.ok(!disk.includes(tokens.refresh_token));assert.equal(fs.statSync(path.join(dir,'plugin-oauth.json')).mode&0o777,0o600);
 const refreshBody={grant_type:'refresh_token',client_id:client,refresh_token:tokens.refresh_token,resource};
 const refreshed=await post(prefix+'/oauth/token',refreshBody);assert.equal(refreshed.status,200);const rotated=await refreshed.json();
 assert.equal((await post(prefix+'/oauth/token',refreshBody)).status,400);assert.equal((await rpc('tools/list',{},rotated.access_token)).status,401);
 // Logout-all/session version invalidates the OAuth grant too.
 user.sv++;assert.equal((await rpc('tools/list',{},readOnly.access_token)).status,401);
 const newTokens=await authorize();
 const management=await(await req(prefix+'/connections',{headers:{cookie:'fixture=valid'}})).text();
 const nonce=management.match(/name="nonce" value="([^"]+)/)[1],grant=management.match(/name="grant" value="([^"]+)/)[1];
 assert.equal((await post(prefix+'/connections',{nonce,grant},{cookie:'fixture=valid',origin:issuer})).status,302);
 // There can be other old grants; explicit token revocation must invalidate the exact family.
 assert.equal((await post(prefix+'/oauth/revoke',{client_id:client,token:newTokens.refresh_token})).status,200);
 assert.equal((await rpc('tools/list',{},newTokens.access_token)).status,401);
});

test('drafts cannot be saved by another account or authorization',async()=>{
 const { createPlans }=await import('../plans.js');
 let writes=0;
 const plans=createPlans({read:()=>({unit:'kg',routines:[],_rev:1,_wid:'w'}),append:()=>{writes++;return{saved:true};}});
 const input={unit:'kg',routines:[{name:'A',exercises:[{exercise_id:'0293',sets:3,reps:10}]}]};
 const draft=plans.preview({id:'alice'},'grant-a',input);
 assert.throws(()=>plans.save({id:'bob'},'grant-b',draft.draft_id,true),/different authorization/);
 assert.throws(()=>plans.save({id:'alice'},'grant-b',draft.draft_id,true),/different authorization/);
 assert.equal(writes,0);
 assert.throws(()=>plans.preview({id:'alice'},'grant-a',{...input,unit:'lb'}),/account weight unit/);
});

test('routine editing resolves legacy cardio modes and rejects incompatible fields',async()=>{
 const {createPlans}=await import('../plans.js');
 const {LIBRARY}=await import('../../coach/core/library.js');
 const cardio=LIBRARY.find(e=>e.bp==='cardio');assert.ok(cardio);
 const state={unit:'kg',routines:[{id:'run',name:'Run',ex:[{id:cardio.id,sets:1,min:20,weight:0}]}],week:{},_rev:1,_wid:'w'};
 const plans=createPlans({read:()=>structuredClone(state),append:()=>{},appendEdit:()=>{}});
 const updated=plans.previewEdit({id:'alice'},'grant-a',{routine_id:'run',operations:[{type:'update_exercise',index:0,fields:{minutes:25}}]});
 assert.ok(updated.confirmation_summary.includes('25'));
 assert.throws(()=>plans.previewEdit({id:'alice'},'grant-a',{routine_id:'run',operations:[{type:'update_exercise',index:0,fields:{reps:10}}]}),/Reps can only be edited/);
 assert.throws(()=>plans.previewEdit({id:'alice'},'grant-a',{routine_id:'run',operations:[{type:'set_weekday',weekday:1,routine_ids:['run','run']}]}),/unique/);
});
