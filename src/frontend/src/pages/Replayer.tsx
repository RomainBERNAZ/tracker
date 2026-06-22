import { Component, memo, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ReplayerPlayer, ReplayerState, ReplayerStep } from '../api'

class ReplayerErrorBoundary extends Component<
  { readonly children: React.ReactNode },
  { readonly hasError: boolean; readonly message: string | null }
> {
  constructor(props: { readonly children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, message: null }
  }

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Erreur inconnue dans le replay',
    }
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="import-result">
          <h3 className="negative">Replay en erreur</h3>
          <p style={{ color: 'var(--text-dim)' }}>{this.state.message ?? 'Erreur inconnue dans le replay'}</p>
          <p style={{ color: 'var(--text-dim)', marginTop: 8 }}>
            Le rendu du replay a plante, mais l'application reste utilisable.
          </p>
        </div>
      )
    }

    return this.props.children
  }
}

function normalizeReplayPlayers(players: ReplayerPlayer[] | undefined) {
  if (!Array.isArray(players)) {
    return []
  }

  return players.map((player) => ({
    seat_number: Number(player.seat_number ?? 0),
    name: player.name ?? 'Inconnu',
    starting_stack: Number(player.starting_stack ?? 0),
    current_stack: Number(player.current_stack ?? 0),
    hole_cards: player.hole_cards ?? null,
    folded: Boolean(player.folded),
  }))
}

function normalizeReplaySteps(steps: ReplayerStep[] | undefined) {
  if (!Array.isArray(steps)) {
    return []
  }

  return steps.map((step, index) => ({
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
  }))
}

function normalizeReplayState(data: ReplayerState): ReplayerState {
  return {
    ...data,
    button_pos: Number(data.button_pos ?? 0),
    board: Array.isArray(data.board) ? data.board : [],
    players: normalizeReplayPlayers(data.players),
    steps: normalizeReplaySteps(data.steps),
    total_steps: Array.isArray(data.steps) ? data.steps.length : 0,
  }
}

function suitSymbolOf(suitChar: string): string {
  if (suitChar === 'h') return '♥'
  if (suitChar === 'd') return '♦'
  if (suitChar === 'c') return '♣'
  return '♠'
}

function suitColor(card: string): string {
  const suit = card.slice(-1).toLowerCase()
  if (suit === 'h' || suit === 'd') {
    return '#ef4444'
  }

  return '#e8ecff'
}

const CardChip = memo(({ card }: { readonly card: string }) => {
  const rank = card.slice(0, -1)
  const suitChar = card.slice(-1).toLowerCase()
  const suitSymbol = suitSymbolOf(suitChar)

  return (
    <span className="replayer-card-chip" style={{ color: suitColor(card) }}>
      {rank}{suitSymbol}
    </span>
  )
})

function renderHoleCards(holeCards: string | null) {
  if (!holeCards) {
    return <span style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontSize: 12 }}>Cartes masquees</span>
  }

  const cards = holeCards.trim().split(/\s+/).filter(Boolean)
  return (
    <div className="replayer-hole-cards-row">
      {cards.map((card, i) => (
        <CardChip key={`${card}-${i}`} card={card} />
      ))}
    </div>
  )
}

function renderBoardCard(card: string | undefined) {
  if (!card) {
    return <span style={{ color: 'var(--text-dim)' }}>-</span>
  }

  const rank = card.slice(0, -1)
  const suitChar = card.slice(-1).toLowerCase()
  const suitSymbol = suitSymbolOf(suitChar)

  return (
    <span style={{ color: suitColor(card) }}>
      {rank}{suitSymbol}
    </span>
  )
}

function streetLabel(street: string) {
  switch (street.toLowerCase()) {
    case 'preflop':
      return 'Preflop'
    case 'flop':
      return 'Flop'
    case 'turn':
      return 'Turn'
    case 'river':
      return 'River'
    default:
      return street || 'Depart'
  }
}

