# Configuration & Environment

## Development Configuration

### Rust Toolchain

File: `rust-toolchain.toml`

```toml
[toolchain]
channel = \"1.70\"
```

### Cargo Workspace

File: `Cargo.toml` (root)

```toml
[workspace]
members = [
    \"src/rust/hh_parser_winamax\",
    \"src/rust/hand_ledger\",
    \"src/rust/cev_realized_core\",
    \"src/rust/hh_ingest\",
    \"src/rust/session_read_model\",
]

[workspace.dependencies]
serde = { version = \"1.0\", features = [\"derive\"] }
serde_json = \"1.0\"
tokio = { version = \"1.35\", features = [\"full\"] }
sqlx = { version = \"0.7\", features = [\"runtime-tokio-rustls\", \"sqlite\"] }
tracing = \"0.1\"
tracing-subscriber = \"0.3\"
criterion = \"0.5\"
```

---

## Environment Variables

### Development (`.env.local`)

```env
# Rust
RUST_LOG=debug
RUST_BACKTRACE=1

# Database
DATABASE_URL=sqlite://tracker.db?mode=rwc

# Import
IMPORT_BATCH_SIZE=1000
IMPORT_ERROR_TOLERANCE=0.01

# Metrics
METRICS_EXPORT_INTERVAL_SECS=10
```

### Production (`.env.prod`)

```env
RUST_LOG=info
RUST_BACKTRACE=0
DATABASE_URL=sqlite:///var/lib/expresso/tracker.db?mode=rwc
IMPORT_BATCH_SIZE=2000
```

---

## Database Connection

### SQLite Setup

File: `src/rust/common/db.rs`

```rust
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

pub async fn create_pool(database_url: &str) -> Result<sqlx::SqlitePool> {
    let options = SqliteConnectOptions::new()
        .filename(database_url)
        .create_if_missing(true);

    SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .map_err(Into::into)
}
```

### Pragmas (Performance)

```rust
pub async fn init_db(pool: &sqlx::SqlitePool) -> Result<()> {
    sqlx::query(\"PRAGMA journal_mode = WAL\")
        .execute(pool)
        .await?;

    sqlx::query(\"PRAGMA synchronous = NORMAL\")
        .execute(pool)
        .await?;

    sqlx::query(\"PRAGMA cache_size = -64000\")
        .execute(pool)
        .await?;

    Ok(())
}
```

---

## Frontend Configuration

### Vite Config

File: `src/frontend/vite.config.ts`

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    minify: 'esbuild',
    sourcemap: false,
  },
  server: {
    middlewareMode: true,
  },
})
```

### TypeScript Config

File: `src/frontend/tsconfig.json`

```json
{
  \"compilerOptions\": {
    \"target\": \"ES2020\",
    \"lib\": [\"ES2020\", \"DOM\", \"DOM.Iterable\"],
    \"jsx\": \"react-jsx\",
    \"strict\": true,
    \"esModuleInterop\": true,
    \"moduleResolution\": \"bundler\"
  }
}
```

### ESLint

File: `src/frontend/.eslintrc.json`

```json
{
  \"extends\": [
    \"react-app\",
    \"prettier\"
  ],
  \"rules\": {
    \"@typescript-eslint/no-unused-vars\": \"error\",
    \"no-console\": [\"warn\", { \"allow\": [\"warn\", \"error\"] }]
  }
}
```

### Prettier

File: `src/frontend/.prettierrc`

```json
{
  \"semi\": true,
  \"singleQuote\": true,
  \"trailingComma\": \"all\",
  \"printWidth\": 100,
  \"tabWidth\": 2
}
```

---

## Tauri Configuration

File: `src/tauri/tauri.conf.json`

```json
{
  \"build\": {
    \"beforeBuildCommand\": \"pnpm build\",
    \"devPath\": \"http://localhost:5173\",
    \"frontendDist\": \"../frontend/dist\"
  },
  \"app\": {
    \"windows\": [
      {
        \"label\": \"main\",
        \"title\": \"Expresso Review — V0.1\",
        \"width\": 1280,
        \"height\": 800,
        \"minWidth\": 1024,
        \"minHeight\": 768
      }
    ]
  },
  \"security\": {
    \"csp\": \"default-src 'self'; script-src 'self' 'unsafe-inline'\"
  }
}
```

---

## Logging Configuration

File: `src/rust/common/logging.rs`

```rust
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

