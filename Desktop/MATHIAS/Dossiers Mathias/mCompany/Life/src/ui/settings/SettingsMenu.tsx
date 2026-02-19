/**
 * @fileoverview LIFE RPG — Settings Menu (Full-Screen Modal, PauseMenu layer)
 * Tabs: Gameplay, Affichage, Accessibilité, Contrôles
 */
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSettingsStore, type DaltonismMode, type GraphicsQuality } from '../store/useSettingsStore';
import { useUIStore } from '../store/useUIStore';
import KeybindRemapper from './KeybindRemapper';
import DaltonismFilter from './DaltonismFilter';

type Tab = 'gameplay' | 'display' | 'accessibility' | 'controls';

const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: 'gameplay', label: 'Gameplay', icon: '🎮' },
    { id: 'display', label: 'Affichage', icon: '🖥️' },
    { id: 'accessibility', label: 'Accessibilité', icon: '♿' },
    { id: 'controls', label: 'Contrôles', icon: '⌨️' },
];

// ── Slider Row ────────────────────────────────────────────────────────────────

function SliderRow({ label, value, min = 0, max = 1, step = 0.01, onChange, color = '#00f5ff' }: {
    label: string; value: number; min?: number; max?: number; step?: number;
    onChange: (v: number) => void; color?: string;
}) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                <span style={{ color: 'rgba(255,255,255,0.7)' }}>{label}</span>
                <span style={{ color, fontFamily: 'JetBrains Mono, monospace', fontSize: '12px' }}>
                    {(value * (max <= 1 ? 100 : 1)).toFixed(max <= 1 ? 0 : 1)}{max <= 1 ? '%' : ''}
                </span>
            </div>
            <input type="range" min={min} max={max} step={step} value={value}
                onChange={(e) => onChange(parseFloat(e.target.value))}
                aria-label={label}
                style={{ width: '100%', accentColor: color, cursor: 'pointer', height: '4px' }}
            />
        </div>
    );
}

// ── Toggle Row ────────────────────────────────────────────────────────────────

function ToggleRow({ label, desc, value, onChange }: {
    label: string; desc?: string; value: boolean; onChange: (v: boolean) => void;
}) {
    return (
        <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)',
        }}>
            <div>
                <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.8)' }}>{label}</div>
                {desc && <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.36)', marginTop: '2px' }}>{desc}</div>}
            </div>
            <button onClick={() => onChange(!value)} aria-label={label} style={{
                width: '44px', height: '24px', borderRadius: '12px', border: 'none', cursor: 'pointer',
                background: value ? '#00f5ff' : 'rgba(255,255,255,0.12)',
                transition: 'background 0.2s', position: 'relative', flexShrink: 0,
            }}>
                <motion.div animate={{ x: value ? 22 : 2 }} transition={{ type: 'spring', damping: 20, stiffness: 400 }}
                    style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#fff', position: 'absolute', top: '2px' }}
                />
            </button>
        </div>
    );
}

// ── Select Row ────────────────────────────────────────────────────────────────

function SelectRow<T extends string>({ label, value, options, onChange }: {
    label: string; value: T; options: { value: T; label: string }[];
    onChange: (v: T) => void;
}) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.8)' }}>{label}</span>
            <select value={value} onChange={(e) => onChange(e.target.value as T)} aria-label={label} style={{
                background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
                color: '#fff', padding: '6px 10px', borderRadius: '8px', fontSize: '13px', cursor: 'pointer',
            }}>
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
        </div>
    );
}

// ── Daltonism Picker ──────────────────────────────────────────────────────────

function DaltonismPicker() {
    const { daltonism, setDaltonism } = useSettingsStore();
    const modes: { id: DaltonismMode; label: string; colors: string[] }[] = [
        { id: 'none', label: 'Normal', colors: ['#ff0000', '#00ff00', '#0000ff'] },
        { id: 'protanopia', label: 'Protanopie', colors: ['#c0c000', '#c0c000', '#0000ff'] },
        { id: 'deuteranopia', label: 'Deutéranopie', colors: ['#c0c000', '#c0c000', '#0000c0'] },
        { id: 'tritanopia', label: 'Tritanopie', colors: ['#ff00a0', '#00a0a0', '#0000ff'] },
    ];

    return (
        <div>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '10px' }}>
                Mode Daltonien
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                {modes.map((m) => (
                    <button key={m.id} onClick={() => setDaltonism(m.id)} style={{
                        padding: '10px 12px', borderRadius: '12px', cursor: 'pointer',
                        background: daltonism === m.id ? 'rgba(0,245,255,0.12)' : 'rgba(255,255,255,0.05)',
                        border: `1px solid ${daltonism === m.id ? 'rgba(0,245,255,0.4)' : 'rgba(255,255,255,0.08)'}`,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
                    }}>
                        <div style={{ display: 'flex', gap: '4px' }}>
                            {m.colors.map((c, i) => <div key={i} style={{ width: '16px', height: '16px', borderRadius: '3px', background: c }} />)}
                        </div>
                        <span style={{ fontSize: '12px', color: daltonism === m.id ? '#00f5ff' : 'rgba(255,255,255,0.5)', fontWeight: daltonism === m.id ? 700 : 400 }}>
                            {m.label}
                        </span>
                    </button>
                ))}
            </div>
        </div>
    );
}

// ── Root Settings Menu ────────────────────────────────────────────────────────

