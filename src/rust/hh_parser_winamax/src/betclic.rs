use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::Read;

use chrono::{DateTime, NaiveDateTime, Utc};

use crate::error::ParseError;
use crate::types::*;

#[derive(Debug, Clone)]
pub struct BetclicParsedHistory {
    pub hands: Vec<ParsedHand>,
    pub tournaments: Vec<TournamentSummary>,
    pub warnings: Vec<String>,
    pub hero_name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Section {
    Header,
    Players,
    HoleCards,
    PreFlop,
    Flop,
    Turn,
    River,
    Showdown,
    Summary,
    Other,
}

struct SeatInfo {
    seat_number: u32,
    player_name: String,
    stack: u64,
    flags: Vec<String>,
}

struct CompletedHand {
    hand: ParsedHand,
    tournament: TournamentSummary,
    timestamp: DateTime<Utc>,
    hero_name: String,
    hero_finish_position: Option<u32>,
}

struct TournamentAccumulator {
    summary: TournamentSummary,
    last_hand_at: DateTime<Utc>,
    hero_finish_position: Option<u32>,
}

struct HandBuilder {
    header_line: usize,
    fields: HashMap<String, String>,
    section: Section,
    seats: Vec<SeatInfo>,
    hole_cards: HashMap<String, HoleCards>,
    blinds: Vec<BlindAction>,
    streets: Vec<ParsedStreet>,
    current_street: Option<ParsedStreet>,
    street_invested: HashMap<String, u64>,
    current_bet: u64,
    board: Vec<String>,
    showdown: Option<ParsedShowdown>,
    winnings: HashMap<String, u64>,
    finish_positions: HashMap<String, u32>,
}

impl HandBuilder {
    fn new(header_line: usize) -> Self {
        Self {
            header_line,
            fields: HashMap::new(),
            section: Section::Header,
            seats: Vec::new(),
            hole_cards: HashMap::new(),
            blinds: Vec::new(),
            streets: Vec::new(),
            current_street: None,
            street_invested: HashMap::new(),
            current_bet: 0,
            board: Vec::new(),
            showdown: None,
            winnings: HashMap::new(),
            finish_positions: HashMap::new(),
        }
    }

    fn parse_line(
        &mut self,
        line: &str,
        line_no: usize,
        warnings: &mut Vec<String>,
    ) -> Result<(), ParseError> {
        if line.is_empty() || line == "------------" {
            return Ok(());
        }

        if let Some((name, suffix)) = section_marker(line) {
            self.section = match name {
                "PLAYERS" => Section::Players,
                "HOLE CARDS" => Section::HoleCards,
                "PRE-FLOP" => {
                    self.start_street(StreetType::PreFlop, Vec::new());
                    Section::PreFlop
                }
                "FLOP" => {
                    let cards = parse_bracketed_cards(suffix, line_no)?;
                    self.start_board_street(StreetType::Flop, cards, line_no)?;
                    Section::Flop
                }
                "TURN" => {
                    let cards = parse_bracketed_cards(suffix, line_no)?;
                    self.start_board_street(StreetType::Turn, cards, line_no)?;
                    Section::Turn
                }
                "RIVER" => {
                    let cards = parse_bracketed_cards(suffix, line_no)?;
                    self.start_board_street(StreetType::River, cards, line_no)?;
                    Section::River
                }
                "SHOWDOWN" => {
                    self.push_current_street();
                    self.showdown = Some(ParsedShowdown {
                        shown_hands: Vec::new(),
                        collections: Vec::new(),
                    });
                    Section::Showdown
                }
                "SUMMARY" => {
                    self.push_current_street();
                    Section::Summary
                }
                _ => {
                    warnings.push(format!("line {line_no}: unrecognized Betclic section"));
                    Section::Other
                }
            };
            return Ok(());
        }

        match self.section {
            Section::Header => {
                if let Some((key, value)) = line.split_once(": ") {
                    self.fields.insert(key.to_string(), value.to_string());
                } else {
                    warnings.push(format!("line {line_no}: unrecognized Betclic header field"));
                }
            }
            Section::Players => {
                if let Some(seat) = parse_seat(line, line_no)? {
                    self.seats.push(seat);
                } else {
                    warnings.push(format!("line {line_no}: unrecognized Betclic player line"));
                }
            }
            Section::HoleCards => {
                if let Some((player_name, cards)) = parse_hole_cards(line, line_no)? {
                    self.hole_cards.insert(player_name, cards);
                } else {
                    warnings.push(format!(
                        "line {line_no}: unrecognized Betclic hole-card line"
                    ));
                }
            }
            Section::PreFlop | Section::Flop | Section::Turn | Section::River => {
                self.parse_action_line(line, line_no, warnings)?;
            }
            Section::Showdown => {
                if let Some(shown) = parse_shown_hand(line, line_no)? {
                    if let Some(showdown) = self.showdown.as_mut() {
                        showdown.shown_hands.push(shown);
                    }
                } else {
                    warnings.push(format!(
                        "line {line_no}: unrecognized Betclic showdown line"
                    ));
                }
            }
            Section::Summary => self.parse_summary_line(line, line_no, warnings)?,
            Section::Other => {}
        }

        Ok(())
    }

