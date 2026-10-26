import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPlans} from '../plans.js';
import {appendPlan,appendPlanEdit} from '../state.js';
import {createTraining,appendTrainingUpdate} from '../training.js';
import {createReads,localToday} from '../reads.js';
import {buildCombinedEntries} from '../../../frontend/src/lib/session-merge.js';
import {workoutVolume,workSetsDone,effectiveRoutineIds} from '../../../frontend/src/lib/history.js';
import {mergeStates} from '../../../frontend/src/lib/sync-merge.js';
import {EXIDX} from '../../../frontend/src/lib/exercises.js';
const user={id:'alice'},grant='grant';
const routine=(id='a')=>({id,name:id.toUpperCase(),ex:[{id:'0293',mode:'reps',sets:3,reps:10,weight:12,prog:'off'}]});
const seed=()=>({unit:'kg',routines:[routine(),routine('b')],week:{4:'a'},dayPlan:{},workouts:[],customEx:[],_rev:1,_wid:'w',unknown:{keep:true},bodyweight:[{d:'2026-10-15',w:80}]});
function harness(initial=seed()) {
 let state=structuredClone(initial);
 const read=()=>structuredClone(state);
 const plans=createPlans({read,append:(u,d)=>{state=appendPlan(state,d);return {saved:true,revision:state._rev};}});
 const saveEdit=d=>plans.saveEdit(user,grant,d.draft_id,true,d.confirmation_summary,(u,x)=>{state=appendPlanEdit(state,x);return {saved:true,revision:state._rev};});
 const training=createTraining({read,append:(u,d)=>{state=appendTrainingUpdate(state,d);return state;}});
 return {read,plans,saveEdit,training,saveTraining:d=>training.save(user,grant,d.draft_id,true,d.confirmation_summary),
   reads:createReads({read,now:()=>new Date('2026-10-14T18:00:00Z')}),set:s=>state=s};
}
const entry=(sets)=>({id:'0293',target:{mode:'reps',sets:sets.length,reps:10,weight:12},sets});
const workout=(id,date,sets)=>({id,d:date,name:'A',routineId:'a',routineIds:['a'],entries:[entry(sets)]});
test('per-side template/add/update reps agree with app L+R storage and preview',()=>{
 const h=harness(),draft=h.plans.preview(user,grant,{unit:'kg',routines:[{name:'Unilateral',exercises:[{exercise_id:'0293',sets:3,reps:10,per_side:true,weight:12,progression:'off'}]}]});
 assert.equal(draft.adds_routines[0].ex[0].reps,20);
 h.plans.save(user,grant,draft.draft_id,true,draft.confirmation_summary);
 const id=h.read().routines.at(-1).id;
 let edit=h.plans.previewEdit(user,grant,{routine_id:id,operations:[{type:'update_exercise',index:0,fields:{reps:12}}]});h.saveEdit(edit);
 assert.equal(h.read().routines.at(-1).ex[0].reps,24);
 edit=h.plans.previewEdit(user,grant,{routine_id:id,operations:[{type:'add_exercise',exercise:{exercise_id:'0293',sets:2,reps:8,per_side:true}}]});h.saveEdit(edit);
 assert.equal(h.read().routines.at(-1).ex[1].reps,16);
 const opening=buildCombinedEntries(h.read(),[id]).entries[0].sets.find(s=>s.done!==true&&s.sides);
 assert.equal(opening.sides.L.r,12);assert.equal(opening.sides.R.r,12);
});
test('batch plan revisions are atomic, schedule-only works with zero templates, and save tools reject the wrong draft kind',()=>{
 const h=harness(),before=h.read();
 assert.throws(()=>h.plans.previewEdit(user,grant,{routine_edits:[{routine_id:'a',operations:[{type:'rename_routine',name:'Changed'}]},{routine_id:'b',operations:[{type:'remove_exercise',index:9}]}]}),/does not exist/);
 assert.deepEqual(h.read(),before);
 const draft=h.plans.previewEdit(user,grant,{operations:[{type:'set_weekday',weekday:2,routine_ids:['a','b']},{type:'set_date',date:'2026-10-15',routine_id:'rest'}],routine_edits:[
 {routine_id:'a',operations:[{type:'rename_routine',name:'Upper'}]},
 {routine_id:'b',operations:[{type:'update_exercise',index:0,fields:{weight:15,progression:'off'}}]}]});
 assert.throws(()=>h.plans.save(user,grant,draft.draft_id,true,draft.confirmation_summary),/Preview expired/);
 assert.equal(h.read()._rev,1);h.saveEdit(draft);assert.equal(h.read()._rev,2);assert.equal(h.read().routines[0].name,'Upper');assert.equal(h.read().routines[1].ex[0].weight,15);
 assert.deepEqual(h.read().week[2],['a','b']);assert.equal(h.read().dayPlan['2026-10-15'],'rest');assert.deepEqual(h.read().workouts,before.workouts);
 assert.equal(h.saveEdit(draft).already_saved,true);
 const empty=harness({...seed(),routines:[]});empty.saveEdit(empty.plans.previewEdit(user,grant,{operations:[{type:'set_date',date:'2026-10-15',routine_id:'rest'}]}));assert.equal(empty.read().dayPlan['2026-10-15'],'rest');
 assert.throws(()=>h.plans.previewEdit(user,grant,{operations:[{type:'set_date',date:'2026-02-30',routine_id:'rest'}]}),/real/);
});
test('version undo restores templates and schedules only, survives stamps, and refuses later edits or unit changes',()=>{
 const h=harness(),before=h.read();h.saveEdit(h.plans.previewEdit(user,grant,{routine_id:'a',operations:[{type:'update_exercise',index:0,fields:{weight:20}}]}));
 const version=h.plans.versions(user).versions[0];assert.equal(version.can_undo,true);
 // Logging a workout must not block an otherwise safe plan undo.
 const withWorkout=h.read();withWorkout.workouts.push(workout('w','2026-10-14',[{w:20,r:10,done:true}]));withWorkout._rev++;h.set(withWorkout);
 h.saveEdit(h.plans.previewEdit(user,grant,{restore_version_id:version.id}));assert.equal(h.read().routines[0].ex[0].weight,before.routines[0].ex[0].weight);assert.equal(h.read().workouts.length,1);
 const modified=h.read();modified.routines[0].name='Phone edit';h.set(modified);
 assert.throws(()=>h.plans.previewEdit(user,grant,{restore_version_id:version.id}),/Plan changed/);
 modified.unit='lb';h.set(modified);assert.equal(h.plans.versions(user).versions.every(v=>!v.can_undo),true);
});
test('explicit edits clear newer exercise fields and undo does not resurrect them through legacy compatibility',()=>{
 const h=harness();h.saveEdit(h.plans.previewEdit(user,grant,{routine_id:'a',operations:[{type:'update_exercise',index:0,fields:{db_load:'each'}}]}));
 const id=h.plans.versions(user).versions[0].id;
 h.saveEdit(h.plans.previewEdit(user,grant,{restore_version_id:id}));
 assert.equal(h.read().routines[0].ex[0].dbLoad,undefined);
 const merged=mergeStates(h.read(),{...seed(),routines:[{...routine(),ex:[{...routine().ex[0],dbLoad:'each'}]},routine('b')]});
 assert.equal(merged.routines[0].ex[0].dbLoad,undefined);
});
test('training profile persists without enabling Coach or changing consent, and versions stay bounded',()=>{
 const s=seed();s.coach={consent:{agreedAt:'keep'},enabled:false};const h=harness(s);
 const profile={goal:'strength',experience:'beginner',daysPerWeek:3,preferredDays:[1,3,5],sessionMin:45,equipment:['dumbbell'],limitations:'Avoid painful movements',likes:'Rows',dislikes:'',notes:'Travel next week'};
 h.saveEdit(h.plans.previewEdit(user,grant,{training_profile:profile}));assert.deepEqual(h.plans.current(user).training_profile,profile);assert.deepEqual(h.read().coach.consent,s.coach.consent);assert.equal(h.read().coach.enabled,false);
 for(let i=0;i<13;i++)h.saveEdit(h.plans.previewEdit(user,grant,{routine_id:'a',operations:[{type:'rename_routine',name:'A'+i}]}));assert.equal(h.plans.versions(user).versions.length,10);
});
test('today query uses local date, combined app builder, overrides, pins and queue precedence',()=>{
 const h=harness();assert.equal(localToday('Asia/Taipei',new Date('2026-10-14T18:00:00Z')),'2026-10-15');
 let s=h.read();s.week[4]=['a','b'];h.set(s);
 let result=h.reads.session(user,{timezone:'Asia/Taipei'});assert.equal(result.date,'2026-10-15');assert.deepEqual(result.routine_ids,['a','b']);
 const app=buildCombinedEntries(h.read(),['a','b']);assert.deepEqual(result.exercises.map(e=>e.opening_sets.map(x=>({w:x.w,r:x.r}))),app.entries.map(e=>e.sets.map(x=>({w:x.w,r:x.r}))));
 s=h.read();s.dayPlan['2026-10-15']='rest';h.set(s);result=h.reads.session(user,{timezone:'Asia/Taipei'});assert.equal(result.rest_day,true);assert.equal(result.source,'rest_override');
 delete s.dayPlan['2026-10-15'];s.queue={ids:['b','a'],since:0,startsOn:'2026-10-15',label:'Block'};s.week={};h.set(s);
 result=h.reads.session(user,{timezone:'Asia/Taipei'});assert.deepEqual(result.routine_ids,effectiveRoutineIds(s,'2026-10-15','2026-10-15'));assert.equal(result.source,'queue');
 s.dayPlan['2026-10-16']='b';h.set(s);result=h.reads.session(user,{timezone:'Asia/Taipei',date:'2026-10-16'});assert.equal(result.source,'pinned');assert.deepEqual(result.routine_ids,['b']);
 assert.throws(()=>h.reads.session(user,{timezone:'Not/AZone'}));assert.throws(()=>h.reads.session(user,{timezone:'Asia/Taipei',date:'2026-02-30'}));
});
test('history pagination, detail privacy and monthly arithmetic match app, preserve unknown duration/effort',()=>{
 const s=seed();s.workouts=[workout('earlier','2026-09-15',[{w:10,r:10,done:true}]),workout('one','2026-10-01',[{w:5,r:5,done:true,phase:'warmup'},{w:12,r:10,done:true,rir:2},{w:12,r:8,done:false}]),workout('two','2026-10-15',[{w:20,r:20,done:true,sides:{L:{w:20,r:10,done:true},R:{w:15,r:8,done:true}}}])];
 s.workouts[1].bw=81;s.workouts[1].note='Keep this note';s.workouts[1].start=1000;s.workouts[1].end=6001000;
 const h=harness(s),page=h.reads.history(user,{from:'2026-10-01',to:'2026-10-31',limit:1});assert.equal(page.total,2);assert.equal(page.next_offset,1);assert.equal(page.workouts[0].id,'two');
 assert.equal(h.reads.history(user,{from:'2026-10-01',to:'2026-10-31',offset:1,limit:1}).next_offset,null);
 const detail=h.reads.workout(user,{workout_id:'one'});assert.equal(detail.workout.note,'Keep this note');assert.ok(!JSON.stringify(detail).includes('"bw"'));assert.ok(!JSON.stringify(detail).includes('bodyweight'));assert.throws(()=>h.reads.workout(user,{workout_id:'other-account'}),/not found/);
 const report=h.reads.summary(user,{from:'2026-10-01',to:'2026-10-31'});assert.equal(report.current.sessions,2);assert.equal(report.previous.sessions,1);assert.equal(report.current.training_days,2);
 assert.equal(report.current.volume,s.workouts.slice(1).reduce((n,w)=>n+workoutVolume(w),0));assert.equal(report.current.working_set_units,s.workouts.slice(1).reduce((n,w)=>n+workSetsDone(w),0));assert.equal(report.current.duration_missing_sessions,1);assert.equal(report.current.effort_missing_units,2);
 assert.equal(report.current.exercises[0].best_estimated_1rm.workout_id,'two');assert.throws(()=>h.reads.summary(user,{from:'2026-10-20',to:'2026-10-01'}),/1 to 93/);assert.throws(()=>h.reads.history(user,{from:'2025-01-01',to:'2026-10-15'}),/1 to 93/);
});
test('custom exercise metadata never survives an account read',()=>{
 const a=seed();a.customEx=[{id:'private-custom',n:'Alice private exercise',eq:'body weight',bp:'waist',tg:'abs',sm:[]}];a.routines=[{id:'a',name:'Private',ex:[{id:'private-custom',mode:'reps',sets:2,reps:10,weight:0,prog:'off'}]}];
 const h=harness(a);assert.equal(h.reads.session(user,{timezone:'Asia/Taipei'}).exercises[0].name,'Alice private exercise');assert.equal(EXIDX['private-custom'],undefined);
 const b=harness();assert.ok(!JSON.stringify(b.reads.session({id:'bob'},{timezone:'Asia/Taipei'})).includes('Alice private'));assert.equal(EXIDX['private-custom'],undefined);
});
const importInput=()=>({timezone:'Asia/Taipei',date:'2026-10-14',workout:{routine_id:'a',exercises:[{exercise_id:'0293',mode:'reps',sets:[{weight:15,reps:10,failure:true}]}]}});
test('training correction/deletion preserve IDs, sync tombstones and unrelated data; partial notes preserve omitted fields',()=>{
 const h=harness(),input=importInput();let d=h.training.preview(user,grant,input);h.saveTraining(d);const id=h.read().workouts[0].id;
 assert.equal(h.read().workouts[0].entries[0].sets[0].failure,true);
 const update=importInput();update.workout_id=id;update.workout.exercises[0].sets[0].weight=17;d=h.training.preview(user,grant,update);assert.ok(d.confirmation_summary.includes('Replace existing workout'));h.saveTraining(d);assert.equal(h.read().workouts.length,1);assert.equal(h.read().workouts[0].id,id);assert.equal(h.read().workouts[0].entries[0].sets[0].w,17);
 // A second correction back to a previous value must be treated as intentional.
 update.workout.exercises[0].sets[0]={weight:15,reps:10,failure:false};
 d=h.training.preview(user,grant,update);h.saveTraining(d);
 assert.equal(h.read().workouts[0].entries[0].sets[0].w,15);assert.equal(h.read().workouts[0].entries[0].sets[0].failure,false);
 const stalePhone=h.read();
 let s=h.read();s.dayNotes={'2026-10-14':{text:'Elbow sore',tag:'injured',_ts:1}};h.set(s);
 d=h.training.preview(user,grant,{date:'2026-10-14',timezone:'Asia/Taipei',day_note_tag:'rest'});h.saveTraining(d);assert.equal(h.read().dayNotes['2026-10-14'].text,'Elbow sore');
 d=h.training.preview(user,grant,{date:'2026-10-14',timezone:'Asia/Taipei',day_note:null});h.saveTraining(d);assert.equal(h.read().dayNotes['2026-10-14'].tag,undefined);
 d=h.training.preview(user,grant,{date:'2026-10-14',timezone:'Asia/Taipei',workout_id:id,delete_workout:true});assert.ok(d.confirmation_summary.includes('DELETE'));h.saveTraining(d);assert.equal(h.read().workouts.length,0);assert.ok(h.read().deleted.workouts[id]);assert.equal(mergeStates(stalePhone,h.read()).workouts.length,0);assert.deepEqual(h.read().unknown,{keep:true});assert.equal(h.read().bodyweight[0].w,80);assert.equal(h.saveTraining(d).already_saved,true);
 assert.throws(()=>h.training.preview(user,grant,{...importInput(),workout_id:'someone-else'}),/not found/);
});
test('training imports reject actual future local dates, incompatible start zones and ambiguous weights',()=>{
 const h=harness(),future=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
 assert.throws(()=>h.training.preview(user,grant,{timezone:'Asia/Taipei',date:future,day_note:'Future'}),/today/);
 const input=importInput();input.workout.started_at='2026-10-14T23:30:00-10:00';assert.throws(()=>h.training.preview(user,grant,input),/timezone/);
 delete input.workout.started_at;delete input.workout.exercises[0].sets[0].weight;assert.throws(()=>h.training.preview(user,grant,input),/Weight is missing/);
});

