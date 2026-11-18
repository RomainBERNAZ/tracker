import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { TournamentRow } from '../api'
import { TournamentFilters } from '../components/TournamentFilters'
import { createReviewState } from '../reviewState'
import { CATEGORIES, CONTEXTS, METRICS, combineCounts, compareConnection, selectPeriods, tournamentCounts } from './hittingBoardStats'
import type { Counts, Coverage, Position, TournamentFlops } from './hittingBoardStats'
import { DEFAULT_FILTER } from './tournamentFilters'

const useFilter = createReviewState(() => DEFAULT_FILTER)
const positions: Record<Position, string> = {
  BTN: 'BTN (BTN/SB en HU distribué)', SB: 'SB', BB: 'BB', Middle: 'Positions intermédiaires', Unknown: 'Position indéterminée',
}
const coverageLabels: Record<keyof Coverage, string> = {
  context_unknown: 'Contexte préflop ou participants au flop indéterminés (hors analyse)',
  flop_unknown: 'Flop manquant ou invalide dans un contexte préflop éligible (hors analyse)',
  hero_cards_unknown: 'Cartes de Hero manquantes ou invalides (hors analyse)',
  position_unknown: 'Position indéterminée (flops inclus dans les totaux)',
}
const fmt = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })
const rate = (n: number, total: number) => total ? `${fmt(n)} / ${fmt(total)} · ${fmt(100 * n / total)} %` : '0 / 0 · —'