function fmtTimestamp(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function buildActionSummary(step: ReplayerStep | null) {
  if (!step) {
    return 'Debut de la main'
  }

  return step.description
}

function boardCardsForStreet(board: string[], street: string | undefined) {
  const normalizedStreet = (street ?? '').toLowerCase()
  if (normalizedStreet === 'flop') {
    return board.slice(0, 3)
  }
  if (normalizedStreet === 'turn') {
    return board.slice(0, 4)
  }
  if (normalizedStreet === 'river') {
    return board.slice(0, 5)
  }
  return []
}

const ReplayBoard = memo(({ board, street }: { readonly board: string[]; readonly street: string | undefined }) => {
  const visibleCards = boardCardsForStreet(board, street)

  return (
    <div className="summary-card">
      <div className="summary-card-header">
        <h3>Board</h3>
        <span className="replayer-street-pill">{streetLabel(street ?? 'preflop')}</span>
      </div>
      <div className="replayer-board-row">
        {[0, 1, 2, 3, 4].map((slot) => {
          const card = visibleCards[slot]
          return (
            <div key={slot} className={`replayer-card-slot ${card ? 'replayer-card-slot-filled' : ''}`}>
              {renderBoardCard(card)}
            </div>
          )
        })}
      </div>
      {board.length === 0 && (
        <p style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 10 }}>
          Le board n'est pas encore fourni par le backend de replay.
        </p>
      )}
    </div>
  )
})

const ReplayPlayerCard = memo(({
  player,
  isActor,
  isButton,
}: {
  readonly player: ReplayerPlayer
  readonly isActor: boolean
  readonly isButton: boolean
}) => {
  return (
    <div className={`replayer-player-card ${player.folded ? 'replayer-player-card-folded' : ''} ${isActor ? 'replayer-player-card-actor' : ''}`}>
      <div className="replayer-player-topline">
        <strong>{player.name}</strong>
        <div className="replayer-player-badges">
          {isButton && <span className="replayer-seat-pill">BTN</span>}
          <span className="replayer-seat-pill">Seat {player.seat_number}</span>
        </div>
      </div>
      <div className="replayer-player-meta">
        <span>Stack depart: {player.starting_stack}</span>
        <span>Stack affiche: {player.current_stack}</span>
      </div>
      <div className="replayer-player-cards">{renderHoleCards(player.hole_cards)}</div>
    </div>
  )
})

const ReplayTimeline = memo(({
  steps,
  currentStep,
  onSelect,
}: {
  readonly steps: ReplayerStep[]
  readonly currentStep: number
  readonly onSelect: (index: number) => void
}) => {
  if (steps.length === 0) {
    return <p style={{ color: 'var(--text-dim)' }}>Aucune action disponible</p>
  }

  return (
    <div className="replayer-timeline-list">
      {steps.map((step, index) => {
        const isActive = index === currentStep
        return (
          <button
            key={`${step.step_number}-${step.actor_name}-${index}`}
            type="button"
            className={`replayer-timeline-item ${isActive ? 'replayer-timeline-item-active' : ''}`}
            onClick={() => onSelect(index)}
          >
            <div className="replayer-timeline-topline">
              <span>#{index + 1}</span>
              <span>{streetLabel(step.street)}</span>
            </div>
            <div className="replayer-timeline-description">{step.description}</div>
          </button>
        )
      })}
    </div>
  )
})