test('legacy timezone omission resolves explicit account/default configuration and discloses its source',()=>{
 const state=seed(),input={date:'2026-10-14',day_note:'Compatibility fixture'};
 const create=(s,fallback)=>createTraining({read:()=>s,append:()=>{throw Error('Preview must not write');},defaultTimezone:fallback});
 let t=create(state,'Asia/Taipei'),p=t.preview(user,grant,input);
 assert.equal(p.timezone,'Asia/Taipei');assert.equal(p.timezone_source,'deployment_default');assert.ok(p.confirmation_summary.includes('timezone source: deployment_default'));
 state.reminder={tz:'America/Los_Angeles'};t=create(state,'Asia/Taipei');p=t.preview(user,grant,input);
 assert.equal(p.timezone,'America/Los_Angeles');assert.equal(p.timezone_source,'account_reminder');
 p=t.preview(user,grant,{...input,timezone:'Asia/Tokyo'});assert.equal(p.timezone,'Asia/Tokyo');assert.equal(p.timezone_source,'input');
 assert.throws(()=>t.preview(user,grant,{...input,timezone:'Not/AZone'}));
 state.reminder.tz='Invalid';assert.equal(create(state,'Asia/Taipei').preview(user,grant,input).timezone,'Asia/Taipei');
 assert.throws(()=>create(state,null).preview(user,grant,input),/Timezone is unavailable/);
 assert.throws(()=>create(state,'Not/AZone'));
});

