import { workoutVolume,bestWeightForEntry } from '../../frontend/src/lib/history.js';
import { beatsWeight } from '../../frontend/src/lib/exercises.js';
import { rebuildPrHistory } from '../../frontend/src/lib/workout-date.js';

const list=v=>Array.isArray(v)?v:[];
function bestIn(workout,id) {
  let best=0;
  for(const e of list(workout?.entries))if(e?.id===id) {
    const weight=bestWeightForEntry(e);if(beatsWeight(id,weight,best))best=weight;
  }
  return best;
}
// Uses upstream calculators without changing the shared mobile/web source. The kept-load
// rule follows the 1.4.1 editor: only lower a confirmed load supplied by the corrected record.
export function reconcileWorkoutChange(state,current,record) {
  if(record)record.vol=workoutVolume(record);
  const ids=[...new Set([...list(current?.entries),...list(record?.entries)].map(e=>e?.id).filter(id=>id!=null))];
  state.workouts=rebuildPrHistory(state.workouts,ids,current?record:null);
  const saved=record?state.workouts.find(w=>w.id===record.id):null;
  if(current)for(const id of ids) {
    const kept=state.exWeights?.[id],before=bestIn(current,id);
    if(!kept||!(kept.w>0)||kept.w!==before||!beatsWeight(id,before,bestIn(saved,id)))continue;
    let best=null;
    for(const w of state.workouts){const top=bestIn(w,id);if(beatsWeight(id,top,best?.w||0))best={w:top,d:w.d};}
    if(best)state.exWeights[id]=best;else delete state.exWeights[id];
  }
  return saved;
}
