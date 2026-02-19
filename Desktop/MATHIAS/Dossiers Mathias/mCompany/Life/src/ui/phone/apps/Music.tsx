/**
 * @fileoverview NeoOS — Music Player App
 * Audio player (Howler.js), waveform visualizer, radio station selector.
 */
import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Howl } from 'howler';
import { usePhoneStore, type RadioStation } from '../../store/usePhoneStore';

const STATIONS: RadioStation[] = ['NeoWave FM', 'CyberBeat Radio', 'Underground Static', 'Silence'];

const STATION_COLORS: Record<RadioStation, string> = {
    'NeoWave FM': '#00f5ff',
    'CyberBeat Radio': '#ff2d78',
    'Underground Static': '#b700ff',
    'Silence': 'rgba(255,255,255,0.3)',
};

function formatDuration(s: number) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ── Waveform Visualizer ───────────────────────────────────────────────────────

function WaveformBars({ isPlaying, color }: { isPlaying: boolean; color: string }) {
    return (
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center', height: '40px' }}>
            {Array.from({ length: 22 }, (_, i) => {
                const height = isPlaying ? `${20 + Math.sin(i * 0.8) * 15}px` : '6px';
                return (
                    <motion.div
                        key={i}
                        animate={{ height: isPlaying ? [`${10 + Math.sin(i) * 18}px`, `${22 + Math.cos(i * 0.7) * 12}px`] : '6px' }}
                        transition={{ duration: 0.4 + i * 0.03, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
                        style={{ width: '4px', borderRadius: '2px', background: color, minHeight: '4px' }}
                    />
                );
            })}
        </div>
    );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MusicApp() {
    const { tracks, currentTrackIndex, isPlaying, radioStation, volume,
        playPause, nextTrack, prevTrack, setRadioStation, setVolume } = usePhoneStore();
    const howlRef = useRef<Howl | null>(null);
    const [progress, setProgress] = useState(0); // 0-1
    const [elapsed, setElapsed] = useState(0);
    const [showStation, setShowStation] = useState(false);
    const rafId = useRef<number>();

    const track = tracks[currentTrackIndex];
    const color = STATION_COLORS[radioStation];

    // ── Howler lifecycle ──────────────────────────────────────────────────────

    useEffect(() => {
        if (!track.src) return; // No src in seed data — demo mode
        howlRef.current?.unload();
        howlRef.current = new Howl({
            src: [track.src],
            volume: volume,
            onend: nextTrack,
        });
        if (isPlaying) howlRef.current.play();
        return () => { howlRef.current?.unload(); };
    }, [currentTrackIndex]);

    useEffect(() => {
        const h = howlRef.current;
        if (!h) return;
        isPlaying ? h.play() : h.pause();
    }, [isPlaying]);

    useEffect(() => {
        howlRef.current?.volume(volume);
    }, [volume]);

    // Progress animation (simulated when no real audio src)
    useEffect(() => {
        const tick = () => {
            if (isPlaying) {
                setElapsed((e) => {
                    const next = e + 1 / 60;
                    if (next >= track.duration) { nextTrack(); return 0; }
                    setProgress(next / track.duration);
                    return next;
                });
            }
            rafId.current = requestAnimationFrame(tick);
        };
        rafId.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafId.current!);
    }, [isPlaying, track.duration]);

    useEffect(() => { setElapsed(0); setProgress(0); }, [currentTrackIndex]);

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '48px 24px 24px' }}>
            {/* Artwork placeholder */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '24px' }}>
                <motion.div
                    animate={{ rotate: isPlaying ? 360 : 0 }}
                    transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
                    style={{
                        width: '160px', height: '160px', borderRadius: '50%',
                        background: `conic-gradient(${color}, #1a1f2e, ${color})`,
                        boxShadow: `0 0 60px ${color}55`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                >
                    <div style={{
                        width: '60px', height: '60px', borderRadius: '50%',
                        background: '#0a0c12',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px',
                    }}>🎵</div>
                </motion.div>
            </div>

            {/* Track Info */}
            <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#fff', fontFamily: 'Outfit, sans-serif' }}>
                    {track.title}
                </div>
                <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.5)', marginTop: '4px' }}>
                    {track.artist}
                </div>
            </div>

            {/* Waveform */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
                <WaveformBars isPlaying={isPlaying} color={color} />
            </div>

            {/* Progress Bar */}
            <div style={{ marginBottom: '8px' }}>
                <div style={{
                    height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.1)',
                    position: 'relative', cursor: 'pointer',
                }} onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const p = (e.clientX - rect.left) / rect.width;
                    setProgress(p); setElapsed(p * track.duration);
                }}>
                    <motion.div
                        style={{
                            position: 'absolute', left: 0, top: 0, bottom: 0,
                            background: color, borderRadius: '2px',
                            boxShadow: `0 0 8px ${color}`,
                        }}
                        animate={{ width: `${progress * 100}%` }}
                        transition={{ duration: 0, ease: 'linear' }}
                    />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
                    <span>{formatDuration(Math.floor(elapsed))}</span>
                    <span>{formatDuration(track.duration)}</span>
                </div>
            </div>

            {/* Controls */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '28px', marginBottom: '24px' }}>
                <ControlBtn onClick={prevTrack} label="⏮" size={28} />
                <motion.button
                    onClick={playPause} whileTap={{ scale: 0.9 }}
                    style={{
                        width: '64px', height: '64px', borderRadius: '50%', border: 'none', cursor: 'pointer',
                        background: color, color: '#000', fontSize: '24px',
                        boxShadow: `0 0 30px ${color}66`,
                    }}
                >
                    {isPlaying ? '⏸' : '▶'}
                </motion.button>
                <ControlBtn onClick={nextTrack} label="⏭" size={28} />
            </div>

            {/* Volume */}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '20px' }}>
                <span style={{ fontSize: '16px' }}>🔈</span>
                <input
                    type="range" min="0" max="1" step="0.01"
                    value={volume}
                    aria-label="Volume Control"
                    onChange={(e) => setVolume(parseFloat(e.target.value))}
                    style={{ flex: 1, accentColor: color, height: '4px' }}
                />
                <span style={{ fontSize: '16px' }}>🔊</span>
            </div>

            {/* Radio station selector */}
            <button
                onClick={() => setShowStation((v) => !v)}
                style={{
                    padding: '12px', borderRadius: '16px', border: `1px solid ${color}44`,
                    background: `${color}11`, color, fontWeight: 700, fontSize: '13px', cursor: 'pointer',
                }}
            >
                📻 {radioStation}
            </button>

            <AnimatePresence>
                {showStation && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                        style={{
                            marginTop: '10px', borderRadius: '16px', overflow: 'hidden',
                            border: '1px solid rgba(255,255,255,0.08)',
                        }}
                    >
                        {STATIONS.map((s) => (
                            <div key={s}
                                onClick={() => { setRadioStation(s); setShowStation(false); }}
                                style={{
                                    padding: '12px 16px', cursor: 'pointer',
                                    background: radioStation === s ? `${STATION_COLORS[s]}15` : 'rgba(26,31,46,0.95)',
                                    color: radioStation === s ? STATION_COLORS[s] : 'rgba(255,255,255,0.7)',
                                    fontWeight: radioStation === s ? 700 : 400, fontSize: '13px',
                                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                                }}
                            >
                                {radioStation === s ? '▶ ' : '   '}{s}
                            </div>
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

function ControlBtn({ onClick, label, size }: { onClick: () => void; label: string; size: number }) {
    return (
        <motion.button onClick={onClick} whileTap={{ scale: 0.85 }} style={{
            width: `${size * 1.8}px`, height: `${size * 1.8}px`, borderRadius: '50%',
            background: 'rgba(255,255,255,0.06)', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,0.7)', fontSize: `${size}px`,
        }}>
            {label}
        </motion.button>
    );
}
