# Production Setup — Native Build (Non-Docker)

Guide complet pour builder et lancer l'app Expresso Review **sans Docker** sur une autre machine.

---

## Prerequisites

### Rust + Cargo
```bash
# Install Rust (latest stable)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustup update stable

# Verify (should be 1.70+)
cargo --version
```

### Node.js + pnpm
```bash
# Install Node.js LTS (18+)
# macOS
brew install node@18

# Linux (Ubuntu 22.04)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install pnpm
npm install -g pnpm@8

# Verify
node --version    # v18.x+
pnpm --version    # 8.x+
```

### System Libraries (Linux)
```bash
sudo apt-get install -y \
  build-essential \
  libssl-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

### macOS Prerequisites
```bash
# Xcode command-line tools (required for Tauri)
xcode-select --install
```

---

## 1. Clone & Setup

```bash
# Clone the repo
git clone https://github.com/RomainBERNAZ/tracker.git
cd tracker

# Checkout a stable ref (recommended: latest tag)
git fetch --tags
git checkout master

# Install Rust dependencies
cargo build --release --workspace --exclude expresso-review

# Install frontend dependencies
cd src/frontend
pnpm install --frozen-lockfile
cd ../..
```

**First build time**: ~5–10 min (depending on machine).

---

## 2. Build Desktop Bundle

```bash
# From repository root
cargo tauri build --release
```

This will:
- Build Rust backend (core modules + Tauri shell)
- Build React frontend (TypeScript → optimized JS)
- Bundle into platform-specific app

**Output locations**:
- **Linux**: `src-tauri/target/release/bundle/appimage/expresso-review_*.AppImage`
- **macOS**: `src-tauri/target/release/bundle/macos/Expresso Review.app`
- **Windows**: `src-tauri/target/release/bundle/msi/Expresso Review_*.msi`

**Build time**: ~3–5 min (incremental).

---

## 3. Run Desktop App

### Linux (AppImage)
```bash
chmod +x src-tauri/target/release/bundle/appimage/expresso-review_*.AppImage
./src-tauri/target/release/bundle/appimage/expresso-review_*.AppImage
```

### macOS
```bash
open "src-tauri/target/release/bundle/macos/Expresso Review.app"
```

### Windows
```bash
"src-tauri/target/release/bundle/msi/Expresso Review_0.0.1_x64_en-US.msi"
```

App will open at **http://localhost** (embedded Tauri window).

---

## 4. Database Location

Expresso stores SQLite database in the **app data directory**:

### Linux
```bash
~/.local/share/dev.expresso.review/
expresso.db
```

### macOS
```bash
~/Library/Application Support/dev.expresso.review/
expresso.db
```

### Windows
```
%APPDATA%\dev.expresso.review\
expresso.db
```

---

## 5. Import Hand Histories

### UI Method (Recommended)
1. Launch app
2. Click **Import Hand History**
3. Select `.txt` file (or folder with multiple)
4. Progress bar shows import status
5. Review imported tournaments & hands

### Large Dataset Testing

For performance testing on large datasets:

```bash
# Copy your hand history files to a staging directory
mkdir /tmp/test_data
cp /path/to/large_hh_files/*.txt /tmp/test_data/

# Launch app
./expresso-review

# Use folder import in UI (faster than single file)
# Select /tmp/test_data in file chooser
```

**Expected performance**:
- Small dataset (10k hands): ~10–15 sec
- Medium dataset (100k hands): ~2–3 min
- Large dataset (1M+ hands): ~20–30 min

---

## 6. Measure Performance

### Built-in Metrics

After import, the app displays:
- **Total hands imported**
- **Import time**
- **Hands/second** (derived)
- **Invariant stats** (sum_ok, chip_ok, pot_match)
- **Parse error rate**

### Manual Benchmarking

```bash
# Time a Rust import directly (CLI, non-UI)
time cargo run --release -p hh_ingest -- \
  /path/to/hands.txt \
  /path/to/hands_summary.txt \
  ~/.local/share/dev.expresso.review/expresso.db
```

### Monitor System Resources

```bash
# Linux: Watch memory/CPU during import
watch -n 1 'top -b -n 1 | head -15'

# macOS: Activity Monitor
open -a Activity\ Monitor
```

---

## 7. Clear & Reset Data

### In App
1. Settings → Clear All Data
2. Confirm warning
3. Database reset, ready for new import

### Manual (CLI)
```bash
# Backup first
cp ~/.local/share/dev.expresso.review/expresso.db \
   ~/.local/share/dev.expresso.review/expresso.db.backup

# Delete to reset
rm ~/.local/share/dev.expresso.review/expresso.db
# App will recreate fresh on next launch
```

---

## 8. Troubleshooting

### Build Fails: "gtk not found"
```bash
# Linux: Install GTK dev libs
sudo apt-get install -y libgtk-3-dev libayatana-appindicator3-dev
```

### Build Fails: "Tauri command not found"
```bash
# Ensure cargo is in PATH
source "$HOME/.cargo/env"
# Then retry
cargo tauri build --release
```

### App Crashes on Launch
```bash
# Check logs (varies by platform)
# Linux: journalctl -e
# macOS: /var/log/system.log or Console.app
# Windows: Event Viewer
```

### Slow Import Performance
- **Check disk**: `df -h` (ensure >500MB free)
- **Check RAM**: `free -h` (app needs ~100-500MB)
- **Profile**: Run with `RUST_LOG=debug cargo run --release` to see detailed timing

---

## 9. Dev Mode (Optional)

If you want to modify code and test locally without building bundles:

```bash
# Terminal 1: Start frontend dev server
cd src/frontend
pnpm dev

# Terminal 2: Start Tauri dev mode
cargo tauri dev
```

Tauri window will open with hot-reload enabled.

DB location same as above (`~/.local/share/dev.expresso.review/expresso.db`).

---

## 10. Export & Backup

### Export Tournament Report (CSV)

From UI:
1. Select tournament
2. Click **Export**
3. Choose location

### Backup Database

```bash
# Copy entire app data directory
tar -czf expresso_backup_$(date +%Y%m%d).tar.gz \
  ~/.local/share/dev.expresso.review/
```

---

## Performance Targets (V0.1)

| Metric | Target | Notes |
|--------|--------|-------|
| Small import (10k hands) | ≥3k hands/sec | Parse + insert |
| Medium import (100k hands) | ≥2k hands/sec | Realistic dataset |
| Hand detail load | ≤150ms p95 | UI responsiveness |
| Hand list load | ≤200ms p95 | Pagination friendly |
| Parse error rate | ≤0.5% | Graceful degradation |
| Invariant pass rate | 100% | Data integrity |

---

## Phase 2 Roadmap

After V0.1 validation on large datasets:
- [ ] Replayer (timeline of actions per hand)
- [ ] Advanced filters (position, result, opponent)
- [ ] Session summary dashboard
- [ ] Performance optimization (indexing, caching)

---

## Support

See main **[README.md](./README.md)** and **[SETUP.md](./SETUP.md)** for more details.

Questions or issues: Check [docs/](./docs/) or create an issue on GitHub.

---

**Last updated**: 2026-06-21  
**V0.1 Production Build Checklist**: ✅ Passed
