import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { todayISO } from '../lib/format.js'
import { Button, Segmented } from './ui.jsx'
import { SLEEP_STAGES } from '../lib/sleep-chart.js'
import { sleepCalendar, sleepAverage, sleepScheduleSegments } from '../lib/sleep-overview.js'
import './SleepStages.css'
const duration = minutes => { const total=Math.round(minutes); return `${Math.floor(total/60)} ${t('h')} ${total%60} ${t('min')}` }
export default function SleepOverview({days, timezone, endDate=todayISO(), selectedDate, onSelectDate, period: suppliedPeriod, onPeriodChange, compact=false, onOpen}) {
  const [localPeriod,setPeriod]=useState(7),[mode,setMode]=useState('stages')
  const period=suppliedPeriod || localPeriod
  const calendar=sleepCalendar(days,endDate,period),average=sleepAverage(calendar)
  const selected=calendar.find(d=>d.date===selectedDate)||calendar.filter(d=>d.sleep).at(-1)||calendar.at(-1)
  const pick=date=>onSelectDate?.(date)
  const latest=calendar.filter(d=>d.sleep).at(-1)
  const chartDays=calendar.map(day=>({...day,segments:sleepScheduleSegments(day,timezone)}))
  const all=chartDays.flatMap(d=>d.segments)
  const low=Math.min(360, ...all.map(s=>Math.floor(s.from/240)*240))
  const high=Math.max(1200,...all.map(s=>Math.ceil(s.to/240)*240))
  const y=offset=>12+(offset-low)/(high-low)*164
  const maxHours=Math.max(12,...calendar.map(d=>Math.ceil((d.sleep?.minutes||0)/60/4)*4))
  const width=300/period, x=i=>8+i*width
  const readable=date=>`${Number(date.slice(5,7))}/${Number(date.slice(8,10))}`
  const dayLabel=day=>`${day.date} · ${day.sleep?duration(day.sleep.minutes):t('No sleep record')}`
  return <section className="card sleep-stages sleep-overview" aria-label={t('Sleep overview')}>
    <div className="row between health-heading"><h2>{t(compact ? 'Sleep and recovery' : 'Daily sleep duration')}</h2>{compact ? <Button size="sm" onClick={onOpen}>{t('Open')}</Button> : <div aria-label={t('Sleep display period')}><Segmented value={period} onChange={n=>{setPeriod(n);onPeriodChange?.(n);pick('')}} options={[7,30].map(value=>({value,label:`${value} ${t('days')}`}))} /></div>}</div>
    {compact ? <p className="small muted">{selected?.date} · {selected?.sleep ? duration(selected.sleep.minutes) : t('No sleep record')}</p> : <>
    <p className="small muted">{selected?.date} · {selectedDate ? t('Selected day') : t('Latest recorded day')}</p>
    <p className="health-value sleep-daily-value"><strong>{selected?.sleep?duration(selected.sleep.minutes):'—'}</strong></p>
    <div className="sleep-period-summary"><div><span className="small muted">{t('Average time asleep')}</span><strong>{average.minutes==null?'—':duration(average.minutes)}</strong></div><p className="small muted">{calendar[0]?.date} – {endDate}<br/>{t('{0} of {1} days recorded',average.count,period)}</p></div>
    <div className="sleep-mode" aria-label={t('Sleep chart type')}><Segmented value={mode} onChange={setMode} options={[{value:'stages',label:t('Sleep stages')},{value:'duration',label:t('Duration')}]} /></div>
    </>}
    <svg className="sleep-multiday-chart" viewBox="0 0 360 208" role="group" aria-label={t(mode==='duration'?'Daily sleep duration chart':'Multi-day sleep stages chart')} onClick={e=>{
      if(e.target.closest?.('[data-sleep-day]'))return
      const box=e.currentTarget.getBoundingClientRect(),px=(e.clientX-box.left)/box.width*360
      if(px>=8&&px<308)pick(calendar[Math.min(period-1,Math.floor((px-8)/width))].date)
    }}>
      {mode==='duration' ? Array.from({length:maxHours/4+1},(_,i)=>{
        const h=i*4,cy=176-h/maxHours*164
        return <g key={i}><line x1="8" x2="308" y1={cy} y2={cy} className="sleep-grid"/><text x="317" y={cy+4}>{Math.round(h)} {t('h')}</text></g>
      }) : Array.from({length:Math.floor((high-low)/240)+1},(_,i)=>{
        const offset=low+i*240
        const hours=((offset+720)/60%24+24)%24
        return <g key={i}><line x1="8" x2="308" y1={y(offset)} y2={y(offset)} className="sleep-grid"/><text x="317" y={y(offset)+4}>{String(hours).padStart(2,'0')}:00</text></g>
      })}
      {chartDays.map((day,i)=> <g key={day.date} data-sleep-day={day.date} role="button" tabIndex="0" aria-label={dayLabel(day)} aria-pressed={day.date===selected?.date} onFocus={()=>pick(day.date)} onClick={()=>pick(day.date)} onKeyDown={e=>{
        if(e.key==='Enter'||e.key===' '){e.preventDefault();pick(day.date)}
        if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();const next=Math.max(0,Math.min(period-1,i+(e.key==='ArrowLeft'?-1:1)));pick(calendar[next].date);e.currentTarget.parentNode.querySelector(`[data-sleep-day="${calendar[next].date}"]`)?.focus()}
      }}>
        <title>{dayLabel(day)}</title><rect x={x(i)} y="4" width={width} height="180" className={day.date===selected?.date?'sleep-column-selected':'sleep-column-hit'} />
        {mode==='duration' && day.sleep && <rect x={x(i)+width*.22} y={176-day.sleep.minutes/60/maxHours*164} width={width*.56} height={day.sleep.minutes/60/maxHours*164} rx={Math.min(3,width*.2)} className="sleep-duration-column"/>}
        {mode==='stages' && day.segments.map((s,j)=><rect key={j} x={x(i)+width*.22} y={y(s.from)} width={width*.56} height={Math.max(.65,y(s.to)-y(s.from))} rx={Math.min(2,width*.15)} className={`sleep-${s.category}`} />)}
        {!day.sleep && <text x={x(i)+width/2} y="174" textAnchor="middle" className="sleep-missing">·</text>}
        {(period===7||[0,6,13,20,period-1].includes(i))&&<text x={x(i)+width/2} y="201" textAnchor="middle">{readable(day.date)}</text>}
      </g>)}
    </svg>
    {!compact && <>
    <p className="small sleep-day-detail" aria-live="polite">{selected?dayLabel(selected):t('No sleep records yet.')}</p>
    {mode==='stages' && <><div className="sleep-overview-legend">{SLEEP_STAGES.map(([key,label])=><span key={key}><i className={`sleep-${key}`} />{t(label)}</span>)}</div><p className="small muted">{t('Stage columns show recorded sleep sessions at local clock times. Daily duration includes all sessions.')}</p>{average.count>0&&all.length===0&&<p className="small muted">{t('Stage details were not uploaded. Sync sleep again to include them.')}</p>}</>}
    <p className="small muted">{t('Missing days stay empty and are excluded from the average. Tap a day to view its details.')}</p>
    {!latest&&<p className="small muted">{t('No sleep records yet.')}</p>}
    </>}
  </section>
}
