# Expresso Review App — V0.1

**Desktop poker hand review tool for 3-handed Expresso poker** with precise realized cEV calculations and robust hand history import.

## Vision
Build a **clean, maintainable, performant** desktop application to analyze Expresso 3-way poker hands. Priority: **reliable realized cEV foundation** + **fast hand history import**.

**V0.1 is feature-frozen**: No scope creep. Foundation only.

---

## Quick Links
- **[PROJECT_BRIEF.md](./PROJECT_BRIEF.md)** — Full requirements (French)
- **[SETUP.md](./SETUP.md)** — Development environment setup
- **[PRODUCTION_SETUP.md](./PRODUCTION_SETUP.md)** — Installation native sur un autre PC (sans Docker)
- **[ARCHITECTURE.md](./docs/design/ARCHITECTURE.md)** — System design & modules
- **[IMPLEMENTATION_PLAN.md](./docs/IMPLEMENTATION_PLAN.md)** — Phase breakdown & milestones
- **[ADR/](./docs/adr/)** — Architecture Decision Records
- **[CEV_SPECIFICATION.md](./docs/design/CEV_SPECIFICATION.md)** — Realized cEV math & validation rules

## Filtres des resultats

- L'application s'ouvre sur Summary. Le menu lateral suit l'ordre Summary, Tournois, Bankroll, GTO (experimental), Import ; l'import reste accessible par `/import`.
- Summary (Resume et Jetons) et Tournois : periode et buy-in, combinables. Les montants proposes correspondent aux tournois importes, rake inclus.
- Coach : le buy-in de Summary s'applique aussi aux statistiques, bilans et erreurs detectees ; sa periode reste definie par ses champs de dates dedies.
- Les dates selectionnent les tournois selon leur debut, en heure locale, et incluent toutes leurs mains, meme apres minuit.
- Le cEV moyen est la somme du Net EV en jetons (gain realise si EV absente), divisee par le nombre de tournois selectionnes. Les deux pages utilisent tout l'historique, sans limite aux 100 derniers tournois.
- Les comparaisons theoriques de multiplicateurs et de variance restent reservees au modele 2 EUR existant ; les resultats observes restent disponibles pour tous les buy-ins.
- Les graphiques cumules de Resume (euros) et Jetons s'etendent jusqu'au bas de la fenetre, avec une hauteur minimale pour rester lisibles sur les petites fenetres.

## Variance des mains de depart

L'onglet Variance de Summary affiche les 169 categories de mains recues par le hero dans une grille 13 x 13 (paires, suited, offsuit). Il utilise les memes filtres de periode et de buy-in que Resume et Jetons.
Au survol ou au focus d'une case : occurrences recues, occurrences attendues et ecart. L'attendu utilise respectivement 6, 4 et 12 combinaisons sur les 1 326 distributions possibles de deux cartes.
Les mains sans cartes de depart exploitables sont signalees et exclues du nombre de mains servant au calcul. Ces ecarts de frequence sont descriptifs, pas un test de hasard.
Chaque case affiche aussi le gain realise moyen par occurrence, au choix en jetons ou en BB, avec le gain total au survol. Les couleurs de fond continuent a representer les frequences recues par rapport a l'attendu, pas la rentabilite.
Les gains en BB sont calcules main par main (`gain realise / grosse blinde`), puis additionnes et moyennes. Une grosse blinde invalide exclut uniquement le gain en BB, avec un avertissement et le nombre d'occurrences exploitables ; les gains en jetons et les frequences restent disponibles. Une moyenne sans occurrence exploitable est affichee par un tiret, pas par zero.
L'encart est limite a la largeur de la grille pour laisser le reste de la page disponible.

### Comparateur de confrontations

Dans Variance, deux grilles independantes permettent de selectionner librement les mains du hero et celles de vilain. Les cases `s` et `o` sont distinctes : selectionner `KJs` et `KJo` couvre KJ. Les raccourcis Toutes, Paires et les familles Ax, Kx, etc. remplacent la selection ; Ax comprend AK a A2 assorties ou non, sans AA.
Le comparateur garde les memes tournois (periode et buy-in) et la meme unite Jetons / BB que la grille. Il porte sur les all-ins preflop sans mise ni fold ulterieur, y compris les tapis adverses couverts par le hero. Les duels et les pots a trois joueurs sont separes ; a trois, au moins un adversaire doit appartenir a la selection, et chaque main compte une seule fois.
Le bilan reel / attendu utilise exactement les memes mains avec EV all-in effectivement calculee (Net EV et part de pot attendue disponibles), et une grosse blinde valide en mode BB. Les cartes inconnues et les EV manquantes sont signalees, sans remplacer artificiellement l'attendu par le resultat reel. La part moyenne du pot attendue tient compte des pots secondaires : ce n'est pas un taux de victoires.
La liste donne acces au replayer et permet d'afficher toutes les confrontations par lots de 50, sans limiter les statistiques a ce premier lot.

### Tableaux preflop experimentaux

