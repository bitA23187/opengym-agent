export const heartWorkoutKey = w => w.id != null ? String(w.id) : `${w.d}|${w.start}`
export function heartShortcutUrl(w) {
  return 'shortcuts://run-shortcut?name=' + encodeURIComponent('OpenGym 心率同步') + '&input=text&text=' + encodeURIComponent(JSON.stringify({ date: w.d, workout_id: heartWorkoutKey(w) }))
}
// Preserve extrema while limiting rendering work. Stored and exported samples stay complete.
// Break a line at gaps over two minutes; don't invent measurements across missing data.
export function heartChartSegments(samples, maxBuckets = 180) {
  const segments = []
  let part = []
  for (const p of samples) {
    if (part.length && p.at - part.at(-1).at > 120000) { segments.push(part); part = [] }
    part.push(p)
  }
  if (part.length) segments.push(part)
  return segments.map(points => {
    const size = Math.max(1, Math.ceil(points.length / maxBuckets))
    const result = []
    for (let i = 0; i < points.length; i += size) {
      const bucket = points.slice(i, i + size)
      const lo = bucket.reduce((a, b) => a.bpm < b.bpm ? a : b)
      const hi = bucket.reduce((a, b) => a.bpm > b.bpm ? a : b)
      result.push(...[...new Set([bucket[0], lo, hi, bucket.at(-1)])].sort((a, b) => a.at - b.at))
    }
    return result
  })
}
