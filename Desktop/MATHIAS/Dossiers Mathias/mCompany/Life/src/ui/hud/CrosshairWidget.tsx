/**
 * @fileoverview LIFE RPG — Dynamic Crosshair Widget
 *
 * SVG crosshair that:
 * - Changes shape based on weapon type
 * - Expands dynamically with player movement speed
 * - Subtly pulses when shooting
 */
import React from 'react';
import { motion } from 'framer-motion';
import { useUIStore, type CrosshairShape } from '../store/useUIStore';

interface GapConfig { top: number; right: number; bottom: number; left: number; }

function buildGaps(base: number, spread: number): GapConfig {
    const s = base + spread * 24;
    return { top: s, right: s, bottom: s, left: s };
}

// ── Shape Renderers ───────────────────────────────────────────────────────────

function CrossDefault({ color, gaps }: { color: string; gaps: GapConfig }) {
    const len = 10, thick = 2;
    return (
        <>
            {/* Top */}
            <rect x={-thick / 2} y={-(gaps.top + len)} width={thick} height={len} fill={color} rx={1} />
            {/* Bottom */}
            <rect x={-thick / 2} y={gaps.bottom} width={thick} height={len} fill={color} rx={1} />
            {/* Left */}
            <rect x={-(gaps.left + len)} y={-thick / 2} width={len} height={thick} fill={color} rx={1} />
            {/* Right */}
            <rect x={gaps.right} y={-thick / 2} width={len} height={thick} fill={color} rx={1} />
            {/* Center dot */}
            <circle r={1.5} fill={color} />
        </>
    );
}

function CrossSniper({ color, gaps }: { color: string; gaps: GapConfig }) {
    const len = 18, thick = 1;
    return (
        <>
            <circle r={gaps.top} stroke={color} strokeWidth={1} fill="none" opacity={0.6} />
            <line x1={0} y1={-(gaps.top + len)} x2={0} y2={-(gaps.top)} stroke={color} strokeWidth={thick} />
            <line x1={0} y1={gaps.bottom} x2={0} y2={gaps.bottom + len} stroke={color} strokeWidth={thick} />
            <line x1={-(gaps.left + len)} y1={0} x2={-(gaps.left)} y2={0} stroke={color} strokeWidth={thick} />
            <line x1={gaps.right} y1={0} x2={gaps.right + len} y2={0} stroke={color} strokeWidth={thick} />
        </>
    );
}

function CrossShotgun({ color, gaps }: { color: string; gaps: GapConfig }) {
    const r = gaps.top + 4;
    const lines: [number, number][] = [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => [
        Math.cos((deg * Math.PI) / 180) * r,
        Math.sin((deg * Math.PI) / 180) * r,
    ]);
    return (
        <>
            <circle r={r} stroke={color} strokeWidth={1.5} fill="none" />
            {lines.map(([cx, cy], i) => (
                <circle key={i} cx={cx} cy={cy} r={2} fill={color} />
            ))}
        </>
    );
}

function CrossMelee({ color, gaps }: { color: string; gaps: GapConfig }) {
    const s = gaps.top + 6;
    return (
        <>
            <polygon
                points={`0,-${s} ${s},${s / 2} -${s},${s / 2}`}
                stroke={color} strokeWidth={1.5} fill="none"
            />
            <circle r={2.5} fill={color} />
        </>
    );
}

// ── Shape Map ─────────────────────────────────────────────────────────────────

const SHAPE_MAP: Record<CrosshairShape, React.ComponentType<{ color: string; gaps: GapConfig }>> = {
    default: CrossDefault,
    sniper: CrossSniper,
    shotgun: CrossShotgun,
    melee: CrossMelee,
    none: () => null,
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function CrosshairWidget() {
    const crosshair = useUIStore((s) => s.crosshair);
    const { shape, spread, color, opacity } = crosshair;

    const ShapeComp = SHAPE_MAP[shape];
    const gaps = buildGaps(8, spread);

    return (
        <div style={{
            position: 'fixed', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none', zIndex: 100,
        }}>
            <motion.svg
                width="80" height="80" viewBox="-40 -40 80 80"
                style={{ overflow: 'visible', opacity }}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity }}
                transition={{ duration: 0.2 }}
            >
                <ShapeComp color={color} gaps={gaps} />
            </motion.svg>
        </div>
    );
}
