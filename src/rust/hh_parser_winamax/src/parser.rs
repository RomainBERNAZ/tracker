use std::io::{BufRead, BufReader, Read};
use regex::Regex;
use chrono::{NaiveDateTime, Utc};

use crate::error::ParseError;
use crate::types::*;

// ─── Regex constants (compiled once) ─────────────────────────────────────────

macro_rules! re {
    ($pat:expr) => {
        Regex::new($pat).expect("static regex is valid")
    };
}

// Winamax Poker - Tournament "Expresso" buyIn: 1.86€ + 0.14€ level: 1 - HandId: #4829108511470256129-1-1780949140 - Holdem no limit (10/20) - 2026/06/08 20:05:40 UTC
const RE_HEADER: &str =
    r#"^Winamax Poker - Tournament "([^"]+)" buyIn: ([\d.]+)€ \+ ([\d.]+)€ level: (\d+) - HandId: #([\d-]+) - Holdem no limit \((\d+)/(\d+)\) - (\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2}) UTC$"#;

// Table: 'Expresso(1124364443)#0' 3-max (real money) Seat #2 is the button
const RE_TABLE: &str =
    r#"^Table: '([^']+)' (\d+)-max \([^)]+\) Seat #(\d+) is the button$"#;

// Seat 1: KeDuBluff_2A (500)
const RE_SEAT: &str = r#"^Seat (\d+): (.+) \((\d+)\)$"#;

// Le Yoyo14510 posts small blind 10
const RE_BLIND_SB: &str = r#"^(.+) posts small blind (\d+)$"#;
const RE_BLIND_BB: &str = r#"^(.+) posts big blind (\d+)$"#;
const RE_BLIND_SB_ALLIN: &str = r#"^(.+) posts small blind (\d+) and is all-in$"#;
const RE_BLIND_BB_ALLIN: &str = r#"^(.+) posts big blind (\d+) and is all-in$"#;
const RE_BLIND_ANTE: &str = r#"^(.+) posts ante (\d+)$"#;

// Dealt to MRZO [4c Ah]
const RE_DEALT: &str = r#"^Dealt to (.+) \[([2-9TJQKA][cdhs]) ([2-9TJQKA][cdhs])\]$"#;

// *** PRE-FLOP ***
// *** FLOP *** [9d 9h Td]
// *** TURN *** [9d 9h Td][Kh]
// *** RIVER *** [9d 9h Td Kh][3h]
const RE_STREET_PREFLOP: &str = r#"^\*\*\* PRE-FLOP \*\*\*"#;
const RE_STREET_FLOP: &str = r#"^\*\*\* FLOP \*\*\* \[([^\]]+)\]"#;
const RE_STREET_TURN: &str = r#"^\*\*\* TURN \*\*\* \[[^\]]+\]\[([^\]]+)\]"#;
const RE_STREET_RIVER: &str = r#"^\*\*\* RIVER \*\*\* \[[^\]]+\]\[([^\]]+)\]"#;

// Actions
const RE_FOLD: &str = r#"^(.+) folds$"#;
const RE_CHECK: &str = r#"^(.+) checks$"#;
const RE_CALL: &str = r#"^(.+) calls (\d+)$"#;
const RE_CALL_ALLIN: &str = r#"^(.+) calls (\d+) and is all-in$"#;
const RE_BET: &str = r#"^(.+) bets (\d+)$"#;
const RE_BET_ALLIN: &str = r#"^(.+) bets (\d+) and is all-in$"#;
const RE_RAISE: &str = r#"^(.+) raises (\d+) to (\d+)$"#;
const RE_RAISE_ALLIN: &str = r#"^(.+) raises (\d+) to (\d+) and is all-in$"#;
const RE_COLLECT: &str = r#"^(.+) collected (\d+) from (?:main |side )?pot$"#;

// *** SHOW DOWN ***
const RE_SHOWS: &str = r#"^(.+) shows \[([2-9TJQKA][cdhs]) ([2-9TJQKA][cdhs])\] \((.+)\)$"#;

