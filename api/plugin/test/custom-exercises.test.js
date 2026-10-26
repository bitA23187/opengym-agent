import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCustomExercises,exerciseUsage} from '../custom-exercises.js';
import {appendTrainingUpdate,createTraining} from '../training.js';
import {createPlans} from '../plans.js';
import {createReads} from '../reads.js';
import {searchCatalogue,exerciseDetails} from '../catalogue.js';
import {mergeStates} from '../../../frontend/src/lib/sync-merge.js';
import {EXIDX,registerCustom,allExercises} from '../../../frontend/src/lib/exercises.js';
const user={id:'alice'},grant='a';
const seed=()=>({unit:'kg',customEx:[],routines:[],workouts:[],_rev:1,_wid:'initial',unknown:{keep:true},bodyweight:[{d:'2026-10-01',w:80}]});
const create={operation:'create',fields:{name:'室内难度攀岩',body_part:'back',equipment:'climbing wall',aliases:['难度攀岩','Indoor lead climbing'],description:'线路难度和尝试情况记在备注'}};
function harness(initial=seed()) {
  let s=structuredClone(initial);
  const read=()=>structuredClone(s),append=(u,d)=>s=appendTrainingUpdate(s,d);
  const exercises=createCustomExercises({read,append});
  const save=p=>exercises.save(user,grant,p.draft_id,true,p.confirmation_summary);
  const change=input=>{const p=exercises.preview(user,grant,input);save(p);return p;};
  return {read,exercises,save,change,set:v=>s=v,training:createTraining({read,append}),plans:createPlans({read}),reads:createReads({read})};
}
test('create → search by name/alias → timed workout uses a stable account-owned ID without touching other data',()=>{
  const h=harness(),before=h.read(),p=h.exercises.preview(user,grant,create);
  assert.deepEqual(h.read(),before);assert.match(p.confirmation_summary,/室内难度攀岩/);assert.match(p.confirmation_summary,/climbing wall/);
  assert.equal(h.save(p).saved,true);assert.equal(h.save(p).already_saved,true);
  const id=p.exercise_id,custom=h.read().customEx[0];assert.equal(custom.id,id);assert.equal(custom.custom,true);assert.ok(custom._ts);assert.equal(custom.tg,'');
  for(const key of ['routines','workouts','unknown','bodyweight'])assert.deepEqual(h.read()[key],before[key]);
  for(const query of ['室内难度攀岩','难度攀岩','Indoor lead climbing']) {
    const result=searchCatalogue(query,undefined,8,h.read());assert.equal(result.candidates[0].exercise_id,id);assert.equal(result.candidates[0].source,'custom');assert.equal(result.requires_disambiguation,false);
  }
  assert.equal(searchCatalogue('难度攀岩').total,0);assert.equal(EXIDX[id],undefined);
  assert.deepEqual(exerciseDetails(h.read(),id).supported_modes,['reps','time']);
  const workout=h.training.preview(user,grant,{timezone:'Asia/Taipei',date:'2026-10-01',workout:{name:'Climbing',exercises:[{exercise_id:id,mode:'time',sets:[{weight:0,seconds:120}],note:'线路 5.9，完成一次'}]}});
  h.training.save(user,grant,workout.draft_id,true,workout.confirmation_summary);
  const logged=h.read().workouts[0];assert.equal(logged.entries[0].id,id);assert.equal(logged.entries[0].sets[0].sec,120);assert.equal(logged.entries[0].sets[0].r,undefined);
  assert.equal(h.reads.workout(user,{workout_id:logged.id}).workout.entries[0].name,'室内难度攀岩');
});
test('partial edits keep ID, media, unknown metadata, references and omitted fields; explicit lists clear',()=>{
  const h=harness(),id=h.change(create).exercise_id;
  const s=h.read();Object.assign(s.customEx[0],{media:{id:'keep-media'},url:'https://example.com/guide',future:{keep:true}});
  s.routines=[{id:'r',name:'Climbing',ex:[{id,mode:'time',sets:1,sec:120}]}];h.set(s);
  let p=h.change({operation:'update',exercise_id:id,fields:{name:'室内先锋攀岩',primary_muscles:['lats'],secondary_muscles:['biceps']}});
  assert.equal(p.usage.routines[0].routine_id,'r');assert.equal(p.before.name_zh,'室内难度攀岩');
  const custom=h.read().customEx[0];assert.equal(custom.id,id);assert.deepEqual(custom.aliases,create.fields.aliases);
  for(const key of ['media','url','future'])assert.deepEqual(custom[key],s.customEx[0][key]);
  assert.deepEqual(custom.muscleGroups,['lats','biceps']);assert.equal(custom.tg,'lats');assert.deepEqual(h.read().routines,s.routines);
  p=h.change({operation:'update',exercise_id:id,fields:{description:'',aliases:[],primary_muscles:[],secondary_muscles:[]}});
  assert.equal(p.before.description,create.fields.description);assert.match(p.confirmation_summary,/线路难度和尝试情况记在备注/);
  assert.deepEqual(h.read().customEx[0].aliases,[]);assert.equal(h.read().customEx[0].desc,'');assert.equal(h.read().customEx[0].tg,'');
});
test('archive hides selections and new plans, preserves active/history resolution, restore survives stale sync',()=>{
  const h=harness(),id=h.change(create).exercise_id;
  const s=h.read();s.routines=[{id:'r',name:'Climbing',ex:[{id,mode:'time',sets:1,sec:120,prog:'off'}]}];s.week={4:'r'};
  s.workouts=[{id:'w',d:'2026-10-01',entries:[{id,target:{mode:'time'},sets:[{sec:120,done:true}]}]}];s.active={entries:[{id}]};h.set(s);
  const before=h.read(),p=h.change({operation:'archive',exercise_id:id});
  assert.equal(p.usage.workout_count,1);assert.equal(p.usage.active_session,true);assert.equal(p.usage.can_delete,false);
  assert.equal(searchCatalogue('难度攀岩',undefined,8,h.read()).total,0);
  assert.equal(searchCatalogue('难度攀岩',undefined,8,h.read(),true).candidates[0].archived,true);
  assert.equal(h.exercises.list(user,{status:'archived'}).exercises[0].exercise_id,id);
  assert.equal(h.exercises.list(user,{status:'all',query:'Indoor lead climbing'}).total,1);
  assert.ok(!allExercises(h.read()).some(e=>e.id===id));
  registerCustom(h.read().customEx);assert.equal(EXIDX[id].n,create.fields.name);registerCustom([]);
  for(const key of ['routines','workouts','active'])assert.deepEqual(h.read()[key],before[key]);
  assert.equal(h.reads.session(user,{date:'2026-10-01',timezone:'Asia/Taipei'}).exercises[0].name,create.fields.name);
  assert.equal(h.reads.workout(user,{workout_id:'w'}).workout.entries[0].name,create.fields.name);
  const plan={unit:'kg',routines:[{name:'New',exercises:[{exercise_id:id,mode:'time',seconds:120,sets:1}]}]};
  assert.throws(()=>h.plans.preview(user,grant,plan),/Unknown exercise ID/);
  assert.throws(()=>h.plans.previewEdit(user,grant,{routine_id:'r',operations:[{type:'add_exercise',exercise:plan.routines[0].exercises[0]}]}),/Unknown exercise ID/);
  assert.throws(()=>h.exercises.preview(user,grant,{operation:'delete',exercise_id:id}),/Archive it instead/);
  assert.equal(mergeStates(before,h.read()).customEx[0].archived,true);
  const archived=h.read();h.change({operation:'restore',exercise_id:id});
  assert.equal(mergeStates(archived,h.read()).customEx[0].archived,false);assert.equal(h.exercises.list(user,{}).total,1);
  assert.ok(h.plans.preview(user,grant,plan).draft_id);
});
test('delete checks routine, workout, active, note, favorite, load and undo references and creates sync tombstones',()=>{
  const h=harness(),id=h.change(create).exercise_id;
  for(const extra of [{routines:[{id:'r',ex:[{id}]}]},{workouts:[{id:'w',entries:[{id}]}]},{active:{entries:[{id}]}},{favEx:[id]},
    {exNotes:{[id]:'Keep'}},{exWeights:{[id]:{w:0}}},{trainingNotes:{n:{exercise_ids:[id]}}},{pluginPlanHistory:[{before:{routines:[{ex:[{id}]}]}}]},
    {pluginTrainingHistory:[{before:{entries:[{id}]}}]}]) {
    const s={...h.read(),...extra};h.set(s);assert.equal(exerciseUsage(s,id).can_delete,false);
    assert.throws(()=>h.exercises.preview(user,grant,{operation:'delete',exercise_id:id}),/Archive it instead/);
    h.set({...seed(),customEx:s.customEx});
  }
  const stale=h.read();h.change({operation:'delete',exercise_id:id});assert.equal(h.read().customEx.length,0);assert.ok(h.read().deleted.customEx[id]);
  assert.equal(mergeStates(stale,h.read()).customEx.length,0);
});
test('validation rejects built-ins, foreign IDs, duplicate names/aliases (including localized and archived), incomplete or invalid input',()=>{
  const h=harness();
  for(const operation of ['update','archive','restore','delete'])for(const id of ['0293','someone-elses-custom'])assert.throws(()=>h.exercises.preview(user,grant,{operation,exercise_id:id,...(operation==='update'?{fields:{name:'X'}}:{})}),/Only this account/);
  for(const input of [{...create,exercise_id:'mine'},{operation:'create',fields:{name:'X'}},{operation:'create',fields:{...create.fields,body_part:'invalid'}},
    {operation:'create',fields:{...create.fields,mode:'made-up'}},{operation:'update'},{operation:'delete',exercise_id:'x',fields:{name:'No'}}])assert.throws(()=>h.exercises.preview(user,grant,input));
  const id=h.change(create).exercise_id;
  for(const name of ['室内难度攀岩','难度攀岩','INDOOR LEAD CLIMBING','哑铃俯身划船'])assert.throws(()=>h.exercises.preview(user,grant,{...create,fields:{...create.fields,name}}),/already exists/);
  assert.throws(()=>h.exercises.preview(user,grant,{...create,fields:{...create.fields,name:'Another',aliases:['难度攀岩']}}),/already exists/);
  h.change({operation:'archive',exercise_id:id});assert.throws(()=>h.exercises.preview(user,grant,create),/already exists/);
  const s=h.read();s.routines=[{id:'r',ex:[{id}]}];h.set(s);
  assert.throws(()=>h.exercises.preview(user,grant,{operation:'update',exercise_id:id,fields:{body_part:'cardio'}}),/recording semantics/);
});
test('confirmation, account/grant binding, draft isolation, expiry and concurrent edits protect writes',()=>{
  const h=harness(),p=h.exercises.preview(user,grant,create),save=(u,g,c=true,summary=p.confirmation_summary)=>h.exercises.save(u,g,p.draft_id,c,summary);
  assert.throws(()=>save({id:'bob'},grant),/different authorization/);assert.throws(()=>save(user,'other'),/different authorization/);
  assert.throws(()=>save(user,grant,false),/Explicit confirmation/);assert.throws(()=>save(user,grant,true,'Changed'),/exact preview/);
  assert.throws(()=>h.training.save(user,grant,p.draft_id,true,p.confirmation_summary),/Preview expired/);
  let s=h.read();s._rev++;h.set(s);assert.throws(()=>save(user,grant),/changed since preview/);assert.equal(h.read().customEx.length,0);
  const q=h.exercises.preview(user,grant,create);s=h.read();s._wid='same-revision-new-writer';h.set(s);
  assert.throws(()=>h.save(q),/changed since preview/);
  const r=h.exercises.preview(user,grant,create),original=Date.now;
  try {Date.now=()=>original()+900001;assert.throws(()=>h.save(r),/Preview expired/);}finally{Date.now=original;}
});
