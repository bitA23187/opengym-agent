// Legacy clients may read opaque extensions, but must not erase/reinterpret them on an edit.
const extras=['set_id','rep_segments','weight_source','value_source','distance_km','elapsed_seconds','incline_segments']
const rowExtras=r=>({...Object.fromEntries(extras.filter(k=>r?.[k]!=null).map(k=>[k,r[k]])),...(r?.sides?{sides:{L:rowExtras(r.sides.L),R:rowExtras(r.sides.R)}}:{})})
const structured=e=>e?.entry_id||e?.activity||e?.measurements||e?.sets?.some(r=>extras.some(k=>r?.[k]!=null)||r?.sides&&[r.sides.L,r.sides.R].some(s=>extras.some(k=>s?.[k]!=null)))
const workoutExtras=w=>(w.entries||[]).map(e=>({id:e?.id,entry_id:e?.entry_id,activity:e?.activity,measurements:e?.measurements,sets:(e?.sets||[]).map(rowExtras)}))
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
function requireUpdate(){const e=Error('Update OpenGym before editing structured training or food records.');e.code='client_update_required';throw e}
export function assertStructuredStateCompatible(current,incoming,capabilities=[]) {
 if(Number(incoming.resetAt||0)>Number(current?.resetAt||0))return
 if(!Array.isArray(capabilities))capabilities=[]
 if(!capabilities.includes('structured_training_v1'))for(const w of current?.workouts||[]) {
  if(!w.entries?.some(structured))continue
  const next=(incoming.workouts||[]).find(n=>n.id===w.id)
  // Whole-workout deletion keeps its existing explicit deletion/tombstone semantics.
  if(next&&!same(workoutExtras(w),workoutExtras(next)))requireUpdate()
 }
 if(!capabilities.includes('food_items_v1'))for(const [id,e] of Object.entries(current?.nutritionEntries||{})) {
  if(!e.items&&!e.eaten_at)continue
  const next=incoming.nutritionEntries?.[id]
  if(!next?.date)continue
  const keys=['items','eaten_at','date','calories','protein','carbs','fat','alcohol']
  if(!same(keys.map(k=>e[k]),keys.map(k=>next[k])))requireUpdate()
 }
}
