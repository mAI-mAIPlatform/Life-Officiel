/**
 * @fileoverview LIFE Engine — FoleyManager
 *
 * Procedural SFX system covering:
 *   1. Footsteps  — material-aware, anti-machine-gun, pitch/vol variation.
 *   2. Vehicle    — RPM-based engine synthesis, wind noise, tire skid.
 *   3. UI Sounds  — satisfying synthetic tones for interface events.
 *   4. Ambiance   — looping background layers (wind, distant city, nature).
 *
 * All sounds are synthesized on-the-fly via Web Audio API.
 * No audio files are required — suitable for offline / first-boot scenarios.
 *
 * Usage:
 *   const foley = FoleyManager.getInstance(engine);
 *   foley.init();
 *   // Footsteps
 *   foley.playFootstep('Concrete', playerWorldPos);
 *   // Vehicle
 *   const car = foley.createVehicleSource();
 *   car.setRPM(1800);
 *   car.setSpeed(60);    // km/h
 *   car.setSkid(true);
 *   car.dispose();
 *   // UI
 *   foley.playUI('click');
 */

import * as THREE from 'three';
import { AudioEngine, type SoundEmitter3D } from './AudioEngine';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type FloorMaterial = 'Concrete' | 'Grass' | 'Metal' | 'Water' | 'Wood';

export type UIEvent =
    | 'click'
    | 'hover'
    | 'success'
    | 'error'
    | 'notification'
    | 'open'
    | 'close';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Number of sample variations per material (anti-machine-gun). */
const VARIATIONS_PER_MATERIAL = 5;

/** Pitch variation range in semitones (±). */
const PITCH_VARIATION_SEMITONES = 3;

/** Volume variation range (±dB). */
const VOL_VARIATION_DB = 3;

/** Minimum time between footstep sounds (seconds). */
const MIN_STEP_INTERVAL_SEC = 0.18;

/** RPM range for engine synthesis. */
const RPM_MIN = 700;
const RPM_MAX = 7_000;

/** Speed threshold for wind noise onset (km/h). */
const WIND_ONSET_SPEED = 20;

/** Lateral velocity threshold to trigger skid sound (m/s). */
const SKID_THRESHOLD = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Footstep material DSP descriptors
// ─────────────────────────────────────────────────────────────────────────────

interface MaterialDSP {
    /** Base frequency for the transient character. */
    baseFreq: number;
    /** Decay time in seconds. */
    decay: number;
    /** Noise mix ratio (0 = pure tone, 1 = pure noise). */
    noiseMix: number;
    /** Base gain. */
    gain: number;
    /** BandPass filter Q (0 = bypass). */
    filterQ: number;
}

const MATERIAL_DSP: Record<FloorMaterial, MaterialDSP> = {
    Concrete: { baseFreq: 250, decay: 0.06, noiseMix: 0.7, gain: 0.5, filterQ: 1.2 },
    Grass: { baseFreq: 120, decay: 0.04, noiseMix: 0.95, gain: 0.25, filterQ: 0.8 },
    Metal: { baseFreq: 700, decay: 0.12, noiseMix: 0.4, gain: 0.6, filterQ: 3.0 },
    Water: { baseFreq: 200, decay: 0.08, noiseMix: 0.85, gain: 0.4, filterQ: 0.6 },
    Wood: { baseFreq: 350, decay: 0.07, noiseMix: 0.55, gain: 0.45, filterQ: 1.5 },
};

// ─────────────────────────────────────────────────────────────────────────────
// VehicleSource handle
// ─────────────────────────────────────────────────────────────────────────────