L'onglet GTO (experimental) propose une matrice 13x13 pour les formats trois joueurs et heads-up, avec selection du scenario (push, call contre push, 3bet contre open), de la position et du stack effectif.
Les seuils sont des heuristiques indicatives, non des ranges de solveur : ils ne sont pas valides GTO et ne tiennent pas compte des ranges adverses, des sizings ni de l'ICM. Le pourcentage affiche porte sur les categories actives parmi les 169 mains, sans ponderation par leurs combinaisons.

### Bankroll

L'onglet Bankroll permet de saisir une fois son solde exact actuel, idealement apres avoir importe l'historique deja compris dans ce solde. Les identifiants des tournois presents sont memorises : ils ne sont pas recomptes, meme lors d'un reimport. Le solde est ensuite recalcule automatiquement a partir des resultats nets en euros des nouveaux tournois, sans cumuler les evenements d'import ni compter deux fois les doublons. Un nouvel import de tournois anciens jusque-la absents est egalement comptabilise ; si leur resultat etait deja compris dans le solde reel, effectuer une correction apres l'import.

Les depots, retraits et corrections du solde sont conserves dans SQLite, avec un journal manuel distinct des gains de jeu. Une correction saisit un nouveau solde exact (pas une variation). Un retrait ne peut pas depasser le solde disponible. La suppression de tournois comptabilises retire leurs resultats du solde calcule ; les mouvements manuels et les identifiants de l'historique initial restent conserves. La page recharge les resultats a chaque ouverture ; Actualiser permet egalement de les relire.

L'analyse porte sur les 1 000 derniers tournois du buy-in selectionne, ou tous buy-ins confondus. Le filtre ne change jamais le solde global. Sont affiches le cEV ajuste (meme calcul que Summary / Jetons), le resultat en euros et le buy-in moyen rake inclus. La couverture prudente utilise le plus eleve entre le dernier buy-in joue du perimetre et le buy-in moyen recent ; le niveau pour un shot est evalue uniquement sur les tournois complets du dernier buy-in, pour ne pas melanger les performances des petites et grandes limites.

Les regles initiales, modifiables dans la page, alertent strictement sous 150 buy-ins. Un shot exige par defaut 1 000 tournois complets au buy-in de reference, au moins 50 cEV/tournoi, des resultats recents en euros non negatifs a ce buy-in et 300 buy-ins de la limite visee. Le financement requis passe a 250 buy-ins lorsque le cEV atteint l'objectif + 25 (75 par defaut), avec le meme echantillon minimum. La limite visee doit etre renseignee et superieure a la reference. Un cEV negatif sur un echantillon suffisant incite a revoir la limite ; des pertes en euros seules ne declenchent pas une descente si la couverture et le cEV restent suffisants. Ces indications sont des heuristiques de gestion, pas une garantie de gains.

---

## Phase 1: Realized cEV Foundation (Blocking)

### Deliverables
- [x] HH import pipeline (Winamax + Betclic Spin/Rush)
- [x] Parsing + normalization
- [x] Ledger: contributions/payouts
- [x] Realized cEV calculation (`stack_end - stack_start`)
- [x] Invariant validation (sum=0, no chips lost)
- [x] Minimal UI (import, session list, hand detail)

### Validation Gates
✓ 100% invariants pass  
✓ 2-way & 3-way splits exact  
✓ Side pots exact  
✓ Golden dataset: cEV mismatch = 0  
✓ Import idempotent & fast (≥2k hands/s)  
✓ Parse errors ≤0.5%  

**Until Phase 1 is 100% validated, Phase 2 does not start.**

---

## Tech Stack

| Layer | Tech | Notes |
|-------|------|-------|
| **Desktop** | Tauri | Cross-platform, lightweight |
| **Frontend** | React + TypeScript + Vite | Fast HMR, modern tooling |
| **State** | TanStack Query + Zustand | Async data + app state |
| **Backend** | Rust (core modules) | Performance-critical: parsing, ledger, cEV |
| **Database** | SQLite (WAL) | Local, no server dependency |
| **Charts** | ECharts / Recharts | Session visualization |
| **Tests** | Vitest + Playwright (frontend), cargo test + criterion (Rust) | Comprehensive coverage |
| **Quality** | ESLint/Prettier, Clippy/rustfmt, pre-commit | Enforced on CI |
| **Dev Container** | Docker + Compose | Reproducible builds & CI |

---

## Directory Structure

```
tracker/
├── docs/
│   ├── adr/                          # Architecture Decision Records
│   ├── design/                       # Technical specs
│   ├── IMPLEMENTATION_PLAN.md
│   ├── PROJECT_BRIEF.md
│   └── ...
├── src/
│   ├── rust/
│   │   └── Cargo.workspace           # hh_ingest, parser, ledger, cev_realized_core
│   ├── frontend/                     # React app
│   └── tauri/                        # Tauri shell
├── tests/
│   ├── golden_dataset.rs             # Reference test cases
│   └── ...
├── docker/
│   ├── Dockerfile
│   └── compose.yml
├── .github/workflows/                # CI pipeline (ESLint, tests, perf regression)
└── [config files: Cargo.toml, package.json, Dockerfile, etc.]
```

---

## Getting Started

