/**
 * @fileoverview LIFE RPG — Input Manager
 *
 * Singleton that listens for keyboard/mouse and polls Gamepad API.
 * Dispatches named action events via EventEmitter pattern.
 * Supports spatial navigation in menus via D-pad / arrow keys.
 */
import { useSettingsStore, type ActionId } from '../store/useSettingsStore';

// ── Event Types ───────────────────────────────────────────────────────────────

export type InputEvent = {
    action: ActionId;
    type: 'pressed' | 'released';
};

type InputListener = (event: InputEvent) => void;

// ── Gamepad Axis Deadzone ─────────────────────────────────────────────────────

const DEADZONE = 0.15;

class InputManager {
    private listeners = new Set<InputListener>();
    private pressed = new Set<ActionId>();
    private gamepadIndex: number | null = null;
    private rafId: number | null = null;

    constructor() {
        window.addEventListener('keydown', this.onKeyDown, { passive: true });
        window.addEventListener('keyup', this.onKeyUp, { passive: true });
        window.addEventListener('mousedown', this.onMouseDown, { passive: true });
        window.addEventListener('mouseup', this.onMouseUp, { passive: true });
        window.addEventListener('gamepadconnected', this.onGamepadConnect);
        window.addEventListener('gamepaddisconnected', this.onGamepadDisconnect);
        this.startGamepadPoll();
    }

    // ── Subscription ──────────────────────────────────────────────────────────

    subscribe(listener: InputListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    isPressed(action: ActionId): boolean {
        return this.pressed.has(action);
    }

    // ── Event Dispatch ────────────────────────────────────────────────────────

    private dispatch(action: ActionId, type: 'pressed' | 'released') {
        // Check if remapping mode is active — swallow input
        const { listeningFor, bindKey } = useSettingsStore.getState();
        if (listeningFor && type === 'pressed') {
            // Ignore Escape during remapping
            return;
        }

        if (type === 'pressed') {
            this.pressed.add(action);
        } else {
            this.pressed.delete(action);
        }
        const event: InputEvent = { action, type };
        this.listeners.forEach((l) => l(event));
    }

    // ── Code → Action Resolution ──────────────────────────────────────────────

    private resolveAction(code: string): ActionId | null {
        // During keybind listen, delegate to settings store
        const { listeningFor, bindKey } = useSettingsStore.getState();
        if (listeningFor) {
            bindKey(code);
            return null;
        }

        const keybinds = useSettingsStore.getState().keybinds;
        const entry = Object.entries(keybinds).find(([, v]) => v === code);
        return entry ? (entry[0] as ActionId) : null;
    }

    // ── Keyboard ──────────────────────────────────────────────────────────────

    private onKeyDown = (e: KeyboardEvent) => {
        const action = this.resolveAction(e.code);
        if (action) this.dispatch(action, 'pressed');
    };

    private onKeyUp = (e: KeyboardEvent) => {
        const action = this.resolveAction(e.code);
        if (action) this.dispatch(action, 'released');
    };

    // ── Mouse ─────────────────────────────────────────────────────────────────

    private onMouseDown = (e: MouseEvent) => {
        const code = `Mouse${e.button}`;
        const action = this.resolveAction(code);
        if (action) this.dispatch(action, 'pressed');
    };

    private onMouseUp = (e: MouseEvent) => {
        const code = `Mouse${e.button}`;
        const action = this.resolveAction(code);
        if (action) this.dispatch(action, 'released');
    };

    // ── Gamepad ───────────────────────────────────────────────────────────────

    private onGamepadConnect = (e: GamepadEvent) => {
        this.gamepadIndex = e.gamepad.index;
    };

    private onGamepadDisconnect = () => {
        this.gamepadIndex = null;
    };

    // Button index → action mapping (Xbox layout)
    private readonly GP_BUTTON_MAP: Partial<Record<number, ActionId>> = {
        0: 'jump',       // A
        1: 'interact',   // B
        2: 'reload',     // X
        3: 'attack',     // Y
        4: 'openPhone',  // LB
        5: 'openMap',    // RB
        8: 'pause',      // Select/Back
        9: 'pause',      // Start
        12: 'moveForward', // D-Up
        13: 'moveBack',    // D-Down
        14: 'moveLeft',    // D-Left
        15: 'moveRight',   // D-Right
    };

    private prevGPButtons = new Map<number, boolean>();

    private startGamepadPoll() {
        const poll = () => {
            if (this.gamepadIndex !== null) {
                const gp = navigator.getGamepads()?.[this.gamepadIndex];
                if (gp) {
                    gp.buttons.forEach((btn, idx) => {
                        const isDown = btn.pressed;
                        const wasDown = this.prevGPButtons.get(idx) ?? false;
                        const action = this.GP_BUTTON_MAP[idx];
                        if (action) {
                            if (isDown && !wasDown) this.dispatch(action, 'pressed');
                            if (!isDown && wasDown) this.dispatch(action, 'released');
                        }
                        this.prevGPButtons.set(idx, isDown);
                    });
                }
            }
            this.rafId = requestAnimationFrame(poll);
        };
        this.rafId = requestAnimationFrame(poll);
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────

    destroy() {
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);
        window.removeEventListener('mousedown', this.onMouseDown);
        window.removeEventListener('mouseup', this.onMouseUp);
        window.removeEventListener('gamepadconnected', this.onGamepadConnect);
        window.removeEventListener('gamepaddisconnected', this.onGamepadDisconnect);
        if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    }
}

// Singleton export
export const inputManager = new InputManager();
