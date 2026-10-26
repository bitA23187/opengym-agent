// Meals are independently stamped map entries. Cleared entries remain as tombstones.
export const NUTRIENTS = ['calories', 'protein', 'carbs', 'fat', 'alcohol']
export const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Daily total']
export const NUTRITION_SOURCES = ['Estimate', 'Label', 'Weighed estimate', 'GPT estimate']
export const validNutritionDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && Number.isFinite(Date.parse(d)) && new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) === d
export function cleanMeal(input) {
  if (!validNutritionDate(input.date) || !MEALS.includes(input.meal)) throw Error('Choose a valid date and meal.')
  if (input.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) throw Error('Choose a valid meal time.')
  const out = { date: input.date, meal: input.meal, time: input.time || '', description: String(input.description || '').trim().slice(0, 2000), source: NUTRITION_SOURCES.includes(input.source) ? input.source : 'Estimate' }
  for (const k of NUTRIENTS) {
    const v = input[k]
    if (v == null || v === '') out[k] = null
    else {
      const n = typeof v === 'number' ? v : Number(v)
      if (!Number.isFinite(n) || n < 0 || n > (k === 'calories' ? 30000 : 5000)) throw Error('Enter valid non-negative nutrition values.')
      out[k] = Math.round(n * 10) / 10
    }
  }
  if (!NUTRIENTS.some(k => out[k] != null)) throw Error('Enter at least one nutrition value.')
  return out
}
export function mealsOn(S, date) {
  return Object.entries(S?.nutritionEntries || {}).filter(([, e]) => e?.date === date && MEALS.includes(e.meal)).map(([id, e]) => ({ ...e, id })).sort((a, b) => (a.time || '').localeCompare(b.time || '') || a.id.localeCompare(b.id))
}
export function mealEnergy(e) {
  if (e.calories != null) return { value: e.calories, derived: false }
  // Alcohol must be explicitly recorded, including zero, before deriving total energy.
  if (['protein', 'carbs', 'fat', 'alcohol'].some(k => e[k] == null)) return { value: null, derived: false }
  return { value: Math.round((4 * e.protein + 4 * e.carbs + 9 * e.fat + 7 * e.alcohol) * 10) / 10, derived: true }
}
export function nutritionDay(S, date) {
  const meals = mealsOn(S, date)
  const conflict = meals.some(e => e.meal === 'Daily total') && meals.length > 1
  const totals = Object.fromEntries(NUTRIENTS.map(k => {
    const values = meals.map(e => k === 'calories' ? mealEnergy(e).value : e[k])
    const known = values.filter(v => v != null && Number.isFinite(v))
    return [k, { value: known.length && !conflict ? Math.round(known.reduce((a, b) => a + b, 0) * 10) / 10 : null, known: !!meals.length && known.length === meals.length && !conflict }]
  }))
  return { date, meals, totals, conflict }
}
export function putMeal(S, id, input, now = Date.now()) {
  const entry = cleanMeal(input)
  const others = mealsOn(S, entry.date).filter(e => e.id !== id)
  if (others.some(e => e.meal === 'Daily total') || entry.meal === 'Daily total' && others.length) throw Error('Use either meal entries or one daily total. Remove the existing entries first.')
  S.nutritionEntries = { ...S.nutritionEntries, [id]: { ...entry, _ts: now } }
}
export function removeMeal(S, id, now = Date.now()) {
  S.nutritionEntries = { ...S.nutritionEntries, [id]: { _ts: now } }
}
export function nutritionRange(S, from, to) {
  const dates = [...new Set(Object.values(S?.nutritionEntries || {}).map(e => e?.date).filter(d => d && d >= from && d <= to))].sort()
  return dates.map(d => nutritionDay(S, d))
}

// Means use recorded values; missing dates/nutrients are unknown, never zero.
export function nutritionWeeks(S, from, to, weekStart = 1) {
  const weeks = new Map()
  for (const day of nutritionRange(S, from, to)) {
    const date = new Date(day.date + 'T12:00:00Z')
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() - weekStart + 7) % 7)
    const key = date.toISOString().slice(0, 10)
    if (!weeks.has(key)) weeks.set(key, [])
    weeks.get(key).push(day)
  }
  return [...weeks].map(([week, days]) => ({ week, loggedDays: days.length,
    averages: Object.fromEntries(NUTRIENTS.map(k => { const known = days.filter(d => d.totals[k].value != null); return [k, { value: known.length ? Math.round(known.reduce((n, d) => n + d.totals[k].value, 0) / known.length * 10) / 10 : null, days: known.length }] })) }))
}

// A fixed calendar window preserves missing days; averages retain per-nutrient coverage.
export function nutritionOverview(S, endDate, length = 7) {
  const end = Date.parse(endDate + 'T12:00:00Z')
  const days = Array.from({ length }, (_, i) => nutritionDay(S, new Date(end - (length - 1 - i) * 86400000).toISOString().slice(0, 10)))
  const averages = Object.fromEntries(NUTRIENTS.map(k => {
    const known = days.filter(d => d.totals[k].value != null)
    return [k, { value: known.length ? Math.round(known.reduce((n, d) => n + d.totals[k].value, 0) / known.length * 10) / 10 : null, days: known.length }]
  }))
  return { days, averages }
}
