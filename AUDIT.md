# Audit de Code - BoulangeFinder

**Date** : 2026-01-21
**Score Global** : 68/100

---

## Problèmes Critiques

### 1. Auth faible - Pas de rate limiting
- **Fichier** : `src/server.js:51`
- **Problème** : Endpoint `/api/login` sans protection brute force
- **Fix** : Ajouter `express-rate-limit`

### 2. XSS potentiel dans les popups
- **Fichier** : `public/app.js:225`
- **Problème** : Données POI (nom, type) insérées sans échappement HTML
- **Fix** : Utiliser `textContent` ou échapper les caractères spéciaux

### 3. Pas de validation des paramètres
- **Fichier** : `src/routes/gpx.js:22-31`
- **Problème** : `maxDetour` et `poiTypes` non validés
- **Fix** : Valider avec `joi` ou `zod`, vérifier plage 100-2000

### 4. Pas de limite upload
- **Fichier** : `src/routes/gpx.js`
- **Problème** : Fichiers GPX arbitrairement gros acceptés
- **Fix** : `multer({ limits: { fileSize: 10 * 1024 * 1024 } })`

### 5. Cookie sans SameSite
- **Fichier** : `src/server.js:22`
- **Problème** : Vulnérable CSRF
- **Fix** : Ajouter `sameSite: 'lax'` dans options cookie

---

## Problèmes Modérés

| Problème | Fichier | Fix |
|----------|---------|-----|
| CORS trop permissive | `server.js` | Restreindre à domaines autorisés |
| Pas de compression | `server.js` | `app.use(compression())` |
| Pas de pagination POIs | `gpx.js` | Limiter à 500 POIs max |
| localStorage.clear() | `app.js:68` | Supprimer seulement les vieux caches |
| Haversine dupliquée | `poiService.js` + `geo.js` | Consolider dans `geo.js` |
| Icônes PWA manquantes | `manifest.json` | Générer icon-192.png et icon-512.png |
| Leaflet sans SRI | `index.html` | Ajouter integrity hash |
| Session 7 jours | `server.js` | Réduire à 24h |

---

## Améliorations Suggérées

### Priorité Haute
1. Rate limiting sur `/api/login`
2. Validation stricte des inputs
3. Cookie SameSite
4. Échapper HTML dans popups
5. Limiter taille upload

### Priorité Moyenne
6. Compression gzip
7. Refactoriser `app.js` en modules
8. Ajouter tests unitaires
9. Générer vraies icônes PWA

### Priorité Basse
10. Logging structuré (winston)
11. Monitoring/métriques
12. Support offline complet
13. Recherche spatiale optimisée (quadtree)

---

## Scores par Catégorie

| Catégorie | Score |
|-----------|-------|
| Sécurité | 45/100 |
| Performance | 65/100 |
| Qualité Code | 70/100 |
| Robustesse | 60/100 |
| PWA | 55/100 |
| Dépendances | 85/100 |

---

## Dépendances

Aucune vulnérabilité npm détectée.

| Package | Version | Status |
|---------|---------|--------|
| express | 4.22.1 | OK |
| express-session | 1.18.2 | OK |
| cors | 2.8.5 | Minor updates |
| multer | 1.4.5-lts.2 | OK |
| fast-xml-parser | 4.5.3 | OK |
