# Implementation Plan — Expresso Review App V0.1

## Executive Summary

**Goal**: Build Phase 1 (Realized cEV foundation) with high confidence & validation.

| Phase | Scope | Duration | Validation |
|-------|-------|----------|-----------|
| **1** | HH import → Ledger → cEV calculation → minimal UI | ~12 weeks | 100% invariants, golden dataset |
| **2** | Replayer, filters, session summary | *Post-Phase 1* | ~4 weeks |
| **3** | Optimization, polish, deployment | *Post-Phase 2* | ~2 weeks |

**This document covers Phase 1 only.**

---

## Phases Breakdown

### Phase 1.A: Core Infrastructure (Weeks 1–4)

#### Goals
- Module scaffolding & contracts
- DB schema (SQLite)
- Logging & metrics
- Test harness setup

#### Deliverables

| Task | Owner | Duration | Status |
|------|-------|----------|--------|
| **Scaffolding** | | | |
| Cargo workspace (6 crates) | Backend | 2d | 🔲 |
| Vite + React + Tauri setup | Frontend | 2d | 🔲 |
| Docker & compose files | DevOps | 1d | 🔲 |
| **Database** | | | |
| SQLite schema design | Backend | 2d | 🔲 |
| Migration framework | Backend | 1d | 🔲 |
| Query builder layer | Backend | 2d | 🔲 |
| **Instrumentation** | | | |
| Logging (tracing crate) | Backend | 1d | 🔲 |
| Metrics (prometheus) | Backend | 2d | 🔲 |
| Error telemetry | Backend | 1d | 🔲 |
| **Tests** | | | |
| Test utilities & fixtures | QA | 2d | 🔲 |
| Golden dataset structure | QA | 2d | 🔲 |

#### Acceptance Criteria
- ✓ All 6 Rust crates compile with zero warnings
- ✓ SQLite schema passes migration tests
- ✓ Logging outputs JSON to stderr
- ✓ Metrics exported (Prometheus format)
- ✓ Test fixtures load correctly

---

### Phase 1.B: HH Parser (Weeks 3–6)

#### Goals
- Winamax parser (incremental, streaming)
- Canonicalization to internal schema
- Partial error handling (skip invalid lines, track errors)

#### Deliverables

| Task | Owner | Duration | Status |
|------|-------|----------|--------|
| **Parser** | | | |
| Winamax lexer/tokenizer | Backend | 3d | 🔲 |
| Action parser (bets, raises, calls, folds) | Backend | 3d | 🔲 |
| Hand/board parsing | Backend | 2d | 🔲 |
| Normalization to canonical schema | Backend | 2d | 🔲 |
| **Validation** | | | |
| Hand history structure checks | Backend | 2d | 🔲 |
| Stack consistency pre-hand | Backend | 2d | 🔲 |
| Error collection & reporting | Backend | 1d | 🔲 |
| **Tests** | | | |
| Parser unit tests (50+ cases) | QA | 4d | 🔲 |
| Canonicalization tests | QA | 2d | 🔲 |
| Integration: raw file → canonical | QA | 2d | 🔲 |

#### Acceptance Criteria
- ✓ Parse errors ≤0.5% on reference dataset
- ✓ All canonical fields populated correctly
- ✓ Performance ≥3k hands/s (small file)
- ✓ Parser recovers gracefully on malformed input

---

### Phase 1.C: Ledger & cEV Core (Weeks 5–9)

#### Goals
- Ledger: track contributions, payouts per player
- Realized cEV: `stack_end - stack_start`
- Invariant validation (sum=0, no chip loss)
- Side pot handling (2-way, 3-way exact)

#### Deliverables

| Task | Owner | Duration | Status |
|------|-------|----------|--------|
| **Ledger** | | | |
| Contribution tracking (blind, bet, raise, call, fold) | Backend | 2d | 🔲 |
| Payout calculations (pot, side pots, rake) | Backend | 3d | 🔲 |
| Split logic (2-way, 3-way, > 3 all-in scenarios) | Backend | 3d | 🔲 |
| Odd chip handling (room policy DSL) | Backend | 1d | 🔲 |
| **cEV Realization** | | | |
| Realized cEV calculator (`end_stack - start_stack`) | Backend | 1d | 🔲 |
| Player position/role assignment | Backend | 1d | 🔲 |
| **Invariant Validation** | | | |
| Sum invariant: `sum(cEV) ≈ 0 ± rake` | Backend | 1d | 🔲 |
| Chip invariant: no chips lost/created | Backend | 1d | 🔲 |
| Side pot integrity checks | Backend | 1d | 🔲 |
| **Tests** | | | |
| Ledger unit tests (100+ cases) | QA | 5d | 🔲 |
| Split tests (2-way, 3-way, edge cases) | QA | 3d | 🔲 |
| Invariant validation tests | QA | 3d | 🔲 |
| Golden dataset: cEV mismatch = 0 | QA | 3d | 🔲 |

