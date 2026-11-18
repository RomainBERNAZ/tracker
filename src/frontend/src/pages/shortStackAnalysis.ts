import type { HolePair, ShortStackEncounter, ShortStackMatchup, ShortStackTournament } from '../api'

export const CATEGORIES = ['Premium', 'Autres paires', 'Ax', 'Kx', 'Qx', 'Connecteurs', 'Autres'] as const
export const BREAKDOWN = ['Ax assortis', 'Ax dépareillés', 'Kx assortis', 'Kx dépareillés',
  'Paires JJ+', 'Paires 66–TT', 'Paires 22–55'] as const

type Category = typeof CATEGORIES[number]
type Breakdown = typeof BREAKDOWN[number]

export function classify(cards: HolePair | null) {
  if (!cards) return null
  const [a, b] = cards
  if (a === b || ![a, b].every((card) => /^[2-9TJQKA][cdhs]$/.test(card))) return null
  const ranks = '23456789TJQKA'
  const [high, low] = [ranks.indexOf(a[0]), ranks.indexOf(b[0])].sort((x, y) => y - x)
  const pair = high === low
  const suited = a[1] === b[1]
  let category: Category
  let breakdown: Breakdown | null = null
  if (pair) {
    category = high >= 9 ? 'Premium' : 'Autres paires'
    breakdown = high >= 9 ? 'Paires JJ+' : high >= 4 ? 'Paires 66–TT' : 'Paires 22–55'
  } else if (high === 12 && low === 11) category = 'Premium'
  else if (high === 12) {
    category = 'Ax'
    breakdown = suited ? 'Ax assortis' : 'Ax dépareillés'
  } else if (high === 11) {
    category = 'Kx'
    breakdown = suited ? 'Kx assortis' : 'Kx dépareillés'
  } else if (high === 10) category = 'Qx'
  else category = high - low === 1 ? 'Connecteurs' : 'Autres'
  return { category, breakdown, pair, strong: category !== 'Connecteurs' && category !== 'Autres' }
}

export function eqMatchup(row: ShortStackEncounter): { key: string, duel: ShortStackMatchup } | null {
  if (!row.hero_cards || !row.villain_cards) return null
  const cards = [...row.hero_cards, ...row.villain_cards]
  if (new Set(cards).size !== 4 || !cards.every((card) => /^[2-9TJQKA][cdhs]$/.test(card))) return null
  const sort = ([a, b]: HolePair): HolePair => a <= b ? [a, b] : [b, a]
  const duel = [sort(row.hero_cards), sort(row.villain_cards)] as const
  return { key: duel.flat().join(''), duel }
}

export function summarize(rows: readonly ShortStackEncounter[], equities: ReadonlyMap<string, number | null> = new Map()) {
  const categories = Object.fromEntries(CATEGORIES.map((label) => [label, 0])) as Record<Category, number>
  const breakdown = Object.fromEntries(BREAKDOWN.map((label) => [label, 0])) as Record<Breakdown, number>
  let revealed = 0, pairs = 0, strong = 0, equityCount = 0, equitySum = 0, equityEligible = 0
  for (const row of rows) {
    const hand = classify(row.villain_cards)
    if (!hand) continue
    revealed++
    categories[hand.category]++
    if (hand.breakdown) breakdown[hand.breakdown]++
    if (hand.strong) strong++
    if (hand.pair) pairs++
    const matchup = eqMatchup(row)
    if (!matchup) continue
    equityEligible++
    const equity = equities.get(matchup.key)
    if (equity != null) {
      equitySum += equity
      equityCount++
    }
  }
  const heroEquity = equityCount ? equitySum / equityCount : null
  return { total: rows.length, revealed, hidden: rows.length - revealed, categories, breakdown, pairs, strong,
    weak: revealed - strong, heroEquity, villainEquity: heroEquity == null ? null : 1 - heroEquity,
    equityGap: heroEquity == null ? null : 1 - 2 * heroEquity, equityCount, equityEligible }
}

export type Sample = ReturnType<typeof summarize>

export function wilson(count: number, total: number) {
  if (!total) return null
  const p = count / total
  const z = 1.959963984540054
  const denominator = 1 + z * z / total
  const center = (p + z * z / (2 * total)) / denominator
  const margin = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator
  return [Math.max(0, center - margin), Math.min(1, center + margin)] as const
}

