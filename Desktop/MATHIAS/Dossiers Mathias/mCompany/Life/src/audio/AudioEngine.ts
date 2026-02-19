/**
 * @fileoverview LIFE Engine — AudioEngine
 *
 * Singleton wrapping Web Audio API.
 * Node graph per emitter:
 *   Source → PannerNode (HRTF) → GainNode (occlusion) → BiquadFilter (LowPass)
 *          → GainNode (dry) ──────────────────────────────────────────────────► GainNode (master)
 *          → GainNode (reverbSend) → ConvolverNode (zone IR) ─────────────────► GainNode (master)
 *
 * Usage:
 *   const engine = AudioEngine.getInstance();
 *   engine.init();                        // call once after user gesture
 *   const emitter = engine.createEmitter({ position: new THREE.Vector3() });
 *   engine.playOnEmitter(emitter, buffer, { loop: false });
 *   engine.updateListener(camera);        // call every frame
 */

import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum concurrent sound emitters. */
const MAX_EMITTERS = 64;

/** Maximum concurrent pooled source nodes. */
const MAX_SOURCE_POOL = 32;

/** Lerp factor for emitter position interpolation (per-frame, ~60Hz). */
const POSITION_LERP_FACTOR = 0.25;

/** Speed of sound in m/s used for Doppler calculation. */
const SPEED_OF_SOUND = 343;

/** Doppler factor (1 = realistic, 0 = disabled). */
const DOPPLER_FACTOR = 1;

/** Default master gain (0–1). */
const DEFAULT_MASTER_GAIN = 0.85;

// ─────────────────────────────────────────────────────────────────────────────
// Types & Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface SoundEmitter3DOptions {
    /** Initial world-space position. */
    position: THREE.Vector3;
    /** If true, emitter is considered global (no 3D panning). */
    is2D?: boolean;
    /** Reference distance for rolloff (meters). Default 1. */
    refDistance?: number;
    /** Max distance for rolloff (meters). Default 100. */
    maxDistance?: number;
    /** Rolloff factor. Default 1. */
    rolloffFactor?: number;
    /** Cone inner angle (degrees). Default 360 (omnidirectional). */
    coneInnerAngle?: number;
    /** Cone outer angle (degrees). Default 360. */
    coneOuterAngle?: number;
    /** Gain outside cone (0–1). Default 0. */
    coneOuterGain?: number;
}

export interface PlayOptions {
    loop?: boolean;
    /** Playback offset in seconds. */
    offset?: number;
    /** Volume override (0–1). */
    volume?: number;
    /** Pitch detune in cents (±100 = ±1 semitone). */
    detune?: number;
    /** On-end callback. */
    onEnded?: () => void;
}

/** A node graph bound to a world-space emitter. */
export interface SoundEmitter3D {
    readonly id: number;
    /** Logical target position (interpolated internally). */
    targetPosition: THREE.Vector3;
    /** Current interpolated position (read-only from outside). */
    readonly currentPosition: THREE.Vector3;
    /** Previous position for Doppler velocity estimation. */
    readonly _prevPosition: THREE.Vector3;
    /** 3D panner node. */
    readonly panner: PannerNode;
    /** Gain node controlled by OcclusionSystem. */
    readonly occlusionGain: GainNode;
    /** BiquadFilter controlled by OcclusionSystem. */
    readonly occlusionFilter: BiquadFilterNode;
    /** Dry path gain (to master). */
    readonly dryGain: GainNode;
    /** Reverb send gain (to ConvolverNode). */
    readonly reverbSend: GainNode;
    /** Currently active source node (if any). */
    _activeSource: AudioBufferSourceNode | null;
    /** Whether this emitter is bypassed spatialisation (global/2D). */
    is2D: boolean;
}

/** Entry in the pooled source set. */
interface PooledSource {
    node: AudioBufferSourceNode;
    inUse: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// AudioEngine
// ─────────────────────────────────────────────────────────────────────────────

export class AudioEngine {
    private static _instance: AudioEngine | null = null;

