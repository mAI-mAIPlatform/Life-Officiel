/**
 * @fileoverview LIFE Engine — OcclusionSystem
 *
 * Handles two physical audio phenomena:
 *   1. **Occlusion** — Raycast from Listener to each SoundEmitter3D.
 *      If blocked by geometry → apply LowPass filter + gain reduction.
 *
 *   2. **Reverb Zones** — AABB / Sphere volumes in world space.
 *      Each zone holds a ConvolverNode with a procedurally-generated IR.
 *      Zone transitions are crossfaded smoothly.
 *
 * Wire-up (called from OcclusionSystem.connectEmitter):
 *   emitter.reverbSend → ConvolverNode (active zone) → masterGain
 *
 * Usage:
 *   const occ = OcclusionSystem.getInstance(engine);
 *   occ.addReverbZone({ type: 'tunnel', center: new THREE.Vector3(0,0,50), halfExtents: new THREE.Vector3(5,3,20) });
 *   // Per-frame:
 *   occ.update(scene, listenerPos, dt);
 */

import * as THREE from 'three';
import { AudioEngine, type SoundEmitter3D } from './AudioEngine';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ReverbZoneType = 'tunnel' | 'openField' | 'smallRoom' | 'none';

/** Axis-Aligned Bounding Box reverb zone. */
export interface ReverbZoneAABB {
    shape: 'box';
    type: ReverbZoneType;
    center: THREE.Vector3;
    halfExtents: THREE.Vector3;
    /** Wet/dry ratio for this zone (0–1). Default 0.3. */
    wetRatio?: number;
}

/** Sphere reverb zone. */
export interface ReverbZoneSphere {
    shape: 'sphere';
    type: ReverbZoneType;
    center: THREE.Vector3;
    radius: number;
    wetRatio?: number;
}

export type ReverbZone = ReverbZoneAABB | ReverbZoneSphere;

/** Internal zone entry with pre-baked ConvolverNode. */
interface InternalZone {
    zone: ReverbZone;
    convolver: ConvolverNode | null; // null for 'none' and 'openField' (uses DelayNode)
    delay: DelayNode | null;          // for 'openField'
    outputGain: GainNode;             // zone's wet output → master
}

/** Per-emitter occlusion state. */
interface EmitterOcclusionState {
    /** 0 = fully occluded, 1 = fully clear. Smooth-interpolated. */
    clarity: number;
    /** Detected reverb zone index (-1 = none). */
    currentZoneIdx: number;
    /** Previously active zone index for crossfade. */
    prevZoneIdx: number;
    /** Crossfade progress [0,1]. 1 = fully in current zone. */
    crossfadeT: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Occlusion raycast budget: check every N ms. */
const OCCLUSION_INTERVAL_MS = 100;

/** Gain applied when fully occluded. */
const OCCLUSION_GAIN_MIN = 0.15;

/** LowPass cutoff when fully occluded (Hz). */
const OCCLUSION_FILTER_HZ = 400;

/** LowPass cutoff when fully clear (Hz). */
const CLEAR_FILTER_HZ = 20_000;

/** Clarity lerp speed (per second). */
const CLARITY_LERP_SPEED = 4;

/** Reverb crossfade duration (seconds). */
const REVERB_CROSSFADE_DURATION = 0.5;

/** IR parameters per zone type. */
const IR_PARAMS: Record<ReverbZoneType, { decay: number; preDelay: number; density: number }> = {
    tunnel: { decay: 2.5, preDelay: 0.02, density: 0.6 },
    smallRoom: { decay: 0.6, preDelay: 0.005, density: 0.9 },
    openField: { decay: 0.1, preDelay: 0.18, density: 0.1 },
    none: { decay: 0, preDelay: 0, density: 0 },
};

// ─────────────────────────────────────────────────────────────────────────────
// OcclusionSystem
// ─────────────────────────────────────────────────────────────────────────────

export class OcclusionSystem {
    private static _instance: OcclusionSystem | null = null;

    private _engine: AudioEngine;
    private _zones: InternalZone[] = [];
    private _emitterStates: Map<number, EmitterOcclusionState> = new Map();
    private _raycaster = new THREE.Raycaster();
    private _lastOcclusionCheck = 0;

