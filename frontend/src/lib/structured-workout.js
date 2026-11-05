import {cleanFieldDefinitions,cleanObservations} from './activity-fields.js'
import {validateActivitySet,cleanClimbingRoutes} from './activity-data.js'
import {syncSideAggregate} from './workout-model.js'
import {workoutVolume} from './history.js'
import {rebuildPrHistory} from './workout-date.js'
import {stampWorkout} from './sync-merge.js'
export function replaceActivityEntry(S,workoutId,index,entry,expected) {
 const w=S.workouts.find(w=>w.id===workoutId),old=w?.entries?.[index]
 if(!old||JSON.stringify(old)!==expected)throw Error('Workout changed. Close and reopen the details before saving.')
 const next=structuredClone(entry)
 if(next.measurements){next.measurements.fields=cleanFieldDefinitions(next.measurements.fields);next.measurements.observations=cleanObservations(next.measurements.observations,next.measurements.fields)}
 if(next.activity?.type==='custom'&&(!next.measurements||next.sets.length))throw Error('Custom activities require measurements, not lifting sets.')
 if(next.activity?.type==='climbing') {
   next.activity.routes=cleanClimbingRoutes(next.activity.routes)
   if(next.sets.length)throw Error('Climbing uses routes, not lifting sets.')
 } else for(let i=0;i<next.sets.length;i++) {
   const row=next.sets[i]
   for(const set of row.sides?[row.sides.L,row.sides.R]:[row])validateActivitySet(set,next.target?.mode||'reps')
   if(row.sides)next.sets[i]=syncSideAggregate(row)
 }
 w.entries[index]=next;w.vol=workoutVolume(w);stampWorkout(w)
 S.workouts=rebuildPrHistory(S.workouts,[next.id],w)
}
