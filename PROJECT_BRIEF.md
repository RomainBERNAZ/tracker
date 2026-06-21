# PROJECT BRIEF — Expresso Review App (V0.1, feature-frozen)

## 1) Objectif
Construire une app desktop de review Expresso (3-handed), **propre, maintenable, performante**.
Priorité absolue: **socle cEV réalisé fiable** + **import HH rapide**.
Aucune nouvelle feature hors périmètre V0.1.

---

## 2) Règles produit non négociables
- Docker-first (dev/test reproductibles).
- UI/UX simple, lisible, sans surcharge.
- Import manuel HH avec barre de progression détaillée.
- Architecture modulaire, testable.
- Expresso 3-way uniquement.
- **Run it twice: hors scope**.
- Différencier strictement:
  - cEV réalisé (factuel)
  - cEV décisionnel (analyse ultérieure)

---

## 3) Vérité métier validée pendant la discussion

### 3.1 cEV réalisé (priorité Étape 1)
$$cEV_{realized} = stack_{end} - stack_{start}$$

Invariants:
1. Somme cEV joueurs = 0 (hors rake)
2. Side pots exacts
3. Splits d'équité gérés en 2-way et 3-way
4. Odd chips déterministes (policy room)
5. Aucun chip perdu/créé

### 3.2 cEV décisionnel (documenté, pas prioritaire)
$$cEV = Eq \times P_{final} - C_{add}$$
- Baseline = moment de décision
- `C_add` = coût additionnel depuis ce state
- Pas de double comptage blindes

Cas référence validé:
- HU préflop SB vs BB, 500 effectifs, AKs vs 55:
  - pot pertinent = 1000
  - EV(AKs) ≈ 0.46×1000−500 = -40

---

## 4) Scope V0.1 (ordre bloquant)

### Étape 1 (bloquante)
- Import HH
- Parsing + normalisation
- Ledger contributions/gains
- Calcul `cEV_realized`
- Validation invariants
- UI affichage factuel

**Stop ici tant que non validé à 100%.**

### Étape 2 (après validation Étape 1)
- Replayer simple
- Filtres mains
- Résumé session propre

---

## 5) Stack recommandée
- Desktop: **Tauri**
- Front: **React + TypeScript + Vite**
- State/data: TanStack Query + Zustand
- Core perf (import/ledger/cEV): **Rust**
- DB locale: **SQLite (WAL)**
- Charts: ECharts/Recharts
- Tests:
  - Front: Vitest + Playwright
  - Rust: cargo test + integration + criterion
- Qualité: ESLint/Prettier + Clippy/rustfmt + pre-commit
- Docker/Compose pour standardiser dev/test/CI

---

## 6) Architecture modulaire minimale
- `hh_ingest`
- `hh_parser_winamax` (ou parser room dédié)
- `hand_ledger`
- `cev_realized_core`
- `session_read_model`
- `ui_shell`

Règles:
- Domaine pur séparé I/O
- Pas de logique métier dans UI
- Contrats explicites entre modules

---

## 7) Import pipeline (critique perf)
1. Lecture streaming
2. Parsing incrémental
3. Normalisation schéma canonique
4. Validation structure
5. Insert DB batchée
6. Post-validations/invariants

Exigences:
- Idempotence (pas de doublons)
- Gestion erreurs partielles
- Reprise propre
- Logs JSON + métriques live

---

## 8) UI V0.1 (sobre)
Écrans:
1. Import (drag/drop, progression, ETA, erreurs)
2. Sessions (tableau)
3. Mains (liste filtrable performante)
4. Détail main (table + timeline + panneau cEV réalisé)
5. Review session (résultat vs cEV réalisé)

Important:
- V0.1 = factuel d'abord, pas solver/GTO.
- Design premium minimal (pas dashboard "moche").

---

## 9) Métriques perf obligatoires
Import:
- mains/s
- parse p50/p95/p99
- insert batch p50/p95
- error rate
- invalid hand rate
- temps total import

Read/UI:
- p95 liste mains
- p95 détail main

Core:
- temps calcul cEV/main
- mismatch vs golden dataset = 0

Ressources:
- pic mémoire (RSS)
- CPU moyen import

---

## 10) Perf budget initial (garde-fous)
- Import S (10k): >= 3,000 mains/s
- Import M (100k): >= 2,000 mains/s
- Parse error rate <= 0.5%
- Invalid hand rate <= 0.5%
- Détail main UI p95 <= 150ms
- Liste mains UI p95 <= 200ms
- cEV mismatch golden = 0
- Régression perf CI tolérée max 10%

---

## 11) Stratégie de tests
- Unit: parser, ledger, splits, side pots, invariants
- Integration: import end-to-end
- Golden dataset: cas figés attendus
- Perf tests: non-régression
- E2E UI: import -> progression -> consultation main/session

---

## 12) Definition of Done (Étape 1)
Valider uniquement si:
1. invariants critiques 100% passés
2. splits 2-way/3-way corrects
3. side pots corrects
4. cEV réalisé exact sur golden dataset
5. import idempotent
6. perf budget respecté
7. UI affiche correctement les résultats
8. rapport de validation livré

---

## 13) Ce qu'on ne fait pas en V0.1
- Pas de run-it-twice
- Pas d'extensions feature non demandées
- Pas d'analyse avancée avant socle cEV réalisé validé
- Pas de métriques EV sans hypothèses explicites

---

## 14) Style d'analyse poker attendu (pour agents)
Ne pas "claim" une expérience joueur invérifiable.
À la place, imposer des heuristiques:
- prioriser spots à gros impact EV,
- distinguer erreur technique / stratégique / variance,
- expliciter hypothèses et niveau de confiance,
- recommandations actionnables et concises.

---

## 15) Livrables immédiats demandés aux agents
1. Arbo docs + ADRs
2. Schéma canonique HH/domain
3. Implémentation import pipeline
4. Implémentation `cev_realized_core`
5. Matrice de tests V0.1 + golden dataset
6. Instrumentation métriques + logs
7. UI V0.1 minimale
8. Rapport de validation Étape 1

---

**Fin du brief.**

Document créé: 2026-06-19  
Version: V0.1 (feature-frozen)
