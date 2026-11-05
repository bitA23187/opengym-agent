import { todayISO } from './format.js'

export const dailyHealthPrefix = '/api/daily-health?'
export const dailyHealthTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

export function dailyHealthPath(days, timezone) {
  const to = todayISO()
  const from = new Date(Date.parse(to + 'T12:00:00Z') - (days - 1) * 86400000).toISOString().slice(0, 10)
  return dailyHealthPrefix + new URLSearchParams({ from, to, timezone })
}
