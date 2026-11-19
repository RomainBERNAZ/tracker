use crate::ev::{compute_hero_net_ev, compute_hero_net_ev_from_data};
use crate::schema::SCHEMA_V1;
use cev_realized_core::InvariantReport;
use hand_ledger::{HandLedger, PlayerLedger};
use hh_parser_winamax::{Action, HoleCards, ParsedHand, ShownHand, StreetType, TournamentSummary};
use rusqlite::types::Type;
use rusqlite::{params, Connection};
use serde_json;

#[derive(Debug, Clone)]
pub struct ClearDataStats {
    pub tournaments: i64,
    pub hands: i64,
    pub hand_players: i64,
    pub hand_actions: i64,
    pub hole_cards: i64,
    pub invariant_checks: i64,
    pub import_sessions: i64,
}

/// Open (or create) the SQLite database and apply the schema.
pub fn open(path: &str) -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open(path)?;
    conn.execute_batch(SCHEMA_V1)?;
    ensure_schema_extensions(&conn)?;
    backfill_missing_net_ev(&conn)?;
    Ok(conn)
}

/// Open an in-memory database (for testing).
pub fn open_memory() -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open_in_memory()?;
    conn.execute_batch(SCHEMA_V1)?;
    ensure_schema_extensions(&conn)?;
    backfill_missing_net_ev(&conn)?;
    Ok(conn)
}

fn ensure_schema_extensions(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Existing databases may miss V0.2 columns; add them lazily.
    for alter in [
        "ALTER TABLE hand_players ADD COLUMN net_ev INTEGER",
        "ALTER TABLE hand_players ADD COLUMN allin_equity REAL",
        "ALTER TABLE hands ADD COLUMN board_cards TEXT",
        "ALTER TABLE hands ADD COLUMN has_showdown INTEGER",
        "ALTER TABLE hands ADD COLUMN hero_showed INTEGER",
    ] {
        if let Err(e) = conn.execute(alter, []) {
            let msg = e.to_string();
            if !msg.contains("duplicate column name") {
                return Err(e);
            }
        }
    }

    // Create auxiliary tables that may not exist in older databases.
    conn.execute_batch(
        r#"CREATE TABLE IF NOT EXISTS showdown_hole_cards (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            hand_id     TEXT    NOT NULL,
            player_name TEXT    NOT NULL,
            card1       TEXT    NOT NULL,
            card2       TEXT    NOT NULL,
            FOREIGN KEY (hand_id) REFERENCES hands(id),
            UNIQUE (hand_id, player_name)
        );
        CREATE TABLE IF NOT EXISTS app_migrations (
            migration TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        );"#,
    )?;

    Ok(())
}

struct MissingNetEvCandidate {
    hand_id: String,
    tournament_id: String,
    board_cards: String,
    total_pot: i64,
    rake_chips: i64,
    hero_name: String,
    hero_card1: String,
    hero_card2: String,
    all_in_street_order: i64,
}

fn nonnegative_u64(value: i64, column: usize) -> Result<u64, rusqlite::Error> {
    u64::try_from(value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(column, Type::Integer, Box::new(error))
    })
}

fn nonnegative_u32(value: i64, column: usize) -> Result<u32, rusqlite::Error> {
    u32::try_from(value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(column, Type::Integer, Box::new(error))
    })
}

fn all_in_street_from_order(order: i64) -> Result<StreetType, rusqlite::Error> {
    match order {
        0 => Ok(StreetType::PreFlop),
        1 => Ok(StreetType::Flop),
        2 => Ok(StreetType::Turn),
        3 => Ok(StreetType::River),
        _ => Err(rusqlite::Error::FromSqlConversionFailure(
            8,
            Type::Integer,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("invalid all-in street order: {order}"),
            )),
        )),
    }
}

