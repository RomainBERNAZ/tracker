# Test Strategy

## Overview

Testing is critical for correctness (especially for cEV calculations). V0.1 emphasizes:
- **Correctness first**: Invariants, golden dataset
- **Integration**: End-to-end import pipeline
- **Performance**: Regression detection
- **Coverage**: Core modules (not UI)

---

## Testing Pyramid

```
                    /\
                   /  \
                  / E2E \
                 /________\
                /          \
               /Integration \
              /   (pipeline) \
             /________________\
            /                  \
           /      Unit Tests    \
          /____________________\
         Parser | Ledger | cEV
```

### Level 1: Unit Tests (Base)
- Parser tokenizer/action parser
- Ledger calculations (splits, odd chips)
- cEV calculations & invariants

**Target coverage**: ≥80% core modules

### Level 2: Integration Tests (Middle)
- Import pipeline (file → DB)
- Idempotency (reimport same file)
- Error recovery

### Level 3: E2E Tests (Top)
- UI: import → view session → view hand
- Full flow with realistic data

---

## Unit Tests

### Parser Tests (hh_parser_winamax)

#### Test Categories

| Category | Scenarios | Examples |
|----------|-----------|----------|
| **Action parsing** | Bet, raise, call, check, fold, all-in | Preflop raise sequence, flop bet/call |
| **All-in detection** | Multi-way all-in, partial all-in | A all-in < B bet, B all-in < C bet |
| **Showdown** | Cards revealed, winner determined | Both players show, fold without showdown |
| **Edge cases** | Rake, odd chips, split pots | Rake deduction, multiple side pots |

#### Example Test Cases

```rust
#[test]
fn test_parse_simple_heads_up_fold() {
  let input = r#"
    PokerStars Hand #123: Expresso 0.50/1.00 USD
    Seat 1: A (100)
    Seat 2: B (100)
    A posts SB 0.50, B posts BB 1.00
    A folds
  "#;
  
  let hand = parse_hand(input).unwrap();
  assert_eq!(hand.hand_id, "123");
  assert_eq!(hand.actions.len(), 2);  // SB, BB, fold
  assert_eq!(hand.actions[2].action_type, ActionType::Fold);
}

#[test]
fn test_parse_three_way_all_in() {
  let input = r#"
    Three-way all-in scenario
    ...
  "#;
  
  let hand = parse_hand(input).unwrap();
  assert!(hand.actions.iter().any(|a| a.action_type == ActionType::AllIn));
}

#[test]
fn test_parse_rake_deduction() {
  let input = r#"
    Rake 0.15 deducted from pot
    ...
  "#;
  
  let hand = parse_hand(input).unwrap();
  assert_eq!(hand.rake_taken, 0.15);
}
```

### Ledger Tests (hand_ledger)

#### Test Categories

| Category | Scenarios | Notes |
|----------|-----------|-------|
| **2-way splits** | Equal, unequal splits, side pots | Heads-up, or when others fold |
| **3-way splits** | Three-way showdown, all-in combos | Main focus for Expresso |
| **Odd chips** | Remainder distribution | Button, SB, or deterministic |
| **Rake handling** | Percentage rake, fixed rake | Pre/post-showdown |

#### Example Test Cases

```rust
#[test]
fn test_ledger_simple_2way_split() {
  let hand = CanonicalHand {
    players: vec![
      CanonicalPlayer { pos: 0, name: "A", start: 100 },
      CanonicalPlayer { pos: 1, name: "B", start: 100 },
    ],
    // A folds, B wins pot of 2
    ...
  };
  
  let ledger = calculate_ledger(&hand).unwrap();
  assert_eq!(ledger.players[0].realized_cev, -1.0);  // A lost SB
  assert_eq!(ledger.players[1].realized_cev, 1.0);   // B won SB
}

#[test]
fn test_ledger_3way_split() {
  let hand = CanonicalHand {
    players: vec![
      CanonicalPlayer { pos: 0, start: 100 },
      CanonicalPlayer { pos: 1, start: 100 },
      CanonicalPlayer { pos: 2, start: 100 },
    ],
    // All-in: A all-in 50, B all-in 100, C all-in 100
    // Main pot: 50*3=150, Winner A
    // Side pot 1: (100-50)*2=100, Winner B
    // Side pot 2: (100-100)*1=0
    ...
  };
  
  let ledger = calculate_ledger(&hand).unwrap();
  assert_eq!(ledger.players[0].realized_cev, 150 - 50);  // +100
  assert_eq!(ledger.players[1].realized_cev, 100 - 100); // 0
  assert_eq!(ledger.players[2].realized_cev, -100 - 100);// -200 (nothing won)
}

#[test]
fn test_ledger_odd_chips() {
  let hand = CanonicalHand {
    // Pot splits to 3 players: 100 chips / 3 = 33 remainder 1
    // Odd chip goes to button (policy)
    ...
  };
  
  let ledger = calculate_ledger(&hand).unwrap();
  // Expected: 34, 33, 33 (button gets extra)
}
```

