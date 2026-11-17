import type { HandChipPoint } from '../api'

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
