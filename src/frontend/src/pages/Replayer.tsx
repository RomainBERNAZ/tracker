import { Component, useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, type ReplayerPlayer, type ReplayerState, type ReplayerStep } from '../api'
import HandReviewPanel from '../components/HandReviewPanel'
import { HoleCards, PlayingCard } from '../components/PlayingCards'
import { createReviewState, useReviewBack } from '../reviewState'
import { formatChipAmount, type MatchupUnit } from './matchupComparison'
import { nextReplayPosition, replayActionLabel, replayStreetLabel, replayVisibleBoardCount } from './replayPresentation'

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

type ReplayLoad = { state: ReplayerState } | { error: string }

async function loadReplay(handId: string): Promise<ReplayLoad> {
  try {
    const data = await api.getHandForReplay(handId)
    return data ? { state: normalizeReplayState(data) } : { error: 'Main introuvable' }
  } catch (error) {
    console.error(error)
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function ReplayTimeline({ steps, currentStep, unit, bigBlind, disabled, onSelect }: {
  readonly steps: readonly ReplayerStep[]
  readonly currentStep: number
  readonly unit: MatchupUnit
  readonly bigBlind: number
  readonly disabled: boolean
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
        aria-current={index === currentStep ? 'step' : undefined} disabled={disabled}
        onClick={() => onSelect(index)} title={step.description}>
        <span className="replayer-action-number">{index + 1}</span>
        <span>{replayActionLabel(step, bigBlind, unit)}</span>
      </button>
    </div>)}
  </div>
}

function ReplayerContent({ handIds, tournamentId }: { handIds: readonly string[]; tournamentId?: string }) {
  const [position, setPosition] = useState({ hand: 0, step: 0 })
  const [requestedHand, setRequestedHand] = useState<number | null>(0)
  const [result, setResult] = useState<ReplayLoad | null>(null)
  const prefetched = useRef<{ id: string; load: Promise<ReplayLoad> } | null>(null)
  const [isAutoPlay, setIsAutoPlay] = useState(false)
  const [panel, setPanel] = useState<'actions' | 'notes' | null>(null)
  const [notesHandId, setNotesHandId] = useState<string | null>(null)
  const [playSpeedMs, setPlaySpeedMs] = useReplaySpeed()
  const [unit, setUnit] = useReplayUnit()
  const { hand: handIndex, step: currentStep } = position
  const handId = handIds[handIndex]
  const state = result && 'state' in result ? result.state : null
  const goBack = useReviewBack(tournamentId ? '/tournaments' :
    state ? `/tournaments/${encodeURIComponent(state.tournament_id)}/hands` : '/summary')

  useEffect(() => {
    if (requestedHand == null) return
    let cancelled = false
    const id = handIds[requestedHand]
    const cached = prefetched.current
    const load = cached?.id === id ? cached.load : loadReplay(id)
    void load.then((nextResult) => {
      if (cancelled) return
      if (cached?.id === id && prefetched.current === cached) prefetched.current = null
      if ('error' in nextResult) setIsAutoPlay(false)
      setResult(nextResult)
      setPosition({ hand: requestedHand, step: 0 })
      setRequestedHand(null)
    })
    return () => { cancelled = true }
  }, [handIds, requestedHand])

  const nextHandId = handIds[handIndex + 1]
  useEffect(() => {
    if (result && nextHandId && prefetched.current?.id !== nextHandId) {
      prefetched.current = { id: nextHandId, load: loadReplay(nextHandId) }
    }
  }, [result, nextHandId])

  const lastStep = Math.max(0, (state?.total_steps ?? 0) - 1)
  const canPlay = state != null && requestedHand == null && (lastStep > 0 || handIndex + 1 < handIds.length)
  const canAdvance = nextReplayPosition(handIndex, currentStep, lastStep, handIds.length) != null

  const togglePlayback = useCallback(() => {
    if (!canPlay && !isAutoPlay) return
    if (!isAutoPlay && !canAdvance) setPosition({ hand: handIndex, step: 0 })
    if (panel === 'notes') setPanel(null)
    setIsAutoPlay(!isAutoPlay)
  }, [canPlay, isAutoPlay, canAdvance, handIndex, panel])

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const target = event.target
      if (!state || (target instanceof HTMLElement &&
        (target.closest('input, select, textarea, button, a') || target.isContentEditable))) return
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', ' '].includes(event.key)) return
      event.preventDefault()
      if (event.key === ' ') togglePlayback()
      else {
        setIsAutoPlay(false)
        setPosition((previous) => ({
          ...previous,
          step: requestedHand != null ? previous.step : event.key === 'Home' ? 0 : event.key === 'End' ? lastStep :
            Math.max(0, Math.min(lastStep, previous.step + (event.key === 'ArrowLeft' ? -1 : 1))),
        }))
      }
    }
    globalThis.addEventListener('keydown', handle)
    return () => globalThis.removeEventListener('keydown', handle)
  }, [state, lastStep, requestedHand, togglePlayback])

  useEffect(() => {
    if (!isAutoPlay || !state || requestedHand != null) return
    const timer = globalThis.setTimeout(() => {
      const next = nextReplayPosition(handIndex, currentStep, lastStep, handIds.length)
      if (!next) setIsAutoPlay(false)
      else if (next.hand !== handIndex) setRequestedHand(next.hand)
      else setPosition(next)
    }, playSpeedMs)
    return () => globalThis.clearTimeout(timer)
  }, [isAutoPlay, playSpeedMs, state, currentStep, lastStep, handIndex, handIds.length, requestedHand])

  function goToStep(index: number) {
    setIsAutoPlay(false)
    if (requestedHand == null) setPosition({ hand: handIndex, step: Math.max(0, Math.min(lastStep, index)) })
  }

  function goToHand(index: number) {
    setIsAutoPlay(false)
    if (panel === 'notes') setPanel(null)
    setRequestedHand(index)
  }

  const header = <>
    <button className="back-link" onClick={goBack}>← Retour</button>
    <header className="page-header replayer-header">
      <div>
        <h1>{tournamentId ? 'Replay du tournoi' : 'Replay de la main'}</h1>
        {state && <p>Blindes {state.small_blind}/{state.big_blind} · Niveau {state.level}</p>}
      </div>
      {tournamentId && <div className="replayer-controls-row" aria-label="Mains du tournoi" role="group">
        <button type="button" className="period-pill" disabled={handIndex === 0 || requestedHand != null}
          onClick={() => goToHand(handIndex - 1)}>‹ Main précédente</button>
        <strong role="status">Main {handIndex + 1} / {handIds.length}</strong>
        <button type="button" className="period-pill" disabled={handIndex + 1 >= handIds.length || requestedHand != null}
          onClick={() => goToHand(handIndex + 1)}>Main suivante ›</button>
      </div>}
    </header>
  </>

  if (!state) return <div className="replayer-page">{header}
    {result && 'error' in result
      ? <p role="alert" className="negative">Replay indisponible : {result.error}</p>
      : <p role="status">Chargement de la main…</p>}
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
  const canUseBb = Number.isFinite(state.big_blind) && state.big_blind > 0
  const displayUnit = canUseBb ? unit : 'chips'
  const actor = step && players.find((player) => player.name === step.actor_name)
  const actionLabel = step ? replayActionLabel(step, state.big_blind, displayUnit, !actor) : 'Aucune action disponible'

  return <div className="replayer-page">
    {header}
    <div className={`replayer-review-layout${panel ? ' replayer-with-panel' : ''}`}>
        <section className="summary-card replayer-table-card" aria-label="Table du replay">
          <div className="summary-card-header">
            <strong>{replayStreetLabel(street)}</strong>
            <div className="replayer-controls-row">
              <select className="filter-select" aria-label="Unité des montants" value={displayUnit}
                onChange={(event) => setUnit(event.target.value === 'bb' ? 'bb' : 'chips')}>
                <option value="chips">Jetons</option><option value="bb" disabled={!canUseBb}>BB</option>
              </select>
              <button type="button" className="filter-reset" aria-expanded={panel === 'actions'}
                onClick={() => setPanel(panel === 'actions' ? null : 'actions')}>Actions</button>
              <button type="button" className="filter-reset" aria-expanded={panel === 'notes'} disabled={requestedHand != null} onClick={() => {
                setIsAutoPlay(false)
                setNotesHandId(handId)
                setPanel(panel === 'notes' ? null : 'notes')
              }}>Notes</button>
            </div>
          </div>
          <div className="replayer-felt-table" data-player-count={players.length}>
            <div className="replayer-felt-inner" />
            <div className="replayer-table-center">
              <div className="replayer-board-row" aria-label={`Board ${replayStreetLabel(street)}`}>
                {[0, 1, 2, 3, 4].map((index) => <PlayingCard key={index} card={index < boardCount ? state.board[index] : null} />)}
              </div>
              <div className="replayer-pot-center">
                <span title="Total final enregistré dans l’historique, pas le pot à cette action">Pot final</span>
                <strong>{formatChipAmount(pot, state.big_blind, displayUnit)}</strong>
              </div>
              <div className="replayer-action-slot">
                {!actor && <span className="replayer-seat-action-badge">{actionLabel}</span>}
              </div>
            </div>
            {positionedPlayers.map(({ player, slot }) => {
              const isActor = player === actor
              return <div key={player.seat_number}
                className={`replayer-player-card replayer-seat-pos-${slot}${player.folded ? ' replayer-player-card-folded' : ''}${isActor ? ' replayer-player-card-actor' : ''}`}>
                <div className="replayer-player-topline">
                  <strong>{player.name}</strong>
                  <div className="replayer-player-badges">
                    {player.hero && <span className="replayer-seat-pill">HERO</span>}
                    {player.seat_number === state.button_pos && <span className="replayer-dealer" title="Bouton dealer">D</span>}
                    {player.folded ? <span className="replayer-seat-pill">Couché</span> :
                      player.current_stack === 0 && <span className="replayer-seat-pill">TAPIS</span>}
                  </div>
                </div>
                <div className="replayer-player-body">
                  <HoleCards cards={player.hole_cards} />
                  <strong className="replayer-stack-amount">{formatChipAmount(player.current_stack, state.big_blind, displayUnit)}</strong>
                </div>
                <div className="replayer-action-slot">
                  {isActor && <span className="replayer-seat-action-badge">{actionLabel}</span>}
                </div>
              </div>
            })}
          </div>
          <div className="replayer-navigation" role="group" aria-label="Navigation du replay">
            <span className="stack-method">Action {state.total_steps ? currentStep + 1 : 0}/{state.total_steps}</span>
            <input className="replayer-slider" type="range" min={0} max={lastStep} value={currentStep}
              disabled={state.total_steps === 0 || requestedHand != null} aria-label="Action du replay"
              onChange={(event) => goToStep(Number(event.target.value))} />
            <div className="replayer-controls-row">
              <button type="button" className="period-pill" disabled={currentStep === 0 || requestedHand != null} onClick={() => goToStep(0)}>« Début</button>
              <button type="button" className="period-pill" disabled={currentStep === 0 || requestedHand != null} onClick={() => goToStep(currentStep - 1)}>‹ Précédent</button>
              <button type="button" className="period-pill period-pill-active" disabled={!canPlay && !isAutoPlay}
                onClick={togglePlayback}>{isAutoPlay ? 'Pause' : 'Lecture'}</button>
              <button type="button" className="period-pill" disabled={currentStep >= lastStep || requestedHand != null} onClick={() => goToStep(currentStep + 1)}>Suivant ›</button>
              <button type="button" className="period-pill" disabled={currentStep >= lastStep || requestedHand != null} onClick={() => goToStep(lastStep)}>Fin »</button>
              <select className="filter-select" value={playSpeedMs} onChange={(event) => setPlaySpeedMs(Number(event.target.value))} aria-label="Vitesse de lecture">
                <option value={1400}>×0,75</option><option value={1000}>×1</option><option value={700}>×1,5</option><option value={450}>×2,2</option>
              </select>
            </div>
          </div>
        </section>
      <aside className="summary-card replayer-history" aria-label="Détails du replay" hidden={panel == null}>
        {panel === 'actions' && <>
          <h3>Historique des actions</h3>
          <ReplayTimeline steps={state.steps} currentStep={currentStep} unit={displayUnit}
            bigBlind={state.big_blind} disabled={requestedHand != null} onSelect={goToStep} />
        </>}
        {notesHandId === handId && <div hidden={panel !== 'notes'}><HandReviewPanel key={handId} handId={handId} embedded /></div>}
      </aside>
    </div>
  </div>
}

