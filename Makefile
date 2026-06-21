# Makefile

.PHONY: help build test lint fmt clean dev docs

help:
\t@echo \"Expresso Review App — Build & Development\"
\t@echo \"\"
\t@echo \"Targets:\"
\t@echo \"  make build       Build all (Rust + Frontend)\"
\t@echo \"  make test        Run all tests (unit + integration)\"
\t@echo \"  make lint        Lint (Rust clippy + ESLint)\"
\t@echo \"  make fmt         Format code (Rust fmt + Prettier)\"
\t@echo \"  make dev         Start dev server (Docker)\"
\t@echo \"  make dev-stop    Stop dev server\"
\t@echo \"  make docs        Generate documentation\"
\t@echo \"  make bench       Run benchmarks\"
\t@echo \"  make clean       Clean build artifacts\"
\t@echo \"  make docker      Build Docker image\"

build:
	cargo build --release --workspace --exclude expresso-review
	cd src/frontend && pnpm install --frozen-lockfile && pnpm build

test:
	cargo test --all --release --exclude expresso-review
	cd src/frontend && pnpm install --frozen-lockfile && pnpm test --run

test-golden:
	cargo test golden --all -- --ignored

lint:
	cargo clippy --all --exclude expresso-review -- -D warnings
\tcd src/frontend && pnpm lint

fmt:
	cargo fmt --all
\tcd src/frontend && pnpm format

fmt-check:
	cargo fmt --all -- --check
\tcd src/frontend && pnpm format --check

dev:
	sudo docker compose -f docker/compose.yml down --remove-orphans 2>/dev/null || true
	@echo "🚀 Lancement du dev server (Docker)..."
	@echo "   Frontend: http://localhost:5173"
	@echo "   Attends ~30-60 sec pour la compilation..."
	@echo ""
	sudo docker compose -f docker/compose.yml up dev

dev-stop:
	sudo docker compose -f docker/compose.yml down --remove-orphans

bench:
	cargo bench --release --exclude expresso-review

docs:
	cargo doc --no-deps --open --exclude expresso-review

clean:
\tcargo clean
	rm -rf src/frontend/dist src/frontend/node_modules target

docker:
	docker build -t expresso-review:v0.1 -f docker/Dockerfile --target dev .

setup:
	@echo "Docker-first setup:"
	@echo "  docker compose -f docker/compose.yml build dev"
	@echo "  docker compose -f docker/compose.yml run dev bash"

.DEFAULT_GOAL := help
