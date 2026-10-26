import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { heartWorkoutKey, heartChartSegments } from '../lib/heart-rate.js'
import { Button } from './ui.jsx'

const time = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const labelStyle = { fontSize: 11, fill: 'var(--label-2)' }
export function HeartRateChart({ samples, start, end, setEvents = [] }) {
  if (!samples.length) return null
  const min = Math.floor(Math.min(...samples.map(s => s.bpm)) / 10) * 10 - 5
  const max = Math.ceil(Math.max(...samples.map(s => s.bpm)) / 10) * 10 + 5
  const x = at => 36 + (at - start) / Math.max(1, end - start) * 310
  const y = bpm => 148 - (bpm - min) / (max - min) * 126
  const events = setEvents.map(event => ({ ...event, ms: Date.parse(event.at) })).filter(event => Number.isFinite(event.ms) && event.ms >= start && event.ms <= end)
  return <svg viewBox="0 0 360 182" style={{ width: '100%', display: 'block' }} role="img" aria-label={t('Workout heart rate chart')}>
    {[min, (min + max) / 2, max].map(v => <g key={v}><line x1="36" x2="346" y1={y(v)} y2={y(v)} stroke="var(--sep)" /><text x="30" y={y(v) + 4} textAnchor="end" style={labelStyle}>{Math.round(v)}</text></g>)}
    {heartChartSegments(samples).map((points, i) => points.length === 1
      ? <circle key={i} cx={x(points[0].at)} cy={y(points[0].bpm)} r="2" fill="var(--acc)" />
      : <polyline key={i} points={points.map(s => `${x(s.at)},${y(s.bpm)}`).join(' ')} fill="none" stroke="var(--acc)" strokeWidth="1.5" strokeLinejoin="round" />)}
    {events.map((event, i) => <line key={i} data-set-event="" x1={x(event.ms)} x2={x(event.ms)} y1="151" y2="158" stroke="var(--label-2)" strokeWidth="1.5"><title>{t('Set logged at {0}', time(event.ms))}</title></line>)}
    <text x="36" y="174" style={labelStyle}>{time(start)}</text><text x="346" y="174" textAnchor="end" style={labelStyle}>{time(end)}</text>
  </svg>
}

