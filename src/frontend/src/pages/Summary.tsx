import { useEffect, useMemo, useRef, useState, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PieChart,
  Pie,
  ResponsiveContainer,
  Tooltip,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
} from 'recharts'
import { api, ChipSummary, CoachBlunderSpot, CoachFormatStats, CoachStatsSnapshot, HandChipPoint, TournamentRow } from '../api'
import { CumulativeChart } from '../components/CumulativeChart'

function fmtEur(n: number) {
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}€`
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((acc, v) => acc + v, 0) / values.length
  const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (values.length - 1)
  return Math.sqrt(variance)
}

// Winamax Expresso 2 EUR public distribution provided by user (tickets / 10,000,000 draws).
const WINAMAX_2EUR_MULTIPLIER_MODEL: Array<{ mult: number; tickets: number }> = [
  { mult: 500000, tickets: 1 },
  { mult: 1000, tickets: 100 },
  { mult: 100, tickets: 2000 },
  { mult: 20, tickets: 10000 },
  { mult: 10, tickets: 100000 },
  { mult: 5, tickets: 400000 },
  { mult: 4, tickets: 800000 },
  { mult: 3, tickets: 3324202 },
  { mult: 2, tickets: 5363697 },
]

type Period = 'all' | '7d' | '30d' | 'month' | 'custom'

const PERIOD_LABELS: Record<Period, string> = {
  all: 'Tout',
  '7d': '7 jours',
  '30d': '30 jours',
  month: 'Ce mois',
  custom: 'Perso',
}

/** Parse DD/MM/YYYY → timestamp, returns null if empty or invalid. */
function parseDDMMYYYY(raw: string): number | null {
  if (!raw) return null
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw)
  if (!m) return null
  const ms = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime()
  return Number.isNaN(ms) ? null : ms
}

interface FilteredStats {
  totalTournaments: number
  totalHands: number
  totalNetEur: number
  avgNetEurPerTournament: number
  netEvEurTotal: number
  netEvEurAvg: number
  wins: number
  secondPlace: number
  thirdPlace: number
  multiplierDist: [number, number][]
}

function computeFilteredStats(tours: TournamentRow[]): FilteredStats {
  const totalTournaments = tours.length
  const totalHands = tours.reduce((acc, t) => acc + t.hand_count, 0)
  const totalNetEur = tours.reduce((acc, t) => acc + t.net_eur, 0)
  const avgNetEurPerTournament = totalTournaments > 0 ? totalNetEur / totalTournaments : 0
  const wins = tours.filter((t) => t.finish_position === 1).length
  const secondPlace = tours.filter((t) => t.finish_position === 2).length
  const thirdPlace = tours.filter((t) => t.finish_position === 3).length
  const netEvEurTotal = tours.reduce((acc, t) => acc + t.hero_net_ev_eur_sum, 0)
  const netEvEurAvg = totalTournaments > 0 ? netEvEurTotal / totalTournaments : 0
  const multiplierMap = new Map<number, number>()
  tours.forEach((t) => {
    multiplierMap.set(t.multiplier, (multiplierMap.get(t.multiplier) ?? 0) + 1)
  })
  const multiplierDist = [...multiplierMap.entries()].sort((a, b) => a[0] - b[0])
  return { totalTournaments, totalHands, totalNetEur, avgNetEurPerTournament, netEvEurTotal, netEvEurAvg, wins, secondPlace, thirdPlace, multiplierDist }
}

function applyDateRange(tours: TournamentRow[], fromMs: number | null, toMs: number | null) {
  if (fromMs == null && toMs == null) return tours
  return tours.filter((t) => {
    const ms = new Date(t.started_at).getTime()
    return !Number.isNaN(ms) && (fromMs == null || ms >= fromMs) && (toMs == null || ms <= toMs)
  })
}

function inRange(ms: number, fromMs: number | null, toMs: number | null): boolean {
  if (Number.isNaN(ms)) return false
  if (fromMs != null && ms < fromMs) return false
  if (toMs != null && ms > toMs) return false
  return true
}

function filterHandsByRange(hands: HandChipPoint[], fromMs: number | null, toMs: number | null): HandChipPoint[] {
  return hands.filter((h) => inRange(new Date(h.timestamp).getTime(), fromMs, toMs))
}

function computeMultiplierComparison(
  totalTournaments: number,
  multiplierDist: [number, number][],
): { rows: { mult: number; expectedCount: number; realCount: number }[]; chartMax: number } {
  const realMap = new Map<number, number>(multiplierDist)
  const totalTickets = WINAMAX_2EUR_MULTIPLIER_MODEL.reduce((acc, r) => acc + r.tickets, 0)
  const modeled = WINAMAX_2EUR_MULTIPLIER_MODEL.map((r) => ({
    mult: r.mult,
    expectedCount: totalTournaments > 0 ? (totalTournaments * r.tickets) / totalTickets : 0,
    realCount: realMap.get(r.mult) ?? 0,
  }))
  const others = multiplierDist
    .filter(([mult]) => !WINAMAX_2EUR_MULTIPLIER_MODEL.some((r) => r.mult === mult))
    .map(([mult, realCount]) => ({ mult, expectedCount: 0, realCount }))
  const rows = [...modeled, ...others]
    .filter((row) => row.expectedCount >= 1 || row.realCount >= 1)
    .sort((a, b) => a.mult - b.mult)
  const chartMax = rows.reduce((acc, row) => Math.max(acc, row.expectedCount, row.realCount), 1)
  return { rows, chartMax }
}

function periodToRange(period: Period, customFrom: string, customTo: string): { fromMs: number | null; toMs: number | null } {
  const now = Date.now()
  if (period === '7d') return { fromMs: now - 7 * 86_400_000, toMs: null }
  if (period === '30d') return { fromMs: now - 30 * 86_400_000, toMs: null }
  if (period === 'month') {
    const d = new Date()
    return { fromMs: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), toMs: null }
  }
  if (period === 'custom') {
    const fromMs = parseDDMMYYYY(customFrom)
    const toMs = parseDDMMYYYY(customTo)
    const toMsEnd = toMs == null ? null : toMs + 86_399_999
    return { fromMs, toMs: toMsEnd }
  }
  return { fromMs: null, toMs: null }
}

// ── Variance / luck calculation ───────────────────────────────────────────────
// σ per tournament based on the public Winamax Expresso 2€ multiplier distribution.
// Each outcome: player wins mult×buyin (if 1st) or 0, minus the buyin.
// EV = Σ p_i × net_i  (already known from hero_net_ev_eur_sum per tournament)
// σ² = Σ p_i × (net_i - EV)²
const BUY_IN = 2
const TOTAL_TICKETS = WINAMAX_2EUR_MULTIPLIER_MODEL.reduce((acc, r) => acc + r.tickets, 0)

function computePerTourneyStddev(): number {
  // For a 3-handed Expresso where hero finishes 1st, the net is (mult * BUY_IN * 3 - BUY_IN).
  // Only hero's net from their seat matters: buyin × mult × (1 seat out of 3 seats pot share minus buyin).
  // Simplified: prize = mult × BUY_IN, net = prize - BUY_IN.
  // For 2nd/3rd there is no prize in an Expresso, so net = -BUY_IN.
  // EV = Σ p_i × net_i
  const outcomes = WINAMAX_2EUR_MULTIPLIER_MODEL.map((r) => {
    const p = r.tickets / TOTAL_TICKETS
    // 3 players, hero wins 1st ~1/3 of the time they draw this mult.
    // Prize pool = mult * 3 * BUY_IN, winner takes all.
    const prize = r.mult * 3 * BUY_IN
    const netWin = prize - BUY_IN     // hero's net when 1st
    const netLoss = -BUY_IN           // hero's net when 2nd or 3rd
    const pHeroWins = 1 / 3
    const pHeroLoses = 2 / 3
    // Contribution to EV from this multiplier bucket
    const ev = p * (pHeroWins * netWin + pHeroLoses * netLoss)
    return { p, netWin, netLoss, pHeroWins, pHeroLoses, ev }
  })

  const totalEV = outcomes.reduce((acc, o) => acc + o.ev, 0)

  // Variance: E[(X - μ)²] = Σ p_bucket × (p_win × (netWin - totalEV)² + p_lose × (netLoss - totalEV)²)
  const variance = outcomes.reduce((acc, o) => {
    return acc + o.p * (
      o.pHeroWins * Math.pow(o.netWin - totalEV, 2) +
      o.pHeroLoses * Math.pow(o.netLoss - totalEV, 2)
    )
  }, 0)

  return Math.sqrt(variance)
}

const SIGMA_PER_TOURNEY = computePerTourneyStddev()

function computeLuck(net: number, ev: number, n: number): { zScore: number; sigmaTotal: number } | null {
  if (n < 2) return null
  const sigmaTotal = SIGMA_PER_TOURNEY * Math.sqrt(n)
  const zScore = (net - ev) / sigmaTotal
  return { zScore, sigmaTotal }
}

function computeEmpiricalLuck(deltaSamples: number[]): { zScore: number; sigmaTotal: number; delta: number } | null {
  const n = deltaSamples.length
  if (n < 5) return null

  const delta = deltaSamples.reduce((acc, d) => acc + d, 0)
  const mean = delta / n
  const variance = deltaSamples.reduce((acc, d) => acc + Math.pow(d - mean, 2), 0) / (n - 1)
  if (!Number.isFinite(variance) || variance <= 0) return null

  const sigmaTotal = Math.sqrt(variance * n)
  if (!Number.isFinite(sigmaTotal) || sigmaTotal <= 0) return null

  const zScore = delta / sigmaTotal
  return { zScore, sigmaTotal, delta }
}

interface PositionsPieProps {
  readonly wins: number
  readonly secondPlace: number
  readonly thirdPlace: number
}

interface CoachReview {
  score: number
  grade: 'A' | 'B' | 'C' | 'D' | 'E'
  title: string
  varianceLabel: string
  varianceColor: string
  confidenceLabel: string
  confidence: number
  evRoiPct: number
  realRoiPct: number
  runDiffEur: number
  luckZ: number | null
  allinSamples: number
  setupUnfavorable: number
  setupFavorable: number
  topRangePressure: number
  notes: string[]
  explanation: string[]
}

function gradeFromScore(score: number): CoachReview['grade'] {
  if (score >= 82) return 'A'
  if (score >= 68) return 'B'
  if (score >= 54) return 'C'
  if (score >= 40) return 'D'
  return 'E'
}

function varianceTone(luckZ: number | null): { label: string; color: string } {
  if (luckZ != null && luckZ <= -1) {
    return { label: 'Variance défavorable', color: '#ef4444' }
  }
  if (luckZ != null && luckZ >= 1) {
    return { label: 'Variance favorable', color: '#10b981' }
  }
  return { label: 'Variance standard', color: 'var(--text-dim)' }
}

function confidenceLabelFrom(confidence: number): string {
  if (confidence >= 0.85) return 'élevée'
  if (confidence >= 0.5) return 'moyenne'
  return 'faible'
}

function varianceNote(luckZ: number | null, runDiffEur: number): string {
  const diffSign = runDiffEur >= 0 ? '+' : ''
  if (luckZ == null) {
    return `Variance: échantillon encore trop faible (${diffSign}${runDiffEur.toFixed(2)}€ vs EV).`
  }
  const zSign = luckZ >= 0 ? '+' : ''
  return `Variance: ${zSign}${luckZ.toFixed(2)}σ (${diffSign}${runDiffEur.toFixed(2)}€ vs EV).`
}

function buildCoachReview(
  stats: FilteredStats,
  tournaments: TournamentRow[],
  hands: HandChipPoint[],
): CoachReview | null {
  const n = stats.totalTournaments
  if (n === 0) return null

  const totalBuyIn = BUY_IN * n
  const evRoiPct = totalBuyIn > 0 ? (stats.netEvEurTotal / totalBuyIn) * 100 : 0
  const realRoiPct = totalBuyIn > 0 ? (stats.totalNetEur / totalBuyIn) * 100 : 0
  const runDiffEur = stats.totalNetEur - stats.netEvEurTotal

  const luck = computeLuck(stats.totalNetEur, stats.netEvEurTotal, n)
  const luckZ = luck?.zScore ?? null

  const allinHands = hands.filter((h) => h.net_ev !== null)
  const allinSamples = allinHands.length
  const allinDeltas = allinHands.map((h) => h.realized_cev - (h.net_ev ?? h.realized_cev))
  const showdownDeltas = allinHands.filter((h) => h.has_showdown).map((h) => h.realized_cev - (h.net_ev ?? h.realized_cev))

  // Heuristic proxies for setup-like situations; thresholds are intentionally conservative.
  const setupUnfavorable = allinDeltas.filter((d) => d <= -120).length
  const setupFavorable = allinDeltas.filter((d) => d >= 120).length
  const topRangePressure = showdownDeltas.filter((d) => d <= -180).length

  const perTournamentNetEv = tournaments.map((t) => t.hero_net_ev_eur_sum)
  const evStd = stddev(perTournamentNetEv)
  const consistency = clamp(1 - evStd / 4, 0, 1)
  const confidence = clamp(n / 40, 0.2, 1)

  const setupBalance = setupFavorable - setupUnfavorable
  const setupScore = allinSamples > 0 ? clamp(setupBalance / Math.max(8, allinSamples) * 10, -6, 6) : 0

  const rawScore = 50 + (evRoiPct * 0.65) + (consistency * 12) + setupScore
  const score = Math.round(clamp(rawScore, 0, 100))
  const grade = gradeFromScore(score)
  const { label: varianceLabel, color: varianceColor } = varianceTone(luckZ)
  const confidenceLabel = confidenceLabelFrom(confidence)

  let title = 'Session correcte'
  if (score >= 75) title = 'Session solide'
  else if (score <= 45) title = 'Session fragile'

  const notes: string[] = [
    `Qualité EV: ${evRoiPct >= 0 ? '+' : ''}${evRoiPct.toFixed(1)}% de ROI all-in EV sur ${n} tournois.`,
    varianceNote(luckZ, runDiffEur),
    `Setups (proxy): ${setupUnfavorable} défavorables vs ${setupFavorable} favorables sur ${allinSamples} spots all-in.`,
  ]

  if (topRangePressure > 0) {
    notes.push(`Top range adverse probable (proxy showdown): ${topRangePressure} spot(s) marqué(s).`)
  }

  const explanation = [
    'La note regarde surtout le ROI EV all-in, la stabilité EV par tournoi et le balance setups favorables/défavorables.',
    'Le résultat réel n améliore pas directement la note: il sert surtout à lire la variance, pas la qualité de jeu.',
    'La confiance est affichée séparément et ne rabaisse plus mécaniquement la note des sessions courtes.',
  ]

  return {
    score,
    grade,
    title,
    varianceLabel,
    varianceColor,
    confidenceLabel,
    confidence,
    evRoiPct,
    realRoiPct,
    runDiffEur,
    luckZ,
    allinSamples,
    setupUnfavorable,
    setupFavorable,
    topRangePressure,
    notes,
    explanation,
  }
}

function luckLabel(zScore: number): { label: string; color: string } {
  const absZ = Math.abs(zScore)
  const pos = zScore >= 0
  if (absZ < 0.5) return { label: 'Variance normale', color: 'var(--text-dim)' }
  if (absZ < 1) return { label: pos ? 'Léger run good' : 'Léger run bad', color: pos ? '#10b981' : '#f59e0b' }
  if (absZ < 2) return { label: pos ? 'Run good' : 'Run bad', color: pos ? '#10b981' : '#ef4444' }
  return { label: pos ? 'Gros run good' : 'Gros run bad', color: pos ? '#10b981' : '#ef4444' }
}

const LuckIndicator = memo(({ net, ev, n }: { readonly net: number; readonly ev: number; readonly n: number }) => {
  const luck = computeLuck(net, ev, n)
  if (!luck) return null

  const { zScore, sigmaTotal } = luck
  const { label, color } = luckLabel(zScore)
  const sign = zScore >= 0 ? '+' : ''
  const delta = net - ev

  return (
    <div title={`σ total sur ${n} tournois: ±${sigmaTotal.toFixed(2)}€`} style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '4px 12px',
      borderRadius: 999,
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.1)',
      fontSize: 12,
      cursor: 'default',
    }}>
      <span style={{ color, fontWeight: 700, fontSize: 14 }}>{sign}{zScore.toFixed(2)}σ</span>
      <span style={{ color, fontWeight: 500 }}>{label}</span>
      <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>(net-EV: {delta >= 0 ? '+' : ''}{delta.toFixed(2)}€)</span>
    </div>
  )
})

const CoachReviewCard = memo(({
  review,
}: {
  readonly review: CoachReview | null
}) => {
  if (!review) return null

  return (
    <div className="summary-card" style={{ marginBottom: 16 }}>
      <div className="summary-card-header" style={{ marginBottom: 12 }}>
        <h3>Coach session (V1)</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            borderRadius: 999,
            padding: '4px 10px',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            fontSize: 12,
            color: review.varianceColor,
            fontWeight: 700,
          }}>
            {review.varianceLabel}
          </span>
          <span style={{
            borderRadius: 999,
            padding: '4px 10px',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            fontSize: 12,
            color: 'var(--text-dim)',
          }}>
            Confiance {review.confidenceLabel}
          </span>
        </div>
      </div>

      <div className="stats-bar" style={{ marginBottom: 12 }}>
        <div className="stat-card">
          <div className="label">Note session</div>
          <div className="value">{review.score}/100 ({review.grade})</div>
        </div>
        <div className="stat-card">
          <div className="label">Verdict</div>
          <div className="value">{review.title}</div>
        </div>
        <div className="stat-card">
          <div className="label">ROI réel</div>
          <div className={`value ${review.realRoiPct >= 0 ? 'positive' : 'negative'}`}>
            {review.realRoiPct >= 0 ? '+' : ''}{review.realRoiPct.toFixed(1)}%
          </div>
        </div>
        <div className="stat-card">
          <div className="label">ROI EV all-in</div>
          <div className={`value ${review.evRoiPct >= 0 ? 'positive' : 'negative'}`}>
            {review.evRoiPct >= 0 ? '+' : ''}{review.evRoiPct.toFixed(1)}%
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 6, fontSize: 13, color: 'var(--text-dim)' }}>
        {review.notes.map((note) => (
          <div key={note}>• {note}</div>
        ))}
      </div>

      <div style={{ marginTop: 12, display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-dim)' }}>
        {review.explanation.map((line) => (
          <div key={line}>• {line}</div>
        ))}
      </div>
    </div>
  )
})

function fmtPct(value: number, denominator?: number) {
  if (denominator !== undefined && denominator <= 0) return '—'
  return `${value.toFixed(1)}%`
}

const CoachPreflopStatsCard = memo(({
  title,
  stats,
}: {
  readonly title: string
  readonly stats: CoachFormatStats
}) => {
  return (
    <div className="summary-card">
      <div className="summary-card-header" style={{ marginBottom: 12 }}>
        <h3>{title}</h3>
        <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{stats.hands} mains</span>
      </div>

      <div className="stats-bar" style={{ marginBottom: 12 }}>
        <div className="stat-card">
          <div className="label">VPIP</div>
          <div className="value">{fmtPct(stats.vpip_pct, stats.hands)}</div>
        </div>
        <div className="stat-card">
          <div className="label">PFR</div>
          <div className="value">{fmtPct(stats.pfr_pct, stats.hands)}</div>
        </div>
        <div className="stat-card">
          <div className="label">3BET</div>
          <div className="value">{fmtPct(stats.three_bet_pct, stats.three_bet_opportunities)}</div>
        </div>
        <div className="stat-card">
          <div className="label">Limp</div>
          <div className="value">{fmtPct(stats.limp_pct, stats.hands)}</div>
        </div>
        <div className="stat-card">
          <div className="label">Fold vs 3BET</div>
          <div className="value">{fmtPct(stats.fold_to_three_bet_pct, stats.fold_to_three_bet_opportunities)}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 6, fontSize: 13, color: 'var(--text-dim)' }}>
        {stats.feedback.map((line) => (
          <div key={line}>• {line}</div>
        ))}
      </div>
    </div>
  )
})

function buildPriorityAlerts(snapshot: CoachStatsSnapshot | null): string[] {
  if (!snapshot) return []

  const candidates: Array<{ score: number; text: string }> = []
  const pushIf = (condition: boolean, score: number, text: string) => {
    if (condition) candidates.push({ score, text })
  }

  pushIf(
    snapshot.heads_up.hands >= 20 && snapshot.heads_up.vpip_pct < 55,
    95,
    'Priorité: trop passif en HU, ton VPIP est probablement trop bas.',
  )
  pushIf(
    snapshot.heads_up.hands >= 20 && snapshot.heads_up.vpip_count > 0 && (snapshot.heads_up.pfr_count / snapshot.heads_up.vpip_count) < 0.65,
    88,
    'Priorité: en HU tu call/limp plus que tu n’agresses.',
  )
  pushIf(
    snapshot.late_phase.hands >= 20 && snapshot.late_phase.pfr_pct < 20,
    84,
    'Priorité: late game assez passif, tu prends peu l’initiative préflop.',
  )
  pushIf(
    snapshot.mid_phase.hands >= 20 && snapshot.mid_phase.three_bet_opportunities >= 5 && snapshot.mid_phase.three_bet_pct < 5,
    74,
    'Point de vigilance: en mid game tu 3-bet très peu.',
  )
  pushIf(
    snapshot.early_phase.hands >= 20 && snapshot.early_phase.limp_pct > 10,
    70,
    'Point de vigilance: présence notable de limps en early game.',
  )
  pushIf(
    snapshot.late_phase.hands >= 20 && snapshot.late_phase.fold_to_three_bet_opportunities >= 4 && snapshot.late_phase.fold_to_three_bet_pct > 65,
    78,
    'Point de vigilance: en late tu folds beaucoup face aux 3-bets.',
  )

  const sortedCandidates = [...candidates].sort((a, b) => b.score - a.score)

  return sortedCandidates
    .slice(0, 3)
    .map((item) => item.text)
}

function useCoachData(
  coachDateSelected: boolean,
  coachDatesValid: boolean,
  fromMs: number | null,
  toMs: number | null,
) {
  const [coachSnapshot, setCoachSnapshot] = useState<CoachStatsSnapshot | null>(null)
  const [coachBlunders, setCoachBlunders] = useState<CoachBlunderSpot[]>([])
  const [coachLoading, setCoachLoading] = useState(false)

  useEffect(() => {
    if (!coachDateSelected || !coachDatesValid) {
      setCoachSnapshot(null)
      setCoachBlunders([])
      setCoachLoading(false)
      return
    }

    const fromTs = fromMs == null ? null : new Date(fromMs).toISOString()
    const toTs = toMs == null ? null : new Date(toMs).toISOString()

    let cancelled = false
    setCoachLoading(true)
    Promise.all([
      api.getCoachStats(fromTs, toTs),
      api.getCoachBlunders(fromTs, toTs, 150, 'bad'),
    ])
      .then(([snapshot, blunders]) => {
        if (cancelled) return
        setCoachSnapshot(snapshot)
        setCoachBlunders(blunders)
      })
      .catch((err) => {
        console.error(err)
        if (cancelled) return
        setCoachSnapshot(null)
        setCoachBlunders([])
      })
      .finally(() => {
        if (!cancelled) setCoachLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [coachDateSelected, coachDatesValid, fromMs, toMs])

  return { coachSnapshot, coachBlunders, coachLoading }
}

const CoachAlertsCard = memo(({ alerts }: { readonly alerts: string[] }) => {
  if (alerts.length === 0) return null

  return (
    <div className="summary-card" style={{ marginBottom: 16 }}>
      <div className="summary-card-header" style={{ marginBottom: 12 }}>
        <h3>Alertes priorité session</h3>
      </div>
      <div style={{ display: 'grid', gap: 8, fontSize: 13, color: 'var(--text-dim)' }}>
        {alerts.map((alert) => (
          <div key={alert}>• {alert}</div>
        ))}
      </div>
    </div>
  )
})

const CoachBlundersCard = memo(({
  blunders,
  onOpenReplay,
}: {
  readonly blunders: CoachBlunderSpot[]
  readonly onOpenReplay: (handId: string) => void
}) => {
  const [actionFilter, setActionFilter] = useState<'all' | 'call' | 'push'>('all')
  const [severityFilter, setSeverityFilter] = useState<'all' | 'bad' | 'critical'>('all')

  const filtered = useMemo(
    () => blunders.filter((spot) => {
      if (actionFilter !== 'all' && spot.action_kind !== actionFilter) return false
      if (severityFilter !== 'all' && spot.severity !== severityFilter) return false
      return true
    }),
    [blunders, actionFilter, severityFilter],
  )

  if (blunders.length === 0) {
    return (
      <div className="summary-card" style={{ marginBottom: 16 }}>
        <div className="summary-card-header" style={{ marginBottom: 8 }}>
          <h3>Blunders call/push (V1)</h3>
        </div>
        <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
          Aucun gros raté call/push détecté sur la période.
        </p>
      </div>
    )
  }

  const criticalCount = blunders.filter((s) => s.severity === 'critical').length
  const callCount = blunders.filter((s) => s.action_kind === 'call').length
  const pushCount = blunders.filter((s) => s.action_kind === 'push').length

  return (
    <div className="summary-card" style={{ marginBottom: 16 }}>
      <div className="summary-card-header" style={{ marginBottom: 12 }}>
        <h3>Blunders call/push (V1)</h3>
      </div>

      <div className="stats-bar" style={{ marginBottom: 12 }}>
        <div className="stat-card">
          <div className="label">Spots retenus</div>
          <div className="value">{blunders.length}</div>
        </div>
        <div className="stat-card">
          <div className="label">Critiques</div>
          <div className="value negative">{criticalCount}</div>
        </div>
        <div className="stat-card">
          <div className="label">Calls</div>
          <div className="value">{callCount}</div>
        </div>
        <div className="stat-card">
          <div className="label">Pushes</div>
          <div className="value">{pushCount}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <select
          className="filter-input"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value as 'all' | 'call' | 'push')}
          aria-label="Filtre action blunders"
          style={{ maxWidth: 180 }}
        >
          <option value="all">Action: toutes</option>
          <option value="call">Action: call</option>
          <option value="push">Action: push</option>
        </select>
        <select
          className="filter-input"
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value as 'all' | 'bad' | 'critical')}
          aria-label="Filtre gravite blunders"
          style={{ maxWidth: 180 }}
        >
          <option value="all">Gravité: toutes</option>
          <option value="bad">Gravité: mauvais</option>
          <option value="critical">Gravité: critique</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
          Aucun spot pour ce filtre.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Action</th>
                <th>Stacks</th>
                <th>EV</th>
                <th>Equity</th>
                <th>Motif</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 30).map((spot) => (
                <tr key={`${spot.hand_id}-${spot.action_type}`}>
                  <td>{new Date(spot.timestamp).toLocaleString('fr-FR')}</td>
                  <td>
                    <span style={{
                      borderRadius: 999,
                      padding: '2px 8px',
                      background: 'rgba(255,255,255,0.05)',
                      border: `1px solid ${spot.severity === 'critical' ? 'rgba(239,68,68,0.6)' : 'rgba(245,158,11,0.6)'}`,
                      color: spot.severity === 'critical' ? '#ef4444' : '#f59e0b',
                      fontSize: 12,
                      fontWeight: 700,
                    }}>
                      {spot.action_kind.toUpperCase()} · {spot.severity === 'critical' ? 'CRITIQUE' : 'MAUVAIS'}
                    </span>
                  </td>
                  <td>{spot.hero_stack_bb.toFixed(1)}bb · {spot.action_amount_bb.toFixed(1)}bb</td>
                  <td className="negative">{spot.net_ev_bb.toFixed(1)}bb</td>
                  <td>{spot.allin_equity == null ? '—' : `${(spot.allin_equity * 100).toFixed(1)}%`}</td>
                  <td style={{ color: 'var(--text-dim)' }}>{spot.reason}</td>
                  <td>
                    <button
                      type="button"
                      className="back-link"
                      onClick={() => onOpenReplay(spot.hand_id)}
                      style={{ margin: 0 }}
                    >
                      Replay
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
})

const CoachTabPanel = memo(({
  coachFrom,
  coachTo,
  setCoachFrom,
  setCoachTo,
  coachDateSelected,
  coachDatesValid,
  coachLoading,
  coachSnapshot,
  coachReview,
  priorityAlerts,
  coachBlunders,
  onOpenReplay,
}: {
  readonly coachFrom: string
  readonly coachTo: string
  readonly setCoachFrom: (value: string) => void
  readonly setCoachTo: (value: string) => void
  readonly coachDateSelected: boolean
  readonly coachDatesValid: boolean
  readonly coachLoading: boolean
  readonly coachSnapshot: CoachStatsSnapshot | null
  readonly coachReview: CoachReview | null
  readonly priorityAlerts: string[]
  readonly coachBlunders: CoachBlunderSpot[]
  readonly onOpenReplay: (handId: string) => void
}) => {
  return (
    <>
      <div className="summary-card" style={{ marginBottom: 16 }}>
        <div className="summary-card-header" style={{ marginBottom: 8 }}>
          <h3>Filtre coach (dates)</h3>
        </div>
        <div className="summary-custom-dates" style={{ marginTop: 0 }}>
          <input
            className="filter-input summary-date-input"
            type="text"
            placeholder="JJ/MM/AAAA"
            value={coachFrom}
            maxLength={10}
            onChange={(e) => setCoachFrom(e.target.value)}
            aria-label="Date de debut coach"
          />
          <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>→</span>
          <input
            className="filter-input summary-date-input"
            type="text"
            placeholder="JJ/MM/AAAA"
            value={coachTo}
            maxLength={10}
            onChange={(e) => setCoachTo(e.target.value)}
            aria-label="Date de fin coach"
          />
        </div>
        <p style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 8 }}>
          Vide = pas de limite. Ce filtre est independant du filtre Summary.
        </p>
      </div>

      {!coachDateSelected && (
        <div className="summary-card">
          <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
            Selectionne au moins une date pour afficher le board coach.
          </p>
        </div>
      )}

      {coachDateSelected && !coachDatesValid && (
        <div className="summary-card">
          <p style={{ color: 'var(--red)', fontSize: 13 }}>
            Renseigne des dates valides au format JJ/MM/AAAA.
          </p>
        </div>
      )}

      {coachDateSelected && coachDatesValid && coachLoading && (
        <div className="summary-card">
          <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>Chargement du board coach…</p>
        </div>
      )}

      {coachDateSelected && coachDatesValid && !coachLoading && coachSnapshot && (
        <>
          <CoachAlertsCard alerts={priorityAlerts} />
          <CoachBlundersCard blunders={coachBlunders} onOpenReplay={onOpenReplay} />
          <CoachReviewCard review={coachReview} />
          <div className="summary-grid">
            <CoachPreflopStatsCard title="Early · 3-way niveaux 1-3" stats={coachSnapshot.early_phase} />
            <CoachPreflopStatsCard title="Mid · 3-way niveaux 4-6" stats={coachSnapshot.mid_phase} />
            <CoachPreflopStatsCard title="Late · 3-way niveaux 7+" stats={coachSnapshot.late_phase} />
            <CoachPreflopStatsCard title="Heads-up" stats={coachSnapshot.heads_up} />
          </div>
        </>
      )}
    </>
  )
})

const SummaryPositionsPie = memo(({ wins, secondPlace, thirdPlace }: PositionsPieProps) => {
  const data = useMemo(() => [
    { name: '1st', value: wins, fill: '#10b981' },
    { name: '2nd', value: secondPlace, fill: '#6b7280' },
    { name: '3rd', value: thirdPlace, fill: '#ef4444' },
  ].filter((d) => d.value > 0), [wins, secondPlace, thirdPlace])

  const totalTournaments = wins + secondPlace + thirdPlace
  if (totalTournaments === 0) {
    return <p style={{ color: 'var(--text-dim)' }}>Aucune données</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <ResponsiveContainer width="100%" height={120}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={35}
            outerRadius={55}
            paddingAngle={1}
            dataKey="value"
            isAnimationActive={false}
          />
          <Tooltip formatter={(value) => [String(value ?? ''), 'Tournois']} />
        </PieChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 16, fontSize: 12, justifyContent: 'center' }}>
        {data.map((d) => (
          <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: d.fill }} />
            <span style={{ color: 'var(--text-dim)' }}>{d.name} {d.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
})

const SummaryMultiplierChart = memo(({ sortedMultipliers }: {
  readonly sortedMultipliers: { mult: number; expectedCount: number; realCount: number }[]
}) => {
  if (sortedMultipliers.length === 0) {
    return <p style={{ color: 'var(--text-dim)' }}>Aucune donnee</p>
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: 8 }}>
      {sortedMultipliers.map((row) => {
        const delta = row.realCount - row.expectedCount
        const isDelta = delta !== 0

        let borderColor: string
        if (!isDelta) {
          borderColor = '255,255,255'
        } else if (delta > 0) {
          borderColor = '16,185,129'
        } else {
          borderColor = '239,68,68'
        }
        const borderStyle = isDelta ? `1px solid rgba(${borderColor},0.3)` : '1px solid rgba(255,255,255,0.1)'
        
        return (
          <div
            key={row.mult}
            style={{
              padding: 8,
              background: 'rgba(255,255,255,0.03)',
              borderRadius: 6,
              textAlign: 'center',
              fontSize: 12,
              border: borderStyle,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>x{row.mult}</div>
            <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>
              R: {row.realCount}
            </div>
            <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>
              A: {row.expectedCount.toFixed(1)}
            </div>
            {isDelta && (
              <div style={{ color: delta > 0 ? '#10b981' : '#ef4444', fontSize: 11, marginTop: 4, fontWeight: 500 }}>
                {delta > 0 ? '+' : ''}{delta.toFixed(1)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
})

type ChipsCurveKey = 'cev' | 'ev' | 'wsd' | 'sd'

const CHIPS_CURVES: Array<{ key: ChipsCurveKey; label: string; stroke: string; dash?: string }> = [
  { key: 'cev', label: 'cEV réel', stroke: '#6c63ff' },
  { key: 'ev', label: 'cEV EV', stroke: '#7f89b8', dash: '6 3' },
  { key: 'wsd', label: 'WSD', stroke: '#10b981', dash: '4 2' },
  { key: 'sd', label: 'Showdown', stroke: '#f59e0b', dash: '4 2' },
]

const SummaryChipsTab = memo(({ chipSummary, handEvolution, filteredFromMs, filteredToMs }: {
  readonly chipSummary: ChipSummary | null
  readonly handEvolution: HandChipPoint[]
  readonly filteredFromMs: number | null
  readonly filteredToMs: number | null
}) => {
  const [activeCurves, setActiveCurves] = useState<Set<ChipsCurveKey>>(
    () => new Set(['cev', 'ev'] as ChipsCurveKey[]),
  )
  const chartRef = useRef<HTMLDivElement | null>(null)
  const chartHeaderRef = useRef<HTMLDivElement | null>(null)
  const chartTogglesRef = useRef<HTMLDivElement | null>(null)
  const [chartHeight, setChartHeight] = useState(400)

  useEffect(() => {
    const el = chartRef.current
    if (!el) return undefined

    const update = () => {
      const rect = el.getBoundingClientRect()
      const viewportBottomPadding = 20
      const headerHeight = chartHeaderRef.current?.offsetHeight ?? 48
      const togglesHeight = chartTogglesRef.current?.offsetHeight ?? 56
      const cardStaticArea = headerHeight + togglesHeight + 32
      const available = globalThis.window.innerHeight - rect.top - viewportBottomPadding - cardStaticArea
      const safeHeight = Math.min(560, Math.max(220, available))
      setChartHeight(safeHeight)
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    if (chartHeaderRef.current) observer.observe(chartHeaderRef.current)
    if (chartTogglesRef.current) observer.observe(chartTogglesRef.current)
    globalThis.window.addEventListener('resize', update)
    return () => {
      globalThis.window.removeEventListener('resize', update)
      observer.disconnect()
    }
  }, [])

  const filteredHands = useMemo(
    () => handEvolution.filter((h) => {
      const ts = new Date(h.timestamp).getTime()
      if (filteredFromMs != null && ts < filteredFromMs) return false
      if (filteredToMs != null && ts > filteredToMs) return false
      return true
    }),
    [handEvolution, filteredFromMs, filteredToMs],
  )

  const chipsLuck = useMemo(() => {
    const deltas = filteredHands.map((h) => h.realized_cev - (h.net_ev ?? h.realized_cev))
    return computeEmpiricalLuck(deltas)
  }, [filteredHands])

  const chartData = useMemo(() => {
    let cumCev = 0
    let cumEv = 0
    let cumWsd = 0
    let cumSd = 0
    const points: Array<{ label: string; cev: number; ev: number; wsd: number; sd: number }> = [
      { label: '', cev: 0, ev: 0, wsd: 0, sd: 0 },
    ]
    filteredHands.forEach((h, idx) => {
      cumCev += h.realized_cev
      cumEv += h.net_ev ?? h.realized_cev
      if (h.has_showdown) {
        cumSd += h.realized_cev
      } else {
        cumWsd += h.realized_cev
      }
      points.push({ label: `${idx + 1}`, cev: cumCev, ev: cumEv, wsd: cumWsd, sd: cumSd })
    })
    return points
  }, [filteredHands])

  function toggleCurve(key: ChipsCurveKey) {
    setActiveCurves((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        if (next.size > 1) next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const fmtChips = (n: number) => `${n > 0 ? '+' : ''}${n}`

  return (
    <div>
      <div className="stats-bar" style={{ marginBottom: 16 }}>
        <div className="stat-card">
          <div className="label">Net (chips)</div>
          <div className={`value ${(chipSummary?.net_chips ?? 0) >= 0 ? 'positive' : 'negative'}`}>
            {fmtChips(chipSummary?.net_chips ?? 0)}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">NetEV (chips)</div>
          <div className={`value ${(chipSummary?.net_ev_chips ?? 0) >= 0 ? 'positive' : 'negative'}`}>
            {fmtChips(chipSummary?.net_ev_chips ?? 0)}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">cEV moyen (chips/game)</div>
          <div className={`value ${(chipSummary?.avg_cev_per_game ?? 0) >= 0 ? 'positive' : 'negative'}`}>
            {(chipSummary?.avg_cev_per_game ?? 0) > 0 ? '+' : ''}{chipSummary?.avg_cev_per_game?.toFixed(1) ?? '—'}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">WSD net (chips)</div>
          <div className={`value ${(chipSummary?.wsd_net_chips ?? 0) >= 0 ? 'positive' : 'negative'}`}>
            {fmtChips(chipSummary?.wsd_net_chips ?? 0)}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">SD net (chips)</div>
          <div className={`value ${(chipSummary?.sd_net_chips ?? 0) >= 0 ? 'positive' : 'negative'}`}>
            {fmtChips(chipSummary?.sd_net_chips ?? 0)}
          </div>
        </div>
      </div>

      <div className="summary-card" ref={chartRef}>
        <div className="summary-card-header" ref={chartHeaderRef}>
          <h3>Évolution cumulée (chips) — {chartData.length - 1} mains</h3>
          {chipsLuck ? (
            <div
              title={`σ total sur ${chartData.length - 1} mains: ±${chipsLuck.sigmaTotal.toFixed(0)} chips`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 12px',
                borderRadius: 999,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                fontSize: 12,
                cursor: 'default',
              }}
            >
              {(() => {
                const { label, color } = luckLabel(chipsLuck.zScore)
                const sign = chipsLuck.zScore >= 0 ? '+' : ''
                const delta = chipsLuck.delta
                return (
                  <>
                    <span style={{ color, fontWeight: 700, fontSize: 14 }}>{sign}{chipsLuck.zScore.toFixed(2)}σ</span>
                    <span style={{ color, fontWeight: 500 }}>{label}</span>
                    <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>(net-EV: {delta >= 0 ? '+' : ''}{delta.toFixed(0)})</span>
                  </>
                )
              })()}
            </div>
          ) : null}
        </div>

        {chartData.length < 2 ? (
          <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>Pas assez de données.</p>
        ) : (
          <ResponsiveContainer width="100%" height={chartHeight}>
            <LineChart data={chartData} margin={{ top: 10, right: 16, bottom: 4, left: 8 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: '#a9b0c8', fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: '#a9b0c8', fontSize: 11 }} tickLine={false} axisLine={false} width={64} tickFormatter={fmtChips} />
              <Tooltip
                contentStyle={{ background: '#1a1d2e', border: '1px solid #2a2d3e', borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: '#a9b0c8', marginBottom: 4 }}
                formatter={(value, name) => {
                  const numericValue = typeof value === 'number' ? value : Number(value ?? 0)
                  const seriesName = String(name ?? '')
                  const curve = CHIPS_CURVES.find((c) => c.key === seriesName)
                  return [fmtChips(Number.isFinite(numericValue) ? numericValue : 0), curve?.label ?? seriesName]
                }}
                isAnimationActive={false}
              />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
              {CHIPS_CURVES.map((curve) =>
                activeCurves.has(curve.key) ? (
                  <Line
                    key={curve.key}
                    dataKey={curve.key}
                    stroke={curve.stroke}
                    strokeWidth={curve.key === 'cev' ? 2 : 1.5}
                    dot={false}
                    strokeDasharray={curve.dash}
                    name={curve.key}
                    isAnimationActive={false}
                  />
                ) : null,
              )}
            </LineChart>
          </ResponsiveContainer>
        )}

        <div className="chips-curve-toggles" ref={chartTogglesRef}>
          {CHIPS_CURVES.map((curve) => {
            const isActive = activeCurves.has(curve.key)
            return (
              <button
                key={curve.key}
                type="button"
                onClick={() => toggleCurve(curve.key)}
                className={`chips-curve-btn ${isActive ? 'chips-curve-btn-active' : ''}`}
                style={isActive ? { borderColor: curve.stroke, color: curve.stroke } : {}}
              >
                <span className="chips-curve-btn-dot" style={{ background: isActive ? curve.stroke : 'var(--text-dim)' }} />
                {curve.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
})

export default memo(function Summary() {
  const navigate = useNavigate()
  const [tournaments, setTournaments] = useState<TournamentRow[]>([])
  const [chipSummary, setChipSummary] = useState<ChipSummary | null>(null)
  const [handEvolution, setHandEvolution] = useState<HandChipPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<Period>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [activeTab, setActiveTab] = useState<'summary' | 'chips' | 'coach'>('summary')
  const [coachFrom, setCoachFrom] = useState('')
  const [coachTo, setCoachTo] = useState('')

  useEffect(() => {
    Promise.all([api.getTournaments(), api.getChipSummary(), api.getChipEvolution()])
      .then(([t, chips, evolution]) => {
        setTournaments(t)
        setChipSummary(chips)
        setHandEvolution(evolution)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const filteredRange = useMemo(
    () => periodToRange(period, customFrom, customTo),
    [period, customFrom, customTo],
  )

  const filteredTournaments = useMemo(() => {
    return applyDateRange(tournaments, filteredRange.fromMs, filteredRange.toMs)
  }, [filteredRange.fromMs, filteredRange.toMs, tournaments])

  const coachRange = useMemo(() => {
    const fromMs = parseDDMMYYYY(coachFrom)
    const toMsRaw = parseDDMMYYYY(coachTo)
    const toMs = toMsRaw == null ? null : toMsRaw + 86_399_999
    return { fromMs, toMs }
  }, [coachFrom, coachTo])

  const coachDateSelected = coachFrom.trim().length > 0 || coachTo.trim().length > 0
  const coachDatesValid =
    (coachFrom.trim().length === 0 || coachRange.fromMs != null) &&
    (coachTo.trim().length === 0 || coachRange.toMs != null)

  const { coachSnapshot, coachBlunders, coachLoading } = useCoachData(
    coachDateSelected,
    coachDatesValid,
    coachRange.fromMs,
    coachRange.toMs,
  )

  const coachTournaments = useMemo(
    () => applyDateRange(tournaments, coachRange.fromMs, coachRange.toMs),
    [tournaments, coachRange.fromMs, coachRange.toMs],
  )

  const coachStats = useMemo(
    () => computeFilteredStats(coachTournaments),
    [coachTournaments],
  )

  const coachHands = useMemo(
    () => filterHandsByRange(handEvolution, coachRange.fromMs, coachRange.toMs),
    [handEvolution, coachRange.fromMs, coachRange.toMs],
  )

  const filteredStats = useMemo(
    () => computeFilteredStats(filteredTournaments),
    [filteredTournaments],
  )

  const { rows: sortedMultipliers } = useMemo(
    () => computeMultiplierComparison(filteredStats.totalTournaments, filteredStats.multiplierDist),
    [filteredStats.totalTournaments, filteredStats.multiplierDist],
  )

  const coachReview = useMemo(
    () => buildCoachReview(coachStats, coachTournaments, coachHands),
    [coachStats, coachTournaments, coachHands],
  )

  const priorityAlerts = useMemo(
    () => buildPriorityAlerts(coachSnapshot),
    [coachSnapshot],
  )

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Chargement…</p>

  return (
    <div>
      <div className="page-header">
        <div className="summary-header-row">
          <div>
            <h1>Session Summary</h1>
            <p>{filteredStats.totalTournaments} tournois · {filteredStats.totalHands} mains</p>
          </div>
          <div className="period-pill-bar">
            {(['all', '7d', '30d', 'month', 'custom'] as Period[]).map((p) => (
              <button
                key={p}
                type="button"
                className={`period-pill${period === p ? ' period-pill-active' : ''}`}
                onClick={() => setPeriod(p)}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        </div>
        {period === 'custom' && (
          <div className="summary-custom-dates">
            <input
              className="filter-input summary-date-input"
              type="text"
              placeholder="JJ/MM/AAAA"
              value={customFrom}
              maxLength={10}
              onChange={(e) => setCustomFrom(e.target.value)}
              aria-label="Date de debut"
            />
            <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>→</span>
            <input
              className="filter-input summary-date-input"
              type="text"
              placeholder="JJ/MM/AAAA"
              value={customTo}
              maxLength={10}
              onChange={(e) => setCustomTo(e.target.value)}
              aria-label="Date de fin"
            />
          </div>
        )}
      </div>

      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <button
          onClick={() => setActiveTab('summary')}
          style={{
            padding: '8px 16px',
            background: activeTab === 'summary' ? 'rgba(255,255,255,0.1)' : 'transparent',
            border: 'none',
            color: activeTab === 'summary' ? 'var(--text)' : 'var(--text-dim)',
            cursor: 'pointer',
            borderBottom: activeTab === 'summary' ? '2px solid var(--accent)' : 'none',
            fontSize: 14,
            fontWeight: activeTab === 'summary' ? '600' : '400',
          }}
        >
          Résumé
        </button>
        <button
          onClick={() => setActiveTab('chips')}
          style={{
            padding: '8px 16px',
            background: activeTab === 'chips' ? 'rgba(255,255,255,0.1)' : 'transparent',
            border: 'none',
            color: activeTab === 'chips' ? 'var(--text)' : 'var(--text-dim)',
            cursor: 'pointer',
            borderBottom: activeTab === 'chips' ? '2px solid var(--accent)' : 'none',
            fontSize: 14,
            fontWeight: activeTab === 'chips' ? '600' : '400',
          }}
        >
          Jetons
        </button>
        <button
          onClick={() => setActiveTab('coach')}
          style={{
            padding: '8px 16px',
            background: activeTab === 'coach' ? 'rgba(255,255,255,0.1)' : 'transparent',
            border: 'none',
            color: activeTab === 'coach' ? 'var(--text)' : 'var(--text-dim)',
            cursor: 'pointer',
            borderBottom: activeTab === 'coach' ? '2px solid var(--accent)' : 'none',
            fontSize: 14,
            fontWeight: activeTab === 'coach' ? '600' : '400',
          }}
        >
          Coach
        </button>
      </div>

      {/* Summary Tab */}
      {activeTab === 'summary' && (
        <>
          <div className="summary-card" style={{ marginBottom: 16 }}>
            <h3>Gains (€)</h3>
            <div className="stats-bar" style={{ marginBottom: 0 }}>
              <div className="stat-card">
                <div className="label">Tournois</div>
                <div className="value">{filteredStats.totalTournaments}</div>
              </div>
              <div className="stat-card">
                <div className="label">Mains</div>
                <div className="value">{filteredStats.totalHands}</div>
              </div>
              <div className="stat-card">
                <div className="label">Net total</div>
                <div className={`value ${filteredStats.totalNetEur >= 0 ? 'positive' : 'negative'}`}>
                  {fmtEur(filteredStats.totalNetEur)}
                </div>
              </div>
              <div className="stat-card">
                <div className="label">Moyenne / tournoi</div>
                <div className={`value ${filteredStats.avgNetEurPerTournament >= 0 ? 'positive' : 'negative'}`}>
                  {fmtEur(filteredStats.avgNetEurPerTournament)}
                </div>
              </div>
              <div className="stat-card">
                <div className="label">Net EV all-in (€)</div>
                <div className={`value ${filteredStats.netEvEurTotal >= 0 ? 'positive' : 'negative'}`}>
                  {fmtEur(filteredStats.netEvEurTotal)}
                </div>
              </div>
              <div className="stat-card">
                <div className="label">Net EV all-in / tournoi (€)</div>
                <div className={`value ${filteredStats.netEvEurAvg >= 0 ? 'positive' : 'negative'}`}>
                  {fmtEur(filteredStats.netEvEurAvg)}
                </div>
              </div>
            </div>
          </div>

          <div className="summary-grid">
            <div className="summary-card">
              <h3>Positions</h3>
              <SummaryPositionsPie
                wins={filteredStats.wins}
                secondPlace={filteredStats.secondPlace}
                thirdPlace={filteredStats.thirdPlace}
              />
            </div>

            <div className="summary-card">
              <h3>Multiplicateurs: attendus vs reels</h3>
              <SummaryMultiplierChart sortedMultipliers={sortedMultipliers} />
            </div>
          </div>

          <div className="summary-card" style={{ marginBottom: 16, marginTop: 24 }}>
            <div className="summary-card-header">
              <h3>Évolution cumulative</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <LuckIndicator net={filteredStats.totalNetEur} ev={filteredStats.netEvEurTotal} n={filteredStats.totalTournaments} />
                <div className="chart-legend">
                  <span className="chart-legend-item chart-legend-net">Net réel</span>
                  <span className="chart-legend-item chart-legend-ev">Net EV</span>
                </div>
              </div>
            </div>
            <CumulativeChart tournaments={filteredTournaments} />
          </div>
        </>
      )}

      {/* Chips Tab */}
      {activeTab === 'chips' && (
        <SummaryChipsTab
          chipSummary={chipSummary}
          handEvolution={handEvolution}
          filteredFromMs={filteredRange.fromMs}
          filteredToMs={filteredRange.toMs}
        />
      )}

      {activeTab === 'coach' && (
        <CoachTabPanel
          coachFrom={coachFrom}
          coachTo={coachTo}
          setCoachFrom={setCoachFrom}
          setCoachTo={setCoachTo}
          coachDateSelected={coachDateSelected}
          coachDatesValid={coachDatesValid}
          coachLoading={coachLoading}
          coachSnapshot={coachSnapshot}
          coachReview={coachReview}
          priorityAlerts={priorityAlerts}
          coachBlunders={coachBlunders}
          onOpenReplay={(handId) => navigate(`/hands/${handId}/replay`)}
        />
      )}
    </div>
  )
})
