/**
 * @fileoverview NeoOS — Camera App
 * WebGL render capture with shader filters + local gallery.
 * Integrates with Three.js renderer via a shared ref.
 */
import React, { useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePhoneStore, type GalleryPhoto } from '../../store/usePhoneStore';

export type CameraFilter = 'none' | 'mono' | 'vaporwave' | 'glitch' | 'night';

const FILTERS: { id: CameraFilter; label: string; emoji: string }[] = [
    { id: 'none', label: 'Normal', emoji: '🌅' },
    { id: 'mono', label: 'Mono', emoji: '⬛' },
    { id: 'vaporwave', label: 'Vaporwave', emoji: '🌸' },
    { id: 'glitch', label: 'Glitch', emoji: '📡' },
    { id: 'night', label: 'Night', emoji: '🌙' },
];

/** Apply CSS-based filter to a canvas and export as dataURL */
function applyFilterToCanvas(src: HTMLCanvasElement, filter: CameraFilter): string {
    const dst = document.createElement('canvas');
    dst.width = src.width;
    dst.height = src.height;
    const ctx = dst.getContext('2d')!;

    // Apply CSS-equivalent filter via canvas
    switch (filter) {
        case 'mono':
            ctx.filter = 'grayscale(100%) contrast(110%)';
            break;
        case 'vaporwave':
            ctx.filter = 'hue-rotate(220deg) saturate(200%) brightness(1.1)';
            break;
        case 'glitch':
            ctx.filter = 'hue-rotate(90deg) saturate(300%) contrast(130%)';
            break;
        case 'night':
            ctx.filter = 'brightness(0.5) saturate(60%) hue-rotate(180deg)';
            break;
        default:
            ctx.filter = 'none';
    }
    ctx.drawImage(src, 0, 0);
    ctx.filter = 'none';

    // Glitch overlay: random horizontal slice shifts
    if (filter === 'glitch') {
        const slices = 12;
        for (let i = 0; i < slices; i++) {
            const y = Math.random() * dst.height;
            const h = Math.random() * 6 + 1;
            const shift = (Math.random() - 0.5) * 20;
            ctx.drawImage(dst, 0, y, dst.width, h, shift, y, dst.width, h);
        }
        // Chromatic fringe
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.3;
        ctx.filter = 'hue-rotate(120deg)';
        ctx.drawImage(src, 3, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.filter = 'none';
    }

    return dst.toDataURL('image/png');
}

/** Placeholder: returns a gradient canvas when no Three.js renderer is available */
function generatePlaceholderCanvas(filter: CameraFilter): string {
    const canvas = document.createElement('canvas');
    canvas.width = 390;
    canvas.height = 300;
    const ctx = canvas.getContext('2d')!;

    // Simulated scene gradient
    const grad = ctx.createLinearGradient(0, 0, 390, 300);
    grad.addColorStop(0, '#0a0c12');
    grad.addColorStop(0.4, '#1a1f2e');
    grad.addColorStop(1, '#0d1117');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 390, 300);

    // Neon city silhouette
    ctx.fillStyle = '#12151f';
    [40, 60, 80, 50, 90, 70, 55, 85, 45, 65].forEach((h, i) => {
        ctx.fillRect(i * 40, 300 - h, 32, h);
    });

    // Neon glow lines
    ctx.strokeStyle = '#00f5ff44'; ctx.lineWidth = 1;
    for (let i = 0; i < 300; i += 30) {
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(390, i); ctx.stroke();
    }

    // Stars
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 60; i++) {
        ctx.beginPath();
        ctx.arc(Math.random() * 390, Math.random() * 200, Math.random() * 1.5, 0, Math.PI * 2);
        ctx.fill();
    }

    return applyFilterToCanvas(canvas, filter);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CameraApp() {
    const { gallery, addPhoto, deletePhoto } = usePhoneStore();
    const [activeFilter, setActiveFilter] = useState<CameraFilter>('none');
    const [view, setView] = useState<'camera' | 'gallery'>('camera');
    const [flash, setFlash] = useState(false);
    const [fullscreen, setFullscreen] = useState<GalleryPhoto | null>(null);

    const shoot = useCallback(() => {
        setFlash(true);
        setTimeout(() => setFlash(false), 150);
        const dataUrl = generatePlaceholderCanvas(activeFilter);
        addPhoto({ dataUrl, filter: activeFilter });
    }, [activeFilter, addPhoto]);

    const filterStyle = (f: CameraFilter): React.CSSProperties => {
        switch (f) {
            case 'mono': return { filter: 'grayscale(100%) contrast(110%)' };
            case 'vaporwave': return { filter: 'hue-rotate(220deg) saturate(200%)' };
            case 'glitch': return { filter: 'hue-rotate(90deg) saturate(300%)' };
            case 'night': return { filter: 'brightness(0.5) hue-rotate(180deg)' };
            default: return {};
        }
    };

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0c12' }}>
            {/* Tab bar */}
            <div style={{ display: 'flex', padding: '48px 16px 0', gap: '0', background: '#0d1117' }}>
                {(['camera', 'gallery'] as const).map((t) => (
                    <button key={t} onClick={() => setView(t)} style={{
                        flex: 1, padding: '10px', border: 'none', cursor: 'pointer',
                        background: 'transparent',
                        color: view === t ? '#b700ff' : 'rgba(255,255,255,0.4)',
                        fontWeight: view === t ? 700 : 400, fontSize: '14px',
                        borderBottom: view === t ? '2px solid #b700ff' : '2px solid transparent',
                        transition: 'all 0.2s',
                    }}>
                        {t === 'camera' ? '📷 Appareil' : `🖼️ Galerie (${gallery.length})`}
                    </button>
                ))}
            </div>

            {view === 'camera' ? (
                <>
                    {/* Viewfinder */}
                    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                        {/* Simulated game view */}
                        <div style={{
                            width: '100%', height: '100%',
                            background: 'linear-gradient(160deg, #0a0c12 0%, #1a1f2e 50%, #0d1117 100%)',
                            ...filterStyle(activeFilter),
                        }}>
                            {/* City silhouette */}
                            <svg viewBox="0 0 390 300" style={{ width: '100%', height: '100%', position: 'absolute', bottom: 0 }}>
                                <defs>
                                    <linearGradient id="cityGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                                        <stop offset="0%" stopColor="#0a0c12" />
                                        <stop offset="100%" stopColor="#1a1f2e" />
                                    </linearGradient>
                                </defs>
                                {[40, 65, 90, 55, 80, 70, 50, 85, 45, 60, 75].map((h, i) => (
                                    <rect key={i} x={i * 36} y={300 - h} width={28} height={h} fill="#12151f" />
                                ))}
                                {/* neon windows */}
                                {Array.from({ length: 25 }, (_, i) => (
                                    <rect key={`w${i}`}
                                        x={Math.floor(i / 5) * 36 + 6 + (i % 5) * 4} y={300 - 30 - Math.floor(i / 5) * 15}
                                        width={3} height={4}
                                        fill={['#00f5ff', '#00ff88', '#b700ff', '#ffb800'][i % 4]}
                                        opacity={0.7}
                                    />
                                ))}
                                {/* scan line*/}
                                <line x1="0" y1="150" x2="390" y2="150" stroke="rgba(0,245,255,0.15)" strokeWidth="1" />
                            </svg>
                        </div>

                        {/* AR crosshairs overlay */}
                        <div style={{
                            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            pointerEvents: 'none',
                        }}>
                            <svg width="80" height="80" viewBox="0 0 80 80">
                                <rect x="0" y="0" width="20" height="2" fill="#b700ff" opacity="0.8" />
                                <rect x="0" y="0" width="2" height="20" fill="#b700ff" opacity="0.8" />
                                <rect x="60" y="0" width="20" height="2" fill="#b700ff" opacity="0.8" />
                                <rect x="78" y="0" width="2" height="20" fill="#b700ff" opacity="0.8" />
                                <rect x="0" y="78" width="20" height="2" fill="#b700ff" opacity="0.8" />
                                <rect x="0" y="60" width="2" height="20" fill="#b700ff" opacity="0.8" />
                                <rect x="60" y="78" width="20" height="2" fill="#b700ff" opacity="0.8" />
                                <rect x="78" y="60" width="2" height="20" fill="#b700ff" opacity="0.8" />
                            </svg>
                        </div>

                        {/* Flash effect */}
                        <AnimatePresence>
                            {flash && (
                                <motion.div
                                    style={{ position: 'absolute', inset: 0, background: '#fff', pointerEvents: 'none' }}
                                    initial={{ opacity: 0.8 }} animate={{ opacity: 0 }}
                                    exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
                                />
                            )}
                        </AnimatePresence>
                    </div>

                    {/* Filter strip */}
                    <div style={{
                        display: 'flex', gap: '10px', overflowX: 'auto',
                        padding: '10px 16px', background: '#0d1117',
                        scrollbarWidth: 'none',
                    }}>
                        {FILTERS.map((f) => (
                            <button key={f.id} onClick={() => setActiveFilter(f.id)} style={{
                                flexShrink: 0, width: '60px', padding: '6px 0', borderRadius: '12px',
                                border: activeFilter === f.id ? '1.5px solid #b700ff' : '1.5px solid transparent',
                                background: activeFilter === f.id ? 'rgba(183,0,255,0.15)' : 'rgba(255,255,255,0.06)',
                                color: activeFilter === f.id ? '#b700ff' : 'rgba(255,255,255,0.5)',
                                fontSize: '11px', cursor: 'pointer', textAlign: 'center',
                                transition: 'all 0.2s',
                            }}>
                                <div style={{ fontSize: '20px' }}>{f.emoji}</div>
                                <div style={{ marginTop: '2px' }}>{f.label}</div>
                            </button>
                        ))}
                    </div>

                    {/* Shutter */}
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0 28px', background: '#0d1117' }}>
                        <motion.button
                            onClick={shoot}
                            whileTap={{ scale: 0.88 }}
                            style={{
                                width: '72px', height: '72px', borderRadius: '50%',
                                background: '#fff', border: '4px solid rgba(255,255,255,0.3)',
                                cursor: 'pointer', boxShadow: '0 0 24px rgba(255,255,255,0.3)',
                            }}
                        />
                    </div>
                </>
            ) : (
                /* Gallery Grid */
                <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
                    {gallery.length === 0 ? (
                        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', paddingTop: '60px', fontSize: '14px' }}>
                            📷 Aucune photo. Prenez votre première image !
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                            {gallery.map((photo) => (
                                <div
                                    key={photo.id}
                                    onClick={() => setFullscreen(photo)}
                                    style={{
                                        aspectRatio: '1', borderRadius: '8px', overflow: 'hidden',
                                        cursor: 'pointer', position: 'relative',
                                    }}
                                >
                                    <img src={photo.dataUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="shot" />
                                    <div style={{
                                        position: 'absolute', bottom: 4, left: 4, fontSize: '8px',
                                        color: 'rgba(255,255,255,0.7)',
                                        background: 'rgba(0,0,0,0.6)', padding: '2px 5px', borderRadius: '6px',
                                    }}>{photo.filter}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Fullscreen preview */}
            <AnimatePresence>
                {fullscreen && (
                    <motion.div
                        className="absolute inset-0"
                        style={{ background: '#000', zIndex: 50 }}
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        onClick={() => setFullscreen(null)}
                    >
                        <img src={fullscreen.dataUrl} style={{ width: '100%', height: '100%', objectFit: 'contain' }} alt="full" />
                        <button
                            onClick={(e) => { e.stopPropagation(); deletePhoto(fullscreen.id); setFullscreen(null); }}
                            style={{
                                position: 'absolute', bottom: '40px', left: '50%', transform: 'translateX(-50%)',
                                padding: '12px 24px', borderRadius: '16px', border: 'none', cursor: 'pointer',
                                background: '#ff1744', color: '#fff', fontWeight: 700,
                            }}
                        >🗑 Supprimer</button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
