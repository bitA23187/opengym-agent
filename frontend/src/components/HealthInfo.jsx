import Icon from './Icon.jsx'
import { Button } from './ui.jsx'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'

// Uses the app's sheet focus, dismissal and keyboard handling.
export default function HealthInfo({ title, children }) {
  return <button className="helpbtn health-info" aria-label={t('Information about {0}', title)} onClick={() => useUI.getState().openSheet(close => <div className="health-help">
    <div className="row between"><h3>{title}</h3><Button size="sm" variant="ghost" onClick={close}>{t('Done')}</Button></div>
    {children}
  </div>)}><Icon name="info" size={20} /></button>
}
