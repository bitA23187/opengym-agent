import {directSaveUsers,permitsDirectSave,directSaveSource} from './save-policy.js';
import { applyNutritionUpdate } from './nutrition.js';
import { z } from 'zod';
import { LIB_BY_ID } from '../coach/core/library.js';
import { random } from './store.js';
import { stampPluginChange } from './state.js';
import { timeZone, localToday } from './reads-schema.js';
import {contextNoteSchema,prepareContextNotes,trainingContext} from './context.js';
import {workoutPatchSchema,patchWorkout,recordTrainingVersion,workoutFingerprint,publicWorkout} from './workout-patch.js';
import {applyCustomExerciseUpdate} from './custom-exercises.js';
import {applyBodyUpdate} from './body-metrics.js';
import { refillAfter } from '../../frontend/src/lib/rotation.js';
import { dbLoadFor } from '../../frontend/src/lib/dumbbells.js';
import { registerCustom } from '../../frontend/src/lib/exercises.js';
import { reconcileWorkoutChange } from './reconcile.js';
import { highestStamp } from '../../frontend/src/lib/sync-merge.js';
import { requireScopes } from './scopes.js';

import { observationSchema } from './activity-fields-schema.js';
import { cleanFieldDefinitions,cleanObservations } from '../../frontend/src/lib/activity-fields.js';
import { activitySetFields,climbingRouteSchema } from './activity-schema.js';
import { validateActivitySet,cleanClimbingRoutes } from '../../frontend/src/lib/activity-data.js';
import { sessionUpdateSchema } from './training-session-schema.js';
import { prepareSessionChange,trainingLogBrief } from './training-sessions.js';
import { transitionTrainingLog,publicTrainingLog } from '../../frontend/src/lib/training-log.js';
const NOTE_MAX=500;
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{
  const d=new Date(value+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
},'Date must be a real YYYY-MM-DD date.');
export const setShape=z.object({
  ...activitySetFields,
  note:z.string().trim().max(140).optional(),
  weight:z.number().min(0).max(1500).optional(),
  reps:z.number().int().min(1).max(100).optional(),
  seconds:z.number().int().min(1).max(7200).optional(),
  minutes:z.number().min(0.1).max(600).optional(),
  speed:z.number().min(0).max(1000).optional().describe('Cardio speed stored in km/h. Convert an explicitly stated mph value using 1 mph = 1.609344 km/h.'),
  incline:z.number().min(-20).max(45).optional(),
  warmup:z.boolean().default(false),
  failure:z.boolean().default(false),
  rir:z.number().min(0).max(10).optional(),
  rpe:z.number().min(0).max(10).optional(),
  type:z.enum(['straight','dropset','restpause']).default('straight'),
  clusters:z.array(z.object({reps:z.number().int().min(1).max(100),rest_seconds:z.number().int().min(0).max(300)}).strict()).min(2).max(20).optional().describe('For type=restpause, every burst including the initial burst. reps must equal the sum of all burst reps. rest_seconds is the short rest before that burst; use 0 for the initial burst.'),
  drops:z.array(z.object({weight:z.number().min(0).max(1500),reps:z.number().int().min(1).max(100)}).strict()).min(1).max(10).optional()
    .describe('Weight/reps for each decrease after the main set, in order. These stay inside one dropset row, not separate working sets.'),
}).strict();
export const loggedExercise=z.object({
  exercise_id:z.string().min(1).max(64),
  mode:z.enum(['reps','time','cardio','climbing','custom']),
  observations:z.array(observationSchema).min(1).max(200).optional(),
  routes:z.array(climbingRouteSchema).min(1).max(100).optional(),
  per_side:z.boolean().default(false).describe('Set true only when the source explicitly says per side. Reps are the count for each limb; timed sets are recorded once for left and once for right.'),
  db_load:z.enum(['as','each','total']).optional().describe('Explicit dumbbell/kettlebell weight convention; otherwise inherit the routine or account convention. Ask when source is ambiguous.'),
  sets:z.array(setShape).max(100).default([]),
  note:z.string().trim().max(NOTE_MAX).optional(),
  note_pin:z.boolean().default(false),
}).strict().superRefine((entry,ctx)=>{
  if(entry.mode==='custom'&&(entry.sets.length||entry.per_side||!entry.observations?.length))ctx.addIssue({code:'custom',message:'Custom activities use declared observations, not lifting sets.'});
  if(entry.mode==='climbing') {
    if(entry.sets.length||entry.per_side||!entry.routes?.length)ctx.addIssue({code:'custom',message:'Climbing uses routes, never lifting sets or per_side.'});
    else try{cleanClimbingRoutes(entry.routes);}catch(e){ctx.addIssue({code:'custom',message:e.message});}
  } else if(entry.routes)ctx.addIssue({code:'custom',message:'Routes require climbing mode.'});
  if(entry.mode==='cardio'&&entry.per_side)ctx.addIssue({code:'custom',path:['per_side'],message:'per_side does not apply to cardio'});
  for(const [i,set] of entry.sets.entries()) {
    try{validateActivitySet(set,entry.mode);}catch(e){ctx.addIssue({code:'custom',path:['sets',i],message:e.message});}
    if(entry.mode==='reps'&&set.reps==null)ctx.addIssue({code:'custom',path:['sets',i,'reps'],message:'reps is required for this exercise'});
    if(entry.mode==='time'&&set.seconds==null)ctx.addIssue({code:'custom',path:['sets',i,'seconds'],message:'seconds is required for this exercise'});
    if(entry.mode==='cardio'&&set.minutes==null&&set.elapsed_seconds==null)ctx.addIssue({code:'custom',path:['sets',i,'minutes'],message:'minutes is required for this exercise'});
    if(entry.mode!=='reps'&&set.reps!=null)ctx.addIssue({code:'custom',path:['sets',i,'reps'],message:'reps does not match this exercise mode'});
    if(entry.mode!=='time'&&set.seconds!=null)ctx.addIssue({code:'custom',path:['sets',i,'seconds'],message:'seconds does not match this exercise mode'});
    if(entry.mode!=='cardio'&&(set.minutes!=null||set.speed!=null||set.incline!=null))ctx.addIssue({code:'custom',path:['sets',i],message:'cardio fields do not match this exercise mode'});
    if(set.rir!=null&&set.rpe!=null)ctx.addIssue({code:'custom',path:['sets',i],message:'Use RIR or RPE for a set, not both'});
    if(set.type==='dropset'&&(!set.drops?.length||entry.mode!=='reps'||set.warmup))ctx.addIssue({code:'custom',path:['sets',i],message:'A dropset requires reps mode, at least one drop, and a working set.'});
    if(set.type==='restpause'&&(!set.clusters?.length||entry.mode!=='reps'||set.warmup||set.reps!==set.clusters.reduce((n,c)=>n+c.reps,0)))ctx.addIssue({code:'custom',path:['sets',i],message:'Rest-pause requires a reps working set, clusters including the initial burst, and reps equal to their total.'});
    if(set.clusters&&set.type!=='restpause')ctx.addIssue({code:'custom',path:['sets',i,'clusters'],message:'Use type=restpause with clusters.'});
    if(set.drops&&set.type!=='dropset')ctx.addIssue({code:'custom',path:['sets',i,'drops'],message:'Use type=dropset when supplying drops.'});
    if(set.drops){
      let prior=set.weight;
      if(prior==null)ctx.addIssue({code:'custom',path:['sets',i,'weight'],message:'Supply the main-set weight for a dropset.'});
      for(const [j,drop] of set.drops.entries()) {
        if(prior!=null&&drop.weight>=prior)ctx.addIssue({code:'custom',path:['sets',i,'drops',j,'weight'],message:'Each drop weight must be lower than the preceding load.'});
        prior=drop.weight;
      }
    }
  }
  if(entry.note_pin&&!entry.note?.trim())ctx.addIssue({code:'custom',path:['note_pin'],message:'A pinned note needs text'});
});
const exerciseNote=z.object({exercise_id:z.string().min(1).max(64),note:z.string().trim().max(NOTE_MAX).nullable(),operation:z.enum(['replace','append']).default('replace')}).strict();
export const workout=z.object({
  routine_id:z.string().min(1).max(64).optional(),
  name:z.string().trim().min(1).max(80).optional(),
  started_at:z.string().datetime({offset:true}).optional().describe('Only include when the note gives a real start time and timezone, for example 2026-10-15T19:10:00+08:00.'),
  duration_minutes:z.number().min(1).max(720).optional().describe('Only include together with started_at; duration without a known start time would distort history.'),
  session_note:z.string().trim().max(NOTE_MAX).optional(),
  exercises:z.array(loggedExercise).min(1).max(40),
}).strict().refine(w=>w.exercises.every(e=>['climbing','custom'].includes(e.mode)||e.sets.length>0),'Every exercise requires logged sets or climbing routes').refine(w=>w.duration_minutes==null||w.started_at!=null,
  'started_at is required when duration_minutes is supplied');
