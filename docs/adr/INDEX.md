# Architecture Decision Records (ADRs)

ADRs are structured decisions about technical direction, trade-offs, and rationale.

## Template

Each ADR follows this structure:

```markdown
# ADR-XXX: [Title]

## Status
[Proposed | Accepted | Deprecated | Superseded by ADR-YYY]

## Context
[Problem statement, constraints, why this decision matters]

## Decision
[What we decided and why]

## Consequences
[Positive outcomes, risks, maintenance burden]

## Alternatives Considered
[Other options and why they were rejected]

## References
[Related docs, issues, discussions]
```

---

## Current ADRs

### ADR-001: Use Rust for Core Domain Logic

**Status**: Accepted

**Context**:
- Core import & cEV calculation must handle 100k+ hands at ≥2k hands/sec
- Ledger calculations are CPU-bound (side pots, splits, invariants)
- UI and IPC are not performance-critical
- Language choice affects maintainability, ecosystem, hiring

**Decision**:
Implement all domain logic in **Rust** (parser, ledger, cEV):
- Raw performance (no GC pauses)
- Memory safety → fewer bugs
- Excellent ecosystem (serde, rayon, criterion)
- Strict type system catches mistakes early

Frontend & Tauri remain in **TypeScript/React** (better DX for UI).

**Consequences**:
- ✅ Fast, safe core
- ✅ Easy to profile & optimize
- ❌ Larger learning curve for new contributors
- ❌ Longer compile times
- ✅ Good testing framework (criterion, proptest)

**Alternatives**:
- Go: Good perf, simpler than Rust, but less type safety
- C++: Maximum perf, but unsafe, hard to maintain
- Python: Easy to write, too slow for 2k hands/sec target

**References**: [PERF_BUDGET.md](./PERF_BUDGET.md), [SETUP.md](../SETUP.md)

---

### ADR-002: SQLite (WAL) for Local Data Persistence

**Status**: Accepted

**Context**:
- App is desktop-only, single-user, no server
- Need to store hundreds of thousands of hands
- Must survive app crashes (durability)
- No need for concurrent writers or network access
- Lightweight, zero-dependency, cross-platform

**Decision**:
Use **SQLite** with **WAL (Write-Ahead Log)** mode:
- No server/process management
- ACID transactions → consistency
- WAL mode: readers don't block writers
- Fast bulk inserts with pragma tuning
- Native support for streaming queries

**Consequences**:
- ✅ Zero ops overhead
- ✅ Easy backups (single file)
- ✅ Great for testing (in-memory mode)
- ✅ Mature, battle-tested
- ❌ Single machine only (not relevant for V0.1)
- ❌ Large datasets (>1GB): consider sharding later

**Alternatives**:
- PostgreSQL: Overkill, requires server
- MySQL: Same issue
- RocksDB: Embedded, but less SQL-friendly
- JSON files: No ACID, query performance

**References**: [DB schema TBD], Docker compose

---

### ADR-003: Tauri for Desktop Shell

**Status**: Accepted

**Context**:
- Need cross-platform desktop app (macOS, Linux, Windows)
- Want native performance & system integration
- Rust backend, React frontend → language mismatch
- Electron too heavy for this workload
- IPC overhead acceptable (async event loop)

**Decision**:
Use **Tauri** (Rust + React):
- Lightweight binary (10–20MB vs 150MB Electron)
- Native OS integration
- Seamless Rust↔JS IPC via serde-json
- Active community, good docs

**Consequences**:
- ✅ Small bundle size
- ✅ Fast startup
- ✅ Easy Rust interop
- ⚠️ Smaller ecosystem than Electron (fewer pre-built components)
- ✅ Great for this project size
- ❌ Not suitable if we need heavy third-party JS libraries

**Alternatives**:
- Electron: Heavier, but larger ecosystem
- Qt/PyQt: Better for Python projects
- Native (Swift/Kotlin): Platform-specific code

**References**: [SETUP.md](../SETUP.md), Tauri docs

---

### ADR-004: Feature-Frozen V0.1 (Explicit Scope)

**Status**: Accepted

**Context**:
- Scope creep is the #1 killer of projects
- Poker review features are numerous (run-it-twice, GTO comparison, etc.)
- We must deliver a solid *foundation* first
- Phase 2+ can build on Phase 1

