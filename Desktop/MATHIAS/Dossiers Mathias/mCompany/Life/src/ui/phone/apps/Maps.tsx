/**
 * @fileoverview NeoOS — Maps App
 * Canvas 2D map with POI, GPS path animation, and danger heatmap.
 */
import React, { useRef, useEffect, useState } from 'react';

interface POI {
    x: number; y: number;
    label: string; icon: string;
    type: 'mission' | 'shop' | 'danger' | 'safe' | 'player';
    danger?: number; // 0-1
}

const POIS: POI[] = [
    { x: 0.5, y: 0.5, label: 'Joueur', icon: '◉', type: 'player' },
    { x: 0.25, y: 0.3, label: 'Nexus Tower', icon: '🏢', type: 'mission' },
    { x: 0.7, y: 0.2, label: 'Marché Noir', icon: '🛒', type: 'shop' },
    { x: 0.15, y: 0.65, label: 'Zone Rouge', icon: '⚠️', type: 'danger', danger: 0.9 },
    { x: 0.8, y: 0.7, label: 'Clinique', icon: '💊', type: 'safe' },
    { x: 0.4, y: 0.75, label: 'Drop Point', icon: '📦', type: 'mission' },
    { x: 0.6, y: 0.35, label: 'Corpo Patrol', icon: '🚁', type: 'danger', danger: 0.6 },
    { x: 0.9, y: 0.45, label: 'Safe House', icon: '🏠', type: 'safe' },
];

const POI_COLORS = {
    mission: '#00f5ff',
    shop: '#ffb800',
    danger: '#ff1744',
    safe: '#00ff88',
    player: '#b700ff',
};

const DANGER_ZONES = [
    { x: 0.15, y: 0.65, r: 0.18, intensity: 0.85 },
    { x: 0.60, y: 0.35, r: 0.12, intensity: 0.5 },
];

