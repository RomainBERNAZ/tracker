import { useEffect, useMemo, useState } from 'react'
import type { TournamentRow } from '../api'
import { api } from '../api'
import { TournamentFilters } from '../components/TournamentFilters'
import { createReviewState } from '../reviewState'
import { DEFAULT_FILTER, applyTournamentRange, periodToRange } from './tournamentFilters'
import type { TournamentFilter } from './tournamentFilters'
import MatchupComparator from './MatchupComparator'

const useMatchupFilter = createReviewState<TournamentFilter>(() => DEFAULT_FILTER)
const useMatchupUnit = createReviewState<'chips' | 'bb'>(() => 'chips')

export default function MatchupAnalysis() {
  const [tournaments, setTournaments] = useState<TournamentRow[]>([])
  const [filter, setFilter] = useMatchupFilter()
  const [unit, setUnit] = useMatchupUnit()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.getTournaments()
      .then((rows) => { if (!cancelled) setTournaments(rows) })
      .catch((cause: unknown) => {
        console.error(cause)
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const dayAnchor = filter.period === 'today' || filter.period === 'yesterday'
    ? new Date().setHours(0, 0, 0, 0)
    : null
  const range = useMemo(
    () => periodToRange(filter.period, filter.customFrom, filter.customTo, dayAnchor ?? Date.now()),
    [filter.period, filter.customFrom, filter.customTo, dayAnchor],
  )
  const selectedTournaments = useMemo(
    () => applyTournamentRange(tournaments, range.fromMs, range.toMs, filter.buyIns),
    [tournaments, range.fromMs, range.toMs, filter.buyIns],
  )

  return (
    <div className="matchup-analysis-page">
      <section className="summary-card matchup-analysis-intro">
        <h2>Confrontations préflop</h2>
        <p className="variance-description">
          Analyse ponctuelle des ranges observées à tapis. Ce n’est ni un solveur, ni une recommandation de range ;
          vérifie toujours le nombre de mains comparables avant d’interpréter l’écart réel / EV.
        </p>
        <TournamentFilters tournaments={tournaments} value={filter} onChange={setFilter} />
        <fieldset className="filter-group" aria-label="Unité des confrontations">
          <legend>Unité des gains</legend>
          <div className="period-pill-bar">
            {(['chips', 'bb'] as const).map((value) => (
              <button key={value} type="button" className={`period-pill${unit === value ? ' period-pill-active' : ''}`}
                aria-pressed={unit === value} onClick={() => setUnit(value)}>
                {value === 'chips' ? 'Jetons' : 'BB'}
              </button>
            ))}
          </div>
        </fieldset>
      </section>
      {error && <div className="summary-card" role="alert">
        <p className="negative">Impossible de charger les tournois : {error}</p>
      </div>}
      {loading ? <p role="status">Chargement des confrontations…</p> :
        <MatchupComparator tournaments={selectedTournaments} unit={unit} />}
    </div>
  )
}
