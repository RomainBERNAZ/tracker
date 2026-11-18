import { memo, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { createReviewState } from '../reviewState'
import { HoleCards } from '../components/PlayingCards'
import { ChipAmount } from '../components/ChipAmount'
import { api, type PreflopMatchup, type TournamentRow } from '../api'
import { COVERAGE_GROUPS, coverageGroup, duelEquity, duelGains, groupAllInDuels, summarizeAllInDuels, type CoverageGroup } from './allInCoverage'
import type { MatchupUnit } from './matchupComparison'

const percentage = (value: number | null) => value == null ? '-' :
  `${(value * 100).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`
const gain = (value: number | null, unit: MatchupUnit) => value == null ? '-' :
  value.toLocaleString('fr-FR', { minimumFractionDigits: unit === 'bb' ? 2 : 0, maximumFractionDigits: unit === 'bb' ? 2 : 0, signDisplay: 'exceptZero' })
const outcomeLabels = { win: 'Victoire', loss: 'Defaite', split: 'Partage' } as const
const useAllInUnit = createReviewState<MatchupUnit>(() => 'chips')
const useAllInSelection = createReviewState<CoverageGroup | 'all'>(() => 'all')
const useAllInPageSize = createReviewState(() => 50)

function Gain({ value, unit }: { readonly value: number | null; readonly unit: MatchupUnit }) {
  return <span className={value == null || value === 0 ? '' : value < 0 ? 'negative' : 'positive'}>{gain(value, unit)}</span>
}

export default memo(function SummaryAllIns({ tournaments }: { readonly tournaments: readonly TournamentRow[] }) {
  const [hands, setHands] = useState<PreflopMatchup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [unit, setUnit] = useAllInUnit()
  const [selection, setSelection] = useAllInSelection()
  const pageScope = JSON.stringify([tournaments.map((t) => t.id).sort(), selection])
  const [visibleCount, setVisibleCount] = useAllInPageSize(pageScope)

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
  const grouped = useMemo(() => groupAllInDuels(cohort), [cohort])
  const cards = useMemo(() => COVERAGE_GROUPS.map((group) => ({
    ...group, stats: summarizeAllInDuels(grouped.groups[group.id], unit),
  })), [grouped, unit])
  const selectedHands = selection === 'all' ? grouped.duels : grouped.groups[selection]
  const unitLabel = unit === 'bb' ? 'BB' : 'jetons'

  return <div className="stack-analysis">
    <section className="summary-card">
      <h3>Tapis preflop : couverture et resultats</h3>
      <p className="variance-description">
        Tapis payes entre le hero et un seul vilain, sans mise ni fold apres le preflop.
        Une main commencee a trois compte si le troisieme joueur a folde avant le duel.
        Couverture selon les stacks au debut de la main, avant les blindes.
        Memes filtres date et buy-ins que Summary.
      </p>
      <fieldset className="filter-group" aria-label="Unite des resultats tapis">
        <legend>Unite des resultats</legend>
        <p className="filter-group-hint">En BB, chaque gain est divise par la grosse blinde de sa main</p>
        <div className="period-pill-bar">
          {(['chips', 'bb'] as const).map((key) =>
            <button type="button" key={key} className={`period-pill${unit === key ? ' period-pill-active' : ''}`}
              aria-pressed={unit === key} onClick={() => setUnit(key)}>{key === 'chips' ? 'Jetons' : 'BB'}</button>)}
        </div>
      </fieldset>
      <p className="variance-description">
        L'equite est la part attendue du pot conteste, partages inclus, moyenne par duel et non ponderee par sa taille.
        Les pots secondaires garantis sont retires pour retrouver l'equite hero / vilain.
        Ce n'est pas une probabilite de victoire seule. Victoire, defaite et partage decrivent le duel,
        pas le signe du gain net : perdre le duel peut laisser un gain positif grace a l'argent mort.
      </p>
    </section>

    {loading ? <p role="status">Chargement des tapis...</p> : error ? (
      <div className="summary-card" role="alert">
        <p>Impossible de charger les tapis : {error}</p>
        <button type="button" className="filter-reset" onClick={() => setAttempt((value) => value + 1)}>Reessayer</button>
      </div>
    ) : <>
      <section className="summary-card" aria-label="Perimetre des tapis">
        <strong>{grouped.duels.length} duels classes</strong>
        <p className="variance-description">{grouped.multiway} pots multiway exclus. Les cartes inconnues n'excluent pas un duel.</p>
        {grouped.unclassified > 0 && <p className="variance-warning">{grouped.unclassified} mains non classees : stacks ou donnees du duel indisponibles.</p>}
        {grouped.duels.length === 0 && <p>Aucun duel preflop classable pour cette periode et ces buy-ins.</p>}
      </section>

      <div className="allin-coverage-grid">
        {cards.map(({ id, label, stats }) => <section key={id} className="summary-card allin-coverage-card" aria-label={label}>
          <h3>{label}</h3>
          <p className="allin-volume">{stats.count.toLocaleString('fr-FR')} <span>duels</span></p>
          <div className="allin-equities">
            <div><span>Equite hero</span><strong>{percentage(stats.meanHeroEquity)}</strong></div>
            <div><span>Equite vilain</span><strong>{percentage(stats.meanVillainEquity)}</strong></div>
          </div>
          <p className="stack-method">Equites disponibles : {stats.equityCount}/{stats.count} duels.</p>
          <div className="allin-outcomes">
            <div><strong className="positive">{stats.wins}</strong><span>Victoires</span></div>
            <div><strong className="negative">{stats.losses}</strong><span>Defaites</span></div>
            <div><strong>{stats.splits}</strong><span>Partages</span></div>
          </div>
          <p className="stack-method">
            Victoires : {percentage(stats.winRate)} des {stats.knownOutcomes} issues connues (partages inclus).
            {stats.unknownOutcomes > 0 && ` ${stats.unknownOutcomes} issues inconnues, jamais comptees comme defaites.`}
          </p>
          <dl className="allin-gains">
            <div><dt>Net observe ({stats.actualCount} duels)</dt><dd><Gain value={stats.actual} unit={unit} /> {unitLabel}</dd></div>
            <div><dt>Reel compare</dt><dd><Gain value={stats.comparedActual} unit={unit} /> {unitLabel}</dd></div>
            <div><dt>Net EV compare</dt><dd><Gain value={stats.expected} unit={unit} /> {unitLabel}</dd></div>
            <div><dt>Ecart reel - EV</dt><dd><Gain value={stats.delta} unit={unit} /> {unitLabel}</dd></div>
          </dl>
          <p className="stack-method">Reel / EV compares sur les memes {stats.comparedCount}/{stats.count} duels valides, sans remplacer l'EV manquante par le reel.</p>
          {stats.issues > 0 && <p className="variance-warning">{stats.issues} duels avec donnees incoherentes ou pots non pris en charge : gains exclus. Details dans la liste.</p>}
          {stats.missingBlind > 0 && <p className="variance-warning">{stats.missingBlind} duels sans grosse blinde valide : gains en BB exclus.</p>}
          <button type="button" className="filter-reset" onClick={() => setSelection(id)}>Voir les mains de ce groupe</button>
        </section>)}
      </div>

      <section className="summary-card" aria-label="Detail des duels">
        <h3>Revoir les duels</h3>
        <fieldset className="filter-group" aria-label="Couverture des mains listees">
          <legend>Mains a afficher</legend>
          <p className="filter-group-hint">Filtre uniquement la liste ; les trois bilans restent visibles</p>
          <div className="period-pill-bar">
            <button type="button" className={`period-pill${selection === 'all' ? ' period-pill-active' : ''}`}
              aria-pressed={selection === 'all'} onClick={() => setSelection('all')}>Tous les duels</button>
            {COVERAGE_GROUPS.map(({ id, label }) => <button type="button" key={id}
              className={`period-pill${selection === id ? ' period-pill-active' : ''}`}
              aria-pressed={selection === id} onClick={() => setSelection(id)}>{label}</button>)}
          </div>
        </fieldset>
        <p className="stack-method">{selectedHands.length} mains. Stacks de depart en {unitLabel}, avec equivalence ; gains nets du hero et equites du pot conteste.</p>
        {selectedHands.length === 0 ? <p>Aucun duel dans ce groupe.</p> : <div className="matchup-table-wrap">
          <table className="matchup-table allin-table">
            <thead><tr><th>Main / cartes</th><th>Couverture</th><th>Stacks hero / vilain</th><th>Equites hero / vilain</th><th>Issue</th><th>Net ({unitLabel})</th><th>Net EV ({unitLabel})</th></tr></thead>
            <tbody>{selectedHands.slice(0, visibleCount).map((hand) => {
              const equity = duelEquity(hand)
              const gains = duelGains(hand, unit)
              const duel = hand.duel
              return <tr key={hand.hand_id}>
                <td><Link to={`/hands/${encodeURIComponent(hand.hand_id)}/replay`}>{hand.hand_id}</Link>
                  <div className="allin-card-matchup">
                    <span><small>Hero</small><HoleCards cards={hand.hero_cards} /></span>
                    <span className="stack-method">vs</span>
                    <span><small>Vilain</small><HoleCards cards={hand.opponents[0]?.cards ?? null} /></span>
                  </div>
                  <div className="stack-method">{hand.opponents[0]?.player_name}</div>
                  {duel?.issues.map((issue) => <div className="variance-warning" key={issue}>{issue}</div>)}
                </td>
                <td>{COVERAGE_GROUPS.find((group) => group.id === coverageGroup(hand))?.label}</td>
                <td><div className="allin-stack-pair">
                  <div><small>Hero</small><ChipAmount value={duel?.hero_starting_stack ?? null} bigBlind={hand.big_blind} unit={unit} /></div>
                  <div><small>Vilain</small><ChipAmount value={duel?.villain_starting_stack ?? null} bigBlind={hand.big_blind} unit={unit} /></div>
                </div></td>
                <td>{percentage(equity)} / {percentage(equity == null ? null : 1 - equity)}</td>
                <td>{duel?.outcome == null ? 'Inconnue' : outcomeLabels[duel.outcome]}</td>
                <td><Gain value={gains.actual} unit={unit} /></td><td><Gain value={gains.expected} unit={unit} /></td>
              </tr>
            })}</tbody>
          </table>
          {selectedHands.length > visibleCount && <button type="button" className="filter-reset"
            onClick={() => setVisibleCount((value) => value + 50)}>Afficher les 50 suivantes ({visibleCount}/{selectedHands.length})</button>}
        </div>}
      </section>
    </>}
  </div>
})
