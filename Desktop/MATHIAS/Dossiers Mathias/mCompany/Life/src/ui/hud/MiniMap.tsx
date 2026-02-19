/**
 * @fileoverview LIFE RPG — Mini-Map (Canvas 2D)
 * Radar-style minimap in the bottom-right corner.
 * Rotates with player heading, shows POI blips.
 */
import React, { useRef, useEffect } from 'react';

const SIZE = 120;
const BLIPS = [
    { dx: 0.3, dy: -0.5, color: '#ff1744', label: 'E' },
    { dx: -0.4, dy: 0.2, color: '#00ff88', label: 'A' },
    { dx: 0.6, dy: 0.4, color: '#ffb800', label: 'M' },
];

export default function MiniMap() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const angle = useRef(0);

    useEffect(() => {
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext('2d')!;
        let raf: number;

        const draw = () => {
            const W = SIZE, H = SIZE, cx = W / 2, cy = H / 2, r = W / 2 - 2;

            ctx.clearRect(0, 0, W, H);

            // Clip to circle
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.clip();

            // Background
            ctx.fillStyle = 'rgba(10,12,18,0.8)';
            ctx.fillRect(0, 0, W, H);

            // Grid
            ctx.strokeStyle = 'rgba(0,245,255,0.08)';
            ctx.lineWidth = 0.5;
            for (let i = 0; i <= 4; i++) {
                const xi = (W / 4) * i;
                ctx.beginPath(); ctx.moveTo(xi, 0); ctx.lineTo(xi, H); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(0, xi); ctx.lineTo(W, xi); ctx.stroke();
            }

            // Blips
            BLIPS.forEach(({ dx, dy, color }) => {
                const bx = cx + dx * r, by = cy + dy * r;
                ctx.beginPath(); ctx.arc(bx, by, 4, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();
                // Glow
                ctx.shadowColor = color; ctx.shadowBlur = 6;
                ctx.fill();
                ctx.shadowBlur = 0;
            });

            // Player arrow
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(angle.current);
            ctx.beginPath();
            ctx.moveTo(0, -10); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6);
            ctx.closePath();
            ctx.fillStyle = '#b700ff';
            ctx.shadowColor = '#b700ff'; ctx.shadowBlur = 10;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.restore();

            // Border ring
            ctx.restore();
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(0,245,255,0.3)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Compass N
            ctx.fillStyle = '#00f5ff';
            ctx.font = 'bold 9px Inter';
            ctx.textAlign = 'center';
            ctx.fillText('N', cx, 12);

            angle.current += 0.001; // Slowly rotate for demo
            raf = requestAnimationFrame(draw);
        };

        draw();
        return () => cancelAnimationFrame(raf);
    }, []);

    return (
        <div style={{
            position: 'fixed', bottom: '28px', right: '20px', zIndex: 101,
            borderRadius: '50%', overflow: 'hidden',
            boxShadow: '0 0 0 1.5px rgba(0,245,255,0.25), 0 8px 32px rgba(0,0,0,0.6)',
        }}>
            <canvas ref={canvasRef} width={SIZE} height={SIZE} />
        </div>
    );
}