export const trainingUpdateShape={
  session_update:sessionUpdateSchema(loggedExercise,setShape).optional(),
  date:date.describe('The actual calendar date the workout happened, YYYY-MM-DD. Future dates are rejected.'),
  timezone:timeZone.optional().describe('User IANA timezone, e.g. Asia/Taipei. Optional for older clients: omitted values use the account reminder timezone, then the explicitly configured deployment default. The preview reports the resolved timezone and source. No server-clock timezone is guessed.'),
  workout_id:z.string().min(1).max(64).optional().describe('Existing workout ID to correct or delete; requires training:read as well as training:write. Omit to add a new workout.'),
  delete_workout:z.boolean().default(false).describe('Only true when the user explicitly requests deletion of workout_id; do not supply a replacement workout.'),
  day_note:z.string().trim().min(1).max(NOTE_MAX).nullable().optional().describe('Replace this date’s note text; pass null to clear the day note.'),
  day_note_tag:z.enum(['sick','travel','rest','injured']).nullable().optional().describe('Replace the day note tag; pass null to remove the tag. Include day_note too when keeping existing text.'),
  exercise_notes:z.array(exerciseNote).max(40).optional().describe('Standing notes for these exercises in future workouts. Use null to clear one.'),
  review_questions:z.array(z.string().trim().min(1).max(500)).max(10).optional().describe('Unresolved questions about this record: ambiguous wording, suspected typos, unusual values, unit or per-side conflicts, or inconsistencies with recent training. Do not silently correct or assume. Include each question before saving; a non-empty list disables direct save even if every required field is present.'),
  workout:workout.optional(),
  workout_patch:workoutPatchSchema.optional(),
  restore_version_id:z.string().min(1).max(64).optional(),
  context_notes:z.array(contextNoteSchema).min(1).max(30).optional(),
};
const trainingUpdateSchema=z.object(trainingUpdateShape).strict().superRefine((v,ctx)=>{
  if(!v.session_update&&!v.workout&&!v.workout_patch&&!v.restore_version_id&&!v.context_notes&&!v.delete_workout&&!Object.hasOwn(v,'day_note')&&!Object.hasOwn(v,'day_note_tag')&&!(v.exercise_notes||[]).length)
    ctx.addIssue({code:'custom',message:'Add a workout or at least one note change.'});
  if(v.day_note===null&&v.day_note_tag!=null)ctx.addIssue({code:'custom',path:['day_note_tag'],message:'A day tag needs a non-empty day note.'});
  if(v.exercise_notes?.some(e=>e.note===''))ctx.addIssue({code:'custom',path:['exercise_notes'],message:'Use null to clear an exercise note.'});
  if(v.exercise_notes){
    const ids=v.exercise_notes.map(x=>x.exercise_id);
    if(new Set(ids).size!==ids.length)ctx.addIssue({code:'custom',path:['exercise_notes'],message:'Each exercise can appear only once.'});
  }
  if(v.workout_patch&&(!v.workout_id||v.workout||v.delete_workout))ctx.addIssue({code:'custom',message:'workout_patch requires workout_id without replacement or deletion.'});
  if(v.restore_version_id&&(v.workout_id||v.workout||v.workout_patch||v.delete_workout||v.context_notes||v.exercise_notes||Object.hasOwn(v,'day_note')||Object.hasOwn(v,'day_note_tag')))ctx.addIssue({code:'custom',message:'Restore a training version separately from other changes.'});
  if(v.delete_workout&&(!v.workout_id||v.workout))ctx.addIssue({code:'custom',message:'Deletion requires workout_id without a replacement workout.'});
  if(v.workout_id&&!v.workout&&!v.workout_patch&&!v.delete_workout)ctx.addIssue({code:'custom',message:'Supply a complete replacement, workout_patch, or explicit deletion.'});
});

