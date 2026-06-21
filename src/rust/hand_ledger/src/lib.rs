use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use hh_parser_winamax::{Action, ParsedHand, StreetType};

#[derive(Debug, Error)]
pub enum LedgerError {
    #[error("chip conservation violated in hand {hand_id}: expected {expected}, got {actual}")]
    ChipConservation {
        hand_id: String,
        expected: u64,
        actual: u64,
    },
}

/// Per-player chip ledger for a single hand.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerLedger {
    pub player_name: String,
    pub seat_number: u32,
    pub starting_stack: u64,
    /// Total chips put into the pot (blinds + bets + calls + raises)
    pub contributions: u64,
    /// Total chips collected from the pot
    pub collected: u64,
    /// ending_stack = starting_stack - contributions + collected
    pub ending_stack: u64,
    /// realized_cev = ending_stack - starting_stack = collected - contributions
    pub realized_cev: i64,
}

/// Ledger for an entire hand.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandLedger {
    pub hand_id: String,
    pub tournament_id: String,
    pub players: Vec<PlayerLedger>,
    pub total_pot: u64,
    pub rake: u64,
}

impl HandLedger {
    /// Sum of all realized_cev values (should equal -(rake as i64))
    pub fn cev_sum(&self) -> i64 {
        self.players.iter().map(|p| p.realized_cev).sum()
    }
}

