import { useEffect, useRef, useState } from 'react'
import { healthKitStatus, enableHealthKit, syncHealthKit, disableHealthKit, onHealthKitChange } from '../lib/healthkit.js'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'
import HealthInfo from './HealthInfo.jsx'
import { nav } from '../lib/nav.js'
import Icon from './Icon.jsx'

export default function NativeHealthSync(props) { return <SyncPanel key={props.owner} {...props} /> }
function SyncPanel({ owner, onSynced }) {
  const [status, setStatus] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const callback = useRef(onSynced), lastSuccess = useRef(null), generation = useRef(0), mutating = useRef(false)
  callback.current = onSynced
  useEffect(() => {
    let alive = true, reading = false, queued = false, unsubscribe
    const refresh = async () => {
      if (!alive || mutating.current || document.visibilityState === 'hidden') return
      if (reading) { queued = true; return }
      reading = true
      const version = ++generation.current
      try {
        const next = await healthKitStatus(owner)
        if (!alive || version !== generation.current) return
        setStatus(next); setError('')
        if (next.lastSuccess && lastSuccess.current !== next.lastSuccess) {
          lastSuccess.current = next.lastSuccess
          Promise.resolve(callback.current?.()).catch(() => {})
        }
      } catch { if (alive && version === generation.current) setError(t('Could not read iPhone sync status.')) }
      finally { reading = false; if (queued) { queued = false; refresh() } }
    }
    // Subscribe before the initial read so a completion during setup cannot be lost.
    onHealthKitChange(refresh).then(remove => { if (alive) { unsubscribe = remove; refresh() } else remove() }).catch(refresh)
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
    return () => { alive = false; ++generation.current; unsubscribe?.(); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [owner])
  const run = async action => {
    if (mutating.current) return
    mutating.current = true
    const version = ++generation.current
    setBusy(true); setError('')
    try {
      await action()
      const next = await healthKitStatus(owner)
      if (version !== generation.current) return
      setStatus(next)
      if (next.lastSuccess) lastSuccess.current = next.lastSuccess
      await callback.current?.()
    } catch (e) { if (version === generation.current) setError(e.message) }
    finally { mutating.current = false; if (version === generation.current) setBusy(false) }
  }
  if (!status?.available && !error) return null
  const syncing = busy || status?.running
  return <section className="card health-sync-panel native-health-sync" aria-label={t('Apple Health sync')}>
    <div className="row between health-heading"><strong>{t('Apple Health sync')}</strong>
      <span className="native-health-state" role="status">{syncing ? t('Syncing…') : status?.enabled ? t('Automatic sync on') : t('Automatic sync off')}</span>
    </div>
    <p className="small muted health-sync-method">{t('Sync natively with Apple Health')}</p>
    <div className="health-sync-options">
      <div className="health-sync-option">
        <div className="health-sync-label"><Icon name="heart" /><strong>{t('Workout heart rate')}</strong></div>
        <p className="small muted">{t('Automatically fills in missing workout heart rate')}</p>
      </div>
      <div className="health-sync-option">
        <div className="health-sync-label"><Icon name="moon" /><strong>{t('Sleep and recovery')}</strong></div>
        <p className="small muted">{t('Sleep, resting heart rate and HRV')}</p>
      </div>
    </div>
    {status?.enabled ? <>
      <p className="small muted native-health-last-check">{status.lastSuccess ? `${t('Last completed check')}: ${new Date(status.lastSuccess).toLocaleString()}` : t('Waiting for first successful sync.')}</p>
      {!!status.pending && <p className="small muted">{t('A saved batch is waiting to retry.')}</p>}
      {status.error && <p role="alert" className="small native-health-error">{t(status.error)}</p>}
      <Button className="native-health-action" variant="tinted" disabled={syncing} onClick={() => run(() => syncHealthKit(owner))}>{syncing ? t('Syncing…') : t('Sync now')}</Button>
    </> : status?.available && <Button className="native-health-action" variant="tinted" disabled={syncing} onClick={() => run(() => enableHealthKit(owner))}>{syncing ? t('Syncing…') : t('Enable automatic sync')}</Button>}
    <div className="row between health-sync-footer">
      <button className="health-detail-link" onClick={() => nav('/daily-health', { state: { from: '/home' } })}>{t('View sleep and recovery')} <Icon name="chevronRight" /></button>
      <HealthInfo title={t('Apple Health sync')}>
        <p>{t('Uses your signed-in account. No extra upload credential or shortcut is needed. Allow Apple Health access once to sync sleep, resting heart rate, HRV and workout heart rate.')}</p>
        <p>{t('At home, let Apple Watch sync to iPhone, then open OpenGym. Sleep, resting heart rate, HRV and missing workout heart rate upload automatically. Background timing is managed by iOS.')}</p>
        {status?.enabled && <p>{t('Last check: {0} sleep changes, {1} resting heart rate changes, {2} HRV changes; {3} workouts uploaded, {4} skipped.', status.received?.sleep || 0, status.received?.restingHeartRate || 0, status.received?.hrv || 0, status.storedWorkouts || 0, status.skippedWorkouts || 0)}</p>}
        <p>{t('Zero changes can mean no new data or missing read permission. It does not confirm that Apple Watch has finished syncing. Skipped workouts are checked again next time.')}</p>
        {status?.backgroundWarning && <p>{t(status.backgroundWarning)}</p>}
        {status?.enabled && <Button variant="ghost" disabled={busy} onClick={() => run(disableHealthKit)}>{t('Stop automatic sync')}</Button>}
      </HealthInfo>
    </div>
    {error && <p role="alert" className="small native-health-error">{error}</p>}
  </section>
}
