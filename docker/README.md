# docker — Container Configuration

Docker setup for reproducible dev & test environment.

## Files

- **`Dockerfile`** — Multi-stage build (Rust + Node)
- **`compose.yml`** — Dev & test services
- **`.dockerignore`** — Exclude unnecessary files

## Usage

### Development

```bash
docker compose -f docker/compose.yml up dev
```

Launches bash shell in container with:
- Rust 1.70+
- Node.js 18 + pnpm
- SQLite 3.40+
- Project volume mounted

### Testing

```bash
docker compose -f docker/compose.yml run test
```

Runs:
- Rust tests: `cargo test --all`
- Frontend tests: `pnpm test`
- Golden dataset: `cargo test golden -- --ignored`

### Build for Release

```bash
docker build -t expresso-review:v0.1 -f docker/Dockerfile .
```

Multi-stage build:
1. **Rust builder**: Compile Rust + Frontend
2. **Runtime**: Minimal Debian image with binary

## Environment

See [CONFIG.md](../docs/CONFIG.md) for Docker configuration options.
