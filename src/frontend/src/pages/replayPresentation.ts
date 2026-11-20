import type { ReplayerStep } from '../api'
import { formatChipAmount, type MatchupUnit } from './matchupComparison'

export function nextReplayPosition(hand: number, step: number, lastStep: number, handCount: number) {
  if (step < lastStep) return { hand, step: step + 1 }
  if (hand + 1 < handCount) return { hand: hand + 1, step: 0 }
  return null
}

export function replayStreetLabel(street: string) {
  const labels: Record<string, string> = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown' }
  return labels[street.toLowerCase()] ?? street
}

export function replayVisibleBoardCount(steps: readonly ReplayerStep[], currentStep: number) {
  const counts: Readonly<Record<string, number>> = { preflop: 0, flop: 3, turn: 4, river: 5 }
  return steps.slice(0, currentStep + 1).reduce((count, step) => Math.max(count, counts[step.street.toLowerCase()] ?? 0), 0)
}

export function replayActionLabel(step: ReplayerStep, bigBlind: number, unit: MatchupUnit, showActor = true) {
  const actor = step.actor_name
  const amount = (value: number | null) => formatChipAmount(value, bigBlind, unit)
  const label = (action: string) => showActor && actor ? `${actor} ${action}` : action[0].toUpperCase() + action.slice(1)
  switch (step.action_type) {
    case 'fold': return label('se couche')
    case 'check': return label('check')
    case 'raise':
    case 'allin_raise': {
      const allin = step.action_type === 'allin_raise' ? ' (tapis)' : ''
      if (step.to_amount != null) return label(`relance à ${amount(step.to_amount)}${allin}`)
      if (step.increment_amount != null) return label(`relance de ${amount(step.increment_amount)}${allin}`)
      return label(`relance${allin} (montant indisponible)`)
    }
    case 'call': return label(`paie ${amount(step.amount)}`)
    case 'allin_call': return label(`paie à tapis ${amount(step.amount)}`)
    case 'bet': return label(`mise ${amount(step.amount)}`)
    case 'allin_bet': return label(`mise à tapis ${amount(step.amount)}`)
    case 'collect': return label(`remporte ${amount(step.amount)}`)
    case 'board_reveal': return `Board : ${replayStreetLabel(step.street)}`
    default: {
      const description = step.description
      if (showActor) return description || [actor, step.action_type || 'Action non renseignée'].filter(Boolean).join(' : ')
      const prefix = `${actor} `
      return (actor && description.startsWith(prefix) ? description.slice(prefix.length) : description)
        || step.action_type || 'Action non renseignée'
    }
  }
}