export interface VehicleSource {
    /** Update engine RPM [700–7000]. */
    setRPM(rpm: number): void;
    /** Set vehicle speed in km/h (affects wind noise). */
    setSpeed(kmh: number): void;
    /** Toggle tire skid sound. */
    setSkid(active: boolean): void;
    /** Attach emitter to a 3D position. */
    setPosition(pos: THREE.Vector3): void;
    /** Free all nodes. */
    dispose(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// FoleyManager
// ─────────────────────────────────────────────────────────────────────────────

export class FoleyManager {
    private static _instance: FoleyManager | null = null;

    private _engine: AudioEngine;

    /** Pre-baked footstep buffers per material × variation. */
    private _footstepBuffers: Map<FloorMaterial, AudioBuffer[]> = new Map();

    /** Last played variation index per material (anti-machine-gun). */
    private _lastVariation: Map<FloorMaterial, number> = new Map();

    /** Last footstep timestamp per entity ID. */
    private _lastStepTime: Map<string, number> = new Map();

    /** Ambient loop emitters. */
    private _ambientEmitters: SoundEmitter3D[] = [];

    private _initialized = false;

    static getInstance(engine?: AudioEngine): FoleyManager {
        if (!FoleyManager._instance) {
            if (!engine) throw new Error('[FoleyManager] Pass AudioEngine on first call.');
            FoleyManager._instance = new FoleyManager(engine);
        }
        return FoleyManager._instance;
    }

    private constructor(engine: AudioEngine) {
        this._engine = engine;
    }

    // ─── Init ─────────────────────────────────────────────────────────────────

    /**
     * Pre-synthesizes all footstep buffers and starts ambient loops.
     * Call once after AudioEngine.init().
     */
    init(): void {
        if (this._initialized) return;
        this._synthesizeFootstepBuffers();
        this._initialized = true;
        console.info('[FoleyManager] Initialized.');
    }

    // ─── Footstep Synthesis ───────────────────────────────────────────────────

    private _synthesizeFootstepBuffers(): void {
        const materials: FloorMaterial[] = ['Concrete', 'Grass', 'Metal', 'Water', 'Wood'];
        for (const mat of materials) {
            const buffers: AudioBuffer[] = [];
            for (let v = 0; v < VARIATIONS_PER_MATERIAL; v++) {
                buffers.push(this._synthFootstep(mat, v));
            }
            this._footstepBuffers.set(mat, buffers);
            this._lastVariation.set(mat, -1);
        }
    }

    /**
     * Synthesizes a single footstep sample for the given material and variation seed.
     */
    private _synthFootstep(mat: FloorMaterial, seed: number): AudioBuffer {
        const ctx = this._engine.context;
        const dsp = MATERIAL_DSP[mat];
        const sr = ctx.sampleRate;
        const len = Math.floor(sr * (dsp.decay * 3));
        const buf = ctx.createBuffer(1, len, sr);
        const d = buf.getChannelData(0);

        // Seed-based subtle frequency variation (±20%)
        const freqVar = 1 + (seed / VARIATIONS_PER_MATERIAL - 0.5) * 0.4;
        const freq = dsp.baseFreq * freqVar;

        // Simple 1-pole bandpass approximation pre-baked into samples
        const omega = 2 * Math.PI * freq / sr;
        const alpha = Math.sin(omega) / (2 * dsp.filterQ || 1);
        const b0 = alpha;
        const b2 = -alpha;
        const a0 = 1 + alpha;
        const a1 = -2 * Math.cos(omega);
        const a2 = 1 - alpha;

        let x1 = 0, x2 = 0, y1 = 0, y2 = 0;

        for (let i = 0; i < len; i++) {
            const t = i / sr;
            const env = Math.exp(-t / dsp.decay);
            const tone = Math.sin(2 * Math.PI * freq * t) * (1 - dsp.noiseMix);
            const noise = (Math.random() * 2 - 1) * dsp.noiseMix;
            const x = (tone + noise) * env * dsp.gain;

            // Biquad filter
            if (dsp.filterQ > 0) {
                const y = (b0 / a0) * x + (0 / a0) * x1 + (b2 / a0) * x2
                    - (a1 / a0) * y1 - (a2 / a0) * y2;
                x2 = x1; x1 = x;
                y2 = y1; y1 = y;
                d[i] = y;
            } else {
                d[i] = x;
            }
        }
        return buf;
    }

    // ─── Footstep Playback ───────────────────────────────────────────────────

    /**
     * Plays a footstep sound for the given floor material.
     * Anti-machine-gun: selects a random variation different from the last.
     * Pitch and volume are randomized within a small range.
     *
     * @param material   - Detected floor material
     * @param position   - World-space position of the foot
     * @param entityId   - Unique ID to throttle per-entity step rate
     * @param emitter    - Optional pre-created 3D emitter; if omitted, plays 2D
     */
    playFootstep(
        material: FloorMaterial,
        position: THREE.Vector3,
        entityId = 'default',
        emitter?: SoundEmitter3D,
    ): void {
        const now = performance.now() / 1000;
        const last = this._lastStepTime.get(entityId) ?? 0;
        if (now - last < MIN_STEP_INTERVAL_SEC) return;
        this._lastStepTime.set(entityId, now);

        const buffers = this._footstepBuffers.get(material);
        if (!buffers?.length) return;

        // Anti-machine-gun: pick a variation different from the last
        let idx: number;
        const lastIdx = this._lastVariation.get(material) ?? -1;
        do {
            idx = Math.floor(Math.random() * buffers.length);
        } while (idx === lastIdx && buffers.length > 1);
        this._lastVariation.set(material, idx);

        // Pitch & volume variation
        const pitchCents = (Math.random() * 2 - 1) * PITCH_VARIATION_SEMITONES * 100;
        const volDb = (Math.random() * 2 - 1) * VOL_VARIATION_DB;
        const volume = Math.pow(10, volDb / 20); // dB → linear

        if (emitter) {
            emitter.targetPosition.copy(position);
            this._engine.playOnEmitter(emitter, buffers[idx], { detune: pitchCents, volume });
        } else {
            this._engine.play2D(buffers[idx], { detune: pitchCents, volume });
        }
    }

    // ─── Floor Raycast Detection ──────────────────────────────────────────────

    /**
     * Detects the floor material under a position using Three.js Raycaster.
     * Falls back to 'Concrete' if nothing is detected.
     *
     * @param scene       - Three.js scene
     * @param fromPos     - Character foot position (cast downward from here)
     * @returns Detected material name
     */
    detectFloorMaterial(scene: THREE.Scene, fromPos: THREE.Vector3): FloorMaterial {
        const raycaster = new THREE.Raycaster(
            fromPos.clone().add(new THREE.Vector3(0, 0.1, 0)),
            new THREE.Vector3(0, -1, 0),
            0,
            2,
        );
        const hits = raycaster.intersectObjects(scene.children, true);
        if (!hits.length) return 'Concrete';

        const obj = hits[0].object;
        // Check userData.audioMaterial (set per mesh by level designers)
        const mat = obj.userData['audioMaterial'] as FloorMaterial | undefined;
        if (mat && MATERIAL_DSP[mat]) return mat;

        // Heuristic: infer from mesh name
        const name = obj.name.toLowerCase();
        if (name.includes('grass') || name.includes('terrain')) return 'Grass';
        if (name.includes('metal') || name.includes('iron') || name.includes('steel')) return 'Metal';
        if (name.includes('water') || name.includes('puddle')) return 'Water';
        if (name.includes('wood') || name.includes('plank')) return 'Wood';
        return 'Concrete';
    }

    // ─── Vehicle Audio ────────────────────────────────────────────────────────

    /**
     * Creates an active vehicle audio source.
     * Returns a handle with RPM / speed / skid controls.
     */
    createVehicleSource(position?: THREE.Vector3): VehicleSource {
        const ctx = this._engine.context;

        // 1. Engine oscillator (sawtooth, RPM-driven)
        const engineOsc = ctx.createOscillator();
        engineOsc.type = 'sawtooth';
        engineOsc.frequency.value = this._rpmToFreq(RPM_MIN);

        const engineFilter = ctx.createBiquadFilter();
        engineFilter.type = 'bandpass';
        engineFilter.frequency.value = 200;
        engineFilter.Q.value = 2;

        const engineGain = ctx.createGain();
        engineGain.gain.value = 0.3;

        engineOsc.connect(engineFilter);
        engineFilter.connect(engineGain);
        engineGain.connect(this._engine.masterGain);
        engineOsc.start();

        // 2. Wind noise (white noise + highpass, speed-driven)
        const windBuffer = this._engine.createNoiseBuffer(2, 2);
        const windSource = ctx.createBufferSource();
        windSource.buffer = windBuffer;
        windSource.loop = true;

        const windFilter = ctx.createBiquadFilter();
        windFilter.type = 'highpass';
        windFilter.frequency.value = 1500;

        const windGain = ctx.createGain();
        windGain.gain.value = 0;

        windSource.connect(windFilter);
        windFilter.connect(windGain);
        windGain.connect(this._engine.masterGain);
        windSource.start();

        // 3. Skid sound (bandpass noise burst)
        const skidBuffer = this._engine.createNoiseBuffer(0.5, 1);
        let skidSource: AudioBufferSourceNode | null = null;
        let skidGain: GainNode | null = null;
        let skidActive = false;

        const startSkid = (): void => {
            if (skidActive) return;
            skidActive = true;
            skidGain = ctx.createGain();
            skidGain.gain.value = 0.5;
            skidSource = ctx.createBufferSource();
            skidSource.buffer = skidBuffer;
            skidSource.loop = true;
            const skidFilter = ctx.createBiquadFilter();
            skidFilter.type = 'bandpass';
            skidFilter.frequency.value = 600;
            skidFilter.Q.value = 1.5;
            skidSource.connect(skidFilter);
            skidFilter.connect(skidGain);
            skidGain.connect(this._engine.masterGain);
            skidSource.start();
        };

        const stopSkid = (): void => {
            if (!skidActive) return;
            skidActive = false;
            skidGain?.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
            setTimeout(() => {
                try { skidSource?.stop(); } catch { /* ok */ }
                skidGain?.disconnect();
            }, 200);
        };

        // ── Create 3D emitter if position provided ────────────────────────────
        let emitter: SoundEmitter3D | null = null;
        if (position) {
            emitter = this._engine.createEmitter({ position, maxDistance: 80, rolloffFactor: 1.5 });
            // Reconnect engine gain to emitter panner instead of master
            engineGain.disconnect();
            engineGain.connect(emitter.panner);
            windGain.disconnect();
            windGain.connect(emitter.panner);
        }

        return {
            setRPM: (rpm: number) => {
                const clamped = Math.max(RPM_MIN, Math.min(RPM_MAX, rpm));
                engineOsc.frequency.setTargetAtTime(
                    this._rpmToFreq(clamped),
                    ctx.currentTime,
                    0.05,
                );
                engineFilter.frequency.setTargetAtTime(
                    80 + (clamped / RPM_MAX) * 600,
                    ctx.currentTime,
                    0.05,
                );
            },
            setSpeed: (kmh: number) => {
                const t = Math.max(0, (kmh - WIND_ONSET_SPEED)) / (200 - WIND_ONSET_SPEED);
                const windVolume = Math.min(1, t * t) * 0.4;
                windGain.gain.setTargetAtTime(windVolume, ctx.currentTime, 0.1);
            },
            setSkid: (active: boolean) => {
                if (active) startSkid();
                else stopSkid();
            },
            setPosition: (pos: THREE.Vector3) => {
                if (emitter) emitter.targetPosition.copy(pos);
            },
            dispose: () => {
                try { engineOsc.stop(); } catch { /* ok */ }
                try { windSource.stop(); } catch { /* ok */ }
                stopSkid();
                engineOsc.disconnect();
                windSource.disconnect();
                engineGain.disconnect();
                windGain.disconnect();
                if (emitter) this._engine.destroyEmitter(emitter);
            },
        };
    }

    /** Maps RPM to oscillator frequency. Linear map [RPM_MIN→50Hz, RPM_MAX→500Hz]. */
    private _rpmToFreq(rpm: number): number {
        const t = (rpm - RPM_MIN) / (RPM_MAX - RPM_MIN);
        return 50 + t * 450; // 50–500 Hz
    }

    // ─── UI Sounds ────────────────────────────────────────────────────────────

    /**
     * Plays a short, satisfying synthetic sound for a UI interaction.
     */
    playUI(event: UIEvent): void {
        const ctx = this._engine.context;
        const t = ctx.currentTime;

        switch (event) {
            case 'click':
                this._playTone(ctx, 880, 0.04, 0.08, 'sine', t);
                break;
            case 'hover':
                this._playTone(ctx, 1200, 0.015, 0.04, 'sine', t, 0.3);
                break;
            case 'success':
                this._playTone(ctx, 523.25, 0.04, 0.1, 'sine', t);      // C5
                this._playTone(ctx, 659.25, 0.04, 0.1, 'sine', t + 0.08); // E5
                this._playTone(ctx, 783.99, 0.04, 0.12, 'sine', t + 0.16);// G5
                break;
            case 'error':
                this._playTone(ctx, 220, 0.06, 0.15, 'square', t, 0.5);
                this._playTone(ctx, 185, 0.06, 0.15, 'square', t + 0.1, 0.5);
                break;
            case 'notification':
                this._playTone(ctx, 1046.5, 0.03, 0.08, 'sine', t);     // C6
                this._playTone(ctx, 1318.5, 0.03, 0.08, 'sine', t + 0.1); // E6
                break;
            case 'open':
                this._playSweep(ctx, 300, 600, 0.1, t, 0.4);
                break;
            case 'close':
                this._playSweep(ctx, 600, 300, 0.1, t, 0.4);
                break;
        }
    }

    private _playTone(
        ctx: AudioContext,
        freq: number,
        attack: number,
        duration: number,
        type: OscillatorType,
        startTime: number,
        gainPeak = 0.25,
    ): void {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(gainPeak, startTime + attack);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        osc.connect(gain);
        gain.connect(this._engine.masterGain);
        osc.start(startTime);
        osc.stop(startTime + duration + 0.01);
    }

    private _playSweep(
        ctx: AudioContext,
        fromHz: number,
        toHz: number,
        duration: number,
        startTime: number,
        gainPeak = 0.3,
    ): void {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(fromHz, startTime);
        osc.frequency.exponentialRampToValueAtTime(toHz, startTime + duration);
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(gainPeak, startTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        osc.connect(gain);
        gain.connect(this._engine.masterGain);
        osc.start(startTime);
        osc.stop(startTime + duration + 0.01);
    }

    // ─── Ambient Backgrounds ─────────────────────────────────────────────────

    /**
     * Starts a global ambient soundscape (city hum + wind layer).
     * These are 2D (non-spatial) background loops.
     */
    startAmbience(): void {
        const ctx = this._engine.context;

        // City hum: two slightly detuned sines
        const humNode1 = ctx.createOscillator();
        humNode1.type = 'sine';
        humNode1.frequency.value = 60;
        const humNode2 = ctx.createOscillator();
        humNode2.type = 'sine';
        humNode2.frequency.value = 63;
        const humGain = ctx.createGain();
        humGain.gain.value = 0.04;
        humNode1.connect(humGain);
        humNode2.connect(humGain);
        humGain.connect(this._engine.masterGain);
        humNode1.start();
        humNode2.start();

        // Background wind: LowPass filtered noise
        const windBuf = this._engine.createNoiseBuffer(4, 2);
        const windSrc = ctx.createBufferSource();
        windSrc.buffer = windBuf;
        windSrc.loop = true;
        const windLPF = ctx.createBiquadFilter();
        windLPF.type = 'lowpass';
        windLPF.frequency.value = 400;
        const windGain = ctx.createGain();
        windGain.gain.value = 0.06;
        windSrc.connect(windLPF);
        windLPF.connect(windGain);
        windGain.connect(this._engine.masterGain);
        windSrc.start();

        console.info('[FoleyManager] Ambience started.');
    }

    // ─── Dispose ─────────────────────────────────────────────────────────────

    dispose(): void {
        for (const emitter of this._ambientEmitters) {
            this._engine.destroyEmitter(emitter);
        }
        this._ambientEmitters = [];
        this._footstepBuffers.clear();
        this._lastVariation.clear();
        this._lastStepTime.clear();
        this._initialized = false;
        FoleyManager._instance = null;
    }
}
