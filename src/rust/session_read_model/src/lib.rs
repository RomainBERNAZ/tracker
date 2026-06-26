use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json;
use std::collections::BTreeMap;

// ─── Read models (returned to the UI) ────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TournamentRow {
    pub id: String,
    pub player_name: String,
    pub buy_in_euros: f64,
    pub prizepool_euros: f64,
    pub multiplier: i64,
    pub finish_position: i64,
    pub started_at: String,
    pub duration_secs: i64,
    pub net_eur: f64,
    pub hand_count: i64,
    pub hero_cev_sum: i64,
    /// Sum of hero all-in Net EV converted to euros for this tournament (V1 proportional)
    pub hero_net_ev_eur_sum: f64,
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
    pub timestamp: String,
    pub realized_cev: i64,
    pub net_ev: Option<i64>,
    pub has_showdown: bool,
}

/// Returns per-hand chip data ordered by timestamp for cumulative chart.
pub fn get_chip_evolution(conn: &Connection) -> Result<Vec<HandChipPoint>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        r#"SELECT h.timestamp, hp.realized_cev, hp.net_ev,
                  COALESCE(h.has_showdown, 0)
           FROM hands h
           JOIN hand_players hp ON hp.hand_id = h.id AND hp.hero = 1
           ORDER BY h.timestamp ASC"#,
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(HandChipPoint {
            timestamp: row.get(0)?,
            realized_cev: row.get(1)?,
            net_ev: row.get(2)?,
            has_showdown: row.get::<_, i64>(3).map(|v| v != 0)?,
        })
    })?;

    rows.collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChipSummary {
    pub net_chips: i64,
    pub net_ev_chips: i64,
    pub avg_cev_per_game: f64,
    pub wsd_net_chips: i64,   // cEV net on hands WITHOUT showdown
    pub sd_net_chips: i64,    // cEV net on hands WITH showdown
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
            r#"SELECT
                COALESCE(SUM(hp.realized_cev), 0),
                COALESCE(SUM(COALESCE(hp.net_ev, hp.realized_cev)), 0),
                COALESCE(SUM(CASE WHEN h.has_showdown = 0 THEN hp.realized_cev ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN h.has_showdown = 1 THEN hp.realized_cev ELSE 0 END), 0)
            FROM hand_players hp
            JOIN hands h ON h.id = hp.hand_id
            WHERE hp.hero = 1"#,
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?;

    let total_tournaments: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tournaments",
        [],
        |r| r.get(0),
    )?;

    let avg_cev_per_game = if total_tournaments > 0 {
        net_chips as f64 / total_tournaments as f64
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
) -> Result<Vec<CoachBlunderSpot>, rusqlite::Error> {
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
             AND (?1 IS NULL OR h.timestamp >= ?1)
             AND (?2 IS NULL OR h.timestamp <= ?2)
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
        .query_map(params![from_ts, to_ts], |row| {
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

        if let Some(first_hero_idx) = sample.actions.iter().position(|a| a.player_name == sample.hero_name) {
            let first_hero_action = &sample.actions[first_hero_idx];
            let prior_aggressive = sample.actions[..first_hero_idx]
                .iter()
                .filter(|a| is_aggressive_preflop_action(&a.action_type))
                .count() as i64;

            if prior_aggressive == 0 && is_call_preflop_action(&first_hero_action.action_type) {
                limp_count += 1;
            }

            if prior_aggressive == 1 {
                three_bet_opportunities += 1;
                if is_aggressive_preflop_action(&first_hero_action.action_type) {
                    three_bet_count += 1;
                }
            }
        }

        let mut aggressive_count = 0_i64;
        for (idx, action) in sample.actions.iter().enumerate() {
            if !is_aggressive_preflop_action(&action.action_type) {
                continue;
            }

            if aggressive_count == 1 && action.player_name != sample.hero_name {
                let hero_opened = sample.actions[..idx].iter().any(|a| {
                    a.player_name == sample.hero_name && is_aggressive_preflop_action(&a.action_type)
                }) && sample.actions[..idx]
                    .iter()
                    .filter(|a| is_aggressive_preflop_action(&a.action_type))
                    .next()
                    .map(|a| a.player_name == sample.hero_name)
                    .unwrap_or(false);

                if hero_opened {
                    fold_to_three_bet_opportunities += 1;
                    if let Some(next_hero_action) = sample.actions[idx + 1..]
                        .iter()
                        .find(|a| a.player_name == sample.hero_name)
                    {
                        if next_hero_action.action_type == "fold" {
                            fold_to_three_bet_count += 1;
                        }
                    }
                    break;
                }
            }

            aggressive_count += 1;
        }
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
) -> Result<CoachStatsSnapshot, rusqlite::Error> {
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
             AND (?1 IS NULL OR h.timestamp >= ?1)
             AND (?2 IS NULL OR h.timestamp <= ?2)
           ORDER BY h.id ASC, a.action_index ASC"#,
    )?;

    let rows: Vec<(String, i64, i64, String, Option<String>, Option<String>)> = stmt
        .query_map(params![from_ts, to_ts], |row| {
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

/// List all tournaments, newest first.
pub fn list_tournaments(
    conn: &Connection,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<Vec<TournamentRow>, rusqlite::Error> {
    let lim = limit.unwrap_or(100) as i64;
    let off = offset.unwrap_or(0) as i64;

    let mut stmt = conn.prepare(
        r#"SELECT t.id, t.player_name, t.buy_in_euros, t.prizepool_euros,
                  t.multiplier, t.finish_position, t.started_at,
                  t.duration_secs, t.net_eur,
                  COUNT(h.id) as hand_count,
                COALESCE(SUM(COALESCE(hp.net_ev, hp.realized_cev)), 0) as hero_cev_sum,
                COALESCE(SUM(
                    CASE WHEN hp.net_ev IS NULL THEN NULL
                         ELSE CAST(hp.net_ev AS REAL) * t.prizepool_euros /
                              NULLIF((SELECT SUM(hp2.starting_stack) FROM hand_players hp2 WHERE hp2.hand_id = h.id), 0)
                    END
                ), 0.0) as hero_net_ev_eur_sum,
                COALESCE(SUM(CASE WHEN h.has_showdown = 0 THEN hp.realized_cev ELSE 0 END), 0) as wsd_cev_sum,
                COALESCE(SUM(CASE WHEN h.has_showdown = 1 THEN hp.realized_cev ELSE 0 END), 0) as sd_cev_sum
           FROM tournaments t
           LEFT JOIN hands h ON h.tournament_id = t.id
           LEFT JOIN hand_players hp ON hp.hand_id = h.id AND hp.hero = 1
           GROUP BY t.id
           ORDER BY t.started_at DESC
           LIMIT ?1 OFFSET ?2"#,
    )?;

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
            hero_net_ev_eur_sum: row.get(11)?,
            wsd_cev_sum: row.get(12)?,
            sd_cev_sum: row.get(13)?,
        })
    })?;

    rows.collect()
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
