# ─── Stage 0: base system deps ────────────────────────────────────────────────
FROM ubuntu:22.04 AS base

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8

RUN apt-get update && apt-get install -y --no-install-recommends \
    # Build essentials
    build-essential \
    curl \
    wget \
    git \
    pkg-config \
    # Rust / OpenSSL
    libssl-dev \
    # Tauri system dependencies (GTK + WebKit)
    libwebkit2gtk-4.1-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    patchelf \
    # SQLite (for dev tooling; rusqlite/bundled compiles its own)
    libsqlite3-dev \
    sqlite3 \
    # Misc utils
    ca-certificates \
    xz-utils \
    file \
    && rm -rf /var/lib/apt/lists/*

# ─── Stage 1: Rust toolchain ──────────────────────────────────────────────────
FROM base AS rust-base

ENV RUSTUP_HOME=/usr/local/rustup
ENV CARGO_HOME=/usr/local/cargo
ENV PATH=/usr/local/cargo/bin:$PATH

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --default-toolchain stable --no-modify-path \
    && rustup component add clippy rustfmt \
    && cargo install tauri-cli --version "^2" --locked

# ─── Stage 2: Node + pnpm ─────────────────────────────────────────────────────
FROM rust-base AS dev

ENV NODE_VERSION=20
RUN curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm

WORKDIR /app

# Pre-cache cargo registry (bust cache only when Cargo.toml changes)
COPY Cargo.toml Cargo.lock* ./
COPY src/rust/hh_parser_winamax/Cargo.toml src/rust/hh_parser_winamax/Cargo.toml
COPY src/rust/hand_ledger/Cargo.toml         src/rust/hand_ledger/Cargo.toml
COPY src/rust/cev_realized_core/Cargo.toml   src/rust/cev_realized_core/Cargo.toml
COPY src/rust/hh_ingest/Cargo.toml           src/rust/hh_ingest/Cargo.toml
COPY src/rust/session_read_model/Cargo.toml  src/rust/session_read_model/Cargo.toml
COPY src-tauri/Cargo.toml                    src-tauri/Cargo.toml

# Dummy sources so cargo can resolve the workspace without copying everything
RUN mkdir -p src/rust/hh_parser_winamax/src \
             src/rust/hand_ledger/src \
             src/rust/cev_realized_core/src \
             src/rust/hh_ingest/src \
             src/rust/session_read_model/src \
             src-tauri/src \
    && for crate in hh_parser_winamax hand_ledger cev_realized_core hh_ingest session_read_model; do \
         echo "pub fn _dummy() {}" > src/rust/$crate/src/lib.rs; \
       done \
        && echo "pub fn _dummy() {}" > src-tauri/src/lib.rs \
    && echo "fn main(){}" > src-tauri/src/main.rs \
    && cargo fetch

CMD ["bash"]

# ─── Stage 3: Rust release builder ───────────────────────────────────────────
FROM dev AS rust-builder

COPY . .
RUN cargo build --release --workspace \
    --exclude expresso-review 2>&1

# ─── Stage 4: Tauri release build ────────────────────────────────────────────
FROM dev AS tauri-builder

COPY . .
RUN cd src/frontend && pnpm install --frozen-lockfile \
    && cd /app \
    && cargo tauri build --config src-tauri/tauri.conf.json
