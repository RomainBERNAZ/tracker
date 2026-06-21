# Architecture Overview

## System Design

Expresso Review App is structured as a **modular, event-driven system** with clear separation between domain logic, data persistence, and UI.

```
┌─────────────────────────────────────────────────────────────┐
│                      UI Layer (React/Tauri)                 │
│  ┌──────────────┬──────────────┬──────────────┐             │
│  │ Import       │ Sessions     │ Hand Detail  │             │
│  │ Screen       │ List         │ + cEV Panel  │             │
│  └──────────────┴──────────────┴──────────────┘             │
└─────────────────────────────────────────────────────────────┘
                          ↕ IPC (Tauri)
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                        │
│  ┌──────────────┬──────────────┬──────────────┐             │
│  │ hh_ingest    │ session_read │ IPC Handlers │             │
│  │ (orchestrate)│ _model       │              │             │
│  └──────────────┴──────────────┴──────────────┘             │
└─────────────────────────────────────────────────────────────┘
                          ↕
┌─────────────────────────────────────────────────────────────┐
│                     Core Domain Layer                       │
│  ┌──────────────┬──────────────┬──────────────┐             │
│  │ hh_parser_   │ hand_ledger  │ cev_realized │             │
│  │ winamax      │ (split calc) │ _core        │             │
│  └──────────────┴──────────────┴──────────────┘             │
│            Pure logic, testable, no I/O                     │
└─────────────────────────────────────────────────────────────┘
                          ↕ SQL
┌─────────────────────────────────────────────────────────────┐
│                   Data Persistence                          │
│         SQLite (local, WAL mode, indexed)                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Modules

### 1. `hh_parser_winamax`
**Responsibility**: Parse Winamax hand history format into canonical domain objects.

- **Input**: Raw Winamax hand history text (streaming)
- **Output**: `ParsedHand` (canonical struct)
- **Rules**:
  - Streaming, incremental parsing
  - Collect errors without stopping
  - Zero I/O (pure functions)
  - Recoverable from malformed input

**Key Types**:
```rust
pub struct ParsedHand {
    pub hand_id: String,
    pub table_name: String,
    pub game_type: GameType,        // "Expresso 3x"
    pub stakes: Stakes,              // (ante, blind, blind)
    pub button_pos: usize,
    pub players: Vec<Player>,        // position, stack, seat
    pub actions: Vec<Action>,        // timeline of bets/folds
    pub showdown: Option<Showdown>,  // cards if reached
    pub rake_taken: f64,
    pub timestamp: DateTime<Utc>,
}

pub struct Action {
    pub street: Street,              // Preflop, Flop, Turn, River
    pub player_pos: usize,
    pub action_type: ActionType,     // Bet, Raise, Call, Check, Fold, AllIn
    pub amount: f64,                 // Blind units or chips
    pub pot_size: f64,               // After action
}
```

**Tests**: Unit tests for each Winamax action pattern, edge cases (all-in, rake, etc.)

---

### 2. `hand_ledger`
**Responsibility**: Track player contributions and calculate payouts (with side pot handling).

- **Input**: `ParsedHand` (canonical)
- **Output**: `HandLedger` (per-player contributions, chips won/lost)
- **Rules**:
  - All-in detection & side pot creation
  - 2-way and 3-way split calculations
  - Odd chip handling (room policy)
  - Zero rounding errors

**Key Types**:
```rust
pub struct HandLedger {
    pub hand_id: String,
    pub players: Vec<PlayerLedger>,
}

pub struct PlayerLedger {
    pub position: usize,
    pub start_stack: f64,
    pub end_stack: f64,
    pub contributions: f64,           // Total bet into hand
    pub payout: f64,                  // Total won from pot(s)
    pub is_winner: bool,              // Showdown or last standing
}

pub struct SidePot {
    pub level: usize,
    pub total: f64,
    pub eligible_players: Vec<usize>,  // positions
    pub payouts: Vec<(usize, f64)>,   // (position, amount) after split
}
```

**Tests**: 2-way splits, 3-way splits, all-in scenarios, odd chips, rake handling.

---

### 3. `cev_realized_core`
**Responsibility**: Calculate realized cEV for each hand.

- **Input**: `HandLedger`
- **Output**: `HandcEV` (per-player realized cEV)
- **Formula**: $cEV_{realized} = stack_{end} - stack_{start}$

**Key Types**:
```rust
pub struct HandcEV {
    pub hand_id: String,
    pub players: Vec<PlayercEV>,
}

