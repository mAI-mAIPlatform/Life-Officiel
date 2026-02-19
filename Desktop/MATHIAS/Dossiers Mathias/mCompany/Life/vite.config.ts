import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import compression from 'vite-plugin-compression';
import path from 'path';

const repoName = 'Life-Officiel';
const basePath = process.env.BASE_PATH || `/${repoName}/`;

// https://vitejs.dev/config/
export default defineConfig({
    base: basePath,
    plugins: [
        react(),
        compression({
            algorithm: 'brotliCompress',
            ext: '.br',
            threshold: 10240,
        }),
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
        target: 'esnext',
        chunkSizeWarningLimit: 1024,
        rollupOptions: {
            output: {
                manualChunks(id: string) {
                    if (
                        id.includes('node_modules/react') ||
                        id.includes('node_modules/react-dom') ||
                        id.includes('node_modules/framer-motion') ||
                        id.includes('node_modules/scheduler')
                    ) {
                        return 'vendor-react';
                    }

                    if (
                        id.includes('node_modules/three') ||
                        id.includes('node_modules/@react-three')
                    ) {
                        return 'vendor-three';
                    }

                    if (id.includes('node_modules/@dimforge')) {
                        return 'vendor-rapier';
                    }

                    if (id.includes('node_modules')) {
                        return 'vendor-misc';
                    }

                    if (id.includes('/src/core/')) {
                        return 'game-core';
                    }

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

    server: {
        port: 5173,
        open: true,
    },

    optimizeDeps: {
        exclude: ['@dimforge/rapier3d-compat'],
    },
});
