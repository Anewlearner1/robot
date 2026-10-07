import { useMemo } from 'preact/hooks'
import type { Issue, PitchPoint, ScoreKey, Scores } from '../types'
import { formatClock, SCORE_LABELS, scoreTone, UNSCORED_REASONS } from './format'
import { PitchChart } from './PitchChart'

export interface ReportData {
  scores: Scores
  issues: Issue[]
  pitchSummary: PitchPoint[]
  durationSec: number
  bpm: number | null
  keyLabel: string
}

export interface ReportViewProps {
  data: ReportData
}

const ITEM_ORDER: ScoreKey[] = ['pitch', 'rhythm', 'breath', 'vibrato']
const MAX_ISSUES = 3

function TotalScore({ total }: { total: number | null }) {
  return (
    <div class="total-score">
      <div class="total-score-label">總分</div>
      {total == null ? (
        <>
          <div class="total-score-value unscored">未評</div>
          <div class="muted small">可評分的項目不足</div>
        </>
      ) : (
        <div class={`total-score-value tone-${scoreTone(total)}`}>{Math.round(total)}</div>
      )}
    </div>
  )
}

function ScoreItem({ item, score }: { item: ScoreKey; score: number | null }) {
  return (
    <li class="score-item" data-item={item}>
      <div class="score-item-label">{SCORE_LABELS[item]}</div>
      {score == null ? (
        <>
          <div class="score-item-value unscored">未評</div>
          <div class="score-item-reason">{UNSCORED_REASONS[item]}</div>
        </>
      ) : (
        <div class={`score-item-value tone-${scoreTone(score)}`}>{Math.round(score)}</div>
      )}
    </li>
  )
}

export function IssueCard({ issue }: { issue: Issue }) {
  return (
    <li class="issue-card">
      <div class="issue-card-head">
        <span class="issue-time">
          {formatClock(issue.start)}–{formatClock(issue.end)}
        </span>
        <span class="issue-tag">{SCORE_LABELS[issue.type]}</span>
      </div>
      <p class="issue-message">{issue.message}</p>
    </li>
  )
}

/** Analysis report: total, four item scores, key, pitch curve and up to 3 issue cards. */
export function ReportView({ data }: ReportViewProps) {
  const { scores, issues, pitchSummary, durationSec, bpm, keyLabel } = data
  // Memoised so the chart is not rebuilt on unrelated re-renders.
  const top = useMemo(() => issues.slice(0, MAX_ISSUES), [issues])
  return (
    <article class="report">
      <TotalScore total={scores.total} />

      <ul class="score-grid" aria-label="分項分數">
        {ITEM_ORDER.map((k) => (
          <ScoreItem key={k} item={k} score={scores[k]} />
        ))}
      </ul>

      <dl class="report-meta">
        <div>
          <dt>調性</dt>
          <dd>{keyLabel}</dd>
        </div>
        <div>
          <dt>長度</dt>
          <dd>{formatClock(durationSec)}</dd>
        </div>
        <div>
          <dt>速度</dt>
          <dd>{bpm == null ? '未設定' : `${Math.round(bpm)} BPM`}</dd>
        </div>
      </dl>

      <section class="card">
        <h3 class="section-title">音高曲線</h3>
        <PitchChart points={pitchSummary} issues={top} />
        {top.length > 0 && <p class="muted small">色塊為需要加強的段落</p>}
      </section>

      <section>
        <h3 class="section-title">建議</h3>
        {top.length === 0 ? (
          <p class="muted">沒有明顯問題，繼續保持！</p>
        ) : (
          <ul class="issue-list">
            {top.map((is, i) => (
              <IssueCard key={`${is.start}-${i}`} issue={is} />
            ))}
          </ul>
        )}
      </section>
    </article>
  )
}
