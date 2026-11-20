import { useEffect, useMemo, useState, memo, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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
import { api } from '../api'
import type {
  CoachBlunderSpot, CoachFormatStats, CoachStatsSnapshot, HandChipPoint, HandReviewEntry, ShortStackSnapshot,
  StackStatsSnapshot, TournamentRow,
} from '../api'
import { CumulativeChart } from '../components/CumulativeChart'
import { filterChipHands, summarizeChips } from './summaryChips'
import { TournamentFilters } from '../components/TournamentFilters'
import { HandFormatFilter, HeroStackFilter } from './StackHandFilters'
import { STACK_BUCKETS, stackDiagnostics, toggleStackBucket } from './stackAnalysis'
import type { StackFormat } from './stackAnalysis'
import Variance from './Variance'
import SummaryStacks from './SummaryStacks'
import SummaryAllIns from './SummaryAllIns'
import { createReviewState } from '../reviewState'
import { WINAMAX_2EUR_MULTIPLIER_MODEL } from './expressoModel'
import { DEFAULT_FILTER, applyTournamentRange, calendarDayRange, computeFilteredStats, endOfDay, formatDateInput, handsForTournaments, parseDateInput, periodToRange, tournamentBuyIn } from './tournamentFilters'
import { combineCounts } from './hittingBoardStats'
import type { TournamentFlops } from './hittingBoardStats'
import { summarizeAllInRunout } from './coachAnalysis'

const useSummaryFilter = createReviewState(() => DEFAULT_FILTER)
const useSummaryTab = createReviewState<'summary' | 'chips' | 'stacks' | 'allins' | 'variance' | 'coach'>(() => 'summary')
const useCoachFrom = createReviewState(() => '')
const useCoachTo = createReviewState(() => '')
const useCoachAction = createReviewState<'all' | 'call' | 'push'>(() => 'all')
const useCoachSeverity = createReviewState<'all' | 'bad' | 'critical'>(() => 'all')
const MODEL_BUY_IN_EUR = 2

function fmtEur(n: number) {
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}€`
}

type FilteredStats = ReturnType<typeof computeFilteredStats>

function computeMultiplierComparison(
  totalTournaments: number,
  multiplierDist: [number, number][],
  supportsTheoreticalModel: boolean,
): { mult: number; expectedCount: number | null; realCount: number }[] {
  if (!supportsTheoreticalModel) {
    return multiplierDist.map(([mult, realCount]) => ({ mult, realCount, expectedCount: null }))
  }
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
  return rows
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
  realRoiPct: number
  allinSamples: number
  allinMissing: number
  realizedChips: number | null
  expectedChips: number | null
  deltaChips: number | null
  bbSamples: number
  deltaBb: number | null
}

function buildCoachReview(
  stats: FilteredStats,
  tournaments: TournamentRow[],
  hands: HandChipPoint[],
): CoachReview | null {
  if (stats.totalTournaments === 0) return null
  const totalBuyIn = tournaments.reduce((sum, t) => sum + tournamentBuyIn(t), 0)
  const realRoiPct = totalBuyIn > 0 ? (stats.totalNetEur / totalBuyIn) * 100 : 0
  const allIn = summarizeAllInRunout(hands)

  return {
    realRoiPct,
    allinSamples: allIn.comparableCount,
    allinMissing: allIn.missingCount,
    realizedChips: allIn.actualChips,
    expectedChips: allIn.expectedChips,
    deltaChips: allIn.deltaChips,
    bbSamples: allIn.bbCount,
    deltaBb: allIn.deltaBb,
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

function AdjustedEuro({ value }: { value: number | null }) {
  return <div className={`value ${value == null ? 'neutral' : value >= 0 ? 'positive' : 'negative'}`}>
    {value == null ? '—' : fmtEur(value)}
  </div>
}

const CoachReviewCard = memo(({
  review,
  stats,
}: {
  readonly review: CoachReview | null
  readonly stats: FilteredStats
}) => {
  if (!review) return null

  const chips = (value: number | null) => value == null ? '—' :
    `${value > 0 ? '+' : ''}${value.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}`
  const bb = (value: number | null) => value == null ? '—' :
    `${value > 0 ? '+' : ''}${value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  return (
    <section className="summary-card coach-overview">
      <div className="summary-card-header">
        <div>
          <h3>Bilan factuel de la période</h3>
          <p className="stack-method">Pas de note globale : les résultats ne suffisent pas à juger la qualité des décisions.</p>
        </div>
      </div>
      <div className="stats-bar">
        <div className="stat-card"><div className="label">Tournois · mains</div>
          <div className="value">{stats.totalTournaments} · {stats.totalHands}</div></div>
        <div className="stat-card"><div className="label">Résultat net (€)</div>
          <div className={`value ${stats.totalNetEur >= 0 ? 'positive' : 'negative'}`}>{fmtEur(stats.totalNetEur)}</div></div>
        <div className="stat-card"><div className="label">Net ajusté des tapis (€)</div>
          <AdjustedEuro value={stats.adjustedNetEur} />
          <small className="stack-sample">{stats.adjustedAllInCount} tapis corrigés</small></div>
        <div className="stat-card"><div className="label">cEV moyen / tournoi</div>
          <div className={`value ${stats.avgCev >= 0 ? 'positive' : 'negative'}`}>
            {stats.avgCev > 0 ? '+' : ''}{stats.avgCev.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} jetons
          </div></div>
        <div className="stat-card"><div className="label">ROI réel</div>
          <div className={`value ${review.realRoiPct >= 0 ? 'positive' : 'negative'}`}>
            {review.realRoiPct >= 0 ? '+' : ''}{review.realRoiPct.toFixed(1)} %
          </div></div>
      </div>
      <section className="coach-runout" aria-label="Résultats réels et attendus sur les mains avec EV">
        <div><span>Réalisé sur les mêmes mains</span><strong>{chips(review.realizedChips)} jetons</strong></div>
        <div><span>Net EV calculée</span><strong>{chips(review.expectedChips)} jetons</strong></div>
        <div><span>Écart réalisé − EV</span><strong>{chips(review.deltaChips)} jetons</strong></div>
        <div><span>Écart normalisé ({review.bbSamples} mains)</span><strong>{bb(review.deltaBb)} BB</strong></div>
      </section>
      <p className="variance-description">
        Écart calculé sur {review.allinSamples} mains ayant une EV disponible
        {review.allinMissing > 0 ? ` (${review.allinMissing} autres mains non comparables)` : ''}.
        {' '}En BB, seules les {review.bbSamples} mains avec une grosse blinde valide sont retenues.
        Ce résultat décrit la réalisation des all-ins, pas l’ensemble des décisions ni un « run good/bad » statistiquement validé.
      </p>
    </section>
  )
})