export default function Replayer() {
  const { handId, id } = useParams<{ handId: string; id: string }>()
  return <ReplayerErrorBoundary key={id ? `tournament:${id}` : `hand:${handId}`}>
    {id ? <TournamentReplay tournamentId={id} /> :
      handId ? <ReplayerContent handIds={[handId]} /> : <p role="alert">Identifiant de main manquant.</p>}
  </ReplayerErrorBoundary>
}

function TournamentReplay({ tournamentId }: { tournamentId: string }) {
  const goBack = useReviewBack('/tournaments')
  const [result, setResult] = useState<{ hands: string[] } | { error: string } | null>(null)
  useEffect(() => {
    let cancelled = false
    api.getHandsForTournament(tournamentId)
      .then((hands) => { if (!cancelled) setResult({ hands: hands.map((hand) => hand.id) }) })
      .catch((cause: unknown) => {
        console.error(cause)
        if (!cancelled) setResult({ error: cause instanceof Error ? cause.message : String(cause) })
      })
    return () => { cancelled = true }
  }, [tournamentId])
  if (result && 'hands' in result && result.hands.length > 0) {
    return <ReplayerContent handIds={result.hands} tournamentId={tournamentId} />
  }
  return <div>
    <button className="back-link" onClick={goBack}>← Retour</button>
    {result == null ? <p role="status">Chargement des mains du tournoi…</p> :
      'error' in result ? <p role="alert">Replay du tournoi indisponible : {result.error}</p> :
        <p>Aucune main importée pour ce tournoi.</p>}
  </div>
}
