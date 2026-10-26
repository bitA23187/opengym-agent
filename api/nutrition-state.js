// Older clients can carry these maps as opaque settings. Preserve independently stamped
// entries at the sole writer boundary so one whole-state PUT cannot erase another device's meal.
export function preserveNutritionState(current,incoming) {
  if(Number(incoming.resetAt||0)>Number(current?.resetAt||0))return false;
  let changed=false;
  for(const field of ['nutritionEntries','nutritionDays']) {
    const old=current?.[field];if(!old||typeof old!=='object'||Array.isArray(old))continue;
    const supplied=incoming[field],next=supplied&&typeof supplied==='object'&&!Array.isArray(supplied)?{...supplied}:{};
    for(const [id,entry] of Object.entries(old)) {
      if(!Object.hasOwn(next,id)||(Number(entry?._ts)||0)>(Number(next[id]?._ts)||0))next[id]=entry;
    }
    if(JSON.stringify(next)!==JSON.stringify(supplied)){incoming[field]=next;changed=true;}
  }
  return changed;
}
