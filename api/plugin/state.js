import crypto from 'node:crypto';
import { stampPut } from '../sync-stamps.js';
import { hash, random } from './store.js';
import { stampChange, highestStamp } from '../../frontend/src/lib/sync-merge.js';
// These are deliberate edits over an exact revision, like the current app. The
// legacy unstamped-writer compatibility path would resurrect cleared fields.
export function stampPluginChange(cur,next) {
  const now=Math.max(Date.now(),highestStamp(cur)+1);
  const previous=new Map((cur.workouts||[]).map(w=>[w.id,w]));
  for(const w of next.workouts||[]) {
    const old=previous.get(w.id);
    if(!old||JSON.stringify(old)!==JSON.stringify(w))w._ts=now;
  }
  stampChange(cur,next,now);
  stampPut(cur,next,{overRead:true,stamped:true,now});
}
// Sync metadata changes after stamping and must not invalidate a just-created version.
const unstamp=v=>JSON.parse(JSON.stringify(v,(k,value)=>['_ts','_f','_u'].includes(k)?undefined:value));
export const planSnapshot = s => ({unit:s.unit||'kg',routines:unstamp(s.routines||[]),week:structuredClone(s.week||{}),dayPlan:structuredClone(s.dayPlan||{})});
export function recordPlanVersion(cur,next,draft) {
  const before=planSnapshot(cur),after=planSnapshot(next);
  if(JSON.stringify(before)===JSON.stringify(after))return;
  const version={id:random().slice(0,20),at:new Date().toISOString(),source:'agent',revision:(cur._rev||0)+1,
    summary:draft.summary,before,after_hash:hash(JSON.stringify(after))};
  const history=[...(cur.pluginPlanHistory||[]),version].slice(-10);
  // Bounded snapshots travel in the ordinary encrypted data backups and sync.
  while(history.length>1 && Buffer.byteLength(JSON.stringify(history))>1024*1024)history.shift();
  if(Buffer.byteLength(JSON.stringify(history))>1024*1024)throw Error('Plan snapshot exceeds the version-history limit.');
  next.pluginPlanHistory=history;
}
// All callbacks are synchronous: compare and append run in the API's sole writer process.
export function appendPlan(cur, draft) {
  if ((cur._rev||0)!==draft.rev || (cur._wid||null)!==draft.wid) throw Error('Plan changed since preview. Read the current plan and preview again.');
  if (!Array.isArray(cur.routines||[]) || (cur.routines||[]).length+draft.routines.length>200) throw Error('Routine limit reached.');
  const next=structuredClone(cur);
  next.routines=[...(next.routines||[]),...structuredClone(draft.routines)];
  recordPlanVersion(cur,next,draft);
  stampPluginChange(cur,next);
  next._rev=(cur._rev||0)+1;
  next._wids=[...(Array.isArray(cur._wids)?cur._wids:[]),...(cur._wid?[cur._wid]:[])].filter(x=>typeof x==='string').slice(-50);
  next._wid=crypto.randomBytes(8).toString('hex');
  return next;
}

export function appendPlanEdit(cur,draft) {
  if((cur._rev||0)!==draft.rev||(cur._wid||null)!==draft.wid)throw Error('Plan changed since preview. Read the current plan and preview again.');
  if(!Array.isArray(cur.routines||[])||draft.routines.length>200)throw Error('Training template limit reached.');
  const next=structuredClone(cur);
  next.routines=structuredClone(draft.routines);
  if(draft.weekChanged)next.week=structuredClone(draft.week);
  if(draft.dayPlanChanged)next.dayPlan=structuredClone(draft.dayPlan);
  if(draft.profileChanged)next.coach={...(next.coach||{}),profile:structuredClone(draft.profile)};
  recordPlanVersion(cur,next,draft);
  stampPluginChange(cur,next);
  next._rev=(cur._rev||0)+1;
  next._wids=[...(Array.isArray(cur._wids)?cur._wids:[]),...(cur._wid?[cur._wid]:[])].filter(x=>typeof x==='string').slice(-50);
  next._wid=crypto.randomBytes(8).toString('hex');
  return next;
}
