use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use thiserror::Error;

const MAX_CENTS: i64 = 9_007_199_254_740_991;

#[derive(Debug, Error)]
pub enum BankrollError {
    #[error(transparent)]
    Database(#[from] rusqlite::Error),
    #[error("{0}")]
    Invalid(String),
    #[error("La bankroll n'est pas encore initialisee.")]
    NotInitialized,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BankrollSettings {
    pub warning_buy_ins: i64,
    pub shot_buy_ins: i64,
    pub strong_shot_buy_ins: i64,
    pub min_cev: f64,
    pub min_sample: i64,
    pub target_buy_in_cents: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MovementKind {
    Deposit,
    Withdrawal,
    Correction,
}

#[derive(Debug, Clone, Serialize)]
pub struct BankrollMovement {
    pub id: i64,
    pub kind: String,
    pub amount_cents: i64,
    pub note: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BankrollSnapshot {
    pub opening_balance_cents: i64,
    pub current_balance_cents: i64,
    pub imported_profit_cents: i64,
    pub movement_total_cents: i64,
    pub created_at: String,
    pub settings: BankrollSettings,
    pub movements: Vec<BankrollMovement>,
}

fn invalid(message: &str) -> BankrollError {
    BankrollError::Invalid(message.to_string())
}

fn valid_amount(amount: i64) -> Result<(), BankrollError> {
    if !(0..=MAX_CENTS).contains(&amount) {
        return Err(invalid(
            "Le montant doit etre positif ou nul, en centimes exacts.",
        ));
    }
    Ok(())
}

pub fn get_bankroll(conn: &Connection) -> Result<Option<BankrollSnapshot>, BankrollError> {
    let account = conn
        .query_row(
            "SELECT opening_balance_cents, created_at, warning_buy_ins, shot_buy_ins,
                strong_shot_buy_ins, min_cev, min_sample, target_buy_in_cents
         FROM bankroll_account WHERE id = 1",
            [],
            |row| {
                Ok(BankrollSnapshot {
                    opening_balance_cents: row.get(0)?,
                    created_at: row.get(1)?,
                    settings: BankrollSettings {
                        warning_buy_ins: row.get(2)?,
                        shot_buy_ins: row.get(3)?,
                        strong_shot_buy_ins: row.get(4)?,
                        min_cev: row.get(5)?,
                        min_sample: row.get(6)?,
                        target_buy_in_cents: row.get(7)?,
                    },
                    current_balance_cents: 0,
                    imported_profit_cents: 0,
                    movement_total_cents: 0,
                    movements: Vec::new(),
                })
            },
        )
        .optional()?;
    let Some(mut account) = account else {
        return Ok(None);
    };
    account.imported_profit_cents = conn.query_row(
        "SELECT COALESCE(SUM(CAST(ROUND(t.net_eur * 100) AS INTEGER)), 0)
         FROM tournaments t WHERE NOT EXISTS (
             SELECT 1 FROM bankroll_baseline b WHERE b.tournament_id = t.id
         )",
        [],
        |row| row.get(0),
    )?;
    let mut statement = conn.prepare(
        "SELECT id, kind, amount_cents, note, created_at FROM bankroll_movements ORDER BY id DESC",
    )?;
    account.movements = statement
        .query_map([], |row| {
            Ok(BankrollMovement {
                id: row.get(0)?,
                kind: row.get(1)?,
                amount_cents: row.get(2)?,
                note: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for movement in &account.movements {
        account.movement_total_cents = account
            .movement_total_cents
            .checked_add(movement.amount_cents)
            .ok_or_else(|| invalid("Total monetaire trop eleve."))?;
    }
    account.current_balance_cents = account
        .opening_balance_cents
        .checked_add(account.imported_profit_cents)
        .and_then(|balance| balance.checked_add(account.movement_total_cents))
        .filter(|balance| (-MAX_CENTS..=MAX_CENTS).contains(balance))
        .ok_or_else(|| invalid("Total monetaire trop eleve."))?;
    Ok(Some(account))
}

fn require_bankroll(conn: &Connection) -> Result<BankrollSnapshot, BankrollError> {
    get_bankroll(conn)?.ok_or(BankrollError::NotInitialized)
}

pub fn initialize_bankroll(
    conn: &Connection,
    amount_cents: i64,
) -> Result<BankrollSnapshot, BankrollError> {
    valid_amount(amount_cents)?;
    let transaction = conn.unchecked_transaction()?;
    if get_bankroll(&transaction)?.is_some() {
        return Err(invalid(
            "La bankroll est deja initialisee. Utilisez une correction du solde.",
        ));
    }
    transaction.execute(
        "INSERT INTO bankroll_account (id, opening_balance_cents) VALUES (1, ?1)",
        [amount_cents],
    )?;
    transaction.execute(
        "INSERT INTO bankroll_baseline SELECT id FROM tournaments",
        [],
    )?;
    let account = require_bankroll(&transaction)?;
    transaction.commit()?;
    Ok(account)
}

pub fn record_movement(
    conn: &Connection,
    kind: MovementKind,
    amount_cents: i64,
    note: &str,
) -> Result<BankrollSnapshot, BankrollError> {
    valid_amount(amount_cents)?;
    if note.chars().count() > 250 {
        return Err(invalid("La note est limitee a 250 caracteres."));
    }
    let transaction = conn.unchecked_transaction()?;
    let account = require_bankroll(&transaction)?;
    let delta = match kind {
        MovementKind::Deposit if amount_cents > 0 => amount_cents,
        MovementKind::Withdrawal
            if amount_cents > 0 && amount_cents <= account.current_balance_cents =>
        {
            -amount_cents
        }
        MovementKind::Correction => amount_cents
            .checked_sub(account.current_balance_cents)
            .ok_or_else(|| invalid("Montant de correction trop eleve."))?,
        _ => {
            return Err(invalid(
                "Montant nul ou retrait superieur au solde disponible.",
            ))
        }
    };
    if !(-MAX_CENTS..=MAX_CENTS).contains(&delta) {
        return Err(invalid("Montant de mouvement trop eleve."));
    }
    if delta == 0 {
        return Err(invalid("Ce montant correspond deja au solde actuel."));
    }
    let kind = match kind {
        MovementKind::Deposit => "deposit",
        MovementKind::Withdrawal => "withdrawal",
        MovementKind::Correction => "correction",
    };
    transaction.execute(
        "INSERT INTO bankroll_movements (kind, amount_cents, note) VALUES (?1, ?2, ?3)",
        params![kind, delta, note.trim()],
    )?;
    let account = require_bankroll(&transaction)?;
    transaction.commit()?;
    Ok(account)
}

pub fn save_settings(
    conn: &Connection,
    settings: &BankrollSettings,
) -> Result<BankrollSnapshot, BankrollError> {
    if settings.warning_buy_ins <= 0
        || settings.shot_buy_ins > 10_000
        || settings.strong_shot_buy_ins < settings.warning_buy_ins
        || settings.shot_buy_ins < settings.strong_shot_buy_ins
        || !settings.min_cev.is_finite()
        || !(0.0..=1000.0).contains(&settings.min_cev)
        || !(1..=1000).contains(&settings.min_sample)
    {
        return Err(invalid("Seuils invalides : alerte <= shot confirme <= shot standard, echantillon de 1 a 1000, cEV de 0 a 1000."));
    }
    if let Some(target) = settings.target_buy_in_cents {
        valid_amount(target)?;
        if target == 0 {
            return Err(invalid("Le buy-in vise doit etre strictement positif."));
        }
    }
    let transaction = conn.unchecked_transaction()?;
    if transaction.execute(
        "UPDATE bankroll_account SET warning_buy_ins = ?1, shot_buy_ins = ?2,
         strong_shot_buy_ins = ?3, min_cev = ?4, min_sample = ?5, target_buy_in_cents = ?6 WHERE id = 1",
        params![settings.warning_buy_ins, settings.shot_buy_ins, settings.strong_shot_buy_ins,
            settings.min_cev, settings.min_sample, settings.target_buy_in_cents],
    )? != 1 {
        return Err(BankrollError::NotInitialized);
    }
    let account = require_bankroll(&transaction)?;
    transaction.commit()?;
    Ok(account)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tournament(conn: &Connection, id: &str, net: f64) {
        conn.execute(
            "INSERT OR IGNORE INTO tournaments (
                id, player_name, buy_in_euros, rake_euros, prizepool_euros, multiplier,
                registered_players, finish_position, started_at, duration_secs, net_eur
             ) VALUES (?1, 'Hero', 1.8, 0.2, 6, 3, 3, 1, '2026-01-01T12:00:00Z', 60, ?2)",
            params![id, net],
        )
        .expect("insert tournament");
    }

    #[test]
    fn opening_balance_already_includes_known_tournaments_and_reimports_are_idempotent() {
        let conn = crate::db::open_memory().expect("database");
        tournament(&conn, "before", 45.25);
        assert!(get_bankroll(&conn).expect("unconfigured").is_none());
        assert_eq!(
            initialize_bankroll(&conn, 100_000)
                .expect("initialize")
                .current_balance_cents,
            100_000
        );
        tournament(&conn, "after", -2.0);
        tournament(&conn, "after", -2.0);
        assert_eq!(
            require_bankroll(&conn)
                .expect("one loss")
                .current_balance_cents,
            99_800
        );
        conn.execute(
            "UPDATE tournaments SET net_eur = 4.2 WHERE id = 'after'",
            [],
        )
        .expect("correct imported result");
        assert_eq!(
            require_bankroll(&conn)
                .expect("correct result")
                .current_balance_cents,
            100_420
        );
        assert!(initialize_bankroll(&conn, 1).is_err());
        assert_eq!(
            require_bankroll(&conn)
                .expect("unchanged baseline")
                .current_balance_cents,
            100_420
        );
        conn.execute("DELETE FROM tournaments WHERE id = 'before'", [])
            .expect("remove old history");
        tournament(&conn, "before", 45.25);
        assert_eq!(
            require_bankroll(&conn)
                .expect("old reimport")
                .current_balance_cents,
            100_420
        );
    }

    #[test]
    fn deposits_withdrawals_and_exact_balance_corrections_are_atomic_in_cents() {
        let conn = crate::db::open_memory().expect("database");
        initialize_bankroll(&conn, 100_000).expect("initialize");
        tournament(&conn, "new", 0.29);
        assert_eq!(
            record_movement(&conn, MovementKind::Deposit, 10_001, "deposit")
                .expect("deposit")
                .current_balance_cents,
            110_030
        );
        assert_eq!(
            record_movement(&conn, MovementKind::Withdrawal, 25_002, "withdrawal")
                .expect("withdrawal")
                .current_balance_cents,
            85_028
        );
        assert_eq!(
            record_movement(&conn, MovementKind::Correction, 75_005, "exact balance")
                .expect("correction")
                .current_balance_cents,
            75_005
        );
        assert!(record_movement(&conn, MovementKind::Withdrawal, 75_006, "").is_err());
        assert!(record_movement(&conn, MovementKind::Deposit, 0, "").is_err());
        assert!(record_movement(&conn, MovementKind::Correction, -1, "").is_err());
        let account = require_bankroll(&conn).expect("unchanged after errors");
        assert_eq!(account.current_balance_cents, 75_005);
        assert_eq!(account.movements.len(), 3);
        tournament(&conn, "later", -2.0);
        assert_eq!(
            require_bankroll(&conn)
                .expect("next import")
                .current_balance_cents,
            74_805
        );
    }

    #[test]
    fn settings_and_account_survive_database_reopen_and_invalid_settings_do_not_replace_them() {
        let directory = tempfile::tempdir().expect("temporary database");
        let path = directory.path().join("bankroll.sqlite");
        let path = path.to_str().expect("database path");
        let settings;
        {
            let conn = crate::db::open(path).expect("database");
            let account = initialize_bankroll(&conn, 50_000).expect("initialize");
            settings = BankrollSettings {
                target_buy_in_cents: Some(500),
                min_cev: 60.0,
                ..account.settings
            };
            save_settings(&conn, &settings).expect("save settings");
            let invalid = BankrollSettings {
                strong_shot_buy_ins: 100,
                ..settings.clone()
            };
            assert!(save_settings(&conn, &invalid).is_err());
            record_movement(&conn, MovementKind::Withdrawal, 10_000, "cashout").expect("cashout");
        }
        let conn = crate::db::open(path).expect("reopen");
        let account = require_bankroll(&conn).expect("persisted account");
        assert_eq!(account.current_balance_cents, 40_000);
        assert_eq!(account.settings.target_buy_in_cents, Some(500));
        assert_eq!(account.settings.min_cev, 60.0);
        assert_eq!(account.movements[0].note, "cashout");
    }
}