function ReplayerContent() {
  const { handId } = useParams<{ handId: string }>()
  const navigate = useNavigate()
  const [state, setState] = useState<ReplayerState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState(0)

  useEffect(() => {
    const load = async () => {
      if (!handId) {
        setError('ID de main manquant')
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        const data = await api.getHandForReplay(handId)
        if (!data) {
          setError('Main introuvable')
          return
        }
        setState(normalizeReplayState(data))
        setCurrentStep(0)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [handId])

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (!state) {
        return
      }

      switch (event.key) {
        case 'ArrowLeft':
          setCurrentStep((prev) => Math.max(0, prev - 1))
          break
        case 'ArrowRight':
          setCurrentStep((prev) => Math.min(state.total_steps - 1, prev + 1))
          break
        case 'Home':
          setCurrentStep(0)
          break
        case 'End':
          setCurrentStep(state.total_steps - 1)
          break
      }
    }

    globalThis.addEventListener('keydown', handle)
    return () => globalThis.removeEventListener('keydown', handle)
  }, [state])

  const step = useMemo(
    () => (state && currentStep < state.steps.length ? state.steps[currentStep] : null),
    [currentStep, state],
  )

  const progressPct = useMemo(() => {
    if (!state || state.total_steps <= 1) {
      return 0
    }

    return Math.round((currentStep / (state.total_steps - 1)) * 100)
  }, [currentStep, state])

  const displayedPlayers = Array.isArray(step?.players_after) && step.players_after.length > 0
    ? step.players_after
    : (state?.players ?? [])
  const currentActorName = step?.actor_name ?? null
  const currentPot = step?.pot_size_after ?? 0
  const currentActionSummary = useMemo(() => buildActionSummary(step), [step])

  function goToStep(nextStep: number) {
    if (!state) {
      return
    }

    setCurrentStep(Math.max(0, Math.min(state.total_steps - 1, nextStep)))
  }

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Chargement...</p>

  if (error || !state) {
    return (
      <div>
        <button className="back-link" onClick={() => navigate(-1)}>
          ← Retour
        </button>
        <div className="import-result">
          <h3 className="negative">Replay indisponible</h3>
          <p style={{ color: 'var(--text-dim)' }}>{error ?? 'Main introuvable'}</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <button className="back-link" onClick={() => navigate(-1)}>
        ← Retour
      </button>

      <div className="page-header">
        <h1>Replay main {state.hand_id}</h1>
        <p>
          Tournoi {state.tournament_id} · Niveau {state.level} · {state.small_blind}/{state.big_blind} · {fmtTimestamp(state.timestamp)}
        </p>
      </div>

      <div className="stats-bar">
        <div className="stat-card">
          <div className="label">Table</div>
          <div className="value neutral" style={{ fontSize: 18 }}>{state.table_name}</div>
        </div>
        <div className="stat-card">
          <div className="label">Step</div>
          <div className="value neutral">{state.total_steps === 0 ? 0 : currentStep + 1}/{state.total_steps}</div>
        </div>
        <div className="stat-card">
          <div className="label">Pot courant</div>
          <div className="value neutral">{currentPot}</div>
        </div>
        <div className="stat-card">
          <div className="label">Joueur actif</div>
          <div className="value neutral" style={{ fontSize: 18 }}>{currentActorName ?? '-'}</div>
        </div>
        <div className="stat-card">
          <div className="label">Progression</div>
          <div className="value neutral">{progressPct}%</div>
        </div>
      </div>

      <ReplayBoard board={state.board} street={step?.street} />

      <div className="summary-card" style={{ marginTop: 16 }}>
        <div className="summary-card-header">
          <h3>Navigation</h3>
          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>Clavier: ← → Home End</span>
        </div>
        <div className="replayer-controls-row">
          <button className="period-pill" disabled={currentStep === 0} onClick={() => goToStep(0)}>« Debut</button>
          <button className="period-pill" disabled={currentStep === 0} onClick={() => goToStep(currentStep - 1)}>‹ Precedent</button>
          <input
            className="replayer-slider"
            type="range"
            min={0}
            max={Math.max(0, state.total_steps - 1)}
            value={currentStep}
            onChange={(event) => goToStep(Number(event.target.value))}
          />
          <button className="period-pill" disabled={currentStep >= state.total_steps - 1} onClick={() => goToStep(currentStep + 1)}>Suivant ›</button>
          <button className="period-pill" disabled={currentStep >= state.total_steps - 1} onClick={() => goToStep(state.total_steps - 1)}>Fin »</button>
        </div>
      </div>

      <div className="summary-grid" style={{ marginTop: 16 }}>
        <div className="summary-card">
          <h3>Joueurs</h3>
          <div className="replayer-players-grid">
            {displayedPlayers.map((player) => (
              <ReplayPlayerCard
                key={`${player.seat_number}-${player.name}`}
                player={player}
                isActor={player.name === currentActorName}
                isButton={player.seat_number === state.button_pos}
              />
            ))}
          </div>
        </div>

        <div className="summary-card">
          <h3>Action courante</h3>
          <div className="replayer-current-action-card">
            <div className="replayer-current-action-topline">
              <span>{step ? streetLabel(step.street) : 'Depart'}</span>
              <span>{currentActorName ?? '-'}</span>
            </div>
            <div className="replayer-current-action-description">{currentActionSummary}</div>
            {step && (
              <div className="replayer-current-action-meta">
                <span>Type: {step.action_type}</span>
                <span>Montant: {step.amount ?? step.to_amount ?? step.increment_amount ?? '-'}</span>
                <span>Pot apres action: {step.pot_size_after}</span>
              </div>
            )}
          </div>
          <div style={{ marginTop: 16 }}>
            <h3 style={{ marginBottom: 10 }}>Timeline</h3>
            <ReplayTimeline steps={state.steps} currentStep={currentStep} onSelect={goToStep} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Replayer() {
  return (
    <ReplayerErrorBoundary>
      <ReplayerContent />
    </ReplayerErrorBoundary>
  )
}
