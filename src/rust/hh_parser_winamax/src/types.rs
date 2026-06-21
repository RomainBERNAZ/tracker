use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

// ─── Hand history types ───────────────────────────────────────────────────────

/// One fully parsed hand from a Winamax HH file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedHand {
    /// e.g. "4829108511470256129-1-1780949140"
    pub hand_id: String,
    /// e.g. "1124364443"
    pub tournament_id: String,
    /// e.g. "Expresso(1124364443)#0"
    pub table_name: String,
    /// e.g. "Expresso"
    pub game_name: String,
    pub buy_in_euros: f64,
    pub rake_euros: f64,
    pub level: u32,
    pub small_blind: u64,
    pub big_blind: u64,
    /// 1-based seat number of the button
    pub button_seat: u32,
    pub seat_count: u32,
    pub timestamp: DateTime<Utc>,
    pub seats: Vec<ParsedSeat>,
    pub blinds: Vec<BlindAction>,
    /// Hole cards of the tracked player (from "Dealt to …" line)
    pub hero_cards: Option<HoleCards>,
    pub streets: Vec<ParsedStreet>,
    pub showdown: Option<ParsedShowdown>,
    pub summary: ParsedSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedSeat {
    pub seat_number: u32,
    pub player_name: String,
    /// Starting stack in chips
    pub stack: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlindAction {
    pub player_name: String,
    pub blind_type: BlindType,
    pub amount: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum BlindType {
    SmallBlind,
    BigBlind,
    Ante,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HoleCards {
    pub player_name: String,
    pub card1: String,
    pub card2: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedStreet {
    pub street_type: StreetType,
    /// Community cards added on this street (empty for PreFlop)
    pub new_board_cards: Vec<String>,
    pub actions: Vec<PlayerAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum StreetType {
    PreFlop,
    Flop,
    Turn,
    River,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerAction {
    pub player_name: String,
    pub action: Action,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Action {
    Fold,
    Check,
    /// Additional chips put in to call
    Call { amount: u64 },
    Bet { amount: u64 },
    /// `increment` = raise above previous bet; `to` = new total players must match
    Raise { increment: u64, to: u64 },
    /// Collect from pot (inline, before summary)
    Collect { amount: u64 },
    // All-in variants
    AllInCall { amount: u64 },
    AllInBet { amount: u64 },
    AllInRaise { increment: u64, to: u64 },
}

impl Action {
    pub fn chips_put_in(&self) -> u64 {
        match self {
            Action::Call { amount }
            | Action::AllInCall { amount }
            | Action::Bet { amount }
            | Action::AllInBet { amount } => *amount,
            // `to` is the new total for this street by this player; caller must subtract
            // what the player already committed on this street.
            // We expose `to` so the ledger crate can compute the delta.
            Action::Raise { to, .. } | Action::AllInRaise { to, .. } => *to,
            Action::Fold | Action::Check | Action::Collect { .. } => 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedShowdown {
    pub shown_hands: Vec<ShownHand>,
    /// Inline "collected X from pot" inside the showdown block
    pub collections: Vec<(String, u64)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShownHand {
    pub player_name: String,
    pub card1: String,
    pub card2: String,
    pub hand_description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedSummary {
    pub total_pot: u64,
    pub rake: u64,
    pub board: Vec<String>,
    pub seat_results: Vec<SeatResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeatResult {
    pub seat_number: u32,
    pub player_name: String,
    /// e.g. "(small blind)", "(big blind) (button)", ""
    pub role: String,
    pub showed: Option<(String, String)>,
    pub won: Option<u64>,
    pub hand_description: Option<String>,
}

// ─── Tournament summary types ─────────────────────────────────────────────────

/// Parsed from a `*_summary.txt` file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TournamentSummary {
    pub tournament_name: String,
    pub tournament_id: String,
    pub player_name: String,
    pub buy_in_euros: f64,
    pub rake_euros: f64,
    pub registered_players: u32,
    pub prizepool_euros: f64,
    /// 2, 3, 4, 5, 10, 20, 100, 1000, 500000
    pub multiplier: u32,
    pub started_at: DateTime<Utc>,
    pub duration_secs: u64,
    pub finish_position: u32,
}
