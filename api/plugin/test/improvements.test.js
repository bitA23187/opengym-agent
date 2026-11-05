import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlans } from '../plans.js';
import { appendPlanEdit,planSnapshot,planVersionMatches } from '../state.js';
import { createTraining,appendTrainingUpdate } from '../training.js';
import { createReads } from '../reads.js';
import { readTrainingNotes } from '../context.js';
import { trainingVersions } from '../workout-patch.js';
import { hash } from '../store.js';
import { effectiveRoutineIds,workoutVolume } from '../../../frontend/src/lib/history.js';
import { mergeStates } from '../../../frontend/src/lib/sync-merge.js';
const timezone='Asia/Taipei',date='2026-10-15',user={id:'fixture'},grant='g';
const seed=()=>({unit:'kg',_rev:1,_wid:'w',routines:[{id:'a',name:'A',ex:[{id:'0293',mode:'reps',sets:1,reps:10,weight:12}]}],workouts:[],week:{},dayPlan:{},scheduleMode:'rotation'});
function harness(initial=seed()) {
  let state=structuredClone(initial);
  const read=()=>structuredClone(state),plans=createPlans({read}),training=createTraining({read,append:(u,d)=>state=appendTrainingUpdate(state,d),defaultTimezone:timezone});
  return {read,plans,training,reads:createReads({read,now:()=>new Date('2026-10-15T12:00:00Z')}),
    savePlan:p=>plans.saveEdit(user,grant,p.draft_id,true,p.confirmation_summary,(u,d)=>state=appendPlanEdit(state,d)),
    saveTraining:p=>training.save(user,grant,p.draft_id,true,p.confirmation_summary)};
}
test('empty rotation is unconfigured, date rest is explicit, and day notes do not create workouts',()=>{
  const s=seed();s.dayPlan['2026-10-16']='rest';s.dayPlan['2026-10-17']='a';s.dayNotes={[date]:{text:'Reported exercise'}};
  const h=harness(s),r=h.reads.session(user,{date,timezone});
  assert.equal(r.source,'unconfigured');assert.equal(r.rest_day,false);assert.equal(r.days[0].status,'unconfigured');
  assert.equal(r.days[1].status,'rest');assert.equal(r.days[2].status,'training');assert.equal(h.read().workouts.length,0);
  assert.equal(h.plans.current(user).schedule.status,'unconfigured');
  assert.match(r.notes,/valid free-training choice/);
  assert.match(r.notes,/never a prerequisite for recommendations/);
  assert.doesNotMatch(r.notes,/ask the user to configure/);
  assert.equal(h.plans.current(user).routines.length,1);
});
test('atomic rotation/weekday/date edits match app resolution, sync and undo; later queue edits block stale undo',()=>{
  const h=harness(),before=h.read();
  const p=h.plans.previewEdit(user,grant,{schedule:{mode:'rotation',timezone,starts_on:date,routine_ids:['a'],label:'Loop'},operations:[
    {type:'set_weekday',weekday:1,routine_ids:['a']},{type:'set_date',date:'2026-10-16',routine_id:'rest'}]});
  assert.deepEqual(h.read(),before);h.savePlan(p);assert.equal(h.savePlan(p).already_saved,true);
  const s=h.read(),r=h.reads.session(user,{date,timezone});assert.deepEqual(r.routine_ids,effectiveRoutineIds(s,date,date));assert.equal(r.source,'queue');
  assert.equal(r.days[2].status,'unscheduled');assert.equal(mergeStates(before,s).queue.rotationId,s.rotation.id);
  const v=h.plans.versions(user).versions[0];assert.equal(v.can_undo,true);
  const altered=structuredClone(s);altered.queue.startsOn='2026-10-20';assert.equal(planVersionMatches(altered,s.pluginPlanHistory.at(-1)),false);
  h.savePlan(h.plans.previewEdit(user,grant,{restore_version_id:v.id}));assert.equal(h.read().queue,null);assert.deepEqual(h.read().week,{});
});
test('legacy plan versions remain undoable only when unrelated rotation data is absent',()=>{
  const s={...seed(),scheduleMode:'week'},snapshot=planSnapshot(s);for(const k of ['rotation','queue','scheduleMode'])delete snapshot[k];
  const v={before:snapshot,after_hash:hash(JSON.stringify(snapshot))};assert.equal(planVersionMatches(s,v),true);
  assert.equal(planVersionMatches({...s,rotation:{id:'new'}},v),false);
});
test('switching to fixed week removes the live queue; invalid/duplicate IDs and invalid dates are rejected',()=>{
  const h=harness();h.savePlan(h.plans.previewEdit(user,grant,{schedule:{mode:'rotation',timezone,starts_on:date,routine_ids:['a']}}));
  h.savePlan(h.plans.previewEdit(user,grant,{schedule:{mode:'week',timezone,starts_on:date},operations:[{type:'set_weekday',weekday:4,routine_ids:['a']}]}));
  assert.equal(h.read().queue,null);assert.equal(h.reads.session(user,{date,timezone}).source,'weekday');
  for(const patch of [{routine_ids:['missing']},{routine_ids:['a','a']},{starts_on:'2026-02-30'}])assert.throws(()=>h.plans.previewEdit(user,grant,{schedule:{mode:'rotation',timezone,starts_on:date,routine_ids:['a'],...patch}}));
});
test('promotion links historical sources, requires confirmation, deduplicates and survives old app sync',()=>{
  const s=seed();s.dayNotes={[date]:{text:'User reports elbow discomfort'}};const h=harness(s);
  const change={text:'User reports elbow discomfort',kind:'limitation',source_note_ids:['day:'+date],review_on:'2026-11-01'};
  const p=h.training.preview(user,grant,{date,context_notes:[change]});assert.equal(p.authorization.requires_user_confirmation,true);assert.equal(h.read().trainingNotes,undefined);h.saveTraining(p);
  const id=Object.keys(h.read().trainingNotes)[0];assert.equal(mergeStates(s,h.read()).trainingNotes[id].source_note_ids[0],'day:'+date);
  const notes=readTrainingNotes(h.read(),{query:'elbow'});assert.deepEqual(notes.notes.find(n=>n.source==='day').promoted_context_ids,[id]);
  assert.throws(()=>h.training.preview(user,grant,{date,context_notes:[change]}),/already exists/);
  assert.throws(()=>h.training.preview(user,grant,{date,context_notes:[{...change,text:'Other',source_note_ids:['day:2026-01-01']}]}),/not found/);
  h.saveTraining(h.training.preview(user,grant,{date,context_notes:[{id,status:'resolved'}]}));assert.equal(h.plans.current(user).training_context.important_notes.length,0);
});
test('rest-pause roundtrip uses native clusters, one working row and exact each-side volume',()=>{
  for(const per_side of [false,true]) {
    const h=harness(),p=h.training.preview(user,grant,{date,workout:{exercises:[{exercise_id:'0293',mode:'reps',per_side,db_load:'each',sets:[{weight:12,reps:15,type:'restpause',failure:true,clusters:[{reps:10,rest_seconds:0},{reps:3,rest_seconds:15},{reps:2,rest_seconds:20}]}]}]}});
    assert.match(p.confirmation_summary,/restpause bursts/);h.saveTraining(p);const w=h.read().workouts[0],row=w.entries[0].sets[0],side=per_side?row.sides.L:row;
    assert.equal(w.entries[0].sets.length,1);assert.equal(side.type,'restpause');assert.equal(side.clusters.reduce((n,c)=>n+c.r,0),side.r);assert.equal(side.failure,true);
    const report=h.reads.summary(user,{from:date,to:date,compare_previous:false});assert.equal(report.current.volume,12*15*2);assert.equal(report.current.volume,workoutVolume(w));assert.equal(report.current.working_set_units,per_side?2:1);
    const detail=h.reads.workout(user,{workout_id:w.id});assert.deepEqual((per_side?detail.workout.entries[0].sets[0].sides.L:detail.workout.entries[0].sets[0]).clusters,side.clusters);
    assert.throws(()=>h.training.preview(user,grant,{date,workout_id:w.id,workout_patch:{set_edits:[{entry_index:0,set_index:0,...(per_side?{side:'L'}:{}),fields:{reps:10}}]}}),/cluster total/);
  }
});
test('rest-pause rejects ambiguous burst totals and wrong modes without writing data',()=>{
  const h=harness();for(const set of [{reps:10,type:'restpause'},{reps:10,type:'restpause',clusters:[{reps:10,rest_seconds:0},{reps:3,rest_seconds:15}]},{reps:13,type:'straight',clusters:[{reps:10,rest_seconds:0},{reps:3,rest_seconds:15}]}])assert.throws(()=>h.training.preview(user,grant,{date,workout:{exercises:[{exercise_id:'0293',mode:'reps',sets:[set]}]}}));
  assert.equal(h.read().workouts.length,0);
});
test('compact versions and summaries retain evidence IDs and totals, full versions remain retrievable',()=>{
  const h=harness();h.saveTraining(h.training.preview(user,grant,{date,workout:{exercises:[{exercise_id:'0293',mode:'reps',note:'Evidence '.repeat(50),sets:[{weight:12,reps:10}]}]}}));
  const compact=trainingVersions(h.read()),full=trainingVersions(h.read(),{detail_level:'full',version_id:compact[0].id});assert.ok(compact[0].summary.length<=181);assert.ok(full[0].summary.length>compact[0].summary.length);assert.equal(compact[0].can_undo,full[0].can_undo);
  const args={from:date,to:date,compare_previous:false},standard=h.reads.summary(user,args),small=h.reads.summary(user,{...args,detail_level:'compact'});
  assert.equal(small.current.volume,standard.current.volume);assert.deepEqual(small.current.exercises[0].evidence_workout_ids,[h.read().workouts[0].id]);assert.equal(small.current.exercises[0].observations,undefined);assert.ok(JSON.stringify(small).length<JSON.stringify(standard).length);
});
test('completed imported rotation pass advances using app refill semantics, without creating extra workouts',()=>{
  const h=harness();h.savePlan(h.plans.previewEdit(user,grant,{schedule:{mode:'rotation',timezone,starts_on:date,routine_ids:['a']}}));
  const prior=h.read().queue;
  const preview=h.training.preview(user,grant,{date,workout:{routine_id:'a',exercises:[{exercise_id:'0293',mode:'reps',sets:[{weight:12,reps:10}]}]}});assert.equal(preview.rotation_advancement.starts_on,'2026-10-16');assert.match(preview.confirmation_summary,/rotation pass advances/);h.saveTraining(preview);
  assert.equal(h.read().workouts.length,1);assert.equal(h.read().queue.startsOn,'2026-10-16');assert.equal(h.read().queue.rotationId,prior.rotationId);
});
test('duplicate detection accepts legacy unilateral dropset mirrors and distinguishes rest-pause breakdowns',()=>{
  const input={date,workout:{exercises:[{exercise_id:'0293',mode:'reps',per_side:true,sets:[{weight:12,reps:10,type:'dropset',drops:[{weight:8,reps:5}]}]}]}};
  const h=harness();h.saveTraining(h.training.preview(user,grant,input));const legacy=h.read();legacy.workouts[0].entries[0].sets[0].type='dropset';
  const next=harness(legacy);assert.throws(()=>next.saveTraining(next.training.preview(user,grant,input)),/already in the history/);
  const rp=harness(),payload={date,workout:{exercises:[{exercise_id:'0293',mode:'reps',sets:[{weight:12,reps:15,type:'restpause',clusters:[{reps:10,rest_seconds:0},{reps:5,rest_seconds:15}]}]}]}};
  rp.saveTraining(rp.training.preview(user,grant,payload));
  const changed=structuredClone(payload);changed.workout.exercises[0].sets[0].clusters[1].rest_seconds=20;
  rp.saveTraining(rp.training.preview(user,grant,changed));assert.equal(rp.read().workouts.length,2);
});
