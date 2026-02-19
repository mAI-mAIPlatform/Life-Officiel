/**
 * @fileoverview LIFE RPG — Main Application Entry Point
 */
import { useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';

import './ui/styles/globals.css';
import { useUIStore } from './ui/store/useUIStore';
import { useSettingsStore } from './ui/store/useSettingsStore';
import DiegeticHUD from './ui/hud/DiegeticHUD';
import PhoneWrapper from './ui/phone/PhoneWrapper';
import SettingsMenu from './ui/settings/SettingsMenu';
import { inputManager } from './ui/input/InputManager';
import { GameEngine } from './core/GameEngine';

function DevPanel() {
    const { openPhone, openPauseMenu, addToast, setDamageLevel, setPlayerHP } = useUIStore();

    return (
        <div className="liquid-glass-panel dev-panel">
            {[
                { label: '📱 Phone', fn: () => openPhone() },
                { label: '⚙️ Settings', fn: () => openPauseMenu() },
                { label: '🔴 Damage', fn: () => { setDamageLevel(0.7); setPlayerHP(30, 100); } },
                { label: '💚 Heal', fn: () => { setDamageLevel(0); setPlayerHP(100, 100); } },
                { label: '🔔 Toast', fn: () => addToast({ priority: 'critical', title: 'Alerte Critique', message: 'Ennemi à 20m. Couverture immédiate.', duration: 5000 }) },
                { label: '💬 Social', fn: () => addToast({ priority: 'social', title: 'Rex Nakamura', message: "Check ton Feed — t'as un message.", duration: 3000 }) },
            ].map(({ label, fn }) => (
                <button key={label} onClick={fn} className="liquid-glass-button">
                    {label}
                </button>
            ))}
        </div>
    );
}

export default function App() {
    const { phoneOpen } = useUIStore();
    const { bindKey, listeningFor } = useSettingsStore();

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
        <div id="life-ui-root" className="app-shell">
            <GameEngine>
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

            <DiegeticHUD />

            <AnimatePresence>
                {phoneOpen && <PhoneWrapper key="phone" />}
            </AnimatePresence>

            <SettingsMenu />
            <DevPanel />
        </div>
    );
}
