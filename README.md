# Expresso Review App — V0.1

**Desktop poker hand review tool for 3-handed Expresso poker** with precise realized cEV calculations and robust hand history import.

## Vision
Build a **clean, maintainable, performant** desktop application to analyze Expresso 3-way poker hands. Priority: **reliable realized cEV foundation** + **fast hand history import**.

**V0.1 is feature-frozen**: No scope creep. Foundation only.

---

## Quick Links
- **[PROJECT_BRIEF.md](./PROJECT_BRIEF.md)** — Full requirements (French)
- **[SETUP.md](./SETUP.md)** — Development environment setup
- **[ARCHITECTURE.md](./docs/design/ARCHITECTURE.md)** — System design & modules
- **[IMPLEMENTATION_PLAN.md](./docs/IMPLEMENTATION_PLAN.md)** — Phase breakdown & milestones
- **[ADR/](./docs/adr/)** — Architecture Decision Records
- **[CEV_SPECIFICATION.md](./docs/design/CEV_SPECIFICATION.md)** — Realized cEV math & validation rules

---

## Phase 1: Realized cEV Foundation (Blocking)

### Deliverables
- [ ] HH import pipeline (Winamax)
- [ ] Parsing + normalization
- [ ] Ledger: contributions/payouts
- [ ] Realized cEV calculation (`stack_end - stack_start`)
- [ ] Invariant validation (sum=0, no chips lost)
- [ ] Minimal UI (import, session list, hand detail)

### Validation Gates
✓ 100% invariants pass  
✓ 2-way & 3-way splits exact  
✓ Side pots exact  
✓ Golden dataset: cEV mismatch = 0  
✓ Import idempotent & fast (≥2k hands/s)  
✓ Parse errors ≤0.5%  

**Until Phase 1 is 100% validated, Phase 2 does not start.**

---

## Tech Stack

| Layer | Tech | Notes |
|-------|------|-------|
| **Desktop** | Tauri | Cross-platform, lightweight |
| **Frontend** | React + TypeScript + Vite | Fast HMR, modern tooling |
| **State** | TanStack Query + Zustand | Async data + app state |
| **Backend** | Rust (core modules) | Performance-critical: parsing, ledger, cEV |
| **Database** | SQLite (WAL) | Local, no server dependency |
| **Charts** | ECharts / Recharts | Session visualization |
| **Tests** | Vitest + Playwright (frontend), cargo test + criterion (Rust) | Comprehensive coverage |
| **Quality** | ESLint/Prettier, Clippy/rustfmt, pre-commit | Enforced on CI |
| **Dev Container** | Docker + Compose | Reproducible builds & CI |

---

## Directory Structure

```
tracker/
├── docs/
│   ├── adr/                          # Architecture Decision Records
│   ├── design/                       # Technical specs
│   ├── IMPLEMENTATION_PLAN.md
│   ├── PROJECT_BRIEF.md
│   └── ...
├── src/
│   ├── rust/
│   │   └── Cargo.workspace           # hh_ingest, parser, ledger, cev_realized_core
│   ├── frontend/                     # React app
│   └── tauri/                        # Tauri shell
├── tests/
│   ├── golden_dataset.rs             # Reference test cases
│   └── ...
├── docker/
│   ├── Dockerfile
│   └── compose.yml
├── .github/workflows/                # CI pipeline (ESLint, tests, perf regression)
└── [config files: Cargo.toml, package.json, Dockerfile, etc.]
```

---

## Getting Started

### Prerequisites
- Docker + Docker Compose (recommended)
- OR: Rust 1.70+, Node 18+, pnpm

### Dev Setup
```bash
# With Docker (reproducible)
docker compose -f docker/compose.yml up dev

# OR manual setup
cd /home/rbernaz/tracker
source ./SETUP.md         # Follow instructions
pnpm install
cargo build
```

### Run Tests
```bash
# Rust core tests
cargo test

# Frontend tests
pnpm test

# Integration tests
cargo test --test '*' -- --include-ignored
```

### Import a Hand History
[See UI_SPEC.md for walkthrough]

---

## Metrics & Perf Targets

### Import Performance
| Size | Target | Notes |
|------|--------|-------|
| Small (10k hands) | ≥3,000 hands/s | Parse + insert |
| Medium (100k hands) | ≥2,000 hands/s | Realistic scenario |
| Parse errors | ≤0.5% | Invalid hands tolerated |

### UI Responsiveness
| Operation | p95 | Notes |
|-----------|-----|-------|
| Load hand list | ≤200ms | Paginated/virtualized |
| Show hand detail | ≤150ms | Query + render |
| Import progress | live | Streaming feedback |

### Correctness
| Metric | Target | Notes |
|--------|--------|-------|
| Golden dataset mismatch | 0 | Reference test cases |
| Invariant failures | 0 | sum=0, no chip loss |
| Idempotent imports | ✓ | No duplicates |

---

## Key Documentation

| File | Purpose |
|------|---------|
| [PROJECT_BRIEF.md](./PROJECT_BRIEF.md) | Product spec & constraints |
| [SETUP.md](./SETUP.md) | Development environment |
| [ARCHITECTURE.md](./docs/design/ARCHITECTURE.md) | Module breakdown & contracts |
| [CEV_SPECIFICATION.md](./docs/design/CEV_SPECIFICATION.md) | Realized cEV math & formulas |
| [HH_SCHEMA.md](./docs/design/HH_SCHEMA.md) | Canonical HH & DB schema |
| [IMPORT_PIPELINE.md](./docs/design/IMPORT_PIPELINE.md) | HH ingest architecture |
| [TEST_STRATEGY.md](./docs/TEST_STRATEGY.md) | Unit, integration, golden dataset |
| [PERF_BUDGET.md](./docs/PERF_BUDGET.md) | Performance constraints & guards |
| [UI_SPEC.md](./docs/design/UI_SPEC.md) | V0.1 screens & workflows |
| [VALIDATION_CHECKLIST.md](./docs/VALIDATION_CHECKLIST.md) | Phase 1 completion criteria |
| [GLOSSARY.md](./docs/GLOSSARY.md) | Poker & app terminology |

---

## Contributing

### Pre-commit Checks
```bash
pnpm lint
pnpm format
cargo clippy
cargo fmt --check
```

### ADRs
When making significant architectural decisions, document them in [docs/adr/](./docs/adr/).  
Template: [ADR_TEMPLATE.md](./docs/adr/ADR_TEMPLATE.md)

---

## Deployment

### Docker
```bash
docker build -t expresso-review:v0.1 -f docker/Dockerfile .
docker run -it expresso-review:v0.1
```

### Desktop Bundle
[TBD post-Phase 1: Tauri packaging for macOS/Linux/Windows]

---

## Status

**Current Phase**: Project initialization (structure + docs only, no implementation).

| Phase | Status | ETA |
|-------|--------|-----|
| 1. Realized cEV foundation | 📋 Planning | TBD |
| 2. Replayer & filters | ⏳ Blocked | Post-Phase 1 |
| 3. Optimization & polish | ⏳ Blocked | Post-Phase 2 |

---

## Contact & Questions

[Project team / Slack channel / Issue tracker]

---

**Last updated**: 2026-06-19  
**Version**: V0.1 (feature-frozen)
