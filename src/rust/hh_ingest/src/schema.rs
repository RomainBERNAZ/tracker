/// Embedded SQL schema – applied as a single migration on first open.
pub const SCHEMA_V1: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Tournaments ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tournaments (
    id                TEXT    PRIMARY KEY,   -- e.g. "1124364443"
    player_name       TEXT    NOT NULL,
    buy_in_euros      REAL    NOT NULL,
    rake_euros        REAL    NOT NULL,
    prizepool_euros   REAL    NOT NULL,
    multiplier        INTEGER NOT NULL,
    registered_players INTEGER NOT NULL,
    finish_position   INTEGER NOT NULL,
    started_at        TEXT    NOT NULL,      -- ISO-8601 UTC
    duration_secs     INTEGER NOT NULL,
    net_eur           REAL    NOT NULL,      -- prizepool if 1st else 0, minus buy-in total
    created_at        TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_tournaments_player    ON tournaments(player_name);
CREATE INDEX IF NOT EXISTS idx_tournaments_started   ON tournaments(started_at);

-- ── Hands ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hands (
    id              TEXT    PRIMARY KEY,    -- full hand_id
    tournament_id   TEXT    NOT NULL,
    table_name      TEXT    NOT NULL,
    game_name       TEXT    NOT NULL,
    buy_in_euros    REAL    NOT NULL,
    rake_euros      REAL    NOT NULL,
    level           INTEGER NOT NULL,
    small_blind     INTEGER NOT NULL,
    big_blind       INTEGER NOT NULL,
    button_seat     INTEGER NOT NULL,
    seat_count      INTEGER NOT NULL,
    timestamp       TEXT    NOT NULL,
    player_count    INTEGER NOT NULL,
    rake_chips      INTEGER NOT NULL DEFAULT 0,
    total_pot       INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
);

CREATE INDEX IF NOT EXISTS idx_hands_tournament ON hands(tournament_id);
CREATE INDEX IF NOT EXISTS idx_hands_timestamp  ON hands(timestamp);

-- ── Hand players ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hand_players (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    hand_id         TEXT    NOT NULL,
    seat_number     INTEGER NOT NULL,
    player_name     TEXT    NOT NULL,
    starting_stack  INTEGER NOT NULL,
    ending_stack    INTEGER NOT NULL,
    contributions   INTEGER NOT NULL,
    collected       INTEGER NOT NULL,
    realized_cev    INTEGER NOT NULL,   -- chips (ending - starting)
    net_ev          INTEGER,            -- expected EV in chips (V0.2)
    allin_equity    REAL,               -- hero equity at all-in point [0..1]
    hero            INTEGER NOT NULL DEFAULT 0,  -- 1 if this is MRZO
    FOREIGN KEY (hand_id) REFERENCES hands(id),
    UNIQUE (hand_id, seat_number)
);

CREATE INDEX IF NOT EXISTS idx_hp_hand   ON hand_players(hand_id);
CREATE INDEX IF NOT EXISTS idx_hp_player ON hand_players(player_name);

-- ── Hand actions timeline ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hand_actions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    hand_id          TEXT    NOT NULL,
    street_order     INTEGER NOT NULL, -- 0=preflop,1=flop,2=turn,3=river
    street           TEXT    NOT NULL,
    action_index     INTEGER NOT NULL,
    player_name      TEXT    NOT NULL,
    action_type      TEXT    NOT NULL,
    amount           INTEGER,
    increment_amount INTEGER,
    to_amount        INTEGER,
    FOREIGN KEY (hand_id) REFERENCES hands(id)
);

CREATE INDEX IF NOT EXISTS idx_ha_hand_street ON hand_actions(hand_id, street_order, action_index);

-- ── Hole cards (hero only) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hole_cards (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    hand_id     TEXT    NOT NULL UNIQUE,
    player_name TEXT    NOT NULL,
    card1       TEXT    NOT NULL,
    card2       TEXT    NOT NULL,
    FOREIGN KEY (hand_id) REFERENCES hands(id)
);

-- ── Invariant checks ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invariant_checks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    hand_id         TEXT    NOT NULL,
    sum_invariant   INTEGER NOT NULL,   -- 1=pass 0=fail
    chip_conservation INTEGER NOT NULL,
    pot_match       INTEGER NOT NULL,
    errors_json     TEXT,
    checked_at      TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    FOREIGN KEY (hand_id) REFERENCES hands(id)
);

CREATE INDEX IF NOT EXISTS idx_inv_hand   ON invariant_checks(hand_id);
CREATE INDEX IF NOT EXISTS idx_inv_failed ON invariant_checks(sum_invariant, chip_conservation, pot_match);

-- ── Import sessions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS import_sessions (
    id              TEXT    PRIMARY KEY,   -- UUID
    hh_file_path    TEXT    NOT NULL,
    hh_file_hash    TEXT,                  -- SHA-256
    summary_path    TEXT,
    total_hands     INTEGER,
    parsed_hands    INTEGER,
    inserted_hands  INTEGER,
    skipped_hands   INTEGER,
    parse_errors    INTEGER,
    invalid_hands   INTEGER,
    status          TEXT    NOT NULL DEFAULT 'in_progress',  -- in_progress|completed|failed
    error_msg       TEXT,
    started_at      TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    finished_at     TEXT
);
"#;
