/**
 * @fileoverview LIFE Engine — MusicController
 *
 * Adaptive music system based on an Intensity Level (0–100%).
 * Uses vertical layering (stems) synchronized sample-accurately.
 *
 * States & stems (all procedurally synthesized — no audio files needed):
 *   EXPLORE (0–20%)  : Pad + Ambient texture
 *   TENSION (20–50%) : + Bassline + Hi-Hats
 *   ACTION  (50–80%) : + Drums + Lead Synth
 *   CLIMAX  (80–100%): + Distortion layer + Orchestral hits
 *
 * Architecture:
 *   Each stem is an `AudioBufferSourceNode` (looping, pre-synthesized).
 *   Stems share a common `startTime` quantized to the next measure boundary.
 *   State transitions trigger a crossfade + auto-LowPass sweep.
 *
 * Usage:
 *   const music = MusicController.getInstance(engine);
 *   music.start();
 *   music.setIntensity(0.65);  // 0.0–1.0 → state machine selects active stems
 *   music.setBPM(90);
 */

import { AudioEngine } from './AudioEngine';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type MusicState = 'EXPLORE' | 'TENSION' | 'ACTION' | 'CLIMAX';

interface StemLayer {
    name: string;
    /** Synthesized audio data. */
    buffer: AudioBuffer | null;
    /** Active looping node. */
    node: AudioBufferSourceNode | null;
    /** Per-stem gain (for crossfade). */
    gainNode: GainNode | null;
    /** LowPass filter for beat-sync sweep. */
    filterNode: BiquadFilterNode | null;
    /** Whether this stem is currently active. */
    active: boolean;
}

/** Intensity thresholds → state mapping. */
const STATE_THRESHOLDS: { state: MusicState; min: number; max: number }[] = [
    { state: 'EXPLORE', min: 0, max: 0.2 },
    { state: 'TENSION', min: 0.2, max: 0.5 },
    { state: 'ACTION', min: 0.5, max: 0.8 },
    { state: 'CLIMAX', min: 0.8, max: 1.01 },
];

/** Stems active per state (cumulative layering). */
const STATE_STEMS: Record<MusicState, string[]> = {
    EXPLORE: ['pad', 'ambient'],
    TENSION: ['pad', 'ambient', 'bassline', 'hihats'],
    ACTION: ['pad', 'ambient', 'bassline', 'hihats', 'drums', 'lead'],
    CLIMAX: ['pad', 'ambient', 'bassline', 'hihats', 'drums', 'lead', 'distortion', 'orchestral'],
};

// ─────────────────────────────────────────────────────────────────────────────
// DSP helpers (pure synthesis — no file I/O)
// ─────────────────────────────────────────────────────────────────────────────

type SynthFn = (ctx: AudioContext, measures: number, bpm: number) => AudioBuffer;

/** Low-frequency sawtooth pad (ambient drone). */
const synthPad: SynthFn = (ctx, measures, bpm) => {
    const sr = ctx.sampleRate;
    const secPerBeat = 60 / bpm;
    const secPerMeasure = secPerBeat * 4;
    const len = Math.floor(sr * secPerMeasure * measures);
    const buf = ctx.createBuffer(2, len, sr);
    const freqs = [55, 82.4, 110]; // A1, E2, A2
    for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
            const t = i / sr;
            let s = 0;
            for (const f of freqs) {
                s += (((t * f) % 1) * 2 - 1) * 0.15; // sawtooth
            }
            // Slow tremolo
            s *= 0.6 + 0.4 * Math.sin(2 * Math.PI * 0.25 * t);
            d[i] = s;
        }
    }
    return buf;
};

/** Subtle high-shelf filtered noise for ambient texture. */
const synthAmbient: SynthFn = (ctx, measures, bpm) => {
    const sr = ctx.sampleRate;
    const secPerMeasure = (60 / bpm) * 4;
    const len = Math.floor(sr * secPerMeasure * measures);
    const buf = ctx.createBuffer(2, len, sr);
    const lpCoeff = Math.exp(-2 * Math.PI * 300 / sr); // simple 1-pole LP at 300 Hz
    for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let prev = 0;
        for (let i = 0; i < len; i++) {
            const noise = (Math.random() * 2 - 1) * 0.04;
            prev = prev * lpCoeff + noise * (1 - lpCoeff);
            d[i] = prev;
        }
    }
    return buf;
};

