# Import Pipeline Specification

## Overview

The import pipeline orchestrates hand history file import: from raw file → validated DB records.

**Goal**: Fast (≥2k hands/s), reliable (≤0.5% errors), idempotent (no duplicates).

---

## High-Level Flow

```
File (Winamax .txt)
    ↓ [Streaming reader]
Raw lines
    ↓ [Incremental parser]
ParsedHand objects
    ↓ [Validation]
CanonicalHand (normalized)
    ↓ [Batch accumulator (1k hands)]
Batch
    ↓ [Calculate ledger & cEV]
HandLedger + HandcEV
    ↓ [Validate invariants]
Validated batch
    ↓ [DB transaction insert]
SQLite DB
    ↓ [Post-validation]
Metrics + log
```

---

## Stage 1: Streaming File Reader

### Goal
Read file without buffering entire content into memory.

### Implementation

```rust
pub struct StreamingReader {
  file: BufReader<File>,
  current_line: usize,
}

impl StreamingReader {
  pub fn new(path: &Path) -> Result<Self> {
    let file = File::open(path)?;
    let reader = BufReader::with_capacity(64 * 1024, file);
    Ok(Self { file: reader, current_line: 0 })
  }

  pub fn lines(&mut self) -> impl Iterator<Item = Result<String>> {
    // Yields lines one at a time, no buffering
  }
}
```

### Characteristics
- **Buffer size**: 64KB (balances I/O speed vs memory)
- **No full load**: Constant memory regardless of file size
- **Line tracking**: For error reporting

---

## Stage 2: Incremental Parser

### Goal
Parse each line incrementally; collect errors without stopping.

### State Machine

```
State 0: Idle (waiting for hand start)
  Input: "PokerStars Hand #123: ..."
  → State 1: Hand header parsed

State 1: Parse players
  Input: "Seat 1: PlayerA (100 in chips)"
  → Accumulate players

State 2: Parse actions (Preflop/Flop/Turn/River)
  Input: "PlayerA: raises 2.00 to 3.00"
  → Accumulate actions

State 3: Showdown (if reached)
  Input: "PlayerA shows [As Kd]"
  → Record cards

State 4: Results
  Input: "PlayerA collected 45.00 from pot"
  → Record payouts
  → Emit ParsedHand
  → Reset to State 0
```

### Error Collection

```rust
pub struct ParseError {
  pub line_number: usize,
  pub line_content: String,
  pub error_type: ParseErrorType,
  pub context: String,
}

pub enum ParseErrorType {
  UnknownAction,
  MissingPlayer,
  InvalidStack,
  MissingCards,
  MalformedAmount,
  IncompleteHand,
}

pub struct ParseContext {
  pub current_hand: Option<ParsedHand>,
  pub errors: Vec<ParseError>,
  pub lines_processed: usize,
}
```

### Non-Fatal Errors
- Unknown action → skip line, continue
- Malformed amount → set to 0, warn
- Missing player → mark as unknown, continue

### Fatal Errors (skip entire hand)
- Hand start but no players
- No showdown and no payouts recorded
- Circular stack references

---

## Stage 3: Canonicalization

### Goal
Normalize parsed hand to canonical schema (room-agnostic).

### Mapping

```rust
pub fn canonicalize(parsed: ParsedHand) -> Result<CanonicalHand> {
  let mut canonical = CanonicalHand {
    hand_id: parsed.hand_id,
    room: "Winamax",
    table_name: parsed.table_name,
    game_type: parse_game_type(&parsed.game_str)?,
    stakes: Stakes {
      ante: parsed.ante,
      small_blind: parsed.sb,
      big_blind: parsed.bb,
    },
    button_pos: compute_button_pos(&parsed)?,
    players: canonicalize_players(&parsed.players)?,
    action_timeline: canonicalize_actions(&parsed.actions)?,
    showdown: parsed.showdown.map(|s| canonicalize_showdown(&s)).transpose()?,
    final_payouts: canonicalize_payouts(&parsed.payouts)?,
    rake_taken: parsed.rake,
  };
  
  Ok(canonical)
}
```

### Validations at This Stage
- [ ] All required fields present
- [ ] No null/invalid positions
- [ ] Timestamps valid
- [ ] Stack values non-negative

---

## Stage 4: Validation (Pre-Ledger)

### Goal
Catch structural issues before expensive ledger calculation.

### Checks

