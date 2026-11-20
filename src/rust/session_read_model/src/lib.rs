use rusqlite::{Connection, Row, params};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json;
use std::collections::BTreeMap;

pub mod stacks;
pub mod short_stack;
pub mod hitting_board;
pub mod hand_reviews;

fn json<T: DeserializeOwned>(row: &Row<'_>, index: usize) -> rusqlite::Result<T> {
    serde_json::from_str(&row.get::<_, String>(index)?).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, Box::new(error))
    })
}

// ─── Read models (returned to the UI) ────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TournamentRow {
    pub id: String,
    pub player_name: String,
    pub buy_in_euros: f64,
    pub rake_euros: f64,
    pub prizepool_euros: f64,
    pub multiplier: i64,
    pub finish_position: i64,
    pub started_at: String,
    pub duration_secs: i64,
    pub net_eur: f64,
    pub hand_count: i64,
    pub hero_cev_sum: i64,
    /// Runout adjustment to the actual cash result, not a standalone cash result.
    pub all_in_correction_eur: Option<f64>,
    pub adjusted_all_in_count: i64,
    pub calculated_all_in_count: i64,
    /// cEV sum on hands WITHOUT showdown
    pub wsd_cev_sum: i64,
    /// cEV sum on hands WITH showdown
    pub sd_cev_sum: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandRow {
    pub id: String,
    pub tournament_id: String,
    pub level: i64,
    pub small_blind: i64,
    pub big_blind: i64,
    pub timestamp: String,
    pub hero_cev: i64,
    pub hero_collected: i64,
    pub hero_net_ev: Option<i64>,
    pub hero_allin_equity: Option<f64>,
    pub hero_cards: Option<String>,   // "Ah Kd" or null
    pub total_pot: i64,
    pub seat_count: i64,
    pub invariants_ok: bool,
    /// Net EV converted to euros: net_ev_chips * prizepool_eur / total_chips (proportional V1)
    pub hero_net_ev_eur: Option<f64>,
    /// Whether the hand reached showdown (NULL for legacy rows imported before this flag existed)
    pub has_showdown: Option<bool>,
    /// Whether hero showed cards at showdown (NULL for legacy rows imported before this flag existed)
    pub hero_showed: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandDetail {
    pub hand: HandRow,
    pub players: Vec<PlayerDetailRow>,
    pub actions: Vec<ActionRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerDetailRow {
    pub seat_number: i64,
    pub player_name: String,
    pub starting_stack: i64,
    pub ending_stack: i64,
    pub contributions: i64,
    pub collected: i64,
    pub realized_cev: i64,
    pub net_ev: Option<i64>,
    pub allin_equity: Option<f64>,
    pub hero: bool,
    pub hole_cards: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionRow {
    pub street: String,
    pub action_index: i64,
    pub player_name: String,
    pub action_type: String,
    pub amount: Option<i64>,
    pub increment_amount: Option<i64>,
    pub to_amount: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStats {
    pub total_tournaments: i64,
    pub total_hands: i64,
    /// Total net P&L in euros across all tournaments
    pub total_net_eur: f64,
    pub avg_net_eur_per_tournament: f64,
    pub wins: i64,
    pub second_place: i64,
    pub third_place: i64,
    /// Multiplier breakdown: [(multiplier, count)]
    pub multiplier_dist: Vec<(i64, i64)>,
}

// ─── Replayer models ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplayerState {
    pub hand_id: String,
    pub tournament_id: String,
    pub table_name: String,
    pub timestamp: String,
    pub level: i64,
    pub small_blind: i64,
    pub big_blind: i64,
    pub players: Vec<ReplayerPlayer>,
    pub button_pos: usize,
    pub board: Vec<String>,  // Cards as "As", "Kh", etc. Progressive per street
    pub current_step: usize,
    pub total_steps: usize,
    pub steps: Vec<ReplayerStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplayerPlayer {
    pub seat_number: i64,
    pub name: String,
    pub hero: bool,
    pub starting_stack: i64,
    pub current_stack: i64,  // At current_step
    pub hole_cards: Option<String>,  // "As Kd" format or null
    pub folded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplayerStep {
    pub step_number: usize,
    pub street: String,
    pub actor_name: String,
    pub action_type: String,
    pub amount: Option<i64>,
    pub increment_amount: Option<i64>,
    pub to_amount: Option<i64>,
    pub pot_size_after: i64,
    pub players_after: Vec<ReplayerPlayer>,
    pub description: String,  // Human-readable: "PlayerA bets 50" etc.
}

// ─── Queries ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandChipPoint {
    pub tournament_id: String,
    pub hero_cards: Option<String>,
    pub big_blind: i64,
    pub player_count: i64,
    pub hero_starting_stack: i64,
    pub hero_stack_bucket: Option<usize>,
    pub timestamp: String,
    pub realized_cev: i64,
    pub net_ev: Option<i64>,
    /// Whether hero reached showdown, not just the other players.
    pub has_showdown: bool,
}

// A hero fold remains WSD even when the remaining opponents reach showdown.
const HERO_SHOWDOWN_SQL: &str = r#"(COALESCE(h.has_showdown, 0) <> 0 AND NOT EXISTS (
    SELECT 1 FROM hand_actions hero_action
    WHERE hero_action.hand_id = h.id
      AND hero_action.player_name = hp.player_name
      AND hero_action.action_type = 'fold'
))"#;

/// Returns per-hand chip data ordered by timestamp for cumulative chart.
pub fn get_chip_evolution(conn: &Connection) -> Result<Vec<HandChipPoint>, rusqlite::Error> {
    let mut stmt = conn.prepare(&format!(
        r#"SELECT h.timestamp, hp.realized_cev, hp.net_ev,
                  {HERO_SHOWDOWN_SQL}, h.tournament_id, hc.card1 || ' ' || hc.card2,
                  h.big_blind, h.player_count, hp.starting_stack
           FROM hands h
           JOIN hand_players hp ON hp.hand_id = h.id AND hp.hero = 1
           LEFT JOIN hole_cards hc ON hc.hand_id = h.id AND hc.player_name = hp.player_name
           ORDER BY h.timestamp ASC"#,
    ))?;

    let rows = stmt.query_map([], |row| {
        let big_blind = row.get(6)?;
        let hero_starting_stack = row.get(8)?;
        Ok(HandChipPoint {
            tournament_id: row.get(4)?,
            hero_cards: row.get(5)?,
            big_blind,
            player_count: row.get(7)?,
            hero_starting_stack,
            hero_stack_bucket: stacks::stack_bucket(hero_starting_stack, big_blind),
            timestamp: row.get(0)?,
            realized_cev: row.get(1)?,
            net_ev: row.get(2)?,
            has_showdown: row.get::<_, i64>(3).map(|v| v != 0)?,
        })
    })?;

    rows.collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchupOpponent {
    pub player_name: String,
    pub cards: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DuelOutcome {
    Win,
    Loss,
    Split,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreflopDuel {
    pub hero_starting_stack: i64,
    pub villain_starting_stack: i64,
    pub hero_equity: Option<f64>,
    pub outcome: Option<DuelOutcome>,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreflopMatchup {
    pub hand_id: String,
    pub tournament_id: String,
    pub timestamp: String,
    pub big_blind: i64,
    pub total_starting_chips: i64,
    pub hero_cards: Option<String>,
    pub realized_cev: i64,
    pub net_ev: Option<i64>,
    pub allin_equity: Option<f64>,
    pub opponents: Vec<MatchupOpponent>,
    pub duel: Option<PreflopDuel>,
}

fn read_preflop_duel(row: &rusqlite::Row<'_>) -> Result<PreflopDuel, rusqlite::Error> {
    let hero_contribution: i64 = row.get(12)?;
    let villain_contribution: i64 = row.get(13)?;
    let hero_collected: i64 = row.get(14)?;
    let villain_collected: i64 = row.get(15)?;
    let total_pot: i64 = row.get(16)?;
    let rake: i64 = row.get(17)?;
    let total_contributions: i64 = row.get(18)?;
    let contested_pot: i64 = row.get(19)?;
    let maximum_contribution: i64 = row.get(20)?;
    let mut duel = PreflopDuel {
        hero_starting_stack: row.get(10)?,
        villain_starting_stack: row.get(11)?,
        hero_equity: None,
        outcome: None,
        issues: Vec::new(),
    };
    if hero_contribution <= 0 || villain_contribution <= 0 || contested_pot <= 0
        || total_pot != total_contributions || total_pot < contested_pot || rake != 0
        || maximum_contribution > hero_contribution.max(villain_contribution)
        || duel.hero_starting_stack < hero_contribution
        || duel.villain_starting_stack < villain_contribution
    {
        duel.issues.push("Pot ou contributions incoherents : equite du duel et resultat indisponibles.".into());
        return Ok(duel);
    }
    let uncontested = total_pot - contested_pot;
    let hero_guaranteed = if hero_contribution > villain_contribution { uncontested } else { 0 };
    let villain_guaranteed = if villain_contribution > hero_contribution { uncontested } else { 0 };
    let hero_share = hero_collected - hero_guaranteed;
    let villain_share = villain_collected - villain_guaranteed;
    // Remove guaranteed side pots before inferring the contested showdown result.
    if hero_share >= 0 && villain_share >= 0 && hero_share + villain_share == contested_pot {
        duel.outcome = match (hero_share, villain_share) {
            (hero, 0) if hero > 0 => Some(DuelOutcome::Win),
            (0, villain) if villain > 0 => Some(DuelOutcome::Loss),
            (hero, villain) if hero > 0 && villain > 0 && (hero - villain).abs() <= 1 =>
                Some(DuelOutcome::Split),
            _ => None,
        };
    }
    if duel.outcome.is_none() {
        duel.issues.push("Collectes incompletes ou partage non standard : resultat du duel indisponible.".into());
    }
    if let Some(pot_share) = row.get::<_, Option<f64>>(7)? {
        // Imported equity is an expected share of the entire pot, including guaranteed tiers.
        let equity = (pot_share * total_pot as f64 - hero_guaranteed as f64) / contested_pot as f64;
        if pot_share.is_finite() && (0.0..=1.0).contains(&pot_share)
            && equity.is_finite() && (-1e-9..=1.0 + 1e-9).contains(&equity)
        {
            duel.hero_equity = Some(equity.clamp(0.0, 1.0));
        } else {
            duel.issues.push("Equite importee incompatible avec le pot conteste.".into());
        }
    }
    Ok(duel)
}

/// One row per preflop all-in confrontation, including covered shoves.
/// Later betting or folds would no longer describe a locked preflop matchup.
pub fn list_preflop_matchups(conn: &Connection) -> Result<Vec<PreflopMatchup>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        r#"SELECT h.id, h.tournament_id, h.timestamp, h.big_blind,
                  hc.card1 || ' ' || hc.card2,
                  hp.realized_cev, hp.net_ev, hp.allin_equity,
                  villain.player_name, shown.card1 || ' ' || shown.card2,
                  hp.starting_stack, villain.starting_stack,
                  hp.contributions, villain.contributions, hp.collected, villain.collected,
                  h.total_pot, h.rake_chips,
                  (SELECT SUM(p.contributions) FROM hand_players p WHERE p.hand_id = h.id),
                  (SELECT SUM(MIN(p.contributions, MIN(hp.contributions, villain.contributions)))
                     FROM hand_players p WHERE p.hand_id = h.id),
                  (SELECT MAX(p.contributions) FROM hand_players p WHERE p.hand_id = h.id),
                  (SELECT SUM(p.starting_stack) FROM hand_players p WHERE p.hand_id = h.id)
           FROM hands h
           JOIN hand_players hp ON hp.hand_id = h.id AND hp.hero = 1
           LEFT JOIN hole_cards hc ON hc.hand_id = h.id AND hc.player_name = hp.player_name
           JOIN hand_players villain ON villain.hand_id = h.id
                AND villain.player_name <> hp.player_name AND villain.contributions > 0
           LEFT JOIN showdown_hole_cards shown
                ON shown.hand_id = h.id AND shown.player_name = villain.player_name
           WHERE hp.contributions > 0
             AND EXISTS (
                 SELECT 1 FROM hand_actions a WHERE a.hand_id = h.id AND a.street_order = 0
                   AND a.action_type IN ('allin_call', 'allin_bet', 'allin_raise')
             )
             AND NOT EXISTS (
                 SELECT 1 FROM hand_actions a WHERE a.hand_id = h.id
                   AND ((a.player_name = hp.player_name AND a.action_type = 'fold')
                     OR (a.street_order > 0 AND a.action_type IN
                        ('fold', 'call', 'bet', 'raise', 'allin_call', 'allin_bet', 'allin_raise')))
             )
             AND NOT EXISTS (
                 SELECT 1 FROM hand_actions a WHERE a.hand_id = h.id
                   AND a.player_name = villain.player_name AND a.action_type = 'fold'
             )
           ORDER BY h.timestamp DESC, h.id, villain.seat_number"#,
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            PreflopMatchup {
                hand_id: row.get(0)?,
                tournament_id: row.get(1)?,
                timestamp: row.get(2)?,
                big_blind: row.get(3)?,
                total_starting_chips: row.get(21)?,
                hero_cards: row.get(4)?,
                realized_cev: row.get(5)?,
                net_ev: row.get(6)?,
                allin_equity: row.get(7)?,
                opponents: Vec::new(),
                duel: Some(read_preflop_duel(row)?),
            },
            MatchupOpponent { player_name: row.get(8)?, cards: row.get(9)? },
        ))
    })?;
    let mut hands = BTreeMap::new();
    for row in rows {
        let (hand, opponent) = row?;
        hands.entry(hand.hand_id.clone()).or_insert(hand).opponents.push(opponent);
    }
    let mut hands: Vec<PreflopMatchup> = hands.into_values().collect();
    for hand in &mut hands {
        if hand.opponents.len() != 1 {
            hand.duel = None;
        }
    }
    hands.sort_by(|a, b| b.timestamp.cmp(&a.timestamp).then_with(|| a.hand_id.cmp(&b.hand_id)));
    Ok(hands)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChipSummary {
    pub net_chips: i64,
    pub net_ev_chips: i64,
    pub avg_cev_per_game: f64,
    pub wsd_net_chips: i64,   // Realized chips when hero did not reach showdown
    pub sd_net_chips: i64,    // Realized chips when hero reached showdown
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoachSpot {
    pub hand_id: String,
    pub tournament_id: String,
    pub timestamp: String,
    pub delta_chips: i64,
    pub has_showdown: bool,
    pub severity: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoachFormatStats {
    pub hands: i64,
    pub vpip_count: i64,
    pub vpip_pct: f64,
    pub pfr_count: i64,
    pub pfr_pct: f64,
    pub three_bet_count: i64,
    pub three_bet_opportunities: i64,
    pub three_bet_pct: f64,
    pub limp_count: i64,
    pub limp_pct: f64,
    pub fold_to_three_bet_count: i64,
    pub fold_to_three_bet_opportunities: i64,
    pub fold_to_three_bet_pct: f64,
    pub feedback: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoachStatsSnapshot {
    pub early_phase: CoachFormatStats,
    pub mid_phase: CoachFormatStats,
    pub late_phase: CoachFormatStats,
    pub heads_up: CoachFormatStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoachBlunderSpot {
    pub hand_id: String,
    pub tournament_id: String,
    pub timestamp: String,
    pub level: i64,
    pub big_blind: i64,
    pub action_kind: String,
    pub action_type: String,
    pub hero_stack_bb: f64,
    pub action_amount_bb: f64,
    pub net_ev_chips: i64,
    pub net_ev_bb: f64,
    pub allin_equity: Option<f64>,
    pub has_showdown: bool,
    pub severity: String,
    pub reason: String,
}

#[derive(Debug, Clone)]
struct PreflopActionSample {
    player_name: String,
    action_type: String,
}

#[derive(Debug, Clone)]
struct PreflopHandSample {
    player_count: i64,
    level: i64,
    hero_name: String,
    actions: Vec<PreflopActionSample>,
}

/// Single-query chip aggregation — replaces the N+1 hand-loading in the frontend.
pub fn get_chip_summary(conn: &Connection) -> Result<ChipSummary, rusqlite::Error> {
    let (net_chips, net_ev_chips, wsd_net_chips, sd_net_chips): (i64, i64, i64, i64) =
        conn.query_row(
            &format!(r#"SELECT
                COALESCE(SUM(hp.realized_cev), 0),
                COALESCE(SUM(COALESCE(hp.net_ev, hp.realized_cev)), 0),
                COALESCE(SUM(CASE WHEN NOT {HERO_SHOWDOWN_SQL} THEN hp.realized_cev ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN {HERO_SHOWDOWN_SQL} THEN hp.realized_cev ELSE 0 END), 0)
            FROM hand_players hp
            JOIN hands h ON h.id = hp.hand_id
            WHERE hp.hero = 1"#),
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?;

    let total_tournaments: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tournaments",
        [],
        |r| r.get(0),
    )?;

    let avg_cev_per_game = if total_tournaments > 0 {
        net_ev_chips as f64 / total_tournaments as f64
    } else {
        0.0
    };

    Ok(ChipSummary { net_chips, net_ev_chips, avg_cev_per_game, wsd_net_chips, sd_net_chips })
}

/// List potentially important variance/setup spots for coach review.
pub fn list_coach_spots(
    conn: &Connection,
    limit: Option<usize>,
) -> Result<Vec<CoachSpot>, rusqlite::Error> {
    let lim = limit.unwrap_or(300) as i64;

    let mut stmt = conn.prepare(
        r#"SELECT h.id,
                  h.tournament_id,
                  h.timestamp,
                  COALESCE(h.has_showdown, 0) AS has_showdown,
                  (hp.realized_cev - COALESCE(hp.net_ev, hp.realized_cev)) AS delta_chips
           FROM hands h
           JOIN hand_players hp ON hp.hand_id = h.id AND hp.hero = 1
           WHERE hp.net_ev IS NOT NULL
             AND ABS(hp.realized_cev - COALESCE(hp.net_ev, hp.realized_cev)) >= 120
           ORDER BY ABS(hp.realized_cev - COALESCE(hp.net_ev, hp.realized_cev)) DESC,
                    h.timestamp DESC
           LIMIT ?1"#,
    )?;

    let rows = stmt.query_map(params![lim], |row| {
        let has_showdown = row.get::<_, i64>(3).map(|v| v != 0)?;
        let delta_chips: i64 = row.get(4)?;

        let severity = if delta_chips.abs() >= 220 {
            "high"
        } else if delta_chips.abs() >= 160 {
            "medium"
        } else {
            "low"
        };

        let reason = if has_showdown && delta_chips <= -180 {
            "Top range adverse probable"
        } else if delta_chips <= -120 {
            "Setup defavorable"
        } else if delta_chips >= 120 {
            "Setup favorable"
        } else {
            "Ecart vs EV"
        };

        Ok(CoachSpot {
            hand_id: row.get(0)?,
            tournament_id: row.get(1)?,
            timestamp: row.get(2)?,
            delta_chips,
            has_showdown,
            severity: severity.to_string(),
            reason: reason.to_string(),
        })
    })?;

    rows.collect()
}

fn severity_rank(severity: &str) -> i32 {
    match severity {
        "critical" => 2,
        "bad" => 1,
        _ => 0,
    }
}

/// V1 blunder detector focused on clearly bad preflop all-in calls and pushes.
/// Marginal spots are intentionally filtered out using strict bbEV thresholds.
pub fn list_coach_blunders(
    conn: &Connection,
    from_ts: Option<&str>,
    to_ts: Option<&str>,
    limit: Option<usize>,
    min_severity: Option<&str>,
    buy_ins: &[f64],
) -> Result<Vec<CoachBlunderSpot>, rusqlite::Error> {
    let buy_ins_json = serde_json::to_string(buy_ins)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    let lim = limit.unwrap_or(120) as i64;
    let min_rank = min_severity.map_or(1, severity_rank);

    let mut stmt = conn.prepare(
        r#"SELECT h.id,
                  h.tournament_id,
                  h.timestamp,
                  h.level,
                  h.big_blind,
                  COALESCE(h.has_showdown, 0) AS has_showdown,
                  hp.starting_stack,
                  hp.net_ev,
                  hp.allin_equity,
                  a.action_type,
                  COALESCE(a.amount, a.increment_amount, a.to_amount, 0) AS action_amount
           FROM hands h
           JOIN hand_players hp ON hp.hand_id = h.id AND hp.hero = 1
           JOIN hand_actions a
             ON a.hand_id = h.id
            AND a.street_order = 0
            AND a.player_name = hp.player_name
           WHERE hp.net_ev IS NOT NULL
             AND a.action_type IN ('allin_call', 'allin_bet', 'allin_raise')
             AND h.tournament_id IN (
                 SELECT t.id FROM tournaments t
                 WHERE (?1 IS NULL OR julianday(t.started_at) >= julianday(?1))
                   AND (?2 IS NULL OR julianday(t.started_at) <= julianday(?2))
                   AND (json_array_length(?3) = 0 OR ROUND(t.buy_in_euros + t.rake_euros, 6)
                        IN (SELECT value FROM json_each(?3)))
             )
             AND NOT EXISTS (
                 SELECT 1
                 FROM hand_actions a2
                 WHERE a2.hand_id = a.hand_id
                   AND a2.street_order = a.street_order
                   AND a2.player_name = a.player_name
                   AND a2.action_type IN ('allin_call', 'allin_bet', 'allin_raise')
                   AND a2.action_index < a.action_index
             )
           ORDER BY h.timestamp DESC"#,
    )?;

    let rows: Vec<(String, String, String, i64, i64, bool, i64, i64, Option<f64>, String, i64)> = stmt
        .query_map(params![from_ts, to_ts, buy_ins_json], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get::<_, i64>(5).map(|v| v != 0)?,
                row.get(6)?,
                row.get(7)?,
                row.get(8)?,
                row.get(9)?,
                row.get(10)?,
            ))
        })?
        .collect::<Result<_, _>>()?;

    let mut out = Vec::new();

    for (hand_id, tournament_id, timestamp, level, big_blind, has_showdown, hero_stack, net_ev_chips, allin_equity, action_type, action_amount) in rows {
        if big_blind <= 0 {
            continue;
        }

        let bb = big_blind as f64;
        let net_ev_bb = net_ev_chips as f64 / bb;
        let hero_stack_bb = hero_stack as f64 / bb;
        let action_amount_bb = action_amount.max(0) as f64 / bb;

        // Ignore marginal spots by requiring a meaningful negative bbEV.
        if net_ev_bb > -4.0 {
            continue;
        }

        let is_call = action_type == "allin_call";
        let action_kind = if is_call { "call" } else { "push" };

        let mut severity = "";
        let mut reason = String::new();

        if is_call {
            if net_ev_bb <= -8.0 && allin_equity.unwrap_or(0.0) <= 0.30 {
                severity = "critical";
                reason = "Call all-in tres negatif (EV et equity tres basses).".to_string();
            } else if net_ev_bb <= -5.0 && allin_equity.unwrap_or(0.0) <= 0.36 {
                severity = "bad";
                reason = "Call all-in negatif (hors zone marginale).".to_string();
            }
        } else if net_ev_bb <= -10.0 || (hero_stack_bb >= 25.0 && net_ev_bb <= -6.0) {
            severity = "critical";
            reason = "Push all-in trop cher pour la profondeur.".to_string();
        } else if hero_stack_bb >= 15.0 && net_ev_bb <= -6.0 {
            severity = "bad";
            reason = "Push all-in negatif a profondeur non triviale.".to_string();
        }

        if severity.is_empty() || severity_rank(severity) < min_rank {
            continue;
        }

        out.push(CoachBlunderSpot {
            hand_id,
            tournament_id,
            timestamp,
            level,
            big_blind,
            action_kind: action_kind.to_string(),
            action_type,
            hero_stack_bb,
            action_amount_bb,
            net_ev_chips,
            net_ev_bb,
            allin_equity,
            has_showdown,
            severity: severity.to_string(),
            reason,
        });
    }

    out.sort_by(|a, b| {
        severity_rank(&b.severity)
            .cmp(&severity_rank(&a.severity))
            .then_with(|| a.net_ev_bb.partial_cmp(&b.net_ev_bb).unwrap_or(std::cmp::Ordering::Equal))
            .then_with(|| b.timestamp.cmp(&a.timestamp))
    });

    if out.len() > lim as usize {
        out.truncate(lim as usize);
    }

    Ok(out)
}

fn is_voluntary_preflop_action(action_type: &str) -> bool {
    matches!(action_type, "call" | "raise" | "bet" | "allin_call" | "allin_bet" | "allin_raise")
}

fn is_aggressive_preflop_action(action_type: &str) -> bool {
    matches!(action_type, "raise" | "bet" | "allin_bet" | "allin_raise")
}

fn is_call_preflop_action(action_type: &str) -> bool {
    matches!(action_type, "call" | "allin_call")
}

fn pct(count: i64, opportunities: i64) -> f64 {
    if opportunities <= 0 {
        0.0
    } else {
        (count as f64 * 100.0) / opportunities as f64
    }
}

fn build_preflop_feedback(player_count: i64, stats: &CoachFormatStats) -> Vec<String> {
    let mut feedback = Vec::new();

    if stats.hands < 30 {
        feedback.push(format!("Echantillon limite: {} mains seulement.", stats.hands));
    }

    if player_count == 3 {
        if stats.vpip_pct < 22.0 {
            feedback.push("3-way: VPIP assez tight, tu abandonnes peut-etre trop de spots jouables.".to_string());
        } else if stats.vpip_pct > 40.0 {
            feedback.push("3-way: VPIP assez loose, attention a ne pas trop defendre hors position.".to_string());
        } else {
            feedback.push("3-way: volume VPIP plutot sain.".to_string());
        }

        if stats.vpip_count > 0 && (stats.pfr_count as f64 / stats.vpip_count as f64) < 0.55 {
            feedback.push("3-way: ecart VPIP/PFR important, profil plutot passif preflop.".to_string());
        }

        if stats.three_bet_opportunities >= 5 {
            if stats.three_bet_pct < 5.0 {
                feedback.push("3-way: 3-bet plutot bas, tu peux sans doute punir un peu plus les opens.".to_string());
            } else if stats.three_bet_pct > 16.0 {
                feedback.push("3-way: 3-bet eleve, verifie que la range reste stable.".to_string());
            }
        }

        if stats.limp_pct > 10.0 {
            feedback.push("3-way: presence notable de limps, a verifier selon ta strategie SB.".to_string());
        }
    } else {
        if stats.vpip_pct < 55.0 {
            feedback.push("HU: VPIP trop faible, tu risques de laisser trop de blindes.".to_string());
        } else if stats.vpip_pct > 85.0 {
            feedback.push("HU: VPIP tres large, attention a ne pas surdefendre.".to_string());
        } else {
            feedback.push("HU: activite preflop dans une zone raisonnable.".to_string());
        }

        if stats.vpip_count > 0 && (stats.pfr_count as f64 / stats.vpip_count as f64) < 0.65 {
            feedback.push("HU: tu completes/calls plus que tu n'agresses, profil assez passif.".to_string());
        }

        if stats.three_bet_opportunities >= 5 {
            if stats.three_bet_pct < 10.0 {
                feedback.push("HU: 3-bet plutot bas, tu peux mettre plus de pression preflop.".to_string());
            } else if stats.three_bet_pct > 22.0 {
                feedback.push("HU: 3-bet tres actif, surveille les ranges de bluff.".to_string());
            }
        }

        if stats.limp_pct > 35.0 {
            feedback.push("HU: beaucoup de limps, verifie si tu ne manques pas d'open raises faciles.".to_string());
        }
    }

    if stats.fold_to_three_bet_opportunities >= 4 {
        if stats.fold_to_three_bet_pct > 65.0 {
            feedback.push("Face aux 3-bets: tu folds beaucoup, possible leak de defense.".to_string());
        } else if stats.fold_to_three_bet_pct < 25.0 {
            feedback.push("Face aux 3-bets: defense tres sticky, verifie la qualite des continues.".to_string());
        }
    }

    feedback
}

fn compute_preflop_stats(samples: &[PreflopHandSample], player_count: i64) -> CoachFormatStats {
    let mut hands = 0_i64;
    let mut vpip_count = 0_i64;
    let mut pfr_count = 0_i64;
    let mut three_bet_count = 0_i64;
    let mut three_bet_opportunities = 0_i64;
    let mut limp_count = 0_i64;
    let mut fold_to_three_bet_count = 0_i64;
    let mut fold_to_three_bet_opportunities = 0_i64;

    for sample in samples.iter().filter(|sample| sample.player_count == player_count) {
        hands += 1;

        if sample.actions.iter().any(|a| a.player_name == sample.hero_name && is_voluntary_preflop_action(&a.action_type)) {
            vpip_count += 1;
        }

        if sample.actions.iter().any(|a| a.player_name == sample.hero_name && is_aggressive_preflop_action(&a.action_type)) {
            pfr_count += 1;
        }

        if let Some(first_hero_idx) = sample.actions.iter().position(|a| {
            a.player_name == sample.hero_name &&
                (is_voluntary_preflop_action(&a.action_type) || matches!(a.action_type.as_str(), "fold" | "check"))
        }) {
            let first_hero_action = &sample.actions[first_hero_idx];
            let prior_aggressive = sample.actions[..first_hero_idx]
                .iter()
                .filter(|a| is_aggressive_preflop_action(&a.action_type))
                .count() as i64;

            if prior_aggressive == 0 && is_call_preflop_action(&first_hero_action.action_type) {
                limp_count += 1;
            }
        }

        let mut aggressive_count = 0_i64;
        let mut hero_opened = false;
        let mut three_bet_opportunity = false;
        let mut made_three_bet = false;
        for (idx, action) in sample.actions.iter().enumerate() {
            let hero_action = action.player_name == sample.hero_name;
            let decision = is_voluntary_preflop_action(&action.action_type) ||
                matches!(action.action_type.as_str(), "fold" | "check");
            if hero_action && decision && aggressive_count == 1 && !hero_opened {
                three_bet_opportunity = true;
                made_three_bet |= is_aggressive_preflop_action(&action.action_type);
            }
            if !is_aggressive_preflop_action(&action.action_type) {
                continue;
            }

            if aggressive_count == 1 && !hero_action {
                if hero_opened {
                    if let Some(next_hero_action) = sample.actions[idx + 1..]
                        .iter()
                        .find(|a| a.player_name == sample.hero_name &&
                            (is_voluntary_preflop_action(&a.action_type) || matches!(a.action_type.as_str(), "fold" | "check")))
                    {
                        fold_to_three_bet_opportunities += 1;
                        if next_hero_action.action_type == "fold" {
                            fold_to_three_bet_count += 1;
                        }
                    }
                    break;
                }
            }

            if aggressive_count == 0 && hero_action {
                hero_opened = true;
            }
            aggressive_count += 1;
        }
        three_bet_opportunities += i64::from(three_bet_opportunity);
        three_bet_count += i64::from(made_three_bet);
    }

    let mut stats = CoachFormatStats {
        hands,
        vpip_count,
        vpip_pct: pct(vpip_count, hands),
        pfr_count,
        pfr_pct: pct(pfr_count, hands),
        three_bet_count,
        three_bet_opportunities,
        three_bet_pct: pct(three_bet_count, three_bet_opportunities),
        limp_count,
        limp_pct: pct(limp_count, hands),
        fold_to_three_bet_count,
        fold_to_three_bet_opportunities,
        fold_to_three_bet_pct: pct(fold_to_three_bet_count, fold_to_three_bet_opportunities),
        feedback: Vec::new(),
    };

    stats.feedback = build_preflop_feedback(player_count, &stats);
    stats
}

fn compute_preflop_stats_with_filter<F>(samples: &[PreflopHandSample], predicate: F) -> CoachFormatStats
where
    F: Fn(&PreflopHandSample) -> bool,
{
    let filtered: Vec<PreflopHandSample> = samples
        .iter()
        .filter(|sample| predicate(sample))
        .cloned()
        .collect();

    if filtered.is_empty() {
        return CoachFormatStats {
            hands: 0,
            vpip_count: 0,
            vpip_pct: 0.0,
            pfr_count: 0,
            pfr_pct: 0.0,
            three_bet_count: 0,
            three_bet_opportunities: 0,
            three_bet_pct: 0.0,
            limp_count: 0,
            limp_pct: 0.0,
            fold_to_three_bet_count: 0,
            fold_to_three_bet_opportunities: 0,
            fold_to_three_bet_pct: 0.0,
            feedback: vec!["Aucune main sur ce segment.".to_string()],
        };
    }

    let player_count = filtered[0].player_count;
    compute_preflop_stats(&filtered, player_count)
}

pub fn get_coach_stats(
    conn: &Connection,
    from_ts: Option<&str>,
    to_ts: Option<&str>,
    buy_ins: &[f64],
) -> Result<CoachStatsSnapshot, rusqlite::Error> {
    let buy_ins_json = serde_json::to_string(buy_ins)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    let mut stmt = conn.prepare(
        r#"SELECT h.id,
                  h.player_count,
                  h.level,
                  hp.player_name,
                  a.player_name,
                  a.action_type,
                  a.action_index
           FROM hands h
           JOIN hand_players hp ON hp.hand_id = h.id AND hp.hero = 1
           LEFT JOIN hand_actions a ON a.hand_id = h.id AND a.street_order = 0
           WHERE h.player_count IN (2, 3)
             AND h.tournament_id IN (
                 SELECT t.id FROM tournaments t
                 WHERE (?1 IS NULL OR julianday(t.started_at) >= julianday(?1))
                   AND (?2 IS NULL OR julianday(t.started_at) <= julianday(?2))
                   AND (json_array_length(?3) = 0 OR ROUND(t.buy_in_euros + t.rake_euros, 6)
                        IN (SELECT value FROM json_each(?3)))
             )
           ORDER BY h.id ASC, a.action_index ASC"#,
    )?;

    let rows: Vec<(String, i64, i64, String, Option<String>, Option<String>)> = stmt
        .query_map(params![from_ts, to_ts, buy_ins_json], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            ))
        })?
        .collect::<Result<_, _>>()?;

    let mut grouped: BTreeMap<String, PreflopHandSample> = BTreeMap::new();
    for (hand_id, player_count, level, hero_name, action_player, action_type) in rows {
        let sample = grouped.entry(hand_id).or_insert_with(|| PreflopHandSample {
            player_count,
            level,
            hero_name: hero_name.clone(),
            actions: Vec::new(),
        });

        if let (Some(player_name), Some(action_type)) = (action_player, action_type) {
            sample.actions.push(PreflopActionSample { player_name, action_type });
        }
    }

    let samples: Vec<PreflopHandSample> = grouped.into_values().collect();

    Ok(CoachStatsSnapshot {
        early_phase: compute_preflop_stats_with_filter(&samples, |sample| sample.player_count == 3 && sample.level <= 3),
        mid_phase: compute_preflop_stats_with_filter(&samples, |sample| sample.player_count == 3 && sample.level >= 4 && sample.level <= 6),
        late_phase: compute_preflop_stats_with_filter(&samples, |sample| sample.player_count == 3 && sample.level >= 7),
        heads_up: compute_preflop_stats(&samples, 2),
    })
}

/// List tournaments newest first. An omitted limit returns all tournaments.
pub fn list_tournaments(
    conn: &Connection,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<Vec<TournamentRow>, rusqlite::Error> {
    let lim = limit.map(|value| value as i64);
    let off = offset.unwrap_or(0) as i64;

    // The imports do not store payout ladders. Only use confirmed winner-takes-all
    // ranges for known formats (Winamax Expresso and Betclic Spin & Rush).
    let calculated = "hp.net_ev IS NOT NULL AND hp.allin_equity BETWEEN 0.0 AND 1.0";
    let eligible = format!(
        r#"{calculated} AND hp.starting_stack > 0 AND t.registered_players = 3
           AND t.prizepool_euros > 0 AND t.buy_in_euros + t.rake_euros > 0
           AND ABS(t.prizepool_euros - t.multiplier * (t.buy_in_euros + t.rake_euros)) < 0.005
           AND (
               (h.table_name LIKE 'Expresso(%' AND t.multiplier IN (2, 3, 4, 5, 10, 20))
            OR ((h.game_name = 'Spin & Rush' COLLATE NOCASE OR h.game_name LIKE 'Spin & Rush %')
                AND t.multiplier IN (2, 3, 4, 5, 10))
           )"#,
    );
    let mut stmt = conn.prepare(&format!(
        r#"SELECT t.id, t.player_name, t.buy_in_euros, t.prizepool_euros,
                  t.multiplier, t.finish_position, t.started_at,
                  t.duration_secs, t.net_eur,
                  COUNT(h.id) as hand_count,
                COALESCE(SUM(COALESCE(hp.net_ev, hp.realized_cev)), 0) as hero_cev_sum,
                SUM(CASE WHEN {eligible}
                         THEN (CAST(hp.net_ev AS REAL) - hp.realized_cev) * t.prizepool_euros /
                              NULLIF((SELECT SUM(hp2.starting_stack) FROM hand_players hp2 WHERE hp2.hand_id = h.id), 0)
                    END) as all_in_correction_eur,
                COUNT(CASE WHEN {eligible} THEN 1 END) as adjusted_all_in_count,
                COUNT(CASE WHEN {calculated} THEN 1 END) as calculated_all_in_count,
                COALESCE(SUM(CASE WHEN NOT {HERO_SHOWDOWN_SQL} THEN hp.realized_cev ELSE 0 END), 0) as wsd_cev_sum,
                COALESCE(SUM(CASE WHEN {HERO_SHOWDOWN_SQL} THEN hp.realized_cev ELSE 0 END), 0) as sd_cev_sum,
                t.rake_euros
           FROM tournaments t
           LEFT JOIN hands h ON h.tournament_id = t.id
           LEFT JOIN hand_players hp ON hp.hand_id = h.id AND hp.hero = 1
           GROUP BY t.id
           ORDER BY t.started_at DESC
           LIMIT COALESCE(?1, -1) OFFSET ?2"#,
    ))?;

    let rows = stmt.query_map(params![lim, off], |row| {
        Ok(TournamentRow {
            id: row.get(0)?,
            player_name: row.get(1)?,
            buy_in_euros: row.get(2)?,
            prizepool_euros: row.get(3)?,
            multiplier: row.get(4)?,
            finish_position: row.get(5)?,
            started_at: row.get(6)?,
            duration_secs: row.get(7)?,
            net_eur: row.get(8)?,
            hand_count: row.get(9)?,
            hero_cev_sum: row.get(10)?,
            all_in_correction_eur: row.get(11)?,
            adjusted_all_in_count: row.get(12)?,
            calculated_all_in_count: row.get(13)?,
            wsd_cev_sum: row.get(14)?,
            sd_cev_sum: row.get(15)?,
            rake_euros: row.get(16)?,
        })
    })?;

    rows.collect()
}

#[cfg(test)]
mod tournament_listing_tests {
    use super::list_tournaments;
    use rusqlite::{params, Connection};

    fn create_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open database");
        conn.execute_batch(
            r#"
            CREATE TABLE tournaments (
                id TEXT PRIMARY KEY,
                player_name TEXT NOT NULL,
                buy_in_euros REAL NOT NULL,
                rake_euros REAL NOT NULL DEFAULT 0,
                prizepool_euros REAL NOT NULL,
                multiplier INTEGER NOT NULL,
                registered_players INTEGER NOT NULL DEFAULT 3,
                finish_position INTEGER NOT NULL,
                started_at TEXT NOT NULL,
                duration_secs INTEGER NOT NULL,
                net_eur REAL NOT NULL
            );
            CREATE TABLE hands (
                id TEXT PRIMARY KEY,
                tournament_id TEXT NOT NULL,
                table_name TEXT NOT NULL DEFAULT '',
                game_name TEXT NOT NULL DEFAULT '',
                has_showdown INTEGER
            );
            CREATE TABLE hand_players (
                id INTEGER PRIMARY KEY,
                hand_id TEXT NOT NULL,
                player_name TEXT NOT NULL,
                hero INTEGER NOT NULL,
                net_ev INTEGER,
                allin_equity REAL,
                realized_cev INTEGER NOT NULL,
                starting_stack INTEGER NOT NULL
            );
            CREATE TABLE hand_actions (
                hand_id TEXT NOT NULL,
                player_name TEXT NOT NULL,
                action_type TEXT NOT NULL
            );
            "#,
        )
        .expect("create schema");
        conn
    }

    #[test]
    fn omitted_limit_returns_all_tournaments_and_explicit_limit_is_respected() {
        let conn = create_db();

        for index in 0..101 {
            conn.execute(
                "INSERT INTO tournaments (id, player_name, buy_in_euros, prizepool_euros, multiplier, finish_position, started_at, duration_secs, net_eur) VALUES (?1, 'MRZO', 2.0, 4.0, 2, 1, ?2, 300, 2.0)",
                params![format!("T{index:03}"), "2026-11-15T00:00:00Z"],
            )
            .expect("insert tournament");
        }

        let all = list_tournaments(&conn, None, None).expect("list all tournaments");
        assert_eq!(all.len(), 101);

        let limited = list_tournaments(&conn, Some(100), None).expect("list limited tournaments");
        assert_eq!(limited.len(), 100);
    }

    #[test]
    fn cash_adjustment_uses_only_calculated_all_ins_in_known_winner_takes_all_formats() {
        let conn = create_db();
        conn.execute_batch(
            r#"
            INSERT INTO tournaments
                (id, player_name, buy_in_euros, prizepool_euros, multiplier, finish_position, started_at, duration_secs, net_eur)
            VALUES
                ('spin', 'Hero', 2, 10, 5, 2, '2026-11-18', 300, -2),
                ('split', 'Hero', 2, 40, 20, 2, '2026-11-17', 300, -2),
                ('expresso', 'Hero', 2, 40, 20, 1, '2026-11-16', 300, 38),
                ('unknown', 'Hero', 2, 10, 5, 2, '2026-11-15', 300, -2);
            INSERT INTO hands (id, tournament_id, has_showdown, table_name, game_name) VALUES
                ('loss', 'spin', 1, 'Table 1', 'Spin & Rush 2€'),
                ('legacy', 'spin', 0, 'Table 1', 'Spin & Rush 2€'),
                ('equal', 'spin', 1, 'Table 1', 'Spin & Rush 2€'),
                ('jackpot', 'split', 1, 'Table 2', 'Spin & Rush 2€'),
                ('win', 'expresso', 1, 'Expresso(expresso)#0', 'Holdem no limit'),
                ('other', 'unknown', 1, 'Table 3', 'Unknown');
            INSERT INTO hand_players (hand_id, player_name, hero, net_ev, allin_equity, realized_cev, starting_stack)
            VALUES
                ('loss', 'Hero', 1, 200, 0.7, -400, 400),
                ('loss', 'Opponent', 0, NULL, NULL, 400, 1100),
                ('legacy', 'Hero', 1, -30, NULL, -30, 500),
                ('equal', 'Hero', 1, 0, 0.5, 0, 500),
                ('jackpot', 'Hero', 1, 200, 0.7, -400, 400),
                ('win', 'Hero', 1, 100, 0.6, 400, 1100),
                ('win', 'Opponent', 0, NULL, NULL, -400, 400),
                ('other', 'Hero', 1, 200, 0.7, -400, 400);
            "#,
        )
        .expect("seed results");

        let rows = list_tournaments(&conn, None, None).expect("tournaments");
        assert_eq!(rows[0].net_eur, -2.0);
        assert_eq!(rows[0].all_in_correction_eur, Some(4.0));
        assert_eq!(rows[0].adjusted_all_in_count, 2);
        assert_eq!(rows[0].calculated_all_in_count, 2);
        assert_eq!(rows[2].all_in_correction_eur, Some(-8.0));
        for row in [&rows[1], &rows[3]] {
            assert_eq!(row.all_in_correction_eur, None);
            assert_eq!(row.adjusted_all_in_count, 0);
            assert_eq!(row.calculated_all_in_count, 1);
        }
    }
}

/// List hands for a tournament.
pub fn list_hands_for_tournament(
    conn: &Connection,
    tournament_id: &str,
) -> Result<Vec<HandRow>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        r#"SELECT h.id, h.tournament_id, h.level, h.small_blind, h.big_blind,
                  h.timestamp, h.total_pot, h.seat_count,
                   hp.realized_cev, hp.collected, hp.net_ev, hp.allin_equity,
                  hc.card1 || ' ' || hc.card2,
                  (ic.sum_invariant AND ic.chip_conservation AND ic.pot_match),
                  CASE WHEN hp.net_ev IS NULL THEN NULL
                       ELSE CAST(hp.net_ev AS REAL) * t.prizepool_euros /
                            NULLIF((SELECT SUM(hp2.starting_stack) FROM hand_players hp2 WHERE hp2.hand_id = h.id), 0)
                   END AS net_ev_eur,
                   h.has_showdown,
                   h.hero_showed
           FROM hands h
           JOIN hand_players hp ON hp.hand_id = h.id AND hp.hero = 1
           JOIN tournaments t ON t.id = h.tournament_id
           LEFT JOIN hole_cards hc ON hc.hand_id = h.id
           LEFT JOIN invariant_checks ic ON ic.hand_id = h.id
           WHERE h.tournament_id = ?1
           ORDER BY h.timestamp ASC"#,
    )?;

    let rows = stmt.query_map(params![tournament_id], |row| {
        Ok(HandRow {
            id: row.get(0)?,
            tournament_id: row.get(1)?,
            level: row.get(2)?,
            small_blind: row.get(3)?,
            big_blind: row.get(4)?,
            timestamp: row.get(5)?,
            total_pot: row.get(6)?,
            seat_count: row.get(7)?,
            hero_cev: row.get(8)?,
            hero_collected: row.get(9)?,
            hero_net_ev: row.get(10)?,
            hero_allin_equity: row.get(11)?,
            hero_cards: row.get(12)?,
            invariants_ok: row.get::<_, i64>(13).map(|v| v != 0).unwrap_or(true),
            hero_net_ev_eur: row.get(14)?,
            has_showdown: row
                .get::<_, Option<i64>>(15)?
                .map(|v| v != 0),
            hero_showed: row
                .get::<_, Option<i64>>(16)?
                .map(|v| v != 0),
        })
    })?;

    rows.collect()
}