/** Pulsing square-wave bassline following BPM. */
const synthBassline: SynthFn = (ctx, measures, bpm) => {
    const sr = ctx.sampleRate;
    const secPerBeat = 60 / bpm;
    const len = Math.floor(sr * secPerBeat * 4 * measures);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const pattern = [1, 0, 0, 1, 0, 1, 0, 0]; // 8th-note pattern
    const freq = 55; // A1
    const noteDur = sr * secPerBeat * 0.4; // 40% duty
    for (let i = 0; i < len; i++) {
        const beat8 = Math.floor((i / sr) / (secPerBeat / 2)) % pattern.length;
        if (pattern[beat8]) {
            const phase = (i / sr * freq) % 1;
            const sq = phase < 0.5 ? 0.3 : -0.3;
            const notePos = (i % Math.floor(sr * secPerBeat / 2));
            const env = notePos < noteDur ? 1 : Math.max(0, 1 - (notePos - noteDur) / (sr * 0.05));
            d[i] = sq * env;
        }
    }
    return buf;
};

/** Sparse hi-hats (filtered white noise bursts). */
const synthHihats: SynthFn = (ctx, measures, bpm) => {
    const sr = ctx.sampleRate;
    const secPerBeat = 60 / bpm;
    const len = Math.floor(sr * secPerBeat * 4 * measures);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const pattern = [0, 0, 1, 0, 0, 0, 1, 0]; // 2nd and 6th 8ths
    const hitLen = Math.floor(sr * 0.015);
    for (let i = 0; i < len; i++) {
        const beat8 = Math.floor((i / sr) / (secPerBeat / 2)) % pattern.length;
        const posInBeat = i % Math.floor(sr * secPerBeat / 2);
        if (pattern[beat8] && posInBeat < hitLen) {
            const env = 1 - posInBeat / hitLen;
            d[i] = (Math.random() * 2 - 1) * 0.25 * env;
        }
    }
    return buf;
};

/** Full drum kit: kick (sine+decay) + snare (noise+decay). */
const synthDrums: SynthFn = (ctx, measures, bpm) => {
    const sr = ctx.sampleRate;
    const secPerBeat = 60 / bpm;
    const len = Math.floor(sr * secPerBeat * 4 * measures);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const beatSamples = Math.floor(sr * secPerBeat);
    for (let beat = 0; beat < measures * 4; beat++) {
        const beatStart = beat * beatSamples;
        const isSnare = beat % 4 === 1 || beat % 4 === 3;
        const isKick = beat % 4 === 0 || (beat % 8 === 6);
        const hitLen = Math.floor(sr * 0.08);
        if (isKick) {
            for (let j = 0; j < hitLen && beatStart + j < len; j++) {
                const env = Math.exp(-j / (sr * 0.04));
                const freq = 80 * Math.exp(-j / (sr * 0.02));
                d[beatStart + j] += Math.sin(2 * Math.PI * freq * j / sr) * 0.5 * env;
            }
        }
        if (isSnare) {
            const snareLen = Math.floor(sr * 0.06);
            for (let j = 0; j < snareLen && beatStart + j < len; j++) {
                const env = Math.exp(-j / (sr * 0.03));
                d[beatStart + j] += (Math.random() * 2 - 1) * 0.4 * env;
            }
        }
    }
    return buf;
};

/** Lead synth: pentatonic arpeggio. */
const synthLead: SynthFn = (ctx, measures, bpm) => {
    const sr = ctx.sampleRate;
    const secPerBeat = 60 / bpm;
    const len = Math.floor(sr * secPerBeat * 4 * measures);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const notes = [220, 261.6, 329.6, 392, 440]; // A3 pentatonic
    const noteDurSample = Math.floor(sr * secPerBeat * 0.5);
    const totalNotes = Math.ceil(len / noteDurSample);
    for (let n = 0; n < totalNotes; n++) {
        const freq = notes[n % notes.length];
        for (let j = 0; j < noteDurSample; j++) {
            const idx = n * noteDurSample + j;
            if (idx >= len) break;
            const env = j < noteDurSample * 0.1
                ? j / (noteDurSample * 0.1)
                : Math.exp(-(j - noteDurSample * 0.1) / (sr * 0.15));
            d[idx] += Math.sin(2 * Math.PI * freq * j / sr) * 0.2 * env;
        }
    }
    return buf;
};

