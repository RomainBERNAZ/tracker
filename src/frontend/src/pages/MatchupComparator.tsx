import { memo, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { createReviewState } from '../reviewState'
import { api, PreflopMatchup, TournamentRow } from '../api'
import { HAND_RANKS, STARTING_HAND_ROWS } from './startingHandVariance'
import { hasMatchupBlind, hasMatchupEv, MatchupUnit, selectMatchups, summarizeMatchups } from './matchupComparison'

function HandRangeSelector({ label, selection, onChange }: {
  readonly label: string
  readonly selection: ReadonlySet<string>
  readonly onChange: (selection: Set<string>) => void
}) {
  const all = STARTING_HAND_ROWS.flat()
  function toggle(combo: string) {
    const next = new Set(selection)
    if (next.has(combo)) next.delete(combo)
    else next.add(combo)
    onChange(next)
  }
  return (
    <fieldset className="matchup-range">
      <legend>{label} · {selection.size}/169</legend>
      <div className="matchup-range-actions">
        <button type="button" className="filter-reset" onClick={() => onChange(new Set(all))}>Toutes</button>
        <button type="button" className="filter-reset" onClick={() => onChange(new Set())}>Vider</button>
        <button type="button" className="filter-reset" onClick={() => onChange(new Set(all.filter((combo) => combo.length === 2)))}>Paires</button>
        <select className="filter-select" aria-label={`Remplacer ${label.toLowerCase()} par une famille`} value=""
          onChange={(event) => onChange(new Set(all.filter((combo) => combo.length === 3 && combo.slice(0, 2).includes(event.target.value))))}>
          <option value="" disabled>Famille…</option>
          {[...HAND_RANKS].map((rank) => <option key={rank} value={rank}>{rank}x (sans paire)</option>)}
        </select>
      </div>
      <div className="matchup-range-grid" role="group" aria-label={label}>
        {all.map((combo) => (
          <button type="button" key={combo} aria-pressed={selection.has(combo)}
            className={selection.has(combo) ? 'matchup-range-selected' : ''} onClick={() => toggle(combo)}>
            {combo}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

const formatGain = (value: number | null, unit: MatchupUnit) => value == null ? '—' :
  value.toLocaleString('fr-FR', { minimumFractionDigits: unit === 'bb' ? 2 : 0, maximumFractionDigits: unit === 'bb' ? 2 : 0, signDisplay: 'exceptZero' })

const useHeroRange = createReviewState(() => new Set<string>())
const useVillainRange = createReviewState(() => new Set<string>())
const useOpponentCount = createReviewState(() => 1)
const useMatchupPageSize = createReviewState(() => 50)

export default memo(function MatchupComparator({ tournaments, unit }: {
  readonly tournaments: readonly TournamentRow[]
  readonly unit: MatchupUnit
}) {
  const [hands, setHands] = useState<PreflopMatchup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [heroSelection, setHeroSelection] = useHeroRange()
  const [villainSelection, setVillainSelection] = useVillainRange()
  const [opponentCount, setOpponentCount] = useOpponentCount()
  const pageScope = JSON.stringify([tournaments.map((t) => t.id).sort(), [...heroSelection].sort(), [...villainSelection].sort(), opponentCount])
  const [visibleCount, setVisibleCount] = useMatchupPageSize(pageScope)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api.getPreflopMatchups()
      .then((data) => { if (!cancelled) setHands(data) })
      .catch((err) => {
        console.error(err)
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [attempt])

  const cohort = useMemo(() => {
    const ids = new Set(tournaments.map((tournament) => tournament.id))
    return hands.filter((hand) => ids.has(hand.tournament_id))
  }, [hands, tournaments])
  const { matches, unknownCards } = useMemo(
    () => selectMatchups(cohort, heroSelection, villainSelection, opponentCount),
    [cohort, heroSelection, villainSelection, opponentCount],
  )
  const stats = useMemo(() => summarizeMatchups(matches, unit), [matches, unit])
  const selected = heroSelection.size > 0 && villainSelection.size > 0
  const unitLabel = unit === 'bb' ? 'BB' : 'jetons'

  return (
    <section className="summary-card matchup-card" aria-label="Comparateur de confrontations">
      <h3>Comparer mes mains aux mains de vilain</h3>
      <p className="variance-description">
        Sélectionnez librement les mains de chaque côté. Pour KJ, sélectionnez KJs et KJo ;
        la famille Ax regroupe AK à A2, assorties ou non, sans AA. Les raccourcis remplacent la sélection.
      </p>
      <div className="matchup-selectors">
        <HandRangeSelector label="Mains du héros" selection={heroSelection} onChange={setHeroSelection} />
        <HandRangeSelector label="Mains de vilain" selection={villainSelection} onChange={setVillainSelection} />
      </div>
      <label className="matchup-format">
        Confrontation{' '}
        <select className="filter-select" value={opponentCount} onChange={(event) => setOpponentCount(Number(event.target.value))}>
          <option value={1}>2 joueurs (duel)</option>
          <option value={2}>3 joueurs</option>
        </select>
      </label>
      <p className="variance-description">
        All-ins préflop, sans mise ni fold après le préflop. Même période et buy-in que la grille.
        {opponentCount === 2 && ' Au moins un des deux adversaires doit correspondre à la sélection ; la main est comptée une seule fois.'}
        {' '}Les gains sont exprimés en {unitLabel}, selon le sélecteur Jetons / BB de la grille.
      </p>
      {loading ? <p role="status">Chargement des confrontations…</p> : error ? (
        <div role="alert">
          <p>Impossible de charger les confrontations : {error}</p>
          <button type="button" className="filter-reset" onClick={() => setAttempt((value) => value + 1)}>Réessayer</button>
        </div>
      ) : !selected ? <p>Sélectionnez au moins une main de chaque côté pour filtrer les spots.</p> : (
        <>
          <p>{matches.length} confrontations correspondantes · {stats.count} comparables réel / EV.</p>
          {unknownCards > 0 && <p className="variance-warning">{unknownCards} spots du périmètre ont des cartes inconnues ou invalides et ne peuvent pas être filtrés.</p>}
          {stats.missingEv > 0 && <p className="variance-warning">{stats.missingEv} confrontations sans EV all-in calculée : exclues uniquement du bilan réel / EV.</p>}
          {stats.missingBlind > 0 && <p className="variance-warning">{stats.missingBlind} confrontations sans grosse blinde valide : comparaison en BB indisponible.</p>}
          <div className="matchup-metrics">
            <div><span>Réel comparé</span><strong>{formatGain(stats.actual, unit)} {unitLabel}</strong></div>
            <div><span>Attendu (Net EV)</span><strong>{formatGain(stats.expected, unit)} {unitLabel}</strong></div>
            <div><span>Écart réel − attendu</span><strong className={stats.delta == null ? '' : stats.delta < 0 ? 'negative' : 'positive'}>{formatGain(stats.delta, unit)} {unitLabel}</strong></div>
            <div title="Part attendue du pot total, issue du calcul EV importé ; tient compte des pots secondaires. Ce n'est pas un taux de victoires.">
              <span>Part de pot attendue (moy.)</span><strong>{stats.meanEquity == null ? '—' : `${(stats.meanEquity * 100).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`}</strong>
            </div>
          </div>
          <p className="variance-description">Réel et attendu sont additionnés sur les mêmes {stats.count} mains comparables. L’EV utilisée est celle calculée à l’import, pas une équité générique de range.</p>
          {matches.length === 0 ? <p>Aucune confrontation pour ces sélections.</p> : (
            <div className="matchup-table-wrap">
              <table className="matchup-table">
                <thead><tr><th>Main / cartes</th><th>Réel</th><th>Attendu</th><th>Écart</th></tr></thead>
                <tbody>
                  {matches.slice(0, visibleCount).map((hand) => {
                    const validBlind = unit === 'chips' || hasMatchupBlind(hand)
                    const actual = validBlind ? hand.realized_cev / (unit === 'bb' ? hand.big_blind : 1) : null
                    const expected = validBlind && hasMatchupEv(hand) && hand.net_ev != null
                      ? hand.net_ev / (unit === 'bb' ? hand.big_blind : 1) : null
                    return (
                      <tr key={hand.hand_id}>
                        <td><Link to={`/hands/${encodeURIComponent(hand.hand_id)}/replay`}>{hand.hand_id}</Link>
                          <div>{hand.hero_cards} vs {hand.opponents.map((opponent) => opponent.cards).join(' / ')}</div>
                        </td>
                        <td>{formatGain(actual, unit)}</td><td>{formatGain(expected, unit)}</td>
                        <td>{formatGain(actual != null && expected != null ? actual - expected : null, unit)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {matches.length > visibleCount && <button type="button" className="filter-reset" onClick={() => setVisibleCount((value) => value + 50)}>Afficher les 50 suivantes ({visibleCount}/{matches.length})</button>}
            </div>
          )}
        </>
      )}
    </section>
  )
})
