# Performance Budget & Guards

## Rationale

Performance is **not optional** for a hand history import tool. Slow imports create friction; users will stop using the app.

This document defines:
1. **Perf targets** (hard limits)
2. **Measurement methodology** (how we verify)
3. **CI gates** (prevent regressions)
4. **Acceptable trade-offs** (why these targets)

---

## Import Performance Targets

### Small File (10k hands)

| Metric | Target | Rationale |
|--------|--------|-----------|
| **Throughput** | ≥3,000 hands/sec | Perceptible feedback (10k hands in ~3s) |
| **Parse p50** | ≤0.2ms/hand | Typical hand parse time |
| **Parse p95** | ≤0.5ms/hand | Edge cases (complex all-ins) |
| **Parse p99** | ≤1.0ms/hand | Pathological case |
| **Insert batch p50** | ≤20ms/batch | 1k hands in <20ms (typical) |
| **Insert batch p95** | ≤50ms/batch | Including index updates |
| **Peak memory** | ≤100MB | Streaming parser (constant) |

### Medium File (100k hands)

| Metric | Target | Rationale |
|--------|--------|-----------|
| **Throughput** | ≥2,000 hands/sec | 100k hands in ~50s (session) |
| **Parse p50** | ≤0.3ms/hand | Amortized cost |
| **Parse p95** | ≤0.7ms/hand | |
| **Insert batch p50** | ≤30ms/batch | DB contention, larger txn |
| **Insert batch p95** | ≤80ms/batch | |
| **Peak memory** | ≤150MB | WAL temp files |

### Error Tolerance

| Metric | Target | Rationale |
|--------|--------|-----------|
| **Parse error rate** | ≤0.5% | Corrupted/unsupported HH format |
| **Invalid hand rate** | ≤0.5% | Hands that fail validation (e.g., missing player) |
| **Total recoverable errors** | ≤1.0% | Should still import rest of file |

---

## UI Performance Targets

### Hand List View

| Metric | Target | Notes |
|--------|--------|-------|
| **Initial load (paginated)** | ≤200ms p95 | Query + render (React) |
| **Scroll (virtualized)** | 60 FPS | No jank during scroll |
| **Filter/search** | ≤300ms p95 | DB query + re-render |

### Hand Detail View

| Metric | Target | Notes |
|--------|--------|-------|
| **Initial load** | ≤150ms p95 | Query + timeline + cEV card |
| **Showdown cards reveal** | <50ms | Client-side animation |

### Session Summary

| Metric | Target | Notes |
|--------|--------|-------|
| **Load (100 sessions)** | ≤200ms | Aggregation query |
| **Chart render (ECharts)** | ≤500ms | Complex visualization |

---

## Core Calculation Performance

### cEV Calculation

| Metric | Target | Rationale |
|--------|--------|-----------|
| **Per-hand time** | ≤1ms | Called for every hand on import validation |
| **For 10k hands** | ≤10 sec | Negligible vs I/O |

### Ledger Calculation

| Metric | Target | Rationale |
|--------|--------|-----------|
| **Per-hand time** | ≤0.5ms | Side pot logic, splits |
| **For 10k hands** | ≤5 sec | Part of import pipeline |

### Invariant Validation

| Metric | Target | Rationale |
|--------|--------|-----------|
| **Per-hand time** | ≤0.2ms | Simple math checks |
| **For 10k hands** | ≤2 sec | Blocking step before DB insert |

---

## Resource Constraints

### Memory

| Scenario | Budget | Rationale |
|----------|--------|-----------|
| **Idle app** | <50MB | Minimal overhead |
| **Import 10k** | <100MB RSS | Streaming parser |
| **Import 100k** | <150MB RSS | WAL temp files |
| **Session loaded** | <200MB | Hand data + UI state |

### CPU

| Scenario | Target | Rationale |
|----------|--------|-----------|
| **Import average** | <80% single core | Responsive UI during import |
| **Parse (single core)** | <100% | Acceptable during import |

### Disk

| Scenario | Budget | Rationale |
|----------|--------|-----------|
| **DB size per 10k hands** | ~5–10MB | Indexed schema, WAL |
| **Temp during import** | <50MB | WAL checkpoint |

---

## Measurement & Profiling

### Benchmarking Tool: Criterion

```bash
# Run all benchmarks
cargo bench --release

# Run specific benchmark
cargo bench -- import_small

# View historical results
ls target/criterion/
```

### Profiling Tools

#### Linux/macOS
```bash
# Flamegraph (CPU profile)
cargo install flamegraph
cargo flamegraph --bin hh_ingest -- path/to/hh.txt

# Valgrind (memory)
valgrind --tool=massif ./target/release/app
```