export default function HeartRateSection({ w }) {
  const user = useStore(s => s.user)
  return user ? <HeartRatePanel key={user.id + ':' + heartWorkoutKey(w)} w={w} user={user} /> : null
}
function HeartRatePanel({ w, user }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const refreshVersion = useRef(0)
  const key = heartWorkoutKey(w)
  const query = '?workout_id=' + encodeURIComponent(key)
  const refresh = useCallback(async () => {
    if (!user) return
    const version = ++refreshVersion.current
    try {
      const record = await api('/api/heart-rate/workout' + query)
      if (version !== refreshVersion.current) return
      setData(record); setError('')
      if (record.workoutTimeSynced) {
        const local = useStore.getState().S.workouts.find(w => heartWorkoutKey(w) === key)
        if (local && (local.start !== record.window.start || local.end !== record.window.end)) await useStore.getState().pullState()
      }
    } catch (e) { if (version === refreshVersion.current) setError(e.status === 404 ? t('Sync this workout to the server before adding heart rate.') : e.message) }
  }, [user?.id, query, key])
  useEffect(() => { refresh(); return () => { ++refreshVersion.current } }, [refresh])
  useEffect(() => {
    const resume = () => { if (document.visibilityState !== 'hidden') refresh() }
    window.addEventListener('focus', resume); document.addEventListener('visibilitychange', resume)
    return () => { window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume) }
  }, [refresh])
  const action = async fn => {
    setBusy(true); setError('')
    try { await fn() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const clear = () => action(async () => {
    await api('/api/heart-rate/workout' + query, { method: 'DELETE' }); setDeleting(false); await refresh()
  })
  const exportData = () => action(async () => {
    const result = await api('/api/heart-rate/export' + query)
    const url = URL.createObjectURL(new Blob([JSON.stringify(result)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = `heart-rate-${w.d}.json`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
  const hasSamples = data?.samples?.length > 0
  const metrics = data?.metrics
  const setEvents = metrics?.logged_set_events ?? data?.logged_set_events ?? []
  const duration = seconds => Number.isFinite(seconds) ? t('{0} min', Math.round(seconds / 6) / 10) : '—'
  const number = value => Number.isFinite(value) ? Math.round(value * 10) / 10 : '—'
  return <section aria-label={t('Training heart rate')} style={{ margin: '16px 0', padding: '14px 0', borderTop: '1px solid var(--sep)', borderBottom: '1px solid var(--sep)' }}>
    <div className="row between"><strong>{t('Training heart rate')}</strong><span className="small muted">Apple 健康</span></div>
    {hasSamples ? <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, margin: '12px 0 4px' }}>
        <div><strong>{number(metrics ? metrics.observed_time_mean_bpm : data.summary?.sampleMean)}</strong><div className="small muted">{t(metrics ? 'Observed time average' : 'Sample average')} · bpm</div></div>
        <div><strong>{number(metrics?.min_bpm ?? data.summary?.min)}–{number(metrics?.max_bpm ?? data.summary?.max)}</strong><div className="small muted">{t('Heart rate range')} · bpm</div></div>
        <div><strong>{metrics?.sample_count ?? data.summary?.count}</strong><div className="small muted">{t('samples')}</div></div>
      </div>
      {metrics && <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, margin: '12px 0' }}>
          <div><strong>{number(metrics.sample_mean_bpm ?? data.summary?.sampleMean)}</strong><div className="small muted">{t('Sample average')} · bpm</div></div>
          <div><strong>{number(metrics.median_bpm)}</strong><div className="small muted">{t('Median heart rate')} · bpm</div></div>
          <div><strong>{number(metrics.p95_bpm)}</strong><div className="small muted">{t('95th percentile heart rate')} · bpm</div></div>
          <div><strong>{duration(metrics.workout_elapsed_seconds)}</strong><div className="small muted">{t('Workout elapsed time')}</div></div>
          <div><strong>{duration(metrics.linked_window_seconds)}</strong><div className="small muted">{t('Linked workout time')}</div></div>
          <div><strong>{duration(metrics.observed_seconds)}</strong><div className="small muted">{t('Observed heart rate time')}</div></div>
          <div><strong>{Number.isFinite(metrics.observation_ratio) ? Math.round(metrics.observation_ratio * 100) + '%' : '—'}</strong><div className="small muted">{t('Estimated time coverage')}</div></div>
          <div><strong>{metrics.gaps_over_threshold ?? '—'}</strong><div className="small muted">{t('Gaps over two minutes')}</div></div>
          <div><strong>{duration(metrics.largest_gap_seconds)}</strong><div className="small muted">{t('Largest sample gap')}</div></div>
          <div><strong>{metrics.logged_set_events_count ?? '—'}</strong><div className="small muted">{t('Timestamped set logs')}</div></div>
          <div><strong>{duration(metrics.longest_set_log_interval_seconds)}</strong><div className="small muted">{t('Longest interval between set logs')}</div></div>
        </div>
        <p className="small muted">{t('Coverage estimates time between samples no more than two minutes apart within linked workout windows. It does not measure sensor accuracy or true data completeness.')}</p>
        <p className="small muted">{t('Server-calculated metrics are also available to ChatGPT. Assess them with training load and perceived effort; they do not establish recovery status on their own.')}</p>
      </>}
      <HeartRateChart samples={data.samples} start={data.window?.start ?? w.start} end={data.window?.end ?? w.end} setEvents={setEvents} />
      {setEvents.length > 0 && <p className="small muted">{t('Short ticks below the curve mark when sets were logged.')}</p>}
      <p className="small muted">{t('The observed time average weights adjacent samples by elapsed time, includes observed rest, and excludes gaps over two minutes. It is not Apple’s workout average.')}</p>
      <p className="small muted">{t('Intervals between set logs include doing sets and delayed logging; they are not rest durations. Low heart rate or long logging gaps cannot establish rest, phone use, or training quality.')}</p>
      <p className="small muted">{t('The sample average is the arithmetic mean of recorded samples, not a time-weighted average. It may differ from Apple’s workout average. Gaps over two minutes are left blank.')}</p>
    </> : <p className="small muted">{t('No heart rate linked to this workout yet.')}</p>}
    {data?.window?.sessions?.length > 1 && <p className="small muted">{t('All Apple workouts on this date are linked to this record. Samples between their time windows are excluded.')}</p>}
    {data?.timeChanged && <p className="small muted">{t('Workout times changed. Only samples within the current times are shown; the export keeps the original data.')}</p>}
    {error && <p role="alert" className="small" style={{ color: 'var(--red)' }}>{error}</p>}
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
      <Button disabled={busy} onClick={refresh}>{t('Refresh heart rate')}</Button>
      {data?.hasStoredData && <><Button disabled={busy} onClick={exportData}>{t('Export heart rate')}</Button><Button variant="danger" disabled={busy} onClick={() => setDeleting(true)}>{t('Delete heart rate')}</Button></>}
    </div>
    {deleting && <div><p className="small">{t('Delete this workout’s imported heart rate? Your workout stays saved.')}</p><Button variant="danger" disabled={busy} onClick={clear}>{t('Confirm delete')}</Button><Button onClick={() => setDeleting(false)}>{t('Cancel')}</Button></div>}

  </section>
}