function Matrix({ samples }: { samples: Counts[] }) {
  function row(label: string, value: (counts: Counts) => string) {
    return <tr key={label}><th scope="row">{label}</th>
      {samples.map((sample, i) => <td key={CONTEXTS[i].label}>{value(sample)}</td>)}</tr>
  }
  return <div className="stack-table-wrap">
    <table className="stack-table">
      <thead><tr><th scope="col">Indicateur</th>
        {CONTEXTS.map(({ label }) => <th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>
        {row('Flops analysés', (s) => fmt(s.flops))}
        {row(METRICS.connected, (s) => rate(s.connected, s.flops))}
        {row(METRICS.pair_plus, (s) => rate(s.pair_plus, s.flops))}
        {row(METRICS.top_pair_plus, (s) => rate(s.top_pair_plus, s.flops))}
        {row(CATEGORIES.two_pair_plus, (s) => rate(s.categories.two_pair_plus ?? 0, s.flops))}
        {row(METRICS.direct_draw, (s) => rate(s.direct_draw, s.flops))}
        {row(METRICS.two_overs_or_draw, (s) => rate(s.two_overs_or_draw, s.flops))}
        {row(METRICS.no_pair_or_direct, (s) => rate(s.no_pair_or_direct, s.flops))}
      </tbody>
      <tbody>
        <tr><th colSpan={5}>Catégories exclusives</th></tr>
        {(Object.keys(CATEGORIES) as (keyof typeof CATEGORIES)[]).map((key) => (
          row(CATEGORIES[key], (s) => rate(s.categories[key] ?? 0, s.flops))
        ))}
      </tbody>
      <tbody>
        <tr><th colSpan={5}>Tirages complémentaires (peuvent se recouper)</th></tr>
        {(['pair_and_direct', 'flush_draw', 'oesd', 'gutshot', 'combo_draw', 'backdoor_flush', 'backdoor_straight'] as const)
          .map((key) => row(METRICS[key], (s) => rate(s[key], s.flops)))}
      </tbody>
    </table>
  </div>
}

export default function HittingBoard() {
  const [filter, setFilter] = useFilter()
  const [data, setData] = useState<{ tournaments: TournamentRow[], stats: TournamentFlops[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    Promise.all([api.getTournaments(), api.getHittingBoard()])
      .then(([tournaments, stats]) => { if (active) setData({ tournaments, stats }) })
      .catch((cause) => { if (active) setError(String(cause)) })
    return () => { active = false }
  }, [attempt])

  const periods = useMemo(() => selectPeriods(data?.tournaments ?? [], filter), [data, filter])
  const current = useMemo(() => data?.stats.filter((row) => periods.current.has(row.tournament_id)) ?? [], [data, periods])
  const reference = useMemo(() => data?.stats.filter((row) => periods.reference?.has(row.tournament_id)) ?? [], [data, periods])
  const samples = useMemo(() => CONTEXTS.map((context) => combineCounts(tournamentCounts(current, context))), [current])
  const referenceSamples = useMemo(() => CONTEXTS.map((context) => combineCounts(tournamentCounts(reference, context))), [reference])
  const comparisons = useMemo(() => CONTEXTS.map((context) => (
    compareConnection(tournamentCounts(current, context), tournamentCounts(reference, context))
  )), [current, reference])
  const positional = useMemo(() => (Object.keys(positions) as Position[]).map((position) => ({
    position, samples: CONTEXTS.map((context) => combineCounts(tournamentCounts(current, context, position))),
  })), [current])
  const knownIds = useMemo(() => new Set(data?.tournaments.map(({ id }) => id)), [data])
  const missingTournament = data?.stats.filter(({ tournament_id }) => !knownIds.has(tournament_id)).length ?? 0

  return <div className="hitting-board">
    <div className="page-header">
      <h1>Hitting Board</h1>
      <p>Flops vus par Hero après sa seule relance préflop, en heads-up ou à trois au flop.</p>
    </div>
    {error && <p role="alert">Impossible de charger les historiques : {error}{' '}
      <button type="button" onClick={() => { setError(null); setAttempt(attempt + 1) }}>Réessayer</button></p>}
    {!data && !error && <p role="status">Analyse des historiques…</p>}
    {data && <>
      <TournamentFilters tournaments={data.tournaments} value={filter} onChange={setFilter} />
      {missingTournament > 0 && <p role="status">
        {missingTournament} tournoi(s) sans métadonnées correspondantes, exclus des filtres et de l’analyse.
      </p>}
      {periods.invalid ? <p role="alert">La plage de dates est invalide.</p> : <>
        <section>
          <h2>Comparaison avec l’historique</h2>
          <p>Connexion = paire ou mieux, ou tirage direct. Référence : tournois strictement antérieurs au début
            de la période sélectionnée, aux mêmes buy-ins sélectionnés.</p>
          {!periods.reference ? <p>Sélectionnez une période avec une date de début pour lancer la comparaison.</p>
            : <>
              <div className="stack-table-wrap"><table>
                <thead><tr><th scope="col">Contexte</th><th scope="col">Période sélectionnée</th>
                  <th scope="col">Historique antérieur</th><th scope="col">Écart</th><th scope="col">Résultat</th></tr></thead>
                <tbody>{comparisons.map(({ a, b, delta, adjustedP }, i) => <tr key={CONTEXTS[i].label}>
                  <th scope="row">{CONTEXTS[i].label}</th>
                  {[a, b].map(({ flops, hits, tournaments }, j) => <td key={j}>
                    {rate(hits, flops)} <small>({tournaments} tournois)</small>
                  </td>)}
                  <td>{delta == null ? '—' : `${delta > 0 ? '+' : ''}${fmt(delta * 100)} pp`}</td>
                  <td>{adjustedP == null ? 'Non concluant : volume ou variation insuffisants.'
                    : <>{adjustedP < 0.05 ? ((delta ?? 0) < 0 ? 'Baisse significative' : 'Hausse significative')
                      : 'Pas d’écart significatif'} · p ajustée {adjustedP < 0.001 ? '< 0,001'
                      : `= ${adjustedP.toLocaleString('fr-FR', { maximumFractionDigits: 4 })}`}</>}</td>
                </tr>)}</tbody>
              </table></div>
              <p>Test bilatéral tenant compte du regroupement par tournoi, seuil de 5 % corrigé pour quatre contextes.
                Par période et contexte : au moins 50 flops, 30 tournois, 5 connexions et 5 flops sans connexion.
                Une baisse dans un contexte seulement ne prouve pas qu’elle y est plus forte que dans un autre.</p>
              <details><summary>Répartition détaillée de l’historique antérieur</summary>
                <Matrix samples={referenceSamples} />
              </details>
            </>}
        </section>
        <section>
          <h2>Flops de la période sélectionnée</h2>
          {samples.every((sample) => sample.flops === 0) && <p>Aucun flop analysable dans cette sélection.</p>}
          <Matrix samples={samples} />
          <p>Priorité : main faite, combo draw, couleur, OESD, gutshot, overcards, puis air.
            Une paire ou un brelan du board seul ne compte pas comme main faite. Les backdoors ne changent pas
            la catégorie principale et entrent dans le potentiel de tirage.</p>
        </section>
        <section>
          <h2>Par position préflop de Hero</h2>
          {positional.map(({ position, samples }) => <details key={position}>
            <summary>{positions[position]} · {fmt(samples.reduce((n, sample) => n + sample.flops, 0))} flops</summary>
            <Matrix samples={samples} />
          </details>)}
        </section>
        <section>
          <h2>Qualité des historiques</h2>
          <div className="stack-table-wrap"><table>
            <thead><tr><th scope="col">Donnée manquante ou incohérente</th><th scope="col">Période sélectionnée</th>
              {periods.reference && <th scope="col">Historique antérieur</th>}</tr></thead>
            <tbody>{(Object.keys(coverageLabels) as (keyof Coverage)[]).map((key) => <tr key={key}>
              <th scope="row">{coverageLabels[key]}</th>
              <td>{fmt(current.reduce((n, row) => n + row.coverage[key], 0))}</td>
              {periods.reference && <td>{fmt(reference.reduce((n, row) => n + row.coverage[key], 0))}</td>}
            </tr>)}</tbody>
          </table></div>
        </section>
      </>}
    </>}
  </div>
}
