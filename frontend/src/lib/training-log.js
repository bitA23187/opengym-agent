// Agent drafts are separate from S.active and completed workouts. IDs never depend on array order.
export function transitionTrainingLog(S,change) {
  const previous=S.trainingLogs?.[change.session_id]
  const receipt=previous?.requests?.[change.idempotency_key]
  if(receipt) {
    if(receipt!==change.fingerprint)throw Error('Idempotency key was already used for different training changes.')
    return {session:structuredClone(previous),already_applied:true,workout:null}
  }
  if((previous?.version||0)!==change.expected_version)throw Error('Training session version conflict. Read the session and preview again.')
  if(previous?.unit&&previous.unit!==(S.unit||'kg')&&!change.operations.every(o=>o.type==='cancel'))throw Error('Account weight unit changed. Cancel this session and start a new one with explicit units.')
  if(previous&&previous.status!=='in_progress')throw Error('Training session is already closed.')
  if(Object.keys(previous?.requests||{}).length>=500)throw Error('Training session request limit reached.')
  let session=previous?structuredClone(previous):null,workout=null
  for(const op of change.operations) {
    if(op.type==='start') {
      if(session)throw Error('Training session already exists.')
      if(Object.values(S.trainingLogs||{}).filter(s=>s.status==='in_progress').length>=10)throw Error('Too many open training sessions.')
      session={schema_version:1,unit:S.unit||'kg',id:change.session_id,date:change.date,status:'in_progress',version:0,workout:structuredClone(op.workout),requests:{}}
    } else {
      if(!session||session.status!=='in_progress')throw Error('Start an open training session first.')
      if(session.date!==change.date)throw Error('Use the session’s original logging date.')
      const w=session.workout
      if(op.type==='append_exercise') {
        if(w.entries.length>=40||w.entries.some(e=>e.entry_id===op.entry.entry_id))throw Error('Exercise entry ID already exists or entry limit reached.')
        w.entries.push(structuredClone(op.entry))
      } else if(op.type==='append_set'||op.type==='update_set') {
        const e=w.entries.find(e=>e.entry_id===op.entry_id);if(!e)throw Error('Training entry ID not found.')
        if(['climbing','custom'].includes(e.activity?.type))throw Error('Use routes for climbing, not lifting sets.')
        if(op.type==='append_set') {
          const rows=op.sets||[op.set]
          if(e.sets.length+rows.length>100||rows.some(row=>e.sets.some(s=>s.set_id===row.set_id)))throw Error('Set ID already exists or set limit reached.')
          e.sets.push(...structuredClone(rows))
        } else {const index=e.sets.findIndex(s=>s.set_id===op.set.set_id);if(index<0)throw Error('Training set ID not found.');e.sets[index]=structuredClone(op.set)}
        e.target.sets=e.target.mode==='time'&&e.target.side?Math.ceil(e.sets.length/2):e.sets.length;e.topW=Math.max(0,...e.sets.map(s=>Number(s.w)||0))||null
      } else if(op.type==='set_observations') {
        const e=w.entries.find(e=>e.entry_id===op.entry_id);if(!e?.measurements)throw Error('Entry has no declared measurements.');
        e.measurements.observations=structuredClone(op.observations);
      } else if(op.type==='set_routes') {
        const e=w.entries.find(e=>e.entry_id===op.entry_id)
        if(e?.target?.mode!=='climbing')throw Error('Climbing entry ID not found.')
        e.activity={type:'climbing',routes:structuredClone(op.routes)}
      } else if(op.type==='set_note') {
        const target=op.entry_id?w.entries.find(e=>e.entry_id===op.entry_id):w
        if(!target)throw Error('Training entry ID not found.')
        const text=op.append&&target.note?target.note+'\n'+(op.note||''):op.note
        if(text?.length>500)throw Error('Note exceeds 500 characters.')
        if(text)target.note=text;else delete target.note
      } else if(op.type==='finish') {
        if(!w.entries.length||w.entries.some(e=>!['climbing','custom'].includes(e.activity?.type)&&!e.sets.length||e.activity?.type==='custom'&&!e.measurements?.observations?.length||e.activity?.type==='climbing'&&!e.activity.routes.length))throw Error('Every exercise needs actual sets or routes before finishing.')
        if(op.finished_at) {
          if(w.start==null||Date.parse(op.finished_at)<w.start)throw Error('Finishing time requires a known earlier start time.')
          w.end=Date.parse(op.finished_at)
        }
        workout=structuredClone(w);session.workout_id=w.id;session.status='completed';session.workout=null
      } else if(op.type==='cancel') {session.status='cancelled';session.workout=null}
      else throw Error('Unknown training session operation.')
    }
  }
  if(!session)throw Error('Start a training session first.')
  session.version=(previous?.version||0)+1
  session.requests={...session.requests,[change.idempotency_key]:change.fingerprint}
  return {session,workout,already_applied:false}
}
export const openTrainingLogs=S=>Object.values(S.trainingLogs||{}).filter(s=>s.status==='in_progress')
export const publicTrainingLog=s=>s?Object.fromEntries(Object.entries(s).filter(([k])=>!['requests','_ts'].includes(k))):null
