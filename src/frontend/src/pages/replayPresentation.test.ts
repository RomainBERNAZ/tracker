import { describe, expect, it } from 'vitest'
import type { ReplayerStep } from '../api'
import { replayActionLabel, replayVisibleBoardCount } from './replayPresentation'

const step: ReplayerStep = {
  step_number: 1, actor_name: 'Hero', street: 'preflop', action_type: 'allin_raise',
  amount: 40, increment_amount: 60, to_amount: 100, pot_size_after: 300, players_after: [],
  description: 'Hero all-in raise 60 to 100',
}

describe('replay action presentation', () => {
  it('reveals only reached streets, retains the board at showdown, and hides it again when rewinding', () => {
    const steps = ['preflop', 'flop', 'turn', 'river', 'showdown'].map((street) => ({ ...step, street }))
    expect(steps.map((_, index) => replayVisibleBoardCount(steps, index))).toEqual([0, 3, 4, 5, 5])
    expect(replayVisibleBoardCount(steps, 0)).toBe(0)
    expect(replayVisibleBoardCount([], 0)).toBe(0)
  })

  it('distinguishes raise-to from the increment and never labels it as chips added', () => {
    expect(replayActionLabel(step, 20, 'bb')).toBe('Hero relance a 5 BB (tapis)')
    expect(replayActionLabel(step, 20, 'chips')).toBe('Hero relance a 100 jetons (tapis)')
    expect(replayActionLabel({ ...step, to_amount: null }, 20, 'bb')).toBe('Hero relance de 3 BB (tapis)')
  })

  it('retains explicit missing amounts and handles checks, collections and unknown action types', () => {
    expect(replayActionLabel({ ...step, action_type: 'call', amount: null }, 20, 'chips')).toBe('Hero paie -')
    expect(replayActionLabel({ ...step, action_type: 'check' }, 20, 'bb')).toBe('Hero check')
    expect(replayActionLabel({ ...step, action_type: 'collect', amount: 300 }, 20, 'bb')).toBe('Hero remporte 15 BB')
    expect(replayActionLabel({ ...step, action_type: 'other', description: 'Original' }, 20, 'bb')).toBe('Original')
  })
})
