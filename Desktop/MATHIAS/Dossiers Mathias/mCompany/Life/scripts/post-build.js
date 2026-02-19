#!/usr/bin/env node
/**
 * post-build.js — Post-build script for LIFE RPG
 *
 * Runs AFTER the production build to:
 *  1. Generate a sitemap.xml in dist/ (SEO)
 *  2. Log build metadata (version, timestamp)
 *  3. Create .nojekyll to prevent GitHub Pages from ignoring files
 *
 * Usage: node scripts/post-build.js
 * Called automatically by: npm run build
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = join(ROOT, 'dist');

// ── Validation ───────────────────────────────────────────────────────────────

if (!existsSync(DIST)) {
    console.error(`[post-build] ❌ 'dist' directory not found. Run 'vite build' first.`);
    process.exit(1);
}

// ── Config ───────────────────────────────────────────────────────────────────

const SITE_URL = process.env.SITE_URL ?? 'https://YOUR_USERNAME.github.io/life-rpg';
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const VERSION = pkg.version ?? '0.0.0';
const BUILD_DATE = new Date().toISOString();

// ── .nojekyll ────────────────────────────────────────────────────────────────

// Vital for GitHub Pages to serve files starting with "_" (like _assets)
writeFileSync(join(DIST, '.nojekyll'), '', 'utf-8');
console.info(`[post-build] ✅ .nojekyll created`);

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

writeFileSync(join(DIST, 'sitemap.xml'), sitemap, 'utf-8');
console.info(`[post-build] ✅ sitemap.xml written to dist/`);

// ── Build metadata ────────────────────────────────────────────────────────────

const meta = {
    name: pkg.name,
    version: VERSION,
    buildDate: BUILD_DATE,
    siteUrl: SITE_URL,
};

writeFileSync(join(DIST, 'build-meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
console.info(`[post-build] ✅ build-meta.json written (v${VERSION} @ ${BUILD_DATE})`);
