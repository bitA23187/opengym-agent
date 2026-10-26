import { highestStamp } from '../../frontend/src/lib/sync-merge.js';

// Official clients sync workouts and existing app settings. These extension-only fields
// belong to the Agent service; a whole-document phone push cannot edit or erase them.
// Retain legacy single-session snapshots as inert data rather than deleting user data.
export const PLUGIN_FIELDS=['trainingNotes','pluginPlanHistory','pluginTrainingHistory','sessionAdjustments'];
export function preservePluginState(current,incoming) {
  if(!incoming||typeof incoming!=='object'||Array.isArray(incoming))return false;
  const reset=Number(incoming.resetAt||0)>Number(current?.resetAt||0);
  let changed=false;
  const now=Math.max(Date.now(),highestStamp(current),highestStamp(incoming))+1;
  for(const field of PLUGIN_FIELDS) {
    const exists=!reset&&Object.hasOwn(current||{},field);
    const different=Object.hasOwn(incoming,field)!==exists||exists&&JSON.stringify(incoming[field])!==JSON.stringify(current[field]);
    if(!different)continue;
    if(exists)incoming[field]=structuredClone(current[field]);else delete incoming[field];
    // A stale client may have stamped its incomplete metadata as newer. A causal server
    // stamp ensures its next pull accepts the protected copy instead of looping forever.
    incoming.edited={...(incoming.edited||{}),[field]:now};
    if(incoming.undone)delete incoming.undone[field];
    changed=true;
  }
  return changed;
}
