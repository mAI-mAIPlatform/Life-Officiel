import type { Config } from 'tailwindcss';

const config: Config = {
    content: ['./index.html', './src/**/*.{ts,tsx}'],
    theme: {
        extend: {
            // ── Color Palette ──────────────────────────────────────────────────
            colors: {
                neon: {
                    cyan: '#00f5ff',
                    violet: '#b700ff',
                    pink: '#ff2d78',
                    green: '#00ff88',
                    amber: '#ffb800',
                    red: '#ff1744',
                },
                glass: {
                    white: 'rgba(255,255,255,0.06)',
                    dark: 'rgba(0,0,0,0.45)',
                    border: 'rgba(255,255,255,0.10)',
                    glow: 'rgba(0,245,255,0.15)',
                },
                surface: {
                    100: '#0a0c12',
                    200: '#12151f',
                    300: '#1a1f2e',
                    400: '#22293d',
                },
            },
            // ── Typography ─────────────────────────────────────────────────────
            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
                mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
                display: ['Outfit', 'Inter', 'sans-serif'],
            },
            // ── Spacing / Border Radius ────────────────────────────────────────
            borderRadius: {
                '4xl': '2rem',
                '5xl': '2.5rem',
            },
            // ── Box Shadow ─────────────────────────────────────────────────────
            boxShadow: {
                'neon-cyan': '0 0 12px rgba(0,245,255,0.6), 0 0 40px rgba(0,245,255,0.2)',
                'neon-violet': '0 0 12px rgba(183,0,255,0.6), 0 0 40px rgba(183,0,255,0.2)',
                'neon-pink': '0 0 12px rgba(255,45,120,0.6),0 0 40px rgba(255,45,120,0.2)',
                'glass': '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)',
                'phone': '0 40px 120px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.06)',
            },
            // ── Keyframe Animations ────────────────────────────────────────────
            keyframes: {
                'pulse-glow': {
                    '0%, 100%': { opacity: '1', filter: 'brightness(1)' },
                    '50%': { opacity: '0.7', filter: 'brightness(1.4)' },
                },
                'hologram-flicker': {
                    '0%,100%': { opacity: '1' },
                    '8%': { opacity: '0.85' },
                    '15%': { opacity: '1' },
                    '55%': { opacity: '0.92' },
                    '60%': { opacity: '1' },
                },
                'chromatic-shift': {
                    '0%': { textShadow: '-2px 0 rgba(255,0,0,0.5), 2px 0 rgba(0,0,255,0.5)' },
                    '25%': { textShadow: '2px 0 rgba(255,0,0,0.5), -2px 0 rgba(0,0,255,0.5)' },
                    '50%': { textShadow: '-2px 0 rgba(0,255,0,0.5), 2px 0 rgba(255,0,255,0.5)' },
                    '100%': { textShadow: '2px 0 rgba(0,255,0,0.5), -2px 0 rgba(255,0,255,0.5)' },
                },
                'scan-line': {
                    '0%': { transform: 'translateY(-100%)' },
                    '100%': { transform: 'translateY(100vh)' },
                },
                'slide-up': {
                    from: { transform: 'translateY(100%)', opacity: '0' },
                    to: { transform: 'translateY(0)', opacity: '1' },
                },
                'slide-down': {
                    from: { transform: 'translateY(-100%)', opacity: '0' },
                    to: { transform: 'translateY(0)', opacity: '1' },
                },
                'fade-in': {
                    from: { opacity: '0', transform: 'scale(0.95)' },
                    to: { opacity: '1', transform: 'scale(1)' },
                },
                'toast-in': {
                    from: { transform: 'translateX(110%)', opacity: '0' },
                    to: { transform: 'translateX(0)', opacity: '1' },
                },
                'vignette-pulse': {
                    '0%,100%': { opacity: '0.0' },
                    '50%': { opacity: '0.8' },
                },
                'spin-slow': {
                    '0%': { transform: 'rotate(0deg)' },
                    '100%': { transform: 'rotate(360deg)' },
                },
            },
            animation: {
                'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
                'hologram-flicker': 'hologram-flicker 4s step-end infinite',
                'chromatic-shift': 'chromatic-shift 0.3s linear infinite',
                'scan-line': 'scan-line 3s linear infinite',
                'slide-up': 'slide-up 0.35s cubic-bezier(0.34,1.56,0.64,1) both',
                'slide-down': 'slide-down 0.3s ease-out both',
                'fade-in': 'fade-in 0.25s ease-out both',
                'toast-in': 'toast-in 0.4s cubic-bezier(0.34,1.56,0.64,1) both',
                'vignette-pulse': 'vignette-pulse 0.8s ease-in-out infinite',
                'spin-slow': 'spin-slow 8s linear infinite',
            },
            backdropBlur: {
                xs: '2px',
                '3xl': '48px',
            },
        },
    },
    plugins: [],
};

export default config;
