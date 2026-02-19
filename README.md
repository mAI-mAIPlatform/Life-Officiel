# Life-Officiel

Ce dépôt contient le projet **LIFE RPG Web Engine** (Vite + React + Three.js), actuellement situé dans :

- `Desktop/MATHIAS/Dossiers Mathias/mCompany/Life`

## Organisation du dépôt

- `.github/workflows/deploy-pages.yml` : pipeline CI/CD pour build + déploiement GitHub Pages.
- `Desktop/MATHIAS/Dossiers Mathias/mCompany/Life` : application web principale.
- `Desktop/MATHIAS/Dossiers Mathias/mCompany/Life/src` : code source.
- `Desktop/MATHIAS/Dossiers Mathias/mCompany/Life/scripts/post-build.js` : génération `.nojekyll`, `sitemap.xml` et `build-meta.json`.

## Démarrage local

```bash
cd "Desktop/MATHIAS/Dossiers Mathias/mCompany/Life"
npm ci
npm run dev
```

## Build production

```bash
cd "Desktop/MATHIAS/Dossiers Mathias/mCompany/Life"
npm run build
```

## Déploiement GitHub Pages

La branche `main` (ou `work`) déclenche automatiquement le workflow :

1. installation des dépendances ;
2. build Vite avec base `/Life-Officiel/` ;
3. publication du dossier `dist` vers GitHub Pages.

Tu dois activer **Settings → Pages → Source: GitHub Actions** dans le dépôt GitHub.