const customExercise=(s,id)=>(s.customEx||[]).find(x=>x?.id===id);
const exerciseName=(s,id)=>LIB_BY_ID.get(id)?.n||customExercise(s,id)?.n||customExercise(s,id)?.name||id;
const knownExercise=(s,id)=>LIB_BY_ID.has(id)||!!customExercise(s,id);
const cleanNote=value=>typeof value==='string'?value.trim().slice(0,NOTE_MAX):'';

export function makeSet(set,mode,exerciseId,s,perSide=false) {
  const catalogue=LIB_BY_ID.get(exerciseId),custom=customExercise(s,exerciseId);
  const weight=set.weight??(mode==='cardio'||catalogue?.eq==='body weight'||custom?.eq==='body weight'?0:null);
  if(weight==null)throw Error(`Weight is missing for ${exerciseName(s,exerciseId)}; ask the user instead of assuming it is body weight.`);
  const out={done:true,w:weight,phase:set.warmup?'warmup':'work',failure:set.failure};
  if(mode==='reps')out.r=set.reps;
  if(mode==='time')out.sec=set.seconds;
  if(mode==='cardio'){
    out.min=set.minutes ?? set.elapsed_seconds/60;
    if(set.speed!=null)out.speed=set.speed;
    if(set.incline!=null)out.incline=set.incline;
  }
  if(set.note)out.note=set.note;
  for(const key of Object.keys(activitySetFields))if(set[key]!=null)out[key]=structuredClone(set[key]);
  if(set.warmup)out.phase='warmup';
  if(set.failure)out.failure=true;
  if(set.rir!=null)out.rir=set.rir;
  if(set.rpe!=null)out.rpe=set.rpe;
  if(set.type==='dropset') {
    out.type='dropset';out.drops=set.drops.map(d=>({w:d.weight,r:d.reps}));
  }
  if(set.type==='restpause'){out.type='restpause';out.clusters=set.clusters.map(c=>({r:c.reps,restSec:c.rest_seconds}));}
  if(perSide&&mode==='reps') {
    const side={w:weight,r:set.reps,done:true,...(set.note?{note:set.note}:{}),...(set.rir!=null?{rir:set.rir}:{}),...(set.rpe!=null?{rpe:set.rpe}:{}),
      ...(out.drops?{type:'dropset',drops:out.drops}:{}),...(out.clusters?{type:'restpause',clusters:out.clusters}:{}),...(set.failure?{failure:true}:{}),...Object.fromEntries(Object.keys(activitySetFields).filter(k=>out[k]!=null).map(k=>[k,structuredClone(out[k])]))};
    out.sides={L:structuredClone(side),R:structuredClone(side)};
    delete out.drops;delete out.clusters;delete out.type;delete out.rep_segments;
    out.r=set.reps*2;
    delete out.rir;delete out.rpe;
  }
  return out;
}
const setSummary=(set,unit)=>{
  const drops=row=>(row.drops||[]).map(d=>` → ${d.w} ${unit} × ${d.r}`).join('')+(row.clusters?` (restpause bursts: ${row.clusters.map(c=>`${c.r} reps, rest before ${c.restSec}s`).join('; ')})`:'');
  if(set.sides&&JSON.stringify(set.sides.L)!==JSON.stringify(set.sides.R))return ['L','R'].map(side=>`${side}: ${set.sides[side].w} ${unit} × ${set.sides[side].r}${drops(set.sides[side])}${set.sides[side].rir!=null?`, RIR ${set.sides[side].rir}`:''}${set.sides[side].rpe!=null?`, RPE ${set.sides[side].rpe}`:''}`).join('; ');
  if(set.sides)return `${set.sides.L.w} ${unit} × ${set.sides.L.r}${drops(set.sides.L)} each side${set.sides.L.rir!=null?`, RIR ${set.sides.L.rir} each side`:''}${set.sides.L.rpe!=null?`, RPE ${set.sides.L.rpe} each side`:''}`;
  if(set.side)return `${set.w} ${unit} × ${set.sec} seconds (${set.side})`;
  if(set.r!=null)return `${set.w} ${unit} × ${set.r}${drops(set)}${set.type==='dropset'?' (dropset)':''}`;
  if(set.sec!=null)return `${set.w} ${unit} × ${set.sec} seconds`;
  return `${set.min} minutes${set.speed!=null?`, speed ${set.speed} km/h`:''}${set.incline!=null?`, incline ${set.incline}%`:''}`;
};
export function makeWorkout(s,input) {
  if(!input.workout)return null;
  const w=input.workout;
  const routine=w.routine_id?s.routines?.find(r=>r?.id===w.routine_id):null;
  if(w.routine_id&&!routine)throw Error('Routine ID not found; read the current plan and preview again.');
  for(const e of w.exercises)if(!knownExercise(s,e.exercise_id))throw Error('Unknown exercise ID; search the catalogue first.');
  const entries=w.exercises.map(e=>{
    const definitions=e.observations?cleanFieldDefinitions(customExercise(s,e.exercise_id)?.field_definitions||[]):null;
    const measurements=e.observations?{fields:definitions,observations:cleanObservations(e.observations,definitions)}:null;
    const loggedSets=e.sets.map(set=>makeSet(set,e.mode,e.exercise_id,s,e.per_side));
    const sets=e.per_side&&e.mode==='time'
      ? loggedSets.flatMap(set=>[{...set,side:'L'},{...set,side:'R'}])
      : loggedSets;
    const target={mode:e.mode,sets:e.sets.length,weight:sets[0]?.w||0,
      ...(e.mode==='reps'?{reps:sets[0]?.r}:e.mode==='time'?{sec:sets[0]?.sec}:e.mode==='cardio'?{min:sets[0]?.min}:{})};
    if(e.per_side)target.side=true;
    const routineEntry=routine?.ex?.find(x=>x?.id===e.exercise_id);
    target.dbLoad=e.db_load||dbLoadFor(s,routineEntry||e.exercise_id);
    const note=cleanNote(e.note);
    return {id:e.exercise_id,...(measurements?{measurements}:{}),...(e.mode==='custom'?{activity:{type:'custom'}}:{}),...(e.mode==='climbing'?{activity:{type:'climbing',routes:cleanClimbingRoutes(e.routes)}}:{}),sets,topW:Math.max(0,...sets.map(x=>Number(x.w)||0))||null,target,
      ...(routine?.excludeFromProgression?{noProg:true}:{}),
      ...(routineEntry?{rid:routine.id}:{}),...(note?{note}:{}),...(note&&e.note_pin?{notePin:true}:{})};
  });
  if(w.started_at&&!w.started_at.startsWith(input.date+'T'))
    throw Error('started_at must use the workout date shown in the preview.');
  const start=w.started_at?Date.parse(w.started_at):undefined;
  if(start!=null&&localToday(input.timezone,new Date(start))!==input.date)throw Error('started_at does not fall on the workout date in the supplied timezone.');
  const workout={id:random().slice(0,20),d:input.date,routineIds:routine?[routine.id]:[],routineId:routine?.id||null,
    name:w.name||routine?.name||'Freestyle',bw:null,entries,prs:[]};
  if(start!=null&&Number.isFinite(start)){workout.start=start;if(w.duration_minutes!=null)workout.end=start+w.duration_minutes*60000;}
  const note=cleanNote(w.session_note);if(note)workout.note=note;
  return workout;
}

