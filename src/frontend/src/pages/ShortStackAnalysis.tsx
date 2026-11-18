import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api'
import type { ShortStackEncounter, ShortStackMatchup, ShortStackSnapshot, ShortStackTournament } from '../api'
import { createReviewState } from '../reviewState'
import { formatDateInput } from './tournamentFilters'
import { applyEncounterFilters, BREAKDOWN, CATEGORIES, classify, compareDistributions,
  eqMatchup, summarize, volumeTrend, wilson } from './shortStackStats'
import type { EncounterFilters, Sample } from './shortStackStats'
import './ShortStackAnalysis.css'

type Range = { from: string, to: string }
type Option = readonly [string, string]
const emptyRange = (): Range => ({ from: '', to: '' })
const useGlobalRange = createReviewState(emptyRange)
const useWinningRange = createReviewState(emptyRange)
const useLosingRange = createReviewState(emptyRange)
const useFilters = createReviewState<EncounterFilters>(() => ({
  format: '', stack: '', shortPlayer: '', position: '', rank: '', action: '', actionSide: 'villain', revealed: '',
}))
const useRoom = createReviewState(() => '')
const useBuyIn = createReviewState(() => '')
const useBatchSize = createReviewState(() => 100)
const tones = ['#56b4e9', '#ef965a']
const initialChartSize = { width: 720, height: 280 }
const number = (value: number, digits = 1) => value.toLocaleString('fr-FR', { maximumFractionDigits: digits })
const cash = (value: number) => value.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
const percent = (value: number | null) => value == null ? '—' : `${number(100 * value)} %`
const pp = (value: number | null) => value == null ? '—' : `${value > 0 ? '+' : ''}${number(100 * value)} pp`
const ratio = (count: number, total: number) => total ? count / total : null
const delta = (a: number | null, b: number | null) => a == null || b == null ? null : b - a
const rate = (count: number, total: number) => {
  const interval = wilson(count, total)
  return <>{count} / {total} · {percent(ratio(count, total))}
    {interval && <small className="short-stack-interval">IC 95 % : {percent(interval[0])} à {percent(interval[1])}</small>}</>
}

function Select({ label, value, options, onChange, all = true }: {
  label: string, value: string, options: readonly Option[], onChange: (value: string) => void, all?: boolean,
}) {
  return <label>{label}<select className="filter-select" value={value} onChange={(e) => onChange(e.target.value)}>
    {all && <option value="">Tous</option>}{options.map(([id, name]) => <option value={id} key={id}>{name}</option>)}
  </select></label>
}

function DateRange({ label, range, set }: { label: string, range: Range, set: (range: Range) => void }) {
  return <fieldset className="filter-group"><legend>{label}</legend><div className="short-stack-fields">
    <label>Du<input className="filter-input" type="date" value={range.from} onChange={(e) => set({ ...range, from: e.target.value })} /></label>
    <label>Au<input className="filter-input" type="date" value={range.to} onChange={(e) => set({ ...range, to: e.target.value })} /></label>
  </div></fieldset>
}

function inRange(tournament: ShortStackTournament, range: Range) {
  if (!range.from && !range.to) return true
  const timestamp = Date.parse(tournament.started_at)
  if (!Number.isFinite(timestamp)) return false
  const date = formatDateInput(timestamp)
  return (!range.from || date >= range.from) && (!range.to || date <= range.to)
}

function selectRows(rows: readonly ShortStackEncounter[], tournaments: readonly ShortStackTournament[]) {
  const ids = new Set(tournaments.map(({ id }) => id))
  return rows.filter(({ tournament_id }) => ids.has(tournament_id))
}

function Equity({ sample, field }: { sample: Sample, field: 'heroEquity' | 'villainEquity' | 'equityGap' }) {
  return <>{field === 'equityGap' ? pp(sample[field]) : percent(sample[field])}
    <small className="short-stack-interval">{sample.equityCount} / {sample.equityEligible} avec deux mains connues</small></>
}

