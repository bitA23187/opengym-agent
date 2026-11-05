// Preserve the original set index and limb when showing optional observations.
export function activityDetailRows(entry) {
 return (entry.sets||[]).flatMap((set,index)=>set.sides
  ? ['L','R'].filter(side=>set.sides[side]).map(side=>({set:set.sides[side],index,side}))
  : [{set,index,side:null}])
}
export function hasActivityMeasurements(entry) {
 return entry.activity?.type==='climbing'||entry.activity?.type==='custom'
  ||entry.measurements?.observations?.length>0
  ||activityDetailRows(entry).some(({set})=>set.rep_segments?.length>0||set.distance_km!=null||set.elapsed_seconds!=null||set.incline_segments?.length>0)
}
// Only adjacent rows with identical sources are combined; set references stay exact.
export function activitySourceGroups(entry) {
 const groups=[]
 for(const row of activityDetailRows(entry)) {
  const {weight_source,value_source}=row.set
  if(!weight_source&&!value_source)continue
  const previous=groups.at(-1)
  if(previous&&previous.weight_source===weight_source&&previous.value_source===value_source
   &&!row.side&&!previous.side&&previous.end===row.index-1)previous.end=row.index
  else groups.push({weight_source,value_source,start:row.index,end:row.index,side:row.side})
 }
 return groups
}
