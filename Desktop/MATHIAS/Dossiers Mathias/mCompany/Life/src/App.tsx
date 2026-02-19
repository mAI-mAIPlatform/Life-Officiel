/**
 * @fileoverview LIFE RPG — Main Application Entry Point
 *
 * Layer order (z-index ascending):
 *   10  WorldUI   — Canvas/Three.js scene (behind everything)
 *   100 HUD       — DiegeticHUD overlay
 *   150 Toasts    — Notification stack (above HUD)
 *   200 Phone     — PhoneWrapper modal
 *   300 PauseMenu — SettingsMenu modal
 *
 * The 3D Canvas lives at z=0 (natural stacking).
 * All UI stores are singleton Zustand stores — no React context needed.
 */
import React, { useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';

import './ui/styles/globals.css';

// Stores
import { useUIStore } from './ui/store/useUIStore';
import { useSettingsStore } from './ui/store/useSettingsStore';

// HUD
import DiegeticHUD from './ui/hud/DiegeticHUD';

// Phone
import PhoneWrapper from './ui/phone/PhoneWrapper';

// Settings
import SettingsMenu from './ui/settings/SettingsMenu';

// Input
import { inputManager } from './ui/input/InputManager';

// ── Demo Scene (placeholder until Three.js canvas is wired in) ────────────────

function DemoScene() {
    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 0,
            background: 'radial-gradient(ellipse at 30% 40%, #1a1f2e 0%, #0a0c12 60%, #050709 100%)',
            overflow: 'hidden',
        }}>
            {/* Animated grid lines — demo placeholder */}
            <svg style={{ width: '100%', height: '100%', opacity: 0.12 }}>
                {Array.from({ length: 20 }, (_, i) => (
                    <line key={`h${i}`} x1="0" y1={`${i * 5.5}%`} x2="100%" y2={`${i * 5.5}%`}
                        stroke="#00f5ff" strokeWidth="0.5" />
                ))}
                {Array.from({ length: 30 }, (_, i) => (
                    <line key={`v${i}`} x1={`${i * 3.5}%`} y1="0" x2={`${i * 3.5}%`} y2="100%"
                        stroke="#00f5ff" strokeWidth="0.5" />
                ))}
            </svg>
            {/* City silhouette */}
            <svg viewBox="0 0 1920 300" style={{ position: 'absolute', bottom: 0, width: '100%' }} preserveAspectRatio="xMidYMax meet">
                {[120, 180, 240, 160, 300, 200, 140, 260, 110, 220, 170, 280, 130, 190, 150].map((h, i) => (
                    <rect key={i} x={i * 132} y={300 - h} width={110} height={h} fill="#12151f" />
                ))}
                {/* Neon windows */}
                {Array.from({ length: 80 }, (_, i) => (
                    <rect key={`w${i}`}
                        x={Math.floor(i / 5) * 132 + 15 + (i % 5) * 20}
                        y={300 - 40 - (i % 7) * 22}
                        width={10} height={6}
                        fill={['#00f5ff', '#00ff88', '#b700ff', '#ffb800', '#ff2d78'][i % 5]}
                        opacity={0.5 + Math.random() * 0.5}
                    />
                ))}
            </svg>
            <div style={{
                position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%, -50%)',
                textAlign: 'center', color: 'rgba(255,255,255,0.15)',
                fontFamily: 'Outfit, sans-serif', userSelect: 'none',
            }}>
                <div style={{ fontSize: '11px', letterSpacing: '4px', textTransform: 'uppercase', marginBottom: '8px' }}>
                    Three.js Canvas Mount Point
                </div>
                <div style={{ fontSize: '48px', fontWeight: 900, color: 'rgba(0,245,255,0.2)' }}>LIFE</div>
            </div>
        </div>
    );
}

// ── Debug Panel (dev only) ────────────────────────────────────────────────────

function DevPanel() {
    const { openPhone, openPauseMenu, addToast, setDamageLevel, setPlayerHP } = useUIStore();

    return (
        <div style={{
            position: 'fixed', bottom: '10px', left: '50%', transform: 'translateX(-50%)',
            display: 'flex', gap: '8px', zIndex: 400,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)',
            borderRadius: '16px', padding: '10px 16px',
            border: '1px solid rgba(255,255,255,0.08)',
        }}>
            {[
                { label: '📱 Phone', fn: () => openPhone() },
                { label: '⚙️ Settings', fn: () => openPauseMenu() },
                { label: '🔴 Damage', fn: () => { setDamageLevel(0.7); setPlayerHP(30, 100); } },
                { label: '💚 Heal', fn: () => { setDamageLevel(0); setPlayerHP(100, 100); } },
                { label: '🔔 Toast', fn: () => addToast({ priority: 'critical', title: 'Alerte Critique', message: 'Ennemi à 20m. Couverture immédiate.', duration: 5000 }) },
                { label: '💬 Social', fn: () => addToast({ priority: 'social', title: 'Rex Nakamura', message: 'Check ton Feed — t\'as un message.', duration: 3000 }) },
            ].map(({ label, fn }) => (
                <button key={label} onClick={fn} style={{
                    padding: '6px 12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.12)',
                    background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)',
                    fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap',
                }}>
                    {label}
                </button>
            ))}
        </div>
    );
}

// ── Root App ──────────────────────────────────────────────────────────────────

import { GameEngine } from './core/GameEngine';

// ... (other imports)

// ── Root App ──────────────────────────────────────────────────────────────────

export default function App() {
    const { phoneOpen } = useUIStore();
    const { bindKey, listeningFor } = useSettingsStore();

    // Global keydown for keybind remapping
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (listeningFor) {
                e.preventDefault();
                bindKey(e.code);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [listeningFor, bindKey]);

    // Connect Escape → Pause (when phone is closed)
    useEffect(() => {
        return inputManager.subscribe(({ action, type }) => {
            if (action === 'pause' && type === 'pressed') {
                const { pauseMenuOpen, openPauseMenu, closePauseMenu } = useUIStore.getState();
                pauseMenuOpen ? closePauseMenu() : openPauseMenu();
            }
            if (action === 'openPhone' && type === 'pressed') {
                const { phoneOpen, openPhone, closePhone } = useUIStore.getState();
                phoneOpen ? closePhone() : openPhone();
            }
        });
    }, []);

    return (
        <div id="life-ui-root" style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
            {/* ── Layer 0: 3D World ── */}
            <GameEngine>
                {/* 
                  Real game content will go here. 
                  For now, we can add a basic ground/box to see shadows/SSAO 
                */}
                <ambientLight intensity={0.1} />
                <mesh position={[0, -1, 0]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
                    <planeGeometry args={[100, 100]} />
                    <meshStandardMaterial color="#333" roughness={0.8} />
                </mesh>
                <mesh position={[0, 1, -5]} castShadow>
                    <boxGeometry args={[1, 1, 1]} />
                    <meshStandardMaterial color="hotpink" />
                </mesh>
            </GameEngine>

            {/* ── Layer 1: HUD ── */}
            <DiegeticHUD />

            {/* ── Layer 2: Phone (AnimatePresence for mount/unmount) ── */}
            <AnimatePresence>
                {phoneOpen && <PhoneWrapper key="phone" />}
            </AnimatePresence>

            {/* ── Layer 3: Pause Menu / Settings ── */}
            <SettingsMenu />

            {/* ── Dev Controls ── */}
            <DevPanel />
        </div>
    );
}