**Decision**:
**V0.1 is feature-frozen**. Only implement:
1. HH import + parsing
2. Ledger & realized cEV
3. Minimal UI (list, detail)
4. Validation

Out of scope for V0.1:
- Run-it-twice
- Equity solvers
- Advanced analytics
- Comparison features

**Consequences**:
- ✅ Clear deliverable
- ✅ Time-bound (12 weeks)
- ✅ Quality-focused (100% validation gates)
- ❌ Longer to full product
- ✅ Each phase adds value independently

**Alternatives**:
- Incremental features: Risk of endless scope
- Big bang: Too risky, no partial delivery

**References**: [PROJECT_BRIEF.md](../PROJECT_BRIEF.md), [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md)

---

### ADR-005: Golden Dataset for Validation

**Status**: Accepted

**Context**:
- cEV calculation is the core of the app; errors are silent (wrong numbers look right)
- Invariant failures catch some bugs, but not all
- Reference implementation (manual) validates correctness
- Need confidence before Phase 2

**Decision**:
Create a **golden dataset** of 300+ carefully curated hand histories:
- Diverse scenarios (2-way, 3-way, all-in, rake, odd chips)
- Pre-calculated correct outputs (ledger, cEV, invariants)
- Regression test on every build
- Part of Definition of Done for Phase 1

**Consequences**:
- ✅ High confidence in correctness
- ✅ Easy to detect regressions
- ✅ Foundation for future phases
- ❌ Initial manual effort (~1–2 weeks to build)
- ✅ Pays off over time

**Alternatives**:
- Fuzz testing: Good, but doesn't validate correctness
- Manual review: Doesn't scale

**References**: [GOLDEN_DATASET.md](./GOLDEN_DATASET.md) (TBD), [TEST_STRATEGY.md](../TEST_STRATEGY.md)

---

### ADR-006: Streaming Parser (Memory Efficiency)

**Status**: Accepted

**Context**:
- Hand history files can be large (100k+ hands)
- Memory must stay constant regardless of file size
- 2k hands/sec target implies tight memory budget

**Decision**:
Use **streaming, incremental parsing**:
- Read file line-by-line (not all at once)
- Parse to intermediate representation
- Batch insert (1k hands) then drop references
- Constant memory footprint

**Consequences**:
- ✅ Handles arbitrarily large files
- ✅ Peak memory ~50MB even for 1M hands
- ✅ Can report progress in real-time
- ❌ Slightly more complex code
- ✅ Composable with batch operations

**Alternatives**:
- Load entire file: Simpler, but memory spike for large files

**References**: [IMPORT_PIPELINE.md](./IMPORT_PIPELINE.md) (TBD), ADR-001

---

### ADR-007: Strict Separation: Domain ↔ I/O

**Status**: Accepted

**Context**:
- Core business logic (ledger, cEV) must be:
  - Deterministic
  - Testable
  - Reusable
- Hard to test if I/O mixed with domain

**Decision**:
**Strict layers**:
- Domain layer: Pure functions, no I/O, no side effects
- Application layer: Orchestration, I/O, DB calls
- UI layer: Presentation only

Module boundaries:
```
hh_parser_winamax (pure)
hand_ledger (pure)
cev_realized_core (pure)
---
hh_ingest (orchestration + DB)
session_read_model (DB queries)
---
ui_shell (React + Tauri)
```

**Consequences**:
- ✅ Easy unit tests
- ✅ Easy to mock
- ✅ Reusable components
- ❌ Slightly more boilerplate (DTOs)
- ✅ Long-term maintainability

**Alternatives**:
- Mixed I/O: Simpler initially, harder to test

**References**: [ARCHITECTURE.md](./ARCHITECTURE.md)

---

## Future ADRs (Placeholders)

- **ADR-008**: Concurrency model for import (tokio async vs threads)
- **ADR-009**: Error handling strategy (Result<T> vs exceptions vs custom enums)
- **ADR-010**: UI state management (Zustand + TanStack Query)
- **ADR-011**: Metrics collection & export (Prometheus vs custom JSON)
- **ADR-012**: Pre-commit hooks & CI gates (ESLint, clippy, perf regression)

---

**Last updated**: 2026-06-19  
**Owner**: Tech Lead
