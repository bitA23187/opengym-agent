import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { boundPort } from '../../test/helpers.mjs';

const origin='https://gym.test', prefix='/api/plugin', resource=origin+prefix+'/mcp';
const client='https://chatgpt.com/oauth/client.json', redirect='https://chatgpt.com/connector_platform_oauth_redirect';
const secret='synthetic-multi-user-test-secret';
const cookie=uid=>{
  const payload=`${uid}:${Date.now()+86400000}:0`;
  return `gymsid=${payload}.${crypto.createHmac('sha256',secret).update(payload).digest('base64url')}`;
};
const seed=uid=>({unit:'kg',_rev:1,_wid:'same-revision-and-write-id',
  routines:[{id:'shared-routine-id',name:`${uid}-private-routine`,ex:[{id:'0293',mode:'reps',sets:2,reps:10,weight:12,prog:'off'}]}],
  week:{3:'shared-routine-id'},customEx:[{id:`custom-${uid}`,n:`${uid}-private-exercise`,mode:'reps'}],
  workouts:[{id:'shared-workout-id',d:'2026-10-14',name:`${uid}-private-workout`,entries:[]},
    {id:`workout-${uid}`,d:'2026-10-13',name:`${uid}-private-history`,entries:[]}],
  dayNotes:{'2026-10-14':{text:`${uid}-private-note`}},bodyweight:[{d:'2026-10-14',w:80}],
  trainingNotes:{context:{text:`${uid}-private-context`,priority:'important',status:'active'}},coach:{profile:{notes:`${uid}-private-profile`}},pluginPlanHistory:[]});

