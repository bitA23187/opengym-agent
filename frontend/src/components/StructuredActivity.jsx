import {useState} from 'react'
import {useStore} from '../store/useStore.js'
import {useUI} from '../store/useUI.js'
import {t,exerciseNameFor,exerciseNameClass} from '../lib/i18n.js'
import {uid,todayISO} from '../lib/format.js'
import {WEIGHT_SOURCES,VALUE_SOURCES,REP_PORTIONS,cardioObservation,cleanClimbingRoutes,validateActivitySet} from '../lib/activity-data.js'
import {replaceActivityEntry} from '../lib/structured-workout.js'
import {openTrainingLogs} from '../lib/training-log.js'
import {EXDB} from '../lib/exercises.js'
import {Button} from './ui.jsx'
import {MeasurementsEditor,MeasurementsView} from './ActivityMeasurements.jsx'
import {cleanObservations} from '../lib/activity-fields.js'
import {activityDetailRows,hasActivityMeasurements,activitySourceGroups} from '../lib/activity-details.js'
import Icon from './Icon.jsx'
import './StructuredActivity.css'
const sourceLabels={machine_stack:'Machine marked load',plate_per_side:'Plates per side',per_dumbbell:'Each dumbbell',total_external:'Total external load',bodyweight:'Body weight',other:'Other',user_reported:'User reported',label:'Label',device:'Device',estimated:'Estimated'}
const portionLabels={full:'Full range',upper:'Upper range',lower:'Lower range'}
export function RoutesEditor({routes,onChange}) {
 const patch=(i,key,value)=>onChange(routes.map((r,j)=>j===i?{...r,[key]:value}:r))
 return <><p className="small muted">{t('Routes and attempts are not lifting sets. Leave unknown grades empty.')}</p>{routes.map((r,i)=><div className="nutrition-meal" key={r.route_id}>
 <label className="nutrition-field">{t('Route name')}<input className="field" maxLength={100} value={r.name||''} onChange={e=>patch(i,'name',e.target.value)}/></label>
 <div className="row"><label className="nutrition-field grow">{t('Grade')}<input className="field" maxLength={80} value={r.grade||''} onChange={e=>patch(i,'grade',e.target.value)}/></label><label className="nutrition-field grow">{t('Grading system')}<input className="field" maxLength={80} placeholder="V / Font / YDS" value={r.grading_system||''} onChange={e=>patch(i,'grading_system',e.target.value)}/></label></div>
 <label className="nutrition-field">{t('Attempts')}<input className="field" type="number" min="1" max="1000" value={r.attempts} onChange={e=>patch(i,'attempts',Number(e.target.value))}/></label><label><input type="checkbox" checked={r.completed} onChange={e=>patch(i,'completed',e.target.checked)}/>{t('Route completed')}</label>{' '}<Button type="button" onClick={()=>onChange(routes.filter((_,j)=>j!==i))}>{t('Remove')}</Button>
 </div>)}<Button type="button" onClick={()=>onChange([...routes,{route_id:uid(),attempts:1,completed:false}])}>{t('Add route')}</Button></>
}
function ObservationFields({set,mode,onChange}) {
 const change=(key,value)=>{const n={...set};if(value===''||value==null)delete n[key];else n[key]=value;onChange(n)}
 return <>
 {mode==='reps'&&<><div className="row">{REP_PORTIONS.map(portion=><label className="nutrition-field grow" key={portion}>{t(portionLabels[portion])}<input className="field" type="number" min="0" max="100" value={set.rep_segments?.filter(p=>p.portion===portion).reduce((n,p)=>n+p.reps,0)||''} onChange={e=>{const segments=[...(set.rep_segments||[]).filter(p=>p.portion!==portion),...(Number(e.target.value)>0?[{portion,reps:Number(e.target.value)}]:[])];const next={...set};if(segments.length){next.rep_segments=segments;next.r=segments.reduce((n,p)=>n+p.reps,0)}else delete next.rep_segments;onChange(next)}}/></label>)}</div><p className="small muted">{t('Segment counts replace total reps. Partial reps are excluded from full-range strength records.')}</p></>}
 {mode==='cardio'&&<><label className="nutrition-field">{t('Distance (km)')}<input className="field" type="number" min="0" step="any" value={set.distance_km??''} onChange={e=>change('distance_km',e.target.value===''?'':Number(e.target.value))}/></label><label className="nutrition-field">{t('Elapsed seconds')}<input className="field" type="number" min="1" max="36000" step="any" value={set.elapsed_seconds??(set.min!=null?set.min*60:'')} onChange={e=>{const next={...set};if(e.target.value===''){delete next.elapsed_seconds}else{next.elapsed_seconds=Number(e.target.value);next.min=Number(e.target.value)/60}onChange(next)}}/></label>
 <h4>{t('Incline intervals')}</h4>{(set.incline_segments||[]).map((p,i)=><div className="row" key={i}>{[['start_seconds','Start second'],['end_seconds','End second'],['incline_percent','Incline (%)']].map(([k,label])=><label className="nutrition-field grow" key={k}>{t(label)}<input className="field" type="number" step="any" value={p[k]} onChange={e=>change('incline_segments',set.incline_segments.map((v,j)=>j===i?{...v,[k]:Number(e.target.value)}:v))}/></label>)}<Button type="button" onClick={()=>change('incline_segments',set.incline_segments.length===1?'':set.incline_segments.filter((_,j)=>j!==i))}>{t('Remove')}</Button></div>)}<Button type="button" onClick={()=>change('incline_segments',[...(set.incline_segments||[]),{start_seconds:0,end_seconds:60,incline_percent:0}])}>{t('Add interval')}</Button></>}
 <label className="nutrition-field">{t('Weight source')}<select className="field" value={set.weight_source||''} onChange={e=>change('weight_source',e.target.value)}><option value="">{t('Unknown')}</option>{WEIGHT_SOURCES.map(k=><option key={k} value={k}>{t(sourceLabels[k])}</option>)}</select></label>
 <label className="nutrition-field">{t('Measurement source')}<select className="field" value={set.value_source||''} onChange={e=>change('value_source',e.target.value)}><option value="">{t('Unknown')}</option>{VALUE_SOURCES.map(k=><option key={k} value={k}>{t(sourceLabels[k])}</option>)}</select></label>
 </>
}
export function ActivityEntryEditor({w,index,close}) {
 const original=w.entries[index],[entry,setEntry]=useState(()=>structuredClone(original)),[selected,setSelected]=useState('0'),[error,setError]=useState('')
 const rows=entry.sets.flatMap((r,i)=>r.sides?['L','R'].map(side=>({key:`${i}${side}`,index:i,side,label:`${i+1} ${side}`})):[{key:String(i),index:i,label:String(i+1)}]),choice=rows.find(r=>r.key===selected)||rows[0]
 const row=choice?(choice.side?entry.sets[choice.index].sides[choice.side]:entry.sets[choice.index]):null
 const patchRow=next=>setEntry(e=>{const out=structuredClone(e);if(choice.side)out.sets[choice.index].sides[choice.side]=next;else out.sets[choice.index]=next;return out})
 return <form onSubmit={e=>{e.preventDefault();try{useStore.getState().update(s=>replaceActivityEntry(s,w.id,index,entry,JSON.stringify(original)));close()}catch(e){setError(e.message)}}}>
 <h3>{t('Activity details')}</h3>{entry.activity?.type==='climbing'?<RoutesEditor routes={entry.activity.routes} onChange={routes=>setEntry({...entry,activity:{type:'climbing',routes}})}/>:<>
 <label className="nutrition-field">{t('Set')}<select className="field" value={choice?.key||''} onChange={e=>setSelected(e.target.value)}>{rows.map(r=><option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
 {row&&<ObservationFields set={row} mode={entry.target?.mode||'reps'} onChange={patchRow}/>}</>}
 {entry.measurements&&<MeasurementsEditor fields={entry.measurements.fields} observations={entry.measurements.observations} onChange={observations=>setEntry({...entry,measurements:{...entry.measurements,observations}})}/>}
 {error&&<p role="alert">{t(error)}</p>}<div style={{marginTop:12}}><Button type="submit">{t('Save')}</Button>{' '}<Button type="button" onClick={close}>{t('Cancel')}</Button></div></form>
}
export function StructuredActivities({w}) {
 const customs=useStore(s=>s.S.customEx)
 const exercise=e=>(customs||[]).find(x=>x.id===e.id)||EXDB.find(x=>x.id===e.id)||{n:e.n||e.id}
 const title=e=><span className={exerciseNameClass(exercise(e))}>{exerciseNameFor(exercise(e))}</span>
 const rowLabel=({index,side})=>t('Set {0}',index+1)+(side?' · '+t(side==='L'?'Left':'Right'):'')
 const entries=w.entries.map((entry,index)=>({entry,index})),measured=entries.filter(({entry})=>hasActivityMeasurements(entry))
 if(!entries.length)return null
 return <section className="activity-details">
 {measured.length>0&&<><h4 className="activity-details-title">{t('Activity details')}</h4>{measured.map(({entry:e,index})=><div className="activity-detail-entry" key={e.entry_id||index}>
 <div className="activity-detail-name">{title(e)}</div>
 {e.measurements&&<MeasurementsView measurements={e.measurements}/>}
 {e.activity?.type==='climbing'&&e.activity.routes.map(r=><div className="activity-route" key={r.route_id}>
 <span>{r.name||t('Route')}{r.grade&&<strong className="activity-route-grade">{r.grading_system} {r.grade}</strong>}</span>
 <span className="small muted">{r.attempts} {t('Attempts')} · {t(r.completed?'Completed':'Not completed')}</span>
 {r.note&&<p className="small muted">{r.note}</p>}
 </div>)}
 {activityDetailRows(e).filter(({set:s})=>s.rep_segments?.length||s.distance_km!=null||s.elapsed_seconds!=null||s.incline_segments?.length).map(row=>{
 const s=row.set,cardio=cardioObservation(s)
 return <div key={`${row.index}-${row.side||''}`} className="activity-observation">
 <span className="activity-set-label">{rowLabel(row)}</span><div className="activity-observation-values">
 {s.rep_segments?.length>0&&<p>{s.rep_segments.map(p=>`${t(portionLabels[p.portion])} ${p.reps}`).join(' · ')}</p>}
 {(s.distance_km!=null||s.elapsed_seconds!=null||s.incline_segments?.length>0)&&<>
 <p>{[s.distance_km!=null?`${s.distance_km} km`:null,cardio.elapsed_seconds!=null?`${cardio.elapsed_seconds} s`:null].filter(Boolean).join(' · ')}</p>
 {cardio.derived_average_speed_kmh!=null&&<p className="muted">{t('Calculated average speed')}: {cardio.derived_average_speed_kmh.toFixed(2)} km/h</p>}
 {s.incline_segments?.map((p,i)=><p className="muted" key={i}>{p.start_seconds}–{p.end_seconds} s · {t('Incline (%)')}: {p.incline_percent}%</p>)}
 </>}
 </div></div>
 })}
 </div>)}</>}
 <details className="activity-recording-details">
 <summary>{t('Recording details')}<Icon name="chevronRight" className="activity-details-chevron"/></summary>
 <p className="small muted activity-details-help">{t('Optional measurements and recording sources. Weight and reps are edited with the workout.')}</p>
 {entries.map(({entry:e,index})=><div className="activity-source-entry" key={e.entry_id||index}>
 <div className="activity-source-heading"><strong>{title(e)}</strong><Button size="sm" variant="ghost" icon="pencil" aria-label={t('Edit activity details')+' · '+exerciseNameFor(exercise(e))} onClick={()=>useUI.getState().openSheet(close=><ActivityEntryEditor w={w} index={index} close={close}/>)}>{t('Edit')}</Button></div>
 {activitySourceGroups(e).map((g,i)=><p className="activity-source-line" key={i}>
 <span className="activity-set-label">{g.start===g.end?rowLabel({index:g.start,side:g.side}):t('Sets {0}–{1}',g.start+1,g.end+1)}</span>
 <span>{[g.weight_source,g.value_source].filter(Boolean).map(k=>t(sourceLabels[k])).join(' · ')}</span>
 </p>)}
 </div>)}
 </details>
 </section>
}
export function TrainingLogSessions() {
 const S=useStore(s=>s.S),logs=openTrainingLogs(S)
 if(!logs.length)return null
 return <section className="card"><h2>{t('Training in progress')}</h2><p className="small muted">{t('Assistant logs are saved separately until finished. Continue recording with the assistant.')}</p>{logs.map(s=><div className="nutrition-meal" key={s.id}><strong>{s.workout?.name}</strong><p>{s.date} · {s.workout?.entries.length} {t('Exercises')}</p>{s.workout?.entries.map(e=><p className="small" key={e.entry_id}>{S.customEx?.find(x=>x.id===e.id)?.n||EXDB.find(x=>x.id===e.id)?.n||e.id} · {e.activity?.type==='climbing'?`${e.activity.routes.length} ${t('Routes')}`:`${e.sets.length} ${t('Sets')}`}</p>)}</div>)}</section>
}
export function LogActivityForm({close,exercise}) {
 const S=useStore(s=>s.S),[mode,setMode]=useState(exercise?.activity_type==='custom'?'custom':exercise?.activity_type==='climbing'?'climbing':exercise?'cardio':'climbing'),[exerciseId,setExerciseId]=useState(exercise?.id||''),[date,setDate]=useState(todayISO()),[routes,setRoutes]=useState([]),[set,setSet]=useState({done:true}),[error,setError]=useState(''),[observations,setObservations]=useState([])
 const exercises=[...(S.customEx||[]),...EXDB].filter(e=>!e.archived&&(mode==='climbing'?e.activity_type==='climbing':mode==='custom'?e.activity_type==='custom':e.bp==='cardio'))
 return <form onSubmit={e=>{e.preventDefault();try{const ex=exercises.find(e=>e.id===exerciseId);if(!ex||date>todayISO())throw Error('Choose a valid exercise and logging date.');const entry={id:ex.id,target:{mode},sets:[]};if(observations.length)entry.measurements={fields:structuredClone(ex.field_definitions||[]),observations:cleanObservations(observations,ex.field_definitions||[])};if(mode==='custom'){if(!entry.measurements)throw Error('Enter actual measurements.');entry.activity={type:'custom'}}else if(mode==='climbing')entry.activity={type:'climbing',routes:cleanClimbingRoutes(routes)};else{validateActivitySet(set,'cardio');if(!set.elapsed_seconds)throw Error('Enter the actual duration.');entry.sets=[{...set,min:set.elapsed_seconds/60}]}useStore.getState().update(s=>{s.workouts.push({id:uid(),d:date,name:ex.n,entries:[entry],prs:[],vol:0});s.workouts.sort((a,b)=>a.d.localeCompare(b.d)||(a.start||0)-(b.start||0))});close()}catch(e){setError(e.message)}}}>
 <h3>{t('Log activity')}</h3><label className="nutrition-field">{t('Activity type')}<select className="field" value={mode} onChange={e=>{setMode(e.target.value);setExerciseId('');setObservations([])}}><option value="climbing">{t('Climbing')}</option><option value="cardio">{t('Cardio')}</option><option value="custom">{t('Custom activity')}</option></select></label><label className="nutrition-field">{t('Exercise')}<select className="field" required value={exerciseId} onChange={e=>{setExerciseId(e.target.value);setObservations([])}}><option value="">{t('Choose exercise')}</option>{exercises.map(e=><option key={e.id} value={e.id}>{e.n}</option>)}</select></label>
 <label className="nutrition-field">{t('Date')}<input className="field" type="date" required max={todayISO()} value={date} onChange={e=>setDate(e.target.value)}/></label>
 {mode==='climbing'?<RoutesEditor routes={routes} onChange={setRoutes}/>:mode==='cardio'?<ObservationFields set={set} mode="cardio" onChange={setSet}/>:null}
 {exercises.find(e=>e.id===exerciseId)?.field_definitions?.length>0&&<MeasurementsEditor fields={exercises.find(e=>e.id===exerciseId).field_definitions} observations={observations} onChange={setObservations}/>}
 {error&&<p role="alert">{t(error)}</p>}<Button type="submit">{t('Save')}</Button>{' '}<Button type="button" onClick={close}>{t('Cancel')}</Button></form>
}
