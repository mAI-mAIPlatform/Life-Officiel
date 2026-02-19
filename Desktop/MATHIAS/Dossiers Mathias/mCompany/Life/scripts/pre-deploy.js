#!/usr/bin/env node
/**
 * pre-deploy.js — Pre-deployment script for LIFE RPG
 *
 * Runs before every production build to:
 *  1. Generate a sitemap.xml in dist/ (SEO)
 *  2. Log build metadata (version, timestamp)
 *
 * Usage: node scripts/pre-deploy.js
 * Called automatically by: npm run deploy
 */

import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Config ───────────────────────────────────────────────────────────────────

const SITE_URL = process.env.SITE_URL ?? 'https://YOUR_USERNAME.github.io/life-rpg';
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const VERSION = pkg.version ?? '0.0.0';
const BUILD_DATE = new Date().toISOString();

// ── Ensure dist/ exists ───────────────────────────────────────────────────────

const distDir = join(ROOT, 'dist');
mkdirSync(distDir, { recursive: true });

// ── Sitemap ──────────────────────────────────────────────────────────────────

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/</loc>
    <lastmod>${BUILD_DATE.slice(0, 10)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${SITE_URL}/index.html</loc>
    <lastmod>${BUILD_DATE.slice(0, 10)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>
</urlset>
`;

writeFileSync(join(distDir, 'sitemap.xml'), sitemap, 'utf-8');
console.info(`[pre-deploy] ✅ sitemap.xml written to dist/`);

// ── Build metadata ────────────────────────────────────────────────────────────

const meta = {
    name: pkg.name,
    version: VERSION,
    buildDate: BUILD_DATE,
    siteUrl: SITE_URL,
};

writeFileSync(join(distDir, 'build-meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
console.info(`[pre-deploy] ✅ build-meta.json written (v${VERSION} @ ${BUILD_DATE})`);
console.info(`[pre-deploy] 🚀 Pre-deploy complete. Running Vite build next...`);
