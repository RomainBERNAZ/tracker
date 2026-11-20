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

## Releases et CI

Les tags `v*` lancent les builds Linux (AppImage/deb) et Windows (MSI) en parallele,
puis publient la release lorsque les deux plateformes ont reussi.
Le CLI Tauri precompile est installe avec les dependances frontend et verrouille
dans leur lockfile, sans `cargo install tauri-cli` a chaque release.
Depuis la racine : `pnpm --dir src/frontend tauri build --config src-tauri/tauri.conf.json`.

La CI et les releases utilisent les caches pnpm et Rust. Le cache Rust Linux de
la branche `master` peut etre reutilise par les tags ; les caches crees sous un
tag restent limites a ce tag pour les relances, notamment sous Windows.
Un premier build, un cache absent ou un changement de toolchain reste plus lent.
La duree reelle est a comparer dans les etapes GitHub Actions, sans garantie de temps.
La CI de `master` execute aussi les tests frontend.

## Filtres des resultats

- L'application s'ouvre sur Summary. Le menu latéral regroupe le suivi (Résumé, Tournois, Bankroll), la review (Mains à revoir), les analyses avancées et l'import. Advanced rassemble « Jeu short-stack », « Connexion au flop », « Confrontations » et « Ranges exploratoires ». Les anciennes adresses `/short-stack`, `/hitting-board` et `/gto` redirigent vers les pages correspondantes.
- Summary (Resume et Jetons) et Tournois : periode et buy-ins, combinables. Les montants proposes correspondent aux tournois importes, rake inclus. Les pastilles buy-in permettent de selectionner plusieurs limites simultanement ; "Tous" reinitialise la selection, et desactiver la derniere limite revient aussi a tous les buy-ins.
- Coach : les buy-ins de Summary s'appliquent aussi aux statistiques, bilans et erreurs detectees ; sa periode reste definie par ses champs de dates dedies.
- Le Coach affiche un bilan sans note globale, des fréquences préflop avec leurs dénominateurs, les statistiques par profondeur et format, ainsi que l'écart réalisé / Net EV sur les mêmes mains disposant d'une EV. Les données short-stack et flop servent de points d'entrée vers les analyses détaillées. Les spots call/push restent des pistes heuristiques à vérifier, pas des erreurs établies.
- La review personnelle permet d'ajouter notes, tags, favoris et statut « revue faite » depuis une main ou son replay. La file est filtrable et l'objectif de travail du Coach est conservé localement. Ces annotations survivent à la suppression puis au réimport des historiques.
- Les dates selectionnent les tournois selon leur debut, en heure locale, et incluent toutes leurs mains, meme apres minuit.
- Les raccourcis Aujourd'hui et Hier selectionnent le jour calendaire local entier (changements d'heure compris), dans les filtres de dates Summary et Tournois. Coach propose les memes raccourcis pour ses dates independantes.
- Les choix de consultation restent en memoire pendant la session : onglet Summary, periodes/buy-ins, filtres Stacks/Tapis/Variance/Coach, ranges du comparateur, tris et recherches des mains par tournoi, et selections GTO. Ouvrir un detail/replay puis revenir (bouton Retour ou retour navigateur) ne les reinitialise plus. Les listes de duels conservent aussi le nombre de lignes affichees par selection. Les donnees sont rechargees a l'ouverture ; les choix ne sont pas sauvegardes apres fermeture/rechargement de l'application.
- Le cEV moyen est la somme du Net EV en jetons (gain realise si EV absente), divisee par le nombre de tournois selectionnes. Les deux pages utilisent tout l'historique, sans limite aux 100 derniers tournois.
- La comparaison theorique des multiplicateurs reste reservee au modele 2 EUR existant ; les multiplicateurs observes restent affiches pour tous les buy-ins.
- Le tableau des multiplicateurs aligne les occurrences observées et, lorsque le modèle est disponible, les occurrences attendues et l'écart (observé moins attendu).
- Dans Résumé, le net ajusté part du net réel et ajoute l'écart (EV − résultat) de chaque tapis calculable, converti au prorata de la cagnotte réelle et du total de jetons. Aucun changement de multiplicateur. Correction limitée aux formats à trois joueurs reconnus avec un seul payé : [Winamax Expresso](https://www.winamax.fr/expresso) jusqu'à x20 et [Betclic Spin & Rush](https://www.betclic.fr/poker/scp-spin-and-rush) jusqu'à x10, sur les multiplicateurs connus. Les autres tournois restent au net importé. Ce n'est pas une estimation de toute la variance ni un profit attendu à long terme.
- Les graphiques cumules de Resume (euros) et Jetons s'etendent jusqu'au bas de la fenetre, avec une hauteur minimale pour rester lisibles sur les petites fenetres.

## Connexion au flop (Advanced)

Le graphique affiche les effectifs et pourcentages de chaque segment sous chaque
barre, même pour les petites catégories : paire ou mieux en bleu, tirage direct
sans paire en jaune, absence des deux en gris. Les grands segments affichent aussi
leur pourcentage dans la barre ; le total des connexions reste à droite.

L'onglet analyse les flops vus par Hero à partir des historiques importés, sans
écrire de données. Le filtre Tous / HU / 3-way compte les joueurs encore dans
le coup au flop, pas le nombre de joueurs distribués. Le graphique sépare les
open raises et iso-raises (Hero est l'unique relanceur), les pots sans relance, les
pots avec une seule relance adverse et les pots 3-bet ou plus, qui regroupent
toutes les surrelances préflop. Un call (même à tapis) par un autre joueur
avant l'unique relance de Hero en fait un iso-raise. La position reste celle
de la distribution initiale.

Chaque flop analysable reçoit une seule catégorie. Une paire ou un brelan
du tableau seul est ignoré ; une vraie double paire à laquelle Hero contribue
est classée « deux paires ou mieux ». Les gutshots simples et doubles sont
regroupés. Un combo draw combine un tirage couleur et un tirage quinte directs.
Les tirages sont aussi comptés séparément, y compris avec une main faite. Les
backdoors requièrent une contribution de Hero et ne sont pas des tirages directs.

La connexion est définie par « paire ou mieux, ou tirage direct ». Les filtres
habituels de date de début de tournoi et de buy-ins s'appliquent. Si une date de début
est choisie, la référence est tout l'historique antérieur pour les buy-ins
sélectionnés. Les tests sont bilatéraux, regroupés par tournoi et corrigés pour les
dix contextes (cinq types de pots × deux formats, Bonferroni).
Une différence n'est testée qu'avec au moins
50 flops, 30 tournois, 5 connexions et 5 non-connexions de chaque côté.
Ce n'est pas une comparaison à un modèle théorique ni une preuve de malchance.

## Jeu short-stack (Advanced)

L'onglet compare deux périodes choisies manuellement, sans chevauchement. Les dates
s'appliquent au début des tournois (jours locaux), et les filtres de room, buy-in,
format, position, stack, rang, action et révélation sont communs. Les résultats
nets vérifient que les échantillons sont effectivement gagnant et perdant.

Une observation est une paire Hero–vilain en interaction préflop, avec le minimum
des deux stacks de départ à 5 BB ou moins. Un limp suivi d'un check ou une
relance suivie d'un fold compte ; un walk ou un fold sans mise active de l'autre
joueur ne compte pas. En 3-way, une main peut donner deux observations. Le rang
est calculé par vilain et par tournoi sur l'historique complet, avant filtrage.
Il redémarre après chaque passage observé de plus de 5 BB à 5 BB ou moins ; sans
transition observée ou si la continuité des stacks est rompue, il reste indéterminé.

Les cartes non révélées comptent dans le volume mais pas dans la répartition.
Les IC à 95 % (Wilson), les tests Chi² ou exacts de Fisher et les écarts en points
de pourcentage sont exploratoires : ils ne corrigent ni le biais de révélation,
ni la dépendance entre observations du même tournoi. Le calcul à la demande
estime l'équité **préflop en duel**, même pour une situation 3-way, et la distingue
de l'EV nette importée du coup complet.

## Statistiques par profondeur de stack

Dans **Summary → Jetons**, les filtres 3 joueurs / Heads-up et Stack Hero se
combinent avec la période et les buy-ins. Ils s'appliquent aux totaux et aux
courbes. Les tranches sont celles de Stacks (0–8, >8–12, >12–20 et >20 BB,
sélection multiple), mesurées avant les blindes. La contribution cEV reste
divisée par tous les tournois du périmètre date et buy-in.

L'onglet Stacks de Summary analyse le stack du hero au debut de chaque main,
avant les blindes, en BB : 0-8, >8-12, >12-20 et >20 BB. Les bornes hautes
sont incluses. Il conserve les filtres date et buy-ins de Summary et propose
une multiselection de profondeurs, un filtre heads-up / 3 joueurs et les unites
jetons / BB. Ces filtres de mains restent propres a l'onglet.
Les filtres communs sont regroupes en blocs Buy-ins et Periode ; les dates
personnalisees restent dans le bloc Periode. Les filtres Stacks separent
Format des mains, Unite des resultats et Stack hero, avec un rappel des choix multiples.

La lecture principale se concentre sur le volume, le net / 100 et l'EV / 100
mains, avec des barres divergentes a echelle commune et des gains/pertes colores.
Le Net EV total et la contribution cEV restent visibles ; les totaux avec/sans
showdown sont accessibles dans un volet de details. Une couleur par statistique
preflop permet de suivre les colonnes, sans qualifier un taux de bon ou mauvais.
Le repere "Peu de mains" sous 100 mains est purement visuel, pas un seuil de
fiabilite. Un guide recommande de separer HU et 3 joueurs, de comparer en BB
et de verifier les positions et decisions avant de conclure a un leak.
Sous « Total selection », le Leak finder Expresso interprete les resultats par
profondeur et format (HU et 3 joueurs separes meme sur Tous). Il distingue une
perte ajustee EV en BB ou en jetons, un reel perdant avec EV non negative et une EV incomplete,
repere quelques tendances preflop extremes et propose des decisions precises
a revoir : SB/BB, bouton a 3 joueurs, push/fold, limp/minraise/shove, reshoves et
pots postflop selon la profondeur. Le diagnostic examine toujours les BB et les
jetons, quel que soit l'affichage des tableaux ; la contribution cEV reste en
jetons par tournoi. Un ecart de signe BB / jetons est explique explicitement.
Un bouton isole le segment dans les tableaux.

Ce diagnostic est heuristique, pas un solveur ni une preuve de leak. Il demande
200 mains par segment, et 200 mains avec actions pour les pistes preflop.
Le VPIP HU sous 40 % est signale seulement au-dessus de 8 BB. Le fold au 3-bet
demande 30 decisions : au moins 80 % de folds, ou au plus 20 % au-dessus de 12 BB.
Ces reperes ne sont ni des objectifs GTO ni des seuils de confiance statistique.
Les pistes preflop passent avant les pertes EV, puis le tri utilise leur impact
en jetons. Toute EV manquante suspend le diagnostic de performance du segment.
Les limps HU, les pertes sans showdown et l'absence de 3-bet face aux tapis ne
sont pas assimiles automatiquement a des erreurs. Positions, sizings, stack
effectif et structure des gains restent a verifier dans les mains.

Les tableaux affichent les mains, VPIP, PFR, limp (overlimps inclus), 3-bet et
fold au 3-bet, avec leurs compteurs et denominateurs. Les blindes forcees ne
comptent pas comme actions volontaires. Les frequences sont agregees a partir
des compteurs, jamais en moyennant les pourcentages des groupes.

Les resultats comprennent le net, le Net EV et leurs decompositions avec/sans
showdown du hero. Une main foldee par le hero reste sans showdown meme si les
adversaires vont au showdown. En BB, chaque gain est divise par la grosse blinde
de sa propre main avant addition.

Le cEV / tournoi est la contribution du segment : somme du Net EV de ses mains
divisee par tous les tournois du perimetre date/buy-ins, toujours en jetons.
Les contributions des tranches s'additionnent au cEV global lorsque toutes les
mains sont exploitables. L'EV / 100 mains rapporte plutot le resultat au volume
de mains du segment. La selection HU ou profondeur ne change pas le denominateur
du cEV / tournoi.

Comme dans Jetons, le gain realise remplace le Net EV absent ; le nombre de mains
concernees est signale. Les mains sans historique preflop restent dans les gains
mais pas dans les frequences. Les stacks/blindes invalides et les formats autres
que 2/3 joueurs sont exclus explicitement. Les taux atypiques et les petits
echantillons ne sont pas presentes comme des erreurs automatiques.

## Tapis preflop et couverture

L'onglet Tapis de Summary compare « Je couvre vilain », « Vilain me couvre »
et les stacks egaux, selon les stacks au debut de la main avant les blindes.
Il garde les filtres date et buy-ins de Summary. Seuls les tapis preflop payes,
sans mise ni fold ulterieur, sont retenus : un troisieme joueur ayant folde
preflop est autorise, mais les vrais pots multiway sont exclus explicitement.
Les cartes inconnues n'empechent pas de compter un duel.

Le tableau par multiplicateur croise les volumes avec la couverture. La sélection
d'un multiplicateur filtre les bilans et la liste des duels. Le « Net ajusté »
conserve les multiplicateurs réels et ajoute au net des tournois l'écart
(EV − réel) des duels convertibles, valorisé par la cagnotte divisée par
le nombre total de jetons. L'onglet affiche le nombre de duels corrigés ;
il s'agit d'une estimation proportionnelle, et non d'un calcul ICM pour
les tournois qui paient plusieurs places.

Chaque groupe affiche le volume, les equites moyennes hero et vilain, les
victoires / defaites / partages et les gains nets en jetons ou BB. L'equite
est la part attendue du pot conteste, partages inclus, moyenne par duel sans
ponderation par les montants ; celle de vilain vaut un moins celle du hero
sur le meme echantillon. Ce n'est pas la probabilite de gagner sans partage.
Les pots secondaires garantis sont retires de la part de pot importee et des
collectes pour determiner l'equite et l'issue du duel : un duel perdu peut
malgre tout laisser un gain net positif. Le taux de victoires utilise toutes
les issues connues, partages inclus ; une issue inconnue n'est pas une defaite.

Les echantillons disponibles sont affiches separement pour equites, issues,
gains observes et comparaison reel / EV. Cette derniere utilise exactement
les memes duels valides, sans remplacement d'EV manquante. Les pots incoherents,
les collectes non standards et le rake en jetons non nul sont signales :
les valeurs non calculables restent indisponibles, jamais inventees.
En BB, chaque gain est divise par sa propre grosse blinde ; une blinde invalide
exclut uniquement les gains en BB. Aucun reimport n'est requis pour les stacks
et collectes deja presents ; les equites historiques manquantes restent absentes.
La liste filtrable par couverture donne acces aux replays par lots de 50,
sans limiter les bilans au premier lot.
Les mains sont dessinees avec rangs et couleurs de cartes ; les cartes inconnues
restent masquees. Les stacks hero/vilain suivent le selecteur Jetons / BB et
affichent aussi leur equivalence, avec une indisponibilite explicite si la blinde manque.

## Lecture des replays

La table et ses contrôles restent au centre du replay. Les boutons **Actions** et
**Notes** ouvrent le même panneau, fermé par défaut.
Dans **Tournois**, **Rejouer** ouvre la première main du tournoi. En mode Lecture,
les mains s’enchaînent dans l’ordre ; les boutons Main précédente / suivante
permettent aussi de naviguer manuellement.
Le joueur actif est souligne, le dealer et les joueurs couches/a tapis sont identifies.
Les cartes sont partagees avec la liste des duels ; les cartes futures du board restent
masquees jusqu'a leur street. Jetons / BB s'applique aux stacks, au pot et aux actions.
Les relances distinguent
le montant cible (« a ») de l'increment (« de »).
Le pot fourni par le modele actuel est le total final importe, pas un pot dynamique :
il est donc nommé « Pot final ». Navigation par action,
curseur, lecture automatique et raccourcis clavier restent disponibles ; les
raccourcis ne capturent pas la saisie dans les controles.

## Mains de départ

L'onglet **Mains de départ** de Résumé affiche les 169 catégories de mains reçues par le héros dans une grille 13 × 13. Il utilise les mêmes filtres de période et de buy-in que Résumé et Jetons.
Le filtre « Stack de départ maximal » garde les mains dont le stack du héros au début de la main, divisé par la grosse blinde de cette main, ne dépasse pas le seuil choisi. Les seuils sont entiers à partir de 15 BB et par demi-blinde en dessous. Les mains sans stack ou grosse blinde valide restent incluses si aucun seuil n'est sélectionné.
Au survol ou au focus d'une case : occurrences recues, occurrences attendues et ecart. L'attendu utilise respectivement 6, 4 et 12 combinaisons sur les 1 326 distributions possibles de deux cartes.
Les mains sans cartes de depart exploitables sont signalees et exclues du nombre de mains servant au calcul. Ces ecarts de frequence sont descriptifs, pas un test de hasard.
Chaque case affiche aussi le gain realise moyen par occurrence, au choix en jetons ou en BB, avec le gain total au survol. Les couleurs de fond continuent a representer les frequences recues par rapport a l'attendu, pas la rentabilite.
Les gains en BB sont calcules main par main (`gain realise / grosse blinde`), puis additionnes et moyennes. Une grosse blinde invalide exclut uniquement le gain en BB, avec un avertissement et le nombre d'occurrences exploitables ; les gains en jetons et les frequences restent disponibles. Une moyenne sans occurrence exploitable est affichee par un tiret, pas par zero.
L'encart est limite a la largeur de la grille pour laisser le reste de la page disponible.

## Comparateur de confrontations

Le comparateur se trouve dans **Analyses avancées → Confrontations**, séparément de l'onglet **Mains de départ**. Deux grilles indépendantes permettent de sélectionner librement les mains du hero et celles de vilain. Les cases `s` et `o` sont distinctes : sélectionner `KJs` et `KJo` couvre KJ. Les raccourcis Toutes, Paires et les familles Ax, Kx, etc. remplacent la sélection ; Ax comprend AK à A2 assorties ou non, sans AA.
Les filtres de période et de buy-in ainsi que l'unité Jetons / BB sont propres à cette page. Le comparateur porte sur les all-ins préflop sans mise ni fold ultérieur, y compris les tapis adverses couverts par le hero. Les duels et les pots à trois joueurs sont séparés ; à trois, au moins un adversaire doit appartenir à la sélection, et chaque main compte une seule fois.
Le bilan réel / attendu utilise exactement les mêmes mains avec EV all-in effectivement calculée (Net EV et part de pot attendue disponibles), et une grosse blinde valide en mode BB. Les cartes inconnues et les EV manquantes sont signalées, sans remplacer artificiellement l'attendu par le résultat réel. La part moyenne du pot attendue tient compte des pots secondaires : ce n'est pas un taux de victoires.
La liste donne accès au replayer et permet d'afficher toutes les confrontations par lots de 50, sans limiter les statistiques à ce premier lot.

### Tableaux preflop experimentaux

L'onglet GTO (experimental) propose une matrice 13x13 pour les formats trois joueurs et heads-up, avec selection du scenario (push, call contre push, 3bet contre open), de la position et du stack effectif.
Les seuils sont des heuristiques indicatives, non des ranges de solveur : ils ne sont pas valides GTO et ne tiennent pas compte des ranges adverses, des sizings ni de l'ICM. Le pourcentage affiche porte sur les categories actives parmi les 169 mains, sans ponderation par leurs combinaisons.

### Bankroll

L'onglet Bankroll permet de saisir une fois son solde exact actuel, idealement apres avoir importe l'historique deja compris dans ce solde. Les identifiants des tournois presents sont memorises : ils ne sont pas recomptes, meme lors d'un reimport. Le solde est ensuite recalcule automatiquement a partir des resultats nets en euros des nouveaux tournois, sans cumuler les evenements d'import ni compter deux fois les doublons. Un nouvel import de tournois anciens jusque-la absents est egalement comptabilise ; si leur resultat etait deja compris dans le solde reel, effectuer une correction apres l'import.

Les depots, retraits et corrections du solde sont conserves dans SQLite, avec un journal manuel distinct des gains de jeu. Une correction saisit un nouveau solde exact (pas une variation). Un retrait ne peut pas depasser le solde disponible. La suppression de tournois comptabilises retire leurs resultats du solde calcule ; les mouvements manuels et les identifiants de l'historique initial restent conserves. La page recharge les resultats a chaque ouverture ; Actualiser permet egalement de les relire.

L'analyse porte sur les 1 000 derniers tournois des buy-ins selectionnes, ou tous buy-ins confondus. Les memes pastilles multiselection sont disponibles dans Bankroll. Le filtre ne change jamais le solde global. Sont affiches le cEV ajuste (meme calcul que Summary / Jetons), le resultat en euros et le buy-in moyen rake inclus. La couverture prudente utilise le plus eleve entre le dernier buy-in joue du perimetre et le buy-in moyen recent ; le niveau pour un shot est evalue uniquement sur les tournois complets du dernier buy-in, pour ne pas melanger les performances des petites et grandes limites.

La courbe d'evolution part du solde initial et ajoute uniquement les resultats
non inclus dans ce solde, ainsi que les depots, retraits et variations de correction.
Elle est reconstruite par date de debut des tournois, pas par date d'import :
les imports anterieurs a l'initialisation sont places juste apres le point initial.
Les mouvements manuels gardent leur date et les corrections leur variation enregistree.
Les evenements sont espaces uniformement sur l'axe horizontal ; les dates sont
affichees sur l'axe et au survol. Le dernier point correspond au solde global courant.

La simulation part du solde courant et couvre de 1 a 250 000 tournois avec cEV
parametrable. Le bilan recent reste un constat, pas une projection.
La simulation utilise exclusivement le modele public Winamax 2 EUR
deja present dans Summary, partage sans changer les calculs existants de Summary.
Avec 500 jetons de depart et trois joueurs, la probabilite de victoire approchee
est `(500 + cEV) / 1500` (cEV entre -500 et 1000).
Le gain espere par tournoi vaut `2 * (probabilite * multiplicateur moyen - 1)` :
le multiplicateur s'applique une seule fois au buy-in total de 2 EUR.
Les couts sont deja inclus ; le rake n'est pas soustrait une seconde fois.

500 parcours donnent une trajectoire exemple et les percentiles 5-95 % a chaque
volume, en plus de l'esperance theorique. Un nouveau tirage ne change pas
l'esperance. Le modele simplifie attribue tout le prizepool au vainqueur,
meme pour les gros multiplicateurs normalement repartis ; il n'est pas actualise
automatiquement. Les jackpots rares peuvent manquer dans les tirages et placer
l'esperance hors de la bande. Ce n'est ni un intervalle de confiance ni une
garantie. Il n'y a pas d'arret faute de fonds ni de changement de limite :
une valeur negative signifie un besoin de financement. Le filtre buy-in change
l'analyse des tournois recents, pas la simulation 2 EUR ni l'historique global.

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
