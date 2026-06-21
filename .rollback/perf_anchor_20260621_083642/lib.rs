pub mod db;
pub mod ev;
pub mod schema;

use std::fs;
use std::path::Path;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use uuid::Uuid;

use hh_parser_winamax::{parse_hands, parse_tournament_summary};
use hand_ledger::compute_ledger;
use cev_realized_core::validate;

/// Default hero player name used across the app.
pub const DEFAULT_HERO: &str = "MRZO";

#[derive(Debug, Error)]
pub enum IngestError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("DB error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("Parse error: {0}")]
    Parse(#[from] hh_parser_winamax::ParseError),
}

/// Progress callback signature.
pub type ProgressFn = Box<dyn Fn(ImportProgress) + Send + 'static>;

/// Snapshot of import progress (sent to frontend via Tauri events).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportProgress {
    pub session_id: String,
    pub total_hands: usize,
    pub processed_hands: usize,
    pub inserted_hands: usize,
    pub skipped_hands: usize,
    pub parse_errors: usize,
    pub invalid_hands: usize,
    pub warnings: Vec<String>,
    pub done: bool,
    pub error: Option<String>,
}

/// Final import result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    pub session_id: String,
    pub total_hands: usize,
    pub inserted_hands: usize,
    pub skipped_hands: usize,
    pub parse_errors: usize,
    pub invalid_hands: usize,
}

/// Import a pair of Winamax files (HH + summary) into the database.
///
/// `hh_path`      – path to the hand history file (`*_no-limit.txt`)
/// `summary_path` – path to the summary file (`*_summary.txt`)
/// `db_path`      – path to the SQLite database file
/// `hero`         – tracked player name (e.g. "MRZO")
/// `on_progress`  – optional callback invoked after each batch of hands
pub fn import_tournament(
    hh_path: &str,
    summary_path: &str,
    db_path: &str,
    hero: &str,
    on_progress: Option<ProgressFn>,
) -> Result<ImportResult, IngestError> {
    let conn = db::open(db_path)?;
    import_tournament_with_conn(hh_path, summary_path, &conn, hero, on_progress)
}

