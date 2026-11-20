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

export function replayActionLabel(step: ReplayerStep, bigBlind: number, unit: MatchupUnit) {
  const actor = step.actor_name
  const amount = (value: number | null) => formatChipAmount(value, bigBlind, unit)
  switch (step.action_type) {
    case 'fold': return `${actor} se couche`
    case 'check': return `${actor} check`
    case 'raise':
    case 'allin_raise': {
      const allin = step.action_type === 'allin_raise' ? ' (tapis)' : ''
      if (step.to_amount != null) return `${actor} relance a ${amount(step.to_amount)}${allin}`
      if (step.increment_amount != null) return `${actor} relance de ${amount(step.increment_amount)}${allin}`
      return `${actor} relance${allin} (montant indisponible)`
    }
    case 'call': return `${actor} paie ${amount(step.amount)}`
    case 'allin_call': return `${actor} paie a tapis ${amount(step.amount)}`
    case 'bet': return `${actor} mise ${amount(step.amount)}`
    case 'allin_bet': return `${actor} mise a tapis ${amount(step.amount)}`
    case 'collect': return `${actor} remporte ${amount(step.amount)}`
    case 'board_reveal': return `Board : ${replayStreetLabel(step.street)}`
    default: return step.description || `${actor} : ${step.action_type || 'Action non renseignee'}`
  }
}
