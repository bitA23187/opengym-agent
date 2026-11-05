import { transitionTrainingLog,publicTrainingLog } from '../../frontend/src/lib/training-log.js';
import { cleanObservations } from '../../frontend/src/lib/activity-fields.js';
import { cleanClimbingRoutes } from '../../frontend/src/lib/activity-data.js';
import { syncSideAggregate } from '../../frontend/src/lib/workout-model.js';
import { hash } from './store.js';
import { localToday } from './reads-schema.js';
const toInput=s=>({weight:s.w,...(s.r!=null?{reps:s.r}:{}),...(s.sec!=null?{seconds:s.sec}:{}),...(s.min!=null?{minutes:s.min}:{}),
  type:s.type||'straight',warmup:s.phase==='warmup',failure:!!(s.failure||s.f),...Object.fromEntries(['speed','incline','rir','rpe','weight_source','value_source','rep_segments','distance_km','elapsed_seconds','incline_segments'].filter(k=>s[k]!=null).map(k=>[k,s[k]])),
  ...(s.drops?{drops:s.drops.map(d=>({weight:d.w,reps:d.r}))}:{}),...(s.clusters?{clusters:s.clusters.map(c=>({reps:c.r,rest_seconds:c.restSec}))}:{})});
export function prepareSessionChange(s,p,{makeWorkout,makeSet,loggedExercise}) {
  const raw=p.session_update,fingerprint=hash(JSON.stringify({date:p.date,timezone:p.timezone,...raw}));
  const change={session_id:raw.session_id,expected_version:raw.expected_version,idempotency_key:raw.idempotency_key,fingerprint,date:p.date,operations:[]};
  if(s.trainingLogs?.[raw.session_id]?.requests?.[raw.idempotency_key])return {change,...transitionTrainingLog(s,change)};
  let session=s.trainingLogs?.[raw.session_id]||null;
  for(const op of raw.operations) {
    let normalized=op;
    if(op.type==='start') {
      if(op.started_at&&Date.parse(op.started_at)>Date.now()+60000)throw Error('Start time cannot be in the future.');
      if(op.started_at&&localToday(p.timezone,new Date(op.started_at))!==p.date)throw Error('Start time must fall on the logging date in the supplied timezone.');
      const routine=op.routine_id?s.routines?.find(r=>r.id===op.routine_id):null;
      if(op.routine_id&&!routine)throw Error('Routine ID not found.');
      normalized={type:'start',workout:{id:'log_'+raw.session_id,d:p.date,name:op.name,routineId:op.routine_id||null,routineIds:op.routine_id?[op.routine_id]:[],entries:[],prs:[],...(op.started_at?{start:Date.parse(op.started_at)}:{})}};
    } else if(op.type==='append_exercise') {
      if(op.exercise.sets?.length)throw Error('Append an empty exercise first, then append sets with stable set IDs.');
      // Climbing can start with its first routes; resistance entries may start empty.
      const entry=makeWorkout(s,{date:p.date,workout:{exercises:[op.exercise]}}).entries[0];
      normalized={type:op.type,entry:{...entry,entry_id:op.entry_id}};
    } else if(op.type==='append_set'||op.type==='update_set') {
      const entry=session?.workout?.entries.find(e=>e.entry_id===op.entry_id);if(!entry)throw Error('Training entry ID not found.');
      let input=op.set,row,oldRow;
      if(op.type==='update_set') {
        const old=entry.sets.find(s=>s.set_id===op.set_id);oldRow=old;if(!old)throw Error('Training set ID not found.');
        if(!!old.sides!==!!op.side)throw Error('Specify a side exactly when updating a unilateral row.');
        input={...toInput(op.side?old.sides[op.side]:old),...op.fields};
        for(const k of ['rir','rpe'])if(input[k]===null)delete input[k];
        if(op.fields.elapsed_seconds!=null&&op.fields.minutes==null)input.minutes=op.fields.elapsed_seconds/60;
        if(op.fields.minutes!=null&&op.fields.elapsed_seconds==null)delete input.elapsed_seconds;
        if(input.type!=='dropset')delete input.drops;
        if(input.type!=='restpause')delete input.clusters;
        if(op.side) {
          loggedExercise.parse({exercise_id:entry.id,mode:entry.target.mode,sets:[input]});
          row=structuredClone(old);row.sides[op.side]=makeSet(input,entry.target.mode,entry.id,s,false);syncSideAggregate(row);
        }
      }
      if(!row) {
        const exercise=loggedExercise.parse({exercise_id:entry.id,mode:entry.target.mode,per_side:!!entry.target.side,sets:[input]});
        row=makeSet(exercise.sets[0],entry.target.mode,entry.id,s,!!entry.target.side);
      }
      if(entry.target.mode==='time'&&entry.target.side&&op.type==='append_set')normalized={type:op.type,entry_id:op.entry_id,sets:['L','R'].map(side=>({...row,side,set_id:op.set_id+'_'+side}))};
      else normalized={type:op.type,entry_id:op.entry_id,set:{...row,...(oldRow?.side?{side:oldRow.side}:{}),set_id:op.set_id}};
    } else if(op.type==='set_observations') {
      const entry=session?.workout?.entries.find(e=>e.entry_id===op.entry_id);if(!entry?.measurements)throw Error('Entry has no declared measurement fields.');
      normalized={...op,observations:cleanObservations(op.observations,entry.measurements.fields)};
    } else if(op.type==='finish'&&op.finished_at&&Date.parse(op.finished_at)>Date.now()+60000)throw Error('Finishing time cannot be in the future.');
    else if(op.type==='set_routes')normalized={...op,routes:cleanClimbingRoutes(op.routes)};
    change.operations.push(normalized);
    session=transitionTrainingLog(s,change).session;
  }
  return {change,...transitionTrainingLog(s,change)};
}
export function trainingLogBrief(session,finished=null) {
  const w=session.workout||finished;
  return {id:session.id,date:session.date,unit:session.unit,status:session.status,version:session.version,workout_id:session.workout_id||null,entry_count:w?.entries?.length??null,set_count:w?.entries?.reduce((n,e)=>n+(e.sets?.length||0),0)??null};
}
export function readTrainingLog(s,input) {
  if(input.session_id) {
    const session=s.trainingLogs?.[input.session_id];if(!session)throw Error('Training session ID not found in this account.');
    return {revision:s._rev||0,session:input.detail_level==='compact'?trainingLogBrief(session):publicTrainingLog(session)};
  }
  const all=Object.values(s.trainingLogs||{}).filter(v=>input.status==='all'||v.status===(input.status||'in_progress')).sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
  const offset=input.offset||0,limit=input.limit||20;
  return {revision:s._rev||0,total:all.length,sessions:all.slice(offset,offset+limit).map(s=>input.detail_level==='full'?publicTrainingLog(s):trainingLogBrief(s)),next_offset:offset+limit<all.length?offset+limit:null};
}