    fn start_street(&mut self, street_type: StreetType, new_board_cards: Vec<String>) {
        self.push_current_street();
        self.current_street = Some(ParsedStreet {
            street_type,
            new_board_cards,
            actions: Vec::new(),
        });
        self.street_invested.clear();
        self.current_bet = 0;
    }

    fn start_board_street(
        &mut self,
        street_type: StreetType,
        cards: Vec<String>,
        line_no: usize,
    ) -> Result<(), ParseError> {
        let previous_count = match street_type {
            StreetType::Flop => 0,
            StreetType::Turn => 3,
            StreetType::River => 4,
            StreetType::PreFlop => 0,
        };
        let expected_count = match street_type {
            StreetType::Flop => 3,
            StreetType::Turn => 4,
            StreetType::River => 5,
            StreetType::PreFlop => 0,
        };
        if self.board.len() != previous_count
            || cards.len() != expected_count
            || cards[..previous_count] != self.board
        {
            return Err(ParseError::MalformedHeader {
                line: line_no,
                detail: "inconsistent Betclic board cards".into(),
            });
        }

        let new_board_cards = cards[previous_count..].to_vec();
        self.board = cards;
        self.start_street(street_type, new_board_cards);
        Ok(())
    }

    fn push_current_street(&mut self) {
        if let Some(street) = self.current_street.take() {
            self.streets.push(street);
        }
    }

    fn parse_action_line(
        &mut self,
        line: &str,
        line_no: usize,
        warnings: &mut Vec<String>,
    ) -> Result<(), ParseError> {
        let Some((player_name, action_text)) = split_action_line(line) else {
            warnings.push(format!("line {line_no}: unrecognized Betclic action line"));
            return Ok(());
        };
        let player_name = player_name.to_string();
        let (action_text, all_in) = strip_all_in(action_text);

        let action = if let Some(amount) = action_text.strip_prefix("Posts SB ") {
            self.record_blind(
                &player_name,
                BlindType::SmallBlind,
                parse_amount(amount, line_no)?,
            );
            return Ok(());
        } else if let Some(amount) = action_text.strip_prefix("Posts BB ") {
            self.record_blind(
                &player_name,
                BlindType::BigBlind,
                parse_amount(amount, line_no)?,
            );
            return Ok(());
        } else if let Some(amount) = action_text.strip_prefix("Posts Ante ") {
            self.record_blind(
                &player_name,
                BlindType::Ante,
                parse_amount(amount, line_no)?,
            );
            return Ok(());
        } else if let Some(amount) = action_text.strip_prefix("Calls ") {
            let amount = parse_amount(amount, line_no)?;
            self.record_increment(&player_name, amount);
            if all_in {
                Action::AllInCall { amount }
            } else {
                Action::Call { amount }
            }
        } else if let Some(amount) = action_text.strip_prefix("Bets ") {
            let amount = parse_amount(amount, line_no)?;
            self.record_increment(&player_name, amount);
            if all_in {
                Action::AllInBet { amount }
            } else {
                Action::Bet { amount }
            }
        } else if let Some(to) = action_text.strip_prefix("Raises to ") {
            let to = parse_amount(to, line_no)?;
            let already_invested = self.street_invested.get(&player_name).copied().unwrap_or(0);
            if to < already_invested {
                return Err(ParseError::InvalidAmount {
                    value: to.to_string(),
                    line: line_no,
                });
            }
            let increment = to.saturating_sub(self.current_bet);
            self.street_invested.insert(player_name.clone(), to);
            self.current_bet = self.current_bet.max(to);
            if all_in {
                Action::AllInRaise { increment, to }
            } else {
                Action::Raise { increment, to }
            }
        } else if action_text == "Folds" {
            Action::Fold
        } else if action_text == "Checks" {
            Action::Check
        } else if matches!(
            action_text,
            "Sits out" | "Sits in" | "Disconnected" | "Reconnected"
        ) {
            return Ok(());
        } else {
            warnings.push(format!("line {line_no}: unrecognized Betclic action"));
            return Ok(());
        };

        let Some(street) = self.current_street.as_mut() else {
            warnings.push(format!(
                "line {line_no}: Betclic action outside a betting street"
            ));
            return Ok(());
        };
        street.actions.push(PlayerAction {
            player_name,
            action,
        });
        Ok(())
    }

