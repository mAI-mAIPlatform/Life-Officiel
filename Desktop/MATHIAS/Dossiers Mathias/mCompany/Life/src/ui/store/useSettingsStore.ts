/**
 * @fileoverview LIFE RPG — Settings Store (Zustand)
 *
 * Manages accessibility options, daltonism filters, UI scale,
 * reduce-motion, and keyboard/gamepad remapping.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ── Daltonism Modes ───────────────────────────────────────────────────────────

export type DaltonismMode = 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia';

/** SVG filter matrix coefficients for each daltonism mode */
export const DALTONISM_MATRICES: Record<DaltonismMode, string> = {
    none: 'none',
    protanopia: '0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0',
    deuteranopia: '0.625 0.375 0 0 0  0.700 0.300 0 0 0  0 0.300 0.700 0 0  0 0 0 1 0',
    tritanopia: '0.950 0.050 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0',
};

// ── Keybind Map ───────────────────────────────────────────────────────────────

export type ActionId =
    | 'moveForward' | 'moveBack' | 'moveLeft' | 'moveRight'
    | 'sprint' | 'jump' | 'crouch' | 'interact'
    | 'openPhone' | 'openMap' | 'openMissions'
    | 'attack' | 'aim' | 'reload'
    | 'pause' | 'sprint_toggle';

export type KeybindMap = Record<ActionId, string>;

const DEFAULT_KEYBINDS: KeybindMap = {
    moveForward: 'KeyW',
    moveBack: 'KeyS',
    moveLeft: 'KeyA',
    moveRight: 'KeyD',
    sprint: 'ShiftLeft',
    jump: 'Space',
    crouch: 'KeyC',
    interact: 'KeyE',
    openPhone: 'KeyP',
    openMap: 'KeyM',
    openMissions: 'KeyJ',
    attack: 'Mouse0',
    aim: 'Mouse2',
    reload: 'KeyR',
    pause: 'Escape',
    sprint_toggle: 'CapsLock',
};

// ── Graphics Settings ─────────────────────────────────────────────────────────

export type GraphicsQuality = 'low' | 'medium' | 'high' | 'ultra';

// ── State Interface ───────────────────────────────────────────────────────────

export interface SettingsState {
    // Accessibility
    daltonism: DaltonismMode;
    uiScale: number;       // 0.8 – 1.4
    reduceMotion: boolean;
    highContrast: boolean;

    // Audio
    masterVolume: number;  // 0-1
    musicVolume: number;
    sfxVolume: number;
    voiceVolume: number;

    // Graphics
    graphicsQuality: GraphicsQuality;
    showFPS: boolean;
    fovDegrees: number; // 60-110

    // Controls
    mouseSensitivity: number; // 0.1 – 5.0
    gamepadSensitivity: number;
    invertY: boolean;
    keybinds: KeybindMap;
    listeningFor: ActionId | null; // currently remapping this action

    // Actions
    setDaltonism: (mode: DaltonismMode) => void;
    setUIScale: (scale: number) => void;
    setReduceMotion: (v: boolean) => void;
    setHighContrast: (v: boolean) => void;
    setMasterVolume: (v: number) => void;
    setMusicVolume: (v: number) => void;
    setSFXVolume: (v: number) => void;
    setVoiceVolume: (v: number) => void;
    setGraphicsQuality: (q: GraphicsQuality) => void;
    setShowFPS: (v: boolean) => void;
    setFOV: (deg: number) => void;
    setMouseSensitivity: (v: number) => void;
    setGamepadSensitivity: (v: number) => void;
    setInvertY: (v: boolean) => void;
    startListening: (action: ActionId) => void;
    bindKey: (code: string) => void;
    resetKeybinds: () => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set, get) => ({
            daltonism: 'none',
            uiScale: 1.0,
            reduceMotion: false,
            highContrast: false,

            masterVolume: 0.8,
            musicVolume: 0.6,
            sfxVolume: 0.8,
            voiceVolume: 1.0,

            graphicsQuality: 'high',
            showFPS: false,
            fovDegrees: 75,

            mouseSensitivity: 1.0,
            gamepadSensitivity: 1.0,
            invertY: false,
            keybinds: { ...DEFAULT_KEYBINDS },
            listeningFor: null,

            setDaltonism: (mode) => set({ daltonism: mode }),
            setUIScale: (scale) => set({ uiScale: Math.max(0.8, Math.min(1.4, scale)) }),
            setReduceMotion: (v) => set({ reduceMotion: v }),
            setHighContrast: (v) => set({ highContrast: v }),
            setMasterVolume: (v) => set({ masterVolume: Math.max(0, Math.min(1, v)) }),
            setMusicVolume: (v) => set({ musicVolume: Math.max(0, Math.min(1, v)) }),
            setSFXVolume: (v) => set({ sfxVolume: Math.max(0, Math.min(1, v)) }),
            setVoiceVolume: (v) => set({ voiceVolume: Math.max(0, Math.min(1, v)) }),
            setGraphicsQuality: (q) => set({ graphicsQuality: q }),
            setShowFPS: (v) => set({ showFPS: v }),
            setFOV: (deg) => set({ fovDegrees: Math.max(60, Math.min(110, deg)) }),
            setMouseSensitivity: (v) => set({ mouseSensitivity: Math.max(0.1, Math.min(5, v)) }),
            setGamepadSensitivity: (v) => set({ gamepadSensitivity: Math.max(0.1, Math.min(5, v)) }),
            setInvertY: (v) => set({ invertY: v }),

            startListening: (action) => set({ listeningFor: action }),

            bindKey: (code) => {
                const { listeningFor, keybinds } = get();
                if (!listeningFor) return;
                set({
                    keybinds: { ...keybinds, [listeningFor]: code },
                    listeningFor: null,
                });
            },

            resetKeybinds: () => set({ keybinds: { ...DEFAULT_KEYBINDS }, listeningFor: null }),
        }),
        { name: 'life-settings' }
    )
);
