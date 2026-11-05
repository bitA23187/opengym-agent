// Reusable food profiles and immutable per-meal snapshots. No density or raw/cooked conversions.
export const FOOD_NUTRIENTS=['calories','protein','carbs','fat','alcohol']
export const FOOD_UNITS=['g','ml','serving']
export const FOOD_PREPARATION_LABELS={raw:'Raw',cooked:'Cooked',as_sold:'As sold',unspecified:'Unspecified'}
export const FOOD_PREPARATIONS=['raw','cooked','as_sold','unspecified']
const number=(v,max)=>v==null||v===''?null:Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=max?Number(v):NaN
export function cleanFood(input) {
  const name=String(input.name||'').trim(),basis={quantity:Number(input.basis?.quantity),unit:input.basis?.unit}
  if(!name||name.length>120||!Number.isFinite(basis.quantity)||basis.quantity<=0||basis.quantity>10000||!FOOD_UNITS.includes(basis.unit))throw Error('Food needs a name and a positive nutrition basis in g, ml or servings.')
  const nutrients={}
  for(const k of FOOD_NUTRIENTS) {nutrients[k]=number(input.nutrients?.[k],k==='calories'?30000:5000);if(Number.isNaN(nutrients[k]))throw Error('Invalid food nutrient value.')}
  const source=input.source||'Estimate'
  if(!['Label','Estimate','Weighed estimate','GPT estimate'].includes(source))throw Error('Invalid food nutrition source.')
  const preparation=input.preparation||'unspecified';if(!FOOD_PREPARATIONS.includes(preparation))throw Error('Invalid food preparation.')
  const seen=new Set(),servings=(input.servings||[]).map(s=>{
    if(!s.id||typeof s.id!=='string'||s.id.length>64||seen.has(s.id)||!s.name||String(s.name).length>80||!Number.isFinite(Number(s.quantity))||Number(s.quantity)<=0||Number(s.quantity)>10000||s.unit!==basis.unit)throw Error('Food servings need unique IDs and quantities in the nutrition basis unit.')
    seen.add(s.id);return {id:s.id,name:String(s.name),quantity:Number(s.quantity),unit:s.unit}
  })
  if(servings.length>30)throw Error('Too many food servings.')
  return {name,brand:String(input.brand||'').slice(0,120),basis,nutrients,source,preparation,source_reference:String(input.source_reference||'').slice(0,500),servings,archived:input.archived===true}
}
export function putFood(S,id,input,now=Date.now()) {
  if(!id||typeof id!=='string'||['constructor','__proto__','prototype'].includes(id)||id.length>100||Object.keys(S.foods||{}).length>=2000&&!S.foods?.[id])throw Error('Invalid food ID or food library limit reached.')
  const food=cleanFood(input)
  if(S.foods?.[id]?.source==='Label'&&food.source!=='Label')throw Error('Keep the label reference. Save a separate food for an estimate.')
  S.foods={...S.foods,[id]:{...food,_ts:now}}
}
export function foodItem(input,food) {
  const snapshot=cleanFood(food||input.food_snapshot),quantity=Number(input.quantity)
  if(!input.item_id||typeof input.item_id!=='string'||input.item_id.length>64||!Number.isFinite(quantity)||quantity<=0||quantity>10000)throw Error('Food items need a stable item ID and a positive quantity.')
  let amount=quantity,unit=input.unit
  if(input.serving_id) {
    const serving=snapshot.servings.find(s=>s.id===input.serving_id)
    if(!serving||unit!=='serving')throw Error('Choose an existing serving and use serving units.')
    amount*=serving.quantity;unit=serving.unit
  }
  if(unit!==snapshot.basis.unit)throw Error('Food quantity units must match the label basis. Density and raw/cooked conversions are not inferred.')
  const factor=amount/snapshot.basis.quantity
  const nutrients=Object.fromEntries(FOOD_NUTRIENTS.map(k=>[k,snapshot.nutrients[k]==null?null:Math.round(snapshot.nutrients[k]*factor*1000)/1000]))
  if(FOOD_NUTRIENTS.some(k=>nutrients[k]!=null&&nutrients[k]>(k==='calories'?30000:5000)))throw Error('Food item nutrition exceeds meal limits; check the portion.')
  return {item_id:input.item_id,food_id:input.food_id||null,quantity,unit:input.unit,...(input.serving_id?{serving_id:input.serving_id}:{}),food_snapshot:snapshot,nutrients,estimated:snapshot.source!=='Label',source:snapshot.source}
}
export function cleanMealItems(items) {
  if(!Array.isArray(items)||!items.length||items.length>100)throw Error('Provide 1–100 food items.')
  const seen=new Set()
  return items.map(i=>{if(seen.has(i.item_id))throw Error('Duplicate meal item ID.');seen.add(i.item_id);return foodItem(i)})
}
export const itemTotals=items=>Object.fromEntries(FOOD_NUTRIENTS.map(k=>[k,items.every(i=>i.nutrients[k]!=null)?Math.round(items.reduce((n,i)=>n+i.nutrients[k],0)*1000)/1000:null]))
// Derive inactivity from shared history, so the app and plugin use the same policy.
// Restoring or editing a profile updates _ts and grants another six calendar months.
export function foodList(S,{query='',include_archived=false,now=Date.now()}={}) {
  const cutoff=new Date(now)
  const day=cutoff.getUTCDate()
  cutoff.setUTCDate(1)
  cutoff.setUTCMonth(cutoff.getUTCMonth()-6)
  const lastDay=new Date(Date.UTC(cutoff.getUTCFullYear(),cutoff.getUTCMonth()+1,0)).getUTCDate()
  cutoff.setUTCDate(Math.min(day,lastDay))
  const activity=new Map()
  for(const entry of Object.values(S.nutritionEntries||{})) {
    if(!entry?.date)continue // Ignore deletion tombstones.
    const used=Date.parse(entry.eaten_at||entry.date+'T12:00:00Z')
    if(!Number.isFinite(used)||used>now)continue
    for(const item of entry.items||[])if(item.food_id)activity.set(item.food_id,Math.max(activity.get(item.food_id)||0,used))
  }
  const needle=query.trim().normalize('NFKC').toLowerCase()
  return Object.entries(S.foods||{}).filter(([,f])=>f?.name).map(([id,f])=>{
    const lastActivity=Math.max(Number(f._ts)||0,activity.get(id)||0)
    return {...f,id,archived:f.archived===true||lastActivity>0&&lastActivity<=cutoff.getTime()}
  }).filter(f=>(include_archived||!f.archived)&&(!needle||[f.name,f.brand].join(' ').normalize('NFKC').toLowerCase().includes(needle))).sort((a,b)=>a.name.localeCompare(b.name))
}