function setSignature(s) {
  const fields=['w','r','sec','min','speed','incline','side','phase','rir','rpe','note',...Object.keys(activitySetFields)];
  return {...Object.fromEntries(fields.filter(k=>s?.[k]!=null).map(k=>[k,s[k]])),done:s?.done===true,failure:!!(s?.failure||s?.f),
    phase:s?.phase||(s?.warmup?'warmup':'work'),type:s?.sides?'straight':s?.type||'straight',drops:s?.drops||null,clusters:s?.clusters||null,
    sides:s?.sides?{L:setSignature(s.sides.L),R:setSignature(s.sides.R)}:null};
}
function signature(w) {
  return JSON.stringify({d:w?.d,name:w?.name||'',routineId:w?.routineId||null,note:w?.note||'',entries:(w?.entries||[]).map(e=>({id:e?.id,activity:e?.activity||null,measurements:e?.measurements||null,note:e?.note||'',notePin:!!e?.notePin,sets:(e.sets||[]).map(setSignature)}))});
}

export function appendTrainingUpdate(cur,draft) {
  let sessionResult=null;
  if(draft.trainingSessionUpdate) {
    sessionResult=transitionTrainingLog(cur,draft.trainingSessionUpdate);
    if(sessionResult.already_applied)return cur;
    draft={...draft,...(sessionResult.workout?{workout:sessionResult.workout}:{})};
  }
  if((cur._rev||0)!==draft.rev||(cur._wid||null)!==draft.wid)throw Error('Training data changed since preview. Read current data and preview again.');
  if(!Array.isArray(cur.workouts||[])||!Array.isArray(cur.routines||[]))throw Error('Training history is unavailable.');
  const savedAt=Date.now();
  const next=structuredClone(cur), now=Math.max(savedAt,highestStamp(cur)+1);
  if(sessionResult)next.trainingLogs={...next.trainingLogs,[sessionResult.session.id]:{...sessionResult.session,_ts:now}};
  if(!Array.isArray(next.workouts))next.workouts=[];
  const old=draft.workoutId?next.workouts.find(w=>w.id===draft.workoutId):null;
  if(draft.workoutId){
    if(!old&&!draft.restoreVersion)throw Error('Workout ID not found; read history and preview again.');
    if(draft.workout)for(const key of ['_f','_u'])if(old?.[key]!=null)draft.workout[key]=structuredClone(old[key]);
    next.workouts=next.workouts.filter(w=>w.id!==draft.workoutId);
  }
  if(draft.workout){
    const key=signature(draft.workout);
    if(next.workouts.some(w=>signature(w)===key))throw Error('This workout is already in the history. Read the date and preview again.');
    if(next.workouts.length>=10000)throw Error('Workout history limit reached.');
    const logged={...structuredClone(draft.workout),_ts:now,...(!draft.preserveWorkoutSource?{source:'agent'}:{})};
    // Server receipt time is independent of the workout time and the logical sync clock.
    if(!draft.workoutId)logged.pluginSavedAt=savedAt;
    else if(!draft.restoreVersion&&Number.isFinite(old?.pluginSavedAt))logged.pluginSavedAt=old.pluginSavedAt;
    const sortKey=w=>[w?.d||'',w?.start||0];
    const [day,start]=sortKey(logged);let at=next.workouts.length;
    while(at>0){const [priorDay,priorStart]=sortKey(next.workouts[at-1]);if(priorDay<day||(priorDay===day&&priorStart<=start))break;at--;}
    next.workouts.splice(at,0,logged);
    if(!draft.workoutId)refillAfter(next,logged,draft.timezone?localToday(draft.timezone):draft.date,now);
  }
  if(draft.changeDayNote){
    const clear=draft.dayNote==null&&!draft.dayNoteTag;
    next.dayNotes={...(next.dayNotes||{}),[draft.date]:clear?{_ts:now}:{...(draft.dayNoteTag?{tag:draft.dayNoteTag}:{}),...(draft.dayNote?{text:draft.dayNote}:{}),_ts:now}};
  }
  if(draft.exerciseNotes?.length){
    next.exNotes={...(next.exNotes||{})};
    for(const e of draft.exerciseNotes){if(e.note==null||!e.note)delete next.exNotes[e.exercise_id];else next.exNotes[e.exercise_id]=e.note;}
  }
  // Let openGym's normal sync-stamp rules record new entries and the changed note keys.
  // This is the same serialized writer process as PUT /api/data, so stale-phone conflict checks
  // and revision/wid bookkeeping remain active.
  if(draft.workout||draft.workoutId) {
    registerCustom(next.customEx||[]);
    try {reconcileWorkoutChange(next,draft.workoutId?(cur.workouts||[]).find(w=>w.id===draft.workoutId)||null:null,draft.workout?(next.workouts||[]).find(w=>w.id===draft.workout.id)||null:null);}
    finally {registerCustom([]);}
  }
  if(draft.contextNotes?.length) {
    next.trainingNotes={...(next.trainingNotes||{})};
    for(const n of draft.contextNotes)next.trainingNotes[n.id]={...structuredClone(n.after),_ts:now};
  }
  if(draft.bodyUpdate)applyBodyUpdate(next,draft.bodyUpdate);
  if(draft.nutritionUpdate)applyNutritionUpdate(next,draft.nutritionUpdate);
  if(draft.customExerciseUpdate)applyCustomExerciseUpdate(next,draft.customExerciseUpdate);
  recordTrainingVersion(cur,next,draft);
  stampPluginChange(cur,next);
  next._rev=(cur._rev||0)+1;
  next._wids=[...(Array.isArray(cur._wids)?cur._wids:[]),...(cur._wid?[cur._wid]:[])].filter(x=>typeof x==='string').slice(-50);
  next._wid=random().slice(0,16);
  return next;
}

