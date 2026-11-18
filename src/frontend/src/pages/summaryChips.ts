import type { HandChipPoint } from '../api'
import type { StackFormat } from './stackAnalysis'

export function filterChipHands(hands: readonly HandChipPoint[], format: StackFormat, buckets: readonly number[]) {
  if (format === 'all' && buckets.length === 0) return hands
  return hands.filter(({ player_count, hero_stack_bucket }) =>
    (format === 'all' || player_count === Number(format)) &&
    (buckets.length === 0 || (hero_stack_bucket != null && buckets.includes(hero_stack_bucket))),
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
