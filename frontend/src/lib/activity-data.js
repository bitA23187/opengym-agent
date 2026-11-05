// Optional structured observations. No conversions of load conventions or invented measurements.
export const WEIGHT_SOURCES = ['machine_stack', 'plate_per_side', 'per_dumbbell', 'total_external', 'bodyweight', 'other']
export const VALUE_SOURCES = ['user_reported', 'label', 'device', 'estimated']
export const REP_PORTIONS = ['full', 'upper', 'lower']
const finite = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max
export function validateActivitySet(set, mode) {
  if (set.weight_source != null && !WEIGHT_SOURCES.includes(set.weight_source)) throw Error('Choose a valid weight source.')
  if (set.value_source != null && !VALUE_SOURCES.includes(set.value_source)) throw Error('Choose a valid value source.')
  if (set.rep_segments != null) {
    if (mode !== 'reps' || set.type && set.type !== 'straight' || !Array.isArray(set.rep_segments) || !set.rep_segments.length || set.rep_segments.length > 20) throw Error('Rep segments require a straight repetitions set.')
    if (set.rep_segments.some(p => !REP_PORTIONS.includes(p.portion) || !Number.isInteger(p.reps) || !finite(p.reps, 1, 100)) || set.rep_segments.reduce((n,p) => n+p.reps,0) !== (set.reps ?? set.r)) throw Error('Segment counts must sum to total reps.')
  }
  const seconds = set.elapsed_seconds ?? ((set.minutes ?? set.min) != null ? (set.minutes ?? set.min)*60 : null)
  if (set.elapsed_seconds != null && (!finite(set.elapsed_seconds, 1, 36000) || mode !== 'cardio')) throw Error('Elapsed seconds require cardio mode.')
  if (set.elapsed_seconds != null && (set.minutes ?? set.min) != null && Math.abs((set.minutes ?? set.min)*60-set.elapsed_seconds)>1) throw Error('Cardio minutes and elapsed seconds disagree.')
  if (set.distance_km != null && (!finite(set.distance_km, 0, 1000) || mode !== 'cardio')) throw Error('Distance requires cardio mode.')
  if (set.incline_segments != null) {
    if (mode !== 'cardio' || !Array.isArray(set.incline_segments) || !set.incline_segments.length || set.incline_segments.length>200 || seconds == null) throw Error('Incline segments require a cardio duration.')
    let end=0
    for (const p of set.incline_segments) {
      if (!finite(p.start_seconds, 0, seconds) || !finite(p.end_seconds, 0, seconds) || p.end_seconds<=p.start_seconds || p.start_seconds<end || !finite(p.incline_percent,-20,45)) throw Error('Incline segments must be ordered, non-overlapping and within the duration.')
      end=p.end_seconds
    }
  }
}
export function cardioObservation(set) {
  const elapsed_seconds=set.elapsed_seconds ?? (Number.isFinite(set.min) ? set.min*60 : null)
  return {elapsed_seconds,distance_km:set.distance_km ?? null,derived_average_speed_kmh:elapsed_seconds>0&&Number.isFinite(set.distance_km)?set.distance_km/elapsed_seconds*3600:null,incline_segments:set.incline_segments||[]}
}
export function cleanClimbingRoutes(routes) {
  if (!Array.isArray(routes) || !routes.length || routes.length>100) throw Error('Provide 1–100 climbing routes.')
  const ids=new Set()
  return routes.map(r=>{
    if (!r.route_id || typeof r.route_id!=='string' || r.route_id.length>64 || ids.has(r.route_id) || !Number.isInteger(r.attempts) || !finite(r.attempts,1,1000) || typeof r.completed!=='boolean') throw Error('Each route needs a unique ID, attempts and completion status.')
    ids.add(r.route_id)
    for(const k of ['grade','grading_system','name','note'])if(r[k]!=null&&(typeof r[k]!=='string'||r[k].length>500))throw Error('Invalid climbing route text.')
    return {...r}
  })
}
export const isNonLiftingActivity = e => ['climbing','custom'].includes(e?.target?.mode)||['climbing','custom'].includes(e?.activity?.type)
export const isPartialSet = s => s?.rep_segments?.some(p=>p.portion!=='full')
