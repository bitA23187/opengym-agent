// Read-only deployment smoke test; never authorizes or writes private data.
import assert from 'node:assert/strict';
const base=process.argv[2];
if (!base) throw new Error('Usage: node scripts/verify-private-plugin.mjs https://YOUR-OWN-HOST');
const parsedBase = new URL(base);
if (!['http:', 'https:'].includes(parsedBase.protocol) || parsedBase.username || parsedBase.password || parsedBase.pathname !== '/' || parsedBase.search || parsedBase.hash) throw new Error('Provide an HTTP(S) origin without credentials, path, query or fragment');
const endpoint=base+'/api/plugin/mcp';
// All requests below are public reads or denied private calls. Bound transient proxy
// failures, and avoid reusing a proxy socket closed between JSON-RPC requests.
async function publicFetch(url,options={}) {
 for(let attempt=0;attempt<2;attempt++) {
  try {return await fetch(url,{...options,headers:{Connection:'close',...options.headers},signal:AbortSignal.timeout(15000)});}
  catch(error) {if(attempt)throw error;}
 }
}

async function get(path) {const r=await publicFetch(base+path);assert.equal(r.status,200,path);return r.json();}
const health=await get('/api/health');assert.equal(health.ok,true);
const meta=await get('/.well-known/oauth-authorization-server');assert.equal(meta.issuer,base);assert.equal(meta.authorization_response_iss_parameter_supported,true);
const resource=await get('/.well-known/oauth-protected-resource/api/plugin/mcp');assert.equal(resource.resource,endpoint);
let id=0;
async function rpc(method,params,token) {
 const r=await publicFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});return {status:r.status,body:await r.json()};
}
const init=await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'opengym-public-smoke',version:'1'}});assert.equal(init.status,200);assert.equal(init.body.result.serverInfo.name,'opengym-private-training');
const list=await rpc('tools/list',{});assert.equal(list.body.result.tools.length,27);
assert.deepEqual(list.body.result.tools.map(t=>t.name).sort(),['get_nutrition','preview_nutrition_update','save_nutrition_update','get_daily_health','list_custom_exercises','preview_custom_exercise','save_custom_exercise','get_training_notes','get_training_versions','get_exercise_details','get_body_metrics','preview_body_update','save_body_update','get_profile','get_current_plan','get_plan_versions','get_training_session','list_training_history','get_training_workout','get_training_summary','preview_plan','preview_plan_edit','preview_training_update','save_plan','save_plan_edit','save_training_update','search_exercises'].sort());
assert.ok(meta.scopes_supported.includes('training:read'));assert.ok(meta.scopes_supported.includes('body:read'));assert.ok(meta.scopes_supported.includes('body:write'));
for(const name of ['preview_plan','preview_plan_edit','preview_training_update','preview_body_update','preview_custom_exercise'])assert.equal(list.body.result.tools.find(t=>t.name===name).annotations.readOnlyHint,false);
assert.ok(trainingDescriptorFields());
for(const scope of ['nutrition:read','nutrition:write','health:read'])assert.ok(meta.scopes_supported.includes(scope));
for(const [name,scopes] of [['get_nutrition',['nutrition:read']],['preview_nutrition_update',['nutrition:read','nutrition:write']],['save_nutrition_update',['nutrition:read','nutrition:write']],['get_daily_health',['health:read']]]) { const tool=list.body.result.tools.find(t=>t.name===name);assert.ok(tool);assert.deepEqual(tool._meta.securitySchemes[0].scopes,scopes); }

function trainingDescriptorFields(){const p=list.body.result.tools.find(t=>t.name==='preview_training_update').inputSchema.properties;return p.context_notes&&p.workout_patch&&p.restore_version_id;}