function TestResult({ title, result }: { title: string, result: ReturnType<typeof compareDistributions> }) {
  return <p><strong>{title} :</strong> {result == null ? 'effectifs ou diversité insuffisants.'
    : result.p == null ? `${result.label} — trop de tables possibles pour le calcul exact.`
      : `${result.label} · p ${result.p < 0.0001 ? '< 0,0001' : `= ${number(result.p, 4)}`}`}</p>
}

export default function ShortStackAnalysis() {
  const [snapshot, setSnapshot] = useState<ShortStackSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [globalRange, setGlobalRange] = useGlobalRange()
  const [winRange, setWinRange] = useWinningRange()
  const [lossRange, setLossRange] = useLosingRange()
  const [room, setRoom] = useRoom()
  const [buyIn, setBuyIn] = useBuyIn()
  const [filters, setFilters] = useFilters()
  const [batchSize, setBatchSize] = useBatchSize()
  const [equities, setEquities] = useState<ReadonlyMap<string, number | null>>(() => new Map())
  const [equityBusy, setEquityBusy] = useState(false)
  const [equityError, setEquityError] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  useEffect(() => {
    let active = true
    api.getShortStackAnalysis().then((data) => { if (active) setSnapshot(data) })
      .catch((cause) => { if (active) setError(String(cause)) })
    return () => { active = false }
  }, [attempt])

  const allTours = useMemo(() => snapshot?.tournaments ?? [], [snapshot])
  const globalValid = !globalRange.from || !globalRange.to || globalRange.from <= globalRange.to
  const tours = useMemo(() => allTours.filter((tour) => globalValid && inRange(tour, globalRange)
    && (!room || tour.room === room) && (!buyIn || tour.buy_in === Number(buyIn))), [allTours, globalRange, room, buyIn, globalValid])
  const rows = useMemo(() => applyEncounterFilters(selectRows(snapshot?.encounters ?? [], tours), filters),
    [snapshot, tours, filters])
  const detail = useMemo(() => [...rows].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)), [rows])
  const pageSize = 50
  const visiblePage = Math.min(page, Math.max(1, Math.ceil(detail.length / pageSize)))
  const updateFilter = <K extends keyof EncounterFilters>(key: K, value: EncounterFilters[K]) => {
    setPage(1)
    setFilters({ ...filters, [key]: value })
  }
  const winReady = Boolean(winRange.from && winRange.to)
  const lossReady = Boolean(lossRange.from && lossRange.to)
  const rangeError = winReady && lossReady && (winRange.from > winRange.to || lossRange.from > lossRange.to
    ? 'Chaque date de début doit précéder ou égaler sa date de fin.'
    : winRange.from <= lossRange.to && lossRange.from <= winRange.to ? 'Les deux périodes doivent être disjointes.' : null)
  const compareReady = winReady && lossReady && !rangeError && globalValid
  const winTours = useMemo(() => compareReady ? tours.filter((tour) => inRange(tour, winRange)) : [], [compareReady, tours, winRange])
  const lossTours = useMemo(() => compareReady ? tours.filter((tour) => inRange(tour, lossRange)) : [], [compareReady, tours, lossRange])
  const winRows = useMemo(() => selectRows(rows, winTours), [rows, winTours])
  const lossRows = useMemo(() => selectRows(rows, lossTours), [rows, lossTours])
  const net = (sample: readonly ShortStackTournament[]) => sample.reduce((sum, tour) => sum + tour.net_eur, 0)
  const winNet = net(winTours), lossNet = net(lossTours)
  const signsValid = Math.round(winNet * 100) > 0 && Math.round(lossNet * 100) < 0
  const global = useMemo(() => summarize(rows, equities), [rows, equities])
  const win = useMemo(() => summarize(winRows, equities), [winRows, equities])
  const loss = useMemo(() => summarize(lossRows, equities), [lossRows, equities])
  const firstWin = useMemo(() => summarize(winRows.filter(({ rank }) => rank === 1)), [winRows])
  const firstLoss = useMemo(() => summarize(lossRows.filter(({ rank }) => rank === 1)), [lossRows])
  const rankSamples = useMemo(() => [
    { label: '1re confrontation', sample: summarize(rows.filter(({ rank }) => rank === 1)) },
    { label: 'Suivantes', sample: summarize(rows.filter(({ rank }) => (rank ?? 0) > 1)) },
    { label: 'Rang indéterminé (vilain ≤ 5 BB)', sample: summarize(rows.filter(({ rank, villain_bb }) => rank == null && villain_bb <= 5)) },
    { label: 'Hero seul à ≤ 5 BB', sample: summarize(rows.filter(({ villain_bb }) => villain_bb > 5)) },
  ], [rows])
  const ranks = useMemo(() => ['1re', '2e', '3e', '4e et +'].map((label, index) => {
    const sample = summarize(rows.filter(({ rank }) => index === 3 ? (rank ?? 0) >= 4 : rank === index + 1))
    return { label: `${label} (${sample.revealed}/${sample.total})`, strong: sample.revealed ? 100 * sample.strong / sample.revealed : null }
  }), [rows])
  const trend = useMemo(() => volumeTrend(tours, rows, batchSize), [tours, rows, batchSize])
  const fullTest = useMemo(() => compareDistributions(CATEGORIES.map((label) => win.categories[label]),
    CATEGORIES.map((label) => loss.categories[label])), [win, loss])
  const rankTest = useMemo(() => compareDistributions([firstWin.strong, firstWin.weak], [firstLoss.strong, firstLoss.weak]), [firstWin, firstLoss])

  async function calculateEquities() {
    const pending = new Map<string, ShortStackMatchup>()
    for (const row of rows) {
      const matchup = eqMatchup(row)
      if (matchup && classify(row.villain_cards) && !equities.has(matchup.key)) pending.set(matchup.key, matchup.duel)
    }
    setEquityBusy(true)
    setEquityError(null)
    try {
      const entries = [...pending]
      for (let start = 0; start < entries.length; start += 128) {
        const batch = entries.slice(start, start + 128)
        const result = await api.getShortStackEquities(batch.map(([, duel]) => duel))
        setEquities((previous) => new Map([...previous, ...batch.map(([key], i) => [key, result[i]] as const)]))
      }
    } catch (cause) {
      setEquityError(String(cause))
    } finally {
      setEquityBusy(false)
    }
  }

  const actionLabels: Record<string, string> = { allin_call: 'call à tapis', check: 'check', fold: 'fold', limp: 'limp', shove: 'shove', call: 'call', raise: 'relance', bet: 'mise', forced_allin: 'blinde à tapis' }
  const results = { won: 'Gagné', lost: 'Perdu', split: 'Partagé', multiple: 'Plusieurs gains (3-way)' }
  const comparisonRows: { label: string, win: number, loss: number, wTotal?: number, lTotal?: number }[] = [
    { label: 'Tournois', win: winTours.length, loss: lossTours.length },
    { label: 'Confrontations ≤ 5 BB effectives', win: win.total, loss: loss.total },
    { label: 'Mains révélées', win: win.revealed, loss: loss.revealed, wTotal: win.total, lTotal: loss.total },
    { label: 'Mains non révélées', win: win.hidden, loss: loss.hidden, wTotal: win.total, lTotal: loss.total },
    ...CATEGORIES.map((label) => ({ label, win: win.categories[label], loss: loss.categories[label], wTotal: win.revealed, lTotal: loss.revealed })),
    ...(['pairs', 'weak', 'strong'] as const).map((field, i) => ({ label: ['Paires (total)', 'Mains faibles', 'Mains fortes'][i],
      win: win[field], loss: loss[field], wTotal: win.revealed, lTotal: loss.revealed })),
    { label: 'Premières confrontations', win: firstWin.total, loss: firstLoss.total },
    { label: 'Révélées en 1re confrontation', win: firstWin.revealed, loss: firstLoss.revealed,
      wTotal: firstWin.total, lTotal: firstLoss.total },
    { label: 'Mains fortes en 1re confrontation', win: firstWin.strong, loss: firstLoss.strong, wTotal: firstWin.revealed, lTotal: firstLoss.revealed },
  ]
  const distribution = CATEGORIES.map((label) => ({ label,
    winner: win.revealed ? 100 * win.categories[label] / win.revealed : null,
    loser: loss.revealed ? 100 * loss.categories[label] / loss.revealed : null,
  }))

  return <div className="short-stack-page">
    <header className="page-header"><h2>Jeu short-stack</h2>
      <p>Les adversaires révèlent-ils des mains plus fortes lors de leur première confrontation à 5 BB ou moins ?</p></header>
    {error && <p role="alert">Impossible de charger l’analyse : {error} <button type="button" className="filter-reset" onClick={() => { setError(null); setAttempt(attempt + 1) }}>Réessayer</button></p>}
    {!snapshot && !error && <p role="status">Chargement des confrontations…</p>}
    {snapshot && <>
      <nav className="short-stack-fields" aria-label="Sections de l’analyse">
        <a href="#short-stack-global">Vue globale</a>
        <a href="#short-stack-compare">Comparaison</a>
        <a href="#short-stack-details">Détail des confrontations</a>
      </nav>
      <section className="summary-card">
        <h2>Périmètre commun</h2>
        <DateRange label="Période personnalisée (dates des tournois)" range={globalRange} set={(range) => { setPage(1); setGlobalRange(range) }} />
        {!globalValid && <p role="alert">La date de début doit précéder ou égaler la date de fin.</p>}
        <div className="short-stack-fields">
          <Select label="Room" value={room} options={[...new Set(allTours.map(({ room }) => room))].sort().map((name) => [name, name])} onChange={(value) => { setPage(1); setRoom(value) }} />
          <Select label="Buy-in (rake inclus)" value={buyIn} options={[...new Set(allTours.map(({ buy_in }) => buy_in))].sort((a, b) => a - b).map((n) => [String(n), cash(n)])} onChange={(value) => { setPage(1); setBuyIn(value) }} />
          <Select label="Format" value={filters.format} options={[['2', 'HU'], ['3', '3-way']]} onChange={(value) => updateFilter('format', value)} />
          <Select label="Stack effectif" value={filters.stack} options={['0–2 BB', '>2–3 BB', '>3–4 BB', '>4–5 BB'].map((label, i) => [String(i), label])} onChange={(value) => updateFilter('stack', value)} />
          <Select label="Joueur short stack" value={filters.shortPlayer} options={[['villain', 'Vilain ≤ 5 BB'], ['hero', 'Hero seul ≤ 5 BB']]} onChange={(value) => updateFilter('shortPlayer', value)} />
          <Select label="Position adverse" value={filters.position} options={['BTN', 'SB', 'BB', '?'].map((label) => [label, label === '?' ? 'Inconnue' : label])} onChange={(value) => updateFilter('position', value)} />
          <Select label="Rang dans l’épisode" value={filters.rank} options={[['first', 'Première'], ['later', 'Suivantes'], ['unknown', 'Indéterminé (vilain ≤ 5 BB)']]} onChange={(value) => updateFilter('rank', value)} />
          <Select label="Joueur pour le filtre d’action" value={filters.actionSide} options={[['villain', 'Vilain'], ['hero', 'Hero']]} all={false} onChange={(value) => updateFilter('actionSide', value === 'hero' ? 'hero' : 'villain')} />
          <Select label="Action préflop" value={filters.action} options={Object.entries(actionLabels).map(([id, label]) => [id, label])} onChange={(value) => updateFilter('action', value)} />
          <Select label="Cartes adverses" value={filters.revealed} options={[['yes', 'Révélées'], ['no', 'Non révélées']]} onChange={(value) => updateFilter('revealed', value)} />
        </div>
        <p className="short-stack-summary" aria-live="polite">{tours.length} tournois · {global.total} confrontations · {global.revealed} révélées · {global.hidden} non révélées</p>
        <p className="variance-description">Une ligne par paire Hero–vilain en interaction préflop. Les walks et les folds sans mise adverse active ne comptent pas.
          En HU, BTN est aussi SB. Le rang est calculé avant filtrage, après un passage observé de &gt; 5 BB à ≤ 5 BB pour ce vilain.</p>
        <p className="short-stack-warning">Les cartes révélées sont un échantillon sélectionné : leur répartition ne représente pas toutes les mains reçues.
          Les filtres de révélation modifient les effectifs affichés ; sélectionne « Tous » pour mesurer la couverture.</p>
      </section>

      <section className="summary-card" id="short-stack-global">
        <h2>Vue globale</h2>
        {global.total === 0 && <p>Aucune confrontation dans le périmètre sélectionné.</p>}
        <div className="short-stack-columns">
          <div className="table-wrap"><table><caption>Catégories exclusives parmi les mains révélées</caption>
            <thead><tr><th>Catégorie</th><th>Effectif · fréquence</th></tr></thead><tbody>
              {CATEGORIES.map((label) => <tr key={label}><th scope="row">{label}</th><td>{rate(global.categories[label], global.revealed)}</td></tr>)}
            </tbody></table></div>
          <div className="table-wrap"><table><caption>Détail des Ax, Kx et paires (AK classé Premium)</caption>
            <thead><tr><th>Sous-groupe</th><th>Effectif · fréquence parmi les révélées</th></tr></thead><tbody>
              {BREAKDOWN.map((label) => <tr key={label}><th scope="row">{label}</th><td>{rate(global.breakdown[label], global.revealed)}</td></tr>)}
            </tbody></table></div>
        </div>
        <div className="table-wrap"><table><caption>Première confrontation et suivantes</caption>
          <thead><tr><th>Événement</th><th>Total</th><th>Révélées</th><th>Non révélées</th>{CATEGORIES.map((label) => <th key={label}>{label}</th>)}<th>Fortes</th><th>Faibles</th></tr></thead>
          <tbody>{rankSamples.map(({ label, sample }) => <tr key={label}><th scope="row">{label}</th><td>{sample.total}</td>
            <td>{sample.revealed}</td><td>{sample.hidden}</td>{CATEGORIES.map((cat) => <td key={cat}>{sample.categories[cat]}</td>)}
            <td>{rate(sample.strong, sample.revealed)}</td><td>{rate(sample.weak, sample.revealed)}</td></tr>)}</tbody>
        </table></div>
        <p className="variance-description">Fortes : toutes les paires et les mains non appariées avec A, K ou Q. Les connecteurs déjà classés Ax, Kx ou Qx ne sont pas recomptés.</p>
        <h3>Mains fortes par rang (révélées / confrontations)</h3>
        {ranks.some(({ strong }) => strong != null) ? <div className="short-stack-chart">
          <ResponsiveContainer width="100%" height="100%" initialDimension={initialChartSize}><BarChart data={ranks}>
            <CartesianGrid strokeDasharray="3 3" stroke="#52596b" /><XAxis dataKey="label" /><YAxis domain={[0, 100]} unit=" %" />
            <Tooltip formatter={(value) => `${number(Number(value))} %`} />
            <Bar dataKey="strong" name="Mains fortes" fill={tones[0]} />
          </BarChart></ResponsiveContainer>
        </div> : <p>Aucune main révélée avec un rang connu.</p>}

        <h3>Évolution par tranche de tournois</h3>
        <div className="short-stack-fields"><Select label="Taille des tranches" value={String(batchSize)} all={false}
          options={[['100', '100 tournois'], ['200', '200 tournois']]} onChange={(value) => setBatchSize(Number(value))} /></div>
        {trend.length > 0 && <div className="short-stack-chart">
          <ResponsiveContainer width="100%" height="100%" initialDimension={initialChartSize}><ComposedChart data={trend}>
            <CartesianGrid strokeDasharray="3 3" stroke="#52596b" /><XAxis dataKey="label" />
            <YAxis yAxisId="percent" domain={[0, 100]} unit=" %" /><YAxis yAxisId="volume" orientation="right" allowDecimals={false} />
            <Tooltip formatter={(value, name) => name === 'Mains fortes' ? `${number(Number(value))} %` : value} /><Legend />
            <Bar yAxisId="volume" dataKey="revealed" name="Mains révélées" fill={tones[1]} />
            <Line yAxisId="percent" dataKey="percent" name="Mains fortes" stroke={tones[0]} strokeWidth={2} dot />
          </ComposedChart></ResponsiveContainer>
        </div>}
        <details><summary>Effectifs et IC par tranche</summary><div className="table-wrap"><table>
          <thead><tr><th>Tranche</th><th>Tournois</th><th>Confrontations</th><th>Fortes parmi les révélées</th></tr></thead>
          <tbody>{trend.map((batch) => <tr key={batch.label}><th scope="row">{batch.label}</th><td>{batch.games}</td><td>{batch.total}</td>
            <td>{rate(batch.strong, batch.revealed)}</td></tr>)}</tbody>
        </table></div></details>
      </section>

      <section className="summary-card" id="short-stack-compare">
        <h2>Comparaison : période gagnante / période perdante</h2>
        <div className="short-stack-columns">
          <DateRange label="Période gagnante" range={winRange} set={setWinRange} />
          <DateRange label="Période perdante" range={lossRange} set={setLossRange} />
        </div>
        {rangeError && <p role="alert">{rangeError}</p>}
        {!compareReady ? <p>Sélectionne deux plages complètes et distinctes pour comparer leurs tournois dans le périmètre commun.</p> : <>
          <p>Résultat net gagnante : <strong>{cash(winNet)}</strong> · résultat net perdante : <strong>{cash(lossNet)}</strong></p>
          {!signsValid && <p className="short-stack-warning">Le périmètre n’a pas un résultat strictement positif à gauche et négatif à droite. Les tests sont masqués ; le tableau reste descriptif.</p>}
          {(win.revealed < 30 || loss.revealed < 30 || firstWin.revealed < 30 || firstLoss.revealed < 30) &&
            <p className="short-stack-warning">Échantillon limité : moins de 30 révélations dans au moins un groupe global ou de première confrontation.</p>}
          <div className="table-wrap"><table><caption>Proportions avec IC de Wilson à 95 % · écart = perdante − gagnante</caption>
            <thead><tr><th>Indicateur</th><th>Gagnante</th><th>Perdante</th><th>Écart</th></tr></thead>
            <tbody>{comparisonRows.map(({ label, win: w, loss: l, wTotal, lTotal }) => <tr key={label}>
              <th scope="row">{label}</th><td>{wTotal == null ? w : rate(w, wTotal)}</td><td>{lTotal == null ? l : rate(l, lTotal)}</td>
              <td>{wTotal == null || lTotal == null ? '—' : pp(delta(ratio(w, wTotal), ratio(l, lTotal)))}</td>
            </tr>)}
            {(['heroEquity', 'villainEquity', 'equityGap'] as const).map((field, i) => <tr key={field}>
              <th scope="row">{['Équité préflop Hero', 'Équité préflop vilain', 'Écart moyen vilain − Hero'][i]}</th>
              <td><Equity sample={win} field={field} /></td><td><Equity sample={loss} field={field} /></td><td>{pp(delta(win[field], loss[field]))}</td>
            </tr>)}</tbody>
          </table></div>
          {signsValid && <>
            <TestResult title="Distribution des catégories révélées" result={fullTest} />
            <TestResult title="Hypothèse principale : fortes à la première confrontation" result={rankTest} />
          </>}
          <p className="variance-description">Tests exploratoires : plusieurs observations peuvent venir du même tournoi.
            Les IC et valeurs p ne tiennent pas compte de cette dépendance ni du biais de révélation.
            Utilise les filtres communs pour comparer position, profondeur, format et action identiques.</p>
          <h3>Distribution des mains révélées</h3>
          {win.revealed + loss.revealed > 0 && <div className="short-stack-chart">
            <ResponsiveContainer width="100%" height="100%" initialDimension={initialChartSize}><BarChart data={distribution}>
              <CartesianGrid strokeDasharray="3 3" stroke="#52596b" /><XAxis dataKey="label" /><YAxis domain={[0, 100]} unit=" %" />
              <Tooltip formatter={(value) => `${number(Number(value))} %`} /><Legend />
              <Bar dataKey="winner" name={`Gagnante (${win.revealed} révélées)`} fill={tones[0]} />
              <Bar dataKey="loser" name={`Perdante (${loss.revealed} révélées)`} fill={tones[1]} />
            </BarChart></ResponsiveContainer>
          </div>}
        </>}
        <h3>Équité préflop sur les confrontations révélées</h3>
        <p className="variance-description">Duel Hero–vilain isolé (même en 3-way), sans board connu, avec la moitié des partages.
          Estimation Monte-Carlo (4 096 boards par combinaison) ; ce n’est ni l’équité multiway ni l’EV du coup.</p>
        <button type="button" className="filter-reset" disabled={equityBusy || global.equityCount === global.equityEligible} onClick={() => void calculateEquities()}>
          {equityBusy ? 'Calcul en cours…' : 'Calculer les équités du périmètre'}
        </button>
        {equityError && <p role="alert">Calcul interrompu : {equityError}</p>}
        <p aria-live="polite">
          Hero : {percent(global.heroEquity)} · Vilain : {percent(global.villainEquity)} · Écart vilain − Hero : {pp(global.equityGap)} ·
          {' '}{global.equityCount} calculées / {global.equityEligible} avec deux mains connues / {global.revealed} révélées
        </p>
      </section>

      <section className="summary-card" id="short-stack-details">
        <h2>Détail des confrontations</h2>
        <p className="variance-description">Résultat du coup du point de vue du Hero, selon les gains du pot. En 3-way, plusieurs gains peuvent inclure des pots secondaires.
          L’EV nette du Hero (en BB) n’est affichée que si l’import l’a calculée, et porte sur la main entière.</p>
        <div className="table-wrap"><table>
          <thead><tr>{['Date', 'Tournoi / main', 'Vilain', 'Position', 'Format', 'Eff. BB', 'Vilain BB', 'Hero BB', 'Rang',
            'Action vilain', 'Action Hero', 'Cartes vilain', 'Cartes Hero', 'Catégorie', 'Résultat Hero', 'EV Hero (BB)', 'Éq. Hero', 'Éq. vilain'].map((label) => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{detail.slice((visiblePage - 1) * pageSize, visiblePage * pageSize).map((row) => {
            const matchup = eqMatchup(row)
            const equity = matchup ? equities.get(matchup.key) ?? null : null
            return <tr key={JSON.stringify([row.hand_id, row.villain])}>
              <td>{new Date(row.timestamp).toLocaleString('fr-FR')}</td>
              <td><Link to={`/hands/${encodeURIComponent(row.hand_id)}`}>{row.tournament_id}</Link></td>
              <td>{row.villain}</td><td>{row.position}</td><td>{row.player_count === 2 ? 'HU' : '3-way'}</td>
              <td>{number(row.effective_bb, 2)}</td><td>{number(row.villain_bb, 2)}</td><td>{number(row.hero_bb, 2)}</td>
              <td>{row.rank ?? (row.villain_bb <= 5 ? '?' : '—')}</td>
              <td>{row.villain_actions.map((action) => actionLabels[action] ?? action).join(' → ') || '—'}</td>
              <td>{row.hero_actions.map((action) => actionLabels[action] ?? action).join(' → ') || '—'}</td>
              <td>{row.villain_cards?.join(' ') ?? 'Non révélées'}</td><td>{row.hero_cards?.join(' ') ?? '—'}</td>
              <td>{classify(row.villain_cards)?.category ?? '—'}</td><td>{results[row.result]}</td>
              <td>{row.hero_ev_bb == null ? '—' : number(row.hero_ev_bb, 2)}</td>
              <td>{percent(equity)}</td><td>{percent(equity == null ? null : 1 - equity)}</td>
            </tr>
          })}</tbody>
        </table></div>
        {detail.length === 0 ? <p>Aucune confrontation à afficher.</p> : <div className="short-stack-fields">
          <button type="button" className="filter-reset" disabled={visiblePage === 1} onClick={() => setPage(visiblePage - 1)}>Précédent</button>
          <span>{(visiblePage - 1) * pageSize + 1}–{Math.min(visiblePage * pageSize, detail.length)} sur {detail.length}</span>
          <button type="button" className="filter-reset" disabled={visiblePage * pageSize >= detail.length} onClick={() => setPage(visiblePage + 1)}>Suivant</button>
        </div>}
      </section>
    </>}
  </div>
}