#### Acceptance Criteria
- ✓ Ledger balances for 100% of test hands
- ✓ Splits exact in 2-way & 3-way scenarios
- ✓ Invariants: sum=0, no chip loss (100% pass rate)
- ✓ cEV matches golden dataset (zero mismatch)
- ✓ Performance: ≤1ms per hand cEV calc

---

### Phase 1.D: Database & Import Pipeline (Weeks 7–11)

#### Goals
- Streaming HH import (file → DB)
- Batch inserts (idempotent)
- Partial error handling & recovery
- Progress tracking

#### Deliverables

| Task | Owner | Duration | Status |
|------|-------|----------|--------|
| **Pipeline** | | | |
| Streaming file reader | Backend | 1d | 🔲 |
| Incremental parsing → canonicalization | Backend | 2d | 🔲 |
| DB transaction batching (1k hands/batch) | Backend | 2d | 🔲 |
| Idempotency (dedup by hand signature) | Backend | 2d | 🔲 |
| Error recovery (resume from checkpoint) | Backend | 2d | 🔲 |
| **Progress & Metrics** | | | |
| Real-time progress callbacks | Backend | 1d | 🔲 |
| Import metrics (hands/s, parse errors, insert latency) | Backend | 1d | 🔲 |
| JSON logs with context | Backend | 1d | 🔲 |
| **Tests** | | | |
| Pipeline integration tests (file → DB) | QA | 3d | 🔲 |
| Idempotency tests (reimport same file) | QA | 2d | 🔲 |
| Error recovery tests | QA | 2d | 🔲 |
| Perf tests (10k, 100k hand batches) | QA | 2d | 🔲 |

#### Acceptance Criteria
- ✓ Import idempotent (no duplicates on reimport)
- ✓ Small file (10k): ≥3k hands/s
- ✓ Medium file (100k): ≥2k hands/s
- ✓ Parse errors ≤0.5%, invalid hands ≤0.5%
- ✓ Graceful error reporting with recovery

---

### Phase 1.E: Minimal UI (Weeks 9–12)

#### Goals
- Import screen (drag/drop, progress, errors)
- Sessions list (table)
- Hand list (paginated)
- Hand detail (table + cEV realized card)

#### Deliverables

| Task | Owner | Duration | Status |
|------|-------|----------|--------|
| **Import Screen** | | | |
| File drag-drop zone | Frontend | 1d | 🔲 |
| Progress bar + ETA | Frontend | 1d | 🔲 |
| Error display (parse errors, invalid hands) | Frontend | 1d | 🔲 |
| Integration with Tauri backend | Frontend | 1d | 🔲 |
| **Sessions & Hands** | | | |
| Sessions table (date, total hands, P&L) | Frontend | 2d | 🔲 |
| Hand list (virtualized, filterable by date/player) | Frontend | 2d | 🔲 |
| Hand detail card (action table + cEV realized display) | Frontend | 2d | 🔲 |
| **Tauri Bindings** | | | |
| IPC import endpoint | Backend | 1d | 🔲 |
| IPC query endpoints (sessions, hands, detail) | Backend | 2d | 🔲 |
| Error handling across IPC boundary | Backend | 1d | 🔲 |
| **Tests** | | | |
| E2E: import file → view session → view hand | QA | 2d | 🔲 |
| UI performance: list p95 ≤200ms | QA | 1d | 🔲 |
| UI performance: detail p95 ≤150ms | QA | 1d | 🔲 |

#### Acceptance Criteria
- ✓ Import screen responsive & intuitive
- ✓ Sessions list loads <200ms (100+ sessions)
- ✓ Hand detail loads <150ms
- ✓ E2E flow works (import → review)
- ✓ Error messages actionable

---

### Phase 1.F: Validation & Hardening (Weeks 11–12)