### Prerequisites
- Docker + Docker Compose (recommended)
- OR: Rust 1.70+, Node 18+, pnpm

### Dev Setup
```bash
# With Docker (reproducible)
docker compose -f docker/compose.yml up dev

# OR manual setup
cd /home/rbernaz/tracker
source ./SETUP.md         # Follow instructions
pnpm install
cargo build
```

### Run Tests
```bash
# Rust core tests
cargo test

# Frontend tests
pnpm test

# Integration tests
cargo test --test '*' -- --include-ignored
```

### Import a Hand History
[See UI_SPEC.md for walkthrough]

---

## Metrics & Perf Targets

### Import Performance
| Size | Target | Notes |
|------|--------|-------|
| Small (10k hands) | ≥3,000 hands/s | Parse + insert |
| Medium (100k hands) | ≥2,000 hands/s | Realistic scenario |
| Parse errors | ≤0.5% | Invalid hands tolerated |

### UI Responsiveness
| Operation | p95 | Notes |
|-----------|-----|-------|
| Load hand list | ≤200ms | Paginated/virtualized |
| Show hand detail | ≤150ms | Query + render |
| Import progress | live | Streaming feedback |

### Correctness
| Metric | Target | Notes |
|--------|--------|-------|
| Golden dataset mismatch | 0 | Reference test cases |
| Invariant failures | 0 | sum=0, no chip loss |
| Idempotent imports | ✓ | No duplicates |

---

## Key Documentation

| File | Purpose |
|------|---------|
| [PROJECT_BRIEF.md](./PROJECT_BRIEF.md) | Product spec & constraints |
| [SETUP.md](./SETUP.md) | Development environment |
| [ARCHITECTURE.md](./docs/design/ARCHITECTURE.md) | Module breakdown & contracts |
| [CEV_SPECIFICATION.md](./docs/design/CEV_SPECIFICATION.md) | Realized cEV math & formulas |
| [HH_SCHEMA.md](./docs/design/HH_SCHEMA.md) | Canonical HH & DB schema |
| [IMPORT_PIPELINE.md](./docs/design/IMPORT_PIPELINE.md) | HH ingest architecture |
| [TEST_STRATEGY.md](./docs/TEST_STRATEGY.md) | Unit, integration, golden dataset |
| [PERF_BUDGET.md](./docs/PERF_BUDGET.md) | Performance constraints & guards |
| [UI_SPEC.md](./docs/design/UI_SPEC.md) | V0.1 screens & workflows |
| [VALIDATION_CHECKLIST.md](./docs/VALIDATION_CHECKLIST.md) | Phase 1 completion criteria |
| [GLOSSARY.md](./docs/GLOSSARY.md) | Poker & app terminology |

---

## Contributing

### Pre-commit Checks
```bash
pnpm lint
pnpm format
cargo clippy
cargo fmt --check
```

### ADRs
When making significant architectural decisions, document them in [docs/adr/](./docs/adr/).  
Template: [ADR_TEMPLATE.md](./docs/adr/ADR_TEMPLATE.md)

---

## Deployment

### Docker
```bash
docker build -t expresso-review:v0.1 -f docker/Dockerfile .
docker run -it expresso-review:v0.1
```

### Desktop Bundle
[TBD post-Phase 1: Tauri packaging for macOS/Linux/Windows]

### Native Install (No Docker)
Pour installer l'app sur une autre machine sans environnement dev Docker,
utiliser le guide complet: **[PRODUCTION_SETUP.md](./PRODUCTION_SETUP.md)**.

#### Quick Install (Copy/Paste)
```bash
# 1) Tooling
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustup update stable

curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
npm install -g pnpm@8
sudo apt-get install -y build-essential libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev

# 2) Build app
git clone https://github.com/RomainBERNAZ/tracker.git
cd tracker
pnpm install --dir src/frontend --frozen-lockfile
cargo tauri build

# 3) Run app (Linux AppImage)
chmod +x src-tauri/target/release/bundle/appimage/expresso-review_*.AppImage
./src-tauri/target/release/bundle/appimage/expresso-review_*.AppImage
```

Pour macOS/Windows et le détail complet: **[PRODUCTION_SETUP.md](./PRODUCTION_SETUP.md)**.

---

## Status

**Current Phase**: Phase 1 complete and signed off (all validation gates passed).

| Phase | Status | ETA |
|-------|--------|-----|
| 1. Realized cEV foundation | ✅ Signed off |
| 2. Replayer & filters | ▶️ Ready to start | Next phase |
| 3. Optimization & polish | ⏳ Blocked | Post-Phase 2 |

## Latest Validation Snapshot (2026-06-21)

- Rust tests: 19/19 passing
- Frontend build: passing (`tsc && vite build`)
- Frontend lint: passing (ESLint configured)
- Import validation dataset: 45 tournaments, 901 hands
- Invariants: 901/901 valid (0 invalid)
- Regression outputs: locked reference cases passing
- Previous blocker resolved: short-stack blind all-in parsing fixed and validated

---

## Contact & Questions

[Project team / Slack channel / Issue tracker]

---

**Last updated**: 2026-06-21  
**Version**: V0.1 (feature-frozen)