    fn record_blind(&mut self, player_name: &str, blind_type: BlindType, amount: u64) {
        self.blinds.push(BlindAction {
            player_name: player_name.to_string(),
            blind_type,
            amount,
        });
        let new_total = {
            let invested = self
                .street_invested
                .entry(player_name.to_string())
                .or_default();
            *invested += amount;
            *invested
        };
        self.current_bet = self.current_bet.max(new_total);
    }

    fn record_increment(&mut self, player_name: &str, amount: u64) {
        let new_total = {
            let invested = self
                .street_invested
                .entry(player_name.to_string())
                .or_default();
            *invested += amount;
            *invested
        };
        self.current_bet = self.current_bet.max(new_total);
    }

    fn parse_summary_line(
        &mut self,
        line: &str,
        line_no: usize,
        warnings: &mut Vec<String>,
    ) -> Result<(), ParseError> {
        let mut matched = None;
        let mut matching_seats: Vec<&SeatInfo> = self.seats.iter().collect();
        matching_seats.sort_by_key(|seat| std::cmp::Reverse(seat.player_name.len()));
        for seat in matching_seats {
            if let Some(rest) = line
                .strip_prefix(&seat.player_name)
                .and_then(|rest| rest.strip_prefix(' '))
            {
                matched = Some((seat.player_name.clone(), rest.to_string()));
                break;
            }
        }

        let Some((player_name, rest)) = matched else {
            warnings.push(format!("line {line_no}: unrecognized Betclic summary line"));
            return Ok(());
        };

        if let Some(amount) = rest.strip_prefix("wins main pot of ") {
            *self.winnings.entry(player_name).or_default() += parse_amount(amount, line_no)?;
        } else if let Some(pot_result) = rest.strip_prefix("wins ") {
            if let Some((pot_kind, amount)) = pot_result.rsplit_once(" of ") {
                if pot_kind.ends_with(" side pot") {
                    *self.winnings.entry(player_name).or_default() +=
                        parse_amount(amount, line_no)?;
                } else {
                    warnings.push(format!("line {line_no}: unrecognized Betclic pot result"));
                }
            } else {
                warnings.push(format!("line {line_no}: unrecognized Betclic pot result"));
            }
        } else if let Some(result) = rest.strip_prefix("finished ") {
            let position = parse_position(result).ok_or_else(|| ParseError::MalformedSummary {
                line: line_no,
                detail: "invalid Betclic finish position".into(),
            })?;
            if let Some(existing) = self.finish_positions.insert(player_name, position) {
                if existing != position {
                    return Err(ParseError::MalformedSummary {
                        line: line_no,
                        detail: "conflicting Betclic finish positions".into(),
                    });
                }
            }
        } else {
            warnings.push(format!(
                "line {line_no}: unrecognized Betclic summary result"
            ));
        }

        Ok(())
    }

    fn required(&self, field: &str) -> Result<&str, ParseError> {
        self.fields
            .get(field)
            .map(String::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| ParseError::MalformedHeader {
                line: self.header_line,
                detail: format!("missing Betclic field '{field}'"),
            })
    }