pub fn import_tournament_with_conn(
    hh_path: &str,
    summary_path: &str,
    conn: &Connection,
    hero: &str,
    on_progress: Option<ProgressFn>,
) -> Result<ImportResult, IngestError> {
    let tx = conn.unchecked_transaction()?;
    let session_id = Uuid::new_v4().to_string();

    // ── Hash the HH file for idempotency ────────────────────────────────────
    let hh_content = fs::read(hh_path)?;
    let hash = hex::encode(Sha256::digest(&hh_content));

    // Check if this file was already imported
    let already: bool = tx
        .query_row(
            "SELECT 1 FROM import_sessions WHERE hh_file_hash = ?1 AND status = 'completed'",
            rusqlite::params![hash],
            |_| Ok(true),
        )
        .unwrap_or(false);

    if already {
        return Ok(ImportResult {
            session_id,
            total_hands: 0,
            inserted_hands: 0,
            skipped_hands: 0,
            parse_errors: 0,
            invalid_hands: 0,
        });
    }

    db::create_import_session(
        &tx,
        &session_id,
        hh_path,
        Some(&hash),
        Some(summary_path),
    )?;

    // ── Parse tournament summary (mandatory) ────────────────────────────────
    let summary_content = fs::read_to_string(summary_path)?;
    let ts = parse_tournament_summary(&summary_content)
        .map_err(|e| IngestError::Parse(e))?;
    db::upsert_tournament(&tx, &ts)?;

    // ── Parse hand history ──────────────────────────────────────────────────
    let hh_text = String::from_utf8_lossy(&hh_content);
    let (hands, warnings) = parse_hands(hh_text.as_bytes())?;

    // Ensure all hands use the tournament_id from the summary (source of truth)
    let mut hands = hands;
    for hand in &mut hands {
        hand.tournament_id = ts.tournament_id.clone();
    }

    let total = hands.len();
    let mut inserted = 0usize;
    let mut skipped = 0usize;
    let mut invalid = 0usize;

    for (i, hand) in hands.iter().enumerate() {
        let ledger = compute_ledger(hand);
        let report = validate(&ledger);

        if !report.all_ok() {
            invalid += 1;
            // Still insert – store the failed invariant in the DB for audit
        }

        match db::insert_hand_with_ledger(&tx, hand, &ledger, hero, &report)? {
            true => inserted += 1,
            false => skipped += 1,
        }

        // Emit progress every 50 hands
        if i % 50 == 0 || i == total - 1 {
            if let Some(cb) = &on_progress {
                cb(ImportProgress {
                    session_id: session_id.clone(),
                    total_hands: total,
                    processed_hands: i + 1,
                    inserted_hands: inserted,
                    skipped_hands: skipped,
                    parse_errors: warnings.len(),
                    invalid_hands: invalid,
                    warnings: warnings.clone(),
                    done: i == total - 1,
                    error: None,
                });
            }
        }
    }

    db::finish_import_session(
        &tx,
        &session_id,
        total,
        total,
        inserted,
        skipped,
        warnings.len(),
        invalid,
        "completed",
        None,
    )?;

    tx.commit()?;

    Ok(ImportResult {
        session_id,
        total_hands: total,
        inserted_hands: inserted,
        skipped_hands: skipped,
        parse_errors: warnings.len(),
        invalid_hands: invalid,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    const HH: &str = r#"Winamax Poker - Tournament "Expresso" buyIn: 1.86€ + 0.14€ level: 1 - HandId: #4829108511470256129-1-1780949140 - Holdem no limit (10/20) - 2026/06/08 20:05:40 UTC
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

    const SUMMARY: &str = r#"Winamax Poker - Tournament summary : Expresso(1124364443)
Player : MRZO
Buy-In : 1.86€ + 0.14€
Registered players : 3
Mode : sng
Type : sitngo
Speed : turbo
Flight ID : 0
Prizepool : 20€
Tournament started 2026/06/08 20:05:29 UTC
You played 5min 13s 
You finished in 2nd place
"#;

    #[test]
    fn test_import_in_memory() {
        let mut hh_file = NamedTempFile::new().unwrap();
        hh_file.write_all(HH.as_bytes()).unwrap();
        let mut sum_file = NamedTempFile::new().unwrap();
        sum_file.write_all(SUMMARY.as_bytes()).unwrap();

        let conn = db::open_memory().unwrap();
        let result = import_tournament_with_conn(
            hh_file.path().to_str().unwrap(),
            sum_file.path().to_str().unwrap(),
            &conn,
            DEFAULT_HERO,
            None,
        )
        .unwrap();

        assert_eq!(result.total_hands, 1);
        assert_eq!(result.inserted_hands, 1);
        assert_eq!(result.invalid_hands, 0);

        // Verify hand is in DB
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM hands", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);

        // Verify tournament is in DB
        let mult: i64 = conn
            .query_row(
                "SELECT multiplier FROM tournaments WHERE id = '1124364443'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(mult, 10);
    }

    #[test]
    fn test_idempotency() {
        let mut hh_file = NamedTempFile::new().unwrap();
        hh_file.write_all(HH.as_bytes()).unwrap();
        let mut sum_file = NamedTempFile::new().unwrap();
        sum_file.write_all(SUMMARY.as_bytes()).unwrap();

        let conn = db::open_memory().unwrap();
        let hh_path = hh_file.path().to_str().unwrap();
        let sum_path = sum_file.path().to_str().unwrap();

        // First import
        let r1 = import_tournament_with_conn(hh_path, sum_path, &conn, DEFAULT_HERO, None).unwrap();
        // Second import of same file → skipped (idempotent on file hash)
        let r2 = import_tournament_with_conn(hh_path, sum_path, &conn, DEFAULT_HERO, None).unwrap();

        assert_eq!(r1.inserted_hands, 1);
        assert_eq!(r2.total_hands, 0, "second import should be fully skipped");
    }
}
