/**
 * @fileoverview LIFE RPG — Toast Notification System
 * Stackable, priority-sorted toast notifications with auto-dismiss.
 * Priority: critical (red) > info (cyan) > social (violet)
 */
import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUIStore, type Toast, type ToastPriority } from '../store/useUIStore';

const PRIORITY_CONFIG: Record<ToastPriority, { color: string; bg: string; icon: string; duration: number }> = {
    critical: { color: '#ff1744', bg: 'rgba(255,23,68,0.12)', icon: '⚠️', duration: 6000 },
    info: { color: '#00f5ff', bg: 'rgba(0,245,255,0.08)', icon: '💬', duration: 4000 },
    social: { color: '#b700ff', bg: 'rgba(183,0,255,0.08)', icon: '👤', duration: 3000 },
};

function ToastItem({ toast }: { toast: Toast }) {
    const cfg = PRIORITY_CONFIG[toast.priority];
    const removeToast = useUIStore((s) => s.removeToast);

    useEffect(() => {
        if (toast.duration === 0) return;
        const id = setTimeout(() => removeToast(toast.id), toast.duration);
        return () => clearTimeout(id);
    }, [toast.id, toast.duration, removeToast]);

    return (
        <motion.div
            layout
            key={toast.id}
            initial={{ x: '110%', opacity: 0, scale: 0.9 }}
            animate={{ x: 0, opacity: 1, scale: 1 }}
            exit={{ x: '110%', opacity: 0, scale: 0.9 }}
            transition={{ type: 'spring', damping: 24, stiffness: 280 }}
            onClick={() => removeToast(toast.id)}
            style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '12px 14px',
                borderRadius: '14px',
                background: cfg.bg,
                border: `1px solid ${cfg.color}44`,
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                boxShadow: `0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px ${cfg.color}22`,
                cursor: 'pointer',
                maxWidth: '320px',
                width: '100%',
            }}
        >
            {/* Left accent bar */}
            <div style={{
                width: '3px', borderRadius: '2px', alignSelf: 'stretch',
                background: cfg.color, boxShadow: `0 0 8px ${cfg.color}`,
                flexShrink: 0,
            }} />

            {/* Icon */}
            <span style={{ fontSize: '18px', flexShrink: 0, lineHeight: 1.2 }}>
                {toast.icon ?? cfg.icon}
            </span>

            {/* Text */}
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#fff', marginBottom: '2px' }}>
                    {toast.title}
                </div>
                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.55)', lineHeight: 1.4, wordBreak: 'break-word' }}>
                    {toast.message}
                </div>
            </div>

            {/* Close */}
            <button
                onClick={(e) => { e.stopPropagation(); removeToast(toast.id); }}
                style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'rgba(255,255,255,0.3)', fontSize: '16px', flexShrink: 0,
                    padding: '0', lineHeight: 1,
                }}
            >×</button>
        </motion.div>
    );
}

// ── Priority Badge ────────────────────────────────────────────────────────────

function PriorityLabel({ priority }: { priority: ToastPriority }) {
    if (priority !== 'critical') return null;
    return (
        <div style={{
            fontSize: '9px', fontWeight: 800, letterSpacing: '1.5px',
            color: '#ff1744', textTransform: 'uppercase', marginBottom: '4px',
        }}>
            ● MISSION CRITIQUE
        </div>
    );
}

// ── System Component ──────────────────────────────────────────────────────────

export default function ToastSystem() {
    const toasts = useUIStore((s) => s.toasts);

    return (
        <div style={{
            position: 'fixed', right: '16px', top: '16px',
            display: 'flex', flexDirection: 'column', gap: '8px',
            zIndex: 150, pointerEvents: 'all',
            maxWidth: '340px',
        }}>
            <AnimatePresence mode="popLayout" initial={false}>
                {toasts.map((toast) => (
                    <div key={toast.id}>
                        <PriorityLabel priority={toast.priority} />
                        <ToastItem toast={toast} />
                    </div>
                ))}
            </AnimatePresence>
        </div>
    );
}
