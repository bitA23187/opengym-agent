// User-declared measurements are data, never executable formulas or instructions.
const reserved=new Set(['__proto__','constructor','prototype'])
export function cleanFieldDefinitions(fields) {
 if(!Array.isArray(fields)||fields.length>20)throw Error('Declare at most 20 measurement fields.')
 const seen=new Set()
 return fields.map(f=>{
   if(typeof f.key!=='string'||!/^[a-z][a-z0-9_]{0,39}$/.test(f.key)||reserved.has(f.key)||seen.has(f.key)||!f.label||String(f.label).length>80||!['number','text','boolean'].includes(f.type))throw Error('Fields need unique keys, labels and number/text/boolean types.')
   seen.add(f.key)
   const out={key:f.key,label:String(f.label),type:f.type,...(f.unit?{unit:String(f.unit).slice(0,30)}:{})}
   for(const k of ['min','max'])if(f[k]!=null){if(f.type!=='number'||typeof f[k]!=='number'||!Number.isFinite(f[k]))throw Error('Only number fields support finite bounds.');out[k]=f[k]}
   if(out.min!=null&&out.max!=null&&out.min>out.max)throw Error('Field minimum exceeds maximum.')
   out.aggregation=f.aggregation||'none'
   if(!['none','sum','mean'].includes(out.aggregation)||f.type!=='number'&&out.aggregation!=='none')throw Error('Only numeric measurements support sum or mean.')
   return out
 })
}
export function cleanObservations(records,fields) {
 const definitions=cleanFieldDefinitions(fields),lookup=new Map(definitions.map(f=>[f.key,f])),seen=new Set()
 if(!definitions.length||!Array.isArray(records)||!records.length||records.length>200)throw Error('Provide declared fields and 1–200 observations.')
 return records.map(r=>{
  if(!r.record_id||typeof r.record_id!=='string'||r.record_id.length>64||seen.has(r.record_id)||!r.values||typeof r.values!=='object'||Array.isArray(r.values))throw Error('Each observation needs a unique record ID and values.')
  seen.add(r.record_id);const values={}
  for(const [key,value] of Object.entries(r.values)) {
   const f=lookup.get(key);if(!f)throw Error('Measurement field was not declared for this activity.')
   if(value==null)continue
   if(typeof value!==(f.type==='text'?'string':f.type)||f.type==='number'&&(!Number.isFinite(value)||f.min!=null&&value<f.min||f.max!=null&&value>f.max)||f.type==='text'&&value.length>500)throw Error('Measurement value does not match its declared type or bounds.')
   values[key]=value
  }
  if(!Object.keys(values).length)throw Error('An observation needs at least one actual value.')
  return {record_id:r.record_id,values}
 })
}
export function observationTotals(measurements) {
 return cleanFieldDefinitions(measurements.fields).filter(f=>f.aggregation!=='none').map(f=>{
  const values=measurements.observations.map(r=>r.values[f.key]).filter(v=>typeof v==='number'&&Number.isFinite(v))
  return {key:f.key,label:f.label,unit:f.unit||null,aggregation:f.aggregation,value:values.length?values.reduce((n,v)=>n+v,0)/(f.aggregation==='mean'?values.length:1):null,observed:values.length,total:measurements.observations.length}
 })
}