    fn finish(mut self, warnings: &mut Vec<String>) -> Result<CompletedHand, ParseError> {
        self.push_current_street();

        let hand_id = self.required("Hand ID")?.to_string();
        if self.section != Section::Summary {
            return Err(ParseError::IncompleteSummary { hand_id });
        }
        if self.seats.is_empty() {
            return Err(ParseError::NoPlayers { hand_id });
        }

        let site = self.required("Site")?;
        if !site.to_ascii_lowercase().starts_with("betclic") {
            return Err(ParseError::MalformedHeader {
                line: self.header_line,
                detail: format!("unsupported poker site '{site}'"),
            });
        }

        let game_mode = self.required("Game Mode")?.to_string();
        if !game_mode.eq_ignore_ascii_case("Spin") {
            return Err(ParseError::MalformedHeader {
                line: self.header_line,
                detail: format!("unsupported Betclic game mode '{game_mode}'"),
            });
        }

        let game_type = self.required("Game Type")?;
        if !game_type.eq_ignore_ascii_case("NL Texas Hold'em") {
            return Err(ParseError::MalformedHeader {
                line: self.header_line,
                detail: format!("unsupported Betclic game type '{game_type}'"),
            });
        }

        let game_name = self.required("Game Name")?.to_string();
        let tournament_id = self.required("Game ID")?.to_string();
        let table_name = self.required("Table ID")?.to_string();
        let buy_in_euros =
            parse_euros(self.required("Buy In")?).ok_or_else(|| ParseError::MalformedHeader {
                line: self.header_line,
                detail: "invalid Betclic buy-in".into(),
            })?;
        let prizepool_euros = parse_euros(self.required("Prize pool")?).ok_or_else(|| {
            ParseError::MalformedHeader {
                line: self.header_line,
                detail: "invalid Betclic prize pool".into(),
            }
        })?;
        if buy_in_euros <= 0.0 || prizepool_euros <= 0.0 {
            return Err(ParseError::MalformedHeader {
                line: self.header_line,
                detail: "Betclic buy-in and prize pool must be positive".into(),
            });
        }

        let multiplier_text = self.required("Multiplier")?;
        let multiplier = multiplier_text
            .strip_prefix('x')
            .unwrap_or(multiplier_text)
            .parse::<u32>()
            .ok()
            .filter(|value| *value > 0)
            .ok_or_else(|| ParseError::MalformedHeader {
                line: self.header_line,
                detail: "invalid Betclic multiplier".into(),
            })?;

        let date_text = self.required("Date & Time")?;
        let date_text =
            date_text
                .strip_suffix(" (UTC)")
                .ok_or_else(|| ParseError::MalformedHeader {
                    line: self.header_line,
                    detail: "Betclic date must be in UTC".into(),
                })?;
        let timestamp = NaiveDateTime::parse_from_str(date_text, "%Y-%m-%d %H:%M:%S")
            .map(|value| value.and_utc())
            .map_err(|error| ParseError::Timestamp(error.to_string()))?;

        let (small_blind, big_blind) = parse_blinds(self.required("Blinds")?, self.header_line)?;
        let total_pot = parse_amount(self.required("Total Pot")?, self.header_line)?;
        let rake = parse_amount(self.required("Rake")?, self.header_line)?;
        let won_total: u64 = self.winnings.values().copied().sum();
        if won_total.saturating_add(rake) != total_pot {
            return Err(ParseError::MalformedSummary {
                line: self.header_line,
                detail: format!(
                    "Betclic pot mismatch: winners received {won_total}, rake {rake}, total pot {total_pot}"
                ),
            });
        }

        let mut seat_numbers = HashSet::new();
        let mut player_names = HashSet::new();
        for seat in &self.seats {
            if !seat_numbers.insert(seat.seat_number)
                || !player_names.insert(seat.player_name.as_str())
            {
                return Err(ParseError::MalformedHeader {
                    line: self.header_line,
                    detail: "duplicate Betclic player or seat".into(),
                });
            }
        }

        let hero_seats: Vec<&SeatInfo> = self
            .seats
            .iter()
            .filter(|seat| seat.flags.iter().any(|flag| flag == "Hero"))
            .collect();
        if hero_seats.len() != 1 {
            return Err(ParseError::MalformedHeader {
                line: self.header_line,
                detail: "Betclic hand must identify exactly one hero".into(),
            });
        }
        let hero_name = hero_seats[0].player_name.clone();
        let hero_cards =
            self.hole_cards
                .remove(&hero_name)
                .ok_or_else(|| ParseError::MalformedHeader {
                    line: self.header_line,
                    detail: "Betclic hand is missing the hero's hole cards".into(),
                })?;

        for shown in self
            .showdown
            .iter()
            .flat_map(|showdown| showdown.shown_hands.iter())
        {
            if !player_names.contains(shown.player_name.as_str()) {
                return Err(ParseError::MalformedSummary {
                    line: self.header_line,
                    detail: "Betclic showdown references an unknown player".into(),
                });
            }
        }

        let button_seats: Vec<u32> = self
            .seats
            .iter()
            .filter(|seat| seat.flags.iter().any(|flag| flag == "BTN"))
            .map(|seat| seat.seat_number)
            .collect();
        if button_seats.len() != 1 {
            return Err(ParseError::MalformedHeader {
                line: self.header_line,
                detail: "Betclic hand must identify exactly one button".into(),
            });
        }

        let seat_results = self
            .seats
            .iter()
            .map(|seat| {
                let shown = self.showdown.as_ref().and_then(|showdown| {
                    showdown
                        .shown_hands
                        .iter()
                        .find(|shown| shown.player_name == seat.player_name)
                });
                SeatResult {
                    seat_number: seat.seat_number,
                    player_name: seat.player_name.clone(),
                    role: role_description(&seat.flags),
                    showed: shown.map(|shown| (shown.card1.clone(), shown.card2.clone())),
                    won: self.winnings.get(&seat.player_name).copied(),
                    hand_description: shown.map(|shown| shown.hand_description.clone()),
                }
            })
            .collect();

        let hero_finish_position = self.finish_positions.get(&hero_name).copied();
        let hand = ParsedHand {
            hand_id,
            tournament_id: tournament_id.clone(),
            table_name,
            game_name: game_name.clone(),
            buy_in_euros,
            rake_euros: 0.0,
            level: 0,
            small_blind,
            big_blind,
            button_seat: button_seats[0],
            seat_count: u32::try_from(self.seats.len()).map_err(|_| {
                ParseError::MalformedHeader {
                    line: self.header_line,
                    detail: "too many Betclic seats".into(),
                }
            })?,
            timestamp: timestamp.clone(),
            seats: self
                .seats
                .iter()
                .map(|seat| ParsedSeat {
                    seat_number: seat.seat_number,
                    player_name: seat.player_name.clone(),
                    stack: seat.stack,
                })
                .collect(),
            blinds: self.blinds,
            hero_cards: Some(hero_cards),
            streets: self.streets,
            showdown: self.showdown,
            summary: ParsedSummary {
                total_pot,
                rake,
                board: self.board,
                seat_results,
            },
        };

        let registered_players = if game_mode.eq_ignore_ascii_case("Spin") {
            3
        } else {
            0
        };
        let tournament = TournamentSummary {
            tournament_name: game_name,
            tournament_id,
            player_name: hero_name.clone(),
            buy_in_euros,
            rake_euros: 0.0,
            registered_players,
            prizepool_euros,
            multiplier,
            started_at: timestamp.clone(),
            duration_secs: 0,
            finish_position: hero_finish_position.unwrap_or(0),
        };

        if self.winnings.is_empty() {
            warnings.push(format!(
                "hand {} has no parsed Betclic pot winners",
                hand.hand_id
            ));
        }

        Ok(CompletedHand {
            hand,
            tournament,
            timestamp,
            hero_name,
            hero_finish_position,
        })
    }
}

pub fn parse_betclic_history<R: Read>(mut reader: R) -> Result<BetclicParsedHistory, ParseError> {
    let mut content = String::new();
    reader.read_to_string(&mut content)?;
    let content = content.trim_start_matches('\u{feff}');

    let mut hands = Vec::new();
    let mut warnings = Vec::new();
    let mut tournaments: BTreeMap<String, TournamentAccumulator> = BTreeMap::new();
    let mut hero_name: Option<String> = None;
    let mut current: Option<HandBuilder> = None;

    for (index, raw_line) in content.lines().enumerate() {
        let line_no = index + 1;
        let line = raw_line.trim();
        if line == "*** HEADER ***" {
            if let Some(builder) = current.take() {
                accumulate_hand(
                    builder.finish(&mut warnings)?,
                    &mut hands,
                    &mut tournaments,
                    &mut hero_name,
                )?;
            }
            current = Some(HandBuilder::new(line_no));
        } else if let Some(builder) = current.as_mut() {
            builder.parse_line(line, line_no, &mut warnings)?;
        }
    }

    if let Some(builder) = current {
        accumulate_hand(
            builder.finish(&mut warnings)?,
            &mut hands,
            &mut tournaments,
            &mut hero_name,
        )?;
    }

    if hands.is_empty() {
        return Err(ParseError::MalformedHeader {
            line: 1,
            detail: "no Betclic hand headers found".into(),
        });
    }

    let mut summaries = Vec::with_capacity(tournaments.len());
    for (tournament_id, mut accumulator) in tournaments {
        let finish_position = accumulator.hero_finish_position.ok_or_else(|| {
            ParseError::MalformedTournamentSummary(format!(
                "missing hero finish position for Betclic tournament {tournament_id}"
            ))
        })?;
        let duration = accumulator
            .last_hand_at
            .signed_duration_since(accumulator.summary.started_at)
            .num_seconds();
        if duration < 0 {
            return Err(ParseError::MalformedTournamentSummary(format!(
                "invalid hand timestamps for Betclic tournament {tournament_id}"
            )));
        }
        accumulator.summary.duration_secs = duration as u64;
        accumulator.summary.finish_position = finish_position;
        summaries.push(accumulator.summary);
    }

    let hero_name = hero_name.ok_or_else(|| ParseError::MalformedHeader {
        line: 1,
        detail: "no Betclic hero found".into(),
    })?;
    Ok(BetclicParsedHistory {
        hands,
        tournaments: summaries,
        warnings,
        hero_name,
    })
}

fn accumulate_hand(
    completed: CompletedHand,
    hands: &mut Vec<ParsedHand>,
    tournaments: &mut BTreeMap<String, TournamentAccumulator>,
    file_hero_name: &mut Option<String>,
) -> Result<(), ParseError> {
    if let Some(existing) = file_hero_name.as_deref() {
        if existing != completed.hero_name {
            return Err(ParseError::MalformedHeader {
                line: 1,
                detail: "Betclic file contains different hero names".into(),
            });
        }
    } else {
        *file_hero_name = Some(completed.hero_name.clone());
    }

    let tournament_id = completed.tournament.tournament_id.clone();
    if let Some(accumulator) = tournaments.get_mut(&tournament_id) {
        let current = &accumulator.summary;
        let next = &completed.tournament;
        if current.tournament_name != next.tournament_name
            || current.player_name != next.player_name
            || current.buy_in_euros != next.buy_in_euros
            || current.prizepool_euros != next.prizepool_euros
            || current.multiplier != next.multiplier
        {
            return Err(ParseError::MalformedTournamentSummary(format!(
                "inconsistent metadata for Betclic tournament {tournament_id}"
            )));
        }
        if completed.timestamp < accumulator.summary.started_at {
            accumulator.summary.started_at = completed.timestamp;
        }
        if completed.timestamp > accumulator.last_hand_at {
            accumulator.last_hand_at = completed.timestamp;
        }
        if let Some(position) = completed.hero_finish_position {
            if accumulator
                .hero_finish_position
                .is_some_and(|existing| existing != position)
            {
                return Err(ParseError::MalformedTournamentSummary(format!(
                    "conflicting hero finish positions for Betclic tournament {tournament_id}"
                )));
            }
            accumulator.hero_finish_position = Some(position);
        }
    } else {
        tournaments.insert(
            tournament_id,
            TournamentAccumulator {
                summary: completed.tournament,
                last_hand_at: completed.timestamp,
                hero_finish_position: completed.hero_finish_position,
            },
        );
    }
    hands.push(completed.hand);
    Ok(())
}

fn section_marker(line: &str) -> Option<(&str, &str)> {
    let content = line.strip_prefix("*** ")?;
    let (name, suffix) = content.split_once(" ***")?;
    Some((name, suffix.trim()))
}

fn parse_seat(line: &str, line_no: usize) -> Result<Option<SeatInfo>, ParseError> {
    let Some(rest) = line.strip_prefix("Seat ") else {
        return Ok(None);
    };
    let Some((seat_number, rest)) = rest.split_once(": ") else {
        return Err(ParseError::MalformedHeader {
            line: line_no,
            detail: "invalid Betclic seat line".into(),
        });
    };
    let seat_number = seat_number
        .parse::<u32>()
        .map_err(|_| ParseError::MalformedHeader {
            line: line_no,
            detail: "invalid Betclic seat number".into(),
        })?;
    let (player_name, rest) =
        rest.rsplit_once(" (")
            .ok_or_else(|| ParseError::MalformedHeader {
                line: line_no,
                detail: "invalid Betclic player stack".into(),
            })?;
    let (stack, flags) = rest
        .split_once(") [")
        .ok_or_else(|| ParseError::MalformedHeader {
            line: line_no,
            detail: "invalid Betclic player flags".into(),
        })?;
    let flags = flags
        .strip_suffix(']')
        .ok_or_else(|| ParseError::MalformedHeader {
            line: line_no,
            detail: "invalid Betclic player flags".into(),
        })?;
    if player_name.is_empty() {
        return Err(ParseError::MalformedHeader {
            line: line_no,
            detail: "empty Betclic player name".into(),
        });
    }
    Ok(Some(SeatInfo {
        seat_number,
        player_name: player_name.to_string(),
        stack: parse_amount(stack, line_no)?,
        flags: flags.split_ascii_whitespace().map(str::to_string).collect(),
    }))
}

fn parse_hole_cards(line: &str, line_no: usize) -> Result<Option<(String, HoleCards)>, ParseError> {
    let Some((player_name, cards)) = line.split_once(": [") else {
        return Ok(None);
    };
    let cards = cards
        .strip_suffix(']')
        .ok_or_else(|| ParseError::MalformedSummary {
            line: line_no,
            detail: "malformed Betclic hole cards".into(),
        })?;
    let cards = parse_card_list(cards, line_no)?;
    if cards.len() != 2 || player_name.is_empty() {
        return Err(ParseError::MalformedSummary {
            line: line_no,
            detail: "Betclic hole cards must contain two cards".into(),
        });
    }
    Ok(Some((
        player_name.to_string(),
        HoleCards {
            player_name: player_name.to_string(),
            card1: cards[0].clone(),
            card2: cards[1].clone(),
        },
    )))
}

fn parse_bracketed_cards(suffix: &str, line_no: usize) -> Result<Vec<String>, ParseError> {
    let cards = suffix
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .ok_or_else(|| ParseError::MalformedSummary {
            line: line_no,
            detail: "missing Betclic board cards".into(),
        })?;
    parse_card_list(cards, line_no)
}

fn parse_card_list(cards: &str, line_no: usize) -> Result<Vec<String>, ParseError> {
    let cards: Vec<&str> = cards.split_ascii_whitespace().collect();
    if cards.is_empty() || cards.iter().any(|card| !is_valid_card(card)) {
        return Err(ParseError::MalformedSummary {
            line: line_no,
            detail: "invalid Betclic card list".into(),
        });
    }
    Ok(cards.into_iter().map(str::to_string).collect())
}

fn is_valid_card(card: &str) -> bool {
    let bytes = card.as_bytes();
    bytes.len() == 2
        && matches!(bytes[0], b'2'..=b'9' | b'T' | b'J' | b'Q' | b'K' | b'A')
        && matches!(bytes[1], b'c' | b'd' | b'h' | b's')
}

fn split_action_line(line: &str) -> Option<(&str, &str)> {
    let (time, rest) = line.split_once(" - ")?;
    if time.len() != 8
        || !time
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b':')
    {
        return None;
    }
    rest.split_once(": ")
}