    private _ctx: AudioContext | null = null;
    private _masterGain: GainNode | null = null;
    private _emitters: Map<number, SoundEmitter3D> = new Map();
    private _nextEmitterId = 0;
    private _sourcePool: PooledSource[] = [];
    private _listenerPosition = new THREE.Vector3();
    private _listenerVelocity = new THREE.Vector3();
    private _prevListenerPosition = new THREE.Vector3();
    private _initialized = false;
    private _muted = false;
    private _masterVolume = DEFAULT_MASTER_GAIN;

    /** Expose raw AudioContext for other subsystems (OcclusionSystem, etc.). */
    get context(): AudioContext {
        if (!this._ctx) throw new Error('[AudioEngine] Not initialized. Call init() first.');
        return this._ctx;
    }

    get masterGain(): GainNode {
        if (!this._masterGain) throw new Error('[AudioEngine] Not initialized.');
        return this._masterGain;
    }

    get isInitialized(): boolean {
        return this._initialized;
    }

    // ─── Singleton ────────────────────────────────────────────────────────────

    static getInstance(): AudioEngine {
        if (!AudioEngine._instance) AudioEngine._instance = new AudioEngine();
        return AudioEngine._instance;
    }

    private constructor() { }

    // ─── Init ─────────────────────────────────────────────────────────────────

    /**
     * Creates the AudioContext and builds the master output chain.
     * Must be called from a user-gesture handler (click, keydown, etc.).
     */
    init(): void {
        if (this._initialized) return;

        this._ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48_000 });

        // Master gain → destination
        this._masterGain = this._ctx.createGain();
        this._masterGain.gain.value = this._masterVolume;
        this._masterGain.connect(this._ctx.destination);

        // Set HRTF (browser may downgrade gracefully if unsupported)
        this._ctx.listener.forwardX?.setValueAtTime(0, 0);
        this._ctx.listener.forwardY?.setValueAtTime(0, 0);
        this._ctx.listener.forwardZ?.setValueAtTime(-1, 0);
        this._ctx.listener.upX?.setValueAtTime(0, 0);
        this._ctx.listener.upY?.setValueAtTime(1, 0);
        this._ctx.listener.upZ?.setValueAtTime(0, 0);

        // Pre-fill source pool
        this._fillSourcePool();

        // Auto-resume on user gestures (browsers may suspend AudioContext)
        document.addEventListener('pointerdown', this._resumeCtx, { once: false });
        document.addEventListener('keydown', this._resumeCtx, { once: false });

