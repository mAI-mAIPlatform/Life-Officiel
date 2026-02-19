/**
 * @fileoverview LIFE RPG — Keyboard / Gamepad Remap UI
 */
import React from 'react';
import { motion } from 'framer-motion';
import { useSettingsStore, type ActionId } from '../store/useSettingsStore';

const ACTION_LABELS: Record<ActionId, string> = {
    moveForward: 'Avancer',
    moveBack: 'Reculer',
    moveLeft: 'Gauche',
    moveRight: 'Droite',
    sprint: 'Sprint',
    jump: 'Saut',
    crouch: 'Accroupi',
    interact: 'Interagir',
    openPhone: 'Ouvrir téléphone',
    openMap: 'Ouvrir carte',
    openMissions: 'Ouvrir missions',
    attack: 'Attaquer',
    aim: 'Viser',
    reload: 'Recharger',
    pause: 'Pause',
    sprint_toggle: 'Sprint (toggle)',
};

function keyLabel(code: string): string {
    const map: Record<string, string> = {
        Space: '␣', ShiftLeft: '⇧L', ShiftRight: '⇧R', ControlLeft: 'Ctrl L',
        AltLeft: 'Alt L', Escape: 'Esc', Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB',
        CapsLock: '⇪',
    };
    return map[code] ?? code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '↑↓←→'.includes(code.slice(-1)) ? code.slice(-1) : '');
}

export default function KeybindRemapper() {
    const { keybinds, listeningFor, startListening, resetKeybinds } = useSettingsStore();

    const actions = Object.keys(ACTION_LABELS) as ActionId[];

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h3 style={{ margin: 0, fontSize: '14px', color: 'rgba(255,255,255,0.7)', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase' }}>
                    Contrôles Clavier
                </h3>
                <button onClick={resetKeybinds} style={{
                    padding: '6px 12px', borderRadius: '10px', border: '1px solid rgba(255,100,100,0.3)',
                    background: 'rgba(255,50,50,0.08)', color: '#ff6b6b', fontSize: '12px', cursor: 'pointer',
                }}>
                    Réinitialiser
                </button>
            </div>

            {listeningFor && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                    style={{
                        padding: '12px 16px', borderRadius: '12px', marginBottom: '12px',
                        background: 'rgba(0,245,255,0.1)', border: '1px solid rgba(0,245,255,0.3)',
                        textAlign: 'center', fontSize: '13px', color: '#00f5ff',
                    }}
                >
                    🎹 Appuyez sur une touche pour <strong>{ACTION_LABELS[listeningFor]}</strong>…
                    <span style={{ color: 'rgba(255,255,255,0.4)', marginLeft: '8px', fontSize: '12px' }}>
                        (Échap pour annuler)
                    </span>
                </motion.div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {actions.map((action) => {
                    const isListening = listeningFor === action;
                    return (
                        <div key={action} style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            padding: '10px 12px', borderRadius: '10px',
                            background: isListening ? 'rgba(0,245,255,0.08)' : 'rgba(255,255,255,0.03)',
                            border: `1px solid ${isListening ? 'rgba(0,245,255,0.3)' : 'transparent'}`,
                            transition: 'all 0.15s',
                        }}>
                            <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)' }}>
                                {ACTION_LABELS[action]}
                            </span>
                            <button
                                onClick={() => startListening(action)}
                                style={{
                                    padding: '4px 12px', borderRadius: '8px', cursor: 'pointer',
                                    background: isListening ? 'rgba(0,245,255,0.2)' : 'rgba(255,255,255,0.08)',
                                    color: isListening ? '#00f5ff' : 'rgba(255,255,255,0.6)',
                                    fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', fontWeight: 700,
                                    minWidth: '60px', textAlign: 'center',
                                    border: `1px solid ${isListening ? 'rgba(0,245,255,0.4)' : 'rgba(255,255,255,0.1)'}`,
                                }}
                            >
                                {isListening ? '…' : keyLabel(keybinds[action])}
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
