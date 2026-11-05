import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTraining,appendTrainingUpdate} from '../training.js';
import {createNutrition} from '../nutrition.js';
import {readTrainingLog} from '../training-sessions.js';
import {createReads} from '../reads.js';
import {preservePluginState} from '../client-state.js';
import {bestSetOf} from '../../../frontend/src/lib/onerm.js';
const user={id:'fixture'},grant='g',timezone='Asia/Taipei',date='2026-10-21';
const seed=()=>({unit:'kg',_rev:1,_wid:'w',routines:[],workouts:[],week:{},dayPlan:{},customEx:[{id:'climb',n:'Climbing',bp:'back',eq:'wall',activity_type:'climbing'}]});
function harness(initial=seed()) {
 let state=structuredClone(initial);const read=()=>structuredClone(state),append=(u,d)=>state=appendTrainingUpdate(state,d),training=createTraining({read,append,defaultTimezone:timezone}),nutrition=createNutrition({read,append});
 return {read,training,nutrition,reads:createReads({read}),save:p=>training.save(user,grant,p.draft_id,true,p.confirmation_summary),saveFood:p=>nutrition.save(user,grant,p.draft_id,true,p.confirmation_summary)};
}
const food={name:'Milk',basis:{quantity:100,unit:'ml'},nutrients:{calories:35,protein:3.5,carbs:5,fat:0.1},source:'Label',preparation:'as_sold',servings:[{id:'glass',name:'Glass',quantity:250,unit:'ml'}]};
test('incremental session persists stable IDs, handles reconnect/replay/conflict, and finishes exactly once',()=>{
 const h=harness(),preview=(version,key,operations)=>h.training.preview(user,grant,{date,timezone,session_update:{session_id:'session1',expected_version:version,idempotency_key:key,operations}});
 const start=preview(0,'start',[{type:'start',name:'Back'}]);h.save(start);assert.equal(h.read().workouts.length,0);
 const add=preview(1,'add',[{type:'append_exercise',entry_id:'row',exercise:{exercise_id:'0293',mode:'reps'}},{type:'append_set',entry_id:'row',set_id:'first',set:{weight:12,reps:10}}]);h.save(add);
 const session=readTrainingLog(h.read(),{session_id:'session1'}).session;assert.equal(session.version,2);assert.equal(session.workout.entries[0].sets[0].set_id,'first');
 assert.equal(preview(1,'add',[{type:'append_exercise',entry_id:'row',exercise:{exercise_id:'0293',mode:'reps'}},{type:'append_set',entry_id:'row',set_id:'first',set:{weight:12,reps:10}}]).already_applied,true);
 assert.throws(()=>preview(1,'stale',[{type:'set_note',note:'lost'}]),/version conflict/);
 assert.throws(()=>preview(2,'add',[{type:'set_note',note:'different'}]),/Idempotency/);
 const finish=preview(2,'finish',[{type:'update_set',entry_id:'row',set_id:'first',fields:{reps:11}},{type:'finish'}]);h.save(finish);assert.equal(h.save(finish).already_saved,true);
 assert.equal(h.read().workouts.length,1);assert.equal(h.read().workouts[0].entries[0].sets[0].r,11);assert.equal(h.read().trainingLogs.session1.status,'completed');
 const old={...h.read(),trainingLogs:{}};preservePluginState(h.read(),old);assert.equal(old.trainingLogs.session1.version,3);
});
test('climbing routes and treadmill measurements remain structured and outside strength metrics',()=>{
 const h=harness(),p=h.training.preview(user,grant,{date,timezone,workout:{exercises:[{exercise_id:'climb',mode:'climbing',routes:[{route_id:'one',grade:'5.10a',grading_system:'YDS',attempts:2,completed:true},{route_id:'two',attempts:1,completed:false}]},{exercise_id:'0293',mode:'cardio',sets:[{elapsed_seconds:1020,distance_km:1.6,incline_segments:[{start_seconds:0,end_seconds:600,incline_percent:3},{start_seconds:600,end_seconds:1020,incline_percent:5}]}]}]}});h.save(p);
 const w=h.read().workouts[0],r=h.reads.workout(user,{workout_id:w.id});assert.equal(w.entries[0].sets.length,0);assert.equal(bestSetOf(w.entries[0]),null);assert.equal(r.workout.entries[1].sets[0].cardio.elapsed_seconds,1020);assert.ok(Math.abs(r.workout.entries[1].sets[0].cardio.derived_average_speed_kmh-1.6/1020*3600)<1e-9);
 assert.equal(h.reads.summary(user,{from:date,to:date}).current.activities.climbing_completions,1);
});
test('21s segments do not become full-ROM estimated 1RM, while load volume remains explicit',()=>{
 const h=harness();h.save(h.training.preview(user,grant,{date,timezone,workout:{exercises:[{exercise_id:'0293',mode:'reps',sets:[{weight:12,reps:21,rep_segments:[{portion:'lower',reps:7},{portion:'upper',reps:7},{portion:'full',reps:7}],weight_source:'per_dumbbell',value_source:'user_reported'}]}]}}));
 const e=h.read().workouts[0].entries[0];assert.equal(bestSetOf(e),null);assert.equal(h.reads.workout(user,{workout_id:h.read().workouts[0].id}).workout.entries[0].sets[0].rep_segments.length,3);
});
test('food library portions use immutable label snapshots, keep unknown nutrients unknown and preserve midnight attribution',()=>{
 const h=harness();const p=h.nutrition.preview(user,grant,{timezone,foods:[{operation:'upsert',id:'milk',food}]});assert.equal(p.authorization.requires_user_confirmation,true);h.saveFood(p);assert.equal(h.read().nutritionEntries,undefined);
 const meal={date,meal:'Snack',source:'Label',eaten_at:'2026-10-22T00:30:00+08:00',items:[{item_id:'item',food_id:'milk',quantity:2,unit:'serving',serving_id:'glass'}]};
 h.saveFood(h.nutrition.preview(user,grant,{timezone,entries:[meal]}));const id=Object.keys(h.read().nutritionEntries)[0],entry=h.read().nutritionEntries[id];assert.equal(entry.calories,175);assert.equal(entry.protein,17.5);assert.equal(entry.alcohol,null);assert.equal(entry.log_date,date);assert.equal(entry.eaten_at,meal.eaten_at);
 h.saveFood(h.nutrition.preview(user,grant,{timezone,foods:[{operation:'upsert',id:'milk',food:{...food,nutrients:{calories:40}}}]}));assert.equal(h.read().nutritionEntries[id].calories,175);
 h.saveFood(h.nutrition.preview(user,grant,{timezone,entries:[{...meal,id,description:'Correction',items:entry.items.map(({nutrients,estimated,source,...i})=>i)}]}));assert.equal(h.read().nutritionEntries[id].calories,175);
 assert.throws(()=>h.nutrition.preview(user,grant,{timezone,foods:[{operation:'delete',id:'milk'}]}),/archive/);
 assert.throws(()=>h.nutrition.preview(user,grant,{timezone,entries:[{...meal,items:[{item_id:'wrong',food_id:'milk',quantity:50,unit:'g'}]}]}),/units/);
});
test('new sports use declared typed fields, preserve schema snapshots and avoid strength statistics',()=>{
 const s=seed();s.customEx.push({id:'rope',n:'Jump rope',bp:'cardio',eq:'rope',activity_type:'custom',field_definitions:[{key:'trips',label:'Trips',type:'number',min:0,aggregation:'sum'},{key:'floor',label:'Floor',type:'text'}]});
 const h=harness(s);h.save(h.training.preview(user,grant,{date,timezone,workout:{exercises:[{exercise_id:'rope',mode:'custom',observations:[{record_id:'first',values:{trips:2,floor:'rubber'}},{record_id:'second',values:{trips:0}}]}]}}));
 const w=h.read().workouts[0],detail=h.reads.workout(user,{workout_id:w.id});assert.equal(w.entries[0].sets.length,0);assert.equal(detail.workout.entries[0].measurement_totals[0].value,2);assert.equal(bestSetOf(w.entries[0]),null);
 assert.equal(h.reads.summary(user,{from:date,to:date}).current.working_set_units,0);
 assert.throws(()=>h.training.preview(user,grant,{date,timezone,workout:{exercises:[{exercise_id:'rope',mode:'custom',observations:[{record_id:'wrong',values:{unknown:2}}]}]}}),/not declared/);
 const changed=h.read();changed.customEx.find(e=>e.id==='rope').field_definitions[0].label='Changed definition';
 assert.equal(changed.workouts[0].entries[0].measurements.fields[0].label,'Trips');
});
test('incremental unilateral timed rows keep separate stable IDs and preserve the unedited limb',()=>{
 const h=harness(),p=h.training.preview(user,grant,{date,timezone,session_update:{session_id:'timed',expected_version:0,idempotency_key:'start',operations:[{type:'start',name:'Timed'},{type:'append_exercise',entry_id:'entry',exercise:{exercise_id:'0293',mode:'time',per_side:true}},{type:'append_set',entry_id:'entry',set_id:'hold',set:{weight:12,seconds:30}}]}});h.save(p);
 const sets=h.read().trainingLogs.timed.workout.entries[0].sets;assert.deepEqual(sets.map(s=>s.set_id),['hold_L','hold_R']);
 h.save(h.training.preview(user,grant,{date,timezone,session_update:{session_id:'timed',expected_version:1,idempotency_key:'finish',operations:[{type:'update_set',entry_id:'entry',set_id:'hold_L',fields:{seconds:25}},{type:'finish'}]}}));
 assert.deepEqual(h.read().workouts[0].entries[0].sets.map(s=>[s.side,s.sec]),[['L',25],['R',30]]);
});

