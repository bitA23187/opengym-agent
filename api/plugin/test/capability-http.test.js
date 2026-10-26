import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createHash,randomBytes} from 'node:crypto';
import {createPlugin} from '../server.js';
import {appendTrainingUpdate} from '../training.js';

test('HTTP/OAuth: body scopes stay separate, metric drafts are account/grant bound, and reduced tokens cannot save global context',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'opengym-capabilities-'));
  const origin='https://gym.test',prefix='/api/plugin',resource=origin+prefix+'/mcp',client='https://chatgpt.com/oauth/client.json',redirect='https://chatgpt.com/connector_platform_oauth_redirect';
  const users={alice:{id:'alice',name:'Alice',sv:0},bob:{id:'bob',name:'Bob',sv:0}};
  const states=Object.fromEntries(Object.keys(users).map(id=>[id,{unit:'kg',_rev:1,_wid:'w',routines:[],workouts:[],bodyweight:[{d:'2026-10-14',w:id==='alice'?80:65}],measurements:[],week:{},dayPlan:{}}]));
  const plugin=createPlugin({origin,dataDir:dir,auditSink:()=>{},userById:id=>users[id],readSession:req=>users[req.headers.cookie],read:u=>structuredClone(states[u.id]),defaultTimezone:'Asia/Taipei',
    appendTraining:(u,d)=>states[u.id]=appendTrainingUpdate(states[u.id],d)});
  const server=http.createServer(plugin.app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{server.closeAllConnections();server.close();fs.rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port,req=(p,o={})=>fetch(base+p,{redirect:'manual',...o});
  const post=(p,b,h={})=>req(p,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',...h},body:new URLSearchParams(b)});
  async function authorize(uid,scope,clientId=client) {
    const verifier=randomBytes(32).toString('base64url');
    const r=await req(prefix+'/oauth/authorize?'+new URLSearchParams({client_id:clientId,redirect_uri:redirect,response_type:'code',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',scope,state:'test',resource}));assert.equal(r.status,302);
    const location=r.headers.get('location'),page=await(await req(location,{headers:{cookie:uid}})).text();
    if(scope.includes('body:'))assert.ok(page.includes('体重、围度'));
    const allowed=await post(prefix+'/consent',{request:new URL(location,origin).searchParams.get('request'),nonce:page.match(/name="nonce" value="([^"]+)/)[1],decision:'allow'},{cookie:uid,origin});assert.equal(allowed.status,303);
    const receipt=await req(allowed.headers.get('location'),{headers:{cookie:uid}});assert.equal(receipt.status,200);
    const callback=new URL((await receipt.text()).match(/id="return-to-chatgpt" href="([^"]+)/)[1].replaceAll('&amp;','&'));
    const token=await post(prefix+'/oauth/token',{grant_type:'authorization_code',client_id:clientId,code:callback.searchParams.get('code'),code_verifier:verifier,redirect_uri:redirect,resource});assert.equal(token.status,200);return token.json();
  }
  let id=0;
  async function call(name,args,token) {
    const r=await req(prefix+'/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify({jsonrpc:'2.0',id:++id,method:'tools/call',params:{name,arguments:args}})});assert.equal(r.status,200);return (await r.json()).result;
  }
  const value=r=>{assert.ok(!r.isError,JSON.stringify(r));return JSON.parse(r.content[0].text);},old=await authorize('alice','plan:read plan:write training:read training:write'),range={from:'2026-10-01',to:'2026-10-14'};
  const missingBody=await call('get_body_metrics',range,old.access_token);assert.ok(missingBody.isError);assert.match(missingBody._meta['mcp/www_authenticate'][0],/error="insufficient_scope"/);assert.match(missingBody._meta['mcp/www_authenticate'][0],/error_description=/);
  const expansion=await post(prefix+'/oauth/token',{grant_type:'refresh_token',client_id:client,refresh_token:old.refresh_token,resource,scope:'plan:read body:read'});assert.equal(expansion.status,400);
  const registration=await req(prefix+'/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({redirect_uris:[redirect],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})});
  assert.equal(registration.status,201);
  const a=await authorize('alice','body:read body:write',(await registration.json()).client_id),b=await authorize('bob','body:read body:write');
  assert.equal(value(await call('get_body_metrics',range,a.access_token)).bodyweight[0].weight,80);assert.equal(value(await call('get_body_metrics',range,b.access_token)).bodyweight[0].weight,65);
  assert.ok((await call('get_current_plan',{},a.access_token)).isError);
  const p=value(await call('preview_body_update',{unit:'kg',timezone:'Asia/Taipei',entries:[{date:'2026-10-14',weight:79,measurements:{waist:81}}]},a.access_token)),save={draft_id:p.draft_id,confirmed:true,confirmation_summary:p.confirmation_summary};
  assert.ok((await call('save_body_update',save,b.access_token)).isError);assert.ok((await call('save_body_update',save,old.access_token)).isError);assert.equal(states.alice.bodyweight[0].w,80);
  assert.equal(value(await call('save_body_update',save,a.access_token)).saved,true);assert.equal(states.alice.bodyweight[0].w,79);assert.equal(states.bob.bodyweight[0].w,65);
  const context=value(await call('preview_training_update',{date:'2026-10-14',context_notes:[{kind:'limitation',text:'User-reported discomfort; example fixture'}]},old.access_token));
  const reduced=await post(prefix+'/oauth/token',{grant_type:'refresh_token',client_id:client,refresh_token:old.refresh_token,resource,scope:'plan:read training:write'});assert.equal(reduced.status,200);const narrow=await reduced.json();
  const saveContext={draft_id:context.draft_id,confirmed:true,confirmation_summary:context.confirmation_summary};
  const missingPlan=await call('save_training_update',saveContext,narrow.access_token);assert.ok(missingPlan.isError,'Same grant with reduced scope must not save important context');assert.match(missingPlan._meta['mcp/www_authenticate'][0],/plan:write/);
  assert.equal(states.alice.trainingNotes,undefined);assert.equal(value(await call('save_training_update',saveContext,old.access_token)).saved,true);
  assert.equal(value(await call('get_current_plan',{},old.access_token)).training_context.important_notes.length,1);
  // Custom exercise discovery and lifecycle cross the same authenticated HTTP boundary.
  const customInput={operation:'create',fields:{name:'室内难度攀岩',body_part:'back',equipment:'climbing wall',aliases:['Indoor lead climbing']}};
  assert.ok((await call('preview_custom_exercise',customInput,a.access_token)).isError);
  const cp=value(await call('preview_custom_exercise',customInput,old.access_token));
  const customSave={draft_id:cp.draft_id,confirmed:true,confirmation_summary:cp.confirmation_summary};
  assert.equal(states.alice.customEx,undefined);
  const bob=await authorize('bob','plan:read plan:write training:read');
  assert.ok((await call('save_custom_exercise',customSave,bob.access_token)).isError);
  assert.ok((await call('save_custom_exercise',customSave,narrow.access_token)).isError);
  assert.ok((await call('save_training_update',customSave,old.access_token)).isError);
  assert.ok((await call('save_custom_exercise',{...customSave,confirmation_summary:'Changed'},old.access_token)).isError);
  assert.equal(value(await call('save_custom_exercise',customSave,old.access_token)).saved,true);
  assert.equal(value(await call('save_custom_exercise',customSave,old.access_token)).already_saved,true);
  const search={query:'Indoor lead climbing'};
  assert.equal(value(await call('search_exercises',search,old.access_token)).candidates[0].exercise_id,cp.exercise_id);
  for(const token of [undefined,bob.access_token,a.access_token,narrow.access_token]) {
    // Narrow Alice still has plan:read, so her own entry is visible; other accounts/body-only/public cannot see it.
    const found=value(await call('search_exercises',search,token));
    assert.equal(found.total,token===narrow.access_token?1:0);
  }
  assert.equal(value(await call('list_custom_exercises',{},bob.access_token)).total,0);
  assert.ok((await call('list_custom_exercises',{})).isError);
  assert.ok((await call('preview_custom_exercise',{operation:'delete',exercise_id:cp.exercise_id},bob.access_token)).isError);
  for(const operation of ['update','archive','restore','delete']) {
    const p=value(await call('preview_custom_exercise',{operation,exercise_id:cp.exercise_id,...(operation==='update'?{fields:{description:'Record grades in notes'}}:{})},old.access_token));
    assert.equal(value(await call('save_custom_exercise',{draft_id:p.draft_id,confirmed:true,confirmation_summary:p.confirmation_summary},old.access_token)).saved,true);
    if(operation==='archive') {
      assert.equal(value(await call('search_exercises',search,old.access_token)).total,0);
      assert.equal(value(await call('search_exercises',{...search,include_archived:true},old.access_token)).candidates[0].archived,true);
      assert.equal(value(await call('list_custom_exercises',{status:'archived'},old.access_token)).total,1);
      assert.equal(value(await call('get_exercise_details',{exercise_id:cp.exercise_id},old.access_token)).archived,true);
    }
  }
  assert.equal(states.alice.customEx.length,0);assert.equal(states.bob.customEx,undefined);

});