/// Compute the full ledger for a parsed hand.
///
/// Algorithm:
/// - Track each player's contributions per street (for Raise delta computation).
/// - Track collections from inline "collected" actions and from the showdown block.
pub fn compute_ledger(hand: &ParsedHand) -> HandLedger {
    // Map: player_name → (starting_stack, seat_number)
    let mut start_stacks: HashMap<&str, (u64, u32)> = HashMap::new();
    for seat in &hand.seats {
        start_stacks.insert(&seat.player_name, (seat.stack, seat.seat_number));
    }

    // Accumulators
    let mut contributions: HashMap<&str, u64> = HashMap::new();
    let mut collected: HashMap<&str, u64> = HashMap::new();

    // ── Blinds ────────────────────────────────────────────────────────────────
    for blind in &hand.blinds {
        *contributions.entry(&blind.player_name).or_default() += blind.amount;
    }

    // ── Streets ───────────────────────────────────────────────────────────────
    for street in &hand.streets {
        // Per-street invested amount (for Raise `to` delta)
        let mut street_invested: HashMap<&str, u64> = HashMap::new();

        // Pre-seed with blind amounts for PreFlop
        if street.street_type == StreetType::PreFlop {
            for blind in &hand.blinds {
                *street_invested.entry(&blind.player_name).or_default() += blind.amount;
            }
        }

        for pa in &street.actions {
            let name: &str = &pa.player_name;
            match &pa.action {
                Action::Call { amount } | Action::AllInCall { amount } => {
                    *contributions.entry(name).or_default() += amount;
                    *street_invested.entry(name).or_default() += amount;
                }
                Action::Bet { amount } | Action::AllInBet { amount } => {
                    *contributions.entry(name).or_default() += amount;
                    *street_invested.entry(name).or_default() += amount;
                }
                // `to` = total this player has committed on THIS street after this action.
                // delta = to - what they already had on this street.
                Action::Raise { to, .. } | Action::AllInRaise { to, .. } => {
                    let already = *street_invested.get(name).unwrap_or(&0);
                    let delta = to.saturating_sub(already);
                    *contributions.entry(name).or_default() += delta;
                    street_invested.insert(name, *to);
                }
                Action::Collect { amount } => {
                    *collected.entry(name).or_default() += amount;
                }
                Action::Fold | Action::Check => {}
            }
        }
    }

    // ── Showdown collections ──────────────────────────────────────────────────
    if let Some(sd) = &hand.showdown {
        for (name, amount) in &sd.collections {
            *collected.entry(name.as_str()).or_default() += amount;
        }
    }

    // ── Also check summary for any winnings not captured above ───────────────
    // (winner without showdown whose "won" only appears in summary)
    for sr in &hand.summary.seat_results {
        if let Some(won) = sr.won {
            let name = sr.player_name.as_str();
            // Only add if not already collected via inline collect line
            // (to avoid double-counting: collected + summary both present for showdowns)
            if !collected.contains_key(name) {
                *collected.entry(name).or_default() += won;
            }
        }
    }

    // ── Build ledger entries ──────────────────────────────────────────────────
    let mut players: Vec<PlayerLedger> = hand
        .seats
        .iter()
        .map(|seat| {
            let name: &str = &seat.player_name;
            let contrib = *contributions.get(name).unwrap_or(&0);
            let col = *collected.get(name).unwrap_or(&0);
            let ending = seat.stack.saturating_sub(contrib) + col;
            PlayerLedger {
                player_name: seat.player_name.clone(),
                seat_number: seat.seat_number,
                starting_stack: seat.stack,
                contributions: contrib,
                collected: col,
                ending_stack: ending,
                realized_cev: ending as i64 - seat.stack as i64,
            }
        })
        .collect();

    players.sort_by_key(|p| p.seat_number);

    HandLedger {
        hand_id: hand.hand_id.clone(),
        tournament_id: hand.tournament_id.clone(),
        players,
        total_pot: hand.summary.total_pot,
        rake: hand.summary.rake,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hh_parser_winamax::parse_hands;

    const HAND_3WAY: &str = r#"Winamax Poker - Tournament "Expresso" buyIn: 1.86€ + 0.14€ level: 1 - HandId: #4829108511470256129-1-1780949140 - Holdem no limit (10/20) - 2026/06/08 20:05:40 UTC
Table: 'Expresso(1124364443)#0' 3-max (real money) Seat #2 is the button
Seat 1: KeDuBluff_2A (500)
Seat 2: MRZO (500)
Seat 3: Le Yoyo14510 (500)
*** ANTE/BLINDS ***
Le Yoyo14510 posts small blind 10
KeDuBluff_2A posts big blind 20
Dealt to MRZO [4c Ah]
*** PRE-FLOP *** 
MRZO raises 20 to 40
Le Yoyo14510 calls 30
KeDuBluff_2A calls 20
*** FLOP *** [9d 9h Td]
Le Yoyo14510 checks
KeDuBluff_2A checks
MRZO checks
*** TURN *** [9d 9h Td][Kh]
Le Yoyo14510 checks
KeDuBluff_2A bets 78
MRZO folds
Le Yoyo14510 raises 78 to 156
KeDuBluff_2A calls 78
*** RIVER *** [9d 9h Td Kh][3h]
Le Yoyo14510 bets 304 and is all-in
KeDuBluff_2A calls 304 and is all-in
*** SHOW DOWN ***
Le Yoyo14510 shows [Kd Jd] (Two pairs : Kings and 9)
KeDuBluff_2A shows [4h 5h] (Flush King high)
KeDuBluff_2A collected 1040 from pot
*** SUMMARY ***
Total pot 1040 | No rake
Board: [9d 9h Td Kh 3h]
Seat 1: KeDuBluff_2A (big blind) showed [4h 5h] and won 1040 with Flush King high
Seat 3: Le Yoyo14510 (small blind) showed [Kd Jd] and lost with Two pairs : Kings and 9
"#;

    #[test]
    fn test_ledger_chip_conservation() {
        let (hands, _) = parse_hands(HAND_3WAY.as_bytes()).unwrap();
        let ledger = compute_ledger(&hands[0]);

        // Total chips in == total chips out (no rake)
        let total_in: u64 = ledger.players.iter().map(|p| p.starting_stack).sum();
        let total_out: u64 = ledger.players.iter().map(|p| p.ending_stack).sum();
        assert_eq!(total_in, total_out + ledger.rake, "chip conservation");
    }

    #[test]
    fn test_ledger_cev_sum_zero() {
        let (hands, _) = parse_hands(HAND_3WAY.as_bytes()).unwrap();
        let ledger = compute_ledger(&hands[0]);
        // sum(cEV) + rake == 0
        assert_eq!(ledger.cev_sum() + ledger.rake as i64, 0);
    }

    #[test]
    fn test_mrzo_folded_cev() {
        let (hands, _) = parse_hands(HAND_3WAY.as_bytes()).unwrap();
        let ledger = compute_ledger(&hands[0]);
        let mrzo = ledger.players.iter().find(|p| p.player_name == "MRZO").unwrap();
        // MRZO put in 40 (raise preflop), folded on turn, collected 0
        assert_eq!(mrzo.contributions, 40);
        assert_eq!(mrzo.collected, 0);
        assert_eq!(mrzo.realized_cev, -40);
    }

    #[test]
    fn test_winner_cev() {
        let (hands, _) = parse_hands(HAND_3WAY.as_bytes()).unwrap();
        let ledger = compute_ledger(&hands[0]);
        let winner = ledger.players.iter().find(|p| p.player_name == "KeDuBluff_2A").unwrap();
        // KeDuBluff put in 500, collected 1040
        assert_eq!(winner.contributions, 500);
        assert_eq!(winner.collected, 1040);
        assert_eq!(winner.realized_cev, 540);
    }
}
