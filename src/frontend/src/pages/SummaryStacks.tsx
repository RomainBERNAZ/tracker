import { memo, useEffect, useMemo, useState } from 'react'
import { createReviewState } from '../reviewState'
import { api } from '../api'
import type { StackStatsSnapshot, TournamentRow } from '../api'
import { analyzeStacks, STACK_BUCKETS, stackDiagnostics, stackRates, toggleStackBucket } from './stackAnalysis'
import type { StackAnalysisRow, StackFormat } from './stackAnalysis'
import { HandFormatFilter, HeroStackFilter } from './StackHandFilters'

const number = (value: number | null, digits = 1) => value == null ? '-' :
  value.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const gain = (value: number | null) => value == null ? '-' :
  value.toLocaleString('fr-FR', { maximumFractionDigits: 2, signDisplay: 'exceptZero' })

function Gain({ value }: { readonly value: number | null }) {
  const tone = value == null || value === 0 ? 'neutral' : value > 0 ? 'positive' : 'negative'
  return <span className={tone}>{gain(value)}</span>
}

function Frequency({ count, opportunities, metric }: {
  readonly count: number
  readonly opportunities: number
  readonly metric: 'vpip' | 'pfr' | 'limp' | 'three-bet' | 'fold-three-bet'
}) {
  const percentage = opportunities > 0 ? count * 100 / opportunities : null
  return <div className={`stack-frequency stack-frequency-${metric}`}>
    <strong>{number(percentage)}{percentage != null ? ' %' : ''}</strong>
    <span className="stack-frequency-track" aria-hidden="true">
      {percentage != null && <span style={{ width: `${percentage}%` }} />}
    </span>
    <small className="stack-sample">{count} / {opportunities}</small>
  </div>
}

const useStackFormat = createReviewState<StackFormat>(() => 'all')
const useStackBuckets = createReviewState<readonly number[]>(() => [])
const useStackUnit = createReviewState<'chips' | 'bb'>(() => 'chips')

