import type { HandChipPoint } from '../api'
import type { StackFormat } from './stackAnalysis'

export type HeroPosition = HandChipPoint['hero_position']

export function positionsForFormat(format: StackFormat): readonly HeroPosition[] {
  return format === '2' ? ['BTN', 'BB'] : ['BTN', 'SB', 'BB']
}

export function restrictPositionsToFormat(
  positions: readonly HeroPosition[],
  format: StackFormat,
): HeroPosition[] {
  const available = positionsForFormat(format)
  return positions.filter((position) => available.includes(position))
}

export function filterChipHands(
  hands: readonly HandChipPoint[],
  format: StackFormat,
  buckets: readonly number[],
  positions: readonly HeroPosition[] = [],
) {
  if (format === 'all' && buckets.length === 0 && positions.length === 0) return hands
  return hands.filter(({ player_count, hero_stack_bucket, hero_position }) =>
    (format === 'all' || player_count === Number(format)) &&
    (buckets.length === 0 || (hero_stack_bucket != null && buckets.includes(hero_stack_bucket))) &&
    (positions.length === 0 || positions.includes(hero_position)),
  )
}

export function summarizeChips(hands: readonly HandChipPoint[], tournamentCount: number) {
  let netChips = 0
  let netEvChips = 0
  let wsdNetChips = 0
  let sdNetChips = 0

  hands.forEach((hand) => {
    netChips += hand.realized_cev
    netEvChips += hand.net_ev ?? hand.realized_cev
    if (hand.has_showdown) {
      sdNetChips += hand.realized_cev
    } else {
      wsdNetChips += hand.realized_cev
    }
  })

  return {
    netChips,
    netEvChips,
    avgCevPerGame: tournamentCount > 0 ? netEvChips / tournamentCount : 0,
    wsdNetChips,
    sdNetChips,
  }
}