pub fn init_logging() {
    tracing_subscriber::registry()
        .with(fmt::layer().with_writer(std::io::stderr).json())
        .with(EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| EnvFilter::new(\"info\")))
        .init();
}
```

Example output:
```json
{\"timestamp\":\"2026-06-19T14:23:56.123Z\",\"level\":\"INFO\",\"target\":\"hh_ingest\",\"message\":\"Import started\",\"file\":\"/path/to/hh.txt\"}
```

---

## Pre-commit Hooks

File: `.pre-commit-config.yaml`

```yaml
repos:
  - repo: local
    hooks:
      - id: rust-clippy
        name: Clippy
        entry: cargo clippy
        language: system
        types: [rust]
        pass_filenames: false
        stages: [commit]

      - id: rust-fmt
        name: Rustfmt
        entry: cargo fmt
        language: system
        types: [rust]
        pass_filenames: false
        stages: [commit]

      - id: eslint
        name: ESLint
        entry: pnpm eslint
        language: system
        types: [javascript, typescript]
        stages: [commit]
```

Install:
```bash
pip install pre-commit
pre-commit install
```

---

## CI/CD

File: `.github/workflows/test.yml`

```yaml
name: Tests & Quality

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

      - name: Cache cargo
        uses: actions/cache@v3
        with:
          path: ~/.cargo
          key: ${{ runner.os }}-cargo

      - name: Rust lint
        run: cargo clippy -- -D warnings

      - name: Rust fmt check
        run: cargo fmt -- --check

      - name: Rust tests
        run: cargo test --all --release

      - name: Golden dataset
        run: cargo test golden -- --ignored

      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: 18

      - name: Install pnpm
        run: npm install -g pnpm

      - name: Install frontend deps
        run: pnpm install
        working-directory: ./src/frontend

      - name: Frontend lint
        run: pnpm lint
        working-directory: ./src/frontend

      - name: Frontend tests
        run: pnpm test
        working-directory: ./src/frontend
```

---

## Docker Configuration

File: `docker/compose.yml`

```yaml
version: \"3.8\"

services:
  dev:
    build:
      context: .
      dockerfile: Dockerfile
    volumes:
      - .:/workspace
    environment:
      - RUST_LOG=debug
      - DATABASE_URL=sqlite://tracker.db
    working_dir: /workspace
    command: bash

  test:
    build:
      context: .
      dockerfile: Dockerfile
    volumes:
      - .:/workspace
    environment:
      - RUST_LOG=info
    working_dir: /workspace
    command: |
      bash -c \"
        cargo test --all &&
        pnpm test
      \"
```

File: `docker/Dockerfile`

```dockerfile
FROM rust:1.70 as rust-builder

RUN apt-get update && apt-get install -y \\
    nodejs npm \\
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm

WORKDIR /build

COPY . .

RUN cargo build --release && \\
    pnpm install && \\
    pnpm build

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \\
    ca-certificates \\
    && rm -rf /var/lib/apt/lists/*

COPY --from=rust-builder /build/target/release/expresso_review /usr/local/bin/

CMD [\"bash\"]
```

---

## Profiles & Optimization

### Release Profile

File: `Cargo.toml` (per-crate)

```toml
[profile.release]
opt-level = 3
lto = true
codegen-units = 1
strip = true
```

### Dev Profile

```toml
[profile.dev]
opt-level = 0
```

---

**Last Updated**: 2026-06-19  
**Owner**: DevOps Lead