export default memo(function SummaryStacks({ tournaments }: { readonly tournaments: readonly TournamentRow[] }) {
  const [snapshot, setSnapshot] = useState<StackStatsSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [format, setFormat] = useStackFormat()
  const [buckets, setBuckets] = useStackBuckets()
  const [unit, setUnit] = useStackUnit()

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
  const diagnostics = useMemo(() => stackDiagnostics(snapshot?.groups ?? [], format, buckets), [snapshot, format, buckets])
  const unitLabel = unit === 'chips' ? 'jetons' : 'BB'
  const totalRates = stackRates(analysis.total, tournaments.length, unit)
  const maxRate = Math.max(0, ...analysis.rows.map((row) => Math.abs(stackRates(row, tournaments.length, unit).evPer100 ?? 0)))

  function volume(row: StackAnalysisRow) {
    const share = analysis.total.hands > 0 ? row.hands * 100 / analysis.total.hands : null
    return <>
      <strong>{number(row.hands, 0)}</strong>
      <small className="stack-sample">{share == null ? '-' : `${number(share)} % de la selection`}</small>
      {row.hands > 0 && row.hands < 100 && <small className="stack-small-sample">Peu de mains</small>}
    </>
  }

  function performanceRow(row: StackAnalysisRow, label: string) {
    const rates = stackRates(row, tournaments.length, unit)
    const barWidth = rates.evPer100 != null && maxRate > 0 ? Math.abs(rates.evPer100) * 50 / maxRate : 0
    return <tr key={row.bucket}>
      <th scope="row">{label}</th>
      <td>{volume(row)}</td>
      <td><Gain value={rates.netPer100} /></td>
      <td className="stack-rate-cell">
        <strong><Gain value={rates.evPer100} /></strong>
        <div className="stack-rate-track" aria-hidden="true">
          {rates.evPer100 != null && <span className={rates.evPer100 < 0 ? 'stack-rate-negative' : 'stack-rate-positive'}
            style={{ width: `${barWidth}%`, left: rates.evPer100 < 0 ? `${50 - barWidth}%` : '50%' }} />}
        </div>
      </td>
      <td><Gain value={row[unit].ev} /></td>
      <td><Gain value={rates.cevPerTournament} /></td>
    </tr>
  }

  function showdownRow(row: StackAnalysisRow, label: string) {
    const values = row[unit]
    return <tr key={row.bucket}>
      <th scope="row">{label}</th>
      <td><Gain value={values.net} /></td><td><Gain value={values.ev} /></td>
      <td><Gain value={values.sd} /></td><td><Gain value={values.sd_ev} /></td>
      <td><Gain value={values.wsd} /></td><td><Gain value={values.wsd_ev} /></td>
    </tr>
  }

  function preflopRow(row: StackAnalysisRow, label: string) {
    return <tr key={row.bucket}>
      <th scope="row">{label}</th>
      <td>{number(row.preflopHands, 0)}</td>
      <td><Frequency count={row.vpip} opportunities={row.preflopHands} metric="vpip" /></td>
      <td><Frequency count={row.pfr} opportunities={row.preflopHands} metric="pfr" /></td>
      <td><Frequency count={row.limp} opportunities={row.preflopHands} metric="limp" /></td>
      <td><Frequency count={row.threeBet} opportunities={row.threeBetOpportunities} metric="three-bet" /></td>
      <td><Frequency count={row.foldToThreeBet} opportunities={row.foldToThreeBetOpportunities} metric="fold-three-bet" /></td>
    </tr>
  }

  return <div className="stack-analysis">
    <section className="summary-card">
      <h3>Analyse par stack du hero</h3>
      <p className="variance-description">
        Compare les profondeurs avec l'EV / 100 mains, puis regarde le volume et tes habitudes preflop.
        Les filtres date et buy-ins de Summary s'appliquent ; ceux ci-dessous restent propres a cet onglet.
      </p>
      <div className="filter-groups stack-filters">
        <HandFormatFilter format={format} onChange={setFormat} />
        <fieldset className="filter-group" aria-label="Unite des resultats stacks">
          <legend>Unite des resultats</legend>
          <p className="filter-group-hint">La contribution cEV reste en jetons</p>
          <div className="period-pill-bar">
            {(['chips', 'bb'] as const).map((key) =>
              <button key={key} type="button" className={`period-pill${unit === key ? ' period-pill-active' : ''}`}
                aria-pressed={unit === key} onClick={() => setUnit(key)}>{key === 'chips' ? 'Jetons' : 'BB'}</button>)}
          </div>
        </fieldset>
        <HeroStackFilter buckets={buckets} onReset={() => setBuckets([])}
          onToggle={(bucket) => setBuckets((current) => toggleStackBucket(current, bucket))} />
      </div>
      <details className="stack-method">
        <summary>Definitions et calculs</summary>
        <p>Stack du hero au debut de la main, avant les blindes, divise par la grosse blinde.
          Les bornes hautes 8, 12 et 20 BB sont incluses.</p>
        <p>Net / 100 = gain realise / mains x 100. EV / 100 = Net EV / mains x 100.
          En BB, chaque gain est divise par sa propre grosse blinde avant addition.</p>
        <p>Contribution cEV = Net EV de ces mains / {tournaments.length} tournois du perimetre date et buy-ins,
          toujours en jetons. Les contributions s'additionnent au cEV global si toutes les mains sont exploitables.
          Ce n'est pas une moyenne par tournoi ayant atteint ce stack.</p>
        <p>Le repere "Peu de mains" apparait sous 100 mains : ce n'est pas un seuil de fiabilite statistique.
          VPIP, PFR et limp utilisent les mains avec historique preflop ; 3-bet et fold au 3-bet utilisent les occasions,
          comptees une seule fois par main. Les limps incluent les overlimps, pas les blindes forcees.</p>
      </details>
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
      <div className="stats-bar stack-metrics">
        <div className="stat-card"><div className="label">Mains analysees</div><div className="value">{number(analysis.total.hands, 0)}</div>
          <small className="stack-sample">{tournaments.length} tournois dans le perimetre</small></div>
        <div className="stat-card stack-metric-primary"><div className="label">EV / 100 mains ({unitLabel})</div><div className="value"><Gain value={totalRates.evPer100} /></div>
          <small className="stack-sample">Pour comparer a volume egal</small></div>
        <div className="stat-card"><div className="label">Net EV total ({unitLabel})</div><div className="value"><Gain value={analysis.total[unit].ev} /></div>
          <small className="stack-sample">Contribution cEV : <Gain value={totalRates.cevPerTournament} /> jetons / tournoi</small></div>
        <div className="stat-card"><div className="label">Ecart reel - EV ({unitLabel})</div><div className="value"><Gain value={analysis.total.hands > 0 ? analysis.total[unit].net - analysis.total[unit].ev : null} /></div>
          <small className="stack-sample">Net reel : <Gain value={analysis.total[unit].net} /> {unitLabel}</small></div>
      </div>
      {analysis.total.hands === 0 && <p role="status">Aucune main exploitable pour ces filtres.</p>}
      <aside className="stack-reading-guide" aria-label="Comment lire les statistiques">
        <strong>Comment l'exploiter ?</strong>
        <ul>
          <li>{format === 'all' ? 'Separe d\'abord Heads-up et 3 joueurs : leur melange peut masquer des differences de jeu.' :
            'Garde le meme format pour comparer les profondeurs.'} Pour comparer malgre les changements de blindes, utilise les BB.</li>
          <li>L'EV / 100 compare les gains ajustes au meme volume. Verifie le nombre de mains avant de choisir une tranche a revoir.</li>
          <li>Les frequences decrivent ton style, pas sa qualite. Des pertes, surtout depuis les blindes, ne prouvent pas une erreur :
            il faut aussi regarder les positions et revoir les decisions.</li>
        </ul>
      </aside>
      <section className="summary-card">
        <div className="summary-card-header"><h3>Comparer les profondeurs</h3>
          <div className="stack-legend"><span className="positive">+ Gain</span><span className="negative">- Perte</span></div></div>
        <p className="variance-description">EV / 100 : performance ajustee au volume. Net EV total et contribution cEV : poids dans tes resultats.
          Les barres partent de zero et utilisent la meme echelle dans cette selection.</p>
        <div className="stack-table-wrap" role="region" aria-label="Resultats par stack" tabIndex={0}>
          <table className="stack-table stack-performance-table">
            <thead><tr>
              <th scope="col">Stack hero</th><th scope="col">Mains</th>
              <th scope="col">Net / 100<small className="stack-sample">{unitLabel}</small></th>
              <th scope="col" className="stack-rate-cell">EV / 100<small className="stack-sample">{unitLabel}</small></th>
              <th scope="col">Net EV total<small className="stack-sample">{unitLabel}</small></th>
              <th scope="col" title="Net EV du segment divise par tous les tournois du perimetre">Contrib. cEV<small className="stack-sample">jetons / tournoi</small></th>
            </tr></thead>
            <tbody>{analysis.rows.map((row) => performanceRow(row, STACK_BUCKETS[row.bucket]))}</tbody>
            <tfoot>{performanceRow(analysis.total, 'Total selection')}</tfoot>
          </table>
        </div>
        <section className="stack-leak-finder" aria-label="Leak finder Expresso">
          <h4>Leak finder Expresso : tes priorites de travail</h4>
          <p className="variance-description">Pistes heuristiques, pas des erreurs prouvees ni des objectifs GTO.
            Heads-up et 3 joueurs sont analyses separement, meme avec le filtre Tous.
            Il examine l'EV en BB et la contribution cEV en jetons, independamment de l'unite des tableaux.
            Les pistes preflop passent en premier, puis les segments perdants en EV, tries par impact en jetons.</p>
          {diagnostics.length === 0 && <p>Aucune main exploitable : aucun diagnostic pour ces filtres.</p>}
          <div className="stack-diagnostic-grid">
            {diagnostics.filter((diagnostic) => diagnostic.outcome !== 'limited').map((diagnostic) => {
              const { row, findings, outcome } = diagnostic
              const rates = stackRates(row, tournaments.length, 'bb')
              const status = findings.length > 0 ? 'Piste preflop' : outcome === 'negative-ev' ? 'Perte EV a revoir' :
                outcome === 'below-ev' ? 'Reel sous l\'EV' : outcome === 'incomplete' ? 'EV incomplete' : 'Pas de signal automatique'
              const performanceUnit = (outcome === 'negative-ev' ? row.bb.ev < 0 : row.bb.net < 0) ? 'bb' : 'chips'
              const values = row[performanceUnit]
              const resultUnit = performanceUnit === 'bb' ? 'BB' : 'jetons'
              const showdownLoss = values.sd_ev < values.wsd_ev
              return <article key={`${diagnostic.playerCount}-${row.bucket}`}
                className={`stack-diagnostic${findings.length > 0 || outcome === 'negative-ev' ? ' stack-diagnostic-review' : ''}`}>
                <header><h5>{diagnostic.playerCount === 2 ? 'Heads-up' : '3 joueurs'} · {STACK_BUCKETS[row.bucket]}</h5>
                  <span>{status}</span></header>
                <p className="stack-diagnostic-metrics">{number(row.hands, 0)} mains · EV / 100 : <Gain value={rates.evPer100} /> BB
                  {' '}· Contribution cEV : <Gain value={rates.cevPerTournament} /> jetons / tournoi</p>
                {outcome === 'negative-ev' && <>
                  <p>{values.net >= 0 ? 'Le reel ne perd pas, mais l\'EV est negative' :
                    'Ce segment est perdant meme apres ajustement EV'} en {resultUnit}.
                    {' '}Cela en fait une priorite de revue, pas la preuve d'un leak.</p>
                  <p>Le poste le plus negatif est {showdownLoss ? 'avec showdown' : 'sans showdown'} :
                    {' '}<Gain value={showdownLoss ? values.sd_ev : values.wsd_ev} /> {resultUnit} EV.
                    {showdownLoss ? ' Revois les calls de tapis et les gros pots arrives au showdown.' :
                      ' Les pertes sans showdown incluent les blindes : ne conclus pas automatiquement qu\'il faut bluffer davantage.'}</p>
                </>}
                {outcome === 'below-ev' && <p>En {resultUnit}, le reel est perdant, mais l'EV ne l'est pas. L'ecart reel - EV
                  est de <Gain value={values.net - values.ev} /> {resultUnit}.
                  Ne modifie pas tes ranges sur les seules pertes realisees ; cela ne valide pas non plus toutes tes decisions.</p>}
                {outcome === 'incomplete' && <p>{number(row.missingEvHands, 0)} mains sans EV, remplacee par le reel :
                  diagnostic de performance suspendu. Seules les pistes preflop suffisamment documentees restent analysees.</p>}
                {outcome === 'no-signal' && <p>L'EV de ce segment n'est negative ni en BB ni en jetons. Ce constat ne suffit pas a valider ta strategie
                  ni a exclure des erreurs masquees dans la moyenne.</p>}
                {outcome !== 'incomplete' && (row.bb.ev < 0) !== (row.chips.ev < 0) && <p>L'EV en BB et en jetons n'a pas le meme signe :
                  les grosses blindes pesent davantage dans les totaux en jetons, alors que les BB normalisent chaque main.</p>}
                {row.preflopHands < 200 && <p>Seulement {number(row.preflopHands, 0)} mains avec actions preflop :
                  pas de diagnostic de frequences.</p>}
                {findings.length > 0 && <ul>{findings.map((finding) =>
                  <li key={finding.id}><strong>{finding.title}</strong><p>{finding.evidence}</p><p>{finding.action}</p></li>)}</ul>}
                <p className="stack-diagnostic-focus"><strong>Revue Expresso : </strong>{diagnostic.focus}</p>
                <button type="button" className="period-pill"
                  onClick={() => { setFormat(diagnostic.playerCount === 2 ? '2' : '3'); setBuckets([row.bucket]) }}>
                  Isoler ce segment
                </button>
              </article>
            })}
          </div>
          {diagnostics.some((diagnostic) => diagnostic.outcome === 'limited') && <p className="stack-diagnostic-limited">
            Volume trop faible pour un diagnostic : {diagnostics.filter((diagnostic) => diagnostic.outcome === 'limited')
              .map(({ playerCount, row }) => `${playerCount === 2 ? 'HU' : '3 joueurs'} ${STACK_BUCKETS[row.bucket]} (${number(row.hands, 0)} mains)`).join(' ; ')}.
          </p>}
          <p className="stack-diagnostic-limits">Reperes de tri : 200 mains par segment et 200 mains avec actions pour les pistes preflop ;
            30 decisions pour le fold au 3-bet (alerte a partir de 80 %, ou jusqu'a 20 % au-dessus de 12 BB).
            Le VPIP HU sous 40 % est examine seulement au-dessus de 8 BB.
            Ce ne sont ni des seuils de fiabilite statistique, ni des ranges a appliquer.
            Sans positions, sizings et stack effectif dans ces agregats, aucun leak n'est confirme.
            Un limp HU ou l'absence de 3-bet face a des opens a tapis ne sont pas signales comme des erreurs.
            Verifie toujours le stack effectif et la structure des gains : les paliers des gros multiplicateurs peuvent changer les decisions de tapis.</p>
        </section>
      </section>
      <section className="summary-card">
        <h3>Comprendre ton jeu preflop</h3>
        <p className="variance-description">
          Une couleur par statistique, sans jugement bon / mauvais. Chaque compteur indique actions / occasions.
          Compare notamment l'ecart VPIP - PFR pour voir la part de jeu passif, puis les limps et les reactions aux relances.
        </p>
        <div className="stack-table-wrap" role="region" aria-label="Frequences preflop par stack" tabIndex={0}>
          <table className="stack-table">
            <thead><tr>
              <th scope="col">Stack hero</th><th scope="col">Mains preflop</th>
              <th scope="col" title="Mains avec investissement volontaire preflop">VPIP</th>
              <th scope="col" title="Mains avec au moins une relance preflop">PFR</th>
              <th scope="col" title="Premier choix : call sans relance prealable, overlimps inclus">Limp</th>
              <th scope="col" title="Surrelances / occasions face a une premiere relance">3-bet</th>
              <th scope="col" title="Folds / decisions observees face au 3-bet apres ton open">Fold au 3-bet</th>
            </tr></thead>
            <tbody>{analysis.rows.map((row) => preflopRow(row, STACK_BUCKETS[row.bucket]))}</tbody>
            <tfoot>{preflopRow(analysis.total, 'Total selection')}</tfoot>
          </table>
        </div>
      </section>
      <details className="summary-card stack-details">
        <summary>Details des gains et showdowns ({unitLabel})</summary>
        <p className="variance-description">Totaux, pas des taux par main. SD : hero au showdown.
          Sans SD : hero sans showdown, meme si les adversaires y vont.</p>
        <div className="stack-table-wrap" role="region" aria-label="Gains et showdowns par stack" tabIndex={0}>
          <table className="stack-table">
            <thead><tr>
              <th scope="col">Stack hero</th><th scope="col">Net reel</th><th scope="col">Net EV</th>
              <th scope="col">SD net</th><th scope="col">SD EV</th><th scope="col">Sans SD net</th><th scope="col">Sans SD EV</th>
            </tr></thead>
            <tbody>{analysis.rows.map((row) => showdownRow(row, STACK_BUCKETS[row.bucket]))}</tbody>
            <tfoot>{showdownRow(analysis.total, 'Total selection')}</tfoot>
          </table>
        </div>
      </details>
    </>}
  </div>
})
