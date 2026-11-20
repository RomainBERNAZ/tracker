import { describe, expect, it } from 'vitest'
import type { BankrollSettings, HandChipPoint, TournamentRow } from '../api'
import { analyzeRecentBankroll, assessBankroll, parseEuroCents } from './bankrollAnalysis'

const settings: BankrollSettings = {
  warning_buy_ins: 150, shot_buy_ins: 300, strong_shot_buy_ins: 250,
  min_cev: 50, min_sample: 1000, target_buy_in_cents: 500,
}

function sample(count = 1000, cev = 60, net = 1, buyIn = 2) {
  const tournaments: TournamentRow[] = Array.from({ length: count }, (_, index) => ({
    id: `T${index}`, player_name: 'Hero', buy_in_euros: buyIn - 0.1, rake_euros: 0.1,
    prizepool_euros: 4, multiplier: 2, finish_position: 1, started_at: new Date(2026, 0, index + 1).toISOString(),
    duration_secs: 60, net_eur: net, hand_count: 1, hero_cev_sum: -500,
    all_in_correction_eur: null, adjusted_all_in_count: 0, calculated_all_in_count: 0,
    wsd_cev_sum: 0, sd_cev_sum: 0,
  }))
  const hands: HandChipPoint[] = tournaments.map((t) => ({
    tournament_id: t.id, timestamp: '2035-01-01T12:00:00Z', hero_cards: 'As Kd',
    big_blind: 20, player_count: 2, hero_starting_stack: 500, hero_stack_bucket: 0, realized_cev: -500, net_ev: cev, has_showdown: true,
  }))
  return { tournaments, hands, recent: analyzeRecentBankroll(tournaments, hands) }
}

describe('bankroll recommendation cohorts', () => {
  it('uses the last 1000 tournaments and EV-adjusted cEV, regardless of hand dates', () => {
    const data = sample(1001)
    data.hands[0].net_ev = -9999
    const recent = analyzeRecentBankroll(data.tournaments, data.hands)
    expect(recent.count).toBe(1000)
    expect(recent.sample.cev).toBe(60)
    expect(recent.averageBuyIn).toBe(2)
    expect(recent.netEuro).toBe(1000)
  })

  it('does not use lower-limit results or missing hands to qualify a higher-limit shot', () => {
    const low = sample(1000, 100)
    const higher = sample(1, -100, -5, 5)
    higher.tournaments[0] = { ...higher.tournaments[0], id: 'high', started_at: '2040-01-01T00:00:00Z' }
    higher.hands[0] = { ...higher.hands[0], tournament_id: 'high' }
    const recent = analyzeRecentBankroll([...low.tournaments, ...higher.tournaments], [...low.hands, ...higher.hands])
    expect(recent.sample.count).toBe(1000)
    expect(recent.currentLimitSample.count).toBe(1)
    expect(assessBankroll(500_000, recent, settings).status).toBe('observe')
    const missing = analyzeRecentBankroll(low.tournaments, low.hands.slice(1))
    expect(missing.sample.missing).toBe(1)
    expect(assessBankroll(500_000, missing, settings).status).toBe('observe')
    const allTournaments = [...low.tournaments, ...higher.tournaments]
    expect(analyzeRecentBankroll(allTournaments, low.hands, [2]).referenceBuyIn).toBe(2)
    expect(analyzeRecentBankroll(allTournaments, low.hands, [2, 5]).referenceBuyIn).toBe(5)
    expect(analyzeRecentBankroll(allTournaments, low.hands, [5, 10]).count).toBe(1)
  })
})

describe('bankroll guidance thresholds', () => {
  it('alerts strictly below 150 buy-ins and does not mistake a small sample for an edge', () => {
    const { recent } = sample()
    expect(assessBankroll(29_999, recent, settings).status).toBe('down')
    expect(assessBankroll(30_000, recent, settings).status).toBe('ok')
    expect(assessBankroll(46_000, recent, settings).coverage).toBe(230)
    const mixed = { ...recent, averageBuyIn: 4 }
    expect(assessBankroll(46_000, mixed, settings).coverage).toBe(115)
    expect(assessBankroll(46_000, mixed, settings).status).toBe('down')
    expect(assessBankroll(46_000, recent, { ...settings, target_buy_in_cents: null }).title).toContain('consolider')
    expect(assessBankroll(500_000, sample(999, 100).recent, settings).status).toBe('observe')
    expect(assessBankroll(46_000, sample(1000, -1).recent, settings).status).toBe('review')
  })

  it('requires 300 target buy-ins, or 250 with stronger cEV, and nonnegative euro results', () => {
    expect(assessBankroll(149_999, sample().recent, settings).status).toBe('ok')
    expect(assessBankroll(150_000, sample().recent, settings).status).toBe('shot')
    expect(assessBankroll(125_000, sample(1000, 75).recent, settings).status).toBe('shot')
    expect(assessBankroll(124_999, sample(1000, 75).recent, settings).status).toBe('ok')
    expect(assessBankroll(150_000, sample(1000, 75, -1).recent, settings).status).toBe('ok')
    expect(assessBankroll(150_000, sample(1000, 49).recent, settings).status).toBe('ok')
    expect(assessBankroll(150_000, sample().recent, { ...settings, target_buy_in_cents: null }).status).toBe('ok')
  })
})

describe('exact monetary inputs', () => {
  it('parses French and decimal inputs in cents without accepting negative or fractional cents', () => {
    expect(parseEuroCents('460,29')).toBe(46029)
    expect(parseEuroCents('0.01')).toBe(1)
    expect(parseEuroCents('0')).toBe(0)
    for (const value of ['', '-1', '1.001', '1e3', 'NaN', 'Infinity', '9007199254740992']) {
      expect(() => parseEuroCents(value)).toThrow()
    }
  })
})
