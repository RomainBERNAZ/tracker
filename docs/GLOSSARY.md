# Glossary & Terminology

## Poker Concepts

### Players & Positions

| Term | Definition |
|------|-----------|
| **Small Blind (SB)** | Player posting smaller blind bet; acts second preflop |
| **Big Blind (BB)** | Player posting larger blind bet; acts last preflop |
| **Button (BTN)** | Dealer position; acts last postflop (favorable) |
| **3-handed / 3-max** | Game with 3 players (focus for Expresso) |
| **Seat** | Physical position at table (1, 2, 3, ...) |
| **Position** | Logical role (0=SB, 1=BB, 2=BTN in 3-handed) |

### Hand Concepts

| Term | Definition |
|------|-----------|
| **Hole cards** | Private cards dealt to player (not visible to others) |
| **Community cards** | Shared cards on board (Flop, Turn, River) |
| **Showdown** | Final comparison of hands when ≥2 players remain |
| **All-in** | Pushing all remaining chips into pot (no more decisions) |
| **Fold** | Surrendering hand; player out of action |
| **Check** | Passing action without betting |
| **Bet** | Wagering chips; first aggression on street |
| **Raise** | Increasing previous bet amount |
| **Call** | Matching previous bet |

### Streets

| Term | Definition |
|------|-----------|
| **Preflop** | Action before any community cards shown |
| **Flop** | First 3 community cards revealed |
| **Turn** | 4th community card revealed |
| **River** | 5th and final community card revealed |

### Money Concepts

| Term | Definition |
|------|-----------|
| **Stack** | Total chips a player has (before or after hand) |
| **Starting stack** | Chips at beginning of hand |
| **Effective stack** | Smallest stack in hand (limits max pot) |
| **Pot** | Total chips in play (sum of all contributions) |
| **Side pot** | Secondary pot created when player goes all-in with less than current bet |
| **Rake** | Fee taken by house/platform (% of pot or fixed amount) |
| **Payout** | Chips won by player from pot(s) |

### Game-Specific

| Term | Definition |
|------|-----------|
| **Expresso** | Fast-paced 3-handed cash poker (Winamax, specific rules) |
| **Cash game** | Play with real money/chips, buy-in & cash out anytime |
| **Hand history (HH)** | Log of actions/results for one hand (text format) |

---

## cEV (Chip Expected Value) Concepts

### Types of cEV

| Type | Definition | Scope |
|------|-----------|-------|
| **Realized cEV** | Actual outcome: $stack_{end} - stack_{start}$ | **V0.1 focus** |
| **Decision cEV** | Expected value of decision at specific moment | Phase 2+ |
| **GTO cEV** | Value of optimal play (theoretically) | Out of scope |

### Realized cEV Properties

| Property | Meaning |
|----------|---------|
| **+X** | Player won X chips (profit) |
| **-X** | Player lost X chips (loss) |
| **0** | Break-even hand |
| **Factual** | Not subjective; simply: outcome - input |

---

## App Architecture Terms

### Modules

| Module | Responsibility |
|--------|---|
| **hh_parser_winamax** | Parse Winamax HH format → canonical schema |
| **hand_ledger** | Track contributions, calculate payouts (includes splits) |
| **cev_realized_core** | Calculate realized cEV & validate invariants |
| **hh_ingest** | Orchestrate import pipeline (parse → validate → insert) |
| **session_read_model** | Query layer for UI (sessions, hands, details) |
| **ui_shell** | Tauri + React frontend & IPC |

### Data Structures

| Term | Definition |
|------|-----------|
| **CanonicalHand** | Normalized hand history (room-agnostic) |
| **HandLedger** | Per-player contributions & payouts |
| **HandcEV** | Per-player realized cEV + invariant checks |
| **DTO** | Data Transfer Object (for IPC/API) |

### Operations

| Term | Definition |
|------|-----------|
| **Parsing** | Convert raw HH text → structured data |
| **Canonicalization** | Normalize to internal schema (same for all rooms) |
| **Ledger calculation** | Compute contributions, side pots, payouts |
| **Invariant validation** | Check mathematical correctness (sum, chips) |
| **Idempotent import** | Reimporting same file → no duplicates |

---

## Database Terms

