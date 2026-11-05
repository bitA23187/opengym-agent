import {useState, useEffect} from 'react'
import {useStore} from '../store/useStore.js'
import {useUI} from '../store/useUI.js'
import {t} from '../lib/i18n.js'
import {uid} from '../lib/format.js'
import {foodList,putFood,FOOD_NUTRIENTS,FOOD_UNITS,FOOD_PREPARATIONS,FOOD_PREPARATION_LABELS} from '../lib/foods.js'
import {Button, SearchField, Segmented} from './ui.jsx'
import {useNavigate} from 'react-router-dom'
import Icon from './Icon.jsx'
import '../views/Nutrition.css'
const nutrientLabels={calories:'Calories',protein:'Protein',carbs:'Carbohydrates',fat:'Fat',alcohol:'Alcohol'}
export function FoodForm({food,close}) {
 const [form,setForm]=useState(()=>food?structuredClone(food):{name:'',brand:'',basis:{quantity:100,unit:'g'},nutrients:{},source:'Label',preparation:'as_sold',servings:[]}),[error,setError]=useState('')
 const change=(k,v)=>setForm(f=>({...f,[k]:v}))
 return <form onSubmit={e=>{e.preventDefault();try{useStore.getState().update(s=>putFood(s,food?.id||uid(),form));close()}catch(e){setError(e.message)}}}>
  <h3>{t(food?'Edit food':'Add food')}</h3><p className="small muted">{t('Food profiles are reusable nutrition references, not food eaten.')}</p>
  <label className="nutrition-field">{t('Name')}<input className="field" required maxLength={120} value={form.name} onChange={e=>change('name',e.target.value)}/></label>
  <label className="nutrition-field">{t('Brand')}<input className="field" maxLength={120} value={form.brand||''} onChange={e=>change('brand',e.target.value)}/></label>
  <div className="row"><label className="nutrition-field grow">{t('Nutrition basis')}<input className="field" type="number" min="0.001" step="any" required value={form.basis.quantity} onChange={e=>change('basis',{...form.basis,quantity:e.target.value})}/></label><select className="field" aria-label={t('Food unit')} value={form.basis.unit} onChange={e=>change('basis',{...form.basis,unit:e.target.value})}>{FOOD_UNITS.map(k=><option key={k} value={k}>{t(k)}</option>)}</select></div>
  <p className="small muted">{t('Nutrients are per basis amount. Leave unknown values empty.')}</p>
  <div className="nutrition-grid">{FOOD_NUTRIENTS.map(k=><label className="nutrition-field" key={k}>{t(nutrientLabels[k])} ({k==='calories'?'kcal':'g'})<input className="field" type="number" min="0" step="any" value={form.nutrients[k]??''} onChange={e=>change('nutrients',{...form.nutrients,[k]:e.target.value})}/></label>)}</div>
  <label className="nutrition-field">{t('Preparation')}<select className="field" value={form.preparation} onChange={e=>change('preparation',e.target.value)}>{FOOD_PREPARATIONS.map(k=><option key={k} value={k}>{t(FOOD_PREPARATION_LABELS[k])}</option>)}</select></label>
  <label className="nutrition-field">{t('Value source')}<select className="field" value={form.source} onChange={e=>change('source',e.target.value)}>{['Label','Estimate','Weighed estimate','GPT estimate'].map(k=><option key={k} value={k}>{t(k==='Label'?'Nutrition label':k)}</option>)}</select></label>
  <label className="nutrition-field">{t('Nutrition reference')}<input className="field" maxLength={500} value={form.source_reference||''} onChange={e=>change('source_reference',e.target.value)}/></label>
  <h4>{t('Named servings')}</h4>{form.servings.map((s,i)=><div key={s.id} className="row"><input className="field" aria-label={t('Serving name')} required value={s.name} onChange={e=>change('servings',form.servings.map((v,j)=>i===j?{...v,name:e.target.value}:v))}/><input className="field" aria-label={t('Serving quantity')} type="number" min="0.001" step="any" required value={s.quantity} onChange={e=>change('servings',form.servings.map((v,j)=>i===j?{...v,quantity:e.target.value,unit:form.basis.unit}:v))}/><span>{form.basis.unit}</span><Button type="button" onClick={()=>change('servings',form.servings.filter((_,j)=>j!==i))}>{t('Remove')}</Button></div>)}
  <Button type="button" onClick={()=>change('servings',[...form.servings,{id:uid(),name:'',quantity:1,unit:form.basis.unit}])}>{t('Add serving')}</Button>
  {error&&<p role="alert">{t(error)}</p>}<div style={{marginTop:12}}><Button type="submit">{t('Save')}</Button>{' '}<Button type="button" onClick={close}>{t('Cancel')}</Button></div>
 </form>
}
export function FoodLibraryLink() {
 const S=useStore(s=>s.S),nav=useNavigate(),foods=foodList(S)
 return <section className="card"><button className="nutrition-library-link" onClick={()=>nav('/nutrition/foods')}><span className="nutrition-card-title"><Icon name="plate"/><strong>{t('Food library')}</strong></span><span className="nutrition-library-count">{t('{0} foods',foods.length)}<Icon name="chevronRight"/></span></button><p className="small muted nutrition-footnote">{t('Manage reusable foods in your library.')}</p></section>
}
const PAGE_SIZE=20
export function FoodLibrary() {
 const S=useStore(s=>s.S),nav=useNavigate(),[query,setQuery]=useState(''),[archived,setArchived]=useState(false),[pending,setPending]=useState(null),[limit,setLimit]=useState(PAGE_SIZE)
 const foods=foodList(S,{query,include_archived:archived}).filter(f=>archived?f.archived:!f.archived)
 useEffect(()=>{setPending(null);setLimit(PAGE_SIZE)},[query,archived])
 useEffect(()=>{if(!pending)return;const timer=setTimeout(()=>setPending(null),5000);return()=>clearTimeout(timer)},[pending])
 const toggleFood=f=>{if(!f.archived&&pending!==f.id){setPending(f.id);return}useStore.getState().update(s=>putFood(s,f.id,{...f,archived:!f.archived}));setPending(null)}
 return <div className="narrow nutrition-page"><div className="hdr"><button className="iconbtn" aria-label={t('Back')} onClick={()=>nav('/nutrition')}><Icon name="chevronLeft"/></button><div style={{flex:1}}><h1>{t('Food library')}</h1></div></div>
 <section className="card"><div className="nutrition-section-head"><div className="nutrition-card-title"><Icon name="plate"/><h2>{t('Saved foods')}</h2></div><Button size="sm" variant="tinted" icon="plus" onClick={()=>useUI.getState().openSheet(close=><FoodForm close={close}/>)}>{t('Add food')}</Button></div>
 <SearchField type="search" aria-label={t('Search foods')} placeholder={t('Search foods')} value={query} onChange={e=>setQuery(e.target.value)} onClear={()=>setQuery('')}/>
 <Segmented className="food-library-tabs" value={archived} onChange={setArchived} options={[{value:false,label:t('Active foods')},{value:true,label:t('Archived foods')}]}/>
 <p className="small muted">{t('Foods unused and unchanged for 6 months are automatically archived. You can restore them anytime.')}</p>
 <p className="small muted">{t('Updating a food profile never changes past meals.')}</p>
 {!foods.length&&<div className="nutrition-empty"><strong>{t(query?'No matching foods':archived?'No archived foods':'Your food library starts here')}</strong><p>{t(query?'Try another name or brand.':archived?'Archived foods will appear here.':'Save foods you eat often to log meals faster.')}</p></div>}
 {foods.slice(0,limit).map(f=><article className="food-library-item" key={f.id}><div className="food-library-info"><div className="food-library-name"><strong>{f.name}</strong>{f.archived&&<span className="nutrition-period">{t('Archived')}</span>}</div>{f.brand&&<p className="small muted">{f.brand}</p>}<p className="small muted">{t('Per')} {f.basis.quantity} {t(f.basis.unit)} · {t(FOOD_PREPARATION_LABELS[f.preparation]||f.preparation)}</p><div className="food-library-nutrients"><strong>{f.nutrients.calories??'–'} <small>kcal</small></strong>{['protein','carbs','fat'].map(k=><span key={k}>{t(nutrientLabels[k])} <b>{f.nutrients[k]??'–'}</b> g</span>)}</div></div>
 <div className="nutrition-actions"><Button size="sm" variant="ghost" icon="pencil" onClick={()=>{setPending(null);useUI.getState().openSheet(close=><FoodForm food={f} close={close}/>)}}>{t('Edit')}</Button><Button size="sm" variant={pending===f.id?'danger':'tinted'} onClick={()=>toggleFood(f)}>{t(f.archived?'Restore':pending===f.id?'Confirm archive':'Archive')}</Button>{pending===f.id&&<Button size="sm" variant="ghost" onClick={()=>setPending(null)}>{t('Cancel')}</Button>}</div></article>)}
 {foods.length>limit&&<Button size="sm" variant="ghost" onClick={()=>setLimit(n=>n+PAGE_SIZE)}>{t('Show more')}</Button>}
 </section></div>
}