#### Goals
- Run full test suite on golden dataset
- Performance regression gates
- Documentation complete
- Release readiness

#### Deliverables

| Task | Owner | Duration | Status |
|------|-------|----------|--------|
| **Validation** | | | |
| Golden dataset (300+ diverse hands) fully passing | QA | 3d | 🔲 |
| Invariants: 100% pass on golden dataset | QA | 1d | 🔲 |
| cEV mismatch = 0 | QA | 1d | 🔲 |
| **Performance** | | | |
| Import benchmark: 10k → ≥3k h/s | QA | 1d | 🔲 |
| Import benchmark: 100k → ≥2k h/s | QA | 1d | 🔲 |
| UI latency: hand list p95 ≤200ms | QA | 1d | 🔲 |
| UI latency: hand detail p95 ≤150ms | QA | 1d | 🔲 |
| **Documentation** | | | |
| Module ADRs finalized | Tech Lead | 2d | 🔲 |
| API contracts documented | Tech Lead | 1d | 🔲 |
| Known issues & mitigations | Tech Lead | 1d | 🔲 |
| **Handoff** | | | |
| Validation report (gate pass/fail) | QA | 1d | 🔲 |
| Release notes | Tech Lead | 1d | 🔲 |

#### Acceptance Criteria
- ✓ All gates pass (invariants, perf, golden)
- ✓ Documentation up-to-date
- ✓ No regressions vs golden dataset
- ✓ Phase 1 sign-off

---

## Milestones & Go/No-Go Gates

| Milestone | Date | Gate | Criteria |
|-----------|------|------|----------|
| **1A Complete** | Week 4 | ✓ | All infra builds, tests runnable |
| **1B Complete** | Week 6 | ✓ | Parser perf ≥3k h/s, errors ≤0.5% |
| **1C Complete** | Week 9 | ✓ | Ledger + cEV exact, invariants 100% |
| **1D Complete** | Week 11 | ✓ | Pipeline idempotent, perf targets met |
| **1E Complete** | Week 12 | ✓ | UI flows work, latency targets met |
| **Phase 1 Done** | Week 12 | ✓ | Golden dataset 100%, validation report signed |

**No Phase 2 start until Phase 1 gate passes 100%.**

---

## Team & Roles

| Role | Responsibilities |
|------|------------------|
| **Backend Lead** | Architecture, Rust implementation, perf |
| **Frontend Lead** | UI, Tauri integration, UX |
| **QA Lead** | Testing strategy, golden dataset, validation |
| **DevOps** | Docker, CI/CD, metrics collection |
| **Tech Lead** | ADRs, documentation, contracts |

---

## Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Parser doesn't achieve perf targets | Medium | High | Profile early (Week 4), consider SIMD |
| Side pot splits wrong in 3-way | High | Critical | Golden dataset with 20+ 3-way scenarios |
| DB inserts too slow | Medium | High | Batch tuning, WAL mode, index strategy |
| UI latency misses targets | Low | Medium | Virtual scrolling, query optimization |
| Invariant edge cases missed | High | Critical | Fuzzing on ledger (Week 8) |

---

## Success Criteria

### Functional
- ✓ Import file → DB end-to-end works
- ✓ Ledger balances 100% of hands
- ✓ Splits exact (2-way, 3-way)
- ✓ Invariants pass (sum=0, no chip loss)
- ✓ cEV matches golden dataset (mismatch = 0)

### Non-Functional
- ✓ Import ≥2k hands/s (medium file)
- ✓ UI list p95 ≤200ms
- ✓ UI detail p95 ≤150ms
- ✓ Parse errors ≤0.5%
- ✓ Invalid hands ≤0.5%

### Process
- ✓ 100% test coverage (core modules)
- ✓ ADRs for all major decisions
- ✓ Documentation complete
- ✓ Pre-commit hooks enforced
- ✓ CI gates passing

---

## Appendix: Module Dependencies

```
hh_ingest
  ├── hh_parser_winamax
  ├── hand_ledger
  └── cev_realized_core

cev_realized_core
  └── hand_ledger

hand_ledger
  └── [domain types]

session_read_model
  ├── hand_ledger
  └── cev_realized_core

ui_shell (Tauri)
  ├── session_read_model (IPC)
  └── hh_ingest (IPC)
```

All dependencies are explicit and asynchronous (event-driven or IPC).

---

**Last updated**: 2026-06-19  
**Owner**: Project Lead
