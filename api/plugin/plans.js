import { z } from 'zod';
import { LIB_BY_ID } from '../coach/core/library.js';
import { hash, random } from './store.js';
import { planSnapshot } from './state.js';
import { trainingContext } from './context.js';
import { cleanupSg } from '../../frontend/src/lib/history.js';
const advancedFields={reps_min:z.number().int().min(1).max(100),reps_max:z.number().int().min(1).max(100),
  sets_max:z.number().int().min(1).max(12),increment:z.number().positive().max(100),deload_factor:z.number().min(0.5).max(0.95),
  warmup_sets:z.number().int().min(0).max(5)};
const advancedMap={reps_min:'repsMin',reps_max:'repsMax',sets_max:'setsMax',increment:'inc',deload_factor:'deloadFactor',warmup_sets:'warmupSets'};
const exercise = z.object({
  ...Object.fromEntries(Object.entries(advancedFields).map(([k,v])=>[k,v.optional()])),
  exercise_id: z.string().min(1).max(64), sets: z.number().int().min(1).max(12),
  mode: z.enum(['reps', 'time', 'cardio']).default('reps'),
  reps: z.number().int().min(1).max(100).optional(),
  weight: z.number().min(0).max(1500).default(0),
  rest_seconds: z.number().int().min(0).max(900).default(90),
  seconds: z.number().int().min(1).max(3600).optional(),
  minutes: z.number().min(0.1).max(600).optional(),
  per_side: z.boolean().default(false),
  progression: z.enum(['off','linear','greyskull','double','triple','time']).optional(),
  db_load:z.enum(['as','each','total']).optional(),
  note: z.string().trim().max(500).optional(),
}).strict().superRefine((e, ctx) => {
  if (e.mode === 'cardio' && e.per_side) ctx.addIssue({ code: 'custom', message: 'per_side does not apply to cardio' });
  if (e.mode === 'reps' && e.reps == null) ctx.addIssue({ code: 'custom', message: 'reps required' });
  if (e.mode === 'time' && e.seconds == null) ctx.addIssue({ code: 'custom', message: 'seconds required' });
  if (e.mode === 'cardio' && e.minutes == null) ctx.addIssue({ code: 'custom', message: 'minutes required' });
});
export const planShape = {
  unit: z.enum(['kg', 'lb']),
  routines: z.array(z.object({ name: z.string().trim().min(1).max(80),
    exercises: z.array(exercise).min(1).max(25) }).strict()).min(1).max(8),
};
export const planSchema = z.object(planShape).strict();

const editFields = z.object({
  ...Object.fromEntries(Object.entries(advancedFields).map(([k,v])=>[k,v.nullable().optional()])),
  sets: z.number().int().min(1).max(12).optional(),
  reps: z.number().int().min(1).max(100).optional(),
  weight: z.number().min(0).max(1500).optional(),
  rest_seconds: z.number().int().min(0).max(900).optional(),
  seconds: z.number().int().min(1).max(3600).optional(),
  minutes: z.number().min(0.1).max(600).optional(),
  per_side: z.boolean().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  progression: z.enum(['off','linear','greyskull','double','triple','time']).nullable().optional(),
  db_load:z.enum(['as','each','total']).nullable().optional(),
}).strict().refine(v => Object.keys(v).length > 0, 'At least one exercise field is required');
const renameRoutineOperation = z.object({ type:z.literal('rename_routine'), name:z.string().trim().min(1).max(80) }).strict();
const updateExerciseOperation = z.object({ type:z.literal('update_exercise'), index:z.number().int().min(0).max(49), fields:editFields }).strict();
const swapExerciseOperation = z.object({ type:z.literal('swap_exercise'), index:z.number().int().min(0).max(49), exercise_id:z.string().min(1).max(64) }).strict();
const removeExerciseOperation = z.object({ type:z.literal('remove_exercise'), index:z.number().int().min(0).max(49) }).strict();
const weekdayOperation = z.object({ type:z.literal('set_weekday'), weekday:z.number().int().min(0).max(6), routine_ids:z.array(z.string().min(1).max(64)).max(8).refine(ids=>new Set(ids).size===ids.length,'Routine IDs must be unique') }).strict();
const dateOperation = z.object({ type:z.literal('set_date'), date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/), routine_id:z.string().min(1).max(64).nullable() }).strict();
export const trainingProfileSchema=z.object({
  goal:z.string().trim().min(1).max(80),experience:z.string().trim().min(1).max(80),daysPerWeek:z.number().int().min(1).max(7),
  preferredDays:z.array(z.number().int().min(0).max(6)).max(7),sessionMin:z.number().int().min(1).max(240),
  equipment:z.array(z.string().trim().min(1).max(80)).max(40),limitations:z.string().trim().max(600),
  likes:z.string().trim().max(300),dislikes:z.string().trim().max(300),notes:z.string().trim().max(600),
}).strict();

