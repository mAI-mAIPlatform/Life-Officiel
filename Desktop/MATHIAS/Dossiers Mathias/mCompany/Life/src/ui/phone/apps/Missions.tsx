/**
 * @fileoverview NeoOS — Missions App
 * Kanban board (To Do / In Progress / Done) with timers and drag-to-move.
 */
import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { usePhoneStore, type Mission, type MissionStatus } from '../../store/usePhoneStore';

const COLUMNS: { id: MissionStatus; label: string; color: string }[] = [
    { id: 'todo', label: '📋 To Do', color: '#ffb800' },
    { id: 'inProgress', label: '⚡ En cours', color: '#00f5ff' },
    { id: 'done', label: '✅ Terminé', color: '#00ff88' },
];

const PRIORITY_COLORS: Record<string, string> = {
    low: 'rgba(255,255,255,0.3)',
    medium: '#ffb800',
    high: '#ff6b35',
    critical: '#ff1744',
};

function formatTime(s: number) {
    const m = Math.floor(s / 60), sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export default function MissionsApp() {
    const { missions, moveMission, tickMissionTimer } = usePhoneStore();
    const [selected, setSelected] = useState<Mission | null>(null);

    // Tick running timers every second
    useEffect(() => {
        const id = setInterval(() => {
            missions.forEach((m) => { if (m.timerRunning) tickMissionTimer(m.id); });
        }, 1000);
        return () => clearInterval(id);
    }, [missions, tickMissionTimer]);

    const liveMission = selected ? missions.find((m) => m.id === selected.id) ?? selected : null;

    return (
        <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <div style={{ padding: '48px 16px 12px', background: '#0d1117' }}>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#fff', fontFamily: 'Outfit, sans-serif' }}>Missions</div>
                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>
                    {missions.filter(m => m.status === 'inProgress').length} active · {missions.filter(m => m.status === 'done').length} done
                </div>
            </div>

            {/* Kanban */}
            <div style={{ flex: 1, overflowX: 'auto', display: 'flex', gap: '12px', padding: '0 12px 12px' }}>
                {COLUMNS.map((col) => {
                    const cards = missions.filter((m) => m.status === col.id);
                    return (
                        <div key={col.id} style={{ minWidth: '220px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {/* Column header */}
                            <div style={{
                                padding: '8px 12px', borderRadius: '10px',
                                background: col.color + '15', borderBottom: `2px solid ${col.color}`,
                                fontSize: '12px', fontWeight: 700, color: col.color, letterSpacing: '0.5px',
                            }}>
                                {col.label} ({cards.length})
                            </div>

                            {/* Cards */}
                            <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {cards.map((m, i) => (
                                    <motion.div
                                        key={m.id}
                                        initial={{ opacity: 0, y: 15 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: i * 0.05 }}
                                        onClick={() => setSelected(m)}
                                        style={{
                                            padding: '12px', borderRadius: '12px', cursor: 'pointer',
                                            background: 'rgba(26,31,46,0.95)',
                                            border: `1px solid ${PRIORITY_COLORS[m.priority]}44`,
                                            borderLeft: `3px solid ${PRIORITY_COLORS[m.priority]}`,
                                        }}
                                    >
                                        <div style={{ fontSize: '12px', fontWeight: 600, color: '#fff', marginBottom: '4px' }}>
                                            {m.title}
                                        </div>
                                        <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginBottom: '8px' }}>
                                            {m.faction}
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ fontSize: '11px', color: '#00ff88', fontWeight: 700 }}>
                                                💰 {m.reward.toLocaleString()} NC
                                            </span>
                                            {m.timerRunning && (
                                                <span style={{
                                                    fontSize: '11px', color: '#00f5ff',
                                                    fontFamily: 'JetBrains Mono, monospace',
                                                }}>
                                                    ⏱ {formatTime(m.elapsed)}
                                                </span>
                                            )}
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Detail Slide-Over */}
            {liveMission && (
                <motion.div
                    className="absolute inset-0"
                    style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    onClick={() => setSelected(null)}
                >
                    <motion.div
                        style={{
                            position: 'absolute', bottom: 0, left: 0, right: 0,
                            background: '#12151f', borderRadius: '24px 24px 0 0', padding: '24px',
                        }}
                        initial={{ y: '100%' }} animate={{ y: 0 }} transition={{ type: 'spring', damping: 28 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div style={{
                            width: '40px', height: '4px', borderRadius: '2px',
                            background: 'rgba(255,255,255,0.2)', margin: '0 auto 16px',
                        }} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                                <div style={{ fontSize: '18px', fontWeight: 700, color: '#fff' }}>{liveMission.title}</div>
                                <div style={{ fontSize: '12px', color: PRIORITY_COLORS[liveMission.priority], marginTop: '3px', fontWeight: 600 }}>
                                    ◆ {liveMission.priority.toUpperCase()} · {liveMission.faction}
                                </div>
                            </div>
                            <div style={{ fontSize: '20px', color: '#00ff88', fontWeight: 800 }}>
                                {liveMission.reward.toLocaleString()} NC
                            </div>
                        </div>
                        <div style={{ margin: '14px 0', fontSize: '13px', color: 'rgba(255,255,255,0.65)', lineHeight: 1.6 }}>
                            {liveMission.description}
                        </div>
                        {liveMission.elapsed > 0 && (
                            <div style={{
                                marginBottom: '14px', padding: '10px 14px', borderRadius: '12px',
                                background: 'rgba(0,245,255,0.08)', border: '1px solid rgba(0,245,255,0.15)',
                                fontSize: '14px', color: '#00f5ff', fontFamily: 'JetBrains Mono, monospace',
                            }}>
                                ⏱ Temps écoulé : {formatTime(liveMission.elapsed)}
                            </div>
                        )}
                        {/* Move buttons */}
                        <div style={{ display: 'flex', gap: '8px' }}>
                            {COLUMNS.filter((c) => c.id !== liveMission.status).map((c) => (
                                <button key={c.id}
                                    onClick={() => { moveMission(liveMission.id, c.id); setSelected(null); }}
                                    style={{
                                        flex: 1, padding: '12px', borderRadius: '14px', cursor: 'pointer',
                                        background: c.color + '22', color: c.color, fontWeight: 700, fontSize: '13px',
                                        border: `1px solid ${c.color}44`,
                                    }}
                                >
                                    → {c.label}
                                </button>
                            ))}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </div>
    );
}
