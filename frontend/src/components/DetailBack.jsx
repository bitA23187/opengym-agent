import { useLocation, useNavigate } from 'react-router-dom'
import Icon from './Icon.jsx'
import { t } from '../lib/i18n.js'

export default function DetailBack() {
  const nav = useNavigate(), { state } = useLocation()
  const hasEntry = state?.from === '/home' || state?.from === '/stats'
  return <button className="iconbtn" aria-label={t('Back')} onClick={() => hasEntry ? nav(-1) : nav('/stats', { replace: true })}><Icon name="chevronLeft" /></button>
}