const validExerciseId = (s, id) => LIB_BY_ID.has(id) || (s.customEx || []).some(e => e?.id === id && e.archived !== true);
const isCardioId = (s,id) => (LIB_BY_ID.get(id)?.bp || (s.customEx||[]).find(e=>e?.id===id)?.bp) === 'cardio';
const exerciseName = (s, id) => {
  const custom = (s.customEx || []).find(e => e?.id === id && e.archived !== true);
  return LIB_BY_ID.get(id)?.n || custom?.n || custom?.name || id;
};
const internalExercise = e => ({ id:e.exercise_id, sets:e.sets, mode:e.mode,
  ...Object.fromEntries(Object.entries(advancedMap).filter(([k])=>e[k]!=null).map(([k,v])=>[v,e[k]*(['reps_min','reps_max'].includes(k)&&e.per_side?2:1)])),
  ...(e.mode==='reps'?{reps:e.reps*(e.per_side?2:1)}:e.mode==='time'?{sec:e.seconds}:{min:e.minutes}),
  weight:e.weight, restSec:e.rest_seconds, ...(e.per_side?{side:true}:{}), ...(e.progression?{prog:e.progression}:{}), ...(e.db_load?{dbLoad:e.db_load}:{}), ...(e.note?{note:e.note}:{}) });