function fmtPct(count: number, denominator: number) {
  if (denominator <= 0) return '—'
  return `${(count * 100 / denominator).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`
}

const CoachPreflopStatsCard = memo(({
  title,
  stats,
}: {
  readonly title: string
  readonly stats: CoachFormatStats
}) => {
  const metrics = [
    { label: 'VPIP', count: stats.vpip_count, opportunities: stats.hands },
    { label: 'PFR', count: stats.pfr_count, opportunities: stats.hands },
    { label: '3-bet', count: stats.three_bet_count, opportunities: stats.three_bet_opportunities },
    { label: 'Limp', count: stats.limp_count, opportunities: stats.hands },
    { label: 'Fold vs 3-bet', count: stats.fold_to_three_bet_count, opportunities: stats.fold_to_three_bet_opportunities },
  ]

  return (
    <div className="summary-card">
      <div className="summary-card-header" style={{ marginBottom: 12 }}>
        <h3>{title}</h3>
        <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{stats.hands} mains</span>
      </div>
      <div className="coach-rate-grid">
        {metrics.map((metric) => (
          <div className="coach-rate-item" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{fmtPct(metric.count, metric.opportunities)}</strong>
            <small>{metric.count} / {metric.opportunities} occasions</small>
          </div>
        ))}
      </div>

      <p className="stack-method">Fréquences descriptives : sans position, stack effectif, sizing et range adverse, elles ne définissent pas une stratégie optimale.</p>
    </div>
  )
})

