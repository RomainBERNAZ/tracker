import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { TournamentRow } from '../api'
import { TournamentFilters } from '../components/TournamentFilters'
import { createReviewState } from '../reviewState'
import { CATEGORIES, CONTEXTS, FORMATS, METRICS, POTS, POT_TYPES, combineCounts, compareConnection, selectPeriods, tournamentCounts } from './hittingBoardStats'
import type { Counts, Coverage, Format, Position, TournamentFlops } from './hittingBoardStats'
import { DEFAULT_FILTER } from './tournamentFilters'

const useFilter = createReviewState(() => DEFAULT_FILTER)
const useFormat = createReviewState<Format>(() => 'all')
const formats = ['all', 2, 3] as const
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
const percent = (n: number, total: number) => total ? `${fmt(100 * n / total)} %` : '—'
type Sample = { label: string, counts: Counts }

function Matrix({ samples }: { samples: Sample[] }) {
  function row(label: string, value: (counts: Counts) => string) {
    return <tr key={label}><th scope="row">{label}</th>
      {samples.map(({ label: name, counts }) => <td key={name}>{value(counts)}</td>)}</tr>
  }
  return <div className="stack-table-wrap">
    <table className="stack-table">
      <thead><tr><th scope="col">Indicateur</th>
        {samples.map(({ label }) => <th key={label} scope="col">{label}</th>)}</tr></thead>
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
        <tr><th colSpan={samples.length + 1}>Catégories exclusives</th></tr>
        {(Object.keys(CATEGORIES) as (keyof typeof CATEGORIES)[]).map((key) => (
          row(CATEGORIES[key], (s) => rate(s.categories[key] ?? 0, s.flops))
        ))}
      </tbody>
      <tbody>
        <tr><th colSpan={samples.length + 1}>Tirages complémentaires (peuvent se recouper)</th></tr>
        {(['pair_and_direct', 'flush_draw', 'oesd', 'gutshot', 'combo_draw', 'backdoor_flush', 'backdoor_straight'] as const)
          .map((key) => row(METRICS[key], (s) => rate(s[key], s.flops)))}
      </tbody>
    </table>
  </div>
}

export function PotChart({ samples }: { samples: Sample[] }) {
  const segments = [
    { key: 'pair', label: 'Paire ou mieux' },
    { key: 'draw', label: 'Tirage direct sans paire' },
    { key: 'miss', label: 'Sans paire ni tirage direct' },
  ]
  return <section aria-labelledby="board-chart-title" className="board-panel">
    <h2 id="board-chart-title">Connexion par type de pot</h2>
    <ul className="board-legend">
      {segments.map(({ key, label }) => <li key={key}><span className={`board-${key}`} aria-hidden="true" />{label}</li>)}
    </ul>
    <ul className="board-chart">
      {samples.map(({ label, counts }) => {
        const values = [counts.pair_plus, counts.connected - counts.pair_plus, counts.no_pair_or_direct]
        const { flops, connected } = counts
        const description = segments.map((segment, i) => `${segment.label} : ${rate(values[i], flops)}`).join(' ; ')
        return <li key={label}>
          <strong>{label}</strong>
          <div className="board-bar" role="img" aria-label={flops ? description : 'Aucun flop dans ce contexte'}>
            {flops > 0 && segments.map(({ key, label: segmentLabel }, i) => (
              <span key={key} className={`board-${key}`} title={`${segmentLabel} : ${rate(values[i], flops)}`}
                style={{ width: `${100 * values[i] / flops}%` }}>
                {values[i] / flops >= 0.1 && percent(values[i], flops)}
              </span>
            ))}
          </div>
          <span className="board-chart-value">{flops ? `${rate(connected, flops)}` : 'Aucun flop'}</span>
          <dl className="board-segment-details">
            {segments.map(({ key, label: segmentLabel }, i) => <div key={key}>
              <dt><span className={`board-swatch board-${key}`} aria-hidden="true" />{segmentLabel}</dt>
              <dd>{rate(values[i], flops)}</dd>
            </div>)}
          </dl>
        </li>
      })}
    </ul>
    <p>À droite : connexions / flops analysés. Sous chaque barre : effectif et pourcentage de chaque catégorie,
      y compris les petits segments. Une connexion est une paire ou mieux, ou un tirage direct.</p>
  </section>
}

