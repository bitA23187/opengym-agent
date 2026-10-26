import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import './SleepStages.css'
import { SLEEP_STAGES as stages, sleepChartGeometry } from '../lib/sleep-chart.js'
const duration = minutes => { const total = Math.round(minutes); return `${Math.floor(total / 60)} ${t('h')} ${total % 60} ${t('min')}` }
export default function SleepStages({ days, timezone, selectedDate, onSelectDate }) {
  const [selected, setSelected] = useState('')
  const [focused, setFocused] = useState(null)
  const available = days.filter(d => d.sleep).slice().sort((a, b) => a.date.localeCompare(b.date))
  const date = selectedDate === undefined ? selected : selectedDate
  useEffect(() => { setFocused(null) }, [date])
  const day = date ? available.find(d => d.date === date) : available.at(-1)
  const sleep = day?.sleep
  const timeline = sleep?.timeline || []
  const start = Date.parse(sleep?.start), end = Date.parse(sleep?.end)
  const { bars, connectors } = sleepChartGeometry(timeline, sleep?.start, sleep?.end)
  const stageLabel = s => `${t(stages.find(([key]) => key === s.category)[1])} · ${clock(s.start)}–${clock(s.end)} · ${duration((s.to - s.from) / 60000)}`
  const clock = at => new Intl.DateTimeFormat(undefined, { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(at))
  return <section className="card sleep-stages">
    <div className="row between health-heading"><h2>{t('Sleep stages')}</h2>{day && <label className="small">{t('Wake date')} <select aria-label={t('Wake date')} value={day.date} onChange={e => { setSelected(e.target.value); onSelectDate?.(e.target.value); setFocused(null) }}>{available.slice().reverse().map(d => <option key={d.date}>{d.date}</option>)}</select></label>}</div>
    {!day ? <p className="muted">{date ? `${date} · ${t('No sleep record')}` : t('No sleep records yet.')}</p> : <>
      <p className="health-value"><strong>{duration(sleep.mainMinutes)}</strong></p>
      <p className="small muted">{t('Main sleep')} · {clock(sleep.start)}–{clock(sleep.end)} · {timezone}</p>
      {bars.length > 0 ? <>
        <svg viewBox="0 0 360 160" onClick={e => {
          const box = e.currentTarget.getBoundingClientRect()
          if (!box.width || !box.height) return
          const x = (e.clientX - box.left) / box.width * 360, y = (e.clientY - box.top) / box.height * 160
          const distance = s => Math.hypot(Math.max(s.x - x, x - s.x - s.width, 0), Math.max(s.y - y, y - s.y - s.height, 0))
          const nearest = bars.reduce((best, s) => distance(s) < distance(best) ? s : best)
          if (distance(nearest) * box.width / 360 <= 22) setFocused(stageLabel(nearest))
        }} role="group" aria-label={t('Sleep stage timeline')}>
          {[0, .25, .5, .75, 1].map(f => <g key={f}><line x1={8 + f * 344} x2={8 + f * 344} y1="4" y2="138" className="sleep-grid" /><text x={8 + f * 344} y="155" textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}>{clock(start + f * (end - start))}</text></g>)}
          {connectors.map((d, i) => <path key={i} d={d} className="sleep-connector" />)}
          {bars.map((s, i) => {
            const label = stageLabel(s)
            return <rect key={i} className={`sleep-${s.category} sleep-stage-bar`} x={s.x} y={s.y} width={s.width} height={s.height} rx={s.height / 6} tabIndex="0" role="button" aria-label={label} onFocus={() => setFocused(label)} onClick={() => setFocused(label)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFocused(label) } }}><title>{label}</title></rect>
          })}
        </svg>
        <p className="small muted sleep-selection" aria-live="polite">{focused || t('Tap a stage to see its time and duration.')}</p>
      </> : <p className="muted">{t('Stage details were not uploaded. Sync sleep again to include them.')}</p>}
      {sleep.stageMinutes && <dl className="sleep-stage-totals">{stages.map(([key, label]) => <div key={key}><dt><i className={`sleep-${key}`} />{t(label)}</dt><dd>{duration(sleep.stageMinutes[key] || 0)}</dd></div>)}</dl>}
      <p className="small muted">{t('Stage totals include all sleep sessions on this wake date. The timeline shows the main session.')}{sleep.additionalSessions > 0 && ` ${t('Additional sessions')}: ${sleep.additionalSessions}`}</p>
      {sleep.stageMinutes?.asleepUnspecified > 0 && <p className="small muted">{t('Unspecified sleep has no stage detail, or contains conflicting stage records.')}</p>}
    </>}
    <p className="small muted sleep-credit"><a href="https://github.com/DanielJamesTronca/SleepChartKit" target="_blank" rel="noreferrer">SleepChartKit</a> · <a href="licenses/SleepChartKit.txt" target="_blank" rel="noreferrer">MIT</a></p>
  </section>
}
