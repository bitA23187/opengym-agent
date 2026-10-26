import { z } from 'zod';
import { isoDate,localToday } from './reads-schema.js';
import { modeOf } from '../../frontend/src/lib/history.js';
import { syncSideAggregate } from '../../frontend/src/lib/workout-model.js';
import { hash } from './store.js';

const setFields=z.object({weight:z.number().min(0).max(1500).optional(),reps:z.number().int().min(1).max(100).optional(),
  seconds:z.number().int().min(1).max(7200).optional(),minutes:z.number().positive().max(600).optional(),
  speed:z.number().min(0).max(1000).optional(),incline:z.number().min(-20).max(45).optional(),
  rir:z.number().min(0).max(10).nullable().optional(),rpe:z.number().min(0).max(10).nullable().optional(),failure:z.boolean().optional()}).strict()
  .refine(v=>Object.keys(v).length>0,'Provide set fields');
const noteFields={note:z.string().trim().min(1).max(500).nullable().optional(),note_mode:z.enum(['replace','append']).optional()};
export const workoutPatchSchema=z.object({
  date:isoDate.optional(),started_at:z.string().datetime({offset:true}).optional(),
  session_note:z.string().trim().min(1).max(500).nullable().optional(),note_mode:z.enum(['replace','append']).optional(),
  entry_notes:z.array(z.object({entry_index:z.number().int().min(0).max(100),...noteFields,note_pin:z.boolean().optional()}).strict()).min(1).max(40).optional(),
  set_edits:z.array(z.object({entry_index:z.number().int().min(0).max(100),set_index:z.number().int().min(0).max(100),side:z.enum(['L','R']).optional(),fields:setFields}).strict()).min(1).max(100).optional(),
}).strict().refine(v=>['date','started_at','session_note','entry_notes','set_edits'].some(k=>Object.hasOwn(v,k)),'Provide workout changes');
const note=(old,text,mode)=>{
  const result=text==null?null:mode==='append'&&old?old+'\n'+text:text;
  if(result?.length>500)throw Error('Appended note exceeds 500 characters.');
  return result;
};
export function patchWorkout(original,p,timezone,today) {
  const w=structuredClone(original);
  if(p.date) {
    if(p.date>today)throw Error('Cannot move a workout into the future.');
    if(p.date!==w.d&&w.start!=null&&!p.started_at)throw Error('Moving a timed workout requires its new exact started_at with timezone. Duration will be preserved.');
    w.d=p.date;
  }
  if(p.started_at) {
    const start=Date.parse(p.started_at);
    if(localToday(timezone,new Date(start))!==w.d)throw Error('started_at must fall on the resulting date in the supplied timezone.');
    const duration=w.end!=null&&w.start!=null?w.end-w.start:null;
    w.start=start;if(duration!=null)w.end=start+duration;
  }
  if(Object.hasOwn(p,'session_note')) {const n=note(w.note,p.session_note,p.note_mode);if(n==null)delete w.note;else w.note=n;}
  const seen=new Set();
  for(const n of p.entry_notes||[]) {
    if(seen.has(n.entry_index))throw Error('Each entry note may be edited only once.');seen.add(n.entry_index);
    const e=w.entries?.[n.entry_index];if(!e)throw Error('Workout entry index not found.');
    if(Object.hasOwn(n,'note')) {const text=note(e.note,n.note,n.note_mode);if(text==null){delete e.note;delete e.notePin;}else e.note=text;}
    if(n.note_pin!=null) {if(n.note_pin&&!e.note)throw Error('Pinned note needs text.');if(n.note_pin)e.notePin=true;else delete e.notePin;}
  }
  seen.clear();
  for(const edit of p.set_edits||[]) {
    const key=`${edit.entry_index}:${edit.set_index}:${edit.side||''}`;
    if(seen.has(key))throw Error('Each set/side can be edited only once.');seen.add(key);
    const e=w.entries?.[edit.entry_index],row=e?.sets?.[edit.set_index];if(!row)throw Error('Workout set index not found.');
    if(row.sides&&!edit.side||!row.sides&&edit.side)throw Error('Supply side=L or R exactly when correcting a unilateral reps row.');
    const mode=modeOf({...e.target,id:e.id}),f=edit.fields;
    if(f.reps!=null&&mode!=='reps'||f.seconds!=null&&mode!=='time'||['minutes','speed','incline'].some(k=>f[k]!=null)&&mode!=='cardio')throw Error('Set fields do not match the exercise logging mode.');
    const set=edit.side?row.sides[edit.side]:row;
    for(const [key,value] of Object.entries(f)) {
      const k=({weight:'w',reps:'r',seconds:'sec',minutes:'min'})[key]||key;
      if(value==null)delete set[k];else set[k]=value;
      if(key==='failure')delete set.f;
    }
    if(set.rir!=null&&set.rpe!=null)throw Error('Use either RIR or RPE; explicitly clear the other when switching.');
    if(edit.side)syncSideAggregate(row);
    if(set.drops?.length&&set.drops[0].w>=set.w)throw Error('A corrected dropset main load must exceed its first drop.');
    e.topW=Math.max(0,...e.sets.map(r=>Number(r.w)||0))||null;
  }
  if(p.set_edits?.length||p.date||p.started_at)w.prs=[];
  return w;
}
export const workoutFingerprint=w=>hash(JSON.stringify(w??null,(k,v)=>['_ts','_f','_u'].includes(k)?undefined:v));
export function recordTrainingVersion(cur,next,draft) {
  if(!draft.workout&&!draft.workoutId)return;
  const id=draft.workout?.id||draft.workoutId,before=(cur.workouts||[]).find(w=>w.id===id)||null,after=(next.workouts||[]).find(w=>w.id===id)||null;
  const history=[...(cur.pluginTrainingHistory||[]),{id:hash(`${Date.now()}:${draft.summary}:${next._wid||''}`).slice(0,20),workout_id:id,unit:cur.unit||'kg',at:new Date().toISOString(),summary:draft.summary,before:structuredClone(before),after_hash:workoutFingerprint(after)}].slice(-10);
  while(history.length>1&&Buffer.byteLength(JSON.stringify(history))>1024*1024)history.shift();
  if(Buffer.byteLength(JSON.stringify(history))>1024*1024)throw Error('Training undo history limit exceeded.');
  next.pluginTrainingHistory=history;
}
export function trainingVersions(s) {
  return (s.pluginTrainingHistory||[]).slice().reverse().map(v=>({id:v.id,workout_id:v.workout_id,at:v.at,summary:v.summary,can_undo:(!v.unit||v.unit===(s.unit||'kg'))&&workoutFingerprint((s.workouts||[]).find(w=>w.id===v.workout_id)||null)===v.after_hash}));
}

export const publicWorkout=w=>w?JSON.parse(JSON.stringify(w,(k,v)=>k==='bw'||['_ts','_f','_u'].includes(k)?undefined:v)):null;