### cEV Tests (cev_realized_core)

#### Test Categories

| Category | Scenarios | Notes |
|----------|-----------|-------|
| **Realized cEV calc** | `end - start` for each player | Simple arithmetic |
| **Invariant: sum** | Σ(cEV) + rake = 0 | Critical |
| **Invariant: chips** | Σ(start) = Σ(end) + rake | Critical |

#### Example Test Cases

```rust
#[test]
fn test_cev_invariant_sum() {
  let ledger = HandLedger {
    players: vec![
      PlayerLedger { start: 100, end: 80, realized_cev: -20 },
      PlayerLedger { start: 100, end: 115, realized_cev: 15 },
      PlayerLedger { start: 100, end: 85, realized_cev: -15 },
    ],
    rake: 10,
  };
  
  let invariants = validate_invariants(&ledger).unwrap();
  assert_eq!(invariants.sum_cev_excl_rake, -20 + 15 - 15);  // -20
  assert!((invariants.sum_cev_excl_rake + ledger.rake).abs() < 0.01);
}

#[test]
fn test_cev_invariant_chips() {
  let ledger = HandLedger {
    players: vec![...],
    rake: 5,
  };
  
  let invariants = validate_invariants(&ledger).unwrap();
  let total_start = 300.0;
  let total_end = 80 + 115 + 85;  // 280
  assert_eq!(total_start, total_end + invariants.rake);
}

#[test]
fn test_cev_calculation_simple() {
  let player_ledger = PlayerLedger {
    start_stack: 100,
    end_stack: 85,
  };
  
  let cev = player_ledger.realized_cev;
  assert_eq!(cev, -15);
}
```

---

## Integration Tests

### Import Pipeline (End-to-End)

```rust
#[test]
fn test_import_pipeline_small_file() {
  // Setup: Create temp directory with test HH file
  let temp_dir = TempDir::new().unwrap();
  let hh_file = temp_dir.path().join("test.txt");
  fs::write(&hh_file, TEST_HH_CONTENT).unwrap();
  
  // Import
  let result = import_hand_history(&hh_file, ImportConfig::default()).unwrap();
  
  // Verify
  assert_eq!(result.inserted_hands, 10);
  assert_eq!(result.parse_errors, 0);
  
  // Check DB
  let db = Database::open(":memory:").unwrap();
  let hands = db.query_hands().unwrap();
  assert_eq!(hands.len(), 10);
  
  // Verify invariants
  for hand_id in hands.iter().map(|h| &h.id) {
    let invariants = db.get_invariant_checks(hand_id).unwrap();
    assert!(invariants.iter().all(|i| i.passed));
  }
}

#[test]
fn test_import_idempotency() {
  // Import same file twice
  let result1 = import_hand_history(&hh_file, config).unwrap();
  let result2 = import_hand_history(&hh_file, config).unwrap();
  
  // Verify: second import should not create duplicates
  assert_eq!(result1.inserted_hands, result2.inserted_hands);
  
  let db = Database::open(...).unwrap();
  let hands = db.query_hands().unwrap();
  assert_eq!(hands.len(), result1.inserted_hands);  // Not doubled
}

#[test]
fn test_import_error_recovery() {
  // Create HH with 5 valid + 5 invalid hands
  let hh_file_mixed = "...";
  
  let result = import_hand_history(&hh_file_mixed, config).unwrap();
  
  assert_eq!(result.inserted_hands, 5);
  assert_eq!(result.parse_errors, 5);
  assert_eq!(result.parse_errors as f64 / 10.0, 0.5);  // 50%
}
```

---

## Golden Dataset

### Purpose
Reference test cases with pre-calculated correct outputs. Used for regression testing.

### Structure

File: `tests/fixtures/golden_dataset.json`

