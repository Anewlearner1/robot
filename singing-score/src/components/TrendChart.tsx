import { useEffect, useRef } from 'preact/hooks'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

export interface TrendPoint {
  /** Unix time in seconds. */
  x: number
  /** 0–100, or null for 未評 (drawn as a gap). */
  y: number | null
}

interface Props {
  points: TrendPoint[]
  /** Series name, e.g. "總分". */
  label: string
  height?: number
}

function cssVar(el: Element, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim()
  return v || fallback
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Score trend over time (PRD F7): x = date, y = 0–100, points + line, nulls are gaps. */
export function TrendChart({ points, label, height = 220 }: Props) {
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const text = cssVar(el, '--text-muted', cssVar(el, '--text', '#9ca3af'))
    const grid = cssVar(el, '--border', 'rgba(128,128,128,0.25)')
    const accent = cssVar(el, '--accent', '#c084fc')
    const surface = cssVar(el, '--surface', cssVar(el, '--bg', '#16171d'))

    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    const span = xs.length > 1 ? xs[xs.length - 1] - xs[0] : 0
    const withTime = span < 2 * 86400

    const axis = { stroke: text, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid, width: 1 }, font: '12px system-ui, sans-serif' }
    const opts: uPlot.Options = {
      width: Math.max(200, el.clientWidth || 320),
      height,
      legend: { show: false },
      cursor: { drag: { x: false, y: false }, points: { size: 9 } },
      scales: {
        x: { time: true },
        y: { range: [0, 100] },
      },
      axes: [
        {
          ...axis,
          space: 56,
          values: (_u, splits) =>
            splits.map((s) => {
              const d = new Date(s * 1000)
              const day = `${d.getMonth() + 1}/${d.getDate()}`
              return withTime ? `${day}\n${pad2(d.getHours())}:${pad2(d.getMinutes())}` : day
            }),
        },
        { ...axis, size: 36, splits: () => [0, 20, 40, 60, 80, 100] },
      ],
      series: [
        {},
        {
          label,
          stroke: accent,
          width: 2,
          spanGaps: false,
          points: { show: true, size: 8, stroke: accent, fill: surface, width: 2 },
        },
      ],
    }
    const plot = new uPlot(opts, [xs, ys] as uPlot.AlignedData, el)

    let ro: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        const w = el.clientWidth
        if (w > 0 && Math.abs(w - plot.width) > 1) plot.setSize({ width: w, height })
      })
      ro.observe(el)
    }
    return () => {
      ro?.disconnect()
      plot.destroy()
    }
  }, [points, label, height])

  return <div class="trend-chart" ref={box} role="img" aria-label={`${label}趨勢圖`} />
}