// *** SUMMARY ***
// Total pot 1040 | No rake   OR   Total pot 1040 | Rake: 7
const RE_TOTAL_POT: &str = r#"^Total pot (\d+) \| (?:No rake|Rake: (\d+))"#;
// Board: [9d 9h Td Kh 3h]
const RE_BOARD: &str = r#"^Board: \[([^\]]+)\]"#;
// Seat lines in summary (complex – parsed manually)
const RE_SUMMARY_SEAT_PREFIX: &str = r#"^Seat (\d+): "#;

// ─── Parser ───────────────────────────────────────────────────────────────────

struct Regexes {
    header: Regex,
    table: Regex,
    seat: Regex,
    blind_sb: Regex,
    blind_bb: Regex,
    blind_sb_allin: Regex,
    blind_bb_allin: Regex,
    blind_ante: Regex,
    dealt: Regex,
    street_preflop: Regex,
    street_flop: Regex,
    street_turn: Regex,
    street_river: Regex,
    fold: Regex,
    check: Regex,
    call: Regex,
    call_allin: Regex,
    bet: Regex,
    bet_allin: Regex,
    raise: Regex,
    raise_allin: Regex,
    collect: Regex,
    shows: Regex,
    total_pot: Regex,
    board: Regex,
    summary_seat_prefix: Regex,
}

impl Regexes {
    fn new() -> Self {
        Self {
            header: re!(RE_HEADER),
            table: re!(RE_TABLE),
            seat: re!(RE_SEAT),
            blind_sb: re!(RE_BLIND_SB),
            blind_bb: re!(RE_BLIND_BB),
            blind_sb_allin: re!(RE_BLIND_SB_ALLIN),
            blind_bb_allin: re!(RE_BLIND_BB_ALLIN),
            blind_ante: re!(RE_BLIND_ANTE),
            dealt: re!(RE_DEALT),
            street_preflop: re!(RE_STREET_PREFLOP),
            street_flop: re!(RE_STREET_FLOP),
            street_turn: re!(RE_STREET_TURN),
            street_river: re!(RE_STREET_RIVER),
            fold: re!(RE_FOLD),
            check: re!(RE_CHECK),
            call: re!(RE_CALL),
            call_allin: re!(RE_CALL_ALLIN),
            bet: re!(RE_BET),
            bet_allin: re!(RE_BET_ALLIN),
            raise: re!(RE_RAISE),
            raise_allin: re!(RE_RAISE_ALLIN),
            collect: re!(RE_COLLECT),
            shows: re!(RE_SHOWS),
            total_pot: re!(RE_TOTAL_POT),
            board: re!(RE_BOARD),
            summary_seat_prefix: re!(RE_SUMMARY_SEAT_PREFIX),
        }
    }
}

#[derive(Debug, PartialEq)]
enum State {
    Idle,
    Seats,
    Blinds,
    Street,
    ShowDown,
    Summary,
}

struct HandBuildState {
    hand_id: String,
    tournament_id: String,
    table_name: String,
    game_name: String,
    buy_in_euros: f64,
    rake_euros: f64,
    level: u32,
    small_blind: u64,
    big_blind: u64,
    button_seat: u32,
    seat_count: u32,
    timestamp: chrono::DateTime<Utc>,
    seats: Vec<ParsedSeat>,
    blinds: Vec<BlindAction>,
    hero_cards: Option<HoleCards>,
    streets: Vec<ParsedStreet>,
    current_street: Option<ParsedStreet>,
    showdown: Option<ParsedShowdown>,
    summary_pot: u64,
    summary_rake: u64,
    summary_board: Vec<String>,
    summary_seats: Vec<SeatResult>,
}

impl Default for HandBuildState {
    fn default() -> Self {
        Self {
            hand_id: String::new(),
            tournament_id: String::new(),
            table_name: String::new(),
            game_name: String::new(),
            buy_in_euros: 0.0,
            rake_euros: 0.0,
            level: 0,
            small_blind: 0,
            big_blind: 0,
            button_seat: 0,
            seat_count: 0,
            timestamp: chrono::DateTime::default(),
            seats: Vec::new(),
            blinds: Vec::new(),
            hero_cards: None,
            streets: Vec::new(),
            current_street: None,
            showdown: None,
            summary_pot: 0,
            summary_rake: 0,
            summary_board: Vec::new(),
            summary_seats: Vec::new(),
        }
    }
}