| Check | Passes If | Fail Action |
|-------|-----------|-------------|
| **All players present** | 3 players for 3-handed | Skip hand |
| **Stack consistency** | starting_stack > 0 | Skip hand |
| **Position unique** | 0, 1, 2 not duplicated | Skip hand |
| **At least 1 action** | Preflop actions exist | Skip hand (unlikely) |

---

## Stage 5: Batch Accumulation

### Goal
Collect 1k hands before DB insert (amortize transaction overhead).

### Implementation

```rust
pub struct ImportBatch {
  pub hands: Vec<CanonicalHand>,
  pub max_size: usize,
}

impl ImportBatch {
  pub fn new(max_size: usize) -> Self {
    Self { hands: Vec::with_capacity(max_size), max_size }
  }

  pub fn push(&mut self, hand: CanonicalHand) -> Option<Vec<CanonicalHand>> {
    self.hands.push(hand);
    if self.hands.len() >= self.max_size {
      Some(self.hands.drain(..).collect())
    } else {
      None
    }
  }

  pub fn flush(&mut self) -> Option<Vec<CanonicalHand>> {
    if self.hands.is_empty() {
      None
    } else {
      Some(self.hands.drain(..).collect())
    }
  }
}
```

### Characteristics
- **Batch size**: 1k hands
- **Memory**: ~5–10MB per batch (depends on action count)
- **Flush on EOF**: Any remaining hands inserted

---

## Stage 6: Ledger & cEV Calculation

### Goal
Calculate per-player contributions, payouts, and realized cEV.

### Per-Batch

```rust
pub fn calculate_batch_ledger(
  batch: Vec<CanonicalHand>,
) -> Result<Vec<(CanonicalHand, HandLedger, HandcEV)>> {
  batch
    .into_iter()
    .map(|hand| {
      let ledger = calculate_ledger(&hand)?;
      let cev = calculate_cev(&ledger)?;
      Ok((hand, ledger, cev))
    })
    .collect()
}
```

**Cost**: ~0.5ms per hand (acceptable, only ~500ms for 1k batch).

---

## Stage 7: Invariant Validation

### Goal
Check mathematical correctness before inserting to DB.

### Checks (Per Hand)

```rust
pub fn validate_hand_invariants(
  hand: &CanonicalHand,
  ledger: &HandLedger,
  cev: &HandcEV,
) -> Result<InvariantValidation> {
  let mut validation = InvariantValidation::default();

  // Sum invariant
  let sum_cev = cev.players.iter().map(|p| p.realized_cev).sum::<f64>();
  let sum_with_rake = (sum_cev + hand.rake_taken).abs();
  validation.sum_passed = sum_with_rake < 0.01;

  // Chip invariant
  let total_start = ledger.players.iter().map(|p| p.start_stack).sum::<f64>();
  let total_end = ledger.players.iter().map(|p| p.end_stack).sum::<f64>();
  let total_with_rake = total_end + hand.rake_taken;
  validation.chip_passed = (total_start - total_with_rake).abs() < 0.01;

  // No negative stacks
  validation.no_negative = ledger.players.iter().all(|p| p.end_stack >= 0.0);

  Ok(validation)
}
```

### Failure Action

If any invariant fails:
1. Log error with context
2. Mark hand as `invalid_hand`
3. **DO NOT INSERT** to DB
4. Continue with next hand

---

## Stage 8: Batch DB Insert

### Goal
Insert validated batch in single transaction (atomic, fast).

### SQL Transaction

```sql
PRAGMA foreign_keys = OFF;  -- Disable until end of txn
PRAGMA synchronous = NORMAL;  -- Balance safety/speed
BEGIN TRANSACTION;

-- For each hand in batch:
INSERT OR IGNORE INTO hands (id, room, table_name, ...)
VALUES (...);

INSERT INTO hand_players (hand_id, position, player_name, ...)
VALUES (...);

-- ... more inserts

INSERT INTO ledgers (hand_id, player_pos, realized_cev, ...)
VALUES (...);

INSERT INTO invariant_checks (hand_id, check_type, passed, ...)
VALUES (...);

COMMIT;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = FULL;
```

### Idempotency

Use `INSERT OR IGNORE` on `hands` table (primary key = hand_id):
- If hand already exists (reimport), skip insert
- No duplicates created

### Performance

- **Target**: 1k-hand batch in ≤50ms
- **Typical**: ~20–30ms (depends on disk speed)

---

## Stage 9: Post-Validation & Metrics

