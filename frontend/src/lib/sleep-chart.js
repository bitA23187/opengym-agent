/* Port of SleepTimelineGraph / SleepChartConstants from SleepChartKit.
 * Copyright (c) 2025 Daniel James Tronca · MIT.
 * Upstream a2f82bc463cf5a75ccb16652f2bcf572b11de1a3.
 * Full license: public/licenses/SleepChartKit.txt.
 * Changes: SVG geometry, clipping, and no connector across missing observations.
 */
export const SLEEP_STAGES = [['awake', 'Awake'], ['asleepREM', 'REM sleep'], ['asleepCore', 'Core sleep'], ['asleepDeep', 'Deep sleep'], ['asleepUnspecified', 'Unspecified sleep']]
export function sleepChartGeometry(timeline, start, end) {
  const a = Date.parse(start), b = Date.parse(end)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return { bars: [], connectors: [] }
  const x = time => 8 + (time - a) / (b - a) * 344
  const bars = timeline.flatMap(sample => {
    const row = SLEEP_STAGES.findIndex(([key]) => key === sample.category)
    const from = Math.max(a, Date.parse(sample.start)), to = Math.min(b, Date.parse(sample.end))
    if (row < 0 || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) return []
    return [{ ...sample, from, to, x: x(from), y: 8 + row * 26, width: Math.min(352 - x(from), Math.max(1, x(to) - x(from))), height: 18 }]
  }).sort((a, b) => a.from - b.from)
  const connectors = []
  bars.forEach((bar, i) => {
    const previous = bars[i - 1]
    if (!previous || previous.category === bar.category || previous.to !== bar.from) return
    const sx = x(previous.to), sy = previous.y + previous.height / 2, ex = bar.x, ey = bar.y + bar.height / 2
    connectors.push(`M ${sx} ${sy} C ${sx + (ex - sx) * .3} ${sy}, ${sx + (ex - sx) * .7} ${ey}, ${ex} ${ey}`)
  })
  return { bars, connectors }
}
