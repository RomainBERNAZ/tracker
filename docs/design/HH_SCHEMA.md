# Hand History Schema & DB Design

## Canonical Hand History Format

All hand histories (regardless of source room) are normalized into this canonical format for processing.

```rust
pub struct CanonicalHand {
    pub hand_id: String,              // Unique identifier
    pub room: String,                 // "Winamax", "PokerStars", etc.
    pub table_name: String,           // Table ID or name
    pub game_type: GameType,          // "Expresso 3x", "Spin & Go", etc.
    pub stakes: Stakes,
    pub button_pos: usize,            // 0, 1, or 2 (for 3-handed)
    pub timestamp: DateTime<Utc>,     // Hand start time
    pub players: Vec<CanonicalPlayer>,
    pub action_timeline: Vec<CanonicalAction>,
    pub showdown: Option<Showdown>,
    pub final_payouts: Vec<FinalPayout>,
    pub rake_taken: f64,
}

pub struct Stakes {
    pub ante: f64,
    pub small_blind: f64,
    pub big_blind: f64,
    pub currency: String,             // "chips", "USD", etc.
}

pub struct CanonicalPlayer {
    pub position: usize,              // 0=SB, 1=BB, 2=BTN (for 3-handed)
    pub seat: usize,                  // Physical seat at table
    pub name: String,
    pub starting_stack: f64,
    pub final_stack: f64,
}

pub struct CanonicalAction {
    pub street: Street,               // Preflop, Flop, Turn, River
    pub player_pos: usize,
    pub action_type: ActionType,      // Bet, Raise, Call, Check, Fold, AllIn
    pub amount: f64,
    pub pot_size_after: f64,
    pub player_stack_after: f64,      // Stack remaining for that player
}

pub struct Showdown {
    pub hole_cards: Vec<(usize, (Card, Card))>,  // (position, (card1, card2))
}

pub struct FinalPayout {
    pub position: usize,
    pub amount: f64,                  // Chips won
}
```

---

## Database Schema (SQLite)

### Tables

#### `hands`
Core hand record.

```sql
CREATE TABLE hands (
  id TEXT PRIMARY KEY,              -- hand_id from canonical
  room TEXT NOT NULL,               -- "Winamax"
  table_name TEXT NOT NULL,
  game_type TEXT NOT NULL,          -- "Expresso 3x"
  stake_ante REAL NOT NULL,
  stake_sb REAL NOT NULL,
  stake_bb REAL NOT NULL,
  button_pos INT NOT NULL,          -- 0, 1, 2
  timestamp DATETIME NOT NULL,      -- Hand start time
  player_count INT NOT NULL,        -- 3 for now
  rake_taken REAL NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_hands_timestamp ON hands(timestamp);
CREATE INDEX idx_hands_room ON hands(room);
CREATE INDEX idx_hands_game_type ON hands(game_type);
```

#### `hand_players`
Player participation in each hand.

```sql
CREATE TABLE hand_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hand_id TEXT NOT NULL,
  position INT NOT NULL,            -- 0=SB, 1=BB, 2=BTN
  seat INT NOT NULL,
  player_name TEXT NOT NULL,
  starting_stack REAL NOT NULL,
  final_stack REAL NOT NULL,
  FOREIGN KEY (hand_id) REFERENCES hands(id),
  UNIQUE (hand_id, position)
);

CREATE INDEX idx_hand_players_hand ON hand_players(hand_id);
CREATE INDEX idx_hand_players_name ON hand_players(player_name);
```

#### `hand_actions`
Timeline of actions.

```sql
CREATE TABLE hand_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hand_id TEXT NOT NULL,
  action_number INT NOT NULL,       -- 1, 2, 3, ... (order)
  street TEXT NOT NULL,             -- "Preflop", "Flop", "Turn", "River"
  player_pos INT NOT NULL,          -- 0, 1, 2
  action_type TEXT NOT NULL,        -- "Bet", "Raise", "Call", "Check", "Fold", "AllIn"
  amount REAL NOT NULL,             -- chips
  pot_size_after REAL NOT NULL,
  player_stack_after REAL NOT NULL,
  FOREIGN KEY (hand_id) REFERENCES hands(id)
);

CREATE INDEX idx_hand_actions_hand ON hand_actions(hand_id);
CREATE INDEX idx_hand_actions_street ON hand_actions(street);
```

