import { memo, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { StackStatsSnapshot, TournamentRow } from '../api'
import { analyzeStacks, STACK_BUCKETS, stackRates } from './stackAnalysis'
import type { StackAnalysisRow, StackFormat } from './stackAnalysis'

const number = (value: number | null, digits = 1) => value == null ? '-' :
  value.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const gain = (value: number | null) => value == null ? '-' :
  value.toLocaleString('fr-FR', { maximumFractionDigits: 2, signDisplay: 'exceptZero' })

function Frequency({ count, opportunities }: { readonly count: number; readonly opportunities: number }) {
  return <>{number(opportunities > 0 ? count * 100 / opportunities : null)}{opportunities > 0 ? ' %' : ''}
    <small className="stack-sample">{count} / {opportunities}</small></>
}

export default memo(function SummaryStacks({ tournaments }: { readonly tournaments: readonly TournamentRow[] }) {
  const [snapshot, setSnapshot] = useState<StackStatsSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [format, setFormat] = useState<StackFormat>('all')
  const [buckets, setBuckets] = useState<readonly number[]>([])
  const [unit, setUnit] = useState<'chips' | 'bb'>('chips')

  useEffect(() => {
    let cancelled = false
    setSnapshot(null)
    setError(null)
    api.getStackStats(tournaments.map((tournament) => tournament.id))
      .then((result) => { if (!cancelled) setSnapshot(result) })
      .catch((cause) => {
        console.error(cause)
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => { cancelled = true }
  }, [tournaments, attempt])

  const analysis = useMemo(() => analyzeStacks(snapshot?.groups ?? [], format, buckets), [snapshot, format, buckets])
  const unitLabel = unit === 'chips' ? 'jetons' : 'BB'
  const totalRates = stackRates(analysis.total, tournaments.length, unit)

  function performanceRow(row: StackAnalysisRow, label: string) {
    const values = row[unit]
    const rates = stackRates(row, tournaments.length, unit)
    return <tr key={row.bucket}>
      <th scope="row">{label}</th>
      <td>{number(row.hands, 0)}</td>
      <td>{gain(values.net)}</td><td>{gain(values.ev)}</td>
      <td>{gain(rates.cevPerTournament)}</td><td>{gain(rates.evPer100)}</td>
      <td>{gain(values.sd)}</td><td>{gain(values.sd_ev)}</td>
      <td>{gain(values.wsd)}</td><td>{gain(values.wsd_ev)}</td>
    </tr>
  }

  function preflopRow(row: StackAnalysisRow, label: string) {
    return <tr key={row.bucket}>
      <th scope="row">{label}</th>
      <td>{number(row.preflopHands, 0)}</td>
      <td><Frequency count={row.vpip} opportunities={row.preflopHands} /></td>
      <td><Frequency count={row.pfr} opportunities={row.preflopHands} /></td>
      <td><Frequency count={row.limp} opportunities={row.preflopHands} /></td>
      <td><Frequency count={row.threeBet} opportunities={row.threeBetOpportunities} /></td>
      <td><Frequency count={row.foldToThreeBet} opportunities={row.foldToThreeBetOpportunities} /></td>
    </tr>
  }

  return <div className="stack-analysis">
    <section className="summary-card">
      <h3>Analyse par stack du hero</h3>
      <p className="variance-description">
        Stack au debut de la main, avant les blindes, divise par la grosse blinde de cette main.
        Les bornes hautes 8, 12 et 20 BB sont incluses. Les filtres date et buy-ins de Summary s'appliquent.
        Les filtres ci-dessous ne modifient que cet onglet.
      </p>
      <div className="filters-bar">
        <div className="period-pill-bar" role="group" aria-label="Format des mains">
          {([['all', 'Tous'], ['3', '3 joueurs'], ['2', 'Heads-up']] as const).map(([key, label]) =>
            <button key={key} type="button" className={`period-pill${format === key ? ' period-pill-active' : ''}`}
              aria-pressed={format === key} onClick={() => setFormat(key)}>{label}</button>)}
        </div>
        <div className="period-pill-bar" role="group" aria-label="Profondeurs de stack">
          <button type="button" className={`period-pill${buckets.length === 0 ? ' period-pill-active' : ''}`}
            aria-pressed={buckets.length === 0} onClick={() => setBuckets([])}>Toutes</button>
          {STACK_BUCKETS.map((label, bucket) =>
            <button key={bucket} type="button" className={`period-pill${buckets.includes(bucket) ? ' period-pill-active' : ''}`}
              aria-pressed={buckets.includes(bucket)}
              onClick={() => setBuckets((current) => current.includes(bucket) ? current.filter((value) => value !== bucket) : [...current, bucket])}>
              {label}
            </button>)}
        </div>
        <div className="period-pill-bar" role="group" aria-label="Unite des resultats stacks">
          {(['chips', 'bb'] as const).map((key) =>
            <button key={key} type="button" className={`period-pill${unit === key ? ' period-pill-active' : ''}`}
              aria-pressed={unit === key} onClick={() => setUnit(key)}>{key === 'chips' ? 'Jetons' : 'BB'}</button>)}
        </div>
      </div>
      <p className="variance-description">
        cEV / tournoi = Net EV de ces mains / {tournaments.length} tournois du perimetre date et buy-ins,
        toujours en jetons : c'est une contribution additive au cEV global, pas une moyenne par tournoi ayant atteint ce stack.
        EV / 100 mains mesure la performance par main dans la tranche.
        En BB, chaque gain est divise par sa propre grosse blinde avant addition.
      </p>
    </section>

    {error != null ? <div className="summary-card" role="alert">
      <p>Impossible de charger les statistiques par stack : {error}</p>
      <button type="button" className="period-pill" onClick={() => setAttempt((value) => value + 1)}>Reessayer</button>
    </div> : snapshot == null ? <p role="status">Chargement des statistiques par stack...</p> : <>
      {snapshot.excluded_hands > 0 && <p className="variance-warning" role="status">
        {snapshot.excluded_hands} mains du perimetre exclues : stack ou grosse blinde non valide, ou format autre que 2/3 joueurs.
      </p>}
      {analysis.total.missingEvHands > 0 && <p className="variance-warning" role="status">
        {analysis.total.missingEvHands} mains sans Net EV : gain realise utilise a la place, comme dans Jetons.
      </p>}
      {analysis.total.missingPreflopHands > 0 && <p className="variance-warning" role="status">
        {analysis.total.missingPreflopHands} mains sans historique preflop : incluses dans les gains, exclues des frequences.
      </p>}
      <div className="stats-bar">
        <div className="stat-card"><div className="label">Mains analysees</div><div className="value">{number(analysis.total.hands, 0)}</div></div>
        <div className="stat-card"><div className="label">Net ({unitLabel})</div><div className="value">{gain(analysis.total[unit].net)}</div></div>
        <div className="stat-card"><div className="label">Net EV ({unitLabel})</div><div className="value">{gain(analysis.total[unit].ev)}</div></div>
        <div className="stat-card"><div className="label">Contribution cEV / tournoi (jetons)</div><div className="value">{gain(totalRates.cevPerTournament)}</div></div>
        <div className="stat-card"><div className="label">EV / 100 mains ({unitLabel})</div><div className="value">{gain(totalRates.evPer100)}</div></div>
      </div>
      {analysis.total.hands === 0 && <p role="status">Aucune main exploitable pour ces filtres.</p>}
      <section className="summary-card">
        <h3>Resultats par profondeur</h3>
        <p className="variance-description">SD : hero au showdown. Sans SD : hero sans showdown, meme si les adversaires y vont.</p>
        <div className="stack-table-wrap" role="region" aria-label="Resultats par stack" tabIndex={0}>
          <table className="stack-table">
            <thead><tr>
              <th scope="col">Stack hero</th><th scope="col">Mains</th>
              <th scope="col">Net ({unitLabel})</th><th scope="col">Net EV ({unitLabel})</th>
              <th scope="col">cEV / tournoi (jetons)</th><th scope="col">EV / 100 ({unitLabel})</th>
              <th scope="col">SD net ({unitLabel})</th><th scope="col">SD EV ({unitLabel})</th>
              <th scope="col">Sans SD net ({unitLabel})</th><th scope="col">Sans SD EV ({unitLabel})</th>
            </tr></thead>
            <tbody>{analysis.rows.map((row) => performanceRow(row, STACK_BUCKETS[row.bucket]))}</tbody>
            <tfoot>{performanceRow(analysis.total, 'Total selection')}</tfoot>
          </table>
        </div>
      </section>
      <section className="summary-card">
        <h3>Frequences preflop par profondeur</h3>
        <p className="variance-description">
          VPIP, PFR et limp : pourcentage des mains avec historique preflop disponible.
          3-bet et fold face au 3-bet : pourcentage des occasions, comptees une seule fois par main.
          Les blindes forcees ne sont pas des actions volontaires. Les limps incluent les overlimps.
          Les compteurs sous chaque taux indiquent le numerateur et le denominateur.
          Un petit echantillon ou un taux atypique ne suffit pas a conclure a une erreur.
        </p>
        <div className="stack-table-wrap" role="region" aria-label="Frequences preflop par stack" tabIndex={0}>
          <table className="stack-table">
            <thead><tr>
              <th scope="col">Stack hero</th><th scope="col">Mains preflop</th><th scope="col">VPIP</th>
              <th scope="col">PFR</th><th scope="col">Limp</th><th scope="col">3-bet</th><th scope="col">Fold au 3-bet</th>
            </tr></thead>
            <tbody>{analysis.rows.map((row) => preflopRow(row, STACK_BUCKETS[row.bucket]))}</tbody>
            <tfoot>{preflopRow(analysis.total, 'Total selection')}</tfoot>
          </table>
        </div>
      </section>
    </>}
  </div>
})
