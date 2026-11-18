import { Component, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, type ReplayerPlayer, type ReplayerState, type ReplayerStep } from '../api'
import { ChipAmount, ChipPile } from '../components/ChipAmount'
import { HoleCards, PlayingCard } from '../components/PlayingCards'
import { createReviewState, useReviewBack } from '../reviewState'
import type { MatchupUnit } from './matchupComparison'
import { replayActionLabel, replayStreetLabel, replayVisibleBoardCount } from './replayPresentation'

const useReplayUnit = createReviewState<MatchupUnit>(() => 'chips')
const useReplaySpeed = createReviewState(() => 1000)

class ReplayerErrorBoundary extends Component<
  { readonly children: React.ReactNode },
  { readonly hasError: boolean; readonly message: string | null }
> {
  constructor(props: { readonly children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, message: null }
  }

  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, message: error instanceof Error ? error.message : 'Erreur inconnue dans le replay' }
  }

  override render() {
    if (this.state.hasError) return <div className="import-result" role="alert">
      <h3 className="negative">Replay en erreur</h3>
      <p>{this.state.message}</p><p>Le replay n'a pas pu etre affiche. Le menu reste accessible.</p>
    </div>
    return this.props.children
  }
}

function normalizeReplayPlayers(players: ReplayerPlayer[] | undefined) {
  if (!Array.isArray(players)) return []
  return players.map((player) => ({
    seat_number: Number(player.seat_number ?? 0),
    name: player.name ?? 'Inconnu',
    hero: Boolean(player.hero),
    starting_stack: Number(player.starting_stack ?? 0),
    current_stack: Number(player.current_stack ?? 0),
    hole_cards: player.hole_cards ?? null,
    folded: Boolean(player.folded),
  }))
}

function normalizeReplayState(data: ReplayerState): ReplayerState {
  const steps = Array.isArray(data.steps) ? data.steps : []
  return {
    ...data,
    button_pos: Number(data.button_pos ?? 0),
    board: Array.isArray(data.board) ? data.board : [],
    players: normalizeReplayPlayers(data.players),
    steps: steps.map((step, index) => ({
      step_number: Number(step.step_number ?? index),
      street: step.street ?? 'preflop',
      actor_name: step.actor_name ?? '',
      action_type: step.action_type ?? '',
      amount: step.amount ?? null,
      increment_amount: step.increment_amount ?? null,
      to_amount: step.to_amount ?? null,
      pot_size_after: Number(step.pot_size_after ?? 0),
      players_after: normalizeReplayPlayers(step.players_after),
      description: step.description ?? '',
    })),
    total_steps: steps.length,
  }
}

function ReplayTimeline({ steps, currentStep, unit, bigBlind, onSelect }: {
  readonly steps: readonly ReplayerStep[]
  readonly currentStep: number
  readonly unit: MatchupUnit
  readonly bigBlind: number
  readonly onSelect: (index: number) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const list = listRef.current
    const active = list?.querySelector<HTMLButtonElement>('[aria-current="step"]')
    if (list && active) list.scrollTop = active.offsetTop - list.clientHeight / 2 + active.clientHeight / 2
  }, [currentStep])
  if (steps.length === 0) return <p>Aucune action disponible.</p>
  return <div className="replayer-timeline-list" ref={listRef}>
    {steps.map((step, index) => <div key={`${step.step_number}-${index}`}>
      {(index === 0 || step.street !== steps[index - 1].street) &&
        <h4 className="replayer-timeline-street">{replayStreetLabel(step.street)}</h4>}
      <button type="button" className={`replayer-timeline-item${index === currentStep ? ' replayer-timeline-item-active' : ''}`}
        aria-current={index === currentStep ? 'step' : undefined} onClick={() => onSelect(index)} title={step.description}>
        <span className="replayer-action-number">{index + 1}</span>
        <span>{replayActionLabel(step, bigBlind, unit)}</span>
      </button>
    </div>)}
  </div>
}

