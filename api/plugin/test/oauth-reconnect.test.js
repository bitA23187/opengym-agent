import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOAuth, PREFIX } from '../oauth.js';
import { openStore, hash, random } from '../store.js';

const origin='https://gym.test',client={client_id:'https://chatgpt.com/oauth/client.json'};
const redirectUri='https://chatgpt.com/connector_platform_oauth_redirect',verifier='a'.repeat(43);
const codeChallenge=Buffer.from(hash(verifier),'hex').toString('base64url');

function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'opengym-reconnect-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const users={alice:{id:'alice',name:'Alice <test>',sv:0},bob:{id:'bob',name:'Bob',sv:0}};
  const store=openStore(dir),routes=new Map();
  const oauth=createOAuth({origin,store,userById:id=>users[id],readSession:req=>users[req.headers.cookie]});
  oauth.mount({get:(url,fn)=>routes.set('GET '+url,fn),post:(url,fn)=>routes.set('POST '+url,fn)});
  const response=()=>({statusCode:200,status(code){this.statusCode=code;return this;},set(){return this;},type(){return this;},send(body){this.body=body;},redirect(status,url){this.statusCode=url?status:302;this.location=url||status;}});
  function route(method,url,uid='alice',body={}) {
    const res=response(),parsed=new URL(url,origin);
    routes.get(method+' '+parsed.pathname)({headers:{cookie:uid,origin},query:Object.fromEntries(parsed.searchParams),body},res);
    return res;
  }
  async function consent({uid='alice',oauthClient=client,scopes=['plan:read','plan:write'],decision='allow'}={}) {
    const start=response();
    await oauth.provider.authorize(oauthClient,{redirectUri,resource:new URL(oauth.resource),codeChallenge,scopes,state:'state'},start);
    const page=route('GET',start.location,uid);
    const fields={request:new URL(start.location,origin).searchParams.get('request'),nonce:page.body.match(/name="nonce" value="([^"]+)/)[1],decision};
    const approved=route('POST',PREFIX+'/consent',uid,fields);
    const receipt=approved.location&&route('GET',approved.location,uid);
    const callback=receipt?.body?.match(/id="return-to-chatgpt" href="([^"]+)/)?.[1]?.replaceAll('&amp;','&');
    return {approved,page,fields,oauthClient,callback,code:callback&&new URL(callback).searchParams.get('code')};
  }
  const exchange=(c,v=verifier)=>oauth.provider.exchangeAuthorizationCode(c.oauthClient,c.code,v,redirectUri,new URL(oauth.resource));
  const active=uid=>Object.entries(store.data.grants).filter(([,g])=>g.uid===uid&&!g.revoked&&g.exp>Date.now());
  return {dir,users,store,oauth,route,consent,exchange,active};
}

test('abandoned and denied consent never creates grants; a failed PKCE exchange preserves the old connection',async t=>{
  const h=fixture(t),old=await h.exchange(await h.consent());
  const before=fs.readFileSync(path.join(h.dir,'plugin-oauth.json'),'utf8');
  for(let i=0;i<12;i++) {
    const c=await h.consent();assert.equal(c.approved.statusCode,303);
    const replay=h.route('POST',PREFIX+'/consent','alice',c.fields);
    assert.equal(replay.statusCode,303);assert.equal(replay.location,c.approved.location);
  }
  const denied=await h.consent({decision:'deny'});
  assert.equal(new URL(denied.callback).searchParams.get('error'),'access_denied');
  const c=await h.consent();
  await assert.rejects(h.exchange(c,'b'.repeat(43)),/PKCE/);
  assert.equal(h.active('alice').length,1);
  assert.equal(fs.readFileSync(path.join(h.dir,'plugin-oauth.json'),'utf8'),before);
  await h.oauth.provider.verifyAccessToken(old.access_token);
  await h.exchange(c);
  await assert.rejects(h.exchange(c),/Invalid authorization code/);
  await assert.rejects(h.oauth.provider.verifyAccessToken(old.access_token));
});

