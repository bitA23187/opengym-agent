import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { api } from '../lib/api.js'
import { cachedRead, refreshRead } from '../lib/read-cache.js'
import { dailyHealthPath, dailyHealthTimezone } from '../lib/daily-health-read.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import SleepOverview from './SleepOverview.jsx'
import SleepStages from './SleepStages.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

export default function SleepSummary({ todayOnly = false, from = '/stats' }) {
  const user = useStore(s => s.user)
  return <Summary key={user?.id || 'guest'} user={user} todayOnly={todayOnly} from={from} />
}
function Summary({ user, todayOnly, from }) {
  const timezone = dailyHealthTimezone()
  const nav = useNavigate(), [days, setDays] = useState(() => cachedRead(user, dailyHealthPath(30, timezone))?.days ?? null), [error, setError] = useState(false), [selected, setSelected] = useState(''), [period, setPeriod] = useState(7)
  const open = () => nav('/daily-health', { state: { from, date: todayOnly ? todayISO() : selected } })
  useEffect(() => {
    if (!user) return
    let alive = true, generation = 0
    const refresh = async () => {
      if (document.visibilityState === 'hidden') return
      const version = ++generation
      const path = dailyHealthPath(30, timezone)
      try {
        const result = await refreshRead(user, path, () => api(path), 15000)
        if (alive && version === generation) { setDays(result.days || []); setError(false) }
      } catch { if (alive && version === generation) setError(true) }
    }
    refresh()
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
    return () => { alive = false; window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [user, timezone])
  const loading = !user || days === null
  const openButton = <Button size="sm" variant="tinted" trailingIcon="chevronRight" onClick={open}>{t('Open')}</Button>
  if (todayOnly) {
    const sleep = days?.find(d => d.date === todayISO())?.sleep
    const minutes = sleep ? Math.round(sleep.minutes) : null
    return <section className="card sleep-summary" aria-label={t('Today’s sleep')}>
      <div className="row between health-heading"><div className="row" style={{ gap: 8 }}><Icon name="moon" style={{ color: 'var(--acc)' }} /><h2>{t('Today’s sleep')}</h2></div></div>
      {loading ? <p className="small muted">{t(!user ? 'Sign in to sync daily health data.' : error ? 'Could not load sleep data.' : 'Loading…')}</p> : <>
        <p className="health-value"><strong>{minutes == null ? '–' : `${Math.floor(minutes / 60)} ${t('h')} ${minutes % 60} ${t('min')}`}</strong></p>
        <p className="small muted">{todayISO()} · {t(minutes == null ? 'No sleep record' : 'Time asleep')}</p>
        {sleep && <SleepStages embedded days={days} timezone={timezone} selectedDate={todayISO()} />}
      </>}
      <div className="health-records-footer"><Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={open}>{t('All sleep records')}</Button></div>
    </section>
  }
  if (loading) return <section className="card sleep-summary"><div className="row between health-heading"><h2>{t('Sleep and recovery')}</h2>{openButton}</div><p className="small muted">{t(!user ? 'Sign in to sync daily health data.' : error ? 'Could not load sleep data.' : 'Loading…')}</p></section>
  return <SleepOverview days={days} timezone={timezone} period={period} onPeriodChange={setPeriod} compact selectedDate={selected} onSelectDate={setSelected} onOpen={open} />
}