| Term | Definition |
|------|-----------|
| **Schema** | Database structure (tables, columns, constraints) |
| **Primary key** | Unique identifier for each row (e.g., hand_id) |
| **Foreign key** | Reference to row in another table |
| **Index** | Optimized structure for fast lookups |
| **WAL** | Write-Ahead Log (SQLite mode for concurrency) |
| **Transaction** | Atomic operation (commit all or rollback) |
| **Batch insert** | Insert many rows in one transaction |

---

## Testing Terms

| Term | Definition |
|------|-----------|
| **Unit test** | Test single function/module in isolation |
| **Integration test** | Test multiple components together (e.g., parse → insert) |
| **E2E test** | Test full user workflow (import → view) |
| **Golden dataset** | Reference test cases with pre-calculated correct outputs |
| **Regression test** | Ensure new changes don't break existing functionality |
| **Criterion benchmark** | Performance test with statistical analysis |
| **Coverage** | % of code paths exercised by tests |

---

## Performance Terms

| Term | Definition | Unit |
|------|-----------|------|
| **Throughput** | How many hands per second | hands/s |
| **Latency** | How long one operation takes | ms |
| **p50 / p95 / p99** | 50th / 95th / 99th percentile latency | ms |
| **Peak memory** | Maximum RSS during operation | MB |
| **RSS** | Resident Set Size (actual RAM used) | MB |
| **Batch size** | Number of items in one transaction | count |

---

## UI/UX Terms

| Term | Definition |
|------|-----------|
| **Virtualization** | Rendering only visible items (for 1000+ list performance) |
| **Pagination** | Dividing results into pages (50 items/page) |
| **Drag & drop** | File import via click-and-drag |
| **Progress bar** | Visual indicator of task completion % |
| **ETA** | Estimated Time to Arrival (completion) |
| **WCAG AA** | Accessibility standard (color contrast, keyboard nav) |

---

## Development Terms

| Term | Definition |
|------|-----------|
| **ADR** | Architecture Decision Record (documenting major decisions) |
| **IPC** | Inter-Process Communication (Tauri ↔ backend) |
| **DTO** | Data Transfer Object (lightweight schema for IPC) |
| **Serde** | Rust serialization/deserialization library |
| **Tauri** | Lightweight Electron alternative (Rust backend + JS frontend) |
| **Criterion** | Rust benchmarking framework |
| **Pre-commit hook** | Automated check before commit (lint, format, test) |

---

## Release/Deployment Terms

| Term | Definition |
|------|-----------|
| **v0.1** | Version 0.1 (first release, feature-frozen) |
| **Phase 1** | Initial scope (import + cEV + minimal UI) |
| **Phase 2** | Next scope (replayer, filters, summary) |
| **MVP** | Minimum Viable Product (what's shippable) |
| **Feature-frozen** | No new features; only bug fixes & optimization |
| **Docker image** | Packaged environment for reproducible builds |
| **Release notes** | Summary of changes in a version |

---

## Metrics & Analytics Terms

| Term | Definition |
|------|-----------|
| **Hands/sec** | Import throughput (primary metric) |
| **Parse error rate** | % of hands that fail parsing |
| **Invalid hand rate** | % of parsed hands that fail validation |
| **Error tolerance** | Acceptable % of non-fatal errors |
| **Regression** | Performance decrease compared to baseline |
| **Tolerance** | Acceptable deviation from target (e.g., ±0.01 chips) |

---

## Abbreviations

| Abbr | Expansion |
|-----|-----------|
| **HH** | Hand History |
| **cEV** | Chip Expected Value |
| **UI** | User Interface |
| **UX** | User Experience |
| **IPC** | Inter-Process Communication |
| **DTO** | Data Transfer Object |
| **DB** | Database |
| **SQL** | Structured Query Language |
| **JSON** | JavaScript Object Notation |
| **API** | Application Programming Interface |
| **CI/CD** | Continuous Integration / Continuous Deployment |
| **PR** | Pull Request |
| **RFC** | Request for Comments |
| **ADR** | Architecture Decision Record |
| **RSS** | Resident Set Size |
| **WAL** | Write-Ahead Log |
| **WCAG** | Web Content Accessibility Guidelines |
| **MVP** | Minimum Viable Product |
| **GTO** | Game Theory Optimal |
| **BTN** | Button |
| **SB** | Small Blind |
| **BB** | Big Blind |
| **P&L** | Profit & Loss |

---

**Last Updated**: 2026-06-19  
**Owner**: Tech Lead