// Regularized upper gamma for the half-integer degrees of freedom of a 2×K table.
function chiSquareTail(statistic: number, df: number) {
  const x = statistic / 2
  if (x === 0) return 1
  const t = 1 / (1 + 0.3275911 * Math.sqrt(x))
  const exp = Math.exp(-x)
  let result = df % 2 ? exp * t * (0.254829592 + t * (-0.284496736 +
    t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) : exp
  let term = df % 2 ? 2 * Math.sqrt(x / Math.PI) * exp : x * exp
  for (let d = df % 2 ? 1 : 2; d < df; d += 2) {
    result += term
    term *= x / (d / 2 + 1)
  }
  return Math.min(1, result)
}

export function compareDistributions(left: readonly number[], right: readonly number[]) {
  const a = left.reduce((sum, n) => sum + n, 0), b = right.reduce((sum, n) => sum + n, 0)
  const columns = left.map((l, i) => ({ l, n: l + right[i] })).filter(({ n }) => n > 0)
  if (!a || !b || columns.length < 2) return null
  if (columns.every(({ n }) => n * Math.min(a, b) / (a + b) >= 5)) {
    const statistic = columns.reduce((sum, { l, n }) => {
      const expected = n * a / (a + b)
      return sum + (l - expected) ** 2 * (1 / expected + 1 / (n - expected))
    }, 0)
    return { label: 'Chi² de Pearson', p: chiSquareTail(statistic, columns.length - 1) }
  }

  const factorial = [0]
  for (let i = 1; i <= a + b; i++) factorial.push(factorial[i - 1] + Math.log(i))
  const choose = (n: number, k: number) => factorial[n] - factorial[k] - factorial[n - k]
  const observed = columns.reduce((sum, { l, n }) => sum + choose(n, l), 0)
  const denominator = choose(a + b, a)
  const suffix = [a + b]
  for (const { n } of columns) suffix.push(suffix[suffix.length - 1] - n)
  let p = 0, visited = 0
  const limit = 100_000
  function visit(index: number, remaining: number, logWeight: number) {
    if (++visited > limit) return
    const { n } = columns[index]
    if (index === columns.length - 1) {
      const weight = logWeight + choose(n, remaining)
      if (weight <= observed + 1e-8) p += Math.exp(weight - denominator)
      return
    }
    for (let count = Math.max(0, remaining - suffix[index + 1]); count <= Math.min(n, remaining); count++) {
      visit(index + 1, remaining - count, logWeight + choose(n, count))
      if (visited > limit) break
    }
  }
  visit(0, a, 0)
  const label = columns.length === 2 ? 'Fisher exact (bilatéral)' : 'Fisher–Freeman–Halton exact (bilatéral)'
  return { label, p: visited > limit ? null : Math.min(1, p) }
}

export interface EncounterFilters {
  format: string
  stack: string
  shortPlayer: string
  position: string
  rank: string
  action: string
  actionSide: 'villain' | 'hero'
  revealed: string
}

export function applyEncounterFilters(rows: readonly ShortStackEncounter[], filters: EncounterFilters) {
  const ranges = [0, 2, 3, 4, 5]
  const bucket = Number(filters.stack)
  return rows.filter((row) =>
    (!filters.format || row.player_count === Number(filters.format))
    && (!filters.stack || (row.effective_bb > ranges[bucket] && row.effective_bb <= ranges[bucket + 1]))
    && (!filters.shortPlayer || (row.villain_bb <= 5) === (filters.shortPlayer === 'villain'))
    && (!filters.position || row.position === filters.position)
    && (filters.rank === 'first' ? row.rank === 1 : filters.rank === 'later' ? (row.rank ?? 0) > 1
      : filters.rank === 'unknown' ? row.rank == null && row.villain_bb <= 5 : true)
    && (!filters.action || (filters.actionSide === 'hero' ? row.hero_actions : row.villain_actions)
      .some((action) => action === filters.action || (filters.action === 'call' && action === 'allin_call')))
    && (!filters.revealed || (classify(row.villain_cards) != null) === (filters.revealed === 'yes')),
  )
}

export function volumeTrend(tournaments: readonly ShortStackTournament[], rows: readonly ShortStackEncounter[], size: number) {
  const batches = new Map<string, number>()
  const trend: { label: string, games: number, total: number, revealed: number, strong: number, percent: number | null }[] = []
  tournaments.forEach((tournament, index) => {
    const group = Math.floor(index / size)
    batches.set(tournament.id, group)
    const batch = trend[group] ??= { label: `${index + 1}–${Math.min(index + size, tournaments.length)}`,
      games: 0, total: 0, revealed: 0, strong: 0, percent: null }
    batch.games++
  })
  for (const row of rows) {
    const index = batches.get(row.tournament_id)
    if (index == null) continue
    const batch = trend[index]
    batch.total++
    const hand = classify(row.villain_cards)
    if (!hand) continue
    batch.revealed++
    if (hand.strong) batch.strong++
    batch.percent = 100 * batch.strong / batch.revealed
  }
  return trend
}
