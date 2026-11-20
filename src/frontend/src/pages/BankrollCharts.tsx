import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { BankrollSnapshot } from '../api'
import { createReviewState } from '../reviewState'
import { bankrollHistory, isBankrollVolume, MAX_BANKROLL_GAMES } from './bankrollEvolution'
import type { BankrollSimulationRequest, BankrollSimulationResponse } from './bankrollEvolution'

const euro = (value: number) => value.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
const tooltipStyle = { background: '#1a1d2e', border: '1px solid #555d73', color: '#fff' }
const useScenario = createReviewState(() => ({ games: 1000, cev: 50, seed: 42 }))

export default function BankrollCharts({ account }: { account: BankrollSnapshot }) {
  const [scenario, setScenario] = useScenario()
  const [games, setGames] = useState(String(scenario.games))
  const [cev, setCev] = useState(String(scenario.cev))
  const [error, setError] = useState<string | null>(null)
  const history = useMemo(() => {
    try { return { points: bankrollHistory(account), error: null } }
    catch (cause) { return { points: [], error: String(cause) } }
  }, [account])
  const balance = account.current_balance_cents / 100

  function submit(event: FormEvent) {
    event.preventDefault()
    const next = { games: Number(games), cev: Number(cev), seed: scenario.seed + 1 }
    if (!isBankrollVolume(next.games)
      || !Number.isFinite(next.cev) || next.cev < -500 || next.cev > 1000) {
      setError(`Saisissez 1 à ${MAX_BANKROLL_GAMES.toLocaleString('fr-FR')} tournois et un cEV entre -500 et 1 000.`)
      return
    }
    setError(null)
    setScenario(next)
  }

  return <>
    <section className="summary-card" aria-labelledby="bankroll-history-title">
      <h3 id="bankroll-history-title">Évolution de la bankroll</h3>
      <p className="variance-description">
        Depuis l’initialisation, tous buy-ins confondus : résultats non inclus dans le solde initial et mouvements manuels.
        Historique reconstruit par date de début de tournoi (pas par date d’import).
        Les imports antérieurs à l’initialisation sont placés juste après le solde initial.
        Les corrections sont représentées par leur variation enregistrée, pas comme un nouveau solde historique.
      </p>
      {history.error ? <p role="alert">Historique indisponible : {history.error}</p> : <>
        <div className="bankroll-chart" role="img" aria-label={`Historique de bankroll : de ${euro(account.opening_balance_cents / 100)} à ${euro(account.current_balance_cents / 100)}`}>
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 0, height: 340 }}>
            <ComposedChart data={history.points} margin={{ top: 12, right: 20, bottom: 12, left: 20 }}>
              <CartesianGrid stroke="rgba(255,255,255,.1)" />
              <XAxis dataKey="index" tick={{ fill: '#a9b0c8' }} minTickGap={40}
                tickFormatter={(index: number) => new Date(history.points[index].timestamp).toLocaleDateString('fr-FR')} />
              <YAxis width={90} tickFormatter={euro} tick={{ fill: '#a9b0c8' }} domain={['auto', 'auto']} />
              <Tooltip contentStyle={tooltipStyle} formatter={(value) => euro(Number(value))}
                labelFormatter={(index) => {
                  const point = history.points[Number(index)]
                  return `${new Date(point.timestamp).toLocaleString('fr-FR')} · ${point.label}`
                }} />
              <ReferenceLine y={0} stroke="#a9b0c8" strokeDasharray="4 4" />
              <Line dataKey="balance" name="Bankroll" stroke="#56b4e9" strokeWidth={2}
                dot={history.points.length === 1} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {history.points.length === 1 && <p>Aucun résultat ni mouvement depuis l’initialisation.</p>}
      </>}
    </section>
    <section className="summary-card" aria-labelledby="bankroll-projection-title">
      <h3 id="bankroll-projection-title">Simulation de bankroll à 2 €</h3>
      <form onSubmit={submit}>
        <fieldset className="bankroll-fields">
          <label>Tournois à simuler (max. {MAX_BANKROLL_GAMES.toLocaleString('fr-FR')})
            <input className="filter-input" type="number" min="1" max={MAX_BANKROLL_GAMES} step="1" required
              value={games} onChange={(e) => setGames(e.target.value)} />
          </label>
          <label>cEV simulé / tournoi
            <input className="filter-input" type="number" min="-500" max="1000" step="any" required
              value={cev} onChange={(e) => setCev(e.target.value)} />
          </label>
          <button type="submit" className="btn-primary">Simuler / nouveau tirage</button>
        </fieldset>
        {error && <p role="alert">{error}</p>}
      </form>
      <BankrollSimulation key={`${balance}:${scenario.seed}`} balance={balance} scenario={scenario} />
    </section>
  </>
}

