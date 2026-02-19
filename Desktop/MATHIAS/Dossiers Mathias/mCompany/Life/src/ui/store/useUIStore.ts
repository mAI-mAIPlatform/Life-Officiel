/**
 * @fileoverview LIFE RPG — Main UI Store (Zustand)
 *
 * Manages HUD state, Z-layer system, toast notifications, crosshair config,
 * and phone app routing. Uses transient subscriptions (getState()) to prevent
 * unnecessary re-renders of the 3D Canvas.
 */
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

// ── Toast Model ───────────────────────────────────────────────────────────────

export type ToastPriority = 'critical' | 'info' | 'social';

export interface Toast {
    id: string;
    priority: ToastPriority;
    title: string;
    message: string;
    icon?: string;
    duration: number; // ms, 0 = persistent
    createdAt: number;
}

// ── Crosshair Config ──────────────────────────────────────────────────────────

export type CrosshairShape = 'default' | 'sniper' | 'shotgun' | 'melee' | 'none';

export interface CrosshairConfig {
    shape: CrosshairShape;
    spread: number;    // 0-1 current spread (driven by movement speed)
    color: string;
    opacity: number;
}

// ── Z-Layer System ────────────────────────────────────────────────────────────

export type UILayer = 'WorldUI' | 'HUD' | 'Phone' | 'PauseMenu';

// ── State Interface ───────────────────────────────────────────────────────────

export interface UIState {
    // Active layer
    activeLayer: UILayer;

    // HUD visibility
    hudVisible: boolean;

    // Phone
    phoneOpen: boolean;
    activePhoneApp: string | null;

    // Pause/Settings
    pauseMenuOpen: boolean;

    // Notifications
    toasts: Toast[];

    // Crosshair
    crosshair: CrosshairConfig;

    // Damage FX (0 = healthy, 1 = critical)
    damageLevel: number;

    // Player HP for HUD display
    playerHP: number;
    playerMaxHP: number;

    // Minimap
    minimapVisible: boolean;

    // Actions
    setActiveLayer: (layer: UILayer) => void;
    setHUDVisible: (v: boolean) => void;
    openPhone: (app?: string) => void;
    closePhone: () => void;
    setActivePhoneApp: (app: string | null) => void;
    openPauseMenu: () => void;
    closePauseMenu: () => void;
    addToast: (toast: Omit<Toast, 'id' | 'createdAt'>) => void;
    removeToast: (id: string) => void;
    setCrosshair: (config: Partial<CrosshairConfig>) => void;
    setCrosshairSpread: (spread: number) => void;
    setDamageLevel: (level: number) => void;
    setPlayerHP: (hp: number, max?: number) => void;
    setMinimapVisible: (v: boolean) => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

let toastCounter = 0;

export const useUIStore = create<UIState>()(
    subscribeWithSelector((set) => ({
        activeLayer: 'HUD',
        hudVisible: true,
        phoneOpen: false,
        activePhoneApp: null,
        pauseMenuOpen: false,
        toasts: [],
        crosshair: {
            shape: 'default',
            spread: 0,
            color: '#00f5ff',
            opacity: 0.9,
        },
        damageLevel: 0,
        playerHP: 100,
        playerMaxHP: 100,
        minimapVisible: true,

        setActiveLayer: (layer) => set({ activeLayer: layer }),

        setHUDVisible: (v) => set({ hudVisible: v }),

        openPhone: (app) => set({
            phoneOpen: true,
            activePhoneApp: app ?? null,
            activeLayer: 'Phone',
        }),

        closePhone: () => set({
            phoneOpen: false,
            activePhoneApp: null,
            activeLayer: 'HUD',
        }),

        setActivePhoneApp: (app) => set({ activePhoneApp: app }),

        openPauseMenu: () => set({ pauseMenuOpen: true, activeLayer: 'PauseMenu' }),

        closePauseMenu: () => set({ pauseMenuOpen: false, activeLayer: 'HUD' }),

        addToast: (toast) => set((state) => {
            const id = `toast-${++toastCounter}`;
            const newToast: Toast = { ...toast, id, createdAt: Date.now() };
            // Sort by priority: critical first
            const priorityOrder: Record<ToastPriority, number> = { critical: 0, info: 1, social: 2 };
            const sorted = [...state.toasts, newToast].sort(
                (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
            );
            return { toasts: sorted.slice(0, 5) }; // max 5 stacked
        }),

        removeToast: (id) => set((state) => ({
            toasts: state.toasts.filter((t) => t.id !== id),
        })),

        setCrosshair: (config) => set((state) => ({
            crosshair: { ...state.crosshair, ...config },
        })),

        // Transient update: bypass re-render by only updating spread
        setCrosshairSpread: (spread) => set((state) => ({
            crosshair: { ...state.crosshair, spread: Math.max(0, Math.min(1, spread)) },
        })),

        setDamageLevel: (level) => set({ damageLevel: Math.max(0, Math.min(1, level)) }),

        setPlayerHP: (hp, max) => set((state) => ({
            playerHP: Math.max(0, hp),
            playerMaxHP: max ?? state.playerMaxHP,
            damageLevel: max
                ? 1 - (Math.max(0, hp) / max)
                : 1 - (Math.max(0, hp) / state.playerMaxHP),
        })),

        setMinimapVisible: (v) => set({ minimapVisible: v }),
    }))
);
