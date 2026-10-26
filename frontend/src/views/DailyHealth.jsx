import { launchHealthShortcut } from '../lib/health-shortcut.js'
import { useCallback, useEffect, useState, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { api, appBase } from '../lib/api.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { Button, Segmented } from '../components/ui.jsx'
import HealthInfo from '../components/HealthInfo.jsx'
import LineChart from '../components/LineChart.jsx'
import SleepStages from '../components/SleepStages.jsx'
import SleepOverview from '../components/SleepOverview.jsx'
import DetailBack from '../components/DetailBack.jsx'
import { useHealthKitClient } from '../lib/useHealthKitClient.js'
import { canUseHealthShortcuts } from '../lib/health-platform.js'
import { confirmSheet } from '../sheets.jsx'
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
export default function DailyHealth() {
  const user = useStore(s => s.user)
  return <DailyHealthView key={user?.id || 'guest'} />
}
function DailyHealthView() {
  const native = useHealthKitClient()
  const { state: routeState } = useLocation()
  const user = useStore(s => s.user), [range, setRange] = useState(30), [data, setData] = useState(null), [launching, setLaunching] = useState(false), [error, setError] = useState('')
  const [sleepDate, setSleepDate] = useState(() => /^\d{4}-\d{2}-\d{2}$/.test(routeState?.date || '') ? routeState.date : ''), [sleepPeriod,setSleepPeriod] = useState(7)
  const generation = useRef(0)
  const refresh = useCallback(async () => {
    if (!user || native === null) return
    const version = ++generation.current
    const from = new Date(Date.parse(todayISO() + 'T12:00:00Z') - (Math.max(30,range) - 1) * 86400000).toISOString().slice(0, 10)
    try { const d = await api('/api/daily-health?' + new URLSearchParams({ from, to: todayISO(), timezone: zone() })); if (version !== generation.current) return; setData(d); setError('') } catch (e) { if (version === generation.current) setError(e.message) }
  }, [range, user?.id, native])
  useEffect(() => { refresh(); const resume = () => { if (document.visibilityState !== 'hidden') refresh() }; window.addEventListener('focus', resume); document.addEventListener('visibilitychange', resume); return () => { ++generation.current; window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume) } }, [refresh])
  const download = async () => { try { const result = await api('/api/daily-health/export'); const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'opengym-daily-health.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) } catch (e) { setError(e.message) } }
  const sleepWindowStart = new Date(Date.parse(todayISO() + 'T12:00:00Z') - (sleepPeriod - 1) * 86400000).toISOString().slice(0,10)
  const sleepMonthStart = new Date(Date.parse(todayISO() + 'T12:00:00Z') - 29 * 86400000).toISOString().slice(0,10)
  const sleepSelection = sleepDate || (data?.days || []).filter(d => d.sleep && d.date >= sleepWindowStart).at(-1)?.date || todayISO()
  const pickSleepDate = date => { setSleepDate(date); if (date && date < sleepWindowStart) setSleepPeriod(30) }
  if (!user) return <div className="narrow"><div className="hdr"><DetailBack /><div style={{ flex: 1 }}><h1>{t('Sleep and recovery')}</h1></div></div><p>{t('Sign in to sync daily health data.')}</p></div>
  return <div className="narrow health-page"><div className="hdr"><DetailBack /><div className="row health-heading" style={{ flex: 1 }}><h1>{t('Sleep and recovery')}</h1>
      <HealthInfo title={t('Sleep and recovery')}>
        <p>{t('Missing values stay empty. Compare your own trend; no recovery score is inferred.')}</p>
        <p>{t('Sleep is assigned to its wake date. Overlapping sleep counts once; in-bed time is excluded. One source is selected per day.')}</p>
        <p>{t('Daily median SDNN. Values from other HRV methods are not comparable.')}</p>
        <p>{t('Latest resting-heart-rate sample each day, read directly from Apple Health.')}</p>
        <p className="small muted">{zone()}</p>
      </HealthInfo></div></div>
    {native === false && canUseHealthShortcuts() && <section className="card"><div className="row between health-heading"><h2>{t('Sleep and recovery sync')}</h2>
      <HealthInfo title={t('Sleep and recovery sync')}>
        <p>{t('Install the shortcut once, then start sync from this page. No credential setup is needed. Keep your iPhone unlocked.')}</p>
        <p>{t('Keep your iPhone unlocked and allow access to Health when asked.')}</p>
      </HealthInfo></div>
      <Button variant="tinted" disabled={launching} onClick={async () => { setLaunching(true); setError(''); try { await launchHealthShortcut('OpenGym 日常健康同步') } catch (e) { setError(e.message) } finally { setLaunching(false) } }}>{t('Sync sleep and recovery')}</Button>
      <p className="small"><a href={appBase().replace(/\/$/, '') + '/shortcuts/daily-health/v5/' + encodeURIComponent('OpenGym 日常健康同步.shortcut')}>{t('Download sleep and recovery shortcut')}</a></p>
    </section>}
    <SleepOverview days={data?.days || []} timezone={zone()} selectedDate={sleepSelection} onSelectDate={pickSleepDate} period={sleepPeriod} onPeriodChange={setSleepPeriod} />
    <SleepStages days={(data?.days || []).filter(d => d.date >= sleepMonthStart)} timezone={zone()} selectedDate={sleepSelection} onSelectDate={pickSleepDate} />
    <h2>{t('Recovery trends')}</h2>
    <div className="row between health-toolbar"><Segmented value={range} onChange={setRange} options={[7, 30, 90].map(n => ({value:n,label:n + ' ' + t('days')}))} /><Button size="sm" variant="ghost" onClick={refresh}>{t('Refresh')}</Button></div>
    {[['restingHeartRate', 'Resting heart rate', 'bpm', d => d.restingHeartRate?.value], ['hrv', 'HRV (SDNN)', 'ms', d => d.hrv?.value]].map(([key, label, unit, value]) => {
      const days = (data?.days || []).filter(d => value(d) != null && d.date >= new Date(Date.parse(todayISO() + 'T12:00:00Z') - (range - 1) * 86400000).toISOString().slice(0,10)), latest = days.at(-1), points = days.map(d => ({ t: Date.parse(d.date + 'T12:00:00'), y: Math.round(value(d) * 10) / 10, d: d.date }))
      return <section className="card health-metric" key={key}><div className="row between health-heading"><h2>{t(label)}</h2>{latest && <span className="small muted">{latest.date}</span>}</div>{latest && <p className="health-value"><strong>{Math.round(value(latest) * 10) / 10}</strong> <span className="muted">{unit}</span></p>}<LineChart points={points} unit={unit} /></section>
    })}
    <p className="small"><Link to="/watch-pair">{t('Manage connected watches')}</Link></p>
    <details className="health-data"><summary>{t('Health data')}</summary>
      <p className="small muted">{t('Health data stays on your server. Server backups include it; app JSON backups do not. Use the export below for a separate copy.')}</p>
      <div className="health-actions"><Button size="sm" onClick={download}>{t('Export daily health')}</Button><Button size="sm" variant="danger" onClick={() => confirmSheet({ title: t('Delete daily health data?'), message: t('This removes sleep, resting heart rate and HRV from this server.'), onConfirm: async () => { try { await api('/api/daily-health', { method: 'DELETE' }); await refresh() } catch (e) { setError(e.message) } } })}>{t('Delete daily health data')}</Button></div>
    </details>
    {error && <p role="alert" style={{ color: 'var(--red)' }}>{error}</p>}
  </div>
}
