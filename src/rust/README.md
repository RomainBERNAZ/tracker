# src/rust — Core Backend Modules

This directory contains the Rust workspace with all performance-critical modules.

## Modules

- **`hh_parser_winamax`** — Winamax hand history parser
- **`hand_ledger`** — Ledger & split calculations
- **`cev_realized_core`** — Realized cEV + invariant validation
- **`hh_ingest`** — Import orchestration pipeline
- **`session_read_model`** — Query models for UI

## Structure

```
Cargo.workspace
├── hh_parser_winamax/
│   ├── src/
│   │   ├── lib.rs        # Public API
│   │   ├── parser.rs     # State machine
│   │   ├── error.rs      # Error types
│   │   └── tests.rs
│   └── Cargo.toml
├── hand_ledger/
├── cev_realized_core/
├── hh_ingest/
└── session_read_model/
```

## Building

```bash
cargo build --release
```

## Testing

```bash
cargo test --all
cargo test golden -- --ignored
```

## Benchmarks

```bash
cargo bench --release
```

See [PERF_BUDGET.md](../../docs/PERF_BUDGET.md) for performance targets.