/** Distortion: clipped noise band for climax tension. */
const synthDistortion: SynthFn = (ctx, measures, bpm) => {
    const sr = ctx.sampleRate;
    const secPerMeasure = (60 / bpm) * 4;
    const len = Math.floor(sr * secPerMeasure * measures);
    const buf = ctx.createBuffer(2, len, sr);
    const hpCoeff = Math.exp(-2 * Math.PI * 2000 / sr);
    for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let prev = 0;
        for (let i = 0; i < len; i++) {
            const noise = Math.random() * 2 - 1;
            prev = prev * hpCoeff + noise * (1 - hpCoeff); // HP filter
            // Soft clip
            d[i] = Math.tanh(prev * 4) * 0.15;
        }
    }
    return buf;
};

/** Orchestral hits: short attack sine chords on beat 1. */
const synthOrchestral: SynthFn = (ctx, measures, bpm) => {
    const sr = ctx.sampleRate;
    const secPerBeat = 60 / bpm;
    const len = Math.floor(sr * secPerBeat * 4 * measures);
    const buf = ctx.createBuffer(2, len, sr);
    const beatSamples = Math.floor(sr * secPerBeat * 4); // every measure
    const hitLen = Math.floor(sr * 0.5);
    const chordFreqs = [110, 138.6, 165]; // Am chord
    for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let m = 0; m < measures; m++) {
            const start = m * beatSamples;
            for (let j = 0; j < hitLen && start + j < len; j++) {
                const env = Math.exp(-j / (sr * 0.35));
                for (const f of chordFreqs) {
                    d[start + j] += Math.sin(2 * Math.PI * f * j / sr) * 0.12 * env;
                }
            }
        }
    }
    return buf;
};

const STEM_SYNTH: Record<string, SynthFn> = {
    pad: synthPad,
    ambient: synthAmbient,
    bassline: synthBassline,
    hihats: synthHihats,
    drums: synthDrums,
    lead: synthLead,
    distortion: synthDistortion,
    orchestral: synthOrchestral,
};

// ─────────────────────────────────────────────────────────────────────────────
// MusicController
// ─────────────────────────────────────────────────────────────────────────────

export class MusicController {
    private static _instance: MusicController | null = null;

    private _engine: AudioEngine;
    private _stems: Map<string, StemLayer> = new Map();
    private _currentState: MusicState = 'EXPLORE';
    private _intensity = 0;
    private _bpm = 90;
    private _measures = 4; // Buffer loop length in measures
    private _started = false;
    private _masterMusicGain: GainNode | null = null;

    static getInstance(engine?: AudioEngine): MusicController {
        if (!MusicController._instance) {
            if (!engine) throw new Error('[MusicController] Pass AudioEngine on first call.');
            MusicController._instance = new MusicController(engine);
        }
        return MusicController._instance;
    }

    private constructor(engine: AudioEngine) {
        this._engine = engine;
    }

    // ─── Init & Synthesis ─────────────────────────────────────────────────────

    /**
     * Pre-synthesizes all stem buffers.
     * Call once before `start()`. Can be offloaded to a worker in production.
     */
    async synthesizeStems(): Promise<void> {
        const ctx = this._engine.context;
        this._masterMusicGain = ctx.createGain();
        this._masterMusicGain.gain.value = 0.7;
        this._masterMusicGain.connect(this._engine.masterGain);

        for (const [name, synthFn] of Object.entries(STEM_SYNTH)) {
            const gainNode = ctx.createGain();
            gainNode.gain.value = 0; // start silent; activated by state machine
            gainNode.connect(this._masterMusicGain);

            const filterNode = ctx.createBiquadFilter();
            filterNode.type = 'lowpass';
            filterNode.frequency.value = 20_000;
            filterNode.Q.value = 0.5;
            filterNode.connect(gainNode);

            const buffer = synthFn(ctx, this._measures, this._bpm);

            this._stems.set(name, {
                name,
                buffer,
                node: null,
                gainNode,
                filterNode,
                active: false,
            });
        }
        console.info('[MusicController] All stems synthesized.');
    }

    // ─── Start / Stop ─────────────────────────────────────────────────────────

    /**
     * Schedules all stems to start at the next measure boundary.
     * They loop in sync forever.
     */
    start(): void {
        if (this._started) return;
        if (this._stems.size === 0) {
            console.warn('[MusicController] Call synthesizeStems() before start().');
            return;
        }
        const ctx = this._engine.context;
        const startTime = this._nextMeasureTime();

        for (const stem of this._stems.values()) {
            if (!stem.buffer || !stem.filterNode) continue;
            const node = ctx.createBufferSource();
            node.buffer = stem.buffer;
            node.loop = true;
            node.connect(stem.filterNode);
            node.start(startTime);
            stem.node = node;
        }

        this._started = true;
        this._applyState('EXPLORE', true); // Start silent except EXPLORE stems
        console.info('[MusicController] Started. BPM:', this._bpm);
    }

