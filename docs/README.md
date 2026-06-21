# docs — Documentation Hub

Comprehensive documentation for Expresso Review App V0.1.

## Structure

```
docs/
├── README.md (this file)
├── IMPLEMENTATION_PLAN.md      # Phase breakdown & milestones
├── VALIDATION_CHECKLIST.md     # Phase 1 completion criteria
├── TEST_STRATEGY.md            # Testing pyramid & coverage
├── PERF_BUDGET.md              # Performance targets & regression gates
├── GLOSSARY.md                 # Terminology & abbreviations
├── CONFIG.md                   # Configuration & environment setup
├── adr/                        # Architecture Decision Records
│   ├── INDEX.md                # ADR list & navigation
│   ├── ADR_TEMPLATE.md         # Template for new ADRs
│   └── (individual ADRs)
└── design/                     # Technical specifications
    ├── ARCHITECTURE.md         # System design & modules
    ├── CEV_SPECIFICATION.md    # Realized cEV math & invariants
    ├── HH_SCHEMA.md            # Hand history & DB schema
    ├── IMPORT_PIPELINE.md      # Import orchestration
    ├── UI_SPEC.md              # V0.1 screens & flows
    └── (future specs)
```

## Quick Navigation

| Document | Purpose |
|----------|---------|
| [README.md](../README.md) | Project overview & quick start |
| [PROJECT_BRIEF.md](../PROJECT_BRIEF.md) | Product requirements (French) |
| [SETUP.md](../SETUP.md) | Development environment setup |
| [ARCHITECTURE.md](./design/ARCHITECTURE.md) | System design & module contracts |
| [CEV_SPECIFICATION.md](./design/CEV_SPECIFICATION.md) | cEV math & validation rules |
| [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) | Phase 1 breakdown (12 weeks) |
| [TEST_STRATEGY.md](./TEST_STRATEGY.md) | Testing approach & coverage |
| [PERF_BUDGET.md](./PERF_BUDGET.md) | Performance targets & CI gates |
| [VALIDATION_CHECKLIST.md](./VALIDATION_CHECKLIST.md) | Phase 1 sign-off criteria |
| [adr/INDEX.md](./adr/INDEX.md) | Architecture decisions (ADRs 001–007) |

## Key Concepts

- **Phase 1**: Import + Ledger + cEV + Minimal UI (feature-frozen)
- **Realized cEV**: $stack_{end} - stack_{start}$ (factual outcome)
- **Invariants**: Sum=0, chips accounted, no negatives
- **Idempotency**: Reimport same file = no duplicates
- **Performance**: ≥2k hands/sec, UI p95 ≤150ms

## For New Contributors

1. Start with [README.md](../README.md) & [SETUP.md](../SETUP.md)
2. Read [ARCHITECTURE.md](./design/ARCHITECTURE.md) for system overview
3. Check [GLOSSARY.md](./GLOSSARY.md) for terminology
4. Review relevant ADRs in [adr/](./adr/)
5. Follow [CONTRIBUTING.md](../CONTRIBUTING.md) for code standards

## For Poker Domain Experts

1. Review [PROJECT_BRIEF.md](../PROJECT_BRIEF.md) (French product spec)
2. Read [CEV_SPECIFICATION.md](./design/CEV_SPECIFICATION.md) for cEV definition & examples
3. Check [VALIDATION_CHECKLIST.md](./VALIDATION_CHECKLIST.md) for correctness criteria
4. Review golden dataset in [tests/fixtures/](../tests/fixtures/) for reference cases

## For Backend Developers

1. Read [ARCHITECTURE.md](./design/ARCHITECTURE.md) for module breakdown
2. Study [IMPORT_PIPELINE.md](./design/IMPORT_PIPELINE.md) for orchestration flow
3. Review [HH_SCHEMA.md](./design/HH_SCHEMA.md) for DB design
4. Check [TEST_STRATEGY.md](./TEST_STRATEGY.md) for testing approach
5. Follow performance targets in [PERF_BUDGET.md](./PERF_BUDGET.md)

## For Frontend Developers

1. Read [UI_SPEC.md](./design/UI_SPEC.md) for screen designs & flows
2. Review [ARCHITECTURE.md](./design/ARCHITECTURE.md) for IPC contracts
3. Check [src/frontend/README.md](../src/frontend/README.md) for component structure
4. Run `pnpm dev` to start Tauri dev server

## Maintenance

- **Dates**: All docs updated 2026-06-19
- **Version**: V0.1 (feature-frozen)
- **Owner**: Tech Lead (ADRs), Project Lead (roadmap)

---

**Last updated**: 2026-06-19
