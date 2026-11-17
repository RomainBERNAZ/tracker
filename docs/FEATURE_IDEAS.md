# Idees de fonctionnalites pour progresser en Expresso

Objectif : identifier les situations a travailler et faciliter la review,
plutot qu'ajouter uniquement des graphiques de resultats.

Ces pistes constituent la liste initiale des propositions. Leur avancement
est precise ci-dessous lorsqu'une partie est implementee.

## 1. Statistiques par position et profondeur

Avancement : le suivi par stack du hero est disponible dans Summary > Stacks,
avec filtres HU / 3 joueurs, frequences preflop et resultats en jetons / BB.
Le croisement par position BTN / SB / BB reste une piste a implementer.

Proposer un tableau par position (BTN, SB, BB), en separant les parties
a 3 joueurs du heads-up, puis par profondeur de tapis :

- 0 a 8 BB ;
- plus de 8 a 12 BB ;
- plus de 12 a 20 BB ;
- plus de 20 BB.

Indicateurs simples :

- frequences de limp, raise et tapis ;
- defense de BB face aux steals ;
- fold face aux raises et aux tapis ;
- nombre d'occasions observees pour chaque indicateur.

Exemple de point a examiner : une defense de BB tres faible en heads-up.
Une frequence atypique ne constitue pas automatiquement une erreur.
Toujours afficher la taille de l'echantillon.

## 2. Mains favorites, tags et notes

Depuis le replayer, permettre de marquer une main avec des tags :

- a revoir ;
- call de tapis ;
- defense BB.

Ajouter une note personnelle et une page de review filtrable pour retrouver
ces mains facilement.

## 3. Bilan de session oriente travail

Apres un import, proposer :

- quelques gros pots perdus et gagnes a revoir ;
- les mains marquees ;
- un objectif a retenir pour la prochaine session.

Un gros pot perdu n'est pas necessairement mal joue, et inversement.
La selection sert a lancer une review, pas a qualifier automatiquement
la decision de bonne ou mauvaise.

## 4. Entrainement a partir de ses propres mains

Arreter le replayer juste avant une decision, sans montrer les cartes
adverses ni le resultat.

Le joueur choisit son action, puis la compare avec sa decision initiale
et ses notes de review.

Ne pas presenter une correction comme GTO sans reference fiable et adaptee
au spot. Les ranges experimentales existantes ne suffisent pas a valider
automatiquement les decisions.

## 5. Suivi d'un objectif

Permettre de definir un axe de travail, par exemple :
travailler les defenses de BB entre 10 et 15 BB.

Apres chaque import :

- retrouver les spots correspondant a cet objectif ;
- suivre les frequences de decision et le nombre d'occasions ;
- faciliter la review des mains concernees.

## Ordre de priorite suggere

1. Tags, notes et mains favorites.
2. Statistiques par position et profondeur.
3. Entrainement sur ses propres mains.
4. Bilan de session oriente travail.
5. Suivi d'un objectif.

Boucle recherchee : jouer, identifier, revoir, puis retravailler.
