import Icon from './Icon.jsx'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import './DatePicker.css'

// Shared calendar input for daily records, including dates without observations.
export default function DatePicker({ value, onChange, label = 'Date', max = todayISO(), min }) {
  return <label className="date-picker"><Icon name="calendar" /><span className="small">{t(label)}</span><input aria-label={t(label)} className="field" type="date" min={min} max={max} value={value} onChange={e => { if (e.target.value) onChange(e.target.value) }} /></label>
}
