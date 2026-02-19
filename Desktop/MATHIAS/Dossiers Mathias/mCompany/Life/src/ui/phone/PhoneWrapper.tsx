/**
 * @fileoverview LIFE RPG — PhoneWrapper (Neo-OS Shell)
 *
 * Simulates a full smartphone OS with gesture-based navigation,
 * home screen icons, animated app transitions, and notification badge.
 */
import React, { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import { useUIStore } from '../store/useUIStore';
import { usePhoneStore } from '../store/usePhoneStore';
import BankApp from './apps/Bank';
import ContactsApp from './apps/Contacts';
import MapsApp from './apps/Maps';
import MissionsApp from './apps/Missions';
import CameraApp from './apps/Camera';
import MusicApp from './apps/Music';

// ── App Definitions ───────────────────────────────────────────────────────────

interface AppDef {
    id: string;
    name: string;
    icon: string;
    color: string;
    badge?: () => number;
}

const APPS: AppDef[] = [
    { id: 'bank', name: 'Bank', icon: '💳', color: '#00ff88' },
    { id: 'contacts', name: 'Contacts', icon: '👥', color: '#00f5ff', badge: () => usePhoneStore.getState().contacts.reduce((s, c) => s + c.unread, 0) },
    { id: 'maps', name: 'Maps', icon: '🗺️', color: '#ffb800' },
    { id: 'missions', name: 'Missions', icon: '🎯', color: '#ff2d78', badge: () => usePhoneStore.getState().missions.filter(m => m.status === 'inProgress').length },
    { id: 'camera', name: 'Camera', icon: '📷', color: '#b700ff' },
    { id: 'music', name: 'Music', icon: '🎵', color: '#ff6b35' },
];

const APP_COMPONENTS: Record<string, React.ComponentType> = {
    bank: BankApp,
    contacts: ContactsApp,
    maps: MapsApp,
    missions: MissionsApp,
    camera: CameraApp,
    music: MusicApp,
};

// ── Long-Press Hook ───────────────────────────────────────────────────────────

function useLongPress(callback: () => void, ms = 600) {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const start = useCallback(() => {
        timerRef.current = setTimeout(callback, ms);
    }, [callback, ms]);

    const cancel = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
    }, []);

    return { onPointerDown: start, onPointerUp: cancel, onPointerLeave: cancel };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PhoneWrapper() {
    const { closePhone, activePhoneApp, setActivePhoneApp } = useUIStore();
    const contacts = usePhoneStore((s) => s.contacts);

    const [contextApp, setContextApp] = useState<string | null>(null);

    const totalUnread = contacts.reduce((s, c) => s + c.unread, 0);

    // ── Swipe Gesture Handler ─────────────────────────────────────────────────

    const handleDragEnd = useCallback((_: unknown, info: PanInfo) => {
        const { velocity, offset } = info;
        // Swipe UP → close phone (return to HUD)
        if (offset.y < -80 && velocity.y < -200) {
            closePhone();
            return;
        }
        // Swipe LEFT → back
        if (offset.x < -80 && activePhoneApp) {
            setActivePhoneApp(null);
        }
    }, [closePhone, activePhoneApp, setActivePhoneApp]);

    // ── Context Menu ──────────────────────────────────────────────────────────

    const longPress = useLongPress(() => setContextApp('home'));

    const ActiveApp = activePhoneApp ? APP_COMPONENTS[activePhoneApp] : null;

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="layer-phone fixed inset-0 flex items-end justify-center pointer-events-none">
            <motion.div
                className="pointer-events-auto relative"
                initial={{ y: '100%', scale: 0.9, opacity: 0 }}
                animate={{ y: 0, scale: 1, opacity: 1 }}
                exit={{ y: '100%', scale: 0.9, opacity: 0 }}
                transition={{ type: 'spring', damping: 28, stiffness: 280 }}
                drag="y"
                dragConstraints={{ top: -10, bottom: 0 }}
                dragElastic={{ top: 0.1, bottom: 0.4 }}
                onDragEnd={handleDragEnd}
                style={{
                    width: '390px',
                    height: '844px',
                    marginBottom: '40px',
                    borderRadius: '48px',
                    background: 'linear-gradient(145deg, #0d1117 0%, #1a1f2e 100%)',
                    boxShadow: '0 40px 120px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.08)',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    userSelect: 'none',
                }}
                {...longPress}
            >
                {/* ── Status Bar ── */}
                <PhoneStatusBar />

                {/* ── Dynamic Island ── */}
                <div className="flex justify-center pt-1 pb-2">
                    <div style={{
                        width: activePhoneApp ? '120px' : '120px',
                        height: '32px',
                        background: '#000',
                        borderRadius: '20px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'width 0.3s ease',
                    }}>
                        {/* mini live indicators */}
                        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>
                            {activePhoneApp ? APP_COMPONENTS[activePhoneApp] ? '●' : '' : ''}
                        </span>
                    </div>
                </div>

                {/* ── App Content Area ── */}
                <div className="flex-1 relative overflow-hidden">
                    <AnimatePresence mode="popLayout">
                        {ActiveApp ? (
                            <motion.div
                                key={activePhoneApp}
                                className="absolute inset-0"
                                initial={{ x: '100%', opacity: 0 }}
                                animate={{ x: 0, opacity: 1 }}
                                exit={{ x: '-30%', opacity: 0 }}
                                transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                            >
                                {/* App bar back button */}
                                <div
                                    className="absolute top-2 left-4 z-10 cursor-pointer"
                                    onClick={() => setActivePhoneApp(null)}
                                >
                                    <span style={{ fontSize: '22px', opacity: 0.6 }}>‹</span>
                                </div>
                                <ActiveApp />
                            </motion.div>
                        ) : (
                            <motion.div
                                key="home"
                                className="absolute inset-0 p-6"
                                initial={{ opacity: 0, scale: 1.05 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                transition={{ duration: 0.2 }}
                            >
                                <HomeScreen
                                    apps={APPS}
                                    contacts={contacts}
                                    onOpen={(id) => setActivePhoneApp(id)}
                                    onLongPress={(id) => setContextApp(id)}
                                />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* ── Home Indicator ── */}
                <HomeBarIndicator onHomePress={() => setActivePhoneApp(null)} />

                {/* ── Context Menu ── */}
                <AnimatePresence>
                    {contextApp && (
                        <ContextMenu
                            appId={contextApp}
                            onClose={() => setContextApp(null)}
                        />
                    )}
                </AnimatePresence>
            </motion.div>
        </div>
    );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PhoneStatusBar() {
    const now = new Date();
    const time = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    return (
        <div style={{
            display: 'flex', justifyContent: 'space-between',
            padding: '12px 28px 4px',
            fontSize: '14px', fontWeight: 600,
            color: 'rgba(255,255,255,0.9)',
        }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{time}</span>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12px' }}>
                <span>▲ 5G</span>
                <span>WiFi</span>
                <span>🔋 87%</span>
            </div>
        </div>
    );
}

function HomeScreen({ apps, contacts, onOpen, onLongPress }: {
    apps: AppDef[];
    contacts: { unread: number }[];
    onOpen: (id: string) => void;
    onLongPress: (id: string) => void;
}) {
    const totalUnread = contacts.reduce((s, c) => s + c.unread, 0);

    return (
        <div>
            {/* Date */}
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
                <div style={{ fontSize: '64px', fontWeight: 300, color: 'rgba(255,255,255,0.9)', lineHeight: 1 }}>
                    {new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.5)', marginTop: 6 }}>
                    {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                </div>
            </div>

            {/* App Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                {apps.map((app, i) => (
                    <motion.div
                        key={app.id}
                        initial={{ opacity: 0, scale: 0.5 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: i * 0.04, type: 'spring', damping: 18 }}
                        onClick={() => onOpen(app.id)}
                        onContextMenu={(e) => { e.preventDefault(); onLongPress(app.id); }}
                        whileTap={{ scale: 0.88 }}
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
                    >
                        <div style={{ position: 'relative' }}>
                            <div style={{
                                width: '72px', height: '72px', borderRadius: '18px',
                                background: `linear-gradient(135deg, ${app.color}33, ${app.color}11)`,
                                border: `1px solid ${app.color}44`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '32px',
                                boxShadow: `0 4px 20px ${app.color}33`,
                            }}>
                                {app.icon}
                            </div>
                            {/* Unread badge */}
                            {app.id === 'contacts' && totalUnread > 0 && (
                                <div style={{
                                    position: 'absolute', top: -4, right: -4,
                                    width: '20px', height: '20px', borderRadius: '50%',
                                    background: '#ff1744', display: 'flex',
                                    alignItems: 'center', justifyContent: 'center',
                                    fontSize: '10px', fontWeight: 700, color: '#fff',
                                }}>
                                    {totalUnread}
                                </div>
                            )}
                        </div>
                        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>{app.name}</span>
                    </motion.div>
                ))}
            </div>
        </div>
    );
}

function HomeBarIndicator({ onHomePress }: { onHomePress: () => void }) {
    return (
        <div
            onClick={onHomePress}
            style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 20px', cursor: 'pointer' }}
        >
            <div style={{
                width: '134px', height: '5px', borderRadius: '3px',
                background: 'rgba(255,255,255,0.25)',
            }} />
        </div>
    );
}

function ContextMenu({ appId, onClose }: { appId: string; onClose: () => void }) {
    return (
        <motion.div
            className="absolute inset-0 flex items-end justify-center pb-20"
            style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)' }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
        >
            <motion.div
                className="glass"
                style={{ width: '260px', borderRadius: '20px', padding: '12px', overflow: 'hidden' }}
                initial={{ y: 40, scale: 0.9 }} animate={{ y: 0, scale: 1 }} exit={{ y: 40, scale: 0.9 }}
                onClick={(e) => e.stopPropagation()}
            >
                {['Ouvrir', 'Partager', 'Info application', 'Désinstaller'].map((action) => (
                    <div key={action}
                        onClick={onClose}
                        style={{
                            padding: '12px 16px', cursor: 'pointer', borderRadius: '10px',
                            color: action === 'Désinstaller' ? '#ff4444' : 'rgba(255,255,255,0.85)',
                            fontSize: '14px',
                            transition: 'background 0.15s',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                        {action}
                    </div>
                ))}
            </motion.div>
        </motion.div>
    );
}