/// Parse all hands from a Winamax HH file.
///
/// Non-fatal errors (malformed lines) are collected in the second return value.
/// Fatal errors (IO) are returned as `Err`.
pub fn parse_hands<R: Read>(
    reader: R,
) -> Result<(Vec<ParsedHand>, Vec<String>), ParseError> {
    let re = Regexes::new();
    let buf = BufReader::new(reader);

    let mut hands: Vec<ParsedHand> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    let mut current = HandBuildState::default();

    let mut state = State::Idle;

    // We read all lines into memory (files are small enough)
    let lines: Vec<String> = buf
        .lines()
        .map(|l| l.map_err(ParseError::Io))
        .collect::<Result<_, _>>()?;

    // Macro to push the current in-progress street and start a new one
    macro_rules! push_street {
        () => {
            if let Some(s) = current.current_street.take() {
                current.streets.push(s);
            }
        };
    }

    // Macro to finalise and store the current hand
    macro_rules! finalise_hand {
        () => {
            if !current.hand_id.is_empty() && !current.seats.is_empty() {
                push_street!();
                hands.push(ParsedHand {
                    hand_id: current.hand_id.clone(),
                    tournament_id: current.tournament_id.clone(),
                    table_name: current.table_name.clone(),
                    game_name: current.game_name.clone(),
                    buy_in_euros: current.buy_in_euros,
                    rake_euros: current.rake_euros,
                    level: current.level,
                    small_blind: current.small_blind,
                    big_blind: current.big_blind,
                    button_seat: current.button_seat,
                    seat_count: current.seat_count,
                    timestamp: current.timestamp,
                    seats: current.seats.clone(),
                    blinds: current.blinds.clone(),
                    hero_cards: current.hero_cards.clone(),
                    streets: current.streets.clone(),
                    showdown: current.showdown.clone(),
                    summary: ParsedSummary {
                        total_pot: current.summary_pot,
                        rake: current.summary_rake,
                        board: current.summary_board.clone(),
                        seat_results: current.summary_seats.clone(),
                    },
                });
            }
            current = HandBuildState::default();
        };
    }

    for (idx, raw_line) in lines.iter().enumerate() {
        let line_no = idx + 1;
        let line = raw_line.trim_end();

        // ── New hand header ────────────────────────────────────────────────
        if let Some(caps) = re.header.captures(line) {
            finalise_hand!();
            state = State::Seats;

            current.game_name = caps[1].to_string();
            current.buy_in_euros = caps[2].parse::<f64>().unwrap_or(0.0);
            current.rake_euros = caps[3].parse::<f64>().unwrap_or(0.0);
            current.level = caps[4].parse().unwrap_or(0);
            // hand_id = full_id, tournament_id = first segment
            let full_id = caps[5].to_string();
            let parts: Vec<&str> = full_id.splitn(2, '-').collect();
            current.tournament_id = parts[0].to_string();
            current.hand_id = full_id;
            current.small_blind = caps[6].parse().unwrap_or(0);
            current.big_blind = caps[7].parse().unwrap_or(0);

            current.timestamp = NaiveDateTime::parse_from_str(&caps[8], "%Y/%m/%d %H:%M:%S")
                .map(|ndt| ndt.and_utc())
                .unwrap_or_default();
            continue;
        }

        match state {
            State::Idle => {
                // skip until next header
            }

            // ── Table line + seat lines ────────────────────────────────────
            State::Seats => {
                if let Some(caps) = re.table.captures(line) {
                    current.table_name = caps[1].to_string();
                    current.seat_count = caps[2].parse().unwrap_or(0);
                    current.button_seat = caps[3].parse().unwrap_or(0);
                } else if let Some(caps) = re.seat.captures(line) {
                    current.seats.push(ParsedSeat {
                        seat_number: caps[1].parse().unwrap_or(0),
                        player_name: caps[2].to_string(),
                        stack: caps[3].parse().unwrap_or(0),
                    });
                } else if re.street_preflop.is_match(line) {
                    // skip ANTE/BLINDS section header, will hit in Blinds
                } else if line == "*** ANTE/BLINDS ***" {
                    state = State::Blinds;
                }
            }

            // ── Blind/ante posts + dealt cards ────────────────────────────
            State::Blinds => {
                if let Some(caps) = re.blind_sb.captures(line) {
                    current.blinds.push(BlindAction {
                        player_name: caps[1].to_string(),
                        blind_type: BlindType::SmallBlind,
                        amount: caps[2].parse().unwrap_or(0),
                    });
                } else if let Some(caps) = re.blind_sb_allin.captures(line) {
                    current.blinds.push(BlindAction {
                        player_name: caps[1].to_string(),
                        blind_type: BlindType::SmallBlind,
                        amount: caps[2].parse().unwrap_or(0),
                    });
                } else if let Some(caps) = re.blind_bb.captures(line) {
                    current.blinds.push(BlindAction {
                        player_name: caps[1].to_string(),
                        blind_type: BlindType::BigBlind,
                        amount: caps[2].parse().unwrap_or(0),
                    });
                } else if let Some(caps) = re.blind_bb_allin.captures(line) {
                    current.blinds.push(BlindAction {
                        player_name: caps[1].to_string(),
                        blind_type: BlindType::BigBlind,
                        amount: caps[2].parse().unwrap_or(0),
                    });
                } else if let Some(caps) = re.blind_ante.captures(line) {
                    current.blinds.push(BlindAction {
                        player_name: caps[1].to_string(),
                        blind_type: BlindType::Ante,
                        amount: caps[2].parse().unwrap_or(0),
                    });
                } else if let Some(caps) = re.dealt.captures(line) {
                    current.hero_cards = Some(HoleCards {
                        player_name: caps[1].to_string(),
                        card1: caps[2].to_string(),
                        card2: caps[3].to_string(),
                    });
                } else if re.street_preflop.is_match(line) {
                    current.current_street = Some(ParsedStreet {
                        street_type: StreetType::PreFlop,
                        new_board_cards: vec![],
                        actions: vec![],
                    });
                    state = State::Street;
                }
            }

            // ── Betting streets ───────────────────────────────────────────
            State::Street => {
                // Section transitions
                if let Some(caps) = re.street_flop.captures(line) {
                    push_street!();
                    let cards = parse_card_list(&caps[1]);
                    current.current_street = Some(ParsedStreet {
                        street_type: StreetType::Flop,
                        new_board_cards: cards,
                        actions: vec![],
                    });
                } else if let Some(caps) = re.street_turn.captures(line) {
                    push_street!();
                    let cards = parse_card_list(&caps[1]);
                    current.current_street = Some(ParsedStreet {
                        street_type: StreetType::Turn,
                        new_board_cards: cards,
                        actions: vec![],
                    });
                } else if let Some(caps) = re.street_river.captures(line) {
                    push_street!();
                    let cards = parse_card_list(&caps[1]);
                    current.current_street = Some(ParsedStreet {
                        street_type: StreetType::River,
                        new_board_cards: cards,
                        actions: vec![],
                    });
                } else if line == "*** SHOW DOWN ***" {
                    push_street!();
                    current.showdown = Some(ParsedShowdown {
                        shown_hands: vec![],
                        collections: vec![],
                    });
                    state = State::ShowDown;
                } else if line == "*** SUMMARY ***" {
                    push_street!();
                    state = State::Summary;
                } else {
                    // Parse action line
                    if let Some(action) = parse_action(line, &re, line_no, &mut warnings) {
                        if let Some(street) = current.current_street.as_mut() {
                            street.actions.push(action);
                        }
                    }
                }
            }

            // ── Show-down ─────────────────────────────────────────────────
            State::ShowDown => {
                if line == "*** SUMMARY ***" {
                    state = State::Summary;
                } else if let Some(caps) = re.shows.captures(line) {
                    if let Some(sd) = current.showdown.as_mut() {
                        sd.shown_hands.push(ShownHand {
                            player_name: caps[1].to_string(),
                            card1: caps[2].to_string(),
                            card2: caps[3].to_string(),
                            hand_description: caps[4].to_string(),
                        });
                    }
                } else if let Some(caps) = re.collect.captures(line) {
                    let amount: u64 = caps[2].parse().unwrap_or(0);
                    if let Some(sd) = current.showdown.as_mut() {
                        sd.collections.push((caps[1].to_string(), amount));
                    }
                }
            }

            // ── Summary ───────────────────────────────────────────────────
            State::Summary => {
                if let Some(caps) = re.total_pot.captures(line) {
                    current.summary_pot = caps[1].parse().unwrap_or(0);
                    current.summary_rake = caps
                        .get(2)
                        .and_then(|m| m.as_str().parse().ok())
                        .unwrap_or(0);
                } else if let Some(caps) = re.board.captures(line) {
                    current.summary_board = parse_card_list(&caps[1]);
                } else if re.summary_seat_prefix.is_match(line) {
                    match parse_summary_seat(line, line_no) {
                        Ok(sr) => current.summary_seats.push(sr),
                        Err(e) => warnings.push(format!("line {line_no}: {e}")),
                    }
                }
                // End of summary = blank line or next hand header (handled at top)
            }
        }
    }

    // Finalise last hand without resetting state again at EOF.
    if !current.hand_id.is_empty() && !current.seats.is_empty() {
        push_street!();
        hands.push(ParsedHand {
            hand_id: current.hand_id.clone(),
            tournament_id: current.tournament_id.clone(),
            table_name: current.table_name.clone(),
            game_name: current.game_name.clone(),
            buy_in_euros: current.buy_in_euros,
            rake_euros: current.rake_euros,
            level: current.level,
            small_blind: current.small_blind,
            big_blind: current.big_blind,
            button_seat: current.button_seat,
            seat_count: current.seat_count,
            timestamp: current.timestamp,
            seats: current.seats.clone(),
            blinds: current.blinds.clone(),
            hero_cards: current.hero_cards.clone(),
            streets: current.streets.clone(),
            showdown: current.showdown.clone(),
            summary: ParsedSummary {
                total_pot: current.summary_pot,
                rake: current.summary_rake,
                board: current.summary_board.clone(),
                seat_results: current.summary_seats.clone(),
            },
        });
    }

    Ok((hands, warnings))
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn parse_card_list(s: &str) -> Vec<String> {
    s.split_whitespace().map(String::from).collect()
}

fn parse_action(
    line: &str,
    re: &Regexes,
    line_no: usize,
    warnings: &mut Vec<String>,
) -> Option<PlayerAction> {
    if let Some(caps) = re.raise_allin.captures(line) {
        return Some(PlayerAction {
            player_name: caps[1].to_string(),
            action: Action::AllInRaise {
                increment: caps[2].parse().unwrap_or(0),
                to: caps[3].parse().unwrap_or(0),
            },
        });
    }
    if let Some(caps) = re.raise.captures(line) {
        return Some(PlayerAction {
            player_name: caps[1].to_string(),
            action: Action::Raise {
                increment: caps[2].parse().unwrap_or(0),
                to: caps[3].parse().unwrap_or(0),
            },
        });
    }
    if let Some(caps) = re.call_allin.captures(line) {
        return Some(PlayerAction {
            player_name: caps[1].to_string(),
            action: Action::AllInCall {
                amount: caps[2].parse().unwrap_or(0),
            },
        });
    }
    if let Some(caps) = re.call.captures(line) {
        return Some(PlayerAction {
            player_name: caps[1].to_string(),
            action: Action::Call {
                amount: caps[2].parse().unwrap_or(0),
            },
        });
    }
    if let Some(caps) = re.bet_allin.captures(line) {
        return Some(PlayerAction {
            player_name: caps[1].to_string(),
            action: Action::AllInBet {
                amount: caps[2].parse().unwrap_or(0),
            },
        });
    }
    if let Some(caps) = re.bet.captures(line) {
        return Some(PlayerAction {
            player_name: caps[1].to_string(),
            action: Action::Bet {
                amount: caps[2].parse().unwrap_or(0),
            },
        });
    }
    if let Some(caps) = re.fold.captures(line) {
        return Some(PlayerAction {
            player_name: caps[1].to_string(),
            action: Action::Fold,
        });
    }
    if let Some(caps) = re.check.captures(line) {
        return Some(PlayerAction {
            player_name: caps[1].to_string(),
            action: Action::Check,
        });
    }
    if let Some(caps) = re.collect.captures(line) {
        return Some(PlayerAction {
            player_name: caps[1].to_string(),
            action: Action::Collect {
                amount: caps[2].parse().unwrap_or(0),
            },
        });
    }

    // Skip known non-action lines silently
    if line.is_empty()
        || line.starts_with("***")
        || line.starts_with("Dealt to")
        || line.starts_with("Table:")
        || line.starts_with("Seat ")
    {
        return None;
    }

    warnings.push(format!("line {line_no}: unrecognised action: {line}"));
    None
}

/// Parse a SUMMARY "Seat N: …" line.
///
/// Formats observed:
/// - `Seat 1: PLAYER (role) showed [c1 c2] and won N with HAND`
/// - `Seat 1: PLAYER (role) showed [c1 c2] and lost with HAND`
/// - `Seat 1: PLAYER (role) (button) won N`        ← no showdown
/// - `Seat 2: MRZO (small blind) (button) won N`
fn parse_summary_seat(line: &str, line_no: usize) -> Result<SeatResult, ParseError> {
    // Extract seat number
    let after_seat = line
        .strip_prefix("Seat ")
        .ok_or_else(|| ParseError::MalformedSummary {
            line: line_no,
            detail: "missing 'Seat ' prefix".into(),
        })?;

    let colon_pos = after_seat
        .find(": ")
        .ok_or_else(|| ParseError::MalformedSummary {
            line: line_no,
            detail: "missing ': '".into(),
        })?;
    let seat_number: u32 = after_seat[..colon_pos]
        .parse()
        .map_err(|_| ParseError::MalformedSummary {
            line: line_no,
            detail: "invalid seat number".into(),
        })?;

    let rest = &after_seat[colon_pos + 2..]; // after "N: "

    // Player name = everything before the first " ("
    let paren_pos = rest
        .find(" (")
        .ok_or_else(|| ParseError::MalformedSummary {
            line: line_no,
            detail: format!("no role parenthesis in: {rest}"),
        })?;
    let player_name = rest[..paren_pos].to_string();
    let after_name = &rest[paren_pos + 1..]; // starts with "("

    // Collect all role tokens "(xxx)" before any keyword (showed / won)
    let mut role_parts: Vec<&str> = Vec::new();
    let mut cursor = after_name;
    loop {
        if let Some(end) = cursor.find(')') {
            let token = &cursor[..end + 1]; // "(xxx)"
            let after = cursor[end + 1..].trim_start();
            if after.starts_with('(') {
                role_parts.push(token);
                cursor = &cursor[end + 1..];
                cursor = cursor.trim_start();
            } else {
                role_parts.push(token);
                cursor = after;
                break;
            }
        } else {
            break;
        }
    }
    let role = role_parts.join(" ");

    // cursor now points to what comes after all role tokens (trim)
    let outcome = cursor.trim();

    // Parse "showed [c1 c2] and won N with HAND"
    let re_showed_won = Regex::new(
        r#"^showed \[([2-9TJQKA][cdhs]) ([2-9TJQKA][cdhs])\] and won (\d+) with (.+)$"#,
    )
    .unwrap();
    let re_showed_lost = Regex::new(
        r#"^showed \[([2-9TJQKA][cdhs]) ([2-9TJQKA][cdhs])\] and lost with (.+)$"#,
    )
    .unwrap();
    let re_won = Regex::new(r#"^won (\d+)$"#).unwrap();

    if let Some(caps) = re_showed_won.captures(outcome) {
        return Ok(SeatResult {
            seat_number,
            player_name,
            role,
            showed: Some((caps[1].to_string(), caps[2].to_string())),
            won: Some(caps[3].parse().unwrap_or(0)),
            hand_description: Some(caps[4].to_string()),
        });
    }
    if let Some(caps) = re_showed_lost.captures(outcome) {
        return Ok(SeatResult {
            seat_number,
            player_name,
            role,
            showed: Some((caps[1].to_string(), caps[2].to_string())),
            won: None,
            hand_description: Some(caps[3].to_string()),
        });
    }
    if let Some(caps) = re_won.captures(outcome) {
        return Ok(SeatResult {
            seat_number,
            player_name,
            role,
            showed: None,
            won: Some(caps[1].parse().unwrap_or(0)),
            hand_description: None,
        });
    }

    // Folded player (line may not mention them or may just have the role)
    Ok(SeatResult {
        seat_number,
        player_name,
        role,
        showed: None,
        won: None,
        hand_description: None,
    })
}
