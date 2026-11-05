import {describe,it,expect} from 'vitest'
import {validateActivitySet,cardioObservation} from './activity-data.js'
import {bestSetOf} from './onerm.js'
import {bestWeightForEntry,workoutVolume} from './history.js'
import {buildCompletedWorkout} from './finish-workout.js'
import {syncSideAggregate} from './workout-model.js'
describe('structured activity observations',()=>{
 it('rejects segment mismatch, overlapping incline intervals and inconsistent durations',()=>{
  expect(()=>validateActivitySet({r:21,rep_segments:[{portion:'lower',reps:7}]},'reps')).toThrow(/sum/)
  expect(()=>validateActivitySet({min:17,elapsed_seconds:900},'cardio')).toThrow(/disagree/)
  expect(()=>validateActivitySet({elapsed_seconds:120,incline_segments:[{start_seconds:0,end_seconds:80,incline_percent:3},{start_seconds:70,end_seconds:100,incline_percent:4}]},'cardio')).toThrow(/non-overlapping/)
  expect(cardioObservation({elapsed_seconds:1020,distance_km:1.6}).derived_average_speed_kmh).toBeCloseTo(5.647)
 })
 it('excludes partial-only records from full-range strength while retaining repetition volume and metadata on each side',()=>{
  const row={w:20,r:10,done:true,rep_segments:[{portion:'upper',reps:10}],weight_source:'machine_stack'},entry={id:'0025',topW:20,target:{mode:'reps'},sets:[row]}
  expect(bestSetOf(entry)).toBeNull();expect(bestWeightForEntry(entry)).toBe(0);expect(workoutVolume({entries:[entry]})).toBe(200)
  const sides=syncSideAggregate({sides:{L:row,R:row}});expect(sides.sides.L.rep_segments).toEqual(row.rep_segments)
 })
 it('keeps routes and stable entry IDs through native workout rebuilds',()=>{
  const entry={id:'climb',entry_id:'entry',target:{mode:'climbing'},sets:[],activity:{type:'climbing',routes:[{route_id:'r',attempts:1,completed:true}]}}
  const w=buildCompletedWorkout({id:'w',start:1,d:'2026-10-20',entries:[entry]});expect(w.entries[0].activity.routes).toHaveLength(1);expect(w.entries[0].entry_id).toBe('entry')
 })
})