const dateValid = value => {
  const d = new Date(value+'T12:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value;
};

const addExerciseOperation = z.object({ type:z.literal('add_exercise'), after_index:z.number().int().min(-1).max(49).optional(), exercise:exercise }).strict();
const editOperation = z.discriminatedUnion('type', [
  renameRoutineOperation, updateExerciseOperation, swapExerciseOperation, addExerciseOperation,
  removeExerciseOperation, weekdayOperation, dateOperation,
  z.object({type:z.literal('move_exercise'),index:z.number().int().min(0).max(49),to_index:z.number().int().min(0).max(49)}).strict(),
  z.object({type:z.literal('set_superset'),indexes:z.array(z.number().int().min(0).max(49)).min(1).max(10),enabled:z.boolean(),name:z.string().trim().max(80).optional(),rest_seconds:z.number().int().min(0).max(900).optional()}).strict(),
]);
const routineEdits = z.object({routine_id:z.string().min(1).max(64),operations:z.array(editOperation).min(1).max(32)}).strict();
export const planEditShape={routine_id:z.string().min(1).max(64).optional(),operations:z.array(editOperation).min(1).max(32).optional(),
  routine_edits:z.array(routineEdits).min(1).max(8).optional(),training_profile:trainingProfileSchema.optional(),
  restore_version_id:z.string().min(1).max(64).optional()};
const planEditInput = z.object(planEditShape).strict().refine(v=>v.operations||v.routine_edits||v.training_profile||v.restore_version_id,'Provide edits, a training profile or a restore version')
  .refine(v=>!v.restore_version_id||(!v.operations&&!v.routine_edits&&!v.training_profile),'Restore must be previewed separately from other edits');

function applySinglePlanEdit(s, parsed) {
  if (!Array.isArray(s.routines)) throw Error('Training templates are unavailable.');
  const routineIndex=s.routines.findIndex(r=>r?.id===parsed.routine_id);
  const editsRoutine=parsed.operations.some(op=>!['set_weekday','set_date'].includes(op.type));
  if (editsRoutine && routineIndex<0) throw Error('Routine ID not found; read the current plan and preview again.');
  const routines=structuredClone(s.routines), routine=routines[routineIndex];
  if (editsRoutine && !Array.isArray(routine.ex)) throw Error('The selected routine has no editable exercise list.');
  const week=structuredClone(s.week||{}), dayPlan=structuredClone(s.dayPlan||{}), summaries=[];
  let weekChanged=false,dayPlanChanged=false;
  for (const op of parsed.operations) {
    if (op.type==='rename_routine') {
      summaries.push(`Rename routine ${JSON.stringify(routine.name||'')} → ${JSON.stringify(op.name)}.`);
      routine.name=op.name;
    } else if (op.type==='update_exercise') {
      const old=routine.ex[op.index]; if(!old)throw Error(`Exercise index ${op.index} does not exist in the selected routine.`);
      const updated={...old};
      const mode=old.mode||(isCardioId(s,old.id)?'cardio':'reps');
      const f=op.fields;
      for(const [key,field] of Object.entries(advancedMap))if(Object.hasOwn(f,key)) {
        if(f[key]==null)delete updated[field];else updated[field]=f[key];
      }
      if(Object.hasOwn(f,'progression')) {
        if(f.progression==null)delete updated.prog;
        else { validateProgression(mode,f.progression);updated.prog=f.progression; }
      }
      if(Object.hasOwn(f,'db_load'))updated.dbLoad=f.db_load;
      if(f.reps!=null && mode!=='reps')throw Error('Reps can only be edited on a repetitions-based exercise.');
      if(f.seconds!=null && mode!=='time')throw Error('Seconds can only be edited on a timed exercise.');
      if(f.minutes!=null && mode!=='cardio')throw Error('Minutes can only be edited on a cardio exercise.');
      if(f.per_side!=null && mode==='cardio')throw Error('Per-side does not apply to cardio.');
      const map={sets:'sets',reps:'reps',weight:'weight',rest_seconds:'restSec',seconds:'sec',minutes:'min',per_side:'side'};
      for(const [from,to] of Object.entries(map)) if(Object.hasOwn(f,from)) {
        const value=from==='per_side'?(f[from]?true:undefined):f[from];
        if(value===undefined)delete updated[to];else updated[to]=value;
      }
      // Tool reps always mean each limb for unilateral work; the app stores L+R.
      if(mode==='reps' && f.reps!=null)updated.reps=f.reps*(updated.side?2:1);
      for(const key of ['reps_min','reps_max'])if(f[key]!=null&&updated.side)updated[advancedMap[key]]=f[key]*2;
      if(mode==='reps'&&!!old.side!==!!updated.side)for(const key of ['reps','repsMin','repsMax']) {
        const input=key==='reps'?'reps':key==='repsMin'?'reps_min':'reps_max';
        if(!Object.hasOwn(f,input)&&updated[key]!=null)updated[key]*=updated.side?2:0.5;
      }
      validateConfig({...updated,mode});
      if(Object.hasOwn(f,'note')) {if(f.note==null||!f.note)delete updated.note;else updated.note=f.note;}
      summaries.push(`Update ${exerciseName(s,old.id)} [index ${op.index}]: ${JSON.stringify(old)} → ${JSON.stringify(updated)}.`);
      routine.ex[op.index]=updated;
    } else if(op.type==='swap_exercise') {
      const old=routine.ex[op.index];if(!old)throw Error(`Exercise index ${op.index} does not exist in the selected routine.`);
      if(!validExerciseId(s,op.exercise_id))throw Error('Unknown exercise ID; search the catalogue first.');
      const oldCardio=(old.mode|| (isCardioId(s,old.id)?'cardio':'reps'))==='cardio';
      if(oldCardio!==isCardioId(s,op.exercise_id))throw Error('A cardio exercise can only be swapped with another cardio exercise. Remove and add an exercise to change mode.');
      const updated={...old,id:op.exercise_id};
      summaries.push(`Replace ${exerciseName(s,old.id)} with ${exerciseName(s,op.exercise_id)} at index ${op.index}; keep its other settings.`);
      routine.ex[op.index]=updated;
    } else if(op.type==='add_exercise') {
      if(!validExerciseId(s,op.exercise.exercise_id))throw Error('Unknown exercise ID; search the catalogue first.');
      if(routine.ex.length>=50)throw Error('Routine exercise limit reached.');
      const at=op.after_index==null?routine.ex.length:op.after_index+1;
      if(at>routine.ex.length)throw Error('after_index is outside the current routine.');
      const added=internalExercise(op.exercise);
      validateProgression(op.exercise.mode,op.exercise.progression);
      routine.ex.splice(at,0,added);
      summaries.push(`Add ${exerciseName(s,added.id)} [${added.id}] at position ${at+1}: ${JSON.stringify(added)}.`);
    } else if(op.type==='remove_exercise') {
      const old=routine.ex[op.index];if(!old)throw Error(`Exercise index ${op.index} does not exist in the selected routine.`);
      routine.ex.splice(op.index,1);
      summaries.push(`Remove ${exerciseName(s,old.id)} [${old.id}] at index ${op.index}.`);
    } else if(op.type==='move_exercise') {
      if(!routine.ex[op.index]||!routine.ex[op.to_index])throw Error('Exercise index not found.');
      const [item]=routine.ex.splice(op.index,1);routine.ex.splice(op.to_index,0,item);cleanupSg(routine.ex);
      summaries.push(`Move exercise ${op.index} to ${op.to_index}; resulting order: ${JSON.stringify(routine.ex)}.`);
    } else if(op.type==='set_superset') {
      const indexes=[...new Set(op.indexes)].sort((a,b)=>a-b);
      if(indexes.length!==op.indexes.length||indexes.some(i=>!routine.ex[i]))throw Error('Superset indexes must be unique existing entries.');
      if(op.enabled&&(indexes.length<2||indexes.some((x,i)=>i&&x!==indexes[i-1]+1)))throw Error('A superset needs at least two adjacent exercises.');
      const sg='sg_'+random().slice(0,12);
      for(const i of indexes) {
        const e=routine.ex[i];for(const key of ['sg','sgName','sgRest'])delete e[key];
        if(op.enabled){e.sg=sg;if(op.name)e.sgName=op.name;if(op.rest_seconds!=null)e.sgRest=op.rest_seconds;}
      }
      cleanupSg(routine.ex);summaries.push(`Set superset: ${JSON.stringify(op)}; resulting exercises: ${JSON.stringify(routine.ex)}.`);
    } else if(op.type==='set_weekday') {
      for(const id of op.routine_ids)if(!s.routines.some(r=>r?.id===id))throw Error(`Routine ${id} does not exist; read the current plan and preview again.`);
      const before=week[op.weekday];
      if(!op.routine_ids.length)delete week[op.weekday];
      else week[op.weekday]=op.routine_ids.length===1?op.routine_ids[0]:op.routine_ids;
      weekChanged=true;
      summaries.push(`Set weekly weekday ${op.weekday} from ${JSON.stringify(before??null)} to ${JSON.stringify(week[op.weekday]??null)}.`);
    } else if(op.type==='set_date') {
      if(!dateValid(op.date))throw Error('Date must be a real YYYY-MM-DD date.');
      if(op.routine_id!==null && op.routine_id!=='rest' && !s.routines.some(r=>r?.id===op.routine_id))throw Error(`Routine ${op.routine_id} does not exist; read the current plan and preview again.`);
      const before=dayPlan[op.date];
      if(op.routine_id===null)delete dayPlan[op.date];else dayPlan[op.date]=op.routine_id;
      dayPlanChanged=true;
      summaries.push(`Set date ${op.date} from ${JSON.stringify(before??null)} to ${JSON.stringify(dayPlan[op.date]??null)}.`);
    }
  }
  if(editsRoutine && routine.ex.length<1)throw Error('A routine must keep at least one exercise.');
  if(editsRoutine)cleanupSg(routine.ex);
  return {routine_id:parsed.routine_id,routines,week,dayPlan,weekChanged,dayPlanChanged,summaries};
}

function validateProgression(mode, policy) {
  const allowed=mode==='reps'?['off','linear','greyskull','double','triple']:mode==='time'?['off','time']:['off'];
  if(policy && !allowed.includes(policy))throw Error('Progression policy is incompatible with the exercise mode.');
}
function validateConfig(e) {
  const mode=e.mode||'reps';validateProgression(mode,e.prog);
  if(mode!=='reps'&&['repsMin','repsMax','setsMax'].some(k=>e[k]!=null))throw Error('Rep ranges and set ceilings require reps mode.');
  if(['reps','repsMin','repsMax'].some(k=>e[k]!=null&&(!Number.isInteger(e[k])||e[k]<1||e.side&&e[k]%2!==0)))throw Error('Rep targets must be whole counts for each limb; supply explicit reps/ranges.');
  if(e.repsMin!=null&&e.repsMin>e.reps)throw Error('reps_min must not exceed reps (the upper target).');
  if(e.repsMax!=null&&e.repsMax<(e.repsMin||e.reps||1))throw Error('reps_max must not be below the lower target.');
  if(e.setsMax!=null&&e.setsMax<e.sets)throw Error('sets_max must not be below sets.');
}
function applyPlanEdits(s,input) {
  const parsed=planEditInput.parse(input);
  if(parsed.restore_version_id) {
    const version=(s.pluginPlanHistory||[]).find(v=>v.id===parsed.restore_version_id);
    if(!version)throw Error('Plan version not found.');
    if(hash(JSON.stringify(planSnapshot(s)))!==version.after_hash)throw Error('Plan changed after this version; preview targeted edits instead of overwriting newer changes.');
    return {routine_id:null,...structuredClone(version.before),restoring:true,weekChanged:true,dayPlanChanged:true,
      summaries:[`Undo plan version ${version.id}: ${version.summary}`,`Restore routines and schedules to the snapshot before ${version.at}. Training history and training profile stay unchanged.`]};
  }
  let next=s, summaries=[],weekChanged=false,dayPlanChanged=false;
  const groups=[...(parsed.operations?[{routine_id:parsed.routine_id,operations:parsed.operations}]:[]),...(parsed.routine_edits||[])];
  if(groups.reduce((n,g)=>n+g.operations.length,0)>64)throw Error('At most 64 operations per plan revision.');
  for(const group of groups) {
    const edit=applySinglePlanEdit(next,group);
    next={...next,routines:edit.routines,week:edit.week,dayPlan:edit.dayPlan};
    summaries.push(...edit.summaries);weekChanged ||=edit.weekChanged;dayPlanChanged ||=edit.dayPlanChanged;
  }
  if(parsed.training_profile)summaries.push(`Training profile: ${JSON.stringify(s.coach?.profile||null)} → ${JSON.stringify(parsed.training_profile)}.`);
  return {routine_id:parsed.routine_id||null,routines:next.routines||[],week:next.week||{},dayPlan:next.dayPlan||{},weekChanged,dayPlanChanged,summaries,
    profileChanged:!!parsed.training_profile,profile:parsed.training_profile};
}

export function createPlans({ read, append }) {
  const drafts = new Map();
  const prune = () => { for (const [k, d] of drafts) if (d.exp <= Date.now()) drafts.delete(k); };
  return {
    current(user) {
      const s = read(user);
      return { unit: s.unit || 'kg', revision: s._rev || 0,
        training_context:trainingContext(s),
        routines: (s.routines || []).map(r => ({ id: r.id, name: r.name, exercises: (r.ex||[]).map((e,index)=>({...e,index})) })),
        week: s.week || {}, speed_unit: s.speedUnit==='mph'?'mph':s.speedUnit==='kmh'?'km/h':(s.unit||'kg')==='lb'?'mph':'km/h',
        day_overrides:s.dayPlan||{}, rotation:s.rotation||null, queue:s.queue||null, schedule_mode:s.scheduleMode||'week',
        reps_convention:'Stored reps are the total across both sides when side=true. In preview tools, reps mean each side when per_side=true.',
        training_profile:s.coach?.profile?Object.fromEntries(Object.keys(trainingProfileSchema.shape).filter(k=>s.coach.profile[k]!=null).map(k=>[k,s.coach.profile[k]])):null,
        custom_exercises: s.customEx || [] };
    },
    versions(user) {
      const s=read(user),fingerprint=hash(JSON.stringify(planSnapshot(s)));
      return {revision:s._rev||0,versions:(s.pluginPlanHistory||[]).slice().reverse().map(v=>({id:v.id,at:v.at,source:v.source,revision:v.revision,summary:v.summary,can_undo:v.after_hash===fingerprint})),
        retention:'Last 10 Agent plan changes, up to 1 MiB. Undo only while the current plan matches that version; preview and confirm first.'};
    },
    preview(user, grant, input) {
      prune();
      if (drafts.size >= 100 || [...drafts.values()].filter(d => d.uid === user.id && !d.result).length >= 10) throw Error('Too many pending previews; wait for expiry.');
      const plan = planSchema.parse(input), s = read(user);
      if ((s.unit || 'kg') !== plan.unit) throw Error('Use the account weight unit returned by get_current_plan.');
      const custom = new Set((s.customEx || []).filter(e=>e.archived!==true).map(e => e.id));
      for (const r of plan.routines) for (const e of r.exercises) {
        if (!LIB_BY_ID.has(e.exercise_id) && !custom.has(e.exercise_id)) throw Error('Unknown exercise ID; search the catalogue first.');
        validateProgression(e.mode,e.progression);
        validateConfig(internalExercise(e));
      }
      const id = random();
      const routines = plan.routines.map((r, i) => ({ id: 'p_' + hash(id + ':' + i).slice(0, 20), name: r.name,
        ex: r.exercises.map(internalExercise) }));
      const summary = [
        `Add ${routines.length} training template(s) to the authenticated openGym account. Weight unit: ${plan.unit}. Existing templates, weekly schedule, workout history and body weight stay unchanged.`,
        ...plan.routines.flatMap((r,i)=>[`${i+1}. ${JSON.stringify(r.name)}`,
          ...r.exercises.map(e=> {
            const customExercise=(s.customEx||[]).find(x=>x.id===e.exercise_id);
            const name=LIB_BY_ID.get(e.exercise_id)?.n||customExercise?.n||customExercise?.name||e.exercise_id;
            const target=e.mode==='reps'?`${e.reps} reps`:e.mode==='time'?`${e.seconds} seconds`:`${e.minutes} minutes`;
            return `- ${JSON.stringify(String(name).slice(0,160))} [${e.exercise_id}]: ${e.sets} sets x ${target}, weight ${e.weight} ${plan.unit}, weight convention ${e.db_load||'account default'}, rest ${e.rest_seconds} seconds${e.per_side?', per side':''}, progression ${e.progression||'app default'}${e.note?`, note ${JSON.stringify(e.note)}`:''}; complete settings ${JSON.stringify(e)}`;
          })])
      ].join('\n');
      if(summary.length>60000)throw Error('Preview exceeds 60000 characters; split the changes.');
      const draft = { kind:'plan_add', summary, uid: user.id, grant, routines, rev: s._rev || 0, wid: s._wid || null, exp: Date.now() + 15 * 60000, result: null };
      drafts.set(id, draft);
      return { draft_id: id, expires_in_seconds: 900, revision: draft.rev, unit: plan.unit,
        training_context:trainingContext(s),
        confirmation_summary: summary, adds_routines: routines, existing_routines_unchanged: true, weekly_schedule_unchanged: true,
        instructions: 'Show this exact preview to the user. Call save_plan only after explicit confirmation, copying confirmation_summary exactly into its arguments. If host approval is blocked, report it; do not retry through another channel. Weights use the account/app convention; clarify per-hand and per-side assumptions.' };
    },
    save(user, grant, id, confirmed, summary) {
      prune();
      const d = drafts.get(id);
      if (!d || d.kind!=='plan_add' || d.uid !== user.id || d.grant !== grant) throw Error('Preview expired or belongs to a different authorization; preview again.');
      if (!confirmed) throw Error('Explicit user confirmation is required.');
      if (summary !== d.summary) throw Error('The confirmation summary must exactly match the preview; preview again if it is unavailable.');
      if (d.result) return { ...d.result, already_saved: true };
      d.result = append(user, d);
      return d.result;
    },
    previewEdit(user, grant, input) {
      prune();
      if (drafts.size >= 100 || [...drafts.values()].filter(d => d.uid === user.id && !d.result).length >= 10) throw Error('Too many pending previews; wait for expiry.');
      const s=read(user), edit=applyPlanEdits(s,input), id=random();
      const summary=[`Modify the authenticated openGym plan at revision ${s._rev||0}, weight unit ${s.unit||'kg'}. Changes take effect immediately after saving. No workout history, body weight or account data will be changed.`,...edit.summaries].join('\n');
      if(summary.length>60000)throw Error('Preview exceeds 60000 characters; split the changes.');
      const draft={kind:'plan_edit',summary,uid:user.id,grant,routine_id:edit.routine_id,routines:edit.routines,week:edit.week,dayPlan:edit.dayPlan,
        weekChanged:edit.weekChanged,dayPlanChanged:edit.dayPlanChanged,profileChanged:edit.profileChanged,profile:edit.profile,restoring:edit.restoring,
        rev:s._rev||0,wid:s._wid||null,exp:Date.now()+15*60000,result:null};
      drafts.set(id,draft);
      return {draft_id:id,expires_in_seconds:900,revision:draft.rev,confirmation_summary:summary,changes:edit.summaries,
        training_context:trainingContext(s),
        resulting_plan:{routines:edit.routines,week:edit.week,day_overrides:edit.dayPlan},
        instructions:'Show the complete preview and ask the user to confirm. Save only this draft after explicit confirmation, copying confirmation_summary exactly. Routine exercise indexes refer to list order when each operation runs.'};
    },
    saveEdit(user, grant, id, confirmed, summary, appendEdit) {
      prune();
      const d=drafts.get(id);
      if(!d||d.kind!=='plan_edit'||d.uid!==user.id||d.grant!==grant)throw Error('Preview expired or belongs to a different authorization; preview again.');
      if(!confirmed)throw Error('Explicit user confirmation is required.');
      if(summary!==d.summary)throw Error('The confirmation summary must exactly match the preview; preview again if it is unavailable.');
      if(d.result)return {...d.result,already_saved:true};
      d.result=appendEdit(user,d);return d.result;
    },
  };
}