fn strip_all_in(action: &str) -> (&str, bool) {
    match action.strip_suffix(" and is all-in") {
        Some(action) => (action, true),
        None => (action, false),
    }
}

fn parse_shown_hand(line: &str, line_no: usize) -> Result<Option<ShownHand>, ParseError> {
    let Some((player_name, details)) = line.split_once(" shows [") else {
        return Ok(None);
    };
    let (cards, description) =
        details
            .split_once("] (")
            .ok_or_else(|| ParseError::MalformedSummary {
                line: line_no,
                detail: "malformed Betclic showdown hand".into(),
            })?;
    let cards = parse_card_list(cards, line_no)?;
    if cards.len() != 2 || player_name.is_empty() {
        return Err(ParseError::MalformedSummary {
            line: line_no,
            detail: "Betclic showdown must contain two hole cards".into(),
        });
    }
    let hand_description = description
        .split_once(") [")
        .map(|(value, _)| value)
        .or_else(|| description.strip_suffix(')'))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ParseError::MalformedSummary {
            line: line_no,
            detail: "missing Betclic showdown description".into(),
        })?;
    Ok(Some(ShownHand {
        player_name: player_name.to_string(),
        card1: cards[0].clone(),
        card2: cards[1].clone(),
        hand_description: hand_description.to_string(),
    }))
}

