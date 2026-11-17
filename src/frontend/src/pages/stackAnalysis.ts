import type { StackChipTotals, StackStatsGroup } from '../api'

export const STACK_BUCKETS = ['0-8 BB', '>8-12 BB', '>12-20 BB', '>20 BB'] as const
export type StackFormat = 'all' | '2' | '3'

function emptyChips(): StackChipTotals {
  return { net: 0, ev: 0, sd: 0, sd_ev: 0, wsd: 0, wsd_ev: 0 }
}

function emptyRow(bucket: number) {
  return {
    bucket, hands: 0, preflopHands: 0, missingEvHands: 0, missingPreflopHands: 0,
    vpip: 0, pfr: 0, limp: 0, threeBet: 0, threeBetOpportunities: 0,
    foldToThreeBet: 0, foldToThreeBetOpportunities: 0,
    chips: emptyChips(), bb: emptyChips(),
  }
}

export type StackAnalysisRow = ReturnType<typeof emptyRow>

function addChips(target: StackChipTotals, source: StackChipTotals) {
  target.net += source.net
  target.ev += source.ev
  target.sd += source.sd
  target.sd_ev += source.sd_ev
  target.wsd += source.wsd
  target.wsd_ev += source.wsd_ev
}

function addRow(target: StackAnalysisRow, source: StackAnalysisRow) {
  target.hands += source.hands
  target.preflopHands += source.preflopHands
  target.missingEvHands += source.missingEvHands
  target.missingPreflopHands += source.missingPreflopHands
  target.vpip += source.vpip
  target.pfr += source.pfr
  target.limp += source.limp
  target.threeBet += source.threeBet
  target.threeBetOpportunities += source.threeBetOpportunities
  target.foldToThreeBet += source.foldToThreeBet
  target.foldToThreeBetOpportunities += source.foldToThreeBetOpportunities
  addChips(target.chips, source.chips)
  addChips(target.bb, source.bb)
}

export function analyzeStacks(groups: readonly StackStatsGroup[], format: StackFormat, buckets: readonly number[]) {
  const rows = STACK_BUCKETS.map((_, bucket) => emptyRow(bucket))
  for (const group of groups) {
    if (format !== 'all' && group.player_count !== Number(format)) continue
    const stats = group.preflop
    addRow(rows[group.bucket], {
      bucket: group.bucket, hands: group.hands, preflopHands: stats.hands,
      missingEvHands: group.missing_ev_hands, missingPreflopHands: group.missing_preflop_hands,
      vpip: stats.vpip_count, pfr: stats.pfr_count, limp: stats.limp_count,
      threeBet: stats.three_bet_count, threeBetOpportunities: stats.three_bet_opportunities,
      foldToThreeBet: stats.fold_to_three_bet_count, foldToThreeBetOpportunities: stats.fold_to_three_bet_opportunities,
      chips: group.chips, bb: group.bb,
    })
  }
  const selected = rows.filter((row) => buckets.length === 0 || buckets.includes(row.bucket))
  const total = emptyRow(-1)
  selected.forEach((row) => addRow(total, row))
  return { rows: selected, total }
}

export function stackRates(row: StackAnalysisRow, tournamentCount: number, unit: 'chips' | 'bb') {
  return {
    cevPerTournament: tournamentCount > 0 && row.hands > 0 ? row.chips.ev / tournamentCount : null,
    netPer100: row.hands > 0 ? row[unit].net * 100 / row.hands : null,
    evPer100: row.hands > 0 ? row[unit].ev * 100 / row.hands : null,
  }
}
