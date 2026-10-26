import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { api } from '../lib/api.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import SleepOverview from './SleepOverview.jsx'
import { Button } from './ui.jsx'

export default function SleepSummary() {
  const owner = useStore(s => s.user?.id)
  return <Summary key={owner || 'guest'} owner={owner} />
}
function Summary({ owner }) {
  const nav = useNavigate(), [days, setDays] = useState(null), [error, setError] = useState(false), [selected, setSelected] = useState('')
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const open = () => nav('/daily-health', { state: { from: '/stats', date: selected } })
  useEffect(() => {
    if (!owner) return
    let alive = true, generation = 0
    const refresh = async () => {
      if (document.visibilityState === 'hidden') return
      const version = ++generation, to = todayISO()
      const from = new Date(Date.parse(to + 'T12:00:00Z') - 6 * 86400000).toISOString().slice(0, 10)
      try {
        const result = await api('/api/daily-health?' + new URLSearchParams({ from, to, timezone }))
        if (alive && version === generation) { setDays(result.days || []); setError(false) }
      } catch { if (alive && version === generation) setError(true) }
    }
    refresh()
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
    return () => { alive = false; window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [owner, timezone])
  if (!owner || error || days === null) return <section className="card"><div className="row between"><h2>{t('Sleep and recovery')}</h2><Button size="sm" onClick={open}>{t('Open')}</Button></div><p className="small muted">{t(!owner ? 'Sign in to sync daily health data.' : error ? 'Could not load sleep data.' : 'Loading…')}</p></section>
  return <SleepOverview days={days} timezone={timezone} period={7} compact selectedDate={selected} onSelectDate={setSelected} onOpen={open} />
}