fn parse_amount(value: &str, line_no: usize) -> Result<u64, ParseError> {
    let value = value.trim();
    value.parse::<u64>().map_err(|_| ParseError::InvalidAmount {
        value: value.to_string(),
        line: line_no,
    })
}

fn parse_euros(value: &str) -> Option<f64> {
    let amount = value.trim().strip_suffix('€').unwrap_or(value.trim());
    let amount = amount.trim().parse::<f64>().ok()?;
    amount.is_finite().then_some(amount)
}

fn parse_blinds(value: &str, line_no: usize) -> Result<(u64, u64), ParseError> {
    let (small_blind, big_blind) =
        value
            .split_once('/')
            .ok_or_else(|| ParseError::MalformedHeader {
                line: line_no,
                detail: "invalid Betclic blinds".into(),
            })?;
    let small_blind = parse_amount(small_blind, line_no)?;
    let big_blind = parse_amount(big_blind, line_no)?;
    if small_blind == 0 || big_blind == 0 {
        return Err(ParseError::MalformedHeader {
            line: line_no,
            detail: "Betclic blinds must be positive".into(),
        });
    }
    Ok((small_blind, big_blind))
}

fn parse_position(result: &str) -> Option<u32> {
    let ordinal = result.split_ascii_whitespace().next()?;
    let digits_len = ordinal.bytes().take_while(u8::is_ascii_digit).count();
    if digits_len == 0 {
        return None;
    }
    let position = ordinal[..digits_len].parse::<u32>().ok()?;
    let suffix = &ordinal[digits_len..];
    let expected_suffix = if (11..=13).contains(&(position % 100)) {
        "th"
    } else {
        match position % 10 {
            1 => "st",
            2 => "nd",
            3 => "rd",
            _ => "th",
        }
    };
    (position > 0 && suffix == expected_suffix).then_some(position)
}

