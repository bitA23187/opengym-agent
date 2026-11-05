import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO, uid } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { NUTRIENTS, MEALS, NUTRITION_SOURCES, putMeal, removeMeal, nutritionDay, nutritionWeeks, nutritionOverview, mealEnergy, nutritionToday, shiftNutritionDate } from '../lib/nutrition.js'
import { Button, Segmented } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'
import LineChart from '../components/LineChart.jsx'
import DetailBack from '../components/DetailBack.jsx'
import Icon from '../components/Icon.jsx'
import { FoodLibraryLink } from '../components/FoodLibrary.jsx'
import DatePicker from '../components/DatePicker.jsx'
import { useNutritionToday } from '../lib/use-nutrition-today.js'
import './Nutrition.css'
import { foodList,foodItem,cleanMealItems,itemTotals,FOOD_PREPARATION_LABELS } from '../lib/foods.js'
const labels = { calories: 'Calories', protein: 'Protein', carbs: 'Carbohydrates', fat: 'Fat', alcohol: 'Alcohol' }
const units = k => k === 'calories' ? 'kcal' : 'g'
const show = v => v == null ? '–' : String(v)
const update = fn => useStore.getState().update(fn)
const toast = msg => useUI.getState().toast(t(msg))

function MealForm({ date: initialDate, entry, close }) {
  const [form, setForm] = useState(() => ({ date: initialDate, meal: 'Lunch', source: 'Estimate', time: '', description: '', ...Object.fromEntries(NUTRIENTS.map(k => [k, ''])), ...entry }))
  const [error, setError] = useState('')
  const foodState=useStore(s=>s.S),foods=foodList(foodState),[foodId,setFoodId]=useState('')
  const change = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const save = e => {
    e.preventDefault()
    if (form.date > todayISO()) { setError('Choose today or an earlier date.'); return }
    try { update(s => putMeal(s, entry?.id || uid(), form)); close(); toast('Meal saved') } catch (err) { setError(err.message) }
  }
  const itemValues=form.items?.length?itemTotals(cleanMealItems(form.items)):null
  const energy = mealEnergy(itemValues||Object.fromEntries(NUTRIENTS.map(k => [k, form[k] === '' || form[k] == null ? null : Number(form[k])])))
  return <form onSubmit={save}>
    <h3>{t(entry ? 'Edit meal' : 'Log a meal')}</h3>
    <p className="small muted">{t('Record what you ate. Leave unknown values empty; zero means none.')}</p>
    <label className="nutrition-field">{t('Date')}<input className="field" type="date" required max={todayISO()} value={form.date} onChange={e => change('date', e.target.value)} /></label>
    <label className="nutrition-field">{t('Meal')}<select className="field" value={form.meal} onChange={e => change('meal', e.target.value)}>{MEALS.map(m => <option key={m} value={m}>{t(m)}</option>)}</select></label>
    <label className="nutrition-field">{t('Time (optional)')}<input className="field" type="time" value={form.time || ''} onChange={e => change('time', e.target.value)} /></label>
    <label className="nutrition-field">{t('Food description (optional)')}<textarea className="field" rows={2} maxLength={2000} value={form.description} onChange={e => change('description', e.target.value)} /></label>
    <label className="nutrition-field">{t('Actual eating time (with timezone)')}<input className="field" placeholder="2026-10-22T00:30:00+08:00" value={form.eaten_at||''} onChange={e=>change('eaten_at',e.target.value)}/></label>
    <p className="small muted">{t('The logging date can differ from the actual eating date.')}</p>
    <h4>{t('Food items')}</h4>
    {(form.items||[]).map((i,index)=><div className="nutrition-meal" key={i.item_id}><strong>{i.food_snapshot.name}</strong><p className="small muted">{t(FOOD_PREPARATION_LABELS[i.food_snapshot.preparation]||i.food_snapshot.preparation)} · {t(i.source==='Label'?'Nutrition label':i.source)}</p><label>{t('Quantity')}<input className="field" type="number" min="0.001" step="any" value={i.quantity} onChange={e=>{const q=Number(e.target.value);if(q>0)try{change('items',form.items.map((v,j)=>j===index?foodItem({...v,quantity:q}):v))}catch(err){setError(err.message)}}}/></label><select className="field" aria-label={t('Food portion')} value={i.serving_id||''} onChange={e=>{try{const serving_id=e.target.value;change('items',form.items.map((v,j)=>j===index?foodItem({...v,serving_id:serving_id||undefined,unit:serving_id?'serving':v.food_snapshot.basis.unit,quantity:serving_id?1:v.food_snapshot.basis.quantity}):v))}catch(err){setError(err.message)}}}><option value="">{t(i.food_snapshot.basis.unit)}</option>{i.food_snapshot.servings.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select><Button type="button" onClick={()=>change('items',form.items.filter((_,j)=>j!==index))}>{t('Remove')}</Button></div>)}
    <div className="row"><select className="field" aria-label={t('Choose food')} value={foodId} onChange={e=>setFoodId(e.target.value)}><option value="">{t('Choose food')}</option>{foods.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select><Button type="button" disabled={!foodId} onClick={()=>{const food=foods.find(f=>f.id===foodId);if(food){change('items',[...(form.items||[]),foodItem({item_id:uid(),food_id:food.id,quantity:food.basis.quantity,unit:food.basis.unit},food)]);setFoodId('')}}}>{t('Add food item')}</Button></div>
    {form.items?.length>0&&<p className="small muted">{t('Meal totals are calculated from food items. Unknown nutrients stay unknown.')}</p>}
    <div className="nutrition-grid">{NUTRIENTS.map(k => <label className="nutrition-field" key={k}>{t(labels[k])} ({units(k)})<input className="field" type="number" min="0" max={k === 'calories' ? 30000 : 5000} step="0.1" disabled={!!form.items?.length} value={itemValues?itemValues[k]??'':form[k] ?? ''} onChange={e => change(k, e.target.value)} /></label>)}</div>
    <p className="small muted">{t('Alcohol is grams of pure ethanol. Enter 0 if you did not drink.')}</p>
    {energy.derived && <p className="small muted">{t('Estimated energy from nutrients')}: {energy.value} kcal</p>}
    <label className="nutrition-field">{t('Value source')}<select className="field" value={form.source} onChange={e => change('source', e.target.value)}>{NUTRITION_SOURCES.map(s => <option key={s} value={s}>{t(s === 'Label' ? 'Nutrition label' : s)}</option>)}</select></label>
    {error && <p role="alert" style={{ color: 'var(--red)' }}>{t(error)}</p>}
    <Button type="submit" variant="primary">{t('Save')}</Button>{' '}<Button type="button" variant="ghost" onClick={close}>{t('Cancel')}</Button>
  </form>
}
export function mealSheet(date = nutritionToday(), entry = null) { useUI.getState().openSheet(close => <MealForm date={date} entry={entry} close={close} />) }
const macros = ['protein', 'carbs', 'fat']
const number = value => value == null ? '–' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })
function goalComparison(value, goal, metric) {
  const diff = Math.round((value - goal) * 10) / 10
  return t(diff > 0 ? '{0} {1} above reference' : diff < 0 ? '{0} {1} below reference' : 'At reference goal', number(Math.abs(diff)), units(metric))
}
function NutrientProgress({ nutrient, total, goal }) {
  if (!Number.isFinite(goal) || goal <= 0 || total.value == null) return null
  const diff = Math.round((total.value - goal) * 10) / 10
  const state = diff > 0 ? 'over' : diff === 0 && total.known ? 'met' : 'under'
  const percent = Math.floor(total.value / goal * 1000) / 10
  const excess = diff > 0 ? diff / total.value * 100 : 0
  return <div className={'nutrition-goal-progress nutrition-' + nutrient} data-state={state}>
    <div className="nutrition-progress-track">
      <progress className={'nutrition-progress nutrition-' + nutrient} max={goal} value={Math.min(goal, total.value)} aria-label={t('{0} reference goal', t(labels[nutrient]))} aria-valuetext={`${number(total.value)} / ${number(goal)} ${units(nutrient)} · ${number(percent)}%${!total.known ? ' · ' + t('Some nutrient values are unknown') : ''}`} />
      {excess > 0 && <><span className="nutrition-progress-excess" aria-hidden="true" style={{ width: excess + '%' }} /><span className="nutrition-progress-goal" aria-hidden="true" style={{ insetInlineStart: (100 - excess) + '%' }} /></>}
    </div>
    <div className="nutrition-goal-comparison"><span className="nutrition-goal-percent">{state === 'met' && <Icon name="check" />}{!total.known && '≥'}{number(percent)}%</span><span>{total.known ? goalComparison(total.value, goal, nutrient) : t('Some nutrient values are unknown')}</span></div>
  </div>
}
function MacroSummary({ totals, goals = {}, average = false }) {
  return <div className="nutrition-macros">{macros.map(k => <div className={'nutrition-macro nutrition-' + k} key={k}>
    <span className="nutrition-macro-label"><Icon name={k === 'protein' ? 'protein' : k === 'carbs' ? 'grain' : 'droplet'} /><span>{t(labels[k])}</span></span>
    <div className="nutrition-macro-number"><strong>{number(totals[k].value)}</strong><span>g</span></div>
    {average ? <span className="nutrition-macro-note">{t('{0} recorded days', totals[k].days)}</span> : <>
      <span className="nutrition-macro-note">{totals[k].value != null && !totals[k].known ? t('Some nutrient values are unknown') : Number.isFinite(goals[k]) ? t('Reference {0} g', number(goals[k])) : t(totals[k].value == null ? 'Not recorded' : 'Recorded')}</span>
      <NutrientProgress nutrient={k} total={totals[k]} goal={goals[k]} />
    </>}
  </div>)}</div>
}
export function NutritionTotals({ day, goals = {} }) {
  const energy = day.totals.calories
  return <div className="nutrition-summary">
    <div className="nutrition-energy"><div>
      <span className="nutrition-eyebrow">{t('Recorded energy')}</span>
      <div className="nutrition-energy-number"><strong>{number(energy.value)}</strong><span>kcal</span></div>
    </div>{Number.isFinite(goals.calories) && <div className="nutrition-energy-reference"><span>{t('Daily reference')}</span><strong>{number(goals.calories)} <small>kcal</small></strong></div>}</div>
    <NutrientProgress nutrient="calories" total={energy} goal={goals.calories} />
    {energy.value != null && !energy.known && <p className="nutrition-partial small muted">{t('Energy is missing from some entries.')}</p>}
    <MacroSummary totals={day.totals} goals={goals} />
    <div className="nutrition-secondary small muted"><span>{t('Alcohol')} · {number(day.totals.alcohol.value)} g{day.totals.alcohol.value != null && !day.totals.alcohol.known ? ' · ' + t('Some nutrient values are unknown') : ''}</span></div>
  </div>
}
const averageLabel = metric => metric === 'calories' ? t('Average recorded daily energy') : t('Average recorded daily {0}', t(labels[metric]))
function NutritionControls({ range, setRange, metric, setMetric }) {
  return <div className="nutrition-controls">
    <div role="group" aria-label={t('Date range')}><Segmented className="seg-range" value={range} onChange={setRange} options={[{value:7,label:t('7 days')},{value:30,label:t('30 days')},{value:90,label:t('3M')},{value:365,label:t('1Y')}]}/></div>
    <div className="nutrition-metric-scroll" role="group" aria-label={t('Nutrient')}><Segmented className="seg-range nutrition-metric" value={metric} onChange={setMetric} options={NUTRIENTS.map(k=>({value:k,label:t(labels[k])}))}/></div>
  </div>
}
function NutritionTrend({ overview, metric = 'calories', range = 7, goals = {} }) {
  const goal = metric !== 'alcohol' && Number.isFinite(goals[metric]) && goals[metric] > 0 ? goals[metric] : null
  const reference = goal != null ? t('Current daily reference: {0} {1}', number(goal), units(metric)) : null
  if (range > 7) return <>{reference && <p className="small muted nutrition-trend-reference">{reference}</p>}<LineChart goal={goal} goalColor="var(--label-2)" points={overview.days.filter(d => d.totals[metric].value != null).map(d => ({ t: Date.parse(d.date + 'T12:00:00'), y: d.totals[metric].value, d: d.date, note: goal != null ? goalComparison(d.totals[metric].value, goal, metric) : undefined }))} unit={units(metric)} /></>
  const max = Math.max(1, goal == null ? 0 : goal * 1.15, ...overview.days.map(d => d.totals[metric].value || 0))
  return <>{reference && <p className="small muted nutrition-trend-reference">{reference}</p>}<div className="nutrition-trend nutrition-trend-chart" style={goal == null ? undefined : { '--nutrition-goal-position': goal / max }} role="img" aria-label={(reference ? reference + '; ' : '') + t(labels[metric]) + ': ' + overview.days.map(d => `${d.date}: ${number(d.totals[metric].value)} ${units(metric)} (${t(d.totals[metric].value == null ? 'Not recorded' : 'Recorded')}${goal != null && d.totals[metric].value != null ? '; ' + goalComparison(d.totals[metric].value, goal, metric) : ''})`).join('; ')}>
    <div className="nutrition-trend-values" aria-hidden="true">{overview.days.map(d => <span className="nutrition-trend-value" key={d.date}>{d.totals[metric].value == null ? '–' : Math.round(d.totals[metric].value)}</span>)}</div>
    <div className="nutrition-trend-plot">
      {goal != null && <span className="nutrition-trend-goal" aria-hidden="true" />}
      {overview.days.map(d => {
        const value = d.totals[metric].value
        return <div className="nutrition-trend-day" key={d.date} title={`${d.date} · ${number(value)} ${units(metric)} · ${t(value == null ? 'Not recorded' : 'Recorded')}${goal != null && value != null ? ' · ' + goalComparison(value, goal, metric) : ''}`}>
          <div className="nutrition-trend-track">{value === 0 ? <span className="nutrition-trend-zero" /> : value != null ? <span className="nutrition-trend-bar" style={{ height: value / max * 100 + '%' }}>{goal != null && value > goal && <span className="nutrition-trend-excess" style={{ height: (value - goal) / value * 100 + '%' }} />}</span> : <span className="nutrition-trend-missing" />}</div>
        </div>
      })}
    </div>
    <div className="nutrition-trend-dates" aria-hidden="true">{overview.days.map(d => <span className="nutrition-trend-date" key={d.date}>{d.date === nutritionToday() ? t('Today') : new Date(d.date + 'T12:00:00Z').toLocaleDateString(dateLocale(), { weekday: 'short' })}</span>)}</div>
  </div></>
}
export function NutritionCard({ from = '/home', compact = false }) {
  const S = useStore(s => s.S), nav = useNavigate(), today = useNutritionToday(), day = nutritionDay(S, today)
  const [range, setRange] = useState(7), [metric, setMetric] = useState('calories')
  const overview = compact ? nutritionOverview(S, today, range) : null
  const hasRecords = compact ? overview.days.some(d => d.meals.length) : day.meals.length > 0
  const energy = overview?.averages[metric]
  return <section className={'card nutrition-card' + (!compact ? ' nutrition-today-card' : '')} aria-label={compact ? t('Nutrition over the last {0} days', range) : t('Today’s nutrition')}>
    <div className="nutrition-card-heading"><div className="nutrition-card-title"><Icon name="utensils" /><h2>{t(compact ? 'Nutrition' : 'Today’s nutrition')}</h2></div>
      {compact ? <Button size="sm" variant="tinted" trailingIcon="chevronRight" onClick={() => nav('/nutrition', { state: { from } })}>{t('Open')}</Button> : <Button size="sm" variant="tinted" icon="plus" onClick={() => mealSheet(today)}>{t('Log a meal')}</Button>}
    </div>
    {compact && <NutritionControls range={range} setRange={setRange} metric={metric} setMetric={setMetric} />}
    {!hasRecords ? <div className="nutrition-empty"><strong>{t(compact ? 'Your nutrition, over time' : 'Start with one meal')}</strong><p>{t(compact ? 'Logged days will appear here and build your averages.' : 'Log a meal to see your energy and nutrients here.')}</p></div> : compact ? <>
      <div className="nutrition-energy nutrition-average"><div><span className="nutrition-eyebrow">{averageLabel(metric)}</span><div className="nutrition-energy-number"><strong>{number(energy.value)}</strong><span>{units(metric)}</span></div></div><span className="nutrition-coverage">{t('{0} / {1} recorded days', energy.days, range)}</span></div>
      <NutritionTrend overview={overview} metric={metric} range={range} goals={S.nutritionGoals || {}} />
      <div className="nutrition-chart-key"><span><i />{t('Recorded')}</span><span>— {t('Not recorded')}</span></div>
      <MacroSummary totals={overview.averages} average />
    </> : <>
      <p className="nutrition-status"><time dateTime={today}>{new Date(today + 'T12:00:00').toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' })}</time> · {t('Recorded intake')}</p>
      <NutritionTotals day={day} goals={S.nutritionGoals || {}} />
      <div className="nutrition-meal-list">{day.meals.length > 3 && <p className="small muted">{t('Latest 3 entries')}</p>}{day.meals.slice(-3).map(e => <div className="nutrition-meal-preview" key={e.id}><span>{t(e.meal)}{e.time && <small>{e.time}</small>}</span><span className="nutrition-meal-description">{e.description || t(e.source === 'Label' ? 'Nutrition label' : e.source)}</span><span>{number(mealEnergy(e).value)} <small>kcal</small></span></div>)}</div>
    </>}
    {day.conflict && !compact && <p role="alert">{t('Daily total overlaps with meal entries. Resolve before using totals.')}</p>}
    <div className={compact ? "nutrition-card-footer" : "health-records-footer"}>{compact && hasRecords && <span className="small muted">{t('Averages use recorded values.')}</span>}{!compact && <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={() => nav('/nutrition', { state: { from } })}>{t('All food records')}</Button>}</div>
  </section>
}
function Goals({ close }) {
  const S = useStore(s => s.S), [goals, setGoals] = useState(S.nutritionGoals || {})
  return <><h3>{t('Daily nutrition goals')}</h3><p className="small muted">{t('Optional reference values. No goals are inferred from your weight.')}</p>{NUTRIENTS.filter(k => k !== 'alcohol').map(k => <label className="nutrition-field" key={k}>{t(labels[k])} ({units(k)})<input className="field" type="number" min="0" step="0.1" max={k === 'calories' ? 30000 : 5000} value={goals[k] ?? ''} onChange={e => setGoals(g => ({ ...g, [k]: e.target.value }))} /></label>)}<Button onClick={() => {
    const clean = {}
    for (const k of NUTRIENTS.filter(k => k !== 'alcohol')) { const v = goals[k]; if (v !== '' && v != null) { const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > (k === 'calories' ? 30000 : 5000)) return toast('Enter valid non-negative nutrition values.'); clean[k] = n } }
    update(s => { s.nutritionGoals = clean }); close()
  }}>{t('Save')}</Button></>
}
export default function Nutrition() {
  const S = useStore(s => s.S), today = useNutritionToday(), [selectedDate, setSelectedDate] = useState(null), [range, setRange] = useState(7), [metric, setMetric] = useState('calories')
  const date = selectedDate ?? today
  const setDate = value => setSelectedDate(value === today ? null : value)
  const day = nutritionDay(S, date)
  const from = shiftNutritionDate(today, -(range - 1))
  const weeks = nutritionWeeks(S, from, today, S.weekStart ?? 1)
  const overview = nutritionOverview(S, today, range), average = overview.averages[metric]
  return <div className="narrow nutrition-page"><div className="hdr"><DetailBack /><div style={{ flex: 1 }}><h1>{t('Nutrition')}</h1></div></div>
    <section className="card nutrition-daily"><div className="nutrition-section-head"><div className="nutrition-card-title"><Icon name="flame" /><h2>{t('Recorded intake')}</h2></div><Button size="sm" variant="tinted" icon="plus" onClick={() => mealSheet(date)}>{t('Log a meal')}</Button></div>
      <div className="nutrition-date-nav" role="group" aria-label={t('Date')}>
        <Button type="button" variant="ghost" icon="chevronLeft" aria-label={t('Previous day')} onClick={() => setDate(shiftNutritionDate(date, -1))} />
        <DatePicker value={date} max={today} onChange={value => { if (value <= today) setDate(value) }} />
        <Button type="button" variant="ghost" icon="chevronRight" aria-label={t('Next day')} disabled={date >= today} onClick={() => setDate(shiftNutritionDate(date, 1))} />
      </div>
      <p className="small muted nutrition-day-boundary">{t('Nutrition days start at 05:00. Earlier meals belong to the previous day.')}</p>
      <NutritionTotals day={day} goals={S.nutritionGoals || {}} />
      {day.conflict && <p role="alert">{t('Daily total overlaps with meal entries. Resolve before using totals.')}</p>}
    </section>
    <section className="card nutrition-trends"><div className="nutrition-section-head"><div className="nutrition-card-title"><Icon name="chart" /><h2>{t('Intake trend')}</h2></div></div>
      <NutritionControls range={range} setRange={setRange} metric={metric} setMetric={setMetric} />
      <div className="nutrition-trend-summary"><span className="muted small">{averageLabel(metric)}</span><strong>{number(average.value)} <small>{units(metric)}</small></strong><span className="small muted">{average.days}/{range} {t('recorded days')}</span></div>
      <NutritionTrend overview={overview} metric={metric} range={range} goals={S.nutritionGoals || {}} />
      {!!weeks.length && <details className="nutrition-weekly"><summary>{t('Weekly average')}<Icon name="chevronDown" /></summary><div className="nutrition-week-list">{weeks.slice().reverse().map(w => <div className="nutrition-week-row" key={w.week}><time>{new Date(w.week+'T12:00:00').toLocaleDateString(dateLocale(),{month:'short',day:'numeric'})}</time><strong>{number(w.averages[metric].value)} <small>{units(metric)}</small></strong><span className="muted">{t('{0} recorded days',w.averages[metric].days)}</span></div>)}</div></details>}
      <p className="small muted nutrition-footnote">{t('Averages use recorded values. Missing dates and nutrients are not counted as zero.')}</p>
    </section>
    <section className="card"><div className="nutrition-section-head"><div className="nutrition-card-title"><Icon name="utensils" /><h2>{t('Meals')}</h2></div><span className="nutrition-period">{day.meals.length}</span></div>{!day.meals.length && <p className="muted">{t('No intake recorded for this date.')}</p>}{day.meals.map(e => <article key={e.id} className="nutrition-meal"><div className="row between nutrition-meal-heading"><strong><Icon name="plate" />{t(e.meal)} <small className="muted">{e.time}</small></strong><span>{show(mealEnergy(e).value)} kcal</span></div>{e.eaten_at&&<p className="small muted">{t('Actual eating time')}: {e.eaten_at}</p>}{e.items?.map(i=><p className="small" key={i.item_id}>{i.food_snapshot.name} · {i.quantity} {i.serving_id?i.food_snapshot.servings.find(s=>s.id===i.serving_id)?.name:t(i.unit)} · {t(FOOD_PREPARATION_LABELS[i.food_snapshot.preparation]||i.food_snapshot.preparation)} · {t(i.source==='Label'?'Nutrition label':i.source)}</p>)}{e.description && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{e.description}</p>}<p className="small muted">{NUTRIENTS.filter(k => k !== 'calories').map(k => `${t(labels[k])} ${show(e[k])} g`).join(' · ')}</p><p className="small muted">{t(e.source === 'Label' ? 'Nutrition label' : e.source)}</p><div className="nutrition-actions"><Button size="sm" variant="ghost" icon="pencil" onClick={() => mealSheet(date, e)}>{t('Edit')}</Button>{' '}<Button size="sm" variant="ghost" onClick={() => confirmSheet({ title: t('Delete meal?'), message: t('This removes this intake record.'), onConfirm: () => update(s => removeMeal(s, e.id)) })}>{t('Delete')}</Button></div></article>)}</section>
    <FoodLibraryLink/>
    <section className="card"><div className="nutrition-section-head"><div className="nutrition-card-title"><Icon name="target" /><h2>{t('Daily nutrition goals')}</h2></div><Button size="sm" variant="ghost" icon="pencil" onClick={() => useUI.getState().openSheet(close => <Goals close={close} />)}>{t('Edit')}</Button></div><div className="nutrition-goals">{NUTRIENTS.filter(k => k !== 'alcohol').map(k => <div key={k}><span className="small muted">{t(labels[k])}</span><strong>{number(S.nutritionGoals?.[k])} <small>{units(k)}</small></strong></div>)}</div></section>
  </div>
}
