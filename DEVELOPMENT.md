# Lancer BoulangeFinder en local

## Prérequis

- [Node.js](https://nodejs.org/) v18 ou supérieur
- npm (inclus avec Node.js)

## Installation

```bash
# Cloner le dépôt
git clone https://github.com/Cyril5C/BoulangeFinder.git
cd BoulangeFinder

# Installer les dépendances
npm install
```

## Lancer le serveur

### Mode développement (rechargement automatique)

```bash
npm run dev
```

### Mode production

```bash
npm start
```

L'application est accessible sur [http://localhost:3000](http://localhost:3000).

## Connexion

Un mot de passe est requis pour accéder à l'application.

- **Mot de passe par défaut** : `boulanges2024`

## Variables d'environnement

Créer un fichier `.env` à la racine pour personnaliser la configuration :

```env
PORT=3000
APP_PASSWORD=votre-mot-de-passe
SESSION_SECRET=une-clé-secrète-longue-et-aléatoire
NODE_ENV=development
```

| Variable | Défaut | Description |
|---|---|---|
| `PORT` | `3000` | Port d'écoute du serveur |
| `APP_PASSWORD` | `boulanges2024` | Mot de passe d'accès |
| `SESSION_SECRET` | `boulanges-secret-key-change-in-prod` | Clé de signature des sessions |
| `NODE_ENV` | — | Mettre `production` en prod (active les cookies sécurisés) |

## Structure du projet

```
BoulangeFinder/
├── src/
│   ├── server.js        # Point d'entrée Express
│   └── routes/
│       ├── gpx.js       # Upload et traitement des fichiers GPX
│       └── share.js     # Partage de cartes
├── public/              # Frontend statique (HTML, CSS, JS)
├── package.json
└── DEVELOPMENT.md
```

## Utilisation

1. Aller sur [http://localhost:3000](http://localhost:3000)
2. Se connecter avec le mot de passe
3. Uploader un fichier `.gpx` (trace de randonnée, vélo, etc.)
4. L'application affiche les POI (boulangeries, cafés, points d'eau) le long du tracé
