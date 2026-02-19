/**
 * @fileoverview LIFE RPG — Diegetic HUD Root
 * Mounts all HUD widgets in the correct Z-layer order.
 * Conditionally renders based on game state to avoid
 * unnecessary DOM presence.
 */
import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useUIStore } from '../store/useUIStore';
import DamageVignette from './DamageVignette';
import CrosshairWidget from './CrosshairWidget';
import ToastSystem from './ToastSystem';
import MiniMap from './MiniMap';

function PlayerHPBar() {
    const { playerHP, playerMaxHP } = useUIStore();
    const pct = Math.max(0, playerHP / playerMaxHP);
    const hpColor = pct > 0.6 ? '#00ff88' : pct > 0.3 ? '#ffb800' : '#ff1744';

    return (
        <div style={{
            position: 'fixed', bottom: '28px', left: '24px',
            display: 'flex', flexDirection: 'column', gap: '4px',
            zIndex: 101, minWidth: '160px',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>
                <span style={{ letterSpacing: '2px', textTransform: 'uppercase' }}>HP</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', color: hpColor }}>
                    {playerHP}/{playerMaxHP}
                </span>
            </div>
            <div style={{
                height: '4px', background: 'rgba(255,255,255,0.1)',
                borderRadius: '2px', overflow: 'hidden',
            }}>
                <motion.div
                    animate={{ width: `${pct * 100}%`, backgroundColor: hpColor }}
                    transition={{ duration: 0.3 }}
                    style={{ height: '100%', borderRadius: '2px', boxShadow: `0 0 6px ${hpColor}` }}
                />
            </div>
        </div>
    );
}

function CompassBar() {
    return (
        <div style={{
            position: 'fixed', top: '12px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 101,
            background: 'rgba(0,0,0,0.5)',
            backdropFilter: 'blur(10px)',
            borderRadius: '20px',
            padding: '4px 20px',
            border: '1px solid rgba(255,255,255,0.08)',
            fontSize: '11px', letterSpacing: '12px',
            color: 'rgba(255,255,255,0.45)',
            fontFamily: 'JetBrains Mono, monospace',
        }}>
            <span style={{ color: '#00f5ff' }}>N</span> . . E . . S . . O . . <span style={{ color: '#00f5ff' }}>N</span>
        </div>
    );
}

// ── Root HUD Component ────────────────────────────────────────────────────────

export default function DiegeticHUD() {
    const { hudVisible, damageLevel } = useUIStore();

    return (
        <>
            {/* Always-on: damage shader (even when HUD hidden) */}
            <DamageVignette />

            <AnimatePresence>
                {hudVisible && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        style={{ pointerEvents: 'none' }}
                    >
                        {/* Compass */}
                        <CompassBar />

                        {/* Crosshair (pointer-events: none already) */}
                        <CrosshairWidget />

                        {/* HP Bar */}
                        <PlayerHPBar />

                        {/* Minimap */}
                        <MiniMap />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Toast system: always present for critical alerts */}
            <ToastSystem />
        </>
    );
}
