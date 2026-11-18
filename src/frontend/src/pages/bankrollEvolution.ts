import type { BankrollSnapshot } from '../api'
import { WINAMAX_2EUR_MULTIPLIER_MODEL } from './expressoModel'

export function bankrollHistory(account: BankrollSnapshot) {
  const start = Date.parse(account.created_at)
  if (!Number.isFinite(start)) throw new Error('Date d’initialisation de bankroll invalide.')
  const events = [
    ...account.tournament_results.map((t) => ({
      timestamp: Date.parse(t.started_at), amount: t.amount_cents, label: `Tournoi ${t.id}`,
    })),
    ...account.movements.slice().reverse().map((m) => ({
      timestamp: Date.parse(m.created_at), amount: m.amount_cents,
      label: m.kind === 'deposit' ? 'Dépôt' : m.kind === 'withdrawal' ? 'Retrait' : 'Correction',
    })),
  ]
  if (events.some((e) => !Number.isFinite(e.timestamp) || !Number.isSafeInteger(e.amount))) {
    throw new Error('Date ou montant invalide dans l’historique de bankroll.')
  }
  // Late imports predating initialization belong to the balance, but not before its opening point.
  events.forEach((e) => { e.timestamp = Math.max(start, e.timestamp) })
  events.sort((a, b) => a.timestamp - b.timestamp)
  let cents = account.opening_balance_cents
  const points = [{ index: 0, timestamp: start, balance: cents / 100, label: 'Solde initial' }]
  events.forEach((e, i) => {
    cents += e.amount
    if (!Number.isSafeInteger(cents)) throw new Error('Montant historique trop élevé pour un calcul exact.')
    points.push({ index: i + 1, timestamp: e.timestamp, balance: cents / 100, label: e.label })
  })
  if (cents !== account.current_balance_cents) throw new Error('L’historique ne correspond pas au solde courant.')
  return points
}

const tickets = WINAMAX_2EUR_MULTIPLIER_MODEL.reduce((sum, m) => sum + m.tickets, 0)
const meanMultiplier = WINAMAX_2EUR_MULTIPLIER_MODEL.reduce((sum, m) => sum + m.mult * m.tickets / tickets, 0)

export function expressoExpectation(cev: number) {
  if (!Number.isFinite(cev) || cev < -500 || cev > 1000) {
    throw new Error('Le cEV doit être compris entre -500 et 1 000 jetons par tournoi.')
  }
  const winProbability = (500 + cev) / 1500
  return { winProbability, netPerGame: 2 * (winProbability * meanMultiplier - 1) }
}

export interface BankrollScenario {
  games: number
  cev: number
}

export function simulateBankroll(
  balance: number, scenario: BankrollScenario, recentNetPerGame: number | null,
  seed: number,
) {
  if (!Number.isFinite(balance) || !Number.isInteger(scenario.games) || scenario.games < 1 || scenario.games > 10000
    || (recentNetPerGame != null && !Number.isFinite(recentNetPerGame))) {
    throw new Error('Le volume doit être un entier de 1 à 10 000 tournois et les montants doivent être valides.')
  }
  const { winProbability, netPerGame } = expressoExpectation(scenario.cev)
  let state = seed >>> 0
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), state | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
  const paths = Array.from({ length: 500 }, () => balance)
  const step = Math.max(1, Math.ceil(scenario.games / 100))
  const points = [{
    games: 0, expected: balance, recent: recentNetPerGame == null ? null : balance,
    interval: [balance, balance], trajectory: balance,
  }]
  for (let game = 1; game <= scenario.games; game++) {
    for (let path = 0; path < paths.length; path++) {
      const draw = random() * tickets
      let cumulative = 0
      let multiplier = 2
      for (const bucket of WINAMAX_2EUR_MULTIPLIER_MODEL) {
        cumulative += bucket.tickets
        if (draw < cumulative) { multiplier = bucket.mult; break }
      }
      paths[path] += random() < winProbability ? 2 * multiplier - 2 : -2
    }
    if (game % step === 0 || game === scenario.games) {
      const sorted = [...paths].sort((a, b) => a - b)
      points.push({
        games: game, expected: balance + game * netPerGame,
        recent: recentNetPerGame == null ? null : balance + game * recentNetPerGame,
        interval: [sorted[Math.floor(0.05 * (sorted.length - 1))], sorted[Math.ceil(0.95 * (sorted.length - 1))]],
        trajectory: paths[0],
      })
    }
  }
  return { points, netPerGame, winProbability }
}
