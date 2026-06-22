# Expresso Review App — V0.1

**Desktop poker hand review tool for 3-handed Expresso poker** with precise realized cEV calculations and robust hand history import.

## Vision
Build a **clean, maintainable, performant** desktop application to analyze Expresso 3-way poker hands. Priority: **reliable realized cEV foundation** + **fast hand history import**.

**V0.1 is feature-frozen**: No scope creep. Foundation only.

---

## Quick Links
- **[PROJECT_BRIEF.md](./PROJECT_BRIEF.md)** — Full requirements (French)
- **[SETUP.md](./SETUP.md)** — Development environment setup
- **[PRODUCTION_SETUP.md](./PRODUCTION_SETUP.md)** — Installation native sur un autre PC (sans Docker)
- **[ARCHITECTURE.md](./docs/design/ARCHITECTURE.md)** — System design & modules
- **[IMPLEMENTATION_PLAN.md](./docs/IMPLEMENTATION_PLAN.md)** — Phase breakdown & milestones
- **[ADR/](./docs/adr/)** — Architecture Decision Records
- **[CEV_SPECIFICATION.md](./docs/design/CEV_SPECIFICATION.md)** — Realized cEV math & validation rules

---

## Phase 1: Realized cEV Foundation (Blocking)

### Deliverables
- [x] HH import pipeline (Winamax)
- [x] Parsing + normalization
- [x] Ledger: contributions/payouts
- [x] Realized cEV calculation (`stack_end - stack_start`)
- [x] Invariant validation (sum=0, no chips lost)
- [x] Minimal UI (import, session list, hand detail)

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

### Native Install (No Docker)
Pour installer l'app sur une autre machine sans environnement dev Docker,
utiliser le guide complet: **[PRODUCTION_SETUP.md](./PRODUCTION_SETUP.md)**.

#### Quick Install (Copy/Paste)
```bash
# 1) Tooling
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustup update stable

curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
npm install -g pnpm@8
sudo apt-get install -y build-essential libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev

# 2) Build app
git clone https://github.com/RomainBERNAZ/tracker.git
cd tracker
pnpm install --dir src/frontend --frozen-lockfile
cargo tauri build --release

# 3) Run app (Linux AppImage)
chmod +x src-tauri/target/release/bundle/appimage/expresso-review_*.AppImage
./src-tauri/target/release/bundle/appimage/expresso-review_*.AppImage
```

Pour macOS/Windows et le détail complet: **[PRODUCTION_SETUP.md](./PRODUCTION_SETUP.md)**.

---

## Status

**Current Phase**: Phase 1 complete and signed off (all validation gates passed).

| Phase | Status | ETA |
|-------|--------|-----|
| 1. Realized cEV foundation | ✅ Signed off |
| 2. Replayer & filters | ▶️ Ready to start | Next phase |
| 3. Optimization & polish | ⏳ Blocked | Post-Phase 2 |

## Latest Validation Snapshot (2026-06-21)

- Rust tests: 19/19 passing
- Frontend build: passing (`tsc && vite build`)
- Frontend lint: passing (ESLint configured)
- Import validation dataset: 45 tournaments, 901 hands
- Invariants: 901/901 valid (0 invalid)
- Regression outputs: locked reference cases passing
- Previous blocker resolved: short-stack blind all-in parsing fixed and validated

---

## Contact & Questions

[Project team / Slack channel / Issue tracker]

---

**Last updated**: 2026-06-21  
**Version**: V0.1 (feature-frozen)