function useCoachData(
  enabled: boolean,
  coachDatesValid: boolean,
  fromMs: number | null,
  toMs: number | null,
  buyIns: readonly number[],
  tournamentIds: readonly string[],
) {
  const [coachSnapshot, setCoachSnapshot] = useState<CoachStatsSnapshot | null>(null)
  const [coachBlunders, setCoachBlunders] = useState<CoachBlunderSpot[]>([])
  const [stackSnapshot, setStackSnapshot] = useState<StackStatsSnapshot | null>(null)
  const [shortStackSnapshot, setShortStackSnapshot] = useState<ShortStackSnapshot | null>(null)
  const [flopSnapshot, setFlopSnapshot] = useState<TournamentFlops[]>([])
  const [reviewEntries, setReviewEntries] = useState<Awaited<ReturnType<typeof api.getHandReviews>>>([])
  const [coachLoading, setCoachLoading] = useState(false)
  const [coachError, setCoachError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled || !coachDatesValid) {
      setCoachSnapshot(null)
      setCoachBlunders([])
      setStackSnapshot(null)
      setShortStackSnapshot(null)
      setFlopSnapshot([])
      setReviewEntries([])
      setCoachLoading(false)
      setCoachError(null)
      return
    }

    const fromTs = fromMs == null ? null : new Date(fromMs).toISOString()
    const toTs = toMs == null ? null : new Date(toMs).toISOString()

    let cancelled = false
    setCoachLoading(true)
    setCoachError(null)
    Promise.all([
      api.getCoachStats(fromTs, toTs, buyIns),
      api.getCoachBlunders(fromTs, toTs, 150, 'bad', buyIns),
      api.getStackStats(tournamentIds),
      api.getShortStackAnalysis(),
      api.getHittingBoard(),
      api.getHandReviews(),
    ])
      .then(([snapshot, blunders, stacks, shortStack, flops, reviews]) => {
        if (cancelled) return
        setCoachSnapshot(snapshot)
        setCoachBlunders(blunders)
        setStackSnapshot(stacks)
        setShortStackSnapshot(shortStack)
        setFlopSnapshot(flops)
        setReviewEntries(reviews)
      })
      .catch((err) => {
        console.error(err)
        if (cancelled) return
        setCoachSnapshot(null)
        setCoachBlunders([])
        setStackSnapshot(null)
        setShortStackSnapshot(null)
        setFlopSnapshot([])
        setReviewEntries([])
        setCoachError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setCoachLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [enabled, coachDatesValid, fromMs, toMs, buyIns, tournamentIds, attempt])

  return {
    coachSnapshot, coachBlunders, stackSnapshot, shortStackSnapshot, flopSnapshot,
    reviewEntries, coachLoading, coachError, retry: () => setAttempt((value) => value + 1),
  }
}

function coachRate(count: number, opportunities: number) {
  return opportunities > 0
    ? `${(count * 100 / opportunities).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} % (${count}/${opportunities})`
    : '—'
}

function stackStatus(outcome: ReturnType<typeof stackDiagnostics>[number]['outcome'], hasFindings: boolean) {
  if (hasFindings) return 'Fréquence à vérifier'
  if (outcome === 'limited') return 'Échantillon limité'
  if (outcome === 'incomplete') return 'EV incomplète'
  if (outcome === 'negative-ev') return 'EV négative'
  if (outcome === 'below-ev') return 'Réel sous EV'
  return 'Pas de signal'
}

const CoachStackStatsCard = memo(({ snapshot }: { readonly snapshot: StackStatsSnapshot }) => {
  const diagnostics = useMemo(() => stackDiagnostics(snapshot.groups, 'all', []), [snapshot])
  const signals = diagnostics.filter((diagnostic) =>
    diagnostic.findings.length > 0 || diagnostic.outcome === 'negative-ev',
  )

  return (
    <section className="summary-card coach-stack-card">
      <h3>Jeu par profondeur et format</h3>
      <p className="variance-description">
        Fréquences et EV normalisées par stack, séparées entre heads-up et 3 joueurs.
        Les taux sont des observations, pas des ranges cibles.
      </p>
      {snapshot.excluded_hands > 0 && <p className="variance-warning">
        {snapshot.excluded_hands} mains exclues : format, stack ou grosse blinde invalide.
      </p>}
      <div className="stack-table-wrap" role="region" aria-label="Statistiques coach par stack" tabIndex={0}>
        <table className="stack-table coach-stack-table">
          <thead><tr>
            <th>Format · stack</th><th>Mains</th><th>EV (BB / 100 mains)</th><th>VPIP</th><th>PFR</th>
            <th>Limp</th><th>3-bet</th><th>Fold au 3-bet</th><th>Lecture</th>
          </tr></thead>
          <tbody>{diagnostics.map(({ playerCount, row, outcome, findings }) => {
            const evPer100 = row.hands > 0 && row.missingEvHands === 0
              ? row.bb.ev * 100 / row.hands
              : null
            return <tr key={`${playerCount}-${row.bucket}`}>
              <th>{playerCount === 2 ? 'HU' : '3 joueurs'} · {STACK_BUCKETS[row.bucket]}</th>
              <td>{row.hands}<small className="stack-sample">
                Actions préflop {row.preflopHands} · EV absente {row.missingEvHands}
              </small></td>
              <td className={evPer100 == null || evPer100 === 0 ? '' : evPer100 > 0 ? 'positive' : 'negative'}>
                {evPer100 == null ? row.hands === 0 ? '—' : 'Incomplète' :
                  `${evPer100 > 0 ? '+' : ''}${evPer100.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`}
              </td>
              <td>{coachRate(row.vpip, row.preflopHands)}</td>
              <td>{coachRate(row.pfr, row.preflopHands)}</td>
              <td>{coachRate(row.limp, row.preflopHands)}</td>
              <td>{coachRate(row.threeBet, row.threeBetOpportunities)}</td>
              <td>{coachRate(row.foldToThreeBet, row.foldToThreeBetOpportunities)}</td>
              <td>{stackStatus(outcome, findings.length > 0)}</td>
            </tr>
          })}</tbody>
        </table>
      </div>
      <div className="coach-signals">
        <h4>Pistes à vérifier</h4>
        {signals.length === 0 ? <p>
          Aucun signal ne franchit les repères exploratoires sur un échantillon suffisant.
          Cela ne prouve ni l’absence d’erreur ni la validité de ta stratégie.
        </p> : signals.map(({ playerCount, row, outcome, findings, focus }) => (
          <article key={`${playerCount}-${row.bucket}`}>
            <h5>{playerCount === 2 ? 'Heads-up' : '3 joueurs'} · {STACK_BUCKETS[row.bucket]} · {row.hands} mains</h5>
            {outcome === 'negative-ev' && <p>
              Résultat EV négatif dans au moins une unité : {row.chips.ev.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} jetons ;
              {' '}{row.bb.ev.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} BB au total
              ({(row.bb.ev * 100 / row.hands).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} BB / 100 mains).
              C’est une priorité de review, pas une preuve de leak.
            </p>}
            <p>{focus}</p>
            {findings.map((finding) => <div key={finding.id}>
              <strong>{finding.title}</strong>
              <p>{finding.evidence}</p>
              <p>{finding.action}</p>
            </div>)}
          </article>
        ))}
        <p className="stack-diagnostic-limits">
          Les pistes de fréquence demandent au moins 200 mains par segment et les alertes de fold au 3-bet 30 décisions.
          Ces seuils ne sont pas des intervalles de confiance ; revois les mains, positions, sizings et stacks effectifs avant toute conclusion.
        </p>
      </div>
    </section>
  )
})

const CoachEvidenceCard = memo(({
  tournaments,
  shortStack,
  flops,
}: {
  readonly tournaments: readonly TournamentRow[]
  readonly shortStack: ShortStackSnapshot
  readonly flops: readonly TournamentFlops[]
}) => {
  const selectedIds = useMemo(() => new Set(tournaments.map((tournament) => tournament.id)), [tournaments])
  const shortStackRows = useMemo(
    () => shortStack.encounters.filter((encounter) => selectedIds.has(encounter.tournament_id)),
    [shortStack, selectedIds],
  )
  const flopCounts = useMemo(
    () => combineCounts(flops.filter((row) => selectedIds.has(row.tournament_id))
      .flatMap((tournament) => tournament.groups.map((group) => group.counts))),
    [flops, selectedIds],
  )
  const revealed = shortStackRows.filter((row) => row.villain_cards != null).length
  const connectedRate = flopCounts.flops > 0 ? flopCounts.connected * 100 / flopCounts.flops : null

  return (
    <section className="summary-card coach-evidence-card">
      <h3>Autres données de review</h3>
      <p className="variance-description">
        Ces mesures orientent vers les analyses détaillées ; elles ne qualifient pas une décision isolée.
      </p>
      <div className="stats-bar">
        <div className="stat-card"><div className="label">Interactions short-stack</div>
          <div className="value">{shortStackRows.length}</div>
          <small className="stack-sample">{revealed} avec cartes adverses révélées</small></div>
        <div className="stat-card"><div className="label">Flops analysables</div>
          <div className="value">{flopCounts.flops}</div>
          <small className="stack-sample">
            {connectedRate == null ? 'Connexion indisponible' : `${flopCounts.connected} connectés · ${connectedRate.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`}
          </small></div>
      </div>
      <div className="coach-analysis-links">
        <Link to="/advanced/short-stack">Étudier le short-stack</Link>
        <Link to="/advanced/flops">Étudier les flops</Link>
        <Link to="/advanced/confrontations">Comparer les confrontations</Link>
      </div>
    </section>
  )
})

const CoachGoalCard = memo(function CoachGoalCard() {
  const [goal, setGoal] = useState('')
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let cancelled = false
    api.getCoachGoal()
      .then((value) => {
        if (cancelled) return
        setGoal(value)
        setDraft(value)
      })
      .catch((cause: unknown) => {
        console.error(cause)
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setNotice('')
    try {
      const saved = await api.saveCoachGoal(draft)
      setGoal(saved)
      setDraft(saved)
      setNotice('Objectif enregistré.')
    } catch (cause) {
      console.error(cause)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="summary-card coach-goal-card" onSubmit={(event) => { void save(event) }}>
      <h3>Objectif de travail</h3>
      <p className="variance-description">Garde un axe concret pour les prochaines sessions, puis retrouve les mains correspondantes grâce aux tags.</p>
      <label>
        Mon objectif
        <textarea maxLength={240} rows={2} value={draft} disabled={loading || saving}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ex. revoir mes défenses de BB entre 10 et 15 BB" />
      </label>
      <div className="hand-review-footer">
        <button className="btn-primary" type="submit" disabled={loading || saving || draft === goal}>
          {saving ? 'Enregistrement…' : 'Enregistrer l’objectif'}
        </button>
        <span className="stack-method">{draft.length}/240 caractères</span>
        {notice && <span className="positive" role="status">{notice}</span>}
      </div>
      {error && <p className="negative" role="alert">{error}</p>}
    </form>
  )
})

const CoachBlundersCard = memo(({
  blunders,
  onOpenReplay,
}: {
  readonly blunders: CoachBlunderSpot[]
  readonly onOpenReplay: (handId: string) => void
}) => {
  const [actionFilter, setActionFilter] = useCoachAction()
  const [severityFilter, setSeverityFilter] = useCoachSeverity()

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
          <h3>Spots call/push à vérifier</h3>
        </div>
        <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
          Aucun spot ne correspond aux filtres de détection. Cela ne garantit pas l’absence d’erreur.
        </p>
        <p className="stack-method">Une EV négative signalée n’est pas à elle seule une preuve de mauvaise décision : vérifie le contexte dans le replay.</p>
      </div>
    )
  }

  const criticalCount = blunders.filter((s) => s.severity === 'critical').length
  const callCount = blunders.filter((s) => s.action_kind === 'call').length
  const pushCount = blunders.filter((s) => s.action_kind === 'push').length

  return (
    <div className="summary-card" style={{ marginBottom: 16 }}>
      <div className="summary-card-header" style={{ marginBottom: 12 }}>
        <h3>Spots call/push à vérifier</h3>
      </div>
      <p className="stack-method">Repérage heuristique limité aux calls/pushes préflop détectés comme EV négative. Chaque spot doit être revu dans son contexte, ce n’est pas un verdict automatique.</p>

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

const CoachReviewQueueCard = memo(({
  reviews,
  tournamentIds,
}: {
  readonly reviews: readonly HandReviewEntry[]
  readonly tournamentIds: readonly string[]
}) => {
  const selectedIds = useMemo(() => new Set(tournamentIds), [tournamentIds])
  const selectedReviews = useMemo(
    () => reviews.filter((review) => selectedIds.has(review.tournament_id)),
    [reviews, selectedIds],
  )
  const pending = selectedReviews.filter((review) => !review.reviewed).length
  const favorites = selectedReviews.filter((review) => review.favorite).length

  return (
    <section className="summary-card coach-review-queue">
      <div className="summary-card-header">
        <div>
          <h3>Ta file de review</h3>
          <p className="stack-method">Dans les tournois de la période sélectionnée</p>
        </div>
        <Link className="filter-reset" to="/review">Ouvrir la file</Link>
      </div>
      <div className="coach-review-counts">
        <span><strong>{pending}</strong> à revoir</span>
        <span><strong>{selectedReviews.length}</strong> annotées</span>
        <span><strong>{favorites}</strong> favorites</span>
      </div>
    </section>
  )
})

const CoachTabPanel = memo(({
  coachFrom,
  coachTo,
  setCoachFrom,
  setCoachTo,
  coachDatesValid,
  coachLoading,
  coachError,
  coachSnapshot,
  coachReview,
  coachStats,
  coachTournaments,
  stackSnapshot,
  shortStackSnapshot,
  flopSnapshot,
  reviewEntries,
  coachBlunders,
  onRetry,
  onOpenReplay,
}: {
  readonly coachFrom: string
  readonly coachTo: string
  readonly setCoachFrom: (value: string) => void
  readonly setCoachTo: (value: string) => void
  readonly coachDatesValid: boolean
  readonly coachLoading: boolean
  readonly coachError: string | null
  readonly coachSnapshot: CoachStatsSnapshot | null
  readonly coachReview: CoachReview | null
  readonly coachStats: FilteredStats
  readonly coachTournaments: readonly TournamentRow[]
  readonly stackSnapshot: StackStatsSnapshot | null
  readonly shortStackSnapshot: ShortStackSnapshot | null
  readonly flopSnapshot: readonly TournamentFlops[]
  readonly reviewEntries: readonly HandReviewEntry[]
  readonly coachBlunders: CoachBlunderSpot[]
  readonly onRetry: () => void
  readonly onOpenReplay: (handId: string) => void
}) => {
  const tournamentIds = useMemo(() => coachTournaments.map((tournament) => tournament.id), [coachTournaments])

  return (
    <>
      <section className="summary-card coach-filter-card">
        <div className="summary-card-header">
          <div>
            <h3>Période du Coach</h3>
            <p className="stack-method">Les buy-ins suivent les filtres de Summary.</p>
          </div>
        </div>
        <div className="period-pill-bar" role="group" aria-label="Raccourcis dates coach">
          {([['today', "Aujourd'hui"], ['yesterday', 'Hier']] as const).map(([period, label]) =>
            <button type="button" className="period-pill" key={period} onClick={() => {
              const date = formatDateInput(calendarDayRange(period).fromMs)
              setCoachFrom(date)
              setCoachTo(date)
            }}>{label}</button>)}
        </div>
        <div className="summary-custom-dates" style={{ marginTop: 0 }}>
          <input
            className="filter-input summary-date-input"
            type="date"
            value={coachFrom}
            onChange={(e) => setCoachFrom(e.target.value)}
            aria-label="Date de debut coach"
          />
          <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>→</span>
          <input
            className="filter-input summary-date-input"
            type="date"
            value={coachTo}
            onChange={(e) => setCoachTo(e.target.value)}
            aria-label="Date de fin coach"
          />
        </div>
        <p className="stack-method">
          Dates indépendantes de la période Summary. Laisse les deux champs vides pour travailler sur tout l’historique.
        </p>
      </section>

      <CoachGoalCard />

      {!coachDatesValid && (
        <div className="summary-card" role="alert">
          <p className="negative">Renseigne des dates valides pour afficher les analyses.</p>
        </div>
      )}

      {coachDatesValid && coachLoading && (
        <div className="summary-card" role="status">
          <p>Chargement des données du Coach…</p>
        </div>
      )}

      {coachError && coachDatesValid && !coachLoading && (
        <div className="summary-card" role="alert">
          <p className="negative">Impossible de charger les analyses du Coach : {coachError}</p>
          <button type="button" className="filter-reset" onClick={onRetry}>Réessayer</button>
        </div>
      )}

      {coachDatesValid && !coachLoading && coachSnapshot && (
        <>
          {coachReview && <CoachReviewCard review={coachReview} stats={coachStats} />}
          <CoachReviewQueueCard reviews={reviewEntries} tournamentIds={tournamentIds} />
          <CoachBlundersCard blunders={coachBlunders} onOpenReplay={onOpenReplay} />
          <div className="summary-grid">
            <CoachPreflopStatsCard title="Early · 3-way niveaux 1-3" stats={coachSnapshot.early_phase} />
            <CoachPreflopStatsCard title="Mid · 3-way niveaux 4-6" stats={coachSnapshot.mid_phase} />
            <CoachPreflopStatsCard title="Late · 3-way niveaux 7+" stats={coachSnapshot.late_phase} />
            <CoachPreflopStatsCard title="Heads-up" stats={coachSnapshot.heads_up} />
          </div>
          {stackSnapshot && <CoachStackStatsCard snapshot={stackSnapshot} />}
          {shortStackSnapshot && (
            <CoachEvidenceCard
              tournaments={coachTournaments}
              shortStack={shortStackSnapshot}
              flops={flopSnapshot}
            />
          )}
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

const SummaryMultiplierTable = memo(({ sortedMultipliers }: {
  readonly sortedMultipliers: { mult: number; expectedCount: number | null; realCount: number }[]
}) => {
  if (sortedMultipliers.length === 0) {
    return <p className="variance-description">Aucune donnée.</p>
  }

  const showExpected = sortedMultipliers.some((row) => row.expectedCount != null)
  const count = new Intl.NumberFormat('fr-FR')
  const expected = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  const difference = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, signDisplay: 'exceptZero' })

  return (
    <div className="multiplier-table-wrap">
      <table className="multiplier-table" aria-labelledby="summary-multipliers-title">
        <thead><tr>
          <th scope="col">Multiplicateur</th>
          <th scope="col">Observé</th>
          {showExpected && <><th scope="col">Attendu</th><th scope="col">Écart</th></>}
        </tr></thead>
        <tbody>
          {sortedMultipliers.map((row) => {
            const delta = row.expectedCount == null ? null : row.realCount - row.expectedCount
            const displayedDelta = delta == null ? null : difference.format(delta)
            return <tr key={row.mult}>
              <th scope="row">×{count.format(row.mult)}</th>
              <td className="multiplier-observed">{count.format(row.realCount)}</td>
              {showExpected && <>
                <td>{row.expectedCount == null ? '—' : expected.format(row.expectedCount)}</td>
                <td className={displayedDelta?.startsWith('+') ? 'positive' : displayedDelta?.startsWith('-') ? 'negative' : undefined}>
                  {displayedDelta ?? '—'}
                </td>
              </>}
            </tr>
          })}
        </tbody>
      </table>
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

const useChipCurves = createReviewState<Set<ChipsCurveKey>>(() => new Set(['cev', 'ev']))
const useChipFormat = createReviewState<StackFormat>(() => 'all')
const useChipBuckets = createReviewState<readonly number[]>(() => [])

const SummaryChipsTab = memo(({ filteredHands, filteredTournamentCount }: {
  readonly filteredHands: HandChipPoint[]
  readonly filteredTournamentCount: number
}) => {
  const [activeCurves, setActiveCurves] = useChipCurves()
  const [format, setFormat] = useChipFormat()
  const [buckets, setBuckets] = useChipBuckets()
  const selectedHands = useMemo(() => filterChipHands(filteredHands, format, buckets), [filteredHands, format, buckets])
  const hasHandFilter = format !== 'all' || buckets.length > 0
  const chipStats = useMemo(
    () => summarizeChips(selectedHands, filteredTournamentCount),
    [selectedHands, filteredTournamentCount],
  )

  const chipsLuck = useMemo(() => {
    const deltas = selectedHands.map((h) => h.realized_cev - (h.net_ev ?? h.realized_cev))
    return computeEmpiricalLuck(deltas)
  }, [selectedHands])

  const chartData = useMemo(() => {
    let cumCev = 0
    let cumEv = 0
    let cumWsd = 0
    let cumSd = 0
    const points: Array<{ label: string; cev: number; ev: number; wsd: number; sd: number }> = [
      { label: '', cev: 0, ev: 0, wsd: 0, sd: 0 },
    ]
    selectedHands.forEach((h, idx) => {
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
  }, [selectedHands])

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
    <div className="summary-chips-tab">
      <div className="summary-card">
        <div className="filter-groups">
          <HandFormatFilter format={format} onChange={setFormat} />
          <HeroStackFilter buckets={buckets} onReset={() => setBuckets([])}
            onToggle={(bucket) => setBuckets((current) => toggleStackBucket(current, bucket))} />
        </div>
        {hasHandFilter && <p className="filter-group-hint" aria-live="polite">
          {selectedHands.length} / {filteredHands.length} mains retenues. Dénominateur du cEV après les filtres de période et de buy-in : {filteredTournamentCount} tournoi{filteredTournamentCount === 1 ? '' : 's'}.
        </p>}
      </div>
      <div className="stats-bar" style={{ marginBottom: 16 }}>
        <div className="stat-card">
          <div className="label">Net (chips)</div>
          <div className={`value ${chipStats.netChips >= 0 ? 'positive' : 'negative'}`}>
            {fmtChips(chipStats.netChips)}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">NetEV (chips)</div>
          <div className={`value ${chipStats.netEvChips >= 0 ? 'positive' : 'negative'}`}>
            {fmtChips(chipStats.netEvChips)}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">{hasHandFilter ? 'Contribution cEV (jetons / tournoi)' : 'cEV moyen (chips/game)'}</div>
          <div className={`value ${chipStats.avgCevPerGame >= 0 ? 'positive' : 'negative'}`}>
            {chipStats.avgCevPerGame > 0 ? '+' : ''}{chipStats.avgCevPerGame.toFixed(1)}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">WSD net (chips)</div>
          <div className={`value ${chipStats.wsdNetChips >= 0 ? 'positive' : 'negative'}`}>
            {fmtChips(chipStats.wsdNetChips)}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">SD net (chips)</div>
          <div className={`value ${chipStats.sdNetChips >= 0 ? 'positive' : 'negative'}`}>
            {fmtChips(chipStats.sdNetChips)}
          </div>
        </div>
      </div>

      <div className="summary-card summary-chips-card">
        <div className="summary-card-header">
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
          <div className="chips-chart">
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 0, height: 220 }}
              style={{ position: 'absolute', inset: 0 }}>
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
          </div>
        )}

        <div className="chips-curve-toggles">
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
  const [handEvolution, setHandEvolution] = useState<HandChipPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useSummaryFilter()
  const [activeTab, setActiveTab] = useSummaryTab()
  const [coachFrom, setCoachFrom] = useCoachFrom()
  const [coachTo, setCoachTo] = useCoachTo()

  useEffect(() => {
    Promise.all([api.getTournaments(), api.getChipEvolution()])
      .then(([t, evolution]) => {
        setTournaments(t)
        setHandEvolution(evolution)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const dayAnchor = filter.period === 'today' || filter.period === 'yesterday' ? new Date().setHours(0, 0, 0, 0) : null
  const filteredRange = useMemo(
    () => periodToRange(filter.period, filter.customFrom, filter.customTo, dayAnchor ?? Date.now()),
    [filter.period, filter.customFrom, filter.customTo, dayAnchor],
  )

  const filteredTournaments = useMemo(() => {
    return applyTournamentRange(tournaments, filteredRange.fromMs, filteredRange.toMs, filter.buyIns)
  }, [filteredRange.fromMs, filteredRange.toMs, tournaments, filter.buyIns])

  const filteredHands = useMemo(
    () => handsForTournaments(handEvolution, filteredTournaments),
    [handEvolution, filteredTournaments],
  )

  const coachRange = useMemo(() => {
    const fromMs = parseDateInput(coachFrom)
    const toMsRaw = parseDateInput(coachTo)
    const toMs = toMsRaw == null ? null : endOfDay(toMsRaw)
    return { fromMs, toMs }
  }, [coachFrom, coachTo])

  const coachDatesValid =
    (coachFrom.trim().length === 0 || coachRange.fromMs != null) &&
    (coachTo.trim().length === 0 || coachRange.toMs != null)

  const coachTournaments = useMemo(
    () => applyTournamentRange(tournaments, coachRange.fromMs, coachRange.toMs, filter.buyIns),
    [tournaments, coachRange.fromMs, coachRange.toMs, filter.buyIns],
  )

  const coachStats = useMemo(
    () => computeFilteredStats(coachTournaments),
    [coachTournaments],
  )

  const coachTournamentIds = useMemo(
    () => coachTournaments.map((tournament) => tournament.id),
    [coachTournaments],
  )

  const {
    coachSnapshot, coachBlunders, stackSnapshot, shortStackSnapshot, flopSnapshot,
    reviewEntries, coachLoading, coachError, retry: retryCoachData,
  } = useCoachData(
    activeTab === 'coach',
    coachDatesValid,
    coachRange.fromMs,
    coachRange.toMs,
    filter.buyIns,
    coachTournamentIds,
  )

  const coachHands = useMemo(
    () => handsForTournaments(handEvolution, coachTournaments),
    [handEvolution, coachTournaments],
  )

  const filteredStats = useMemo(
    () => computeFilteredStats(filteredTournaments),
    [filteredTournaments],
  )
  const supportsTheoreticalModel = filteredTournaments.length > 0 &&
    filteredTournaments.every((t) => tournamentBuyIn(t) === MODEL_BUY_IN_EUR)

  const sortedMultipliers = useMemo(
    () => computeMultiplierComparison(filteredStats.totalTournaments, filteredStats.multiplierDist, supportsTheoreticalModel),
    [filteredStats.totalTournaments, filteredStats.multiplierDist, supportsTheoreticalModel],
  )

  const coachReview = useMemo(
    () => buildCoachReview(coachStats, coachTournaments, coachHands),
    [coachStats, coachTournaments, coachHands],
  )

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Chargement…</p>

  return (
    <div className="summary-page">
      <div className="page-header">
        <div className="summary-header-row">
          <div>
            <h1>Session Summary</h1>
            <p>{activeTab === 'coach' ? coachStats.totalTournaments : filteredStats.totalTournaments} tournois · {activeTab === 'coach' ? coachStats.totalHands : filteredStats.totalHands} mains</p>
          </div>
        </div>
        <TournamentFilters tournaments={tournaments} value={filter} onChange={setFilter} showPeriod={activeTab !== 'coach'} />
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
          onClick={() => setActiveTab('stacks')}
          style={{
            padding: '8px 16px',
            background: activeTab === 'stacks' ? 'rgba(255,255,255,0.1)' : 'transparent',
            border: 'none',
            color: activeTab === 'stacks' ? 'var(--text)' : 'var(--text-dim)',
            cursor: 'pointer',
            borderBottom: activeTab === 'stacks' ? '2px solid var(--accent)' : 'none',
            fontSize: 14,
            fontWeight: activeTab === 'stacks' ? '600' : '400',
          }}
        >
          Stacks
        </button>
        <button
          onClick={() => setActiveTab('allins')}
          style={{
            padding: '8px 16px',
            background: activeTab === 'allins' ? 'rgba(255,255,255,0.1)' : 'transparent',
            border: 'none',
            color: activeTab === 'allins' ? 'var(--text)' : 'var(--text-dim)',
            cursor: 'pointer',
            borderBottom: activeTab === 'allins' ? '2px solid var(--accent)' : 'none',
            fontSize: 14,
            fontWeight: activeTab === 'allins' ? '600' : '400',
          }}
        >
          Tapis
        </button>
        <button
          onClick={() => setActiveTab('variance')}
          style={{
            padding: '8px 16px',
            background: activeTab === 'variance' ? 'rgba(255,255,255,0.1)' : 'transparent',
            border: 'none',
            color: activeTab === 'variance' ? 'var(--text)' : 'var(--text-dim)',
            cursor: 'pointer',
            borderBottom: activeTab === 'variance' ? '2px solid var(--accent)' : 'none',
            fontSize: 14,
            fontWeight: activeTab === 'variance' ? '600' : '400',
          }}
        >
          Variance
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
                <div className="label">Net ajusté des tapis (€)</div>
                <AdjustedEuro value={filteredStats.adjustedNetEur} />
              </div>
              <div className="stat-card">
                <div className="label">Correction des tapis (€)</div>
                <AdjustedEuro value={filteredStats.allInCorrection} />
              </div>
            </div>
            <p className="variance-description">
              {filteredStats.adjustedAllInCount} tapis corrigés sur {filteredStats.calculatedAllInCount} avec une EV calculée.
              {' '}Une correction positive signifie que le résultat réel a été inférieur à l’attendu sur ces tapis.
            </p>
            <details className="stack-method">
              <summary>Comment le net ajusté est calculé</summary>
              <p>On part du net réel. Pour chaque tapis calculable, préflop ou postflop, on ajoute l’écart
                entre les jetons attendus et les jetons gagnés ou perdus, valorisé à la cagnotte réelle divisée par
                le total des jetons au début de la main. Les multiplicateurs tirés ne changent pas.</p>
              <p>Seuls les tournois identifiés comme payant exclusivement le vainqueur sont corrigés.
                Les autres restent au résultat net importé. Cette estimation n’isole que les tirages après les tapis
                pris en compte, pas toute la variance ni les gains à long terme.</p>
            </details>
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
              <h3 id="summary-multipliers-title">Répartition des multiplicateurs</h3>
              {!supportsTheoreticalModel && filteredStats.totalTournaments > 0 &&
                <p style={{ color: 'var(--text-dim)' }}>Le modele theorique est disponible uniquement pour les buy-ins de 2 €. Seules les occurrences reelles sont affichees.</p>}
              <SummaryMultiplierTable sortedMultipliers={sortedMultipliers} />
            </div>
          </div>

          <div className="summary-card summary-euro-card">
            <div className="summary-card-header">
              <h3>Évolution cumulative</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div className="chart-legend">
                  <span className="chart-legend-item chart-legend-net">Net réel</span>
                  {filteredStats.adjustedNetEur != null &&
                    <span className="chart-legend-item chart-legend-ev">Net ajusté des tapis</span>}
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
          filteredHands={filteredHands}
          filteredTournamentCount={filteredStats.totalTournaments}
        />
      )}

      {activeTab === 'variance' && <Variance hands={filteredHands} />}
      {activeTab === 'stacks' && <SummaryStacks tournaments={filteredTournaments} />}
      {activeTab === 'allins' && <SummaryAllIns tournaments={filteredTournaments} />}

      {activeTab === 'coach' && (
        <CoachTabPanel
          coachFrom={coachFrom}
          coachTo={coachTo}
          setCoachFrom={setCoachFrom}
          setCoachTo={setCoachTo}
          coachDatesValid={coachDatesValid}
          coachLoading={coachLoading}
          coachError={coachError}
          coachSnapshot={coachSnapshot}
          coachReview={coachReview}
          coachStats={coachStats}
          coachTournaments={coachTournaments}
          stackSnapshot={stackSnapshot}
          shortStackSnapshot={shortStackSnapshot}
          flopSnapshot={flopSnapshot}
          reviewEntries={reviewEntries}
          coachBlunders={coachBlunders}
          onRetry={retryCoachData}
          onOpenReplay={(handId) => navigate(`/hands/${handId}/replay`)}
        />
      )}
    </div>
  )
})