/// Get full detail for one hand.
pub fn get_hand_detail(
    conn: &Connection,
    hand_id: &str,
) -> Result<Option<HandDetail>, rusqlite::Error> {
    // Hand row
    let hand_opt: Option<HandRow> = conn
        .query_row(
            r#"SELECT h.id, h.tournament_id, h.level, h.small_blind, h.big_blind,
                      h.timestamp, h.total_pot, h.seat_count,
                      hp.realized_cev, hp.collected, hp.net_ev, hp.allin_equity,
                      hc.card1 || ' ' || hc.card2,
                      (ic.sum_invariant AND ic.chip_conservation AND ic.pot_match),
                      CASE WHEN hp.net_ev IS NULL THEN NULL
                           ELSE CAST(hp.net_ev AS REAL) * t.prizepool_euros /
                                NULLIF((SELECT SUM(hp2.starting_stack) FROM hand_players hp2 WHERE hp2.hand_id = h.id), 0)
                          END AS net_ev_eur,
                          h.has_showdown,
                          h.hero_showed
               FROM hands h
               JOIN hand_players hp ON hp.hand_id = h.id AND hp.hero = 1
               JOIN tournaments t ON t.id = h.tournament_id
               LEFT JOIN hole_cards hc ON hc.hand_id = h.id
               LEFT JOIN invariant_checks ic ON ic.hand_id = h.id
               WHERE h.id = ?1"#,
            params![hand_id],
            |row| {
                Ok(HandRow {
                    id: row.get(0)?,
                    tournament_id: row.get(1)?,
                    level: row.get(2)?,
                    small_blind: row.get(3)?,
                    big_blind: row.get(4)?,
                    timestamp: row.get(5)?,
                    total_pot: row.get(6)?,
                    seat_count: row.get(7)?,
                    hero_cev: row.get(8)?,
                    hero_collected: row.get(9)?,
                    hero_net_ev: row.get(10)?,
                    hero_allin_equity: row.get(11)?,
                    hero_cards: row.get(12)?,
                    invariants_ok: row.get::<_, i64>(13).map(|v| v != 0).unwrap_or(true),
                    hero_net_ev_eur: row.get(14)?,
                    has_showdown: row
                        .get::<_, Option<i64>>(15)?
                        .map(|v| v != 0),
                    hero_showed: row
                        .get::<_, Option<i64>>(16)?
                        .map(|v| v != 0),
                })
            },
        )
        .ok();

    let hand = match hand_opt {
        None => return Ok(None),
        Some(h) => h,
    };

    // Player rows
    let mut stmt = conn.prepare(
        r#"SELECT hp.seat_number, hp.player_name, hp.starting_stack, hp.ending_stack,
                hp.contributions, hp.collected, hp.realized_cev, hp.net_ev, hp.allin_equity, hp.hero,
                  hc.card1 || ' ' || hc.card2
           FROM hand_players hp
           LEFT JOIN hole_cards hc ON hc.hand_id = hp.hand_id AND hp.hero = 1
           WHERE hp.hand_id = ?1
           ORDER BY hp.seat_number"#,
    )?;

    let players: Vec<PlayerDetailRow> = stmt
        .query_map(params![hand_id], |row| {
            Ok(PlayerDetailRow {
                seat_number: row.get(0)?,
                player_name: row.get(1)?,
                starting_stack: row.get(2)?,
                ending_stack: row.get(3)?,
                contributions: row.get(4)?,
                collected: row.get(5)?,
                realized_cev: row.get(6)?,
                net_ev: row.get(7)?,
                allin_equity: row.get(8)?,
                hero: row.get::<_, i64>(9).map(|v| v != 0)?,
                hole_cards: row.get(10)?,
            })
        })?
        .collect::<Result<_, _>>()?;

    // Action timeline rows
    let mut act_stmt = conn.prepare(
        r#"SELECT street, action_index, player_name, action_type,
                  amount, increment_amount, to_amount
           FROM hand_actions
           WHERE hand_id = ?1
           ORDER BY street_order ASC, action_index ASC"#,
    )?;

    let actions: Vec<ActionRow> = act_stmt
        .query_map(params![hand_id], |row| {
            Ok(ActionRow {
                street: row.get(0)?,
                action_index: row.get(1)?,
                player_name: row.get(2)?,
                action_type: row.get(3)?,
                amount: row.get(4)?,
                increment_amount: row.get(5)?,
                to_amount: row.get(6)?,
            })
        })?
        .collect::<Result<_, _>>()?;

    Ok(Some(HandDetail { hand, players, actions }))
}

