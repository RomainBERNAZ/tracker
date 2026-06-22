import { useEffect, useMemo, useRef, useState, memo } from 'react'
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
import { api, ChipSummary, HandChipPoint, TournamentRow } from '../api'
import { CumulativeChart } from '../components/CumulativeChart'

function fmtEur(n: number) {
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}€`
}

// Unused helper - may be used in future iterations
// function deltaClassName(delta: number) {
//   if (delta > 0) return 'positive'
//   if (delta < 0) return 'negative'
//   return 'neutral'
// }

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
          <Tooltip formatter={(value: any) => [`${value}`, 'Tournois']} />
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
                formatter={(value: any, name: any) => {
                  const curve = CHIPS_CURVES.find((c) => c.key === name)
                  return [fmtChips(value as number), curve?.label ?? name]
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
  const [tournaments, setTournaments] = useState<TournamentRow[]>([])
  const [chipSummary, setChipSummary] = useState<ChipSummary | null>(null)
  const [handEvolution, setHandEvolution] = useState<HandChipPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<Period>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [activeTab, setActiveTab] = useState<'summary' | 'chips'>('summary')

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

  const filteredTournaments = useMemo(() => {
    const { fromMs, toMs } = periodToRange(period, customFrom, customTo)
    return applyDateRange(tournaments, fromMs, toMs)
  }, [period, customFrom, customTo, tournaments])

  const filteredStats = useMemo(
    () => computeFilteredStats(filteredTournaments),
    [filteredTournaments],
  )

  const { rows: sortedMultipliers } = useMemo(
    () => computeMultiplierComparison(filteredStats.totalTournaments, filteredStats.multiplierDist),
    [filteredStats.totalTournaments, filteredStats.multiplierDist],
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
          filteredFromMs={periodToRange(period, customFrom, customTo).fromMs}
          filteredToMs={periodToRange(period, customFrom, customTo).toMs}
        />
      )}
    </div>
  )
})
