use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

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
    pub hero_net_ev: Option<i64>,
    pub hero_allin_equity: Option<f64>,
    pub hero_cards: Option<String>,   // "Ah Kd" or null
    pub total_pot: i64,
    pub seat_count: i64,
    pub invariants_ok: bool,
    /// Net EV converted to euros: net_ev_chips * prizepool_eur / total_chips (proportional V1)
    pub hero_net_ev_eur: Option<f64>,
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
    pub description: String,  // Human-readable: "PlayerA bets 50" etc.
}

// ─── Queries ─────────────────────────────────────────────────────────────────

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
                ), 0.0) as hero_net_ev_eur_sum
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
                  hp.realized_cev, hp.net_ev, hp.allin_equity,
                  hc.card1 || ' ' || hc.card2,
                  (ic.sum_invariant AND ic.chip_conservation AND ic.pot_match),
                  CASE WHEN hp.net_ev IS NULL THEN NULL
                       ELSE CAST(hp.net_ev AS REAL) * t.prizepool_euros /
                            NULLIF((SELECT SUM(hp2.starting_stack) FROM hand_players hp2 WHERE hp2.hand_id = h.id), 0)
                  END AS net_ev_eur
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
            hero_net_ev: row.get(9)?,
            hero_allin_equity: row.get(10)?,
            hero_cards: row.get(11)?,
            invariants_ok: row.get::<_, i64>(12).map(|v| v != 0).unwrap_or(true),
            hero_net_ev_eur: row.get(13)?,
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
                      hp.realized_cev, hp.net_ev, hp.allin_equity,
                      hc.card1 || ' ' || hc.card2,
                      (ic.sum_invariant AND ic.chip_conservation AND ic.pot_match),
                      CASE WHEN hp.net_ev IS NULL THEN NULL
                           ELSE CAST(hp.net_ev AS REAL) * t.prizepool_euros /
                                NULLIF((SELECT SUM(hp2.starting_stack) FROM hand_players hp2 WHERE hp2.hand_id = h.id), 0)
                      END AS net_ev_eur
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
                    hero_net_ev: row.get(9)?,
                    hero_allin_equity: row.get(10)?,
                    hero_cards: row.get(11)?,
                    invariants_ok: row.get::<_, i64>(12).map(|v| v != 0).unwrap_or(true),
                    hero_net_ev_eur: row.get(13)?,
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
                      h.small_blind, h.big_blind
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
                ))
            },
        )
        .ok();

    let (hand_id_val, tournament_id, table_name, timestamp, level, sb, bb) =
        match hand_info {
            None => return Ok(None),
            Some(h) => h,
        };

    // Load all players for this hand
    let mut players_stmt = conn.prepare(
         r#"SELECT hp.seat_number,
                hp.player_name,
                hp.starting_stack,
                hp.ending_stack,
                (hc.card1 || ' ' || hc.card2) AS hole_cards
            FROM hand_players hp
            LEFT JOIN hole_cards hc ON hc.hand_id = hp.hand_id AND hc.player_name = hp.player_name
           WHERE hp.hand_id = ?1
           ORDER BY hp.seat_number"#,
    )?;

    let mut players_map: std::collections::HashMap<String, ReplayerPlayer> = players_stmt
        .query_map(params![hand_id], |row| {
            let seat: i64 = row.get(0)?;
            let name: String = row.get(1)?;
            let starting: i64 = row.get(2)?;
            let hole_card_str: Option<String> = row.get(4)?;

            Ok((
                name.clone(),
                ReplayerPlayer {
                    seat_number: seat,
                    name,
                    starting_stack: starting,
                    current_stack: starting,
                    hole_cards: hole_card_str,
                    folded: false,
                },
            ))
        })?
        .collect::<Result<_, _>>()?;

    let mut players_vec: Vec<ReplayerPlayer> = players_map.values().cloned().collect();
    players_vec.sort_by_key(|p| p.seat_number);

    let button_pos = 0; // V0.1 always 3-handed, SB=0, BB=1, BTN=2

    // Load all actions for this hand
    let mut actions_stmt = conn.prepare(
        r#"SELECT street, action_index, player_name, action_type,
                  amount, increment_amount, to_amount
           FROM hand_actions
           WHERE hand_id = ?1
           ORDER BY street_order ASC, action_index ASC"#,
    )?;

    let raw_actions: Vec<(String, i64, String, String, Option<i64>, Option<i64>, Option<i64>)> =
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
                ))
            })?
            .collect::<Result<_, _>>()?;

    // Build replayer steps (with stacks at each step)
    let mut steps: Vec<ReplayerStep> = Vec::new();
    let mut player_stacks = players_map.clone();

    for (step_num, (street, _action_idx, actor_name, action_type, amount, incr, to_amt)) in
        raw_actions.iter().enumerate()
    {
        let description = format!(
            "{} {} {} chips",
            actor_name,
            action_type,
            amount.unwrap_or(0)
        );

        // Update player stack if bet/raise/call/fold
        if let Some(player) = player_stacks.get_mut(actor_name) {
            match action_type.as_str() {
                "Fold" => {
                    player.folded = true;
                }
                "AllIn" => {
                    player.current_stack = 0;
                }
                _ => {
                    if let Some(amt) = amount {
                        player.current_stack -= amt;
                    }
                }
            }
        }

        // Compute pot after this action (simplified: look at hand_players ending stacks)
        let pot_size_after = players_vec
            .iter()
            .map(|p| p.starting_stack)
            .sum::<i64>()
            - player_stacks
                .values()
                .map(|p| p.current_stack)
                .sum::<i64>();

        steps.push(ReplayerStep {
            step_number: step_num,
            street: street.clone(),
            actor_name: actor_name.clone(),
            action_type: action_type.clone(),
            amount: *amount,
            increment_amount: *incr,
            to_amount: *to_amt,
            pot_size_after,
            description,
        });
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
        board: vec![], // Will be populated from board_cards table if we have it
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
            "INSERT INTO hands (id, tournament_id, table_name, game_name, buy_in_euros, rake_euros, level, small_blind, big_blind, button_seat, seat_count, timestamp, player_count, rake_chips, total_pot) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params!["H29", "T1", "Expresso(T1)#0", "Holdem no limit", 1.86_f64, 0.14_f64, 4_i64, 30_i64, 60_i64, 1_i64, 2_i64, "2026-06-09T13:52:25Z", 2_i64, 0_i64, 1500_i64],
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
                assert_eq!(state.total_steps, 2);
                assert_eq!(state.players.len(), 3);
        
                // Check first player
                let p1 = &state.players[0];
                assert_eq!(p1.seat_number, 1);
                assert_eq!(p1.starting_stack, 600);
            }
        assert_eq!(detail.actions.len(), 2);
    }
}
