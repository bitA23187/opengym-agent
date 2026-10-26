import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { Button } from '../components/ui.jsx'
import Login from './Login.jsx'
import Icon from '../components/Icon.jsx'

export const normalizeWatchCode = value => String(value || '').toUpperCase().replace(/[ -]/g, '')
const validCode = value => /^[A-HJ-NP-Z2-9]{8}$/.test(value)

export default function WatchPairing() {
  const user = useStore(s => s.user)
  const location = useLocation()
  const code = normalizeWatchCode(new URLSearchParams(location.search).get('code'))
  if (!user) return <>
    <div className="narrow" style={{ paddingTop: 20 }}><p className="card">{t('Sign in to connect the Apple Watch in your hand. You will review the request before binding.')}</p></div>
    <Login allowGuest={false} />
  </>
  return <WatchPairingView key={user.id + ':' + code} user={user} code={code} />
}

function WatchPairingView({ user, code }) {
  const navigate = useNavigate()
  const [draft, setDraft] = useState(code), [request, setRequest] = useState(null)
  const [devices, setDevices] = useState([]), [name, setName] = useState('')
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(validCode(code)), [error, setError] = useState('')
  const alive = useRef(true), [removing, setRemoving] = useState(null)
  const refreshDevices = async () => {
    const result = await api('/api/watch-devices')
    if (alive.current) setDevices(result.devices || [])
  }
  useEffect(() => {
    alive.current = true
    refreshDevices().catch(e => { if (alive.current) setError(e.message) })
    if (validCode(code)) {
      api('/api/watch-pair?code=' + encodeURIComponent(code))
        .then(value => { if (alive.current) setRequest(value) })
        .catch(e => { if (alive.current) setError(e.message) })
        .finally(() => { if (alive.current) setLoading(false) })
    }
    return () => { alive.current = false }
  }, [code])
  const decide = async approve => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const result = await api('/api/watch-pair/approve', { method: 'POST', body: JSON.stringify({ code, approve, ...(approve ? { name: name.trim() || 'Apple Watch' } : {}) }) })
      if (!alive.current) return
      setRequest(previous => ({ ...previous, status: result.status }))
      await refreshDevices()
    } catch (e) { if (alive.current) setError(e.message) }
    finally { if (alive.current) setBusy(false) }
  }
  const revoke = async id => {
    if (busy) return
    setBusy(true); setError('')
    try {
      await api('/api/watch-devices/revoke', { method: 'POST', body: JSON.stringify({ id }) })
      if (!alive.current) return
      setRemoving(null); await refreshDevices()
    } catch (e) { if (alive.current) setError(e.message) }
    finally { if (alive.current) setBusy(false) }
  }
  return <div className="narrow" style={{ paddingTop: 20, paddingBottom: 32 }}>
    <Link to="/daily-health" className="small muted">← {t('Sleep and recovery')}</Link>
    <h1>{t('Connect Apple Watch')}</h1>
    <p className="muted">{t('Signed in as')} <strong>{user.name || user.id}</strong></p>
    {loading && <p role="status">{t('Loading binding request…')}</p>}
    {error && <p role="alert" className="card" style={{ color: 'var(--red)' }}>{error}</p>}
    {request?.status === 'pending' && <form className="card watch-binding" aria-label={t('Watch binding request')} onSubmit={event => { event.preventDefault(); decide(true) }}>
      <div className="watch-binding-heading"><Icon name="watch" size={28} /><h2>Apple Watch</h2></div>
      <label htmlFor="watch-name">{t('Watch nickname')} <span className="muted small">{t('Optional')}</span></label>
      <input id="watch-name" className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Apple Watch" maxLength={60} autoComplete="off" disabled={busy} aria-describedby="watch-name-hint" />
      <p id="watch-name-hint" className="small muted">{t('A name helps distinguish your watches. Leave blank to use Apple Watch.')}</p>
      <Button type="submit" variant="primary" disabled={busy}>{t(busy ? 'Binding…' : 'Bind this watch')}</Button>
    </form>}
    {request?.status === 'approved' && <section className="card" role="status">
      <h2>{t('Approved')}</h2><p>{t('Return to your watch and keep OpenGym open to finish connecting.')}</p>
      <p className="small muted">{t('HealthKit read permission is granted separately on the watch.')}</p>
    </section>}
    {request?.status === 'denied' && <p className="card" role="status">{t('Binding rejected. Generate a new code on the watch to try again.')}</p>}
    {!request && !loading && <form className="card" onSubmit={event => {
      event.preventDefault()
      const normalized = normalizeWatchCode(draft)
      if (!validCode(normalized)) { setError(t('Enter the eight-character code shown on the watch.')); return }
      if (normalized === code) { navigate(0); return }
      navigate('/watch-pair?code=' + normalized, { replace: true })
    }}>
      <label htmlFor="watch-code">{t('Code shown on watch')}</label>
      <input id="watch-code" className="input" value={draft} onChange={e => setDraft(e.target.value)} autoCapitalize="characters" autoComplete="off" maxLength={12} placeholder="ABCD-EFGH" />
      <div style={{ height: 12 }} /><Button type="submit" variant="primary">{t('Review request')}</Button>
    </form>}
    <h2 style={{ marginTop: 30 }}>{t('Connected watches')}</h2>
    {!devices.length && <p className="muted">{t('No connected watches.')}</p>}
    {devices.map(device => <section className="card" key={device.id}>
      <strong>{device.name}</strong>
      <p className="small muted">{new Date(device.createdAt).toLocaleString()}</p>
      {removing === device.id ? <>
        <p>{t('Stop this watch from uploading health data?')}</p>
        <Button disabled={busy} onClick={() => revoke(device.id)}>{t('Confirm removal')}</Button>
        <Button disabled={busy} onClick={() => setRemoving(null)}>{t('Cancel')}</Button>
      </> : <Button disabled={busy} onClick={() => setRemoving(device.id)}>{t('Remove watch')}</Button>}
    </section>)}
  </div>
}
