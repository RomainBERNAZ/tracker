# Realized cEV Specification

## Definition

**Realized cEV** is the factual outcome of a hand: the difference between a player's ending stack and starting stack.

$$cEV_{realized} = stack_{end} - stack_{start}$$

This is distinct from **decision cEV** (which would evaluate a decision at a specific point), and **GTO cEV** (optimal play).

**V0.1 focus: Realized cEV only.**

---

## Invariants (Non-Negotiable)

### 1. Sum Invariant
The sum of all players' realized cEV in a hand (excluding rake) must equal zero.

$$\sum_{i=1}^{n} cEV_i + rake = 0$$

**Tolerance**: ±0.01 chips (rounding)

**Why**: Poker is zero-sum at the table level. If this fails, either:
- Rake was not accounted correctly
- Chips were created/lost
- Ledger calculation is wrong

### 2. Chip Invariant
No chips are created or destroyed in any hand.

$$\sum_{i=1}^{n} (start\_stack_i) = \sum_{i=1}^{n} (end\_stack_i) + rake$$

**Why**: Integrity check. Chips must flow from player stacks → pot → winners.

### 3. Side Pot Integrity
All side pots are correctly formed, and payouts sum to the pot amount (excluding rake).

For each side pot $p$:
$$\sum \text{(payouts in } p) = \text{(pot amount in } p) - \text{(rake allocated to } p)$$

**Why**: Side pots are complex; this verifies correctness.

---

## Calculation Rules

### 1. Contribution Tracking

For each player, track:
- **Blind contribution** (small blind, big blind, ante if any)
- **Betting contribution** (bets, raises, calls)
- **All-in state** (when player ran out of chips)

Example (3-handed Expresso):
```
Player A: SB (1), calls BB (2), bets 10, calls all-in for 20 more → 33 chips out
Player B: BB (2), folds after flop bet → 2 chips out
Player C: raises to 6, goes all-in for 25 → 31 chips out (assumed)
```

### 2. Side Pot Construction (All-In Scenario)

When a player goes all-in with less than the current bet:
1. Create a **main pot** up to that player's all-in amount
2. Create **side pot(s)** for remaining players

Example (3-way, all-in):
```
Stacks before hand: A=100, B=50, C=150

Blind: A posts 1, B posts 2
Betting:
  C raises to 6 → pot=9
  A calls 6 → pot=15
  B calls 4 more (now at 6 total) → pot=19
  C raises to 20 → pot=39
  A all-in for 94 more (now at 100 total) → pot=133
  B all-in for 44 more (now at 50 total) → pot=177
  C goes all-in (assuming 150 total)

Main pot (up to B's all-in = 50): 50 × 3 = 150
Side pot 1 (A's all-in beyond B = 100): 50 + 94 = 144 (eligible: A, C)
Side pot 2 (C's raise beyond A = 150): 50 + (150-100) = 100 (eligible: C only)

Wait, recalculate...
Actually:
- Main pot: min(A, B, C) = min(100, 50, 150) = 50 → 50×3 = 150
- Side pot 1: min(A-50, C-50) = min(50, 100) = 50 → 50×2 = 100
- Side pot 2: (C-100) = 50 → 50×1 = 50
```

### 3. Showdown & Winner Determination

After all betting:
- **No showdown** (all but one folded): Last standing wins the pot(s) they're eligible for
- **Showdown** (2+ players remain): Compare hands using poker rankings
  - 1 winner per eligible pot
  - Ties: split pot among all tied players

### 4. Rake Handling

Rake is typically taken **at showdown** (pot-committed hands only) or **at end of hand** (some rooms).

For Expresso (3-handed cash), rake is usually:
- **5% of pot** (up to some cap, e.g., $1)
- Applied to **main pot only** (some rooms) or **all pots** (others)

**Implementation rule**: Track rake separately; deduct from winners' stack, not from cEV directly.

Example:
```
Main pot: 150 chips
Rake: 150 × 0.05 = 7.5 chips (assume capped at 7)
Winner gets: 150 - 7 = 143
```

### 5. Odd Chip Resolution