test('5 exercises and 19 sets with 3 dropsets retain row counts, all drop loads/reps, preview and volume',()=>{
 const h=harness(),ids=['0025','0289','0293','0085','1459'];
 const exercises=ids.map((exercise_id,i)=>({exercise_id,mode:'reps',sets:Array.from({length:i===4?3:4},(_,j)=>({weight:40,reps:10,
   ...(i<3&&j===0?{type:'dropset',drops:[{weight:30,reps:8},{weight:20,reps:6}]}:{})}))}));
 const input={timezone:'Asia/Taipei',date:'2026-10-14',workout:{name:'Synthetic import fixture',exercises}};
 let p=h.training.preview(user,grant,input);assert.equal((p.confirmation_summary.match(/\(dropset\)/g)||[]).length,3);assert.ok(p.confirmation_summary.includes('40 kg × 10 → 30 kg × 8 → 20 kg × 6'));
 h.saveTraining(p);let w=h.read().workouts[0];assert.equal(w.entries.length,5);assert.equal(w.entries.reduce((n,e)=>n+e.sets.length,0),19);
 assert.equal(w.entries.flatMap(e=>e.sets).filter(s=>s.type==='dropset').length,3);assert.equal(workoutVolume(w),8680);assert.equal(workSetsDone(w),19);
 assert.deepEqual(w.entries[0].sets[0].drops,[{w:30,r:8},{w:20,r:6}]);
 const report=h.reads.summary(user,{from:'2026-10-14',to:'2026-10-14',compare_previous:false});assert.equal(report.current.volume,8680);
 assert.equal(report.current.exercises.flatMap(e=>e.observations).reduce((n,o)=>n+o.total_reps,0),232);
 const detail=h.reads.workout(user,{workout_id:w.id});assert.deepEqual(detail.workout.entries[0].sets[0].drops,w.entries[0].sets[0].drops);
 p=h.training.preview(user,grant,input);assert.throws(()=>h.saveTraining(p),/already in the history/);
 // Identical main rows with a genuinely different drop are not a duplicate.
 input.workout.exercises[0].sets[0].drops[1].reps=5;p=h.training.preview(user,grant,input);h.saveTraining(p);assert.equal(h.read().workouts.length,2);
});

test('unilateral dropsets store both limbs and invalid drop structures fail without silently flattening',()=>{
 const h=harness(),input=importInput();input.workout.exercises[0].per_side=true;
 input.workout.exercises[0].sets=[{weight:20,reps:10,type:'dropset',drops:[{weight:15,reps:8}]}];
 const p=h.training.preview(user,grant,input);assert.ok(p.confirmation_summary.includes('20 kg × 10 → 15 kg × 8 each side'));h.saveTraining(p);
 const s=h.read().workouts[0].entries[0].sets[0];assert.equal(s.drops,undefined);assert.deepEqual(s.sides.L.drops,[{w:15,r:8}]);assert.deepEqual(s.sides.R.drops,[{w:15,r:8}]);assert.equal(workoutVolume(h.read().workouts[0]),640);
 for(const bad of [{weight:20,reps:10,type:'dropset'}, {weight:20,reps:10,drops:[{weight:15,reps:8}]},
  {weight:20,reps:10,type:'dropset',drops:[{weight:25,reps:8}]}, {weight:20,reps:10,type:'dropset',warmup:true,drops:[{weight:15,reps:8}]}]) {
   input.workout.exercises[0].sets=[bad];assert.throws(()=>h.training.preview(user,grant,input));
 }
});
