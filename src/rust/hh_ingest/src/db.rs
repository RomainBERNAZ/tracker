use rusqlite::{Connection, params};
use serde_json;
use crate::schema::SCHEMA_V1;
use crate::ev::compute_hero_net_ev;
use hand_ledger::HandLedger;
use hh_parser_winamax::{Action, ParsedHand, StreetType, TournamentSummary};
use cev_realized_core::InvariantReport;

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
    Ok(conn)
}

/// Open an in-memory database (for testing).
pub fn open_memory() -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open_in_memory()?;
    conn.execute_batch(SCHEMA_V1)?;
    ensure_schema_extensions(&conn)?;
    Ok(conn)
}

fn ensure_schema_extensions(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Existing databases may miss V0.2 columns; add them lazily.
    for alter in [
        "ALTER TABLE hand_players ADD COLUMN net_ev INTEGER",
        "ALTER TABLE hand_players ADD COLUMN allin_equity REAL",
    ] {
        if let Err(e) = conn.execute(alter, []) {
            let msg = e.to_string();
            if !msg.contains("duplicate column name") {
                return Err(e);
            }
        }
    }
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
        let mut stmt = conn.prepare_cached(
            r#"INSERT INTO hands
               (id, tournament_id, table_name, game_name, buy_in_euros, rake_euros,
                level, small_blind, big_blind, button_seat, seat_count,
                timestamp, player_count, rake_chips, total_pot)
               VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)"#,
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

    // ── Expected EV (V0.2) for hero in heads-up all-in spots ─────────────
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
                timestamp, player_count, rake_chips, total_pot)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)"#,
            params!["H1", "T1", "Table 1", "Holdem no limit", 1.86_f64, 0.14_f64, 1_i64, 10_i64, 20_i64, 1_i64, 2_i64, "2026-06-09T13:52:25Z", 2_i64, 0_i64, 40_i64],
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
}
