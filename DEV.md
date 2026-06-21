# 🚀 Guide Dev Server

## Lancer l'app rapidement

### Option 1: Make (recommandé)
```bash
make dev
```
Cela:
- Arrête les containers existants
- Relance le dev server proprement
- Lance Vite (frontend) et Cargo (backend)

Puis ouvre: **http://localhost:5173**

### Option 2: Docker compose direct
```bash
sudo docker compose -f docker/compose.yml up dev
```

## Arrêter l'app
```bash
make dev-stop
```

ou

```bash
sudo docker compose -f docker/compose.yml down
```

## Temps de démarrage
- **Première fois**: ~60 sec (compilation compète)
- **Après changements**: ~30 sec (incremental Rust build)
- **Changements frontend uniquement**: ~5 sec (Vite hot-reload)

## Données persistentes
- La DB SQLite est sauvegardée dans le volume Docker `expresso-data`
- Les données importées restent après redémarrage
- Pour réinitialiser: `docker volume rm expresso-data`

## Troubleshooting

### L'app ne répond pas après 2 min
L'app compile en arrière-plan. Attends 30-60 sec supplémentaires, puis recharge le navigateur.

### Connexion refusée sur 5173
```bash
# Vérifier si le container tourne
sudo docker ps | grep dev

# Voir les logs
sudo docker logs docker-dev-1
```

### Réinitialiser complètement
```bash
sudo docker compose -f docker/compose.yml down --remove-orphans
docker volume rm expresso-data
make dev
```
