# tests — Test Suites

Integration tests, golden dataset, and benchmarks.

## Structure

```
tests/
├── fixtures/
│   ├── golden_dataset.json      # Reference test cases
│   ├── 10k_hands.txt            # Small HH file
│   └── 100k_hands.txt           # Medium HH file
├── golden_dataset_test.rs       # Regression tests
├── import_integration_test.rs    # End-to-end import
└── performance_test.rs          # Perf gates
```

## Running Tests

```bash
# All tests
cargo test

# Only integration tests
cargo test --test '*'

# Golden dataset (ignored by default)
cargo test golden -- --ignored

# Benchmarks
cargo bench --release
```

## Golden Dataset

Pre-calculated reference cases with expected outputs.

File: `fixtures/golden_dataset.json`

```json
{
  \"test_cases\": [
    {
      \"id\": \"golden_001_2way_simple\",
      \"hh_content\": \"...\",
      \"expected\": {
        \"players\": [...],
        \"sum_cev_with_rake\": 0.0
      }
    }
  ]
}
```

All cases must pass (mismatch = 0).

See [TEST_STRATEGY.md](../docs/TEST_STRATEGY.md) for coverage matrix.