fn backfill_missing_net_ev(conn: &Connection) -> Result<(), rusqlite::Error> {
    const MIGRATION: &str = "covered_opponent_all_in_net_ev_v1";

    let tx = conn.unchecked_transaction()?;
    let applied: i64 = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM app_migrations WHERE migration = ?1)",
        params![MIGRATION],
        |row| row.get(0),
    )?;
    if applied != 0 {
        tx.commit()?;
        return Ok(());
    }

    // Legacy hero rows keep realized_cev in net_ev when no all-in adjustment was calculated.
    let candidates = {
        let mut stmt = tx.prepare(
            r#"SELECT h.id, h.tournament_id, h.board_cards, h.total_pot, h.rake_chips,
                      hp.player_name, hc.card1, hc.card2, MIN(a.street_order)
               FROM hands h
               JOIN hand_players hp ON hp.hand_id = h.id AND hp.hero = 1
               JOIN hole_cards hc ON hc.hand_id = h.id AND hc.player_name = hp.player_name
               JOIN hand_actions a ON a.hand_id = h.id
                   AND a.action_type IN ('allin_raise', 'allin_bet', 'allin_call')
               WHERE (hp.net_ev IS NULL OR hp.net_ev = hp.realized_cev)
                 AND h.board_cards IS NOT NULL
                 AND h.total_pot > 0
                 AND hp.contributions > 0
                 AND EXISTS (
                     SELECT 1 FROM showdown_hole_cards sh
                     WHERE sh.hand_id = h.id AND sh.player_name = hp.player_name
                 )
                 AND (SELECT COUNT(*) FROM showdown_hole_cards sh WHERE sh.hand_id = h.id) >= 2
                 AND NOT EXISTS (
                     SELECT 1 FROM hand_actions hero_action
                     WHERE hero_action.hand_id = h.id
                       AND hero_action.player_name = hp.player_name
                       AND hero_action.action_type IN ('allin_raise', 'allin_bet', 'allin_call')
                 )
               GROUP BY h.id, h.tournament_id, h.board_cards, h.total_pot, h.rake_chips,
                        hp.player_name, hc.card1, hc.card2
               ORDER BY h.id"#,
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(MissingNetEvCandidate {
                hand_id: row.get(0)?,
                tournament_id: row.get(1)?,
                board_cards: row.get(2)?,
                total_pot: row.get(3)?,
                rake_chips: row.get(4)?,
                hero_name: row.get(5)?,
                hero_card1: row.get(6)?,
                hero_card2: row.get(7)?,
                all_in_street_order: row.get(8)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    for candidate in candidates {
        let final_board: Vec<String> =
            serde_json::from_str(&candidate.board_cards).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(2, Type::Text, Box::new(error))
            })?;
        let all_in_street = all_in_street_from_order(candidate.all_in_street_order)?;
        let hero_hole = HoleCards {
            player_name: candidate.hero_name.clone(),
            card1: candidate.hero_card1,
            card2: candidate.hero_card2,
        };

        let shown_hands = {
            let mut stmt = tx.prepare_cached(
                "SELECT player_name, card1, card2 FROM showdown_hole_cards WHERE hand_id = ?1",
            )?;
            let rows = stmt.query_map(params![&candidate.hand_id], |row| {
                Ok(ShownHand {
                    player_name: row.get(0)?,
                    card1: row.get(1)?,
                    card2: row.get(2)?,
                    hand_description: String::new(),
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>()?
        };

        let players = {
            let mut stmt = tx.prepare_cached(
                r#"SELECT seat_number, player_name, starting_stack, ending_stack,
                          contributions, collected, realized_cev
                   FROM hand_players
                   WHERE hand_id = ?1
                   ORDER BY seat_number"#,
            )?;
            let rows = stmt.query_map(params![&candidate.hand_id], |row| {
                let seat_number: i64 = row.get(0)?;
                let starting_stack: i64 = row.get(2)?;
                let ending_stack: i64 = row.get(3)?;
                let contributions: i64 = row.get(4)?;
                let collected: i64 = row.get(5)?;
                Ok(PlayerLedger {
                    seat_number: nonnegative_u32(seat_number, 0)?,
                    player_name: row.get(1)?,
                    starting_stack: nonnegative_u64(starting_stack, 2)?,
                    ending_stack: nonnegative_u64(ending_stack, 3)?,
                    contributions: nonnegative_u64(contributions, 4)?,
                    collected: nonnegative_u64(collected, 5)?,
                    realized_cev: row.get(6)?,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>()?
        };

        let ledger = HandLedger {
            hand_id: candidate.hand_id.clone(),
            tournament_id: candidate.tournament_id,
            players,
            total_pot: nonnegative_u64(candidate.total_pot, 3)?,
            rake: nonnegative_u64(candidate.rake_chips, 4)?,
        };

        if let Some((net_ev, allin_equity)) = compute_hero_net_ev_from_data(
            &candidate.hand_id,
            &candidate.hero_name,
            &hero_hole,
            &shown_hands,
            &all_in_street,
            &final_board,
            &ledger,
        ) {
            tx.execute(
                r#"UPDATE hand_players
                   SET net_ev = ?3, allin_equity = ?4
                   WHERE hand_id = ?1 AND player_name = ?2 AND hero = 1
                     AND (net_ev IS NULL OR net_ev = realized_cev)"#,
                params![candidate.hand_id, candidate.hero_name, net_ev, allin_equity],
            )?;
        }
    }

    tx.execute(
        "INSERT INTO app_migrations (migration) VALUES (?1)",
        params![MIGRATION],
    )?;
    tx.commit()?;
    Ok(())
}

// ─── Tournament ───────────────────────────────────────────────────────────────

pub fn upsert_tournament(
    conn: &Connection,
    ts: &TournamentSummary,
) -> Result<(), rusqlite::Error> {
    // Payout: 1st place gets the full prizepool, others get 0
    let payout = if ts.finish_position == 1 {
        ts.prizepool_euros
    } else {
        0.0
    };
    let net = payout - (ts.buy_in_euros + ts.rake_euros);

    let mut stmt = conn.prepare_cached(
        r#"INSERT OR REPLACE INTO tournaments
           (id, player_name, buy_in_euros, rake_euros, prizepool_euros, multiplier,
            registered_players, finish_position, started_at, duration_secs, net_eur)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)"#,
    )?;
    stmt.execute(params![
        ts.tournament_id,
        ts.player_name,
        ts.buy_in_euros,
        ts.rake_euros,
        ts.prizepool_euros,
        ts.multiplier,
        ts.registered_players,
        ts.finish_position,
        ts.started_at.to_rfc3339(),
        ts.duration_secs,
        net,
    ])?;
    Ok(())
}

// ─── Hand + Ledger ────────────────────────────────────────────────────────────

/// Returns `true` if the hand was inserted, `false` if it already existed.
pub fn insert_hand_with_ledger(
    conn: &Connection,
    hand: &ParsedHand,
    ledger: &HandLedger,
    hero_name: &str,
    report: &InvariantReport,
) -> Result<bool, rusqlite::Error> {
    // Idempotency check
    let exists: bool = {
        let mut stmt = conn.prepare_cached("SELECT 1 FROM hands WHERE id = ?1")?;
        stmt.query_row(params![hand.hand_id], |_| Ok(true)).unwrap_or(false)
    };

    if exists {
        return Ok(false);
    }

    // ── hands row ──────────────────────────────────────────────────────────
    {
        let board_cards_json = serde_json::to_string(&hand.summary.board)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        let has_showdown = hand
            .summary
            .seat_results
            .iter()
            .any(|sr| sr.showed.is_some()) as i64;
        let hero_showed = hand
            .summary
            .seat_results
            .iter()
            .find(|sr| sr.player_name == hero_name)
            .and_then(|sr| sr.showed.as_ref())
            .is_some() as i64;

        let mut stmt = conn.prepare_cached(
            r#"INSERT INTO hands
               (id, tournament_id, table_name, game_name, buy_in_euros, rake_euros,
                level, small_blind, big_blind, button_seat, seat_count,
                timestamp, player_count, board_cards, has_showdown, hero_showed, rake_chips, total_pot)
               VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)"#,
        )?;
        stmt.execute(params![
            hand.hand_id,
            hand.tournament_id,
            hand.table_name,
            hand.game_name,
            hand.buy_in_euros,
            hand.rake_euros,
            hand.level,
            hand.small_blind,
            hand.big_blind,
            hand.button_seat,
            hand.seat_count,
            hand.timestamp.to_rfc3339(),
            hand.seats.len() as i64,
            board_cards_json,
            has_showdown,
            hero_showed,
            ledger.rake as i64,
            ledger.total_pot as i64,
        ])?;
    }

    // ── hand_players rows ─────────────────────────────────────────────────
    let mut hand_players_stmt = conn.prepare_cached(
        r#"INSERT INTO hand_players
           (hand_id, seat_number, player_name, starting_stack, ending_stack,
            contributions, collected, realized_cev, net_ev, allin_equity, hero)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)"#,
    )?;
    for pl in &ledger.players {
        let is_hero = pl.player_name == hero_name;
        hand_players_stmt.execute(params![
            hand.hand_id,
            pl.seat_number,
            pl.player_name,
            pl.starting_stack as i64,
            pl.ending_stack as i64,
            pl.contributions as i64,
            pl.collected as i64,
            pl.realized_cev,
            if is_hero { Some(pl.realized_cev) } else { None },
            Option::<f64>::None,
            if is_hero { 1 } else { 0 },
        ])?;
    }

    // ── hand_actions rows (timeline) ───────────────────────────────────────
    let mut hand_actions_stmt = conn.prepare_cached(
        r#"INSERT INTO hand_actions
           (hand_id, street_order, street, action_index, player_name, action_type,
            amount, increment_amount, to_amount)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)"#,
    )?;
    for street in &hand.streets {
        let (street_order, street_name) = match street.street_type {
            StreetType::PreFlop => (0_i64, "preflop"),
            StreetType::Flop => (1_i64, "flop"),
            StreetType::Turn => (2_i64, "turn"),
            StreetType::River => (3_i64, "river"),
        };

        for (idx, pa) in street.actions.iter().enumerate() {
            let (action_type, amount, increment_amount, to_amount) = match &pa.action {
                Action::Fold => ("fold", None, None, None),
                Action::Check => ("check", None, None, None),
                Action::Call { amount } => ("call", Some(*amount as i64), None, None),
                Action::Bet { amount } => ("bet", Some(*amount as i64), None, None),
                Action::Raise { increment, to } => (
                    "raise",
                    None,
                    Some(*increment as i64),
                    Some(*to as i64),
                ),
                Action::Collect { amount } => ("collect", Some(*amount as i64), None, None),
                Action::AllInCall { amount } => ("allin_call", Some(*amount as i64), None, None),
                Action::AllInBet { amount } => ("allin_bet", Some(*amount as i64), None, None),
                Action::AllInRaise { increment, to } => (
                    "allin_raise",
                    None,
                    Some(*increment as i64),
                    Some(*to as i64),
                ),
            };

            hand_actions_stmt.execute(params![
                hand.hand_id,
                street_order,
                street_name,
                idx as i64,
                pa.player_name,
                action_type,
                amount,
                increment_amount,
                to_amount,
            ])?;
        }
    }

    // ── hole_cards row (hero only) ────────────────────────────────────────
    if let Some(hc) = &hand.hero_cards {
        let mut stmt = conn.prepare_cached(
            r#"INSERT OR IGNORE INTO hole_cards (hand_id, player_name, card1, card2)
               VALUES (?1,?2,?3,?4)"#,
        )?;
        stmt.execute(params![hand.hand_id, hc.player_name, hc.card1, hc.card2])?;
    }

    if let Some(showdown) = &hand.showdown {
        let mut stmt = conn.prepare_cached(
            r#"INSERT OR IGNORE INTO showdown_hole_cards (hand_id, player_name, card1, card2)
               VALUES (?1,?2,?3,?4)"#,
        )?;
        for shown in &showdown.shown_hands {
            stmt.execute(params![hand.hand_id, shown.player_name, shown.card1, shown.card2])?;
        }
    }

    // ── invariant_checks row ─────────────────────────────────────────────
    let errors_json = if report.errors.is_empty() {
        None
    } else {
        Some(serde_json::to_string(&report.errors).unwrap_or_default())
    };
    {
        let mut stmt = conn.prepare_cached(
            r#"INSERT INTO invariant_checks
               (hand_id, sum_invariant, chip_conservation, pot_match, errors_json)
               VALUES (?1,?2,?3,?4,?5)"#,
        )?;
        stmt.execute(params![
            hand.hand_id,
            report.sum_invariant_ok as i64,
            report.chip_conservation_ok as i64,
            report.pot_match_ok as i64,
            errors_json,
        ])?;
    }

    // ── Expected EV (V0.2) for hero in contested all-in spots ────────────
    if let Some((net_ev, allin_equity)) = compute_hero_net_ev(hand, ledger, hero_name) {
        let mut stmt = conn.prepare_cached(
            r#"UPDATE hand_players
               SET net_ev = ?3, allin_equity = ?4
               WHERE hand_id = ?1 AND player_name = ?2 AND hero = 1"#,
        )?;
        stmt.execute(params![hand.hand_id, hero_name, net_ev, allin_equity])?;
    }

    Ok(true)
}

// ─── Import session ────────────────────────────────────────────────────────────

pub fn create_import_session(
    conn: &Connection,
    id: &str,
    hh_path: &str,
    hh_hash: Option<&str>,
    summary_path: Option<&str>,
) -> Result<(), rusqlite::Error> {
    let mut stmt = conn.prepare_cached(
        r#"INSERT INTO import_sessions (id, hh_file_path, hh_file_hash, summary_path)
           VALUES (?1,?2,?3,?4)"#,
    )?;
    stmt.execute(params![id, hh_path, hh_hash, summary_path])?;
    Ok(())
}

pub fn finish_import_session(
    conn: &Connection,
    id: &str,
    total: usize,
    parsed: usize,
    inserted: usize,
    skipped: usize,
    parse_errors: usize,
    invalid: usize,
    status: &str,
    error_msg: Option<&str>,
) -> Result<(), rusqlite::Error> {
    let mut stmt = conn.prepare_cached(
        r#"UPDATE import_sessions SET
               total_hands=?2, parsed_hands=?3, inserted_hands=?4,
               skipped_hands=?5, parse_errors=?6, invalid_hands=?7,
               status=?8, error_msg=?9,
               finished_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
           WHERE id=?1"#,
    )?;
    stmt.execute(params![id, total, parsed, inserted, skipped, parse_errors, invalid, status, error_msg])?;
    Ok(())
}

/// Remove all imported data so a full re-import can be performed on updated logic.
pub fn clear_all_imported_data(conn: &Connection) -> Result<ClearDataStats, rusqlite::Error> {
    let count = |table: &str| -> Result<i64, rusqlite::Error> {
        let sql = format!("SELECT COUNT(*) FROM {table}");
        conn.query_row(&sql, [], |r| r.get(0))
    };

    let stats = ClearDataStats {
        tournaments: count("tournaments")?,
        hands: count("hands")?,
        hand_players: count("hand_players")?,
        hand_actions: count("hand_actions")?,
        hole_cards: count("hole_cards")?,
        invariant_checks: count("invariant_checks")?,
        import_sessions: count("import_sessions")?,
    };

    conn.execute_batch(
        r#"
        BEGIN;
        DELETE FROM invariant_checks;
        DELETE FROM showdown_hole_cards;
        DELETE FROM hole_cards;
        DELETE FROM hand_actions;
        DELETE FROM hand_players;
        DELETE FROM hands;
        DELETE FROM tournaments;
        DELETE FROM import_sessions;
        COMMIT;
        "#,
    )?;

    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clear_all_imported_data_deletes_all_rows() {
        let conn = open_memory().expect("open memory db");

        conn.execute(
            r#"INSERT INTO tournaments
               (id, player_name, buy_in_euros, rake_euros, prizepool_euros, multiplier,
                registered_players, finish_position, started_at, duration_secs, net_eur)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)"#,
            params!["T1", "MRZO", 1.86_f64, 0.14_f64, 4.0_f64, 2_i64, 3_i64, 1_i64, "2026-06-09T13:52:25Z", 240_i64, 2.0_f64],
        )
        .expect("insert tournament");

        conn.execute(
            r#"INSERT INTO hands
               (id, tournament_id, table_name, game_name, buy_in_euros, rake_euros,
                level, small_blind, big_blind, button_seat, seat_count,
                timestamp, player_count, board_cards, has_showdown, hero_showed, rake_chips, total_pot)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)"#,
            params!["H1", "T1", "Table 1", "Holdem no limit", 1.86_f64, 0.14_f64, 1_i64, 10_i64, 20_i64, 1_i64, 2_i64, "2026-06-09T13:52:25Z", 2_i64, "[]", 0_i64, 0_i64, 0_i64, 40_i64],
        )
        .expect("insert hand");

        conn.execute(
            r#"INSERT INTO hand_players
               (hand_id, seat_number, player_name, starting_stack, ending_stack,
                contributions, collected, realized_cev, hero)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"#,
            params!["H1", 1_i64, "MRZO", 500_i64, 520_i64, 20_i64, 40_i64, 20_i64, 1_i64],
        )
        .expect("insert hand player");

        conn.execute(
            "INSERT INTO hole_cards (hand_id, player_name, card1, card2) VALUES (?1, ?2, ?3, ?4)",
            params!["H1", "MRZO", "Ah", "Kd"],
        )
        .expect("insert hole cards");

        conn.execute(
            "INSERT INTO showdown_hole_cards (hand_id, player_name, card1, card2) VALUES (?1, ?2, ?3, ?4)",
            params!["H1", "Villain", "Qs", "Qh"],
        )
        .expect("insert showdown hole cards");

        conn.execute(
            "INSERT INTO hand_actions (hand_id, street_order, street, action_index, player_name, action_type, amount, increment_amount, to_amount) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params!["H1", 0_i64, "preflop", 0_i64, "MRZO", "call", Some(20_i64), Option::<i64>::None, Option::<i64>::None],
        )
        .expect("insert hand action");

        conn.execute(
            "INSERT INTO invariant_checks (hand_id, sum_invariant, chip_conservation, pot_match, errors_json) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["H1", 1_i64, 1_i64, 1_i64, Option::<String>::None],
        )
        .expect("insert invariant checks");

        conn.execute(
            "INSERT INTO import_sessions (id, hh_file_path, status) VALUES (?1, ?2, ?3)",
            params!["S1", "/tmp/test.txt", "completed"],
        )
        .expect("insert import session");

        let stats = clear_all_imported_data(&conn).expect("clear all data");
        assert_eq!(stats.tournaments, 1);
        assert_eq!(stats.hands, 1);
        assert_eq!(stats.hand_players, 1);
        assert_eq!(stats.hand_actions, 1);
        assert_eq!(stats.hole_cards, 1);
        assert_eq!(stats.invariant_checks, 1);
        assert_eq!(stats.import_sessions, 1);

        let tables = [
            "tournaments",
            "hands",
            "hand_players",
            "hand_actions",
            "hole_cards",
            "invariant_checks",
            "import_sessions",
        ];

        for t in tables {
            let q = format!("SELECT COUNT(*) FROM {t}");
            let count: i64 = conn.query_row(&q, [], |r| r.get(0)).expect("count rows");
            assert_eq!(count, 0, "table {t} should be empty after clear");
        }
    }

    #[test]
    fn clearing_imported_history_preserves_personal_reviews_and_coach_goal() {
        let conn = open_memory().expect("open memory db");
        conn.execute(
            "INSERT INTO hand_reviews (hand_id, note, favorite, reviewed) VALUES ('H1', 'Revoir le call', 1, 0)",
            [],
        )
        .expect("insert personal review");
        conn.execute(
            "INSERT INTO hand_review_tags (hand_id, tag) VALUES ('H1', 'Call à tapis')",
            [],
        )
        .expect("insert review tag");
        conn.execute(
            "INSERT INTO coach_goal (id, goal) VALUES (1, 'Défense BB')",
            [],
        )
        .expect("insert coach goal");

        clear_all_imported_data(&conn).expect("clear imported history");

        let review_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM hand_reviews", [], |row| row.get(0))
            .expect("count personal reviews");
        let tag_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM hand_review_tags", [], |row| {
                row.get(0)
            })
            .expect("count personal review tags");
        let goal: String = conn
            .query_row("SELECT goal FROM coach_goal WHERE id = 1", [], |row| {
                row.get(0)
            })
            .expect("read coach goal");

        assert_eq!(review_count, 1);
        assert_eq!(tag_count, 1);
        assert_eq!(goal, "Défense BB");
    }

    #[test]
    fn opening_existing_db_backfills_ev_for_a_covered_opponent_all_in() {
        let file = tempfile::NamedTempFile::new().expect("temporary database");
        {
            let conn = Connection::open(file.path()).expect("open legacy database");
            conn.execute_batch(SCHEMA_V1).expect("create schema");
            ensure_schema_extensions(&conn).expect("add schema extensions");

            conn.execute(
                r#"INSERT INTO tournaments
                   (id, player_name, buy_in_euros, rake_euros, prizepool_euros, multiplier,
                    registered_players, finish_position, started_at, duration_secs, net_eur)
                   VALUES ('T1', 'MRZO', 2.0, 0.0, 4.0, 2, 2, 1, '2026-11-15T00:00:00Z', 300, 2.0)"#,
                [],
            )
            .expect("insert tournament");

            conn.execute(
                r#"INSERT INTO hands
                   (id, tournament_id, table_name, game_name, buy_in_euros, rake_euros,
                    level, small_blind, big_blind, button_seat, seat_count,
                    timestamp, player_count, board_cards, has_showdown, hero_showed, rake_chips, total_pot)
                   VALUES ('H1', 'T1', 'Table 1', 'Holdem no limit', 2.0, 0.0,
                           1, 10, 20, 2, 2, '2026-11-15T00:00:00Z', 2,
                           '["2c","3d","8h","9s","Kc"]', 1, 1, 0, 1000)"#,
                [],
            )
            .expect("insert hand");

            conn.execute(
                r#"INSERT INTO hand_players
                   (hand_id, seat_number, player_name, starting_stack, ending_stack,
                    contributions, collected, realized_cev, net_ev, allin_equity, hero)
                   VALUES ('H1', 1, 'MRZO', 1000, 1500, 500, 1000, 500, 500, NULL, 1),
                          ('H1', 2, 'Villain', 500, 0, 500, 0, -500, NULL, NULL, 0)"#,
                [],
            )
            .expect("insert hand players");

            conn.execute(
                "INSERT INTO hole_cards (hand_id, player_name, card1, card2) VALUES ('H1', 'MRZO', 'Ah', 'Kd')",
                [],
            )
            .expect("insert hero cards");

            conn.execute(
                r#"INSERT INTO showdown_hole_cards (hand_id, player_name, card1, card2)
                   VALUES ('H1', 'MRZO', 'Ah', 'Kd'), ('H1', 'Villain', 'Qc', 'Qs')"#,
                [],
            )
            .expect("insert showdown cards");

            conn.execute(
                r#"INSERT INTO hand_actions
                   (hand_id, street_order, street, action_index, player_name, action_type, amount)
                   VALUES ('H1', 3, 'river', 0, 'Villain', 'allin_bet', 480),
                          ('H1', 3, 'river', 1, 'MRZO', 'call', 480)"#,
                [],
            )
            .expect("insert hand actions");
        }

        let conn = open(file.path().to_str().expect("database path")).expect("open and migrate");
        let (net_ev, allin_equity): (Option<i64>, Option<f64>) = conn
            .query_row(
                "SELECT net_ev, allin_equity FROM hand_players WHERE hand_id = 'H1' AND hero = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read recalculated EV");

        assert_eq!(net_ev, Some(500));
        assert_eq!(allin_equity, Some(1.0));
    }
}