#### `hand_showdown`
Hole cards (if shown).

```sql
CREATE TABLE hand_showdown (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hand_id TEXT NOT NULL,
  player_pos INT NOT NULL,
  card1 TEXT NOT NULL,              -- "As", "Kh", etc.
  card2 TEXT NOT NULL,
  FOREIGN KEY (hand_id) REFERENCES hands(id),
  UNIQUE (hand_id, player_pos)
);

CREATE INDEX idx_hand_showdown_hand ON hand_showdown(hand_id);
```

#### `ledgers`
Player ledger per hand (computed).

```sql
CREATE TABLE ledgers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hand_id TEXT NOT NULL,
  player_pos INT NOT NULL,
  starting_stack REAL NOT NULL,
  contributions REAL NOT NULL,      -- Total bet
  payouts REAL NOT NULL,            -- Total won
  ending_stack REAL NOT NULL,       -- Should equal start + payout - contribution
  realized_cev REAL NOT NULL,       -- end - start
  FOREIGN KEY (hand_id) REFERENCES hands(id),
  UNIQUE (hand_id, player_pos)
);

CREATE INDEX idx_ledgers_hand ON ledgers(hand_id);
```

#### `invariant_checks`
Validation log (for debugging & audit trail).

```sql
CREATE TABLE invariant_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hand_id TEXT NOT NULL,
  check_type TEXT NOT NULL,         -- "sum_invariant", "chip_invariant", "side_pot_integrity"
  passed BOOLEAN NOT NULL,
  tolerance REAL,
  actual_value REAL,
  expected_value REAL,
  details TEXT,                     -- JSON error details if failed
  checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hand_id) REFERENCES hands(id)
);

CREATE INDEX idx_invariant_checks_hand ON invariant_checks(hand_id);
CREATE INDEX idx_invariant_checks_passed ON invariant_checks(passed);
```

#### `import_sessions`
Track imports (idempotency, resumability).

```sql
CREATE TABLE import_sessions (
  id TEXT PRIMARY KEY,              -- UUID
  file_path TEXT NOT NULL,
  file_hash TEXT,                   -- SHA256 of file (for idempotency)
  total_hands INT,
  parsed_hands INT,
  inserted_hands INT,
  parse_errors INT,
  invalid_hands INT,
  status TEXT,                      -- "in_progress", "completed", "failed"
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  error_log TEXT,                   -- JSON array of errors
  metrics_json TEXT                 -- Performance metrics (JSON)
);

CREATE INDEX idx_import_sessions_status ON import_sessions(status);
CREATE INDEX idx_import_sessions_file_hash ON import_sessions(file_hash);
```

---

## Winamax Parser Output → Canonical

### Winamax Format Example

```
PokerStars Hand #12345678901: Expresso 0.50/1.00 USD - 2026-06-19 12:34:56 UTC
Table 'Awesome' 3-max Seat #1 is the button
Seat 1: PlayerA (100 in chips)
Seat 2: PlayerB (150 in chips)
Seat 3: PlayerC (200 in chips)
PlayerB: posts small blind 0.50
PlayerC: posts big blind 1.00
*** HOLE CARDS ***
PlayerA: raises 2.00 to 3.00
PlayerB: folds
PlayerC: calls 2.00
*** FLOP *** [2s 5h 8d]
PlayerC: checks
PlayerA: bets 5.00
PlayerC: calls 5.00
*** TURN *** [2s 5h 8d Kc]
PlayerC: checks
PlayerA: checks
*** RIVER *** [2s 5h 8d Kc 3s]
PlayerC: checks
PlayerA: checks
*** SHOWDOWN ***
PlayerC: shows [Qs 9c] (high card King)
PlayerA: shows [As Kd] (pair of Kings)
PlayerA collected 16.00 from pot
```

### Mapping to Canonical