    /** Layers that are considered occluders (set externally). */
    occluderLayers: THREE.Layers = (() => {
        const l = new THREE.Layers();
        l.enableAll();
        return l;
    })();

    static getInstance(engine?: AudioEngine): OcclusionSystem {
        if (!OcclusionSystem._instance) {
            if (!engine) throw new Error('[OcclusionSystem] Pass AudioEngine on first call.');
            OcclusionSystem._instance = new OcclusionSystem(engine);
        }
        return OcclusionSystem._instance;
    }

    private constructor(engine: AudioEngine) {
        this._engine = engine;
    }

    // ─── Zone Management ──────────────────────────────────────────────────────

    /**
     * Registers a reverb zone. Call before play loop starts.
     */
    addReverbZone(zone: ReverbZone): void {
        const ctx = this._engine.context;
        let convolver: ConvolverNode | null = null;
        let delay: DelayNode | null = null;
        const outputGain = ctx.createGain();
        outputGain.gain.value = zone.wetRatio ?? 0.3;
        outputGain.connect(this._engine.masterGain);

        if (zone.type === 'openField') {
            // Echo: DelayNode instead of convolver
            delay = ctx.createDelay(0.5);
            delay.delayTime.value = IR_PARAMS.openField.preDelay;
            const fbGain = ctx.createGain();
            fbGain.gain.value = 0.25;
            delay.connect(fbGain);
            fbGain.connect(delay);
            delay.connect(outputGain);
        } else if (zone.type !== 'none') {
            convolver = ctx.createConvolver();
            convolver.buffer = this.buildIR(zone.type);
            convolver.normalize = true;
            convolver.connect(outputGain);
        }

        this._zones.push({ zone, convolver, delay, outputGain });
    }

    /**
     * Procedurally synthesises an Impulse Response AudioBuffer for a given zone type.
     * Uses exponential decay noise — no audio files required.
     */
    buildIR(type: ReverbZoneType): AudioBuffer {
        const ctx = this._engine.context;
        const params = IR_PARAMS[type];
        const sr = ctx.sampleRate;
        const len = Math.max(1, Math.ceil(sr * params.decay));
        const numCh = 2;
        const ir = ctx.createBuffer(numCh, len, sr);
        const preDelaySamples = Math.floor(params.preDelay * sr);

        for (let ch = 0; ch < numCh; ch++) {
            const data = ir.getChannelData(ch);
            for (let i = preDelaySamples; i < len; i++) {
                const t = (i - preDelaySamples) / sr;
                // Exponential decay envelope
                const env = Math.exp(-t * (3 / Math.max(0.01, params.decay)));
                // Noise with varying density
                const noise = Math.random() < params.density
                    ? (Math.random() * 2 - 1)
                    : 0;
                data[i] = env * noise;
            }
        }
        return ir;
    }

    // ─── Emitter Registration ─────────────────────────────────────────────────

    /**
     * Register an emitter so the system manages its occlusion state.
     */
    registerEmitter(emitter: SoundEmitter3D): void {
        this._emitterStates.set(emitter.id, {
            clarity: 1,
            currentZoneIdx: -1,
            prevZoneIdx: -1,
            crossfadeT: 1,
        });
    }

    unregisterEmitter(emitter: SoundEmitter3D): void {
        this._emitterStates.delete(emitter.id);
    }

    // ─── Per-Frame Update ─────────────────────────────────────────────────────

