import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlans } from '../plans.js';
import { appendPlan,appendPlanEdit } from '../state.js';
import { createTraining,appendTrainingUpdate } from '../training.js';
import { createBodyMetrics } from '../body-metrics.js';
import { createReads } from '../reads.js';
import { readTrainingNotes,trainingContext } from '../context.js';
import { trainingVersions } from '../workout-patch.js';
import { exerciseDetails } from '../catalogue.js';
import { localToday } from '../reads-schema.js';
import { buildCombinedEntries } from '../../../frontend/src/lib/session-merge.js';
import { effectiveRoutineIds } from '../../../frontend/src/lib/history.js';
import { mergeStates } from '../../../frontend/src/lib/sync-merge.js';
const user={id:'alice'},grant='alice-grant',timezone='Asia/Taipei',today=()=>localToday(timezone);
const seed=()=>({unit:'kg',routines:[{id:'a',name:'A',ex:[{id:'0293',sets:3,reps:10,weight:12,prog:'off'},{id:'0025',sets:2,reps:8,weight:40,prog:'off'}]}],workouts:[],customEx:[],week:{},dayPlan:{},_rev:1,_wid:'w',unknown:{keep:true}});
function harness(initial=seed()) {
  let state=structuredClone(initial);const read=()=>structuredClone(state),append=(u,d)=>state=appendTrainingUpdate(state,d);
  const training=createTraining({read,append,defaultTimezone:timezone}),body=createBodyMetrics({read,append});
  const plans=createPlans({read,append:(u,d)=>{state=appendPlan(state,d);return {saved:true};}});
  return {read,training,body,plans,set:s=>state=s,reads:createReads({read}),
    save:d=>training.save(user,grant,d.draft_id,true,d.confirmation_summary),saveBody:d=>body.save(user,grant,d.draft_id,true,d.confirmation_summary),
    savePlan:d=>plans.saveEdit(user,grant,d.draft_id,true,d.confirmation_summary,(u,d)=>{state=appendPlanEdit(state,d);return {saved:true};})};
}
const log=h=>{const d=h.training.preview(user,grant,{date:'2026-10-14',workout:{routine_id:'a',exercises:[{exercise_id:'0293',mode:'reps',sets:[{weight:12,reps:10},{weight:12,reps:8}],note:'Seat 4'}]}});h.save(d);return h.read().workouts.at(-1).id;};