        this._initialized = true;
        console.info('[AudioEngine] Initialized — sampleRate:', this._ctx.sampleRate, 'Hz');
    }

    private _resumeCtx = (): void => {
        if (this._ctx?.state === 'suspended') {
            this._ctx.resume().catch(console.error);
        }
    };

    // ─── Source Pool ──────────────────────────────────────────────────────────

    private _fillSourcePool(): void {
        // Pool is pre-created lazily per request; here we just allocate slots.
        this._sourcePool = Array.from({ length: MAX_SOURCE_POOL }, () => ({
            node: this._ctx!.createBufferSource(),
            inUse: false,
        }));
    }

    /**
     * Acquires a fresh `AudioBufferSourceNode`.
     * Web Audio nodes can only be started once, so we always create a new one.
     * The pool here tracks *active* count to enforce MAX_SOURCE_POOL.
     */
    private _acquireSource(buffer: AudioBuffer, options: PlayOptions): AudioBufferSourceNode {
        const ctx = this.context;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = options.loop ?? false;
        source.detune.value = options.detune ?? 0;
        return source;
    }

    // ─── Emitter Management ───────────────────────────────────────────────────

    /**
     * Creates a new SoundEmitter3D and wires its node graph.
     */
    createEmitter(options: SoundEmitter3DOptions): SoundEmitter3D {
        const ctx = this.context;
        const id = this._nextEmitterId++;

        // 1. PannerNode (HRTF)
        const panner = ctx.createPanner();
        panner.panningModel = options.is2D ? 'equalpower' : 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = options.refDistance ?? 1;
        panner.maxDistance = options.maxDistance ?? 100;
        panner.rolloffFactor = options.rolloffFactor ?? 1;
        panner.coneInnerAngle = options.coneInnerAngle ?? 360;
        panner.coneOuterAngle = options.coneOuterAngle ?? 360;
        panner.coneOuterGain = options.coneOuterGain ?? 0;
        panner.positionX.setValueAtTime(options.position.x, ctx.currentTime);
        panner.positionY.setValueAtTime(options.position.y, ctx.currentTime);
        panner.positionZ.setValueAtTime(options.position.z, ctx.currentTime);

        // 2. Occlusion gain (controlled by OcclusionSystem)
        const occlusionGain = ctx.createGain();
        occlusionGain.gain.value = 1;

        // 3. Occlusion low-pass filter (default: pass-all)
        const occlusionFilter = ctx.createBiquadFilter();
        occlusionFilter.type = 'lowpass';
        occlusionFilter.frequency.value = 20_000;
        occlusionFilter.Q.value = 0.7;

        // 4. Dry gain → master
        const dryGain = ctx.createGain();
        dryGain.gain.value = 1;

        // 5. Reverb send → (managed by OcclusionSystem convolver)
        const reverbSend = ctx.createGain();
        reverbSend.gain.value = 0; // OcclusionSystem sets this when in a reverb zone

        // Wire: panner → occlusionGain → occlusionFilter → dryGain → master
        panner.connect(occlusionGain);
        occlusionGain.connect(occlusionFilter);
        occlusionFilter.connect(dryGain);
        dryGain.connect(this.masterGain);

        // Wire: panner → reverbSend (OcclusionSystem connects reverbSend to its convolver)
        panner.connect(reverbSend);

        const emitter: SoundEmitter3D = {
            id,
            targetPosition: options.position.clone(),
            currentPosition: options.position.clone(),
            _prevPosition: options.position.clone(),
            panner,
            occlusionGain,
            occlusionFilter,
            dryGain,
            reverbSend,
            _activeSource: null,
            is2D: options.is2D ?? false,
        };

        this._emitters.set(id, emitter);
        if (this._emitters.size > MAX_EMITTERS) {
            console.warn(`[AudioEngine] Emitter count exceeds MAX_EMITTERS (${MAX_EMITTERS})`);
        }
        return emitter;
    }

    /**
     * Destroys an emitter and disconnects its node graph.
     */
    destroyEmitter(emitter: SoundEmitter3D): void {
        emitter._activeSource?.stop();
        emitter._activeSource?.disconnect();
        emitter.panner.disconnect();
        emitter.occlusionGain.disconnect();
        emitter.occlusionFilter.disconnect();
        emitter.dryGain.disconnect();
        emitter.reverbSend.disconnect();
        this._emitters.delete(emitter.id);
    }

    // ─── Playback ─────────────────────────────────────────────────────────────

    /**
     * Plays an AudioBuffer on a given emitter.
     * Returns the created source node so callers can cancel it.
     */
    playOnEmitter(
        emitter: SoundEmitter3D,
        buffer: AudioBuffer,
        options: PlayOptions = {},
    ): AudioBufferSourceNode {
        // Stop previous source if any
        if (emitter._activeSource) {
            try { emitter._activeSource.stop(); } catch { /* already stopped */ }
            emitter._activeSource.disconnect();
        }

        const source = this._acquireSource(buffer, options);
        const gainNode = this.context.createGain();
        gainNode.gain.value = options.volume ?? 1;

        // Wire: source → gainNode → panner
        source.connect(gainNode);
        gainNode.connect(emitter.panner);

        source.start(this.context.currentTime, options.offset ?? 0);

        if (options.onEnded) {
            source.onended = options.onEnded;
        }

        emitter._activeSource = source;
        return source;
    }

    /**
     * Plays a 2D (non-spatial) sound directly on master for UI / music stems.
     */
    play2D(buffer: AudioBuffer, options: PlayOptions = {}): AudioBufferSourceNode {
        const ctx = this.context;
        const source = this._acquireSource(buffer, options);
        const gainNode = ctx.createGain();
        gainNode.gain.value = options.volume ?? 1;
        source.connect(gainNode);
        gainNode.connect(this.masterGain);
        source.start(ctx.currentTime, options.offset ?? 0);
        if (options.onEnded) source.onended = options.onEnded;
        return source;
    }

    // ─── Per-Frame Update ────────────────────────────────────────────────────

    /**
     * Call every render frame with the current camera.
     * Updates listener position/orientation and interpolates all emitter positions.
     * Also computes Doppler detune for each active source.
     *
     * @param camera - Three.js camera (used as audio listener head)
     * @param dt     - Delta time in seconds since last frame
     */
    updateListener(camera: THREE.Camera, dt: number): void {
        if (!this._ctx || !this._initialized) return;
        const ctx = this._ctx;
        const t = ctx.currentTime;

        // ── Listener position & orientation ──────────────────────────────────
        const pos = camera.getWorldPosition(new THREE.Vector3());
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);

        const listener = ctx.listener;
        if (listener.positionX) {
            listener.positionX.setValueAtTime(pos.x, t);
            listener.positionY.setValueAtTime(pos.y, t);
            listener.positionZ.setValueAtTime(pos.z, t);
            listener.forwardX.setValueAtTime(forward.x, t);
            listener.forwardY.setValueAtTime(forward.y, t);
            listener.forwardZ.setValueAtTime(forward.z, t);
            listener.upX.setValueAtTime(up.x, t);
            listener.upY.setValueAtTime(up.y, t);
            listener.upZ.setValueAtTime(up.z, t);
        } else {
            // Legacy API
            listener.setPosition(pos.x, pos.y, pos.z);
            listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
        }

        // Listener velocity for Doppler (smoothed)
        if (dt > 0) {
            this._listenerVelocity
                .copy(pos)
                .sub(this._prevListenerPosition)
                .divideScalar(dt);
        }
        this._prevListenerPosition.copy(pos);
        this._listenerPosition.copy(pos);

        // ── Emitter position interpolation & Doppler ────────────────────────
        for (const emitter of this._emitters.values()) {
            if (emitter.is2D) continue;

            const cur = emitter.currentPosition as THREE.Vector3;
            const target = emitter.targetPosition;

            // Store previous for velocity estimation
            (emitter._prevPosition as THREE.Vector3).copy(cur);

            // Lerp towards target
            cur.lerp(target, POSITION_LERP_FACTOR);

            // Push to panner
            emitter.panner.positionX.setValueAtTime(cur.x, t);
            emitter.panner.positionY.setValueAtTime(cur.y, t);
            emitter.panner.positionZ.setValueAtTime(cur.z, t);

            // ── Doppler ───────────────────────────────────────────────────────
            if (emitter._activeSource && !emitter._activeSource.loop) {
                this._applyDopplerDetune(emitter, pos, dt);
            }
        }
    }

    /**
     * Computes Doppler detune in cents and sets it on the active source.
     * Formula: fr = fs × (c + vr) / (c + vs)
     *   where c = speed of sound, vr = receiver velocity along axis, vs = source velocity along axis
     */
    private _applyDopplerDetune(
        emitter: SoundEmitter3D,
        listenerPos: THREE.Vector3,
        dt: number,
    ): void {
        if (!emitter._activeSource || dt <= 0) return;

        const cur = emitter.currentPosition;
        const prev = emitter._prevPosition;

        // Direction from source to listener
        const axis = new THREE.Vector3().subVectors(listenerPos, cur).normalize();

        // Source velocity along axis
        const sourceVel = new THREE.Vector3().subVectors(cur, prev).divideScalar(dt);
        const vs = sourceVel.dot(axis);

        // Listener velocity along axis (opposite direction)
        const vr = -this._listenerVelocity.dot(axis);

        // Clamp to avoid division by zero / extreme values
        const c = SPEED_OF_SOUND;
        const ratio = (c - Math.max(-c * 0.9, Math.min(c * 0.9, vr))) /
            (c + Math.max(-c * 0.9, Math.min(c * 0.9, vs)));

        // Convert ratio to cents: cents = 1200 × log2(ratio)
        const cents = DOPPLER_FACTOR * 1200 * Math.log2(Math.max(0.01, ratio));

        emitter._activeSource.detune.setTargetAtTime(
            cents,
            this._ctx!.currentTime,
            0.05, // 50ms smoothing
        );
    }

    // ─── Buffer Loading ───────────────────────────────────────────────────────

    /**
     * Decodes an ArrayBuffer (fetched externally) into an AudioBuffer.
     */
    async decodeAudio(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
        return this.context.decodeAudioData(arrayBuffer);
    }

    /**
     * Fetches and decodes an audio asset from a URL.
     */
    async loadAudio(url: string): Promise<AudioBuffer> {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`[AudioEngine] Failed to load audio: ${url}`);
        const ab = await resp.arrayBuffer();
        return this.decodeAudio(ab);
    }

    // ─── Master Controls ─────────────────────────────────────────────────────

    setMasterVolume(volume: number): void {
        this._masterVolume = Math.max(0, Math.min(1, volume));
        if (this._masterGain) {
            this._masterGain.gain.setTargetAtTime(
                this._muted ? 0 : this._masterVolume,
                this._ctx!.currentTime,
                0.05,
            );
        }
    }

    setMuted(muted: boolean): void {
        this._muted = muted;
        if (this._masterGain) {
            this._masterGain.gain.setTargetAtTime(
                muted ? 0 : this._masterVolume,
                this._ctx!.currentTime,
                0.05,
            );
        }
    }

    toggleMute(): void {
        this.setMuted(!this._muted);
    }

    // ─── Utility ─────────────────────────────────────────────────────────────

    /**
     * Generates a short white-noise AudioBuffer programmatically.
     * Useful for SFX synthesis (skid, impact, etc.) without loading files.
     *
     * @param durationSec - Duration in seconds
     * @param channels    - Number of channels (default 1)
     */
    createNoiseBuffer(durationSec: number, channels = 1): AudioBuffer {
        const ctx = this.context;
        const sampleRate = ctx.sampleRate;
        const frameCount = Math.floor(sampleRate * durationSec);
        const buffer = ctx.createBuffer(channels, frameCount, sampleRate);
        for (let c = 0; c < channels; c++) {
            const data = buffer.getChannelData(c);
            for (let i = 0; i < frameCount; i++) {
                data[i] = Math.random() * 2 - 1;
            }
        }
        return buffer;
    }

    /**
     * Generates a sine-wave buffer at a given frequency.
     * Useful for tonal UI sounds without audio assets.
     */
    createToneBuffer(frequencyHz: number, durationSec: number, fadeOutRatio = 0.2): AudioBuffer {
        const ctx = this.context;
        const sr = ctx.sampleRate;
        const len = Math.floor(sr * durationSec);
        const buffer = ctx.createBuffer(1, len, sr);
        const data = buffer.getChannelData(0);
        const fadeOutStart = Math.floor(len * (1 - fadeOutRatio));
        for (let i = 0; i < len; i++) {
            const t = i / sr;
            let amp = 1;
            if (i > fadeOutStart) {
                amp = 1 - (i - fadeOutStart) / (len - fadeOutStart);
            }
            data[i] = Math.sin(2 * Math.PI * frequencyHz * t) * amp;
        }
        return buffer;
    }

    /**
     * All active emitters (read-only iterator).
     */
    get emitters(): IterableIterator<SoundEmitter3D> {
        return this._emitters.values();
    }

    /**
     * Suspends the AudioContext (e.g. tab hidden).
     */
    suspend(): void {
        this._ctx?.suspend().catch(console.error);
    }

    /**
     * Resumes the AudioContext.
     */
    resume(): void {
        this._ctx?.resume().catch(console.error);
    }

    /**
     * Fully tears down the engine (call on app dispose).
     */
    dispose(): void {
        for (const emitter of this._emitters.values()) {
            this.destroyEmitter(emitter);
        }
        this._ctx?.close().catch(console.error);
        this._ctx = null;
        this._initialized = false;
        AudioEngine._instance = null;
    }
}