### Goal
Collect metrics and log results.

### Metrics Collected

```rust
pub struct ImportMetrics {
  pub total_hands: usize,
  pub inserted_hands: usize,
  pub parse_errors: usize,
  pub invalid_hands: usize,
  pub parse_time_ms: f64,
  pub insert_time_ms: f64,
  pub parse_p50_ms: f64,
  pub parse_p95_ms: f64,
  pub parse_p99_ms: f64,
  pub insert_batch_p50_ms: f64,
  pub insert_batch_p95_ms: f64,
  pub hands_per_sec: f64,
  pub peak_memory_mb: f64,
  pub errors: Vec<ImportError>,
}

pub struct ImportError {
  pub line_number: usize,
  pub error_type: String,
  pub context: String,
}
```

### JSON Log (Stderr)

```json
{
  "event": "import_complete",
  "timestamp": "2026-06-19T14:23:56Z",
  "file": "/path/to/hh.txt",
  "metrics": {
    "total_hands": 12000,
    "inserted_hands": 11950,
    "parse_errors": 30,
    "invalid_hands": 20,
    "hands_per_sec": 2500,
    "duration_secs": 4.8,
    "error_rate": 0.004
  },
  "errors": [
    {"line": 42, "type": "UnknownAction", "context": "..."},
    ...
  ]
}
```

### UI Progress Callback

```rust
pub fn import_with_progress<F>(
  file_path: &Path,
  mut on_progress: F,
) -> Result<ImportMetrics>
where
  F: FnMut(ImportProgress) + Send,
{
  let mut progress = ImportProgress::default();

  for batch in streaming_batches(file_path, 1000) {
    // ... parse, validate, insert ...

    progress.current_hands += batch.len();
    progress.percent = (progress.current_hands as f64 / total_hands as f64) * 100.0;
    progress.hands_per_sec = compute_throughput(...);
    progress.eta_secs = estimate_remaining(...);

    on_progress(progress.clone());
  }

  Ok(metrics)
}
```

---

## Error Recovery & Resumability

### Idempotency Strategy

1. **File hash**: Store SHA256 of imported file in `import_sessions` table
2. **Hand ID dedup**: On reimport, skip hands already in DB (via `INSERT OR IGNORE`)
3. **No partial state**: Each batch is all-or-nothing (transaction)

### Resume from Checkpoint (Optional Future)

If import interrupted:
1. Query `import_sessions` for last batch number
2. Seek to that file position
3. Resume parsing from there

**V0.1**: Not required; just reimport from start (fast enough).

---

## Configuration

```rust
pub struct ImportConfig {
  pub batch_size: usize,           // 1000 (hands per batch)
  pub error_tolerance: f64,        // 0.01 (1%)
  pub idempotency_check: bool,     // true (check file hash)
  pub max_parse_errors: usize,     // 10000 (log first N)
  pub log_level: LogLevel,         // JSON format
}
```

---

## Performance Expectations

### For 10k Hands

| Phase | Time | Notes |
|-------|------|-------|
| **Read** | 0.5s | Streaming I/O |
| **Parse** | 3–4s | ~350 us/hand |
| **Ledger** | 0.5s | ~50 us/hand |
| **cEV** | 0.5s | ~50 us/hand |
| **Insert** | 1–2s | ~100–200 us/hand, batched |
| **Total** | 5–8s | **~1,250–2,000 hands/s** ✓ |

### For 100k Hands

| Phase | Time | Notes |
|-------|------|-------|
| **Read** | 5s | Streaming I/O |
| **Parse** | 40–50s | ~400 us/hand (cache locality) |
| **Ledger + cEV** | 5s | Similar to parse |
| **Insert** | 20–30s | Batching + DB locks |
| **Total** | 70–90s | **~1,100–1,400 hands/s** → meets ≥2k target with room |

---

## Testing Strategy

### Unit Tests (Parser)

```rust
#[test]
fn test_parse_simple_hand() { }

#[test]
fn test_parse_all_in_scenario() { }

#[test]
fn test_parse_error_recovery() { }
```

### Integration Tests (Full Pipeline)

```rust
#[test]
fn test_import_10k_idempotent() {
  // Import same file twice → same result
}

#[test]
fn test_import_with_errors() {
  // Partial errors → continue
}

#[test]
fn test_import_performance() {
  // Benchmark: 10k hands < 10s
}
```

---

**Last Updated**: 2026-06-19  
**Owner**: Backend Lead
