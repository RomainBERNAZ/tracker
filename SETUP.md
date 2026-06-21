# Development Environment Setup

## Overview
Expresso Review App supports two setup modes:
1. **Docker (recommended)** — Reproducible, standardized
2. **Manual** — For native iteration during development

---

## Prerequisites

### Global
- **Git** 2.30+
- **Docker** 25.0+ and **Docker Compose** 2.20+ (option 1)
- OR **Rust** 1.70+, **Node.js** 18+, **pnpm** 8+ (option 2)

### macOS
```bash
brew install rust node@18
brew install pnpm
# Docker Desktop: https://www.docker.com/products/docker-desktop/
```

### Linux (Ubuntu 22.04)
```bash
sudo apt update && sudo apt install -y cargo rustc nodejs npm git
npm install -g pnpm
# Docker: https://docs.docker.com/engine/install/ubuntu/
```

### Windows
- [Visual Studio Build Tools 2022](https://visualstudio.microsoft.com/downloads/) (C++ workload)
- [Rust via rustup](https://rustup.rs/)
- [Node.js LTS via installer](https://nodejs.org/)
- [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/)

---

## Option 1: Docker Setup (Recommended)

### Quick Start
```bash
cd /home/rbernaz/tracker

# Build dev container
docker compose -f docker/compose.yml build dev

# Launch dev environment
docker compose -f docker/compose.yml run dev bash
```

Inside the container:
```bash
# Install dependencies
pnpm install
cargo build

# Run tests
cargo test
pnpm test

# Start dev server (React + Tauri)
pnpm dev
```

### What's Included
- Rust 1.70+ with Clippy
- Node.js 18 with pnpm
- SQLite 3.40+
- Pre-commit hooks
- VS Code Dev Container integration

---

## Option 2: Manual Setup

### 1. Install Rust
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustup update stable
cargo --version  # Should be 1.70+
```

### 2. Install Node.js & pnpm
```bash
# macOS
brew install node@18
npm install -g pnpm

# Linux (via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
npm install -g pnpm

# Verify
node --version   # v18.x
pnpm --version   # 8.x+
```

### 3. Clone & Install Project Dependencies
```bash
cd /home/rbernaz/tracker

# Install Rust dependencies
cargo build --release

# Install frontend dependencies
pnpm install

# Install pre-commit hooks
pre-commit install  # OR: curl -fsSLO https://pre-commit.com/misc/hook-framework.sh
```

### 4. Verify Setup
```bash
# Test Rust
cargo test --lib

# Test frontend
pnpm test

# Test tools
cargo clippy
pnpm lint
```

---

## Workspace Structure

```
tracker/
├── src/
│   ├── rust/                           # Core modules
│   │   └── Cargo.workspace
│   │       ├── hh_ingest/              # Hand history import pipeline
│   │       ├── hh_parser_winamax/      # Winamax parser
│   │       ├── hand_ledger/            # Ledger & contributions
│   │       ├── cev_realized_core/      # cEV calculation engine
│   │       └── session_read_model/     # Query models
│   ├── frontend/                       # React + TypeScript + Vite
│   │   ├── src/
│   │   ├── public/
│   │   ├── package.json
│   │   └── vite.config.ts
│   └── tauri/                          # Tauri shell
│       └── tauri.conf.json
├── tests/
│   ├── golden_dataset.rs               # Reference test cases
│   └── integration/
├── docker/
│   ├── compose.yml
│   ├── Dockerfile
│   └── .dockerignore
├── docs/
│   └── [architecture, specs, ADRs]
└── .github/workflows/                  # CI/CD
```

---

## Development Workflow

### Start Development Server
```bash
# Option 1: Docker
docker compose -f docker/compose.yml up dev

# Option 2: Manual
pnpm dev
```

This launches:
- React dev server (Vite, HMR) on port 5173
- Tauri window with hot reload

### Run Tests
```bash
# All tests
pnpm test           # Frontend (Vitest)
cargo test          # Rust (all crates)

# Watch mode
pnpm test --watch
cargo watch -x test

# Specific test suite
cargo test -p cev_realized_core
pnpm test src/components/__tests__
```

### Code Quality
```bash
# Linting
pnpm lint           # ESLint + TS check
cargo clippy        # Rust lint

# Formatting
pnpm format         # Prettier
cargo fmt           # rustfmt

# Pre-commit (auto runs on commit)
pre-commit run --all-files
```

### Performance Testing
```bash
# Criterion benchmarks (Rust)
cargo bench --release

# Frontend metrics (Lighthouse)
pnpm build
pnpm preview  # Then audit with Chrome DevTools
```

---

## Environment Variables

### `.env.local` (frontend)
```env
VITE_API_URL=http://localhost:8000
VITE_DEBUG=true
```

### `.cargo/config.toml` (Rust profile)
```toml
[build]
jobs = 4

[profile.release]
opt-level = 3
lto = true
```

---

## Troubleshooting

### Rust Build Fails
```bash
# Update toolchain
rustup update

# Clean & rebuild
cargo clean
cargo build
```

### Node Dependencies Conflict
```bash
# Clear pnpm store
pnpm store prune

# Reinstall
rm pnpm-lock.yaml
pnpm install
```

### Docker Permission Denied
```bash
# Add user to docker group (Linux)
sudo usermod -aG docker $USER
newgrp docker
```

### Tauri Build Issues
```bash
# Regenerate Tauri bindings
cargo tauri dev --verbose

# Check Tauri requirements
cargo tauri info
```

---

## IDE Setup

### VS Code

#### Recommended Extensions
- **Rust Analyzer** (rust-lang.rust-analyzer)
- **Prettier** (esbenp.prettier-vscode)
- **ESLint** (dbaeumer.vscode-eslint)
- **Tauri** (tauri-apps.tauri-vscode)
- **Dev Containers** (ms-vscode-remote.remote-containers)

#### `settings.json`
```json
{
  "[rust]": {
    "editor.defaultFormatter": "rust-lang.rust-analyzer",
    "editor.formatOnSave": true
  },
  "[typescript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode",
    "editor.formatOnSave": true
  },
  "rust-analyzer.check.command": "clippy",
  "rust-analyzer.checkOnSave.allTargets": true
}
```

#### Launch Dev Container
1. Open workspace root in VS Code
2. Press `Ctrl+Shift+P` → "Dev Containers: Reopen in Container"
3. VS Code rebuilds & mounts workspace

### JetBrains (RustRover / IntelliJ IDEA)

#### Quick Setup
- Open `/home/rbernaz/tracker` as project
- RustRover auto-detects Rust toolchain
- Go to **Settings** → **Languages & Frameworks** → **Rust** → Enable clippy

---

## Next Steps

1. ✅ Environment set up
2. → Read [ARCHITECTURE.md](./docs/design/ARCHITECTURE.md) for module overview
3. → Review [CEV_SPECIFICATION.md](./docs/design/CEV_SPECIFICATION.md) for core math
4. → Check [IMPLEMENTATION_PLAN.md](./docs/IMPLEMENTATION_PLAN.md) for task breakdown

---

## CI/CD Pipeline

Tests run automatically on every commit (pre-commit hook) and on push (GitHub Actions):
- Rust: clippy, fmt, test (all crates)
- Frontend: ESLint, Prettier, Vitest
- Perf regression gates (see [PERF_BUDGET.md](./docs/PERF_BUDGET.md))

---

**Last updated**: 2026-06-19