/// Aggregate stats across all imported data.
pub fn get_session_stats(conn: &Connection) -> Result<SessionStats, rusqlite::Error> {
    let (total_tournaments, total_net_eur, wins, second, third): (i64, f64, i64, i64, i64) =
        conn.query_row(
            r#"SELECT
                COUNT(*),
                COALESCE(SUM(net_eur), 0.0),
                SUM(CASE WHEN finish_position = 1 THEN 1 ELSE 0 END),
                SUM(CASE WHEN finish_position = 2 THEN 1 ELSE 0 END),
                SUM(CASE WHEN finish_position = 3 THEN 1 ELSE 0 END)
               FROM tournaments"#,
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )?;

    let total_hands: i64 = conn.query_row(
        "SELECT COUNT(*) FROM hands",
        [],
        |r| r.get(0),
    )?;

    let avg = if total_tournaments > 0 {
        total_net_eur / total_tournaments as f64
    } else {
        0.0
    };

    // Multiplier distribution
    let mut stmt = conn.prepare(
        "SELECT multiplier, COUNT(*) FROM tournaments GROUP BY multiplier ORDER BY multiplier",
    )?;
    let multiplier_dist: Vec<(i64, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;

    Ok(SessionStats {
        total_tournaments,
        total_hands,
        total_net_eur,
        avg_net_eur_per_tournament: avg,
        wins,
        second_place: second,
        third_place: third,
        multiplier_dist,
    })
}

/// Load a hand with action timeline for replay visualization.
pub fn load_hand_for_replay(
    conn: &Connection,
    hand_id: &str,
) -> Result<Option<ReplayerState>, rusqlite::Error> {
    // Load hand info
    let hand_info = conn
        .query_row(
            r#"SELECT h.id, h.tournament_id, h.table_name, h.timestamp, h.level,
                      h.small_blind, h.big_blind, h.button_seat, COALESCE(h.board_cards, '[]')
               FROM hands h
               WHERE h.id = ?1"#,
            params![hand_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, String>(8)?,
                ))
            },
        )
        .ok();

    let (hand_id_val, tournament_id, table_name, timestamp, level, sb, bb, button_seat, board_cards_json) =
        match hand_info {
            None => return Ok(None),
            Some(h) => h,
        };

    let board: Vec<String> = serde_json::from_str(&board_cards_json).unwrap_or_default();

    // Load all players for this hand
    let mut players_stmt = conn.prepare(
         r#"SELECT hp.seat_number,
                hp.player_name,
              hp.hero,
                hp.starting_stack,
                hp.ending_stack,
                hp.contributions,
                COALESCE(
                    shc.card1 || ' ' || shc.card2,
                    hc.card1 || ' ' || hc.card2
                ) AS hole_cards
            FROM hand_players hp
            LEFT JOIN hole_cards hc ON hc.hand_id = hp.hand_id AND hc.player_name = hp.player_name
            LEFT JOIN showdown_hole_cards shc ON shc.hand_id = hp.hand_id AND shc.player_name = hp.player_name
           WHERE hp.hand_id = ?1
           ORDER BY hp.seat_number"#,
    )?;

    let players_map: std::collections::HashMap<String, (ReplayerPlayer, i64)> = players_stmt
        .query_map(params![hand_id], |row| {
            let seat: i64 = row.get(0)?;
            let name: String = row.get(1)?;
            let is_hero: i64 = row.get(2)?;
            let starting: i64 = row.get(3)?;
            let contributions: i64 = row.get(5)?;
            let hole_card_str: Option<String> = row.get(6)?;

            Ok((
                name.clone(),
                (
                    ReplayerPlayer {
                        seat_number: seat,
                        name,
                        hero: is_hero != 0,
                        starting_stack: starting,
                        current_stack: starting,
                        hole_cards: hole_card_str,
                        folded: false,
                    },
                    contributions,
                ),
            ))
        })?
        .collect::<Result<_, _>>()?;

    let total_contributions: i64 = players_map.values().map(|(_, c)| *c).sum();

    let mut players_vec: Vec<ReplayerPlayer> = players_map
        .values()
        .map(|(p, _)| p.clone())
        .collect();
    players_vec.sort_by_key(|p| p.seat_number);

    let button_pos = usize::try_from(button_seat).unwrap_or(0);

    // Load all actions for this hand
    let mut actions_stmt = conn.prepare(
        r#"SELECT street_order, street, action_index, player_name, action_type,
                  amount, increment_amount, to_amount
           FROM hand_actions
           WHERE hand_id = ?1
           ORDER BY street_order ASC, action_index ASC"#,
    )?;

    let raw_actions: Vec<(i64, String, i64, String, String, Option<i64>, Option<i64>, Option<i64>)> =
        actions_stmt
            .query_map(params![hand_id], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                ))
            })?
            .collect::<Result<_, _>>()?;

    fn format_replay_description(
        actor_name: &str,
        action_type: &str,
        amount: Option<i64>,
        increment_amount: Option<i64>,
        to_amount: Option<i64>,
    ) -> String {
        match action_type {
            "fold" => format!("{} fold", actor_name),
            "check" => format!("{} check", actor_name),
            "call" => format!("{} call {}", actor_name, amount.unwrap_or(0)),
            "bet" => format!("{} bet {}", actor_name, amount.unwrap_or(0)),
            "raise" => format!(
                "{} raise {} to {}",
                actor_name,
                increment_amount.unwrap_or(0),
                to_amount.unwrap_or(0)
            ),
            "collect" => format!("{} collect {}", actor_name, amount.unwrap_or(0)),
            "allin_call" => format!("{} all-in call {}", actor_name, amount.unwrap_or(0)),
            "allin_bet" => format!("{} all-in bet {}", actor_name, amount.unwrap_or(0)),
            "allin_raise" => format!(
                "{} all-in raise {} to {}",
                actor_name,
                increment_amount.unwrap_or(0),
                to_amount.unwrap_or(0)
            ),
            _ => format!("{} {}", actor_name, action_type),
        }
    }

    // Build replayer steps (with stacks at each step)
    let mut steps: Vec<ReplayerStep> = Vec::new();
    let mut player_stacks: std::collections::HashMap<String, ReplayerPlayer> = players_map
        .iter()
        .map(|(name, (player, _))| (name.clone(), player.clone()))
        .collect();

    let mut street_bets: std::collections::HashMap<String, i64> = player_stacks
        .keys()
        .map(|name| (name.clone(), 0_i64))
        .collect();
    let mut current_street = String::from("preflop");
    let mut current_bet = 0_i64;

    fn as_delta_non_negative(value: i64) -> i64 {
        value.max(0)
    }
    let mut seen_streets: std::collections::HashSet<String> = std::collections::HashSet::new();

    for (step_num, (_street_order, street, _action_idx, actor_name, action_type, amount, incr, to_amt)) in
        raw_actions.iter().enumerate()
    {
        if street.to_ascii_lowercase() != current_street {
            current_street = street.to_ascii_lowercase();
            current_bet = 0;
            for bet in street_bets.values_mut() {
                *bet = 0;
            }
        }

        seen_streets.insert(street.to_ascii_lowercase());
        let description = format_replay_description(actor_name, action_type, *amount, *incr, *to_amt);

        // Update player state for the action that just happened.
        if let Some(player) = player_stacks.get_mut(actor_name) {
            let already_in_street = *street_bets.get(actor_name).unwrap_or(&0);
            match action_type.as_str() {
                "fold" => {
                    player.folded = true;
                }

                "check" => {}

                "call" | "allin_call" => {
                    let target = current_bet;
                    let delta = as_delta_non_negative(target - already_in_street);
                    player.current_stack = (player.current_stack - delta).max(0);
                    street_bets.insert(actor_name.clone(), already_in_street + delta);
                }

                "bet" | "allin_bet" => {
                    let target = amount.unwrap_or(0);
                    let delta = as_delta_non_negative(target - already_in_street);
                    player.current_stack = (player.current_stack - delta).max(0);
                    street_bets.insert(actor_name.clone(), already_in_street + delta);
                    current_bet = current_bet.max(target);
                }

                "raise" | "allin_raise" => {
                    let target = to_amt
                        .or_else(|| incr.map(|inc| current_bet + inc))
                        .unwrap_or(current_bet);
                    let delta = as_delta_non_negative(target - already_in_street);
                    player.current_stack = (player.current_stack - delta).max(0);
                    street_bets.insert(actor_name.clone(), already_in_street + delta);
                    current_bet = current_bet.max(target);
                }

                "collect" => {
                    player.current_stack += amount.unwrap_or(0);
                }
                _ => {}
            }
        }

        let mut players_after: Vec<ReplayerPlayer> = player_stacks.values().cloned().collect();
        players_after.sort_by_key(|player| player.seat_number);

        // Keep pot constant at final hand contributions to avoid transient double-counting display.
        let pot_size_after = total_contributions;

        steps.push(ReplayerStep {
            step_number: step_num,
            street: street.clone(),
            actor_name: actor_name.clone(),
            action_type: action_type.clone(),
            amount: *amount,
            increment_amount: *incr,
            to_amount: *to_amt,
            pot_size_after,
            players_after,
            description,
        });
    }

    let mut append_board_reveal_step = |street_name: &str, revealed_cards: &[String]| {
        if revealed_cards.is_empty() {
            return;
        }

        let mut players_after: Vec<ReplayerPlayer> = player_stacks.values().cloned().collect();
        players_after.sort_by_key(|player| player.seat_number);

        let pot_size_after = total_contributions;

        steps.push(ReplayerStep {
            step_number: steps.len(),
            street: street_name.to_string(),
            actor_name: "Board".to_string(),
            action_type: "board_reveal".to_string(),
            amount: None,
            increment_amount: None,
            to_amount: None,
            pot_size_after,
            players_after,
            description: format!("Board {}: {}", street_name, revealed_cards.join(" ")),
        });
    };

    // Some all-in preflop hands have no explicit postflop actions in the DB.
    // Add synthetic reveal steps so replay can still progress through the full board.
    if board.len() >= 3 && !seen_streets.contains("flop") {
        append_board_reveal_step("flop", &board[..3]);
    }
    if board.len() >= 4 && !seen_streets.contains("turn") {
        append_board_reveal_step("turn", &board[..4]);
    }
    if board.len() >= 5 && !seen_streets.contains("river") {
        append_board_reveal_step("river", &board[..5]);
    }

    // Update players vec with final state from steps
    for (name, player) in player_stacks.iter() {
        if let Some(p) = players_vec.iter_mut().find(|x| x.name == *name) {
            p.current_stack = player.current_stack;
            p.folded = player.folded;
        }
    }

    Ok(Some(ReplayerState {
        hand_id: hand_id_val,
        tournament_id,
        table_name,
        timestamp,
        level,
        small_blind: sb,
        big_blind: bb,
        players: players_vec,
        button_pos,
        board,
        current_step: 0,
        total_steps: steps.len(),
        steps,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed(conn: &Connection) {
        conn.execute_batch(
            r#"
            CREATE TABLE tournaments (
              id TEXT PRIMARY KEY,
              player_name TEXT NOT NULL,
              buy_in_euros REAL NOT NULL,
              rake_euros REAL NOT NULL,
              prizepool_euros REAL NOT NULL,
              multiplier INTEGER NOT NULL,
              registered_players INTEGER NOT NULL,
              finish_position INTEGER NOT NULL,
              started_at TEXT NOT NULL,
              duration_secs INTEGER NOT NULL,
              net_eur REAL NOT NULL
            );

            CREATE TABLE hands (
              id TEXT PRIMARY KEY,
              tournament_id TEXT NOT NULL,
              table_name TEXT NOT NULL,
              game_name TEXT NOT NULL,
              buy_in_euros REAL NOT NULL,
              rake_euros REAL NOT NULL,
              level INTEGER NOT NULL,
              small_blind INTEGER NOT NULL,
              big_blind INTEGER NOT NULL,
              button_seat INTEGER NOT NULL,
              seat_count INTEGER NOT NULL,
              timestamp TEXT NOT NULL,
              player_count INTEGER NOT NULL,
                            board_cards TEXT,
                            has_showdown INTEGER,
                            hero_showed INTEGER,
              rake_chips INTEGER NOT NULL,
              total_pot INTEGER NOT NULL
            );

            CREATE TABLE hand_players (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              hand_id TEXT NOT NULL,
              seat_number INTEGER NOT NULL,
              player_name TEXT NOT NULL,
              starting_stack INTEGER NOT NULL,
              ending_stack INTEGER NOT NULL,
              contributions INTEGER NOT NULL,
              collected INTEGER NOT NULL,
              realized_cev INTEGER NOT NULL,
                            net_ev INTEGER,
                            allin_equity REAL,
              hero INTEGER NOT NULL
            );

            CREATE TABLE hole_cards (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              hand_id TEXT NOT NULL,
              player_name TEXT NOT NULL,
              card1 TEXT NOT NULL,
              card2 TEXT NOT NULL
            );

                        CREATE TABLE showdown_hole_cards (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            hand_id TEXT NOT NULL,
                            player_name TEXT NOT NULL,
                            card1 TEXT NOT NULL,
                            card2 TEXT NOT NULL
                        );

            CREATE TABLE invariant_checks (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              hand_id TEXT NOT NULL,
              sum_invariant INTEGER NOT NULL,
              chip_conservation INTEGER NOT NULL,
              pot_match INTEGER NOT NULL,
              errors_json TEXT
            );

                        CREATE TABLE hand_actions (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            hand_id TEXT NOT NULL,
                            street_order INTEGER NOT NULL,
                            street TEXT NOT NULL,
                            action_index INTEGER NOT NULL,
                            player_name TEXT NOT NULL,
                            action_type TEXT NOT NULL,
                            amount INTEGER,
                            increment_amount INTEGER,
                            to_amount INTEGER
                        );
            "#,
        )
        .expect("schema");

        conn.execute(
            "INSERT INTO tournaments (id, player_name, buy_in_euros, rake_euros, prizepool_euros, multiplier, registered_players, finish_position, started_at, duration_secs, net_eur) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params!["T1", "MRZO", 1.86_f64, 0.14_f64, 4.0_f64, 2_i64, 3_i64, 1_i64, "2026-06-09T13:52:25Z", 300_i64, 2.0_f64],
        ).expect("insert tournament");

        conn.execute(
            "INSERT INTO hands (id, tournament_id, table_name, game_name, buy_in_euros, rake_euros, level, small_blind, big_blind, button_seat, seat_count, timestamp, player_count, board_cards, rake_chips, total_pot) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            params!["H29", "T1", "Expresso(T1)#0", "Holdem no limit", 1.86_f64, 0.14_f64, 4_i64, 30_i64, 60_i64, 1_i64, 2_i64, "2026-06-09T13:52:25Z", 2_i64, r#"["Qs","3d","8h","7c","Ah"]"#, 0_i64, 1500_i64],
        ).expect("insert hand");

        conn.execute(
            "INSERT INTO hand_players (hand_id, seat_number, player_name, starting_stack, ending_stack, contributions, collected, realized_cev, net_ev, allin_equity, hero) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params!["H29", 1_i64, "Cocochanel23", 825_i64, 150_i64, 825_i64, 150_i64, -675_i64, Option::<i64>::None, Option::<f64>::None, 0_i64],
        ).expect("insert villain");

        conn.execute(
            "INSERT INTO hand_players (hand_id, seat_number, player_name, starting_stack, ending_stack, contributions, collected, realized_cev, net_ev, allin_equity, hero) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params!["H29", 2_i64, "MRZO", 675_i64, 1350_i64, 675_i64, 1350_i64, 675_i64, Some(296_i64), Some(0.719_f64), 1_i64],
        ).expect("insert hero");

        conn.execute(
            "INSERT INTO hole_cards (hand_id, player_name, card1, card2) VALUES (?1, ?2, ?3, ?4)",
            params!["H29", "MRZO", "Jd", "Kd"],
        ).expect("insert cards");

        conn.execute(
            "INSERT INTO showdown_hole_cards (hand_id, player_name, card1, card2) VALUES (?1, ?2, ?3, ?4)",
            params!["H29", "Cocochanel23", "As", "Qc"],
        ).expect("insert showdown cards");

        conn.execute(
            "INSERT INTO invariant_checks (hand_id, sum_invariant, chip_conservation, pot_match, errors_json) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["H29", 1_i64, 1_i64, 1_i64, Option::<String>::None],
        ).expect("insert invariants");

        conn.execute(
            "INSERT INTO hand_actions (hand_id, street_order, street, action_index, player_name, action_type, amount, increment_amount, to_amount) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params!["H29", 0_i64, "preflop", 0_i64, "Cocochanel23", "allin_raise", Option::<i64>::None, Some(765_i64), Some(825_i64)],
        ).expect("insert action 1");

        conn.execute(
            "INSERT INTO hand_actions (hand_id, street_order, street, action_index, player_name, action_type, amount, increment_amount, to_amount) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params!["H29", 0_i64, "preflop", 1_i64, "MRZO", "allin_call", Some(615_i64), Option::<i64>::None, Option::<i64>::None],
        ).expect("insert action 2");
    }

    #[test]
    fn preflop_matchups_include_covered_shoves_but_not_later_allins_or_betting() {
        let conn = Connection::open_in_memory().expect("open database");
        seed(&conn);
        let hands = list_preflop_matchups(&conn).expect("preflop matchup");
        assert_eq!(hands.len(), 1);
        assert_eq!(hands[0].hero_cards.as_deref(), Some("Jd Kd"));
        assert_eq!(hands[0].opponents[0].cards.as_deref(), Some("As Qc"));
        assert_eq!(hands[0].realized_cev, 675);
        assert_eq!(hands[0].net_ev, Some(296));
        conn.execute_batch(
            "UPDATE hand_actions SET action_type = 'call' WHERE player_name = 'MRZO';
             UPDATE hand_players SET net_ev = realized_cev, allin_equity = NULL WHERE hero = 1;",
        ).expect("covered shove without calculated equity");
        let hands = list_preflop_matchups(&conn).expect("keep covered shove");
        assert_eq!(hands.len(), 1);
        assert_eq!(hands[0].allin_equity, None);
        conn.execute("UPDATE hand_actions SET street_order = 1", []).expect("move all-in to flop");
        assert!(list_preflop_matchups(&conn).expect("exclude flop").is_empty());
        conn.execute_batch(
            "UPDATE hand_actions SET street_order = 0;
             INSERT INTO hand_actions (hand_id, street_order, street, action_index, player_name, action_type, amount)
             VALUES ('H29', 1, 'flop', 0, 'MRZO', 'bet', 10);",
        ).expect("later betting");
        assert!(list_preflop_matchups(&conn).expect("exclude unlocked pot").is_empty());
    }

    #[test]
    fn preflop_matchups_group_opponents_once_and_distinguish_folded_players_from_contenders() {
        let conn = Connection::open_in_memory().expect("open database");
        seed(&conn);
        conn.execute_batch(
            "INSERT INTO hand_players (hand_id, seat_number, player_name, starting_stack, ending_stack,
                                       contributions, collected, realized_cev, hero)
             VALUES ('H29', 3, 'Third', 500, 480, 20, 0, -20, 0);
             INSERT INTO hand_actions (hand_id, street_order, street, action_index, player_name, action_type)
             VALUES ('H29', 0, 'preflop', 2, 'Third', 'fold');",
        ).expect("folded blind");
        let hands = list_preflop_matchups(&conn).expect("duel");
        assert_eq!(hands.len(), 1);
        assert_eq!(hands[0].opponents.len(), 1);
        assert_eq!(hands[0].total_starting_chips, 2000);
        conn.execute_batch(
            "UPDATE hand_actions SET action_type = 'allin_call' WHERE player_name = 'Third';
             INSERT INTO showdown_hole_cards (hand_id, player_name, card1, card2)
             VALUES ('H29', 'Third', 'Ah', '2h');",
        ).expect("three-way pot");
        let hands = list_preflop_matchups(&conn).expect("multiway");
        assert_eq!(hands.len(), 1);
        assert_eq!(hands[0].opponents.len(), 2);
        conn.execute("DELETE FROM showdown_hole_cards WHERE player_name = 'Third'", [])
            .expect("unknown third player's cards");
        let hands = list_preflop_matchups(&conn).expect("keep missing-card coverage");
        assert_eq!(hands[0].opponents[1].cards, None);
        assert!(hands[0].duel.is_none());
    }

    #[test]
    fn preflop_duels_classify_showdown_instead_of_net_profit_and_remove_guaranteed_pots() {
        let conn = Connection::open_in_memory().expect("open database");
        seed(&conn);
        conn.execute_batch(
            "UPDATE hand_players SET starting_stack = 1000, contributions = 500,
                collected = 800, realized_cev = 300, allin_equity = 875.0 / 1100 WHERE hero = 1;
             UPDATE hand_players SET starting_stack = 100, contributions = 100,
                collected = 300 WHERE hero = 0;
             INSERT INTO hand_players (hand_id, seat_number, player_name, starting_stack, ending_stack,
                contributions, collected, realized_cev, hero)
                VALUES ('H29', 3, 'Third', 1000, 500, 500, 0, -500, 0);
             INSERT INTO hand_actions (hand_id, street_order, street, action_index, player_name, action_type)
                VALUES ('H29', 0, 'preflop', 2, 'Third', 'fold');
             UPDATE hands SET total_pot = 1100;",
        ).expect("duel with guaranteed side pot");
        let hands = list_preflop_matchups(&conn).expect("duel");
        let duel = hands[0].duel.as_ref().expect("duel metadata");
        assert_eq!(duel.hero_starting_stack, 1000);
        assert_eq!(duel.villain_starting_stack, 100);
        assert!(hands[0].realized_cev > 0);
        assert_eq!(duel.outcome, Some(DuelOutcome::Loss));
        assert!((duel.hero_equity.expect("contested equity") - 0.25).abs() < 1e-9);
        assert!(duel.issues.is_empty());

        conn.execute_batch(
            "UPDATE hand_players SET contributions = 99 WHERE player_name = 'Third';
             UPDATE hand_players SET collected = 550, allin_equity = 549.5 / 699 WHERE hero = 1;
             UPDATE hand_players SET collected = 149 WHERE player_name = 'Cocochanel23';
             UPDATE hands SET total_pot = 699;",
        ).expect("split with an odd chip and guaranteed side pot");
        let hands = list_preflop_matchups(&conn).expect("split");
        let duel = hands[0].duel.as_ref().expect("duel metadata");
        assert_eq!(duel.outcome, Some(DuelOutcome::Split));
        assert!((duel.hero_equity.expect("split equity") - 0.5).abs() < 1e-9);

        conn.execute_batch(
            "UPDATE hand_players SET contributions = 500 WHERE player_name = 'Third';
             UPDATE hand_players SET starting_stack = 100, contributions = 100,
                collected = 300, realized_cev = 200, allin_equity = 75.0 / 1100 WHERE hero = 1;
             UPDATE hand_players SET starting_stack = 1000, contributions = 500,
                collected = 800 WHERE player_name = 'Cocochanel23';
             UPDATE hands SET total_pot = 1100;",
        ).expect("villain owns the guaranteed side pot");
        let hands = list_preflop_matchups(&conn).expect("covered hero wins the duel");
        let duel = hands[0].duel.as_ref().expect("duel metadata");
        assert!(duel.hero_starting_stack < duel.villain_starting_stack);
        assert_eq!(duel.outcome, Some(DuelOutcome::Win));
        assert!((duel.hero_equity.expect("covered hero equity") - 0.25).abs() < 1e-9);
        assert!(duel.issues.is_empty());
    }

    #[test]
    fn preflop_duels_keep_missing_equity_separate_from_known_results_and_report_invalid_pots() {
        let conn = Connection::open_in_memory().expect("open database");
        seed(&conn);
        conn.execute("UPDATE hand_players SET allin_equity = NULL WHERE hero = 1", [])
            .expect("missing equity");
        let hands = list_preflop_matchups(&conn).expect("duel");
        let duel = hands[0].duel.as_ref().expect("duel metadata");
        assert_eq!(duel.hero_equity, None);
        assert_eq!(duel.outcome, Some(DuelOutcome::Win));
        conn.execute("UPDATE hands SET total_pot = total_pot + 1", []).expect("invalid pot");
        let hands = list_preflop_matchups(&conn).expect("keep unavailable duel");
        let duel = hands[0].duel.as_ref().expect("duel metadata");
        assert_eq!(duel.outcome, None);
        assert_eq!(duel.hero_equity, None);
        assert!(!duel.issues.is_empty());
    }

    #[test]
    fn chip_evolution_returns_only_hero_cards_and_keeps_hands_without_cards() {
        let conn = Connection::open_in_memory().expect("open database");
        seed(&conn);
        conn.execute(
            "INSERT INTO hole_cards (hand_id, player_name, card1, card2) VALUES ('H29', 'Cocochanel23', 'As', 'Qc')",
            [],
        ).expect("insert opponent cards");
        let points = get_chip_evolution(&conn).expect("hero cards");
        assert_eq!(points.len(), 1);
        assert_eq!(points[0].hero_cards.as_deref(), Some("Jd Kd"));
        assert_eq!(points[0].big_blind, 60);
        assert_eq!(points[0].player_count, 2);
        assert_eq!(points[0].hero_starting_stack, 675);
        assert_eq!(points[0].hero_stack_bucket, Some(1));

        conn.execute("DELETE FROM hole_cards WHERE player_name = 'MRZO'", [])
            .expect("remove unavailable hero cards");
        let points = get_chip_evolution(&conn).expect("keep hand without hero cards");
        assert_eq!(points.len(), 1);
        assert_eq!(points[0].hero_cards, None);
        assert_eq!(points[0].net_ev, Some(296));
    }

    #[test]
    fn stack_stats_keep_unique_hands_chip_units_and_missing_action_denominators() {
        let conn = Connection::open_in_memory().expect("open database");
        seed(&conn);
        conn.execute_batch(
            r#"
            UPDATE hands SET has_showdown = 1;
            INSERT INTO hand_actions (hand_id, street_order, street, action_index, player_name, action_type, amount)
              VALUES ('H29', 0, 'preflop', -1, 'MRZO', 'post_big_blind', 60);
            INSERT INTO hands
              SELECT 'H30', tournament_id, table_name, game_name, buy_in_euros, rake_euros,
                     level, small_blind, 20, button_seat, seat_count, timestamp, player_count,
                     board_cards, 0, 0, rake_chips, total_pot FROM hands WHERE id = 'H29';
            INSERT INTO hand_players (hand_id, seat_number, player_name, starting_stack, ending_stack,
                                     contributions, collected, realized_cev, net_ev, allin_equity, hero)
              SELECT 'H30', seat_number, player_name, 240, ending_stack, contributions,
                     collected, -20, NULL, NULL, hero FROM hand_players WHERE hand_id = 'H29';
            "#,
        ).expect("seed missing preflop hand");
        let result = stacks::get_stack_stats(&conn, &["T1".into(), "T1".into()]).expect("stack statistics");
        assert_eq!(result.excluded_hands, 0);
        assert_eq!(result.groups.len(), 1);
        let group = &result.groups[0];
        assert_eq!((group.bucket, group.player_count, group.hands), (1, 2, 2));
        assert_eq!(group.preflop.hands, 1);
        assert_eq!(group.preflop.vpip_count, 1);
        assert_eq!(group.preflop.three_bet_opportunities, 1);
        assert_eq!(group.preflop.limp_count, 0);
        assert_eq!(group.missing_preflop_hands, 1);
        assert_eq!(group.missing_ev_hands, 1);
        assert_eq!(group.chips.net, 655.0);
        assert_eq!(group.chips.ev, 276.0);
        assert_eq!(group.chips.sd, 675.0);
        assert_eq!(group.chips.wsd, -20.0);
        assert_eq!(group.chips.sd_ev, 296.0);
        assert_eq!(group.chips.wsd_ev, -20.0);
        assert!((group.bb.ev - (296.0 / 60.0 - 1.0)).abs() < 1e-10);
        assert_eq!(group.bb.net, 10.25);
        assert!(stacks::get_stack_stats(&conn, &[]).expect("empty cohort").groups.is_empty());
        assert!(stacks::get_stack_stats(&conn, &["T2".into()]).expect("other cohort").groups.is_empty());

        conn.execute("UPDATE hands SET big_blind = 0 WHERE id = 'H30'", []).expect("invalid blind");
        conn.execute("UPDATE hand_players SET starting_stack = 0 WHERE hand_id = 'H29' AND hero = 1", []).expect("invalid stack");
        let invalid = stacks::get_stack_stats(&conn, &["T1".into()]).expect("explicit exclusions");
        assert_eq!(invalid.excluded_hands, 2);
        assert!(invalid.groups.is_empty());
    }

    #[test]
    fn preflop_counts_ignore_forced_blinds_and_include_limp_reraises() {
        let sample = |actions: &[(&str, &str)]| PreflopHandSample {
            player_count: 2, level: 1, hero_name: "Hero".into(),
            actions: actions.iter().map(|(player, action)| PreflopActionSample {
                player_name: (*player).into(), action_type: (*action).into(),
            }).collect(),
        };
        let samples = [
            sample(&[("Hero", "post_small_blind"), ("Villain", "post_big_blind"), ("Hero", "call"), ("Villain", "raise"), ("Hero", "allin_raise")]),
            sample(&[("Hero", "post_small_blind"), ("Hero", "raise"), ("Villain", "raise"), ("Hero", "fold")]),
            sample(&[("Hero", "post_big_blind"), ("Villain", "fold")]),
            sample(&[("Hero", "allin_raise"), ("Villain", "raise")]),
        ];
        let stats = compute_preflop_stats(&samples, 2);
        assert_eq!(stats.hands, 4);
        assert_eq!((stats.vpip_count, stats.pfr_count, stats.limp_count), (3, 3, 1));
        assert_eq!((stats.three_bet_count, stats.three_bet_opportunities), (1, 1));
        assert_eq!((stats.fold_to_three_bet_count, stats.fold_to_three_bet_opportunities), (1, 1));
    }

    #[test]
    fn coach_filters_paid_buy_in_and_whole_tournaments_before_limiting() {
        let conn = Connection::open_in_memory().expect("open database");
        seed(&conn);
        conn.execute_batch(
            r#"
            UPDATE tournaments SET started_at = '2026-06-09T23:59:00Z';
            UPDATE hands SET timestamp = '2026-06-10T00:02:00Z';
            UPDATE hand_players SET net_ev = -600, allin_equity = 0.2 WHERE hero = 1;
            INSERT INTO tournaments
              SELECT 'T2', player_name, 4.65, 0.35, 10.0, multiplier, registered_players,
                     finish_position, started_at, duration_secs, net_eur FROM tournaments WHERE id = 'T1';
            INSERT INTO hands
              SELECT 'H30', 'T2', table_name, game_name, 4.65, 0.35, level, small_blind,
                     big_blind, button_seat, seat_count, timestamp, player_count, board_cards,
                     has_showdown, hero_showed, rake_chips, total_pot FROM hands WHERE id = 'H29';
            INSERT INTO hand_players (hand_id, seat_number, player_name, starting_stack, ending_stack,
                                     contributions, collected, realized_cev, net_ev, allin_equity, hero)
              SELECT 'H30', seat_number, player_name, starting_stack, ending_stack, contributions,
                     collected, realized_cev, -1200, allin_equity, hero FROM hand_players WHERE hand_id = 'H29';
            INSERT INTO hand_actions (hand_id, street_order, street, action_index, player_name,
                                      action_type, amount, increment_amount, to_amount)
              SELECT 'H30', street_order, street, action_index, player_name, action_type,
                     amount, increment_amount, to_amount FROM hand_actions WHERE hand_id = 'H29';
            "#,
        ).expect("seed second buy-in and midnight hands");

        let from = Some("2026-06-09T00:00:00.000Z");
        let to = Some("2026-06-09T23:59:59.999Z");
        for (buy_ins, expected_hands, expected_id) in [
            (&[][..], 2, Some("H30")),
            (&[2.0][..], 1, Some("H29")),
            (&[5.0][..], 1, Some("H30")),
            (&[10.0][..], 0, None),
            (&[2.0, 5.0][..], 2, Some("H30")),
            (&[2.0, 10.0][..], 1, Some("H29")),
        ] {
            let stats = get_coach_stats(&conn, from, to, buy_ins).expect("coach statistics");
            assert_eq!(stats.heads_up.hands, expected_hands);
            let spots = list_coach_blunders(&conn, from, to, Some(1), Some("bad"), buy_ins)
                .expect("coach blunders");
            assert_eq!(spots.first().map(|spot| spot.hand_id.as_str()), expected_id);
        }
        let next_day = get_coach_stats(
            &conn, Some("2026-06-10T00:00:00Z"), None, &[],
        ).expect("exclude tournaments started the previous day");
        assert_eq!(next_day.heads_up.hands, 0);
        let evolution = get_chip_evolution(&conn).expect("chip evolution with tournament identities");
        assert_eq!(evolution.len(), 2);
        assert!(evolution.iter().all(|h| h.tournament_id == "T1" || h.tournament_id == "T2"));
    }

    #[test]
    fn chip_statistics_use_hero_showdown_and_adjusted_average() {
        for (has_showdown, hero_folded, expected_showdown) in [
            (Some(1), true, false),
            (Some(1), false, true),
            (Some(0), false, false),
            (None, false, false),
        ] {
            let conn = Connection::open_in_memory().expect("open database");
            seed(&conn);
            conn.execute(
                "UPDATE hands SET has_showdown = ?1, hero_showed = 0",
                params![has_showdown],
            )
            .expect("set showdown");
            if hero_folded {
                conn.execute(
                    r#"INSERT INTO hand_actions
                       (hand_id, street_order, street, action_index, player_name, action_type)
                       VALUES ('H29', 1, 'flop', 0, 'MRZO', 'fold')"#,
                    [],
                )
                .expect("insert hero fold");
            }

            let points = get_chip_evolution(&conn).expect("chip evolution");
            assert_eq!(points.len(), 1);
            assert_eq!(points[0].has_showdown, expected_showdown);

            let summary = get_chip_summary(&conn).expect("chip summary");
            assert_eq!(summary.net_chips, 675);
            assert_eq!(summary.net_ev_chips, 296);
            assert_eq!(summary.avg_cev_per_game, 296.0);
            assert_eq!(summary.sd_net_chips, if expected_showdown { 675 } else { 0 });
            assert_eq!(summary.wsd_net_chips, if expected_showdown { 0 } else { 675 });
            assert_eq!(summary.sd_net_chips + summary.wsd_net_chips, summary.net_chips);

            let tournaments = list_tournaments(&conn, None, None).expect("tournaments");
            assert_eq!(tournaments[0].sd_cev_sum, summary.sd_net_chips);
            assert_eq!(tournaments[0].wsd_cev_sum, summary.wsd_net_chips);
        }
    }

    #[test]
    fn hand_detail_returns_hero_and_players() {
        let conn = Connection::open_in_memory().expect("open");
        seed(&conn);

        let detail = get_hand_detail(&conn, "H29").expect("query").expect("exists");
        assert_eq!(detail.hand.id, "H29");
        assert_eq!(detail.hand.hero_cev, 675);
        assert_eq!(detail.hand.hero_cards.as_deref(), Some("Jd Kd"));
        assert!(detail.hand.invariants_ok);
        assert_eq!(detail.hand.hero_net_ev, Some(296));
        let hand_eq = detail.hand.hero_allin_equity.expect("hero allin equity");
        assert!((hand_eq - 0.719).abs() < 1e-6);
        assert_eq!(detail.players.len(), 2);
        assert_eq!(detail.actions.len(), 2);
        assert_eq!(detail.actions[0].street, "preflop");
        assert_eq!(detail.actions[0].action_type, "allin_raise");
        assert_eq!(detail.actions[1].action_type, "allin_call");

        let hero = detail.players.iter().find(|p| p.hero).expect("hero row");
        assert_eq!(hero.player_name, "MRZO");
        assert_eq!(hero.starting_stack, 675);
        assert_eq!(hero.ending_stack, 1350);
        assert_eq!(hero.realized_cev, 675);
        assert_eq!(hero.net_ev, Some(296));
        let hero_eq = hero.allin_equity.expect("hero equity");
        assert!((hero_eq - 0.719).abs() < 1e-6);
    }

    #[test]
    fn list_hands_for_tournament_returns_expected_rows() {
        let conn = Connection::open_in_memory().expect("open");
        seed(&conn);

        let rows = list_hands_for_tournament(&conn, "T1").expect("query");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "H29");
        assert_eq!(rows[0].hero_cev, 675);
        assert_eq!(rows[0].hero_net_ev, Some(296));
        assert_eq!(rows[0].hero_cards.as_deref(), Some("Jd Kd"));

        let detail = get_hand_detail(&conn, "H29").expect("detail query").expect("detail exists");

            #[test]
            fn load_hand_for_replay_returns_state() {
                let conn = Connection::open_in_memory().expect("open");
                seed(&conn);

                let replay = load_hand_for_replay(&conn, "H29").expect("replay query");
                assert!(replay.is_some(), "Hand should exist");

                let state = replay.unwrap();
                assert_eq!(state.hand_id, "H29");
                assert_eq!(state.total_steps, 5);
                assert_eq!(state.players.len(), 2);
                assert_eq!(state.button_pos, 1);
                assert_eq!(state.board, vec!["Qs", "3d", "8h", "7c", "Ah"]);
                assert_eq!(state.players[0].hole_cards.as_deref(), Some("As Qc"));
                assert_eq!(state.players[1].hole_cards.as_deref(), Some("Jd Kd"));

                let first_step = &state.steps[0];
                assert_eq!(first_step.action_type, "allin_raise");
                assert_eq!(first_step.players_after.len(), 2);
                assert_eq!(first_step.players_after[0].name, "Cocochanel23");
                assert_eq!(first_step.players_after[0].current_stack, 0);

                let second_step = &state.steps[1];
                assert_eq!(second_step.action_type, "allin_call");
                assert_eq!(second_step.players_after[1].name, "MRZO");
                assert_eq!(second_step.players_after[1].current_stack, 0);

                let flop_reveal = &state.steps[2];
                assert_eq!(flop_reveal.street, "flop");
                assert_eq!(flop_reveal.action_type, "board_reveal");

                let turn_reveal = &state.steps[3];
                assert_eq!(turn_reveal.street, "turn");
                assert_eq!(turn_reveal.action_type, "board_reveal");

                let river_reveal = &state.steps[4];
                assert_eq!(river_reveal.street, "river");
                assert_eq!(river_reveal.action_type, "board_reveal");
            }
        assert_eq!(detail.actions.len(), 2);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreflopStatsRow {
    pub position: String,  // "BTN", "SB", "BB"
    pub total_hands: i64,
    pub push_count: i64,    // allin_raise, allin_bet
    pub call_count: i64,    // call, allin_call
    pub raise_count: i64,   // raise (preflop 3bet)
    pub fold_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreflopStats {
    pub stats: Vec<PreflopStatsRow>,
}

/// Helper to determine hero position in 3-handed game
fn get_position_name(button_seat: i64, hero_seat: i64) -> &'static str {
    let relative = (hero_seat - button_seat + 3) % 3;
    match relative {
        0 => "BTN",
        1 => "SB",
        2 => "BB",
        _ => "BTN",
    }
}

/// Extract preflop action statistics by position (3-handed only)
pub fn get_preflop_stats_by_position(conn: &Connection) -> Result<PreflopStats, rusqlite::Error> {
    let mut stmt = conn.prepare(
        r#"SELECT h.id,
                  h.button_seat,
                  hp.seat_number,
                  hp.player_name,
                  a.action_type
           FROM hands h
           JOIN hand_players hp ON hp.hand_id = h.id AND hp.hero = 1
           JOIN hand_actions a ON a.hand_id = h.id AND a.street_order = 0 AND a.player_name = hp.player_name
           WHERE h.seat_count = 3
           ORDER BY h.id, a.action_index"#,
    )?;

    let mut position_stats: BTreeMap<String, (i64, i64, i64, i64, i64)> = BTreeMap::new();
    position_stats.insert("BTN".to_string(), (0, 0, 0, 0, 0));
    position_stats.insert("SB".to_string(), (0, 0, 0, 0, 0));
    position_stats.insert("BB".to_string(), (0, 0, 0, 0, 0));

    let rows: Vec<(String, i64, i64, String, String)> = stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,  // hand_id
                row.get(1)?,  // button_seat
                row.get(2)?,  // hero_seat
                row.get(3)?,  // player_name
                row.get(4)?,  // action_type
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut seen_hands = std::collections::HashSet::new();

    for (hand_id, button_seat, hero_seat, _player_name, action_type) in rows {
        let position = get_position_name(button_seat, hero_seat);
        let pos_key = position.to_string();

        // Count once per hand for total_hands
        let is_new_hand = seen_hands.insert(hand_id.clone());

        let (total, push, call, raise, fold) = position_stats
            .entry(pos_key)
            .or_insert((0, 0, 0, 0, 0));

        if is_new_hand {
            *total += 1;
        }

        match action_type.as_str() {
            "allin_raise" | "allin_bet" => {
                *push += 1;
            }
            "call" | "allin_call" => {
                *call += 1;
            }
            "raise" => {
                *raise += 1;
            }
            "fold" => {
                *fold += 1;
            }
            _ => {}
        }
    }

    let stats: Vec<PreflopStatsRow> = position_stats
        .into_iter()
        .map(|(position, (total, push, call, raise, fold))| PreflopStatsRow {
            position,
            total_hands: total,
            push_count: push,
            call_count: call,
            raise_count: raise,
            fold_count: fold,
        })
        .collect();

    Ok(PreflopStats { stats })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GtoRange {
    pub position: String,          // "BTN", "SB", "BB"
    pub stack_depth: String,       // "25bb+", "20bb", "15bb", "12bb", "10bb", "8bb", "6bb"
    pub push_range: Vec<String>,   // List of combos like "AA", "AKs", "AKo", etc.
    pub call_range: Vec<String>,   // For SB/BB
    pub fold_range: Vec<String>,   // Marginal combos
}

/// GTO push ranges for 3-handed poker by position and stack depth
pub fn get_gto_ranges() -> Vec<GtoRange> {
    vec![
        // BTN ranges (push-or-fold)
        GtoRange {
            position: "BTN".to_string(),
            stack_depth: "25bb+".to_string(),
            push_range: vec![
                "AA", "KK", "QQ", "JJ", "TT", "99", "88",
                "AKs", "AQs", "AJs", "ATs", "A9s", "A8s",
                "KQs", "KJs", "QJs",
            ].iter().map(|s| s.to_string()).collect(),
            call_range: vec![],
            fold_range: vec!["A2s", "A3s", "A4s", "A5s", "A6s", "A7s", "K9s", "Q9s", "J9s", "T9s", "98s", "87s", "76s", "65s", "54s", "KJo", "QJo"].iter().map(|s| s.to_string()).collect(),
        },
        GtoRange {
            position: "BTN".to_string(),
            stack_depth: "20bb".to_string(),
            push_range: vec![
                "AA", "KK", "QQ", "JJ", "TT", "99", "88", "77",
                "AKs", "AQs", "AJs", "ATs", "A9s", "A8s", "A7s",
                "KQs", "KJs", "KTs", "QJs",
            ].iter().map(|s| s.to_string()).collect(),
            call_range: vec![],
            fold_range: vec![],
        },
        GtoRange {
            position: "BTN".to_string(),
            stack_depth: "15bb".to_string(),
            push_range: vec![
                "AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "66",
                "AKs", "AQs", "AJs", "ATs", "A9s", "A8s", "A7s", "A6s", "A5s",
                "KQs", "KJs", "KTs", "K9s",
                "QJs", "QTs",
                "JTs",
            ].iter().map(|s| s.to_string()).collect(),
            call_range: vec![],
            fold_range: vec![],
        },
        GtoRange {
            position: "BTN".to_string(),
            stack_depth: "12bb".to_string(),
            push_range: vec![
                "AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "66", "55",
                "AKs", "AQs", "AJs", "ATs", "A9s", "A8s", "A7s", "A6s", "A5s", "A4s", "A3s", "A2s",
                "KQs", "KJs", "KTs", "K9s",
                "QJs", "QTs", "Q9s",
                "JTs", "J9s",
                "T9s",
            ].iter().map(|s| s.to_string()).collect(),
            call_range: vec![],
            fold_range: vec![],
        },

        // SB ranges (push vs BB)
        GtoRange {
            position: "SB".to_string(),
            stack_depth: "25bb+".to_string(),
            push_range: vec![
                "AA", "KK", "QQ", "JJ", "TT", "99", "88",
                "AKs", "AQs", "AJs", "ATs",
                "KQs",
            ].iter().map(|s| s.to_string()).collect(),
            call_range: vec![
                "77", "66", "55", "44",
                "A9s", "A8s", "A7s", "A6s", "A5s",
                "KJs", "KTs", "K9s",
                "QJs", "QTs",
                "JTs", "J9s",
                "T9s", "T8s",
            ].iter().map(|s| s.to_string()).collect(),
            fold_range: vec!["A2s", "A3s", "A4s", "K2s", "Q2s", "J2s", "T2s", "92s"].iter().map(|s| s.to_string()).collect(),
        },
        GtoRange {
            position: "SB".to_string(),
            stack_depth: "15bb".to_string(),
            push_range: vec![
                "AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "66",
                "AKs", "AQs", "AJs", "ATs", "A9s", "A8s",
                "KQs", "KJs", "KTs",
                "QJs",
            ].iter().map(|s| s.to_string()).collect(),
            call_range: vec![
                "55", "44",
                "A7s", "A6s", "A5s",
                "K9s", "K8s",
                "QTs", "Q9s",
                "JTs", "J9s",
                "T9s",
                "98s", "87s",
            ].iter().map(|s| s.to_string()).collect(),
            fold_range: vec![],
        },

        // BB ranges (vs SB push)
        GtoRange {
            position: "BB".to_string(),
            stack_depth: "25bb+".to_string(),
            push_range: vec![], // BB doesn't push, BB calls/folds
            call_range: vec![
                "AA", "KK", "QQ", "JJ", "TT", "99", "88", "77",
                "AKs", "AQs", "AJs", "ATs", "A9s",
                "KQs", "KJs", "KTs",
                "QJs",
            ].iter().map(|s| s.to_string()).collect(),
            fold_range: vec!["22", "33", "44", "55", "66", "A2s", "A3s", "A4s", "A5s", "A6s", "A7s", "A8s", "K2s", "Q2s", "J2s"].iter().map(|s| s.to_string()).collect(),
        },
        GtoRange {
            position: "BB".to_string(),
            stack_depth: "15bb".to_string(),
            push_range: vec![],
            call_range: vec![
                "AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "66", "55",
                "AKs", "AQs", "AJs", "ATs", "A9s", "A8s", "A7s", "A6s",
                "KQs", "KJs", "KTs", "K9s",
                "QJs", "QTs",
                "JTs",
                "T9s", "98s",
            ].iter().map(|s| s.to_string()).collect(),
            fold_range: vec![],
        },
    ]
}