```json
{
  "dataset_version": "1.0",
  "test_cases": [
    {
      "id": "golden_001_2way_simple",
      "description": "Heads-up: SB folds",
      "hh_content": "PokerStars Hand #101: ...",
      "expected": {
        "players": [
          {
            "position": 0,
            "realized_cev": -1.0,
            "invariants_passed": true
          },
          {
            "position": 1,
            "realized_cev": 1.0,
            "invariants_passed": true
          }
        ],
        "sum_cev_with_rake": 0.0,
        "rake_taken": 0.0
      }
    },
    {
      "id": "golden_002_3way_allin",
      "description": "3-way all-in: side pots",
      "hh_content": "PokerStars Hand #102: ...",
      "expected": {
        "players": [
          {"position": 0, "realized_cev": -50.0},
          {"position": 1, "realized_cev": 50.0},
          {"position": 2, "realized_cev": 0.0}
        ],
        "sum_cev_with_rake": 0.0,
        "rake_taken": 2.5
      }
    },
    // ... 300+ more cases
  ]
}
```

### Regression Test

```rust
#[test]
#[ignore]  // Run explicitly: `cargo test golden -- --ignored`
fn test_golden_dataset_regression() {
  let dataset = load_golden_dataset("tests/fixtures/golden_dataset.json").unwrap();
  
  for test_case in dataset.test_cases {
    let hand = parse_hand(&test_case.hh_content).unwrap();
    let ledger = calculate_ledger(&hand).unwrap();
    let cev = calculate_cev(&ledger).unwrap();
    
    for (i, expected_player) in test_case.expected.players.iter().enumerate() {
      let actual = &cev.players[i];
      
      assert_eq!(actual.realized_cev, expected_player.realized_cev,
        "Mismatch in {}: position {}", test_case.id, i);
      
      assert_eq!(actual.invariants_passed, expected_player.invariants_passed,
        "Invariant mismatch in {}: position {}", test_case.id, i);
    }
  }
}
```

---

## Performance Tests

### Import Benchmarks (Criterion)

```rust
use criterion::{black_box, criterion_group, criterion_main, Criterion};

criterion_group!(benches, bench_import_small, bench_import_large);
criterion_main!(benches);

fn bench_import_small(c: &mut Criterion) {
  c.bench_function("import_10k_hands", |b| {
    b.iter(|| {
      import_hand_history(
        black_box("tests/fixtures/10k_hands.txt"),
        black_box(ImportConfig::default())
      )
    })
  });
}

fn bench_import_large(c: &mut Criterion) {
  c.bench_function("import_100k_hands", |b| {
    b.iter(|| {
      import_hand_history(
        black_box("tests/fixtures/100k_hands.txt"),
        black_box(ImportConfig::default())
      )
    })
  });
}
```

Run:
```bash
cargo bench --release
```

---

## Test Execution

### Run All Tests
```bash
cargo test --all
```

### Run by Category
```bash
# Unit tests
cargo test --lib

# Integration tests
cargo test --test '*'

# Golden dataset (ignored by default)
cargo test golden -- --ignored

# Benchmarks
cargo bench --release
```

### CI Pipeline (GitHub Actions)

```yaml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions-rs/toolchain@v1
        with:
          toolchain: stable
          components: clippy, rustfmt
      
      - name: Lint
        run: cargo clippy -- -D warnings
      
      - name: Format check
        run: cargo fmt -- --check
      
      - name: Tests
        run: cargo test --all --release
      
      - name: Golden dataset
        run: cargo test golden -- --ignored
      
      - name: Benchmarks
        run: cargo bench --release
```

---

## Coverage Targets

| Module | Unit | Integration | E2E | Target |
|--------|------|-------------|-----|--------|
| `hh_parser_winamax` | ✓ | ✓ | - | ≥85% |
| `hand_ledger` | ✓ | ✓ | - | ≥90% |
| `cev_realized_core` | ✓ | ✓ | - | ≥95% (critical) |
| `hh_ingest` | - | ✓ | ✓ | ≥80% |
| `session_read_model` | ✓ | - | ✓ | ≥75% |
| `ui_shell` | - | - | ✓ | ≥60% (not critical) |

---

## Known Limitations

- **UI E2E**: Currently scoped to import → view flow (not interactive)
- **Fuzz testing**: Not yet implemented (could add property-based tests with proptest)
- **Performance bounds**: Benchmarks are baseline (regression detection only)

---

**Last updated**: 2026-06-19  
**Owner**: QA Lead