#### Database Query Analysis
```bash
# SQLite query plan
EXPLAIN QUERY PLAN SELECT ...;

# Timing
.timer on
SELECT ... ; -- See execution time
```

#### UI Performance (Chrome DevTools)
1. Open DevTools (F12)
2. Performance tab → Record
3. Perform action (import, list scroll)
4. Stop recording
5. Review: FPS, main thread blocked, layout thrashing

---

## CI Gate: Perf Regression Detection

### GitHub Actions Workflow

```yaml
name: Performance Regression
on: [pull_request]

jobs:
  benchmark:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0
      
      - name: Checkout base branch
        run: git fetch origin main:main
      
      - name: Run benchmarks (base)
        run: |
          cargo bench --release --bench '*' -- --output-format bencher
          cp target/criterion/output.json base_perf.json
      
      - name: Run benchmarks (PR)
        run: |
          cargo bench --release --bench '*' -- --output-format bencher
          cp target/criterion/output.json pr_perf.json
      
      - name: Compare
        run: |
          python3 scripts/perf_compare.py base_perf.json pr_perf.json \
            --threshold 10% \
            --fail-on-regression
```

### Acceptable Regression Policy

| Regression | Tolerance | Action |
|-----------|-----------|--------|
| 0–5% | Acceptable | ✓ Pass CI |
| 5–10% | Investigate | ⚠️ Manual review |
| >10% | Unacceptable | ❌ Fail CI (unless justified) |

---

## Profiling Checklist

When optimizing, follow this process:

### 1. Measure (Baseline)
- [ ] Run benchmark on main branch
- [ ] Capture CPU profile
- [ ] Capture memory profile

### 2. Identify Bottleneck
- [ ] Use flamegraph (where is CPU time?)
- [ ] Check allocation rate (valgrind)
- [ ] Check lock contention (tokio console)

### 3. Optimize
- [ ] Make targeted change
- [ ] Re-measure
- [ ] Commit with before/after numbers

### 4. Validate
- [ ] CI passes
- [ ] Regression test passes
- [ ] No resource regression

---

## Known Performance Characteristics

### Parser Bottlenecks
- **Action parsing**: Most time spent here (~70% of parse time)
- **Regex matching**: If using regex for action patterns (consider DFA or state machine)
- **String allocation**: Each action creates temp strings (consider Cow<str>)

### DB Bottlenecks
- **Index creation**: Happens post-import (offline, acceptable)
- **Foreign key checks**: Disabled during bulk insert (re-enabled after)
- **WAL checkpoint**: Can stall at file boundary (mitigate with transaction batching)

### UI Bottlenecks
- **Large lists**: Virtualization prevents reflow of 100k items
- **Chart rendering**: Defer to requestAnimationFrame
- **Query on main thread**: Use Web Worker for complex queries (if data large)

---

## Trade-Offs & Rationale

### Why 2k hands/sec (not faster)?
- Reasonable completion time (100k in ~50s)
- Allows for rich parsing (error recovery, validation)
- Room for growth (can optimize further if needed)

### Why stream parsing?
- Constant memory (vs load-all-at-once)
- Can report progress in real-time
- Resilient to incomplete files

### Why batch inserts?
- Amortizes transaction overhead
- Reduces DB locks
- Typical batch size (1k) balances latency/throughput

### Why golden dataset?
- Manual perf testing doesn't catch silent regressions
- Automation catches issues in CI
- Cost: ~1–2 weeks initial setup, paid back in confidence

---

## Future Optimization Opportunities

| Idea | Complexity | Est. Gain | Priority |
|------|-----------|----------|----------|
| **SIMD for parsing** | High | 20–30% | Low (already fast) |
| **Parallel batch insert** | Medium | 15–20% | Medium (if needed) |
| **In-memory index** | Medium | 10–15% | Low (DB fast enough) |
| **Tokio async parsing** | Low | 5–10% | Low (sync is fine) |
| **Query result caching** | Medium | 20–30% | Medium (if re-queries common) |

---

## Appendix: Benchmark Templates

### Criterion Benchmark Template

```rust
use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};

fn bench_import(c: &mut Criterion) {
  let mut group = c.benchmark_group("import");
  
  for size in [10_000, 100_000].iter() {
    group.bench_with_input(BenchmarkId::from_parameter(size), size, |b, &size| {
      let path = format!("tests/fixtures/{}_hands.txt", size);
      b.iter(|| import_hand_history(black_box(&path), black_box(ImportConfig::default())));
    });
  }
  
  group.finish();
}

criterion_group!(benches, bench_import);
criterion_main!(benches);
```

---

**Last updated**: 2026-06-19  
**Owner**: Performance Lead