When a pot split must be divided unevenly (e.g., 100 chips to 3 winners):
- 100 ÷ 3 = 33 remainder 1
- Distribute: 33, 33, 34 (or rotate based on button position)

**Room policy**: Odd chip goes to...
- Button (or closest to button) — **most common**
- Small blind
- Random / defined by house rules

**Implementation**: Parameterize odd chip policy per room.

---

## Examples

### Example 1: Simple 2-Way Pot

```
Setup: Heads-up Expresso, 50 effective

Action:
  SB (A): posts 1
  BB (B): posts 2
  A calls 1 (now 2 in)
  B checks
  
  Showdown: A has AK, B has QQ
  → B wins (QQ > AK)
  → Pot: 4 chips
  → Rake: 4 × 0.05 = 0.2 (capped at 0) → Rake = 0
  → B wins 4, A loses 2

A: start=50, end=48, cEV = -2
B: start=50, end=52, cEV = +2
Sum: -2 + 2 = 0 ✓
```

### Example 2: 3-Way All-In

```
Setup: 3-handed Expresso, 100 effective each

Action:
  A (SB): posts 1
  B (BB): posts 2
  C: raises to 5 (total 5)
  A: re-raises all-in 100
  B: calls 100 (all-in)
  C: calls 95 more (all-in)

Contributions:
  A: 1 + 99 = 100
  B: 2 + 98 = 100
  C: 5 + 95 = 100

Pot: 300
Rake: 300 × 0.05 = 15
Payable: 285

Showdown: C wins

C: start=100, end=100+285=385, cEV = +285
A: start=100, end=0, cEV = -100
B: start=100, end=0, cEV = -100

Sum: +285 - 100 - 100 = 85 (but rake = 15)
Wait, let me recalculate...

Actually:
Pot before rake: 300
Rake taken: 15
Distributed: 285
Winner C gets: 285

A: end = 0, cEV = 0 - 100 = -100
B: end = 0, cEV = 0 - 100 = -100
C: end = 100 - 100 (in) + 300 (out) = 300, cEV = +100 (??)

Hmm, I think the issue is: does rake reduce the winner's stack or is it accounted separately?

**Correct calculation**:
- A starts: 100, contributes 100, ends: 0 → cEV = -100
- B starts: 100, contributes 100, ends: 0 → cEV = -100
- C starts: 100, contributes 100, ends: 100 + 300 - 15 (rake) = 385 → cEV = +285

Sum: -100 - 100 + 285 = 85 ≠ 0

**This is wrong.** Rake should be part of the invariant:
$$\sum(cEV) + rake = 0 + 15 = 15 \neq 0$$

Actually, I think the correct formula is:
$$\sum(end\_stack) = \sum(start\_stack)$$
$$end\_A + end\_B + end\_C = start\_A + start\_B + start\_C$$
$$0 + 0 + (100 + 300 - 15) = 100 + 100 + 100$$
$$385 = 300$$

This is still wrong. Let me reconsider the accounting.

**Correct accounting**:
- Before hand: A, B, C each have 100 chips on the table
- Total chips in play: 300

- After hand:
  - A lost 100 (cEV = -100)
  - B lost 100 (cEV = -100)
  - C won 300 (cEV = +200, not 285)
  - Rake taken from pot: 15 chips leave the table

- Total chips after:
  - In stacks: 0 + 0 + 300 = 300
  - Off table (rake): 15
  - Total: 315... still wrong.

**Ah, I see the issue**: Rake is taken from the pot, so the pot is smaller:
- Pot before rake: A(100) + B(100) + C(100) = 300
- Rake: 15
- Pot after rake: 285
- C wins: 285

- End stacks:
  - A: 0 (cEV = -100)
  - B: 0 (cEV = -100)
  - C: 385 (cEV = +285)

- Total end: 385 ≠ 300 (start)

This suggests **C's stack increased by 85 chips magically**, which is impossible.

**Resolution**: The rake **must come from somewhere**. In real poker:
- Either rake is deducted from the winner's pot
- Or rake is owed separately (credit system)

**Correct scenario**:
- Pot to distribute: 300
- Rake: 15 (let's say taken post-showdown)
- Winner C should get: 300 - 15 = 285

- End stacks:
  - A: 0 (cEV = -100)
  - B: 0 (cEV = -100)
  - C: 100 - 100 (in) + 285 (out) = 285 (cEV = +185)

- Total end: 0 + 0 + 285 = 285

- Chip invariant: 300 (start) = 285 (end) + 15 (rake) ✓

- Sum invariant: -100 - 100 + 185 = -15 (should equal -rake) ... hmm, that's -15, and rake = 15. So: $$\sum(cEV) + rake = -15 + 15 = 0 \checkmark$$

Great, now it works.

So the corrected example:

A: start=100, end=0, cEV = -100
B: start=100, end=0, cEV = -100
C: start=100, end=285, cEV = +185

Sum: -100 - 100 + 185 = -15
Sum + rake: -15 + 15 = 0 ✓

Chip invariant: 0 + 0 + 285 + 15 = 300 ✓
```