fn role_description(flags: &[String]) -> String {
    let mut roles = Vec::new();
    if flags.iter().any(|flag| flag == "SB") {
        roles.push("(small blind)");
    }
    if flags.iter().any(|flag| flag == "BB") {
        roles.push("(big blind)");
    }
    if flags.iter().any(|flag| flag == "BTN") {
        roles.push("(button)");
    }
    roles.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    const BETCLIC_HISTORY: &str = include_str!("../../fixtures/betclic_spin.txt");

    #[test]
    fn parses_multi_tournament_betclic_spin_export() {
        let parsed = parse_betclic_history(BETCLIC_HISTORY.as_bytes()).unwrap();

        assert_eq!(parsed.hands.len(), 3);
        assert_eq!(parsed.tournaments.len(), 2);
        assert_eq!(parsed.hero_name, "Hero");
        assert!(parsed.warnings.is_empty(), "{:?}", parsed.warnings);

        let first = &parsed.hands[0];
        assert_eq!(first.tournament_id, "GAME-001");
        assert_eq!(first.button_seat, 3);
        assert_eq!(first.seat_count, 3);
        assert_eq!(first.small_blind, 50);
        assert_eq!(first.big_blind, 100);
        assert_eq!(first.hero_cards.as_ref().unwrap().card1, "As");

        let all_in = &parsed.hands[1];
        assert_eq!(all_in.summary.board, ["2c", "3d", "8h", "9s", "Kc"]);
        assert!(matches!(
            all_in.streets[3].actions[0].action,
            Action::AllInBet { amount: 200 }
        ));
        assert!(matches!(
            all_in.streets[3].actions[1].action,
            Action::AllInCall { amount: 100 }
        ));
        assert_eq!(all_in.showdown.as_ref().unwrap().shown_hands.len(), 2);
        assert_eq!(all_in.summary.seat_results[1].won, Some(400));

        let first_tournament = &parsed.tournaments[0];
        assert_eq!(first_tournament.tournament_id, "GAME-001");
        assert_eq!(first_tournament.player_name, "Hero");
        assert_eq!(first_tournament.registered_players, 3);
        assert_eq!(first_tournament.finish_position, 1);
        assert_eq!(first_tournament.duration_secs, 60);
        assert_eq!(parsed.tournaments[1].finish_position, 2);
    }

    #[test]
    fn rejects_unsupported_betclic_game_modes() {
        let content = BETCLIC_HISTORY.replacen("Game Mode: Spin", "Game Mode: Cash", 1);
        let error = parse_betclic_history(content.as_bytes()).unwrap_err();
        assert!(matches!(error, ParseError::MalformedHeader { .. }));
    }

    #[test]
    fn parses_ordinal_finish_positions() {
        assert_eq!(parse_position("1st and wins 10.00 EUR"), Some(1));
        assert_eq!(parse_position("2nd"), Some(2));
        assert_eq!(parse_position("13th"), Some(13));
        assert_eq!(parse_position("21st"), Some(21));
        assert_eq!(parse_position("2st"), None);
    }
}