test('set notes survive completed imports, incremental sessions, reads and partial correction undo',()=>{
 const h=harness();
 const p=h.training.preview(user,grant,{date,timezone,workout:{exercises:[{exercise_id:'0293',mode:'reps',per_side:true,sets:[{weight:12,reps:10,note:'Grip slipped'}]}]}});
 h.save(p);let w=h.read().workouts[0];assert.equal(w.entries[0].sets[0].note,'Grip slipped');
 assert.equal(h.reads.workout(user,{workout_id:w.id}).workout.entries[0].sets[0].note,'Grip slipped');
 h.save(h.training.preview(user,grant,{date,timezone,workout_id:w.id,workout_patch:{set_edits:[{entry_index:0,set_index:0,side:'L',fields:{note:'Left grip'}}]}}));
 w=h.read().workouts[0];assert.equal(w.entries[0].sets[0].sides.L.note,'Left grip');assert.equal(w.entries[0].sets[0].sides.R.note,'Grip slipped');
 const preview=(version,key,operations)=>h.training.preview(user,grant,{date,timezone,session_update:{session_id:'notes-session',expected_version:version,idempotency_key:key,operations}});
 h.save(preview(0,'start',[{type:'start',name:'Notes'}]));
 h.save(preview(1,'add',[{type:'append_exercise',entry_id:'row',exercise:{exercise_id:'0293',mode:'reps'}},{type:'append_set',entry_id:'row',set_id:'s1',set:{weight:12,reps:8,note:'Felt easy'}}]));
 assert.equal(readTrainingLog(h.read(),{session_id:'notes-session'}).session.workout.entries[0].sets[0].note,'Felt easy');
});