export function createTraining({read,append,defaultTimezone=null,autoSaveUsers=directSaveUsers('TRAINING')}) {
  if(defaultTimezone!=null)timeZone.parse(defaultTimezone);
  const drafts=new Map();
  const prune=()=>{for(const [k,d] of drafts)if(d.exp<=Date.now())drafts.delete(k);};
  return {
    preview(user,grant,input){
      prune();
      if(drafts.size>=100||[...drafts.values()].filter(d=>d.uid===user.id&&!d.result).length>=10)throw Error('Too many pending previews; wait for expiry.');
      const parsed=trainingUpdateSchema.parse(input),s=read(user);
      const accountTimezone=timeZone.safeParse(s.reminder?.tz);
      const timezoneSource=parsed.timezone?'input':accountTimezone.success?'account_reminder':'deployment_default';
      parsed.timezone ||=accountTimezone.success?accountTimezone.data:defaultTimezone;
      if(!parsed.timezone)throw Error('Timezone is unavailable. Supply timezone after refreshing tools, set the account reminder timezone, or ask the operator to configure PLUGIN_DEFAULT_TIMEZONE. No changes made.');
      const latestIso=localToday(parsed.timezone);
      if(parsed.date>latestIso)throw Error('A workout or day note can only be recorded for today or an earlier local date.');
      if(parsed.session_update) {
        if(Object.keys(parsed).some(k=>!['date','timezone','session_update','review_questions'].includes(k)&&!(k==='delete_workout'&&parsed[k]===false)))throw Error('Session updates must be previewed separately from other training changes.');
        const prepared=prepareSessionChange(s,parsed,{makeWorkout,makeSet,loggedExercise});
        if(prepared.already_applied)return {already_applied:true,session:trainingLogBrief(prepared.session),instructions:'This exact request was already saved. Do not submit it again.'};
        if(Object.keys(s.trainingLogs||{}).length>=2000&&!s.trainingLogs?.[prepared.session.id])throw Error('Training session history limit reached.');
        const session=trainingLogBrief(prepared.session,prepared.workout);
        const reviewQuestions=parsed.review_questions||[],id=random(),summary=`Training log session ${prepared.session.id}, version ${prepared.session.version}. Date: ${parsed.date}, timezone: ${parsed.timezone}.\n${JSON.stringify({operations:prepared.change.operations,result:session})}`;
        if(summary.length>60000)throw Error('Preview exceeds 60000 characters; split session changes.');
        const d={summary,uid:user.id,grant,rev:s._rev||0,wid:s._wid||null,date:parsed.date,timezone:parsed.timezone,trainingSessionUpdate:prepared.change,exp:Date.now()+900000,result:null,reviewQuestions};
        drafts.set(id,d);
        const autoSave=permitsDirectSave(autoSaveUsers,user.id)&&!reviewQuestions.length&&!parsed.session_update.operations.some(o=>o.type==='cancel');
        return {draft_id:id,revision:d.rev,expires_in_seconds:900,confirmation_summary:summary,session,changes:prepared.change.operations,review_questions:reviewQuestions,authorization:{requires_user_confirmation:!autoSave,source:autoSave?directSaveSource(autoSaveUsers):'preview_confirmation',scope:'training_record'},instructions:reviewQuestions.length?'Resolve review_questions and preview again.':autoSave?'Save this clear user-reported session update with the exact summary, then report success.':'Show the changes and save only after explicit confirmation.'};
      }
      let realWorkout=makeWorkout(s,parsed);
      let existing=parsed.workout_id?(s.workouts||[]).find(w=>w.id===parsed.workout_id):null;
      if(parsed.workout_id&&!existing)throw Error('Workout ID not found in this account.');
      if(existing?.d!==undefined&&existing.d!==parsed.date)throw Error('Correction date must match the existing workout date; use a separate import to move it.');
      if(realWorkout&&existing)realWorkout.id=existing.id;
      if(parsed.workout_patch)realWorkout=patchWorkout(existing,parsed.workout_patch,parsed.timezone,latestIso);
      if(parsed.restore_version_id) {
        const version=(s.pluginTrainingHistory||[]).find(v=>v.id===parsed.restore_version_id);
        if(!version)throw Error('Training version ID not found in this account.');
        if(version.unit&&version.unit!==(s.unit||'kg'))throw Error('Account weight unit changed after this version; use targeted edits.');
        const current=(s.workouts||[]).find(w=>w.id===version.workout_id)||null;
        if(workoutFingerprint(current)!==version.after_hash)throw Error('Workout changed after this version; preview targeted edits instead.');
        if(parsed.date!==(version.before?.d||current?.d))throw Error('Restore date must match the original workout date.');
        existing=current;parsed.workout_id=version.workout_id;parsed.delete_workout=!version.before;realWorkout=structuredClone(version.before);
      }
      const contextNotes=prepareContextNotes(s,parsed.context_notes,knownExercise);
      const notes=(parsed.exercise_notes||[]).map(e=>{
        if(!knownExercise(s,e.exercise_id))throw Error('Unknown exercise ID; search the catalogue first.');
        const text=e.note==null?null:e.operation==='append'&&s.exNotes?.[e.exercise_id]?s.exNotes[e.exercise_id]+'\n'+e.note:e.note;
        if(text?.length>NOTE_MAX)throw Error('Appended standing note exceeds 500 characters.');
        return {exercise_id:e.exercise_id,note:text};
      });
      const previousDay=s.dayNotes?.[parsed.date];
      const dayNote=Object.hasOwn(parsed,'day_note')?parsed.day_note:previousDay?.text;
      const dayTag=Object.hasOwn(parsed,'day_note_tag')?parsed.day_note_tag:parsed.day_note===null?null:previousDay?.tag;
      if(dayTag&&!dayNote)throw Error('A day tag needs non-empty note text.');
      const dayBefore=previousDay?.text||previousDay?.tag?`${previousDay?.tag||''}${previousDay?.text?`${previousDay.tag?' · ':''}${previousDay.text}`:''}`:'none';
      let rotationAdvancement=null;
      if(realWorkout&&!parsed.workout_id) {
        const projected={...structuredClone(s),workouts:[...(s.workouts||[]),realWorkout]};
        if(refillAfter(projected,realWorkout,localToday(parsed.timezone),Date.now()))rotationAdvancement={routine_ids:projected.queue.ids,starts_on:projected.queue.startsOn};
      }
      const id=random(),summary=[`Update the authenticated openGym training record for ${parsed.date} (${parsed.timezone}; timezone source: ${timezoneSource}).`,
        ...(parsed.restore_version_id?[`Undo training version ${parsed.restore_version_id}; resulting record: ${JSON.stringify(publicWorkout(realWorkout))}.`]:[]),
        ...(parsed.workout_patch?[`Patch existing workout ${existing.id}: ${JSON.stringify(parsed.workout_patch)}; resulting record: ${JSON.stringify(publicWorkout(realWorkout))}.`]:[]),
        ...(existing?[`${parsed.delete_workout?'DELETE':'Replace'} existing workout ${existing.id}: ${JSON.stringify({name:existing.name,date:existing.d,entries:existing.entries,note:existing.note})}.`]:[]),
        ...(realWorkout?[`Log workout ${JSON.stringify(realWorkout.name)}${realWorkout.routineId?` from routine ${realWorkout.routineId}`:''}.`,...realWorkout.entries.flatMap(e=>[
          `- ${JSON.stringify(exerciseName(s,e.id))} [${e.id}], weight convention ${e.target.dbLoad}${e.note?`: note ${JSON.stringify(e.note)}`:''}`,
          ...(e.activity?.type==='climbing'?[`  Climbing routes: ${JSON.stringify(e.activity.routes)}`]:[]),...(e.measurements?[`  Measurements: ${JSON.stringify(e.measurements)}`]:[]),
          ...e.sets.map((set,i)=>`  Set ${i+1}: ${setSummary(set,s.unit||'kg')}${set.phase==='warmup'?' (warm-up)':''}${set.failure?' (failure)':''}${set.rir!=null?`, RIR ${set.rir}`:''}${set.rpe!=null?`, RPE ${set.rpe}`:''}${Object.keys(activitySetFields).some(k=>set[k]!=null)?`, observations ${JSON.stringify(Object.fromEntries(Object.keys(activitySetFields).filter(k=>set[k]!=null).map(k=>[k,set[k]])))}`:''}`)
        ]),...(parsed.workout?.started_at?[`Started at: ${parsed.workout.started_at}`]:[]),...(parsed.workout?.duration_minutes!=null?[`Duration: ${parsed.workout.duration_minutes} minutes`]:[])]:[]),
        ...(parsed.workout?.session_note?[`Workout note: ${JSON.stringify(parsed.workout.session_note)}`]:[]),
        ...(Object.hasOwn(parsed,'day_note')||Object.hasOwn(parsed,'day_note_tag')?[`Day note: ${dayBefore} → ${dayNote==null&&!dayTag?'clear':`${dayNote==null?'':JSON.stringify(dayNote)}${dayTag?` [${dayTag}]`:''}`}`]:[]),
        ...notes.map(e=>`Standing note for ${JSON.stringify(exerciseName(s,e.exercise_id))} [${e.exercise_id}]: ${s.exNotes?.[e.exercise_id]?JSON.stringify(s.exNotes[e.exercise_id]):'none'} → ${e.note==null?'clear':JSON.stringify(e.note)}.`),
        ...contextNotes.map(n=>`Context note: ${JSON.stringify(n.before)} → ${JSON.stringify(n.after)}.`),
        ...(rotationAdvancement?[`Completing this rotation pass advances to ${JSON.stringify(rotationAdvancement)} using App rules.`]:[]),
        'Routine templates and weekly schedule stay unchanged.'].join('\n');
      const d={summary,uid:user.id,grant,rev:s._rev||0,wid:s._wid||null,exp:Date.now()+15*60000,result:null,date:parsed.date,timezone:parsed.timezone,
        reviewQuestions:parsed.review_questions||[],workout:realWorkout,preserveWorkoutSource:!!parsed.workout_patch||!!parsed.restore_version_id,restoreVersion:!!parsed.restore_version_id,workoutId:parsed.workout_id,deleteWorkout:parsed.delete_workout,changeDayNote:Object.hasOwn(parsed,'day_note')||Object.hasOwn(parsed,'day_note_tag'),
        dayNote:dayNote,dayNoteTag:dayTag||null,exerciseNotes:notes,contextNotes};
      if(summary.length>60000)throw Error('Preview exceeds 60000 characters; split into smaller changes.');
      drafts.set(id,d);
      const reviewQuestions = parsed.review_questions || [];
      const autoSave = !reviewQuestions.length && permitsDirectSave(autoSaveUsers,user.id) && (!!realWorkout||notes.length>0||typeof parsed.day_note==='string') && !parsed.delete_workout && !parsed.restore_version_id && !contextNotes.length && !notes.some(n=>n.note==null) && parsed.day_note!==null && parsed.day_note_tag!==null;
      return {draft_id:id,expires_in_seconds:900,revision:d.rev,confirmation_summary:summary,
        review_questions:reviewQuestions,rotation_advancement:rotationAdvancement,
        authorization:{requires_user_confirmation:!autoSave,source:autoSave?directSaveSource(autoSaveUsers):'preview_confirmation',scope:'training_record'},
        timezone:parsed.timezone,timezone_source:timezoneSource,training_context:trainingContext(s),updates_context_notes:contextNotes.length,
        logs_workout:!!realWorkout,updates_day_note:d.changeDayNote,updates_exercise_notes:notes.length,
        replaces_workout_id:existing&&!parsed.delete_workout?existing.id:null,deletes_workout_id:parsed.delete_workout?existing.id:null,
        instructions:(reviewQuestions.length?'Ask the review_questions and resolve them with the user before saving. Do not call save_training_update yet; create a fresh preview with the clarified record. ':autoSave?'Direct-save policy is enabled for this account for reported training records and explicitly user-requested day/standing exercise notes, including mixed batches. Do not create standing notes from incidental observations; keep symptoms in the current workout unless the user explicitly asks for lasting context. Only when the user supplied a clear, complete and plausible record with no unresolved concerns, call save_training_update now with confirmed=true and the exact confirmation_summary, without asking for a separate confirmation reply. After save succeeds, summarize what was saved. Before saving, assess the original wording and relevant recent training, not just whether required fields are present. Ask a focused question for ambiguous wording, suspected typos, unexpected outliers, conflicting units or per-side conventions, or other inconsistencies. A complete record may still need clarification. Do not silently correct suspicious values, assume their intent, or treat unusual performance as necessarily wrong. The absence of review_questions is not proof the record is unambiguous. This preference does not authorize invented data or bypass host tool approval. ':'Show the exact date, every exercise and set, and all notes. Ask for explicit confirmation. Save only this draft after confirmation, copying confirmation_summary exactly. ')+
          'Weights use the account unit returned by get_current_plan; cardio speed is stored in km/h; do not infer missing values.'};
    },
    save(user,grant,id,confirmed,summary,scopes=null){
      prune();const d=drafts.get(id);
      if(!d||d.uid!==user.id||d.grant!==grant)throw Error('Preview expired or belongs to a different authorization; preview again.');
      if(scopes&&d.contextNotes?.length)requireScopes(scopes,['plan:write']);
      if(scopes&&d.workoutId)requireScopes(scopes,['training:read']);
      if(!confirmed)throw Error('Explicit user confirmation is required.');
      if(summary!==d.summary)throw Error('The confirmation summary must exactly match the preview; preview again if it is unavailable.');
      if(d.result)return {...d.result,already_saved:true};
      if(d.reviewQuestions?.length)throw Error('Resolve review_questions and preview again.');
      if(scopes&&d.trainingSessionUpdate)requireScopes(scopes,['training:read']);
      const next=append(user,d);
      if(d.trainingSessionUpdate) {
        const session=next.trainingLogs[d.trainingSessionUpdate.session_id];
        return d.result={saved:true,revision:next._rev,session:trainingLogBrief(session),workout_id:session.workout_id||null};
      }
      d.result={saved:true,revision:next._rev,date:d.date,...(d.workout?{workout_id:d.workout.id,workout_name:d.workout.name}:{}),
        day_note_updated:d.changeDayNote,exercise_notes_updated:d.exerciseNotes?.length||0,context_notes_updated:d.contextNotes?.length||0,
        ...(d.deleteWorkout?{deleted_workout_id:d.workoutId}:{}),
        instructions:'Open or refresh the paired app to sync this update.'};
      return d.result;
    }
  };
}
