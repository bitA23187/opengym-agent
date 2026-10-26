import { launchHealthShortcut } from '../lib/health-shortcut.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { nav } from '../lib/nav.js'
import { useStore } from '../store/useStore.js'
import { api, appBase } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'
import HealthInfo from './HealthInfo.jsx'
import NativeHealthSync from './NativeHealthSync.jsx'
import Icon from './Icon.jsx'
import { useHealthKitClient } from '../lib/useHealthKitClient.js'
import { canUseHealthShortcuts } from '../lib/health-platform.js'

export default function HeartRateSync() {
  const user = useStore(s => s.user)
  const native = useHealthKitClient()
  if (!user || native === null) return null
  if (native) return <NativeHealthSync owner={user.id} onSynced={() => useStore.getState().pullState()} />
  // Shortcuts run on iPhone. Other browsers and native Android have no local sync action.
  if (!canUseHealthShortcuts()) return null
  return <SyncPanel key={user.id} />
}
function SyncPanel() {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const generation = useRef(0)
  const refresh = useCallback(async () => {
    const version = ++generation.current
    setRefreshing(true)
    try {
      const pending = await api('/api/heart-rate/pending')
      if (version !== generation.current) return
      setStatus(pending); setError('')
    } catch (e) { if (version === generation.current) setError(e.message) }
    finally { if (version === generation.current) setRefreshing(false) }
  }, [])
  useEffect(() => {
    refresh()
    const resume = () => { if (document.visibilityState !== 'hidden') refresh() }
    window.addEventListener('focus', resume); document.addEventListener('visibilitychange', resume)
    return () => { ++generation.current; window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume) }
  }, [refresh])
  useEffect(() => {
    if (!waiting) return
    const resume = () => {
      if (document.visibilityState !== 'hidden') {
        useStore.getState().pullState().catch(() => {})
        setWaiting(false)
      }
    }
    window.addEventListener('focus', resume); document.addEventListener('visibilitychange', resume)
    return () => { window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume) }
  }, [waiting])
  const sync = async shortcut => {
    setBusy(true); setError('')
    try { await launchHealthShortcut(shortcut); setWaiting(true) }
    catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }
  return <section className="card health-sync-panel" aria-label={t('Apple Health sync')}>
    <div className="row between health-heading">
      <strong>{t('Apple Health sync')}</strong>
      <button className="helpbtn health-info" aria-label={t('Refresh')} disabled={refreshing} onClick={refresh}><Icon name="reset" size={20} /></button>
    </div>
    <p className="small muted health-sync-method">{t('Sync from iPhone using Shortcuts')}</p>
    <div className="health-sync-options">
      <div className="health-sync-option">
        <div className="health-sync-label"><Icon name="heart" /><strong>{t('Workout heart rate')}</strong></div>
        <p className="small muted" role="status">{status ? t('{0} workouts missing heart rate.', status.pending) : t('Checking sync status…')}</p>
        <Button variant="tinted" disabled={busy || !status?.pending} onClick={() => sync('OpenGym 一键同步心率')}>{t('Sync heart rate')}</Button>
      </div>
      <div className="health-sync-option">
        <div className="health-sync-label"><Icon name="moon" /><strong>{t('Sleep and recovery')}</strong></div>
        <p className="small muted">{t('Sleep, resting heart rate and HRV')}</p>
        <Button variant="tinted" disabled={busy} onClick={() => sync('OpenGym 日常健康同步')}>{t('Sync sleep and recovery')}</Button>
      </div>
    </div>
    {!!status?.skippedAmbiguous && <p className="small muted">{t('{0} same-day workouts were skipped because matching is ambiguous. Check their dates and times manually.', status.skippedAmbiguous)}</p>}
    {waiting && <p className="small muted" role="status">{t('Finish the shortcut on your iPhone, then return here.')}</p>}
    <div className="row between health-sync-footer">
      <button className="health-detail-link" onClick={() => nav('/daily-health', { state: { from: '/home' } })}>{t('View sleep and recovery')} <Icon name="chevronRight" /></button>
      <HealthInfo title={t('Apple Health sync')}>
        <p>{t('Install the shortcut once, then start sync from this page. No credential setup is needed. Keep your iPhone unlocked.')}</p>
        <p><a href={appBase().replace(/\/$/, '') + '/shortcuts/v6/' + encodeURIComponent('OpenGym 一键同步心率.shortcut')}>{t('Download heart rate shortcut')}</a></p>
        <p><a href={appBase().replace(/\/$/, '') + '/shortcuts/daily-health/v5/' + encodeURIComponent('OpenGym 日常健康同步.shortcut')}>{t('Download sleep and recovery shortcut')}</a></p>
      </HealthInfo>
    </div>
    {error && <p role="alert" className="small" style={{ color: 'var(--red)' }}>{error}</p>}
  </section>
}
