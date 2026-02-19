/**
 * @module features/ui
 * UI feature barrel — stores, phone, HUD, settings.
 *
 * Import via:
 *   import { useUIStore, PhoneWrapper, DiegeticHUD } from '@features/ui'
 *
 * All React components in this layer use `export default`.
 * We re-export them as named exports for ergonomic imports.
 */

// ── Zustand stores (named exports) ──────────────────────────────────────────
export { useUIStore } from '../../ui/store/useUIStore';
export { useSettingsStore } from '../../ui/store/useSettingsStore';
export { usePhoneStore } from '../../ui/store/usePhoneStore';

// ── Phone (default → named) ──────────────────────────────────────────────────
export { default as PhoneWrapper } from '../../ui/phone/PhoneWrapper';

// ── HUD (default → named) ──────────────────────────────────────────────────
export { default as DiegeticHUD } from '../../ui/hud/DiegeticHUD';
export { default as DamageVignette } from '../../ui/hud/DamageVignette';
export { default as CrosshairWidget } from '../../ui/hud/CrosshairWidget';
export { default as MiniMap } from '../../ui/hud/MiniMap';
export { default as ToastSystem } from '../../ui/hud/ToastSystem';

// ── Settings (default → named) ───────────────────────────────────────────────
export { default as SettingsMenu } from '../../ui/settings/SettingsMenu';