    /**
     * Call once per frame.
     *
     * @param scene       - Three.js scene to raycast against
     * @param listenerPos - World-space listener position
     * @param dt          - Delta time in seconds
     * @param now         - `performance.now()` timestamp
     */
    update(
        scene: THREE.Scene,
        listenerPos: THREE.Vector3,
        dt: number,
        now: number,
    ): void {
        const doOcclusion = (now - this._lastOcclusionCheck) >= OCCLUSION_INTERVAL_MS;
        if (doOcclusion) this._lastOcclusionCheck = now;

        for (const emitter of this._engine.emitters) {
            if (emitter.is2D) continue;
            const state = this._emitterStates.get(emitter.id);
            if (!state) continue;

            const emPos = emitter.currentPosition;

            // ── Occlusion raycast ─────────────────────────────────────────────
            if (doOcclusion) {
                const direction = new THREE.Vector3().subVectors(emPos, listenerPos);
                const distance = direction.length();
                direction.normalize();

                this._raycaster.set(listenerPos, direction);
                this._raycaster.far = distance;
                const hits = this._raycaster.intersectObjects(scene.children, true);

                // Clear hit = no large obstacles between listener and source
                const isOccluded = hits.length > 0 &&
                    hits.some(h => h.object.userData['audioOccluder'] !== false);
                const targetClarity = isOccluded ? 0 : 1;
                state.clarity = targetClarity; // will be smoothed below
            }

            // Smooth clarity
            const clarityTarget = state.clarity;
            const currentGain = emitter.occlusionGain.gain.value;
            const targetGain = OCCLUSION_GAIN_MIN + clarityTarget * (1 - OCCLUSION_GAIN_MIN);
            const targetFilter = OCCLUSION_FILTER_HZ + clarityTarget * (CLEAR_FILTER_HZ - OCCLUSION_FILTER_HZ);

            const t = this._engine.context.currentTime;
            const lerpSpeed = CLARITY_LERP_SPEED * dt;

            emitter.occlusionGain.gain.setTargetAtTime(
                currentGain + (targetGain - currentGain) * lerpSpeed,
                t,
                0.02,
            );
            emitter.occlusionFilter.frequency.setTargetAtTime(
                targetFilter,
                t,
                0.05,
            );

            // ── Reverb zone detection ─────────────────────────────────────────
            const zoneIdx = this._detectZone(emPos);
            if (zoneIdx !== state.currentZoneIdx) {
                state.prevZoneIdx = state.currentZoneIdx;
                state.currentZoneIdx = zoneIdx;
                state.crossfadeT = 0;
            }

            // ── Reverb crossfade ──────────────────────────────────────────────
            if (state.crossfadeT < 1) {
                state.crossfadeT = Math.min(1, state.crossfadeT + dt / REVERB_CROSSFADE_DURATION);
                this._applyReverbCrossfade(emitter, state);
            }
        }
    }

    // ─── Zone Detection ───────────────────────────────────────────────────────

    private _detectZone(pos: THREE.Vector3): number {
        for (let i = 0; i < this._zones.length; i++) {
            const { zone } = this._zones[i];
            if (zone.shape === 'box') {
                const { center, halfExtents } = zone;
                if (
                    Math.abs(pos.x - center.x) <= halfExtents.x &&
                    Math.abs(pos.y - center.y) <= halfExtents.y &&
                    Math.abs(pos.z - center.z) <= halfExtents.z
                ) return i;
            } else {
                if (pos.distanceTo(zone.center) <= zone.radius) return i;
            }
        }
        return -1;
    }

    // ─── Reverb Crossfade Application ────────────────────────────────────────

    private _applyReverbCrossfade(emitter: SoundEmitter3D, state: EmitterOcclusionState): void {
        const ctx = this._engine.context;
        const t = ctx.currentTime;
        const cf = state.crossfadeT;

        // Fade out previous zone send
        if (state.prevZoneIdx >= 0 && state.prevZoneIdx < this._zones.length) {
            const prevZone = this._zones[state.prevZoneIdx];
            const prevInput = prevZone.convolver ?? prevZone.delay;
            if (prevInput) {
                // Ensure emitter.reverbSend is connected to prev (it may already be)
                try { emitter.reverbSend.connect(prevInput); } catch { /* already connected */ }
                emitter.reverbSend.gain.setValueAtTime(1 - cf, t);
            }
        }

        // Fade in current zone send
        if (state.currentZoneIdx >= 0 && state.currentZoneIdx < this._zones.length) {
            const curZone = this._zones[state.currentZoneIdx];
            const curInput = curZone.convolver ?? curZone.delay;
            if (curInput) {
                try { emitter.reverbSend.connect(curInput); } catch { /* already connected */ }
                emitter.reverbSend.gain.setValueAtTime(cf, t);
            }
        } else {
            // No zone — mute reverb send
            emitter.reverbSend.gain.setTargetAtTime(0, t, 0.05);
        }
    }

    // ─── Dispose ─────────────────────────────────────────────────────────────

    dispose(): void {
        for (const z of this._zones) {
            z.convolver?.disconnect();
            z.delay?.disconnect();
            z.outputGain.disconnect();
        }
        this._zones = [];
        this._emitterStates.clear();
        OcclusionSystem._instance = null;
    }
}
