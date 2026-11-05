import {it,expect} from 'vitest'
import {activityDetailRows,hasActivityMeasurements,activitySourceGroups} from './activity-details.js'
it('groups repeated sources without treating them as measurements or changing saved sets',()=>{
 const entry={sets:Array.from({length:7},()=>({w:60,r:8,weight_source:'total_external',value_source:'user_reported'}))},before=JSON.stringify(entry)
 expect(hasActivityMeasurements(entry)).toBe(false)
 expect(activitySourceGroups(entry)).toEqual([{start:0,end:6,side:null,weight_source:'total_external',value_source:'user_reported'}])
 expect(JSON.stringify(entry)).toBe(before)
})
it('preserves source gaps, differing sources and limb references',()=>{
 const entry={sets:[{value_source:'device'},{},{value_source:'device'},{sides:{L:{weight_source:'per_dumbbell',rep_segments:[{portion:'lower',reps:4}]},R:{value_source:'user_reported'}}}]}
 expect(activitySourceGroups(entry).map(g=>[g.start,g.end,g.side])).toEqual([[0,0,null],[2,2,null],[3,3,'L'],[3,3,'R']])
 expect(activityDetailRows(entry).at(-2)).toMatchObject({index:3,side:'L'})
 expect(hasActivityMeasurements(entry)).toBe(true)
})
it('retains zero distance, precise duration, incline, routes and custom observations',()=>{
 for(const entry of [{sets:[{distance_km:0}]},{sets:[{elapsed_seconds:60}]},{sets:[{incline_segments:[{start_seconds:0,end_seconds:60,incline_percent:0}]}]},{sets:[],activity:{type:'climbing',routes:[]}},{sets:[],activity:{type:'custom'}},{sets:[],measurements:{observations:[{values:{trips:0}}]}}])expect(hasActivityMeasurements(entry)).toBe(true)
 expect(hasActivityMeasurements({sets:[{rep_segments:[],incline_segments:[]}]})).toBe(false)
})
