use serde::{Deserialize, Serialize};
use thiserror::Error;
use hand_ledger::HandLedger;

pub const CHIP_TOLERANCE: i64 = 1; // rounding tolerance in chips

#[derive(Debug, Error)]
pub enum InvariantError {
    #[error("sum invariant violated in hand {hand_id}: sum(cEV) + rake = {actual}, expected 0 (tolerance ±{tol})")]
    SumInvariant {
        hand_id: String,
        actual: i64,
        tol: i64,
    },
    #[error("chip conservation violated in hand {hand_id}: chips_in={chips_in}, chips_out+rake={chips_out_rake}")]
    ChipConservation {
        hand_id: String,
        chips_in: u64,
        chips_out_rake: u64,
    },
    #[error("pot mismatch in hand {hand_id}: computed contributions={computed}, summary pot={summary}")]
    PotMismatch {
        hand_id: String,
        computed: u64,
        summary: u64,
    },
}

/// Result of invariant validation for a single hand.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvariantReport {
    pub hand_id: String,
    pub sum_invariant_ok: bool,
    pub chip_conservation_ok: bool,
    pub pot_match_ok: bool,
    pub errors: Vec<String>,
}

impl InvariantReport {
    pub fn all_ok(&self) -> bool {
        self.sum_invariant_ok && self.chip_conservation_ok && self.pot_match_ok
    }
}

/// Validate all invariants for a hand ledger.
pub fn validate(ledger: &HandLedger) -> InvariantReport {
    let mut errors = Vec::new();

    // ── 1. Sum invariant: sum(cEV) + rake == 0 ──────────────────────────────
    let cev_sum = ledger.cev_sum();
    let sum_check = cev_sum + ledger.rake as i64;
    let sum_ok = sum_check.abs() <= CHIP_TOLERANCE;
    if !sum_ok {
        errors.push(format!(
            "sum invariant: sum(cEV) + rake = {} (expected 0, tolerance ±{})",
            sum_check, CHIP_TOLERANCE
        ));
    }

    // ── 2. Chip conservation: sum(start) == sum(end) + rake ─────────────────
    let chips_in: u64 = ledger.players.iter().map(|p| p.starting_stack).sum();
    let chips_out: u64 = ledger.players.iter().map(|p| p.ending_stack).sum();
    let chips_out_rake = chips_out + ledger.rake;
    let chip_ok = chips_in == chips_out_rake;
    if !chip_ok {
        errors.push(format!(
            "chip conservation: in={chips_in}, out+rake={chips_out_rake}"
        ));
    }

    // ── 3. Pot match: sum(contributions) - rake == total_pot - rake ─────────
    //    i.e. sum(contributions) == total_pot
    let total_contrib: u64 = ledger.players.iter().map(|p| p.contributions).sum();
    let pot_ok = total_contrib == ledger.total_pot;
    if !pot_ok {
        errors.push(format!(
            "pot mismatch: sum(contributions)={total_contrib}, summary.total_pot={}",
            ledger.total_pot
        ));
    }

    InvariantReport {
        hand_id: ledger.hand_id.clone(),
        sum_invariant_ok: sum_ok,
        chip_conservation_ok: chip_ok,
        pot_match_ok: pot_ok,
        errors,
    }
}

/// Validate a batch of ledgers and return a summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchValidation {
    pub total: usize,
    pub passed: usize,
    pub failed: usize,
    pub reports: Vec<InvariantReport>,
}

pub fn validate_batch(ledgers: &[HandLedger]) -> BatchValidation {
    let reports: Vec<InvariantReport> = ledgers.iter().map(validate).collect();
    let passed = reports.iter().filter(|r| r.all_ok()).count();
    BatchValidation {
        total: reports.len(),
        passed,
        failed: reports.len() - passed,
        reports,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hand_ledger::compute_ledger;
    use hh_parser_winamax::parse_hands;

    const HAND: &str = r#"Winamax Poker - Tournament "Expresso" buyIn: 1.86€ + 0.14€ level: 1 - HandId: #4829108511470256129-1-1780949140 - Holdem no limit (10/20) - 2026/06/08 20:05:40 UTC
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
    fn test_all_invariants_pass() {
        let (hands, _) = parse_hands(HAND.as_bytes()).unwrap();
        let ledger = compute_ledger(&hands[0]);
        let report = validate(&ledger);
        assert!(report.all_ok(), "invariants failed: {:?}", report.errors);
    }
}