function ReplayerContent() {
  const { handId } = useParams<{ handId: string }>()
  const [state, setState] = useState<ReplayerState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState(0)
  const [isAutoPlay, setIsAutoPlay] = useState(false)
  const [playSpeedMs, setPlaySpeedMs] = useReplaySpeed()
  const [unit, setUnit] = useReplayUnit()
  const goBack = useReviewBack(state ? `/tournaments/${encodeURIComponent(state.tournament_id)}/hands` : '/summary')

  useEffect(() => {
    let cancelled = false
    setError(null)
    setState(null)
    setLoading(true)
    setIsAutoPlay(false)
    if (!handId) {
      setError('ID de main manquant')
      setLoading(false)
      return
    }
    api.getHandForReplay(handId)
      .then((data) => {
        if (cancelled) return
        if (!data) setError('Main introuvable')
        else {
          setState(normalizeReplayState(data))
          setCurrentStep(0)
        }
      })
      .catch((err: unknown) => {
        console.error(err)
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [handId])

  const lastStep = Math.max(0, (state?.total_steps ?? 0) - 1)
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const target = event.target
      if (!state || state.total_steps === 0 || (target instanceof HTMLElement &&
        (target.closest('input, select, textarea, button, a') || target.isContentEditable))) return
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', ' '].includes(event.key)) return
      event.preventDefault()
      if (event.key === ' ') setIsAutoPlay((previous) => !previous)
      else {
        setIsAutoPlay(false)
        if (event.key === 'ArrowLeft') setCurrentStep((previous) => Math.max(0, previous - 1))
        if (event.key === 'ArrowRight') setCurrentStep((previous) => Math.min(lastStep, previous + 1))
        if (event.key === 'Home') setCurrentStep(0)
        if (event.key === 'End') setCurrentStep(lastStep)
      }
    }
    globalThis.addEventListener('keydown', handle)
    return () => globalThis.removeEventListener('keydown', handle)
  }, [state, lastStep])

  useEffect(() => {
    if (!isAutoPlay || !state || state.total_steps <= 1) return
    const timer = globalThis.setInterval(() => {
      if (currentStep >= lastStep) setIsAutoPlay(false)
      else setCurrentStep((previous) => Math.min(lastStep, previous + 1))
    }, playSpeedMs)
    return () => globalThis.clearInterval(timer)
  }, [isAutoPlay, playSpeedMs, state, currentStep, lastStep])

  function goToStep(index: number) {
    setIsAutoPlay(false)
    setCurrentStep(Math.max(0, Math.min(lastStep, index)))
  }

  if (loading) return <p role="status">Chargement du replay...</p>
  if (error || !state) return <div>
    <button className="back-link" onClick={goBack}>← Retour</button>
    <div className="import-result" role="alert"><h3 className="negative">Replay indisponible</h3><p>{error ?? 'Main introuvable'}</p></div>
  </div>

  const step = state.steps[currentStep] ?? null
  const street = step?.street ?? 'preflop'
  const boardCount = replayVisibleBoardCount(state.steps, currentStep)
  const players = step?.players_after.length ? step.players_after : state.players
  const sorted = [...players].sort((a, b) => a.seat_number - b.seat_number)
  const hero = sorted.find((player) => player.hero)
  const opponents = sorted.filter((player) => player !== hero)
  const positionedPlayers = hero
    ? [{ player: hero, slot: 0 }, ...opponents.map((player, index) => ({ player, slot: index === 0 && opponents.length === 1 ? 2 : index + 1 }))]
    : sorted.map((player, slot) => ({ player, slot }))
  const pot = step?.pot_size_after ?? null

  return <div className="replayer-page">
    <button className="back-link" onClick={goBack}>← Retour</button>
    <header className="page-header replayer-header">
      <div><h1>Replay</h1><p className="replayer-hand-id">{state.hand_id}</p>
        <p>Tournoi {state.tournament_id} · {state.table_name} · Niveau {state.level} · Blindes {state.small_blind}/{state.big_blind}</p>
        <p>{new Date(state.timestamp).toLocaleString('fr-FR')}</p>
      </div>
      <fieldset className="filter-group" aria-label="Unite du replay">
        <legend>Montants</legend>
        <div className="period-pill-bar">{(['chips', 'bb'] as const).map((key) =>
          <button type="button" key={key} className={`period-pill${unit === key ? ' period-pill-active' : ''}`}
            aria-pressed={unit === key} onClick={() => setUnit(key)}>{key === 'chips' ? 'Jetons' : 'BB'}</button>)}</div>
      </fieldset>
    </header>
    {unit === 'bb' && (!Number.isFinite(state.big_blind) || state.big_blind <= 0) &&
      <p className="variance-warning" role="status">Grosse blinde absente ou invalide : montants en BB indisponibles. Les valeurs en jetons restent affichees en dessous.</p>}

    <div className="replayer-review-layout">
      <div className="replayer-main">
        <section className="summary-card replayer-table-card" aria-label="Table du replay">
          <div className="summary-card-header">
            <div className="replayer-streets" aria-label="Street courante">
              {['preflop', 'flop', 'turn', 'river', 'showdown'].map((value) =>
                <span key={value} className={`replayer-street-pill${street.toLowerCase() === value ? ' replayer-street-active' : ''}`}>
                  {replayStreetLabel(value)}
                </span>)}
            </div>
            <span className="stack-method">Action {state.total_steps ? currentStep + 1 : 0}/{state.total_steps}</span>
          </div>
          <div className="replayer-felt-table" data-player-count={players.length}>
            <div className="replayer-felt-inner" />
            <div className="replayer-table-center">
              <div className="replayer-board-row" aria-label={`Board ${replayStreetLabel(street)}`}>
                {[0, 1, 2, 3, 4].map((index) => <PlayingCard key={index} card={index < boardCount ? state.board[index] : null} />)}
              </div>
              <div className="replayer-pot-center">
                <ChipPile amount={pot ?? 0} /><span>Pot final importe</span>
                <ChipAmount value={pot} bigBlind={state.big_blind} unit={unit} />
              </div>
            </div>
            {positionedPlayers.map(({ player, slot }) => {
              const action = state.steps.slice(0, currentStep + 1).reverse()
                .find((item) => item.actor_name === player.name && item.street === street)
              const isActor = player.name === step?.actor_name
              return <div key={player.seat_number}
                className={`replayer-player-card replayer-seat-pos-${slot}${player.folded ? ' replayer-player-card-folded' : ''}${isActor ? ' replayer-player-card-actor' : ''}`}>
                <div className="replayer-player-topline">
                  <strong>{player.name}</strong>
                  <div className="replayer-player-badges">
                    {player.hero && <span className="replayer-seat-pill">HERO</span>}
                    {player.seat_number === state.button_pos && <span className="replayer-dealer" title="Bouton dealer">D</span>}
                    {player.folded ? <span className="replayer-seat-pill">Couche</span> :
                      player.current_stack === 0 && <span className="replayer-seat-pill">TAPIS</span>}
                  </div>
                </div>
                <div className="replayer-player-body">
                  <HoleCards cards={player.hole_cards} />
                  <div className="replayer-stack-amount"><ChipPile amount={player.current_stack} />
                    <ChipAmount value={player.current_stack} bigBlind={state.big_blind} unit={unit} />
                  </div>
                </div>
                <p className="stack-method">Depart : <ChipAmount value={player.starting_stack} bigBlind={state.big_blind} unit={unit} /></p>
                {action && <div className="replayer-seat-action-badge">{replayActionLabel(action, state.big_blind, unit)}</div>}
              </div>
            })}
          </div>
          <p className="stack-method replayer-pot-note">
            Le pot affiche est le total final importe, pas un pot recalcule a chaque action. Les piles sont illustratives, les montants font foi.
            {state.board.length === 0 && ' Board absent de cet import : si la main va au showdown, un reimport peut etre necessaire.'}
          </p>
        </section>

        <section className="summary-card replayer-navigation" aria-label="Navigation du replay">
          <div className="replayer-current-action-topline">
            <span>{replayStreetLabel(street)}</span><span>{step?.actor_name || 'Aucun joueur actif'}</span>
          </div>
          <p className="replayer-current-action-description">{step ? replayActionLabel(step, state.big_blind, unit) : 'Aucune action disponible'}</p>
          <input className="replayer-slider" type="range" min={0} max={lastStep} value={currentStep}
            disabled={state.total_steps === 0} aria-label="Action du replay"
            onChange={(event) => goToStep(Number(event.target.value))} />
          <div className="replayer-controls-row">
            <button type="button" className="period-pill" disabled={currentStep === 0} onClick={() => goToStep(0)}>« Debut</button>
            <button type="button" className="period-pill" disabled={currentStep === 0} onClick={() => goToStep(currentStep - 1)}>‹ Precedent</button>
            <button type="button" className="period-pill period-pill-active" disabled={state.total_steps <= 1}
              onClick={() => setIsAutoPlay((previous) => !previous)}>{isAutoPlay ? 'Pause' : 'Lecture'}</button>
            <button type="button" className="period-pill" disabled={currentStep >= lastStep} onClick={() => goToStep(currentStep + 1)}>Suivant ›</button>
            <button type="button" className="period-pill" disabled={currentStep >= lastStep} onClick={() => goToStep(lastStep)}>Fin »</button>
            <select className="filter-select" value={playSpeedMs} onChange={(event) => setPlaySpeedMs(Number(event.target.value))} aria-label="Vitesse autoplay">
              <option value={1400}>x0.75</option><option value={1000}>x1</option><option value={700}>x1.5</option><option value={450}>x2.2</option>
            </select>
          </div>
          <p className="stack-method">Clavier : ← →, Home, End, Espace (hors controles).</p>
        </section>
      </div>
      <aside className="summary-card replayer-history" aria-label="Historique des actions">
        <h3>Historique des actions</h3>
        <p className="stack-method">Cliquez une action pour la revoir. L'action active est surlignee.</p>
        <ReplayTimeline steps={state.steps} currentStep={currentStep} unit={unit} bigBlind={state.big_blind} onSelect={goToStep} />
      </aside>
    </div>
  </div>
}

export default function Replayer() {
  const { handId } = useParams<{ handId: string }>()
  return <ReplayerErrorBoundary key={handId}><ReplayerContent /></ReplayerErrorBoundary>
}