export default function MapsApp() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [selectedPOI, setSelectedPOI] = useState<POI | null>(null);
    const [routeTarget, setRouteTarget] = useState<POI | null>(null);
    const routeAnim = useRef(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d')!;
        let animId: number;
        let t = 0;

        const draw = () => {
            const W = canvas.width;
            const H = canvas.height;
            ctx.clearRect(0, 0, W, H);

            // ── Background grid ──
            ctx.fillStyle = '#0a0c12';
            ctx.fillRect(0, 0, W, H);

            // Grid lines
            ctx.strokeStyle = 'rgba(0,245,255,0.06)';
            ctx.lineWidth = 1;
            for (let xi = 0; xi < W; xi += 30) {
                ctx.beginPath(); ctx.moveTo(xi, 0); ctx.lineTo(xi, H); ctx.stroke();
            }
            for (let yi = 0; yi < H; yi += 30) {
                ctx.beginPath(); ctx.moveTo(0, yi); ctx.lineTo(W, yi); ctx.stroke();
            }

            // ── Heatmap danger zones ──
            DANGER_ZONES.forEach(({ x, y, r, intensity }) => {
                const cx = x * W, cy = y * H, radius = r * Math.min(W, H);
                const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
                grad.addColorStop(0, `rgba(255,23,68,${intensity * 0.55})`);
                grad.addColorStop(1, 'rgba(255,23,68,0)');
                ctx.fillStyle = grad;
                ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
            });

            // ── GPS Route animation ──
            if (routeTarget) {
                const px = 0.5 * W, py = 0.5 * H;
                const tx = routeTarget.x * W, ty = routeTarget.y * H;
                t = (t + 0.02) % 1;

                // Dashed animated line
                ctx.setLineDash([8, 6]);
                ctx.lineDashOffset = -t * 100;
                ctx.strokeStyle = '#00f5ff';
                ctx.lineWidth = 2.5;
                ctx.shadowColor = '#00f5ff';
                ctx.shadowBlur = 8;
                ctx.beginPath();
                ctx.moveTo(px, py);
                // Bezier curve via midpoint
                const mx = (px + tx) / 2 - 20 + Math.sin(t * Math.PI * 2) * 10;
                const my = (py + ty) / 2;
                ctx.bezierCurveTo(mx, py, mx, ty, tx, ty);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.shadowBlur = 0;
                ctx.lineWidth = 1;
            }

            // ── POIs ──
            POIS.forEach((poi) => {
                const px = poi.x * W, py = poi.y * H;
                const color = POI_COLORS[poi.type];
                const isPlayer = poi.type === 'player';

                // Pulse ring for player
                if (isPlayer) {
                    const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 400);
                    ctx.beginPath();
                    ctx.arc(px, py, 14 + pulse * 6, 0, Math.PI * 2);
                    ctx.strokeStyle = `rgba(183,0,255,${0.5 * pulse})`;
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }

                // Icon circle
                ctx.beginPath();
                ctx.arc(px, py, isPlayer ? 10 : 7, 0, Math.PI * 2);
                ctx.fillStyle = color + '33';
                ctx.fill();
                ctx.strokeStyle = color;
                ctx.lineWidth = 1.5;
                ctx.stroke();

                // Label
                ctx.fillStyle = color;
                ctx.font = isPlayer ? 'bold 14px JetBrains Mono' : '10px Inter';
                ctx.textAlign = 'center';
                ctx.fillText(poi.icon, px, py + 4);

                // POI label
                ctx.fillStyle = 'rgba(255,255,255,0.7)';
                ctx.font = '9px Inter';
                ctx.fillText(poi.label, px, py + 19);
            });

            animId = requestAnimationFrame(draw);
        };

        draw();
        return () => cancelAnimationFrame(animId);
    }, [routeTarget]);

    const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
        const rx = (e.clientX - rect.left) / rect.width;
        const ry = (e.clientY - rect.top) / rect.height;
        const hit = POIS.find((p) => Math.hypot(p.x - rx, p.y - ry) < 0.06 && p.type !== 'player');
        setSelectedPOI(hit ?? null);
    };

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ padding: '48px 16px 10px', background: '#0d1117' }}>
                <div style={{ fontSize: '12px', color: 'rgba(0,245,255,0.7)', letterSpacing: '2px', textTransform: 'uppercase' }}>
                    📍 NeoCity · Sector 7 · {routeTarget ? `GPS → ${routeTarget.label}` : 'Exploration'}
                </div>
            </div>

            {/* Canvas Map */}
            <div style={{ flex: 1, position: 'relative' }}>
                <canvas
                    ref={canvasRef}
                    width={390}
                    height={500}
                    onClick={handleCanvasClick}
                    style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }}
                />

                {/* Legend */}
                <div style={{
                    position: 'absolute', top: '10px', right: '10px',
                    background: 'rgba(10,12,18,0.85)', borderRadius: '10px',
                    padding: '8px 12px', fontSize: '10px', border: '1px solid rgba(255,255,255,0.08)',
                }}>
                    {Object.entries(POI_COLORS).filter(([k]) => k !== 'player').map(([type, color]) => (
                        <div key={type} style={{ color, marginBottom: '3px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: color }} />
                            {type.charAt(0).toUpperCase() + type.slice(1)}
                        </div>
                    ))}
                </div>
            </div>

            {/* POI Info Panel */}
            {selectedPOI && (
                <div style={{
                    padding: '14px 16px', background: 'rgba(26,31,46,0.95)',
                    borderTop: '1px solid rgba(0,245,255,0.15)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                    <div>
                        <div style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>
                            {selectedPOI.icon} {selectedPOI.label}
                        </div>
                        <div style={{ fontSize: '12px', color: POI_COLORS[selectedPOI.type], marginTop: '2px' }}>
                            {selectedPOI.type.toUpperCase()}
                            {selectedPOI.danger ? ` · Danger ${Math.round(selectedPOI.danger * 100)}%` : ''}
                        </div>
                    </div>
                    <button
                        onClick={() => { setRouteTarget(selectedPOI); setSelectedPOI(null); }}
                        style={{
                            padding: '8px 16px', borderRadius: '12px', border: 'none', cursor: 'pointer',
                            background: '#00f5ff', color: '#000', fontWeight: 700, fontSize: '13px',
                        }}
                    >GPS ›</button>
                </div>
            )}
        </div>
    );
}