pub struct PlayercEV {
    pub position: usize,
    pub start_stack: f64,
    pub end_stack: f64,
    pub realized_cev: f64,            // end_stack - start_stack
}

pub struct Invariants {
    pub sum_cev_excl_rake: f64,       // Should be ~0
    pub chips_lost: Option<f64>,      // Should be None (0)
    pub rake_accounted: f64,          // Rake from session
}
```

**Validation**:
- Sum invariant: $\sum(cEV) + rake \approx 0$ (±0.01 tolerance)
- Chip invariant: No chips created/lost
- Side pot invariant: All chips accounted for

**Tests**: Reference test cases (golden dataset), edge cases, invariant checks.

---

### 4. `hh_ingest`
**Responsibility**: Orchestrate file import pipeline (parse → validate → insert → invariants).

- **Input**: File path (Winamax .txt)
- **Output**: Import result (hands inserted, errors, metrics)
- **Flow**:
  1. Open file (streaming reader)
  2. Parse incrementally
  3. Normalize to canonical schema
  4. Batch insert to DB (1k hands/batch)
  5. Post-validation (invariants)
  6. Report progress & metrics

**Key Types**:
```rust
pub struct ImportConfig {
    pub batch_size: usize,              // 1000
    pub idempotency_check: bool,        // true
    pub error_tolerance: f64,           // 0.005 (0.5%)
}

pub struct ImportResult {
    pub total_hands: usize,
    pub inserted_hands: usize,
    pub parse_errors: usize,
    pub invalid_hands: usize,
    pub duration_secs: f64,
    pub hands_per_sec: f64,
    pub metrics: ImportMetrics,
}

pub struct ImportMetrics {
    pub parse_p50_ms: f64,
    pub parse_p95_ms: f64,
    pub parse_p99_ms: f64,
    pub insert_batch_p50_ms: f64,
    pub insert_batch_p95_ms: f64,
    pub peak_memory_mb: f64,
}
```

**Tests**: End-to-end pipeline, idempotency, error recovery, perf gates.

---

### 5. `session_read_model`
**Responsibility**: Query layer for sessions, hands, and aggregates.

- **Input**: DB queries (SQL)
- **Output**: DTOs for UI (sessions, hand lists, hand details)

**Key Queries**:
```rust
pub fn get_sessions(db: &Db) -> Result<Vec<SessionSummary>>;
pub fn get_hands_by_session(db: &Db, session_id: &str) -> Result<Vec<HandSummary>>;
pub fn get_hand_detail(db: &Db, hand_id: &str) -> Result<HandDetail>;
```

**DTOs**:
```rust
pub struct SessionSummary {
    pub id: String,
    pub date: DateTime<Utc>,
    pub game_type: String,
    pub hand_count: usize,
    pub total_cev: f64,               // Sum of all cEV in session
    pub avg_cev_per_hand: f64,
}

pub struct HandDetail {
    pub hand_id: String,
    pub table_name: String,
    pub action_timeline: Vec<ActionDisplay>,
    pub ledger: Vec<PlayerLedgerDisplay>,
    pub realized_cev: Vec<PlayercEVDisplay>,
    pub invariants: InvariantSummary,
}
```

**Tests**: Query correctness, aggregation accuracy.

---

### 6. `ui_shell` (Tauri + React)
**Responsibility**: Desktop UI and IPC bridge.

#### Tauri Commands (IPC)
```rust
#[tauri::command]
async fn import_hand_history(file_path: String, config: ImportConfig) -> Result<ImportResult>;

#[tauri::command]
async fn get_sessions() -> Result<Vec<SessionSummary>>;

#[tauri::command]
async fn get_hands_by_session(session_id: String) -> Result<Vec<HandSummary>>;

