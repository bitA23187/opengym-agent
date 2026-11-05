import {t} from '../lib/i18n.js'
import {uid} from '../lib/format.js'
import {Button} from './ui.jsx'
export function MeasurementFieldsEditor({fields,onChange}) {
 const patch=(index,key,value)=>onChange(fields.map((f,i)=>i===index?{...f,[key]:value}:f))
 return <><h4>{t('Additional measurement fields')}</h4><p className="small muted">{t('Define the values you want to record. Existing records keep their original field definitions.')}</p>{fields.map((f,i)=><div className="nutrition-meal" key={f.key}>
 <label className="nutrition-field">{t('Field name')}<input className="field" required maxLength={80} value={f.label} onChange={e=>patch(i,'label',e.target.value)}/></label>
 <label className="nutrition-field">{t('Value type')}<select className="field" value={f.type} onChange={e=>onChange(fields.map((v,j)=>j===i?{key:v.key,label:v.label,type:e.target.value,aggregation:'none'}:v))}><option value="number">{t('Number')}</option><option value="text">{t('Text')}</option><option value="boolean">{t('Yes or no')}</option></select></label>
 {f.type==='number'&&<><label className="nutrition-field">{t('Unit')}<input className="field" maxLength={30} value={f.unit||''} onChange={e=>patch(i,'unit',e.target.value)}/></label><label className="nutrition-field">{t('Summary calculation')}<select className="field" value={f.aggregation||'none'} onChange={e=>patch(i,'aggregation',e.target.value)}><option value="none">{t('No calculation')}</option><option value="sum">{t('Sum')}</option><option value="mean">{t('Average')}</option></select></label></>}
 <Button type="button" onClick={()=>onChange(fields.filter((_,j)=>j!==i))}>{t('Remove')}</Button></div>)}<Button type="button" disabled={fields.length>=20} onClick={()=>onChange([...fields,{key:'m_'+uid().replace(/[^a-z0-9_]/gi,'').toLowerCase().slice(0,30),label:'',type:'number',aggregation:'none'}])}>{t('Add measurement field')}</Button></>
}
export function MeasurementsEditor({fields,observations,onChange}) {
 const patch=(i,key,value)=>onChange(observations.map((r,j)=>j===i?{...r,values:{...r.values,[key]:value}}:r))
 return <><h4>{t('Measurements')}</h4>{observations.map((r,i)=><div className="nutrition-meal" key={r.record_id}>{fields.map(f=><label className="nutrition-field" key={f.key}>{f.label}{f.unit?` (${f.unit})`:''}{f.type==='boolean'?<select className="field" value={r.values[f.key]==null?'':String(r.values[f.key])} onChange={e=>patch(i,f.key,e.target.value===''?null:e.target.value==='true')}><option value="">{t('Unknown')}</option><option value="true">{t('Yes')}</option><option value="false">{t('No')}</option></select>:<input className="field" type={f.type==='number'?'number':'text'} step={f.type==='number'?'any':undefined} min={f.min} max={f.max} maxLength={f.type==='text'?500:undefined} value={r.values[f.key]??''} onChange={e=>patch(i,f.key,e.target.value===''?null:f.type==='number'?Number(e.target.value):e.target.value)}/>}</label>)}<Button type="button" onClick={()=>onChange(observations.filter((_,j)=>j!==i))}>{t('Remove')}</Button></div>)}<Button type="button" onClick={()=>onChange([...observations,{record_id:uid(),values:{}}])}>{t('Add observation')}</Button></>
}
export function MeasurementsView({measurements}) {
 return <>{measurements.observations.map(r=><p className="small" key={r.record_id}>{measurements.fields.map(f=>`${f.label}: ${r.values[f.key]==null?'–':typeof r.values[f.key]==='boolean'?t(r.values[f.key]?'Yes':'No'):r.values[f.key]}${f.unit?' '+f.unit:''}`).join(' · ')}</p>)}</>
}
