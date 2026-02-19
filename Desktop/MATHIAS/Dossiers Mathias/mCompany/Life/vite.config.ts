import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import compression from 'vite-plugin-compression';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
    base: '/Life-Officiel/', // Updated to match repository name for GitHub Pages
    plugins: [
        react(),

        // Brotli compression for production assets
        compression({
            algorithm: 'brotliCompress',
            ext: '.br',
            threshold: 10240, // Only compress files > 10 KB
        }),

        // Gzip fallback for servers that don't support Brotli
        compression({
            algorithm: 'gzip',
            ext: '.gz',
            threshold: 10240,
        }),
    ],

    resolve: {
        alias: {
            '@core': path.resolve(__dirname, 'src/core'),
            '@features': path.resolve(__dirname, 'src/features'),
            '@audio': path.resolve(__dirname, 'src/audio'),
            '@gameplay': path.resolve(__dirname, 'src/gameplay'),
            '@ui': path.resolve(__dirname, 'src/ui'),
        },
    },

    build: {
        // Target esnext for Top-level Await (required for WebGPU / WASM)
        target: 'esnext',

        // Raise warning threshold to 1 MB (Three.js + Rapier are large)
        chunkSizeWarningLimit: 1024,

        rollupOptions: {
            output: {
                /**
                 * Manual chunk splitting strategy:
                 *   vendor-react   — React + React-DOM + Framer-Motion
                 *   vendor-three   — Three.js + @react-three/fiber + @react-three/drei
                 *   vendor-rapier  — Rapier physics engine (WASM)
                 *   vendor-misc    — Remaining third-party libs
                 *   game-core      — ECS, Loop, Engine internals
                 *   game-features  — Gameplay, Audio, UI systems
                 */
                manualChunks(id: string) {
                    // Vendor — React ecosystem
                    if (
                        id.includes('node_modules/react') ||
                        id.includes('node_modules/react-dom') ||
                        id.includes('node_modules/framer-motion') ||
                        id.includes('node_modules/scheduler')
                    ) {
                        return 'vendor-react';
                    }

                    // Vendor — Three.js ecosystem
                    if (
                        id.includes('node_modules/three') ||
                        id.includes('node_modules/@react-three')
                    ) {
                        return 'vendor-three';
                    }

                    // Vendor — Rapier physics (contains WASM blob)
                    if (id.includes('node_modules/@dimforge')) {
                        return 'vendor-rapier';
                    }

                    // Vendor — Everything else
                    if (id.includes('node_modules')) {
                        return 'vendor-misc';
                    }

                    // Game — Core engine
                    if (id.includes('/src/core/')) {
                        return 'game-core';
                    }

                    // Game — Features (gameplay/audio/UI/features)
                    if (
                        id.includes('/src/features/') ||
                        id.includes('/src/gameplay/') ||
                        id.includes('/src/audio/') ||
                        id.includes('/src/ui/')
                    ) {
                        return 'game-features';
                    }
                },
            },
        },
    },

    // Dev server — serve from root
    server: {
        port: 5173,
        open: true,
    },

    // Optimise Rapier WASM pre-bundling
    optimizeDeps: {
        exclude: ['@dimforge/rapier3d-compat'],
    },
});