export default function SettingsMenu() {
    const { pauseMenuOpen, closePauseMenu } = useUIStore();
    const settings = useSettingsStore();
    const [tab, setTab] = useState<Tab>('gameplay');

    // Close on Escape
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.code === 'Escape') closePauseMenu(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [closePauseMenu]);

    return (
        <>
            <DaltonismFilter />
            <AnimatePresence>
                {pauseMenuOpen && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                        {/* Backdrop */}
                        <div
                            onClick={closePauseMenu}
                            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(12px)' }}
                        />

                        {/* Panel */}
                        <motion.div
                            initial={{ scale: 0.92, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.92, opacity: 0, y: 20 }}
                            transition={{ type: 'spring', damping: 26, stiffness: 280 }}
                            style={{
                                position: 'relative', zIndex: 1,
                                width: '640px', maxHeight: '80vh',
                                background: 'rgba(18,21,31,0.97)',
                                border: '1px solid rgba(255,255,255,0.08)',
                                borderRadius: '24px',
                                display: 'flex', flexDirection: 'column',
                                boxShadow: '0 40px 120px rgba(0,0,0,0.8)',
                                overflow: 'hidden',
                            }}
                        >
                            {/* Header */}
                            <div style={{ padding: '24px 28px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ fontSize: '22px', fontWeight: 800, color: '#fff', fontFamily: 'Outfit, sans-serif' }}>
                                    ⚙️ Paramètres
                                </div>
                                <button onClick={closePauseMenu} style={{
                                    width: '32px', height: '32px', borderRadius: '50%', border: 'none',
                                    background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)',
                                    fontSize: '18px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>×</button>
                            </div>

                            {/* Tab bar */}
                            <div style={{ display: 'flex', gap: '0', padding: '16px 28px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                {TABS.map((t) => (
                                    <button key={t.id} onClick={() => setTab(t.id)} style={{
                                        flex: 1, padding: '10px 8px', border: 'none', cursor: 'pointer',
                                        background: 'transparent',
                                        color: tab === t.id ? '#00f5ff' : 'rgba(255,255,255,0.4)',
                                        fontWeight: tab === t.id ? 700 : 400,
                                        fontSize: '13px',
                                        borderBottom: tab === t.id ? '2px solid #00f5ff' : '2px solid transparent',
                                        transition: 'all 0.2s',
                                    }}>
                                        {t.icon} {t.label}
                                    </button>
                                ))}
                            </div>

                            {/* Tab Content */}
                            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                <AnimatePresence mode="wait">
                                    <motion.div
                                        key={tab}
                                        initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}
                                        transition={{ duration: 0.15 }}
                                        style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
                                    >
                                        {tab === 'gameplay' && (
                                            <>
                                                <SliderRow label="Sensibilité Souris" value={settings.mouseSensitivity} min={0.1} max={5} step={0.1} onChange={settings.setMouseSensitivity} />
                                                <SliderRow label="Sensibilité Manette" value={settings.gamepadSensitivity} min={0.1} max={5} step={0.1} onChange={settings.setGamepadSensitivity} />
                                                <SliderRow label="Champ de vision (FOV)" value={settings.fovDegrees} min={60} max={110} step={1} onChange={settings.setFOV} color="#ffb800" />
                                                <ToggleRow label="Inverser l'axe Y" value={settings.invertY} onChange={settings.setInvertY} />
                                                <ToggleRow label="Afficher FPS" value={settings.showFPS} onChange={settings.setShowFPS} />
                                            </>
                                        )}
                                        {tab === 'display' && (
                                            <>
                                                <SelectRow label="Qualité Graphique" value={settings.graphicsQuality} onChange={settings.setGraphicsQuality}
                                                    options={[
                                                        { value: 'low', label: '🔵 Faible' },
                                                        { value: 'medium', label: '🟡 Moyen' },
                                                        { value: 'high', label: '🟠 Élevé' },
                                                        { value: 'ultra', label: '🔴 Ultra' },
                                                    ]}
                                                />
                                                <SliderRow label="Interface Scale" value={settings.uiScale} min={0.8} max={1.4} step={0.05} onChange={settings.setUIScale} color="#b700ff" />
                                            </>
                                        )}
                                        {tab === 'accessibility' && (
                                            <>
                                                <DaltonismPicker />
                                                <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)' }} />
                                                <ToggleRow
                                                    label="Réduire les animations"
                                                    desc="Désactive flou, shake et effets de transparence."
                                                    value={settings.reduceMotion}
                                                    onChange={settings.setReduceMotion}
                                                />
                                                <ToggleRow
                                                    label="Contraste élevé"
                                                    desc="Augmente la lisibilité du texte et des interfaces."
                                                    value={settings.highContrast}
                                                    onChange={settings.setHighContrast}
                                                />
                                                <div style={{ marginTop: '4px' }}>
                                                    <SliderRow label="Volume Master" value={settings.masterVolume} onChange={settings.setMasterVolume} color="#00ff88" />
                                                    <SliderRow label="Musique" value={settings.musicVolume} onChange={settings.setMusicVolume} color="#ffb800" />
                                                    <SliderRow label="Effets (SFX)" value={settings.sfxVolume} onChange={settings.setSFXVolume} color="#ff2d78" />
                                                    <SliderRow label="Voix" value={settings.voiceVolume} onChange={settings.setVoiceVolume} color="#b700ff" />
                                                </div>
                                            </>
                                        )}
                                        {tab === 'controls' && (
                                            <KeybindRemapper />
                                        )}
                                    </motion.div>
                                </AnimatePresence>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
