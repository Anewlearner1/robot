import { useEffect, useRef } from 'preact/hooks'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { Issue, PitchPoint } from '../types'
import { formatClock, midiToName } from './format'

export interface PitchChartProps {
  /** Down-sampled pitch curve; null midi = unvoiced gap (not connected). */
  points: PitchPoint[]
  /** Issue time ranges to shade behind the curve. */
  issues?: Issue[]
  /** Chart height in CSS px (default 200). */
  height?: number
  /** Time range (s) to zoom into, e.g. a tapped issue; null/undefined = whole recording. */
  zoom?: { start: number; end: number } | null
}

/** Seconds of context shown either side of a zoomed range. */
const ZOOM_PAD_SEC = 1

function applyZoom(chart: uPlot, points: PitchPoint[], zoom: PitchChartProps['zoom']) {
  const first = points[0]?.t ?? 0
  const last = points[points.length - 1]?.t ?? 0
  const min = zoom ? Math.max(first, zoom.start - ZOOM_PAD_SEC) : first
  const max = zoom ? Math.min(last, zoom.end + ZOOM_PAD_SEC) : last
  if (max > min) chart.setScale('x', { min, max })
}

/** Read a design-system colour token from the chart container (follows light/dark mode). */
function cssVar(el: Element, name: string, fallback: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback
}

/** Integer MIDI ticks with a step that keeps roughly ≤ 8 labels. */
function midiSplits(min: number, max: number): number[] {
  const span = max - min
  const step = span <= 8 ? 1 : span <= 16 ? 2 : span <= 28 ? 4 : 12
  const out: number[] = []
  for (let m = Math.ceil(min / step) * step; m <= max; m += step) out.push(m)
  return out
}

function buildOptions(el: HTMLElement, width: number, height: number, issues: Issue[]): uPlot.Options {
  const muted = () => cssVar(el, '--text-muted', '#888')
  const grid = () => cssVar(el, '--border', '#ddd')
  return {
    width,
    height,
    legend: { show: false },
    cursor: { drag: { x: false, y: false }, points: { show: false } },
    scales: {
      x: { time: false },
      y: {
        range: (_u, min, max) =>
          min == null || max == null || !Number.isFinite(min) ? [57, 72] : [Math.floor(min) - 1, Math.ceil(max) + 1],
      },
    },
    axes: [
      {
        stroke: muted,
        grid: { stroke: grid, width: 1 },
        ticks: { show: false },
        values: (_u, splits) => splits.map((s) => formatClock(s)),
      },
      {
        stroke: muted,
        size: 44,
        grid: { stroke: grid, width: 1 },
        ticks: { show: false },
        splits: (u) => midiSplits(u.scales.y.min ?? 57, u.scales.y.max ?? 72),
        values: (_u, splits) => splits.map((s) => midiToName(s)),
      },
    ],
    series: [
      {},
      {
        label: '音高',
        stroke: () => cssVar(el, '--accent', '#5b4bdb'),
        width: 2,
        spanGaps: false,
        points: { show: false },
      },
    ],
    hooks: {
      // Shade issue regions underneath the curve.
      drawClear: [
        (u) => {
          if (!issues.length) return
          const { ctx, bbox } = u
          ctx.save()
          ctx.fillStyle = cssVar(el, '--warn', '#b26a00')
          ctx.globalAlpha = 0.18
          for (const is of issues) {
            const x0 = Math.max(bbox.left, u.valToPos(is.start, 'x', true))
            const x1 = Math.min(bbox.left + bbox.width, u.valToPos(is.end, 'x', true))
            if (x1 > x0) ctx.fillRect(x0, bbox.top, Math.max(x1 - x0, 2), bbox.height)
          }
          ctx.restore()
        },
      ],
    },
  }
}

/** Pitch curve: x = time (s, m:ss labels), y = MIDI with note-name ticks (C4, D4 …). */
export function PitchChart({ points, issues = [], height = 200, zoom = null }: PitchChartProps) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<uPlot | null>(null)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const data: uPlot.AlignedData = [points.map((p) => p.t), points.map((p) => p.midi)]
    const width = Math.max(200, el.clientWidth)
    const chart = new uPlot(buildOptions(el, width, height, issues), data, el)
    chartRef.current = chart
    applyZoom(chart, points, zoomRef.current)

    const ro =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            const w = el.clientWidth
            if (w > 0 && w !== chart.width) chart.setSize({ width: w, height })
          })
    ro?.observe(el)

    // Colours come from CSS tokens; redraw when the colour scheme flips.
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
    const onScheme = () => chart.redraw(false, true)
    mq?.addEventListener?.('change', onScheme)

    return () => {
      ro?.disconnect()
      mq?.removeEventListener?.('change', onScheme)
      chart.destroy()
      chartRef.current = null
    }
  }, [points, issues, height])

  // Zoom without rebuilding the chart.
  const zoomStart = zoom?.start
  const zoomEnd = zoom?.end
  useEffect(() => {
    if (chartRef.current) applyZoom(chartRef.current, points, zoomRef.current)
  }, [zoomStart, zoomEnd, points])

  const voiced = points.some((p) => p.midi != null)
  return (
    <div class="pitch-chart">
      <div ref={ref} class="pitch-chart-canvas" role="img" aria-label="音高曲線圖" />
      {!voiced && <p class="muted small">沒有偵測到可用的音高</p>}
    </div>
  )
}
