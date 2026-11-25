import type { TournamentRow } from '../api'
import { WINAMAX_2EUR_MULTIPLIER_MODEL } from './expressoModel'
import { tournamentBuyIn } from './tournamentFilters'

// https://www.betclic.fr/poker/scp-spin-and-rush, tickets per million.
const BETCLIC_STANDARD = [
  { mult: 1000, tickets: 5 }, { mult: 100, tickets: 100 }, { mult: 20, tickets: 500 },
  { mult: 10, tickets: 5000 }, { mult: 5, tickets: 40000 }, { mult: 4, tickets: 130000 },
  { mult: 3, tickets: 346210 }, { mult: 2, tickets: 478185 },
]
const BETCLIC_200 = [
  { mult: 5000, tickets: 1 }, { mult: 500, tickets: 20 }, { mult: 50, tickets: 200 },
  { mult: 10, tickets: 5000 }, { mult: 5, tickets: 40000 }, { mult: 4, tickets: 130000 },
  { mult: 3, tickets: 345442 }, { mult: 2, tickets: 479337 },
]

function modelForTournament(tournament: TournamentRow) {
  const buyIn = tournamentBuyIn(tournament)
  if (tournament.room === 'betclic') {
    if (buyIn === 200) return BETCLIC_200
    if (buyIn >= 0.2 && buyIn <= 100) return BETCLIC_STANDARD
  }
  if (tournament.room === 'winamax' && buyIn === 2) return WINAMAX_2EUR_MULTIPLIER_MODEL
  return null
}

export function multiplierComparison(tournaments: readonly TournamentRow[]) {
  const observed = new Map<number, number>()
  const expected = new Map<number, number>()
  let unmodeled = 0
  for (const tournament of tournaments) {
    observed.set(tournament.multiplier, (observed.get(tournament.multiplier) ?? 0) + 1)
    const model = modelForTournament(tournament)
    if (!model) {
      unmodeled += 1
      continue
    }
    const total = model.reduce((sum, item) => sum + item.tickets, 0)
    for (const item of model) expected.set(item.mult, (expected.get(item.mult) ?? 0) + item.tickets / total)
  }
  const keys = new Set([...observed.keys(), ...expected.keys()])
  return {
    unmodeled,
    rows: [...keys].sort((a, b) => a - b).map((mult) => ({
      mult,
      realCount: observed.get(mult) ?? 0,
      expectedCount: unmodeled > 0 ? null : expected.get(mult) ?? 0,
    })).filter((row) => row.realCount > 0 || (row.expectedCount ?? 0) >= 1),
  }
}