assert.equal(init.body.result.serverInfo.version,'0.7.0');
assert.ok(!list.body.result.tools.find(t=>t.name==='preview_plan_edit').inputSchema.properties.session_adjustment);
const training=list.body.result.tools.find(t=>t.name==='preview_training_update');
assert.ok(training.inputSchema.properties.timezone);
assert.ok(!training.inputSchema.required.includes('timezone'));
assert.ok(training.inputSchema.properties.workout.properties.exercises.items.properties.sets.items.properties.drops);
const save=list.body.result.tools.find(t=>t.name==='save_plan');assert.equal(save.annotations.readOnlyHint,false);assert.ok(save.inputSchema.required.includes('confirmation_summary'));
const profile=list.body.result.tools.find(t=>t.name==='get_profile');
assert.equal(profile._meta['openai/profile'],true);assert.equal(profile.annotations.readOnlyHint,true);
assert.ok(profile.outputSchema.required.includes('id'));
const guide=await publicFetch(base+'/api/plugin/connect');assert.equal(guide.status,200);
assert.equal(guide.headers.get('cache-control'),'no-store');assert.ok((await guide.text()).includes(endpoint));
const profileDenied=await rpc('tools/call',{name:'get_profile',arguments:{}});assert.equal(profileDenied.body.result.isError,true);
const search=await rpc('tools/call',{name:'search_exercises',arguments:{query:'哑铃划船'}});assert.ok(!search.body.result.isError);const matches=JSON.parse(search.body.result.content[0].text);assert.ok(matches.total>0);
for(const name of ['get_training_session','list_training_history','get_training_workout','get_training_summary']) {
 const args={get_training_session:{timezone:'Asia/Taipei'},list_training_history:{from:'2026-10-01',to:'2026-10-15'},get_training_workout:{workout_id:'public-probe'},get_training_summary:{from:'2026-10-01',to:'2026-10-15'}}[name];
 assert.ok((await rpc('tools/call',{name,arguments:args})).body.result.isError);
}
const legacyPreview=await rpc('tools/call',{name:'preview_training_update',arguments:{date:'2026-10-15',day_note:'Public compatibility probe; never save.'}});
assert.ok(legacyPreview.body.result?.isError);
assert.ok(legacyPreview.body.result?._meta?.['mcp/www_authenticate'],'Old schema arguments should reach OAuth enforcement, not fail on missing timezone');
for(const name of ['get_training_notes','get_training_versions','get_exercise_details','get_body_metrics']) {
const args={get_training_notes:{},get_training_versions:{},get_exercise_details:{exercise_id:'0293'},get_body_metrics:{from:'2026-10-01',to:'2026-10-15'}}[name];assert.equal((await rpc('tools/call',{name,arguments:args})).body.result.isError,true);}
for(const [name,args] of [['list_custom_exercises',{}],['preview_custom_exercise',{operation:'create',fields:{name:'Public probe; never save',body_part:'back',equipment:'climbing wall'}}],['save_custom_exercise',{draft_id:'x'.repeat(43),confirmed:true,confirmation_summary:'Public probe; never save'}]]) {
 assert.equal((await rpc('tools/call',{name,arguments:args})).body.result.isError,true);
}
assert.ok(list.body.result.tools.find(t=>t.name==='save_custom_exercise').annotations.destructiveHint);
const denied=await rpc('tools/call',{name:'get_current_plan',arguments:{}});assert.equal(denied.body.result.isError,true);assert.ok(denied.body.result._meta['mcp/www_authenticate']);
for(const [name,args] of [['get_nutrition',{from:'2026-10-23',to:'2026-10-24'}],['preview_nutrition_update',{timezone:'Asia/Taipei',entries:[{date:'2026-10-23',meal:'Lunch',source:'Estimate',calories:500}]}],['save_nutrition_update',{draft_id:'x'.repeat(43),confirmed:true,confirmation_summary:'Public probe; never save'}],['get_daily_health',{from:'2026-10-23',to:'2026-10-24',timezone:'Asia/Taipei'}]])assert.equal((await rpc('tools/call',{name,arguments:args})).body.result.isError,true);
assert.equal((await rpc('tools/list',{},'x'.repeat(43))).status,401);
const method=await publicFetch(endpoint,{method:'GET'});assert.equal(method.status,405);
console.log(JSON.stringify({healthy:true,oauth_discovery:true,mcp_initialize:true,tools:list.body.result.tools.map(t=>t.name),chinese_search_matches:matches.total,unauthenticated_private_access:'denied',invalid_token:'denied',private_data_written:false},null,2));