test('real API: two OAuth users cannot read, write, save drafts or revoke connections across accounts',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'opengym-isolation-'));
  const stateFile=uid=>path.join(dir,`state-${uid}.json`);
  const disk=uid=>fs.readFileSync(stateFile(uid),'utf8');
  fs.writeFileSync(path.join(dir,'secret'),secret,{mode:0o600});
  fs.writeFileSync(path.join(dir,'db.json'),JSON.stringify({users:[
    {id:'alice',name:'Alice',admin:true},{id:'bob',name:'Bob'}
  ],creds:[],subs:[],invites:[]}));
  for(const uid of ['alice','bob'])fs.writeFileSync(stateFile(uid),JSON.stringify(seed(uid)));
  const child=spawn(process.execPath,[new URL('../../server.js',import.meta.url).pathname],{
    env:{...process.env,PORT:'0',DATA_DIR:dir,ORIGIN:origin,RP_ID:'gym.test',PLUGIN_ENABLED:'1',
      COACH_DISABLED:'1',FIRST_USER_ADMIN:'0',ADMIN_UIDS:'',INVITE_ONLY:'1',ALLOW_GUEST:'0',AUDIT_IP:'none'},
    stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
  t.after(async()=>{child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));fs.rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+await boundPort(child,()=>output);
  const req=(url,options={})=>fetch(base+url,{redirect:'manual',...options});
  const post=(url,body,headers={})=>req(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',...headers},body:new URLSearchParams(body)});
  const jsonPost=(url,body,uid)=>req(url,{method:'POST',headers:{'content-type':'application/json',origin,...(uid?{cookie:cookie(uid)}:{})},body:JSON.stringify(body)});
  const guide=await req(prefix+'/connect');assert.equal(guide.status,200);
  const publicGuide=await guide.text();assert.ok(publicGuide.includes(resource));assert.ok(!publicGuide.includes('Alice'));
  assert.equal(guide.headers.get('cache-control'),'no-store');
  const ownGuide=await(await req(prefix+'/connect',{headers:{cookie:cookie('bob')}})).text();
  assert.equal(ownGuide,publicGuide); // The setup guide is the same for every visitor.
  // Invitation creation remains admin-only. A signup link is not a login/pairing credential.
  assert.equal((await jsonPost('/api/admin/invites/new',{},'bob')).status,403);
  const invitation=await jsonPost('/api/admin/invites/new',{},'alice');assert.equal(invitation.status,200);
  const invite=(await invitation.json()).invite;
  assert.match(invite.code,/^[A-F0-9]{16}$/);
  assert.equal((await jsonPost('/api/register/options',{name:'Invited Friend',code:invite.code})).status,200);
  assert.equal((await jsonPost('/api/register/options',{name:'No Invite'})).status,403);
  async function authorize(uid,clientId=client) {
    const verifier=crypto.randomBytes(32).toString('base64url');
    const start=await req(prefix+'/oauth/authorize?'+new URLSearchParams({client_id:clientId,redirect_uri:redirect,
      response_type:'code',code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method:'S256',scope:'plan:read plan:write training:read training:write',state:`state-${uid}`,resource}));
    assert.equal(start.status,302);
    const consent=start.headers.get('location');
    const oldPage=await(await req(consent,{headers:{cookie:cookie(uid)}})).text();
    const page=await(await req(consent,{headers:{cookie:cookie(uid)}})).text();
    assert.ok(page.includes(uid==='alice'?'Alice':'Bob'));
    const fields={request:new URL(consent,origin).searchParams.get('request'),nonce:page.match(/name="nonce" value="([^"]+)/)[1],decision:'allow'};
    assert.equal((await post(prefix+'/consent',{...fields,nonce:oldPage.match(/name="nonce" value="([^"]+)/)[1]},{cookie:cookie(uid),origin})).status,403);
    // A consent page displayed for one account cannot be submitted by another.
    assert.equal((await post(prefix+'/consent',fields,{cookie:cookie(uid==='alice'?'bob':'alice'),origin})).status,403);
    const approval=await post(prefix+'/consent',fields,{cookie:cookie(uid),origin});assert.equal(approval.status,303);
    const receipt=await req(approval.headers.get('location'),{headers:{cookie:cookie(uid)}});assert.equal(receipt.status,200);
    const callback=new URL((await receipt.text()).match(/id="return-to-chatgpt" href="([^"]+)/)[1].replaceAll('&amp;','&'));assert.equal(callback.searchParams.get('state'),`state-${uid}`);
    const response=await post(prefix+'/oauth/token',{grant_type:'authorization_code',client_id:clientId,
      code:callback.searchParams.get('code'),code_verifier:verifier,redirect_uri:redirect,resource});
    assert.equal(response.status,200);return response.json();
  }
  let rpcId=0;
  async function rpc(name,args,token,extraHeaders={}) {
    const response=await req(prefix+'/mcp?userId=alice&uid=alice',{method:'POST',headers:{
      'content-type':'application/json',accept:'application/json, text/event-stream',
      ...(token?{authorization:'Bearer '+token}:{}),...extraHeaders},
      body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method:'tools/call',params:{name,arguments:args}})});
    return {status:response.status,body:await response.json()};
  }
  const ok=response=>{
    assert.equal(response.status,200);assert.ok(!response.body.result?.isError,JSON.stringify(response.body));
    return JSON.parse(response.body.result.content[0].text);
  };
  const denied=response=>{assert.equal(response.status,200);assert.equal(response.body.result.isError,true);};
  const tokens={alice:await authorize('alice'),bob:await authorize('bob')};
  const registration=await req(prefix+'/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({redirect_uris:[redirect],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})});
  assert.equal(registration.status,201);
  const bobSecond=await authorize('bob',(await registration.json()).client_id);
  const mobile={};
  for(const uid of ['alice','bob']) {
    const pairing=await jsonPost('/api/pair/create',{},uid);assert.equal(pairing.status,200);
    const code=(await pairing.json()).code;
    const redeemed=await jsonPost('/api/pair/redeem',{code});assert.equal(redeemed.status,200);
    const phone=await redeemed.json();assert.equal(phone.user.id,uid);mobile[uid]=phone.token;
    assert.equal((await jsonPost('/api/pair/redeem',{code})).status,400);
    const profile=await rpc('get_profile',{},tokens[uid].access_token);
    assert.deepEqual(profile.body.result.structuredContent,ok(profile));
    assert.equal(ok(profile).id,uid);
    assert.equal(ok(profile).name,uid==='alice'?'Alice':'Bob');
  }
  for(const uid of ['alice','bob']) {
    const other=uid==='alice'?'bob':'alice',token=tokens[uid].access_token;
    for(const [name,args] of [
      ['get_current_plan',{}],['get_plan_versions',{}],['get_training_notes',{}],['get_training_versions',{}],['get_exercise_details',{exercise_id:'0293'}],
      ['get_training_session',{timezone:'Asia/Taipei',date:'2026-10-14'}],
      ['list_training_history',{from:'2026-10-01',to:'2026-10-14'}],
      ['get_training_workout',{workout_id:'shared-workout-id'}],
      ['get_training_summary',{from:'2026-10-01',to:'2026-10-14'}]
    ]) {
      // Cookie, query, headers and model-supplied IDs must never override OAuth identity.
      const value=ok(await rpc(name,{...args,userId:other,uid:other},token,{cookie:cookie(other),'x-user-id':other}));
      assert.ok(!JSON.stringify(value).includes(`${other}-private-`),name+' leaked the other account');
      if(name==='get_current_plan')assert.equal(value.routines[0].name,`${uid}-private-routine`);
      if(name==='get_training_workout')assert.equal(value.workout.name,`${uid}-private-workout`);
    }
    const missing=await rpc('get_training_workout',{workout_id:`workout-${other}`},token);
    denied(missing);assert.ok(!JSON.stringify(missing).includes(`${other}-private-`));
    denied(await rpc('preview_plan',{unit:'kg',routines:[{name:'Foreign exercise',exercises:[{exercise_id:`custom-${other}`,sets:2,reps:10}]}]},token));
    denied(await rpc('preview_plan_edit',{routine_id:`routine-${other}`,operations:[{type:'rename_routine',name:'Attack'}]},token));
    denied(await rpc('preview_training_update',{date:'2026-10-13',timezone:'Asia/Taipei',workout_id:`workout-${other}`,delete_workout:true},token));
  }
  // The browser API refuses Plugin credentials, even for the administrator's connection.
  for(const uid of ['alice','bob'])for(const url of ['/api/data','/api/admin/users','/api/admin/user?id=alice','/api/admin/invites']) {
    assert.equal((await req(url,{headers:{authorization:'Bearer '+tokens[uid].access_token}})).status,401);
  }
  for(const url of ['/api/admin/users','/api/admin/user?id=alice','/api/admin/invites']) {
    assert.equal((await req(url,{headers:{cookie:cookie('bob')}})).status,403);
  }
  denied(await rpc('get_current_plan',{},undefined,{cookie:cookie('alice')}));

  const aliceBefore=disk('alice'),bobBefore=disk('bob');
  const planInput={unit:'kg',routines:[{name:'Bob new template',exercises:[{exercise_id:'0293',sets:2,reps:10,weight:12}]}]};
  for(const [preview,save,args] of [
    ['preview_plan','save_plan',planInput],
    ['preview_plan_edit','save_plan_edit',{routine_id:'shared-routine-id',operations:[{type:'rename_routine',name:'Bob edited template'}]}],
    ['preview_training_update','save_training_update',{date:'2026-10-14',timezone:'Asia/Taipei',day_note:'Bob updated note'}]
  ]) {
    const adminDraft=ok(await rpc(preview,args,tokens.alice.access_token));
    denied(await rpc(save,{draft_id:adminDraft.draft_id,confirmed:true,confirmation_summary:adminDraft.confirmation_summary},tokens.bob.access_token));
    assert.equal(disk('alice'),aliceBefore);
    const draft=ok(await rpc(preview,args,tokens.bob.access_token));
    const saveArgs={draft_id:draft.draft_id,confirmed:true,confirmation_summary:draft.confirmation_summary};
    // Even with exact draft ID + summary and identical revision/wid, another user
    // (including admin) and another grant for the SAME user must be refused.
    denied(await rpc(save,saveArgs,tokens.alice.access_token));
    denied(await rpc(save,saveArgs,bobSecond.access_token));
    assert.equal(disk('alice'),aliceBefore);
    ok(await rpc(save,saveArgs,tokens.bob.access_token));
    assert.equal(disk('alice'),aliceBefore);
    assert.equal(ok(await rpc(save,saveArgs,tokens.bob.access_token)).already_saved,true);
    denied(await rpc(save,saveArgs,tokens.alice.access_token));
  }
  assert.notEqual(disk('bob'),bobBefore);
  const version=ok(await rpc('get_plan_versions',{},tokens.bob.access_token)).versions.at(0);
  assert.ok(version);
  denied(await rpc('preview_plan_edit',{restore_version_id:version.id},tokens.alice.access_token));
  const bobSaved=JSON.parse(disk('bob'));
  assert.equal(bobSaved.routines[0].name,'Bob edited template');
  assert.equal(bobSaved.dayNotes['2026-10-14'].text,'Bob updated note');
  assert.deepEqual(bobSaved.bodyweight,seed('bob').bodyweight);
  assert.deepEqual(bobSaved.workouts,seed('bob').workouts);
  // These are the real paired-phone endpoints and credentials used by Android.
  for(const uid of ['alice','bob']) {
    const phoneRead=await req('/api/data',{headers:{authorization:'Bearer '+mobile[uid]}});
    assert.equal(phoneRead.status,200);
    const synced=await phoneRead.json();
    assert.deepEqual(synced.state.routines,JSON.parse(disk(uid)).routines);
    assert.ok(!JSON.stringify(synced).includes(`${uid==='alice'?'bob':'alice'}-private-`));
  }

  const management=async uid=>(await(await req(prefix+'/connections',{headers:{cookie:cookie(uid)}})).text());
  const alicePage=await management('alice'),bobPage=await management('bob');
  const field=(page,name)=>page.match(new RegExp(`name="${name}" value="([^"]+)`))[1];
  const aliceGrant=field(alicePage,'grant');
  assert.ok(!bobPage.includes(aliceGrant));
  assert.equal((await post(prefix+'/connections',{nonce:field(bobPage,'nonce'),grant:aliceGrant},{cookie:cookie('bob'),origin})).status,403);
  const refreshed=await post(prefix+'/oauth/token',{grant_type:'refresh_token',client_id:client,refresh_token:tokens.bob.refresh_token,resource});
  assert.equal(refreshed.status,200);const bobRefreshed=await refreshed.json();
  assert.equal(ok(await rpc('get_profile',{},bobRefreshed.access_token)).id,'bob');
  ok(await rpc('get_current_plan',{},bobRefreshed.access_token));
  assert.equal((await post(prefix+'/connections',{nonce:field(alicePage,'nonce'),grant:aliceGrant},{cookie:cookie('alice'),origin})).status,302);
  assert.equal((await rpc('get_current_plan',{},tokens.alice.access_token)).status,401);
  ok(await rpc('get_current_plan',{},bobRefreshed.access_token));
  // Signing out Bob everywhere invalidates only Bob's grants, including refresh.
  assert.equal((await req('/api/logout/all',{method:'POST',headers:{cookie:cookie('bob'),origin}})).status,200);
  assert.equal((await rpc('get_current_plan',{},bobRefreshed.access_token)).status,401);
  assert.equal((await post(prefix+'/oauth/token',{grant_type:'refresh_token',client_id:client,refresh_token:bobRefreshed.refresh_token,resource})).status,400);
  assert.equal(disk('alice'),aliceBefore);
});