test('important context is returned across plan, unrelated session, summary and filtered note reads; resolution is explicit',()=>{
  const h=harness();const preview=h.training.preview(user,grant,{date:today(),context_notes:[{text:'User reports elbow discomfort in extensions; not diagnosed',kind:'limitation',exercise_ids:['0025'],review_on:'2026-11-01'}]});
  assert.equal(h.read().trainingNotes,undefined);assert.ok(preview.confirmation_summary.includes('not diagnosed'));h.save(preview);
  const id=Object.keys(h.read().trainingNotes)[0];
  for(const context of [h.plans.current(user).training_context,h.reads.session(user,{timezone}).training_context,h.reads.summary(user,{from:'2026-10-01',to:'2026-10-14'}).training_context,readTrainingNotes(h.read(),{query:'no match',exercise_id:'0293'}).training_context])assert.equal(context.important_notes[0].id,id);
  const before=h.read();h.save(h.training.preview(user,grant,{date:today(),context_notes:[{id,status:'resolved'}]}));
  assert.equal(trainingContext(h.read()).important_notes.length,0);assert.equal(readTrainingNotes(h.read(),{status:'resolved'}).notes[0].id,id);
  assert.equal(mergeStates(before,h.read()).trainingNotes[id].status,'resolved');
  assert.throws(()=>h.training.preview(user,grant,{date:today(),context_notes:[{id:'bob-note',status:'resolved'}]}),/not found/);
  h.save(h.training.preview(user,grant,{date:today(),context_notes:[{id,remove:true}]}));assert.equal(readTrainingNotes(h.read(),{status:'all'}).notes.length,0);
});
test('notes search preserves provenance and pagination; append keeps prior standing text and important context bypasses filters',()=>{
  const h=harness(),id=log(h);h.save(h.training.preview(user,grant,{date:today(),day_note:'Travel',exercise_notes:[{exercise_id:'0293',note:'Seat 4'}]}));
  h.save(h.training.preview(user,grant,{date:today(),exercise_notes:[{exercise_id:'0293',note:'Neutral grip',operation:'append'}]}));
  const p=readTrainingNotes(h.read(),{query:'Seat',limit:1});assert.equal(p.total,2);assert.equal(p.next_offset,1);assert.ok(readTrainingNotes(h.read(),{query:'Seat',offset:1}).notes.some(n=>n.workout_id===id||n.source==='standing'));
  assert.equal(h.read().exNotes['0293'],'Seat 4\nNeutral grip');
});
test('partial workout patches preserve unknown fields, target and unedited rows; preview and version reads never expose embedded body weight',()=>{
  const h=harness(),id=log(h),s=h.read();s.workouts[0].bw=81.23;s.workouts[0].media=[{hash:'kept'}];s.workouts[0].custom='keep';s.workouts[0].vol=216;h.set(s);
  const p=h.training.preview(user,grant,{date:'2026-10-14',workout_id:id,workout_patch:{session_note:'Debrief',set_edits:[{entry_index:0,set_index:1,fields:{weight:15}}]}});
  assert.ok(!p.confirmation_summary.includes('81.23'));h.save(p);
  const w=h.read().workouts[0];assert.equal(w.bw,81.23);assert.equal(w.vol,240);assert.deepEqual(w.media,s.workouts[0].media);assert.equal(w.custom,'keep');assert.equal(w.entries[0].sets[0].w,12);assert.equal(w.entries[0].sets[1].w,15);assert.deepEqual(w.entries[0].target,s.workouts[0].entries[0].target);
  assert.ok(!JSON.stringify(trainingVersions(h.read())).includes('81.23'));assert.throws(()=>h.training.preview(user,grant,{date:'2026-10-14',workout_id:id,workout_patch:{set_edits:[{entry_index:0,set_index:2,fields:{weight:15}}]}}),/not found/);
});
test('workout undo restores corrections and deleted records, rejects later edits and changed units, and prevents stale phone resurrection',()=>{
  const h=harness(),id=log(h),original=h.read().workouts[0];
  h.save(h.training.preview(user,grant,{date:'2026-10-14',workout_id:id,workout_patch:{session_note:'New note'}}));
  let v=trainingVersions(h.read())[0];h.save(h.training.preview(user,grant,{date:'2026-10-14',restore_version_id:v.id}));assert.equal(h.read().workouts[0].note,original.note);
  const stale=h.read();h.save(h.training.preview(user,grant,{date:'2026-10-14',workout_id:id,delete_workout:true}));v=trainingVersions(h.read())[0];assert.equal(mergeStates(stale,h.read()).workouts.length,0);
  h.save(h.training.preview(user,grant,{date:'2026-10-14',restore_version_id:v.id}));assert.equal(h.read().workouts[0].id,id);assert.equal(mergeStates(stale,h.read()).workouts.length,1);
  const changed=h.read();changed.workouts[0].note='Phone changed';h.set(changed);assert.throws(()=>h.training.preview(user,grant,{date:'2026-10-14',restore_version_id:v.id}),/changed after/);
  const unit=h.read();unit.unit='lb';h.set(unit);assert.equal(trainingVersions(h.read()).every(v=>!v.can_undo),true);
});
test('moving a workout preserves ID and duration, demands new exact start time, and rejects future dates',()=>{
  const h=harness(),id=log(h),s=h.read();s.workouts[0].start=Date.parse('2026-10-14T18:30:00+08:00');s.workouts[0].end=s.workouts[0].start+1800000;h.set(s);
  assert.throws(()=>h.training.preview(user,grant,{date:'2026-10-14',workout_id:id,workout_patch:{date:'2026-10-13'}}),/requires its new exact/);
  h.save(h.training.preview(user,grant,{date:'2026-10-14',workout_id:id,workout_patch:{date:'2026-10-13',started_at:'2026-10-13T18:30:00+08:00'}}));
  const w=h.read().workouts[0];assert.equal(w.id,id);assert.equal(w.d,'2026-10-13');assert.equal(w.end-w.start,1800000);
});
test('body metrics preserve unspecified measurements, convert inches, clear explicitly, sync changes and reject account/unit/grant conflicts',()=>{
  const h=harness(),s=h.read();s.measurements=[{d:'2026-10-14',waist:85,chest:100,other:[{id:'custom',name:'custom',value:22}],t:1}];s.bodyweight=[{d:'2026-10-14',w:80,t:1}];h.set(s);
  let p=h.body.preview(user,grant,{unit:'kg',timezone,circumference_unit:'in',entries:[{date:'2026-10-14',weight:79,measurements:{waist:32,bodyFat:18}}],target_weight:75});assert.equal(h.read().bodyweight[0].w,80);
  assert.throws(()=>h.body.save({id:'bob'},grant,p.draft_id,true,p.confirmation_summary),/different authorization/);assert.throws(()=>h.body.save(user,'other-grant',p.draft_id,true,p.confirmation_summary),/different authorization/);
  h.saveBody(p);assert.equal(h.read().measurements[0].waist,81.3);assert.equal(h.read().measurements[0].chest,100);assert.equal(h.read().measurements[0].bodyFat,18);assert.equal(h.read().measurements[0].other[0].value,22);assert.equal(h.read().targetW,75);
  assert.equal(mergeStates(s,h.read()).bodyweight[0].w,79);assert.equal(h.saveBody(p).already_saved,true);
  const report=h.body.read(user,{from:'2026-10-01',to:'2026-10-14'});assert.equal(report.weekly_weights[0].avg,79);assert.equal(report.circumference_unit,'cm');
  p=h.body.preview(user,grant,{unit:'kg',timezone,entries:[{date:'2026-10-14',weight:null,measurements:{waist:null}}]});h.saveBody(p);assert.equal(h.read().bodyweight.length,0);assert.equal(h.read().measurements[0].chest,100);assert.equal(h.read().measurements[0].waist,null);
  assert.equal(mergeStates(s,h.read()).bodyweight.length,0);assert.throws(()=>h.body.preview(user,grant,{unit:'lb',timezone,target_weight:100}),/account weight unit/);
  p=h.body.preview(user,grant,{unit:'kg',timezone,target_weight:70});const changed=h.read();changed._rev++;h.set(changed);assert.throws(()=>h.saveBody(p),/changed since preview/);
});
test('advanced progression fields are represented exactly in preview and app storage, including each-side ranges and null clearing',()=>{
  const h=harness();let p=h.plans.previewEdit(user,grant,{routine_id:'a',operations:[{type:'update_exercise',index:0,fields:{progression:'double',reps:12,reps_min:8,per_side:true,increment:1,deload_factor:0.85,warmup_sets:2}}]});
  assert.ok(p.confirmation_summary.includes('repsMin'));h.savePlan(p);let cfg=h.read().routines[0].ex[0];assert.equal(cfg.reps,24);assert.equal(cfg.repsMin,16);assert.equal(cfg.inc,1);assert.equal(cfg.deloadFactor,0.85);
  p=h.plans.previewEdit(user,grant,{routine_id:'a',operations:[{type:'update_exercise',index:0,fields:{per_side:false,increment:null,deload_factor:null}}]});h.savePlan(p);cfg=h.read().routines[0].ex[0];assert.equal(cfg.reps,12);assert.equal(cfg.repsMin,8);assert.equal(cfg.inc,undefined);
  assert.throws(()=>h.plans.previewEdit(user,grant,{routine_id:'a',operations:[{type:'update_exercise',index:0,fields:{reps_min:13}}]}),/must not exceed/);
});
test('removed single-session adjustment is rejected without changing the plan or account data',()=>{
  const h=harness(),before=h.read();
  assert.throws(()=>h.plans.previewEdit(user,grant,{session_adjustment:{date:today(),timezone,clear:true}}));
  assert.deepEqual(h.read(),before);
});
test('superset and reorder operations use real app grouping and reject non-adjacent groups',()=>{
  const h=harness();h.savePlan(h.plans.previewEdit(user,grant,{routine_id:'a',operations:[{type:'set_superset',indexes:[0,1],enabled:true,name:'Pair',rest_seconds:90}]}));let ex=h.read().routines[0].ex;assert.equal(ex[0].sg,ex[1].sg);assert.equal(ex[0].sgName,'Pair');
  h.savePlan(h.plans.previewEdit(user,grant,{routine_id:'a',operations:[{type:'move_exercise',index:1,to_index:0}]}));assert.equal(h.read().routines[0].ex[0].id,'0025');
});
test('exercise details include catalogue instructions, standing settings, active context and distinct alternatives',()=>{
  const s=seed();s.exNotes={'0293':'Seat 4'};const result=exerciseDetails(s,'0293','dumbbell');assert.ok(result.instructions.length);assert.equal(result.standing_note,'Seat 4');assert.ok(result.alternatives.every(e=>e.exercise_id!=='0293'&&e.equipment==='dumbbell'));
});