export default function HittingBoard() {
  const [filter, setFilter] = useFilter()
  const [format, setFormat] = useFormat()
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
  const samples = useMemo(() => POT_TYPES.map((pot) => ({
    label: POTS[pot], counts: combineCounts(tournamentCounts(current, pot, format)),
  })), [current, format])
  const total = useMemo(() => combineCounts(samples.map(({ counts }) => counts)), [samples])
  const referenceSamples = useMemo(() => POT_TYPES.map((pot) => ({
    label: POTS[pot], counts: combineCounts(tournamentCounts(reference, pot, format)),
  })), [reference, format])
  const comparisons = useMemo(() => CONTEXTS.filter(({ players }) => format === 'all' || players === format)
    .map(({ pot, players, label }) => ({
      label, ...compareConnection(tournamentCounts(current, pot, players), tournamentCounts(reference, pot, players)),
    })), [current, reference, format])
  const positional = useMemo(() => (Object.keys(positions) as Position[]).map((position) => ({
    position, samples: POT_TYPES.map((pot) => ({
      label: POTS[pot], counts: combineCounts(tournamentCounts(current, pot, format, position)),
    })),
  })), [current, format])
  const knownIds = useMemo(() => new Set(data?.tournaments.map(({ id }) => id)), [data])
  const missingTournament = data?.stats.filter(({ tournament_id }) => !knownIds.has(tournament_id)).length ?? 0

  return <div className="hitting-board">
    <div className="page-header">
      <h2>Connexion au flop</h2>
      <p>Comment Hero touche les flops qu’il voit, quel que soit le relanceur préflop.</p>
    </div>
    {error && <p role="alert">Impossible de charger les historiques : {error}{' '}
      <button type="button" onClick={() => { setError(null); setAttempt(attempt + 1) }}>Réessayer</button></p>}
    {!data && !error && <p role="status">Analyse des historiques…</p>}
    {data && <>
      <fieldset className="filter-group board-format">
        <legend>Joueurs au flop</legend>
        <div className="period-pill-bar">{formats.map((value) => (
          <button key={value} type="button" className={`period-pill${format === value ? ' period-pill-active' : ''}`}
            aria-pressed={format === value} onClick={() => setFormat(value)}>{FORMATS[value]}</button>
        ))}</div>
      </fieldset>
      <TournamentFilters tournaments={data.tournaments} value={filter} onChange={setFilter} />
      {missingTournament > 0 && <p role="status">
        {missingTournament} tournoi(s) sans métadonnées correspondantes, exclus des filtres et de l’analyse.
      </p>}
      {periods.invalid ? <p role="alert">La plage de dates est invalide.</p> : <>
        <section aria-label="Résumé de la sélection">
          <dl className="board-kpis">
            <div><dt>Flops analysés</dt><dd>{fmt(total.flops)}</dd><small>{FORMATS[format]} · période sélectionnée</small></div>
            {([
              ['Connexions', total.connected], ['Paire ou mieux', total.pair_plus], ['Tirages directs', total.direct_draw],
            ] as const).map(([label, count]) => <div key={label}>
              <dt>{label}</dt><dd>{percent(count, total.flops)}</dd><small>{fmt(count)} / {fmt(total.flops)} flops</small>
            </div>)}
          </dl>
          {total.flops === 0 && <p>Aucun flop analysable dans cette sélection.</p>}
        </section>
        <PotChart samples={samples} />
        <details className="board-panel"><summary>Répartition détaillée</summary>
          <Matrix samples={samples} />
          <p>Priorité : main faite, combo draw, couleur, OESD, gutshot, overcards, puis air.
            Une paire ou un brelan du board seul ne compte pas comme main faite. Les backdoors ne changent pas
            la catégorie principale et entrent dans le potentiel de tirage.</p>
        </details>
        <details className="board-panel"><summary>Par position préflop de Hero</summary>
          {positional.map(({ position, samples }) => <details key={position}>
            <summary>{positions[position]} · {fmt(samples.reduce((n, { counts }) => n + counts.flops, 0))} flops</summary>
            <Matrix samples={samples} />
          </details>)}
        </details>
        <details className="board-panel"><summary>Comparaison avec l’historique</summary>
          <p>Connexion = paire ou mieux, ou tirage direct. Référence : tournois strictement antérieurs au début
            de la période sélectionnée, aux mêmes buy-ins sélectionnés.</p>
          {!periods.reference ? <p>Sélectionnez une période avec une date de début pour lancer la comparaison.</p>
            : <>
              <div className="stack-table-wrap"><table>
                <thead><tr><th scope="col">Contexte</th><th scope="col">Période sélectionnée</th>
                  <th scope="col">Historique antérieur</th><th scope="col">Écart</th><th scope="col">Résultat</th></tr></thead>
                <tbody>{comparisons.map(({ label, a, b, delta, adjustedP }) => <tr key={label}>
                  <th scope="row">{label}</th>
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
              <p>Test bilatéral tenant compte du regroupement par tournoi, seuil de 5 % corrigé pour {CONTEXTS.length} contextes.
                Par période et contexte : au moins 50 flops, 30 tournois, 5 connexions et 5 flops sans connexion.
                Une baisse dans un contexte seulement ne prouve pas qu’elle y est plus forte que dans un autre.</p>
              <details><summary>Répartition détaillée de l’historique antérieur</summary>
                <Matrix samples={referenceSamples} />
              </details>
            </>}
        </details>
        <details className="board-panel"><summary>Qualité des historiques</summary>
          <p>Les compteurs de couverture ne sont pas filtrés par nombre de joueurs au flop.</p>
          <div className="stack-table-wrap"><table>
            <thead><tr><th scope="col">Donnée manquante ou incohérente</th><th scope="col">Période sélectionnée</th>
              {periods.reference && <th scope="col">Historique antérieur</th>}</tr></thead>
            <tbody>{(Object.keys(coverageLabels) as (keyof Coverage)[]).map((key) => <tr key={key}>
              <th scope="row">{coverageLabels[key]}</th>
              <td>{fmt(current.reduce((n, row) => n + row.coverage[key], 0))}</td>
              {periods.reference && <td>{fmt(reference.reduce((n, row) => n + row.coverage[key], 0))}</td>}
            </tr>)}</tbody>
          </table></div>
        </details>
      </>}
    </>}
  </div>
}