    stop(): void {
        for (const stem of this._stems.values()) {
            try { stem.node?.stop(); } catch { /* already stopped */ }
            stem.node = null;
            stem.active = false;
        }
        this._started = false;
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    /**
     * Sets the global intensity [0.0–1.0].
     * Triggers a state transition if the intensity crosses a threshold.
     */
    setIntensity(value: number): void {
        this._intensity = Math.max(0, Math.min(1, value));
        const newState = this._resolveState(this._intensity);
        if (newState !== this._currentState) {
            this._applyState(newState, false);
        }
    }

    getIntensity(): number { return this._intensity; }
    getCurrentState(): MusicState { return this._currentState; }

    /** Force a specific state regardless of intensity. */
    forceState(state: MusicState): void {
        this._applyState(state, false);
    }

    setBPM(bpm: number): void {
        this._bpm = Math.max(40, Math.min(200, bpm));
        // Note: buffer must be re-synthesized to take effect.
    }

    // ─── State Machine ────────────────────────────────────────────────────────

    private _resolveState(intensity: number): MusicState {
        for (const entry of STATE_THRESHOLDS) {
            if (intensity >= entry.min && intensity < entry.max) return entry.state;
        }
        return 'CLIMAX';
    }

    private _applyState(state: MusicState, instant: boolean): void {
        this._currentState = state;
        const activeStemNames = new Set(STATE_STEMS[state]);
        const ctx = this._engine.context;
        const t = this._nextMeasureTime();
        const fadeDuration = instant ? 0 : 2.0; // 2-second fade on beats

        for (const [name, stem] of this._stems.entries()) {
            const shouldBeActive = activeStemNames.has(name);
            if (!stem.gainNode || !stem.filterNode) continue;

            if (shouldBeActive && !stem.active) {
                // Fade in: start with LowPass sweep then open filter
                stem.filterNode.frequency.setValueAtTime(200, t);
                stem.filterNode.frequency.exponentialRampToValueAtTime(20_000, t + fadeDuration);
                stem.gainNode.gain.setValueAtTime(0, t);
                stem.gainNode.gain.linearRampToValueAtTime(this._stemVolume(name), t + fadeDuration);
                stem.active = true;
            } else if (!shouldBeActive && stem.active) {
                // Fade out: close LowPass then zero gain
                stem.filterNode.frequency.setValueAtTime(20_000, t);
                stem.filterNode.frequency.exponentialRampToValueAtTime(200, t + fadeDuration * 0.5);
                stem.gainNode.gain.setValueAtTime(stem.gainNode.gain.value, t);
                stem.gainNode.gain.linearRampToValueAtTime(0, t + fadeDuration);
                stem.active = false;
            }
        }

        console.info(`[MusicController] State → ${state} (intensity: ${(this._intensity * 100).toFixed(0)}%)`);
    }

    /** Volume target per stem (mix balance). */
    private _stemVolume(name: string): number {
        const volumes: Record<string, number> = {
            pad: 0.5,
            ambient: 0.3,
            bassline: 0.65,
            hihats: 0.4,
            drums: 0.7,
            lead: 0.55,
            distortion: 0.35,
            orchestral: 0.6,
        };
        return volumes[name] ?? 0.5;
    }

    // ─── Beat Scheduling Helpers ─────────────────────────────────────────────

    /**
     * Returns the AudioContext time of the start of the next measure.
     * Quantizes to a 4/4 measure grid to keep stems in sync on transitions.
     */
    private _nextMeasureTime(): number {
        const ctx = this._engine.context;
        const now = ctx.currentTime;
        const secPerMeasure = (60 / this._bpm) * 4;
        // How far into the current measure are we?
        const posInMeasure = now % secPerMeasure;
        const timeToNext = secPerMeasure - posInMeasure;
        // If we're very close to the boundary, skip to the next one
        return now + (timeToNext < 0.05 ? timeToNext + secPerMeasure : timeToNext);
    }

    // ─── Dispose ─────────────────────────────────────────────────────────────

    dispose(): void {
        this.stop();
        this._masterMusicGain?.disconnect();
        this._stems.clear();
        MusicController._instance = null;
    }
}