#[tauri::command]
async fn get_hand_detail(hand_id: String) -> Result<HandDetail>;
```

#### React Components
- **ImportScreen** → `<ImportDragZone>` + `<ProgressBar>` + `<ErrorList>`
- **SessionsView** → `<SessionsTable>` (sortable, filterable)
- **HandsView** → `<HandList>` (virtualized, paginated)
- **HandDetailView** → `<ActionTable>` + `<LedgerTable>` + `<cEVCard>`

**Stores** (Zustand):
- `appStore` (current view, selected session/hand)
- `importStore` (import progress, errors)

**Hooks** (TanStack Query):
- `useImportHH()` → trigger import, track progress
- `useSessions()` → fetch sessions
- `useHandsBySession(sessionId)` → fetch hands
- `useHandDetail(handId)` → fetch detail

---

## Data Flow

### Import Flow
```
File (Winamax)
    ↓
hh_parser_winamax (parse)
    ↓
[ParsedHand, ParsedHand, ...]
    ↓
hand_ledger (calculate ledger)
    ↓
[HandLedger, HandLedger, ...]
    ↓
cev_realized_core (calculate cEV)
    ↓
[HandcEV, HandcEV, ...]
    ↓
hh_ingest (batch insert, validate invariants)
    ↓
SQLite DB
```

### Query Flow
```
UI (React)
    ↓ (IPC command: "get_hand_detail")
    ↓
Tauri handler
    ↓
session_read_model (SQL query)
    ↓
SQLite DB
    ↓
HandDetail DTO
    ↓ (IPC response)
UI renders
```

---

## Module Contracts

### Between Modules

| From | To | Contract |
|------|----|----|
| `hh_parser_winamax` | `hand_ledger` | Input: `ParsedHand`; Output: `HandLedger` |
| `hand_ledger` | `cev_realized_core` | Input: `HandLedger`; Output: `HandcEV` + `Invariants` |
| `cev_realized_core` | `hh_ingest` | Invariants must pass before insert |
| `hh_ingest` | SQLite | Batch insert (idempotent by hand_id) |
| SQLite | `session_read_model` | SQL queries only |
| `session_read_model` | `ui_shell` (IPC) | DTOs, no domain objects |

### Error Handling

- **Parser**: Collect and report errors; skip malformed lines
- **Ledger/cEV**: Throw on logic errors (invariant violation = fatal)
- **DB**: Transaction rollback on partial failure; retry logic
- **IPC**: Convert domain errors → JSON error responses

---

## Performance Considerations

### Parser (hh_parser_winamax)
- **Target**: ≥3k hands/s (small file), ≥2k hands/s (medium file)
- **Strategy**: Streaming, incremental parsing (no buffering full file)
- **Profiling**: Criterion benchmarks on reference dataset

### Ledger/cEV (hand_ledger + cev_realized_core)
- **Target**: ≤1ms per hand
- **Strategy**: Zero allocations in hot loops; pre-computed lookups
- **Profiling**: Perf tests on 10k+ hands

### DB Inserts (hh_ingest)
- **Target**: Batch insert latency p95 ≤50ms
- **Strategy**: WAL mode, batch size tuning, index selectivity
- **Profiling**: Database query plan analysis

### UI (ui_shell)
- **Target**: Hand list p95 ≤200ms, detail p95 ≤150ms
- **Strategy**: Virtual scrolling, query optimization, client-side caching
- **Profiling**: Chrome DevTools, lighthouse

---

## Testing Strategy

### Unit Tests
- **Parser**: Tokenizer, action parser, canonicalization (50+ cases)
- **Ledger**: Splits, side pots, odd chips, rake (100+ cases)
- **cEV**: Invariants, edge cases (50+ cases)

### Integration Tests
- **Full pipeline**: File → DB (end-to-end)
- **Idempotency**: Reimport same file (no duplicates)
- **Error recovery**: Partial import, resume

### Golden Dataset
- **300+ diverse hands**: 2-way, 3-way, all-in, rake scenarios
- **Reference outputs**: cEV, ledger, invariants pre-calculated
- **Regression**: Every PR must pass

### Performance Tests
- **Import benchmarks**: 10k, 100k hand batches
- **UI latency**: React render times
- **Database**: Query plan analysis

---

## Known Limitations & Future Work

### V0.1 Scope (Out of Scope)
- Run-it-twice
- Equity solver integration
- Advanced stats
- Export/reporting

### Post-V0.1 (Phase 2+)
- Simple replayer
- Hand filters (position, stakes, etc.)
- Session summary dashboard
- Comparison with GTO baselines

---

**Last updated**: 2026-06-19  
**Owner**: Tech Lead