function BankrollSimulation({ balance, scenario }: BankrollSimulationRequest) {
  const [result, setResult] = useState<BankrollSimulationResponse | null>(null)

  useEffect(() => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./bankrollSimulation.worker.ts', import.meta.url), { type: 'module' })
    } catch (cause) {
      setResult({ error: cause instanceof Error ? cause.message : String(cause) })
      return
    }
    worker.onmessage = ({ data }: MessageEvent<BankrollSimulationResponse>) => {
      setResult(data)
      worker.terminate()
    }
    worker.onerror = (event) => {
      setResult({ error: event.message || 'Impossible d’exécuter le calcul en arrière-plan.' })
      worker.terminate()
    }
    worker.postMessage({ balance, scenario } satisfies BankrollSimulationRequest)
    return () => worker.terminate()
  }, [balance, scenario])

  if (result == null) return <p role="status">Simulation en cours…</p>
  if ('error' in result) return <p role="alert">Simulation indisponible : {result.error}</p>
  const { simulation } = result
  const last = simulation.points[simulation.points.length - 1]

  return <>
    <p className="variance-description">
      Départ : solde actuel global. Scénario hypothétique : {scenario.games.toLocaleString('fr-FR')} tournois
      à 2 € (coût total), cEV {scenario.cev} ; espérance {euro(simulation.netPerGame)} / tournoi.
      Les gains et pertes récents ne sont pas extrapolés.
    </p>
    <div className="bankroll-chart" role="img" aria-label={`Simulation à ${scenario.games} tournois : espérance ${euro(last.expected)}, intervalle simulé de ${euro(last.interval[0])} à ${euro(last.interval[1])}`}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 0, height: 340 }}>
        <ComposedChart data={simulation.points} margin={{ top: 12, right: 20, bottom: 12, left: 20 }}>
          <CartesianGrid stroke="rgba(255,255,255,.1)" />
          <XAxis dataKey="games" type="number" domain={[0, scenario.games]} tick={{ fill: '#a9b0c8' }} />
          <YAxis width={90} tickFormatter={euro} tick={{ fill: '#a9b0c8' }} domain={['auto', 'auto']} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={(value) => `${value} tournois`}
            formatter={(value) => Array.isArray(value) ? value.map((v) => euro(Number(v))).join(' à ') : euro(Number(value))} />
          <Legend />
          <ReferenceLine y={0} stroke="#a9b0c8" strokeDasharray="4 4" />
          <Area type="linear" dataKey="interval" name="Simulation : percentiles 5–95 %" stroke="none"
            fill="#56b4e9" fillOpacity={0.18} isAnimationActive={false} />
          <Line dataKey="trajectory" name="Un parcours simulé" stroke="#cc79a7" dot={false} strokeWidth={1} isAnimationActive={false} />
          <Line dataKey="expected" name="Espérance du scénario cEV" stroke="#f0c64c" strokeWidth={2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
    <dl className="board-kpis">
      <div><dt>Espérance à {scenario.games.toLocaleString('fr-FR')} tournois</dt><dd>{euro(last.expected)}</dd></div>
      <div><dt>Simulation : percentiles 5–95 %</dt><dd className="bankroll-range">{euro(last.interval[0])} à {euro(last.interval[1])}</dd></div>
    </dl>
    <details>
      <summary>Hypothèses et limites du modèle</summary>
      <p className="variance-description">
        Modèle public Winamax Expresso 2 € déjà utilisé dans Summary, non actualisé automatiquement.
        Trois joueurs, 500 jetons de départ chacun, probabilité de victoire approximée par (500 + cEV) / 1 500
        ({(simulation.winProbability * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %).
        Le multiplicateur s’applique au buy-in de 2 €, sans multiplication supplémentaire par trois ni retrait du rake une seconde fois.
        Simplification : l’intégralité du prizepool va au vainqueur, même pour les gros multiplicateurs normalement répartis.
        Ce n’est donc pas une prévision exacte des gains de la room.
      </p>
      <p className="variance-description">
        500 parcours indépendants ; bande des percentiles 5 et 95 à chaque volume, pas un intervalle de confiance
        ni une garantie sur le parcours entier. Les jackpots rares peuvent être absents des simulations :
        l’espérance théorique peut sortir de la bande. Sans changement de limite, dépôt, retrait, ni arrêt faute de fonds ;
        une valeur négative indique un besoin de financement, pas une bankroll jouable. Le cEV ne prédit pas à lui seul les gains futurs.
      </p>
    </details>
  </>
}