### Example 3: 3-Way Split (2-way showdown, 1 all-in)

```
Setup: 3-handed, A=100, B=50, C=80

Action:
  A (SB): posts 1, calls 3 (now 4 in)
  B (BB): posts 2, raises to 3, calls more to 5 (now 5 in)
  C: raises to 10, all-in (10 in)
  A: calls 6 more (now 10 in)
  B: calls 5 more (all-in, now 10 in)

Contributions:
  A: 10
  B: 10
  C: 10

Pot: 30

Now showdown:
  A: AKs
  B: 88
  C: JJ

Rankings: B(88) > C(JJ) > A(AKs) ... wait, that's wrong. AKs > JJ > 88 (assuming AKs is high card).

Let me redo:
  A: AKs → beats 88, 77, etc.
  B: 77
  C: JJ

Rankings: AK > JJ > 77

So A wins the pot.

But wait, there are 3 all-in players, so no "showdown" in the traditional sense (all-in didn't fold).

Actually, with 3 all-in players:
- All players are eligible for the same pot (30)
- Showdown: best hand wins
- A (AK): beats B (77) and C (JJ) → A wins 30

End stacks:
  A: 100 - 10 + 30 - rake = 120 - rake
  B: 50 - 10 = 40
  C: 80 - 10 = 70

With rake (30 × 5% = 1.5, assume capped at 1):
  A: 119, cEV = +19
  B: 40, cEV = -10
  C: 70, cEV = -10

Sum: +19 - 10 - 10 = -1 (rake) → sum + rake = 0 ✓
```

---

## Validation Checklist

For each hand, **before inserting** to DB:

- [ ] **Sum invariant passes**: |Σ(cEV) + rake| ≤ 0.01
- [ ] **Chip invariant passes**: Σ(end_stack) + rake = Σ(start_stack)
- [ ] **No negative stacks** after hand
- [ ] **All contributions accounted for** (blind + bet + rake)
- [ ] **Side pots (if any) correctly split** (2-way, 3-way logic)
- [ ] **Odd chips handled deterministically** (policy: button → SB → BB)
- [ ] **Rake amount non-negative**

---

## Testing Strategy

### Unit Tests
- [ ] Parser: blind/ante/bet/raise/fold/all-in/showdown
- [ ] Ledger: 2-way split, 3-way split, multiple all-ins, odd chips
- [ ] cEV: invariant checks (sum, chip, no negatives)

### Golden Dataset
- [ ] 50+ 2-way scenarios (heads-up, side pots)
- [ ] 100+ 3-way scenarios (various all-in combos)
- [ ] 50+ rake/odd chip edge cases

### Regression
- [ ] cEV matches pre-calculated golden values (mismatch = 0)
- [ ] No flaky invariant failures

---

## Known Limitations

- **No partial equity**: V0.1 doesn't calculate EV from hand strength (only realized)
- **No tie-breaking rules beyond poker hand ranking**: Rare edge cases may need manual review
- **No custom rake policies**: Only standard % rake (parameterizable)

---

**Last updated**: 2026-06-19  
**Owner**: Domain Lead
