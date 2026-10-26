import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO, uid } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { NUTRIENTS, MEALS, NUTRITION_SOURCES, putMeal, removeMeal, nutritionDay, nutritionRange, nutritionWeeks, nutritionOverview, mealEnergy } from '../lib/nutrition.js'
import { Button } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'
import LineChart from '../components/LineChart.jsx'
import DetailBack from '../components/DetailBack.jsx'
import Icon from '../components/Icon.jsx'
const labels = { calories: 'Calories', protein: 'Protein', carbs: 'Carbohydrates', fat: 'Fat', alcohol: 'Alcohol' }
const units = k => k === 'calories' ? 'kcal' : 'g'
const show = v => v == null ? '—' : String(v)
const update = fn => useStore.getState().update(fn)
const toast = msg => useUI.getState().toast(t(msg))

function MealForm({ date: initialDate, entry, close }) {
  const [form, setForm] = useState(() => ({ date: initialDate, meal: 'Lunch', source: 'Estimate', time: '', description: '', ...Object.fromEntries(NUTRIENTS.map(k => [k, ''])), ...entry }))
  const [error, setError] = useState('')
  const change = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const save = e => {
    e.preventDefault()
    if (form.date > todayISO()) { setError('Choose today or an earlier date.'); return }
    try { update(s => putMeal(s, entry?.id || uid(), form)); close(); toast('Meal saved') } catch (err) { setError(err.message) }
  }
  const energy = mealEnergy(Object.fromEntries(NUTRIENTS.map(k => [k, form[k] === '' || form[k] == null ? null : Number(form[k])])))
  return <form onSubmit={save}>
    <h3>{t(entry ? 'Edit meal' : 'Log a meal')}</h3>
    <p className="small muted">{t('Record what you ate. Leave unknown values empty; zero means none.')}</p>
    <label className="nutrition-field">{t('Date')}<input className="field" type="date" required max={todayISO()} value={form.date} onChange={e => change('date', e.target.value)} /></label>
    <label className="nutrition-field">{t('Meal')}<select className="field" value={form.meal} onChange={e => change('meal', e.target.value)}>{MEALS.map(m => <option key={m} value={m}>{t(m)}</option>)}</select></label>
    <label className="nutrition-field">{t('Time (optional)')}<input className="field" type="time" value={form.time || ''} onChange={e => change('time', e.target.value)} /></label>
    <label className="nutrition-field">{t('Food description (optional)')}<textarea className="field" rows={2} maxLength={2000} value={form.description} onChange={e => change('description', e.target.value)} /></label>
    <div className="nutrition-grid">{NUTRIENTS.map(k => <label className="nutrition-field" key={k}>{t(labels[k])} ({units(k)})<input className="field" type="number" min="0" max={k === 'calories' ? 30000 : 5000} step="0.1" value={form[k] ?? ''} onChange={e => change(k, e.target.value)} /></label>)}</div>
    <p className="small muted">{t('Alcohol is grams of pure ethanol. Enter 0 if you did not drink.')}</p>
    {energy.derived && <p className="small muted">{t('Estimated energy from nutrients')}: {energy.value} kcal</p>}
    <label className="nutrition-field">{t('Value source')}<select className="field" value={form.source} onChange={e => change('source', e.target.value)}>{NUTRITION_SOURCES.map(s => <option key={s} value={s}>{t(s === 'Label' ? 'Nutrition label' : s)}</option>)}</select></label>
    {error && <p role="alert" style={{ color: 'var(--red)' }}>{t(error)}</p>}
    <Button type="submit" variant="primary">{t('Save')}</Button>{' '}<Button type="button" variant="ghost" onClick={close}>{t('Cancel')}</Button>
  </form>
}
export function mealSheet(date = todayISO(), entry = null) { useUI.getState().openSheet(close => <MealForm date={date} entry={entry} close={close} />) }
const macros = ['protein', 'carbs', 'fat']
const number = value => value == null ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })
function NutrientProgress({ nutrient, total, goal }) {
  if (!Number.isFinite(goal) || goal <= 0 || total.value == null) return null
  return <progress className={'nutrition-progress nutrition-' + nutrient} max={goal} value={Math.min(goal, total.value)} aria-label={t('{0} reference goal', t(labels[nutrient]))} aria-valuetext={`${number(total.value)} / ${number(goal)} ${units(nutrient)}`} />
}
function MacroSummary({ totals, goals = {}, average = false }) {
  return <div className="nutrition-macros">{macros.map(k => <div className={'nutrition-macro nutrition-' + k} key={k}>
    <span className="nutrition-macro-label"><i aria-hidden="true" />{t(labels[k])}</span>
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
function NutritionTrend({ overview }) {
  const max = Math.max(1, ...overview.days.map(d => d.totals.calories.value || 0))
  return <div className="nutrition-trend" role="img" aria-label={t('Recorded energy over the last 7 days') + ': ' + overview.days.map(d => `${d.date}: ${number(d.totals.calories.value)} kcal (${t(d.totals.calories.value == null ? 'No energy data' : 'Recorded')})`).join('; ')}>
    {overview.days.map(d => {
      const value = d.totals.calories.value
      return <div className="nutrition-trend-day" key={d.date} title={`${d.date} · ${number(value)} kcal · ${t(value == null ? 'No energy data' : 'Recorded')}`}>
        <span className="nutrition-trend-value">{value == null ? '—' : Math.round(value)}</span>
        <div className="nutrition-trend-track">{value === 0 ? <span className="nutrition-trend-zero" /> : value != null ? <span className="nutrition-trend-bar" style={{ height: Math.max(3, value / max * 100) + '%' }} /> : <span className="nutrition-trend-missing" />}</div>
        <span className="nutrition-trend-date">{d.date === todayISO() ? t('Today') : new Date(d.date + 'T12:00:00Z').toLocaleDateString(dateLocale(), { weekday: 'short' })}</span>
      </div>
    })}
  </div>
}
export function NutritionCard({ from = '/home', compact = false }) {
  const S = useStore(s => s.S), nav = useNavigate(), day = nutritionDay(S, todayISO())
  const overview = compact ? nutritionOverview(S, todayISO()) : null
  const hasRecords = compact ? overview.days.some(d => d.meals.length) : day.meals.length > 0
  const energy = overview?.averages.calories
  return <section className="card nutrition-card" aria-label={t(compact ? 'Nutrition over the last 7 days' : 'Today’s nutrition')}>
    <div className="nutrition-card-heading"><div className="nutrition-card-title"><Icon name="utensils" /><h2>{t(compact ? 'Nutrition' : 'Today’s nutrition')}</h2></div>
      {compact ? <span className="nutrition-period">{t('Last 7 days')}</span> : <Button size="sm" variant="tinted" icon="plus" onClick={() => mealSheet()}>{t('Log a meal')}</Button>}
    </div>
    {!hasRecords ? <div className="nutrition-empty"><strong>{t(compact ? 'Your nutrition, over time' : 'Start with one meal')}</strong><p>{t(compact ? 'Logged days will appear here and build your averages.' : 'Log a meal to see your energy and nutrients here.')}</p></div> : compact ? <>
      <div className="nutrition-energy nutrition-average"><div><span className="nutrition-eyebrow">{t('Average daily energy')}</span><div className="nutrition-energy-number"><strong>{number(energy.value == null ? null : Math.round(energy.value))}</strong><span>kcal</span></div></div><span className="nutrition-coverage">{t('{0} / 7 recorded days', energy.days)}</span></div>
      <NutritionTrend overview={overview} />
      <div className="nutrition-chart-key"><span><i />{t('Recorded')}</span><span>— {t('No energy data')}</span></div>
      <MacroSummary totals={overview.averages} average />
    </> : <>
      <p className="nutrition-status">{t('Recorded intake')}</p>
      <NutritionTotals day={day} goals={S.nutritionGoals || {}} />
      <div className="nutrition-meal-list">{day.meals.length > 3 && <p className="small muted">{t('Latest 3 entries')}</p>}{day.meals.slice(-3).map(e => <div className="nutrition-meal-preview" key={e.id}><span>{t(e.meal)}{e.time && <small>{e.time}</small>}</span><span className="nutrition-meal-description">{e.description || t(e.source === 'Label' ? 'Nutrition label' : e.source)}</span><span>{number(mealEnergy(e).value)} <small>kcal</small></span></div>)}</div>
    </>}
    {day.conflict && !compact && <p role="alert">{t('Daily total overlaps with meal entries. Resolve before using totals.')}</p>}
    <div className="nutrition-card-footer">{compact && hasRecords && <span className="small muted">{t('Averages use recorded values.')}</span>}<Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={() => nav('/nutrition', { state: { from } })}>{t(compact ? 'View nutrition details' : 'View food log')}</Button></div>
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
  const S = useStore(s => s.S), nav = useNavigate(), [date, setDate] = useState(todayISO()), [range, setRange] = useState(30), [metric, setMetric] = useState('calories')
  const day = nutritionDay(S, date)
  const from = new Date(Date.parse(todayISO() + 'T12:00:00Z') - (range - 1) * 86400000).toISOString().slice(0, 10)
  const weeks = nutritionWeeks(S, from, todayISO(), S.weekStart ?? 1)
  const days = nutritionRange(S, from, todayISO()), recorded = days.filter(d => d.totals.calories.value != null)
  const average = recorded.length ? Math.round(recorded.reduce((n, d) => n + d.totals.calories.value, 0) / recorded.length) : null
  return <div className="narrow"><div className="hdr"><DetailBack /><div style={{ flex: 1 }}><h1>{t('Nutrition')}</h1></div></div>
    <section className="card"><div className="row between" style={{ gap: 12, flexWrap: 'wrap' }}><input aria-label={t('Date')} className="field" type="date" max={todayISO()} value={date} onChange={e => { if (e.target.value) setDate(e.target.value) }} /><Button onClick={() => mealSheet(date)}>{t('Log a meal')}</Button></div>
      <p className="small muted">{t('Recorded intake')}</p><NutritionTotals day={day} goals={S.nutritionGoals || {}} />
      {day.conflict && <p role="alert">{t('Daily total overlaps with meal entries. Resolve before using totals.')}</p>}
    </section>
    <section className="card"><h2>{t('Meals')}</h2>{!day.meals.length && <p className="muted">{t('No intake recorded for this date.')}</p>}{day.meals.map(e => <article key={e.id} className="nutrition-meal"><div className="row between"><strong>{t(e.meal)} {e.time}</strong><span>{show(mealEnergy(e).value)} kcal</span></div>{e.description && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{e.description}</p>}<p className="small muted">{NUTRIENTS.filter(k => k !== 'calories').map(k => `${t(labels[k])} ${show(e[k])} g`).join(' · ')}</p><p className="small muted">{t(e.source === 'Label' ? 'Nutrition label' : e.source)}</p><Button size="sm" variant="ghost" onClick={() => mealSheet(date, e)}>{t('Edit')}</Button>{' '}<Button size="sm" variant="ghost" onClick={() => confirmSheet({ title: t('Delete meal?'), message: t('This removes this intake record.'), onConfirm: () => update(s => removeMeal(s, e.id)) })}>{t('Delete')}</Button></article>)}</section>
    <section className="card"><div className="row between"><h2>{t('Daily nutrition goals')}</h2><Button size="sm" onClick={() => useUI.getState().openSheet(close => <Goals close={close} />)}>{t('Edit')}</Button></div>{NUTRIENTS.filter(k => k !== 'alcohol').map(k => <p key={k} className="small">{t(labels[k])}: {show(S.nutritionGoals?.[k])} {units(k)}</p>)}</section>
    <section className="card"><div className="row between"><h2>{t('Intake trend')}</h2><select aria-label={t('Date range')} className="field" value={range} onChange={e => setRange(Number(e.target.value))}><option value={7}>7 {t('days')}</option><option value={30}>30 {t('days')}</option><option value={90}>90 {t('days')}</option></select></div><p className="small muted">{t('Average recorded daily energy')}: {show(average)} kcal · {recorded.length}/{range} {t('days')}</p><select className="field" aria-label={t('Nutrient')} value={metric} onChange={e => setMetric(e.target.value)}>{NUTRIENTS.map(k => <option key={k} value={k}>{t(labels[k])}</option>)}</select><LineChart points={days.filter(d => d.totals[metric].value != null).map(d => ({ t: Date.parse(d.date + 'T12:00:00'), y: d.totals[metric].value, d: d.date }))} unit={units(metric)} /><h3>{t('Weekly average')}</h3>{weeks.map(w => <div className="nutrition-meal small" key={w.week}>{w.week} · {show(w.averages[metric].value)} {units(metric)} · {w.averages[metric].days} {t('recorded days')}</div>)}<p className="small muted">{t('Averages use recorded values. Missing dates and nutrients are not counted as zero.')}</p></section>
  </div>
}