test('successful reconnect replaces ten legacy grants, narrows scopes, and preserves other users and clients',async t=>{
  const h=fixture(t),old=await h.exchange(await h.consent());
  const original=h.active('alice')[0][1];
  for(let i=0;i<9;i++)h.store.data.grants[random()]={...original};
  h.store.save();assert.equal(h.active('alice').length,10);
  const bob=await h.exchange(await h.consent({uid:'bob'}));
  const other=await h.exchange(await h.consent({oauthClient:{client_id:'separate-client'}}));
  const c=await h.consent({scopes:['plan:read']});assert.equal(c.approved.statusCode,303);
  const fresh=await h.exchange(c);
  assert.equal(fresh.scope,'plan:read');
  assert.equal(h.active('alice').length,2);
  const auth=await h.oauth.provider.verifyAccessToken(fresh.access_token);
  assert.deepEqual(auth.scopes,['plan:read']);
  await assert.rejects(h.oauth.provider.verifyAccessToken(old.access_token));
  await assert.rejects(h.oauth.provider.exchangeRefreshToken(client,old.refresh_token,undefined,new URL(h.oauth.resource)));
  await h.oauth.provider.verifyAccessToken(bob.access_token);
  await h.oauth.provider.verifyAccessToken(other.access_token);
  await assert.rejects(h.oauth.provider.exchangeRefreshToken(client,fresh.refresh_token,['plan:write'],new URL(h.oauth.resource)),/expand scopes/);
  const page=h.route('GET',PREFIX+'/connections').body;
  assert.ok(page.includes('Alice &lt;test&gt;'));assert.ok(page.includes('UTC+8'));
  assert.ok(page.includes('授权时间：'));assert.ok(page.includes('读取训练方案'));
  assert.ok(!page.includes('Bob'));assert.ok(!page.includes(old.access_token));
  const reloaded=openStore(h.dir);
  assert.equal(Object.values(reloaded.data.grants).filter(g=>g.uid==='alice').length,2);
  assert.equal(reloaded.data.tokens[hash(old.refresh_token)],undefined);
});

test('limit counts distinct clients, allows replacement at capacity, and is checked again at token exchange',async t=>{
  const h=fixture(t),waiting=await h.consent({oauthClient:{client_id:'waiting'}});
  for(let i=0;i<10;i++)await h.exchange(await h.consent({oauthClient:{client_id:'client-'+i}}));
  const blocked=await h.consent();assert.equal(blocked.approved.statusCode,400);
  await assert.rejects(h.exchange(waiting),/Connection limit/);
  const replacement=await h.consent({oauthClient:{client_id:'client-0'}});
  assert.equal(replacement.approved.statusCode,303);await h.exchange(replacement);
  assert.equal(h.active('alice').length,10);
});

test('account invalidation and storage failures do not commit a replacement',async t=>{
  const h=fixture(t),old=await h.exchange(await h.consent()),c=await h.consent();
  h.users.alice.sv++;
  await assert.rejects(h.exchange(c),/expired or revoked/);
  h.users.alice.sv--;
  const d=await h.consent(),save=h.store.save;
  h.store.save=()=>{throw Error('simulated disk failure');};
  await assert.rejects(h.exchange(d),/disk failure/);
  h.store.save=save;
  assert.equal(h.active('alice').length,1);
  await h.oauth.provider.verifyAccessToken(old.access_token);
  const fresh=await h.exchange(await h.consent());
  await h.oauth.provider.verifyAccessToken(fresh.access_token);
  await assert.rejects(h.oauth.provider.verifyAccessToken(old.access_token));
});

test('consent replay returns the same receipt/code, preserves identity checks, and shows completion after exchange',async t=>{
  const h=fixture(t),c=await h.consent();
  for(let i=0;i<4;i++) {
    const replay=h.route('POST',PREFIX+'/consent','alice',c.fields);
    assert.equal(replay.statusCode,303);assert.equal(replay.location,c.approved.location);
    const page=h.route('GET',replay.location).body;
    assert.ok(page.includes('已同意，正在返回 ChatGPT'));
    assert.ok(page.includes('http-equiv="refresh"'));
    assert.ok(page.includes(c.code));
  }
  assert.equal(h.active('alice').length,0);
  assert.equal(h.route('POST',PREFIX+'/consent','bob',c.fields).statusCode,403);
  assert.equal(h.route('POST',PREFIX+'/consent','alice',{...c.fields,nonce:'wrong'}).statusCode,403);
  assert.equal(h.route('GET',c.approved.location,'bob').statusCode,403);
  const tokens=await h.exchange(c);
  const replay=h.route('POST',PREFIX+'/consent','alice',c.fields);
  const completed=h.route('GET',replay.location);
  assert.equal(completed.statusCode,200);assert.ok(completed.body.includes('连接已完成'));
  assert.ok(!completed.body.includes(c.code));assert.ok(!completed.body.includes('http-equiv="refresh"'));
  await assert.rejects(h.exchange(c),/Invalid authorization code/);
  assert.equal(h.active('alice').length,1);
  await h.oauth.provider.verifyAccessToken(tokens.access_token);
});

test('an expired callback is explained without minting another code or touching the original grant',async t=>{
  const h=fixture(t),old=await h.exchange(await h.consent()),c=await h.consent();
  const future=Date.now()+61000;
  const clock=t.mock.method(Date,'now',()=>future);
  try {
    const result=h.route('GET',c.approved.location);
    assert.equal(result.statusCode,400);assert.ok(result.body.includes('返回链接已过期'));
    await assert.rejects(h.exchange(c),/Invalid authorization code/);
    assert.equal(h.active('alice').length,1);
    await h.oauth.provider.verifyAccessToken(old.access_token);
  } finally { clock.mock.restore(); }
});