| Winamax | Canonical |
|---------|-----------|
| Hand #12345678901 | `hand_id = "12345678901"` |
| "Expresso 0.50/1.00 USD" | `stakes = {ante: 0, sb: 0.5, bb: 1.0}` |
| "3-max" | `game_type = "Expresso 3x"` |
| Seat 1 is button | `button_pos = 0` (PlayerA) |
| Seat mapping | `position = (seat - 1 - button_pos) % 3` |
| "PlayerB: posts small blind 0.50" | `action = {player_pos: 1, type: "Blind", amount: 0.5}` |
| "PlayerA: raises 2.00 to 3.00" | `action = {player_pos: 0, type: "Raise", amount: 3.0}` |
| "*** SHOWDOWN ***" | `showdown = {cards: [...]}` |
| "PlayerA collected 16.00" | `payout = {player_pos: 0, amount: 16.0}` |

---

## DB Queries for App

### Session Summary
```sql
SELECT
  DATE(h.timestamp) AS session_date,
  COUNT(*) AS hand_count,
  SUM(l.realized_cev) AS total_cev,
  AVG(l.realized_cev) AS avg_cev_per_hand,
  MIN(h.timestamp) AS session_start,
  MAX(h.timestamp) AS session_end
FROM hands h
JOIN ledgers l ON h.id = l.hand_id
WHERE h.timestamp >= ? AND h.timestamp < ?
GROUP BY DATE(h.timestamp)
ORDER BY h.timestamp DESC;
```

### Hand Details
```sql
SELECT
  h.id AS hand_id,
  h.table_name,
  h.timestamp,
  GROUP_CONCAT(hp.player_name, ', ') AS players,
  COUNT(ha.id) AS action_count,
  SUM(CASE WHEN ha.action_type = 'Bet' THEN ha.amount ELSE 0 END) AS total_bets
FROM hands h
LEFT JOIN hand_players hp ON h.id = hp.hand_id
LEFT JOIN hand_actions ha ON h.id = ha.hand_id
WHERE h.id = ?
GROUP BY h.id;
```

### Realized cEV per Hand
```sql
SELECT
  hp.player_name,
  hp.position,
  l.starting_stack,
  l.ending_stack,
  l.realized_cev
FROM ledgers l
JOIN hand_players hp ON l.hand_id = hp.hand_id AND l.player_pos = hp.position
WHERE l.hand_id = ?
ORDER BY hp.position;
```

---

## Idempotency Strategy

To prevent duplicate inserts on reimport:

1. **Hand ID as primary key**: Each hand has unique `hand_id` from room logs
2. **File hash tracking**: Store SHA256 of imported file in `import_sessions`
3. **Insert logic**:
   ```sql
   INSERT OR REPLACE INTO hands (...) VALUES (...);
   ```
   This allows reimport of same file with no duplicates (update-on-conflict)

4. **Deduplication query**:
   ```sql
   SELECT id FROM hands WHERE id IN (...)
   ```
   Check if hands already exist before insert

---

## Constraints & Indexes

### Constraints
- `hands.id` → PRIMARY KEY
- `hand_players.hand_id` → FOREIGN KEY `hands.id`
- `hand_players.hand_id + position` → UNIQUE
- `ledgers.hand_id + player_pos` → UNIQUE

### Indexes (for query perf)
- `hands(timestamp)` → Query by date range
- `hand_players(player_name)` → Search by player
- `ledgers(hand_id)` → Fetch ledger per hand
- `import_sessions(file_hash)` → Idempotency check
- `invariant_checks(passed)` → Find failed validations

---

## Migration & Versioning

Use a simple version table to track schema migrations:

```sql
CREATE TABLE schema_version (
  version INT PRIMARY KEY,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  description TEXT
);

INSERT INTO schema_version (version, description) VALUES
(1, 'Initial schema: hands, hand_players, hand_actions, ledgers, invariant_checks');
```

On app startup:
1. Check `schema_version`
2. Apply pending migrations if needed
3. Log migration success

---

## Performance Tuning

### WAL Mode (Write-Ahead Log)
```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;  -- vs FULL (safer but slower)
PRAGMA cache_size = -64000;   -- 64MB cache
```

### Batch Insert Optimization
```sql
PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;
-- Insert 1000 rows
COMMIT;
PRAGMA foreign_keys = ON;
```

### Analyze for Query Planner
```sql
ANALYZE;
```

Run periodically to update statistics for query optimizer.

---

**Last updated**: 2026-06-19  
**Owner**: Backend Lead
