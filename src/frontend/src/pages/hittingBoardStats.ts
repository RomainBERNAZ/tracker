import type { TournamentRow } from '../api'
import { applyTournamentRange, parseDateInput, periodToRange } from './tournamentFilters'
import type { TournamentFilter } from './tournamentFilters'

export const CATEGORIES = {
  two_pair_plus: 'Deux paires ou mieux',
  top_pair: 'Top pair',
  middle_pair: 'Middle pair',
  bottom_pair: 'Bottom pair',
  overpair: 'Overpair',
  underpair: 'Underpair',
  flush_draw: 'Tirage couleur direct',
  oesd: 'OESD',
  gutshot: 'Gutshot',
  combo_draw: 'Combo draw',
  two_overcards: 'Deux overcards sans paire',
  one_overcard: 'Une overcard sans paire',
  air: 'Air',
} as const

export const METRICS = {
  connected: 'Paire ou mieux, ou tirage direct',
  pair_plus: 'Paire ou mieux',
  top_pair_plus: 'Top pair ou mieux',
  direct_draw: 'Tirage direct',
  two_overs_or_draw: 'Deux overcards sans paire ou potentiel de tirage',
  no_pair_or_direct: 'Sans paire ni tirage direct',
  pair_and_direct: 'Paire ou mieux et tirage direct',
  flush_draw: 'Tirage couleur direct',
  oesd: 'OESD',
  gutshot: 'Gutshot (simple ou double)',
  combo_draw: 'Combo draw',
  backdoor_flush: 'Backdoor couleur',
  backdoor_straight: 'Backdoor quinte',
} as const

type Category = keyof typeof CATEGORIES
type Metric = keyof typeof METRICS
export type Counts = Record<Metric, number> & { flops: number, categories: Partial<Record<Category, number>> }
export type Position = 'BTN' | 'SB' | 'BB' | 'Middle' | 'Unknown'
export type Coverage = Record<'context_unknown' | 'flop_unknown' | 'hero_cards_unknown' | 'position_unknown', number>
export const CONTEXTS = [
  { raise: 'open', players: 2, label: 'Open raise · HU' },
  { raise: 'iso', players: 2, label: 'Iso-raise · HU' },
  { raise: 'open', players: 3, label: 'Open raise · 3-way' },
  { raise: 'iso', players: 3, label: 'Iso-raise · 3-way' },
] as const
type Context = Pick<typeof CONTEXTS[number], 'raise' | 'players'>
export type TournamentFlops = {
  tournament_id: string
  coverage: Coverage
  groups: (Context & { position: Position, counts: Counts })[]
}

export function selectPeriods(tournaments: readonly TournamentRow[], filter: TournamentFilter, now = Date.now()) {
  const { fromMs, toMs } = periodToRange(filter.period, filter.customFrom, filter.customTo, now)
  const invalid = filter.period === 'custom' && (
    (filter.customFrom !== '' && parseDateInput(filter.customFrom) == null)
    || (filter.customTo !== '' && parseDateInput(filter.customTo) == null)
    || (fromMs != null && toMs != null && fromMs > toMs)
  )
  const select = (from: number | null, to: number | null) =>
    new Set(applyTournamentRange(tournaments, from, to, filter.buyIns).map(({ id }) => id))
  return {
    invalid,
    current: invalid ? new Set<string>() : select(fromMs, toMs),
    reference: invalid || fromMs == null ? null : select(null, fromMs - 1),
  }
}

export function combineCounts(rows: readonly Counts[]): Counts {
  const metrics = Object.keys(METRICS) as Metric[]
  const categories = Object.keys(CATEGORIES) as Category[]
  const sum: Counts = {
    flops: 0, categories: {}, connected: 0, pair_plus: 0, top_pair_plus: 0, direct_draw: 0,
    two_overs_or_draw: 0, no_pair_or_direct: 0, pair_and_direct: 0, flush_draw: 0, oesd: 0,
    gutshot: 0, combo_draw: 0, backdoor_flush: 0, backdoor_straight: 0,
  }
  for (const counts of rows) {
    sum.flops += counts.flops
    for (const key of metrics) sum[key] += counts[key]
    for (const key of categories) sum.categories[key] = (sum.categories[key] ?? 0) + (counts.categories[key] ?? 0)
  }
  return sum
}

export function tournamentCounts(rows: readonly TournamentFlops[], context: Context, position?: Position): Counts[] {
  return rows.flatMap(({ groups }) => {
    const matches = groups.filter((group) => group.raise === context.raise && group.players === context.players
      && (position === undefined || group.position === position))
    return matches.length ? [combineCounts(matches.map(({ counts }) => counts))] : []
  })
}

type Cluster = Pick<Counts, 'flops' | 'connected'>
export function compareConnection(current: readonly Cluster[], reference: readonly Cluster[]) {
  function summarize(clusters: readonly Cluster[]) {
    const flops = clusters.reduce((total, row) => total + row.flops, 0)
    const hits = clusters.reduce((total, row) => total + row.connected, 0)
    const rate = flops ? hits / flops : null
    const n = clusters.length
    // Residuals are computed per tournament, so hands within it don't count as independent.
    const variance = n >= 30 && flops >= 50 && hits >= 5 && flops - hits >= 5 && rate != null
      ? clusters.reduce((ss, row) => ss + (row.connected - rate * row.flops) ** 2, 0) * n / (n - 1) / flops ** 2
      : null
    return { flops, hits, rate, tournaments: n, variance }
  }

  const a = summarize(current)
  const b = summarize(reference)
  const delta = a.rate == null || b.rate == null ? null : a.rate - b.rate
  const variance = a.variance == null || b.variance == null ? null : a.variance + b.variance
  if (delta == null || variance == null || variance <= 0) return { a, b, delta, adjustedP: null }

  // Two-sided normal tail approximation and Bonferroni correction across the four contexts.
  const z = Math.abs(delta) / Math.sqrt(variance)
  const t = 1 / (1 + 0.2316419 * z)
  const tail = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI)
    * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return { a, b, delta, adjustedP: Math.min(1, CONTEXTS.length * 2 * tail) }
}
