/**
 * @fileoverview LIFE Engine — Decoupled Game Loop Manager
 *
 * Implements a fixed-timestep accumulator pattern that guarantees deterministic
 * physics at exactly 60 Hz regardless of render frame rate.
 *
 * Architecture:
 * ─────────────
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  useFrame(frameDelta)                                    │
 *   │  ┌─────────────────────────────────────────────────────┐ │
 *   │  │  accumulator += clamp(frameDelta, 0, MAX_DELTA)     │ │
 *   │  │  while (accumulator >= FIXED_DT):                   │ │
 *   │  │    snapshotTransforms()                             │ │
 *   │  │    FixedUpdate(FIXED_DT)  ← Physics + Logic        │ │
 *   │  │    accumulator -= FIXED_DT                          │ │
 *   │  │  alpha = accumulator / FIXED_DT                     │ │
 *   │  │  LateUpdate(alpha)        ← Visual interpolation    │ │
 *   │  │  tempPools.resetFrame()   ← Stack allocator reset   │ │
 *   │  └─────────────────────────────────────────────────────┘ │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Key Properties:
 * ───────────────
 * - Deterministic: Physics always advances by exactly FIXED_DT (1/60s).
 * - Anti-spiral: Frame delta clamped to MAX_FRAME_DELTA (250ms) to prevent
 *   cascading catch-up iterations after tab-switch / debugger pauses.
 * - Smooth rendering: LateUpdate interpolates visuals between physics states
 *   using alpha ratio, producing sub-frame smooth motion.
 * - Time-slicing: AI ticks are distributed across frames to flatten CPU load.
 *
 * @module LoopManager
 */

import { FIXED_DT, MAX_FRAME_DELTA, COMPONENT_STRIDES, ComponentFlag } from './types';
import { ECSWorld, type Archetype } from './ECSSetup';
import {
    tempVec3Pool,
    tempQuatPool,
    tempMat4Pool,
    lerpVec3,
    slerpQuat,
} from './MemoryPools';

// ─────────────────────────────────────────────────────────────────────────────
// Phase Callbacks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Callback invoked during FixedUpdate phase.
 * @param dt - Always FIXED_DT (1/60s). Deterministic.
 */
export type FixedUpdateFn = (dt: number) => void;

/**
 * Callback invoked during LateUpdate phase.
 * @param alpha - Interpolation ratio [0, 1) between two physics states.
 */
export type LateUpdateFn = (alpha: number) => void;

/** Callback invoked once per render frame (after LateUpdate). */
export type FrameUpdateFn = (dt: number) => void;

// ─────────────────────────────────────────────────────────────────────────────
// Time Slicer — Budget-limited AI ticks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Distributes entity processing across multiple frames to flatten CPU peaks.
 *
 * Design rationale:
 * ─────────────────
 * AI pathfinding / decision-making is expensive. Running ALL AI entities
 * every frame would create massive spikes. Instead, we process N entities
 * per frame in round-robin order, where N = total / spread.
 *
 * Example: 1000 AI entities, spread = 10 → 100 entities tick per frame.
 * Each entity ticks once every 10 frames (~6 Hz at 60fps).
 *
 * The time slicer also supports a hard budget limit: if processing
 * exceeds `maxBudgetMs`, remaining entities are deferred to next frame.
 */
export class TimeSlicedProcessor {
    /** Next entity index to process (round-robin cursor). */
    private cursor: number = 0;
    /** Max milliseconds allowed per frame for this processor. */
    private readonly maxBudgetMs: number;
    /** How many frames it takes to cycle through all entities. */
    private readonly spreadFrames: number;

    /**
     * @param spreadFrames - Number of frames to spread the full entity set over.
     * @param maxBudgetMs  - Hard time budget per frame in ms (default: 2ms).
     */
    constructor(spreadFrames: number = 10, maxBudgetMs: number = 2.0) {
        this.spreadFrames = spreadFrames;
        this.maxBudgetMs = maxBudgetMs;
    }

    /**
     * Process a slice of entities this frame.
     *
     * @param entities - Full array of entity IDs to process
     * @param callback - Function to call for each entity in this frame's slice
     *
     * Complexity: O(N / spreadFrames) per frame, amortized O(N) per full cycle.
     */
    processSlice(entities: readonly number[], callback: (entityId: number) => void): void {
        if (entities.length === 0) return;

        const sliceSize = Math.max(1, Math.ceil(entities.length / this.spreadFrames));
        const startTime = performance.now();
        let processed = 0;

        for (let i = 0; i < sliceSize; i++) {
            const idx = (this.cursor + i) % entities.length;
            callback(entities[idx]);
            processed++;

            // Budget check every 8 entities (avoid calling performance.now too often)
            if ((processed & 7) === 0) {
                if (performance.now() - startTime > this.maxBudgetMs) break;
            }
        }

        this.cursor = (this.cursor + processed) % entities.length;
    }

    /** Reset cursor (e.g., when entity set changes significantly). */
    resetCursor(): void {
        this.cursor = 0;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Transform Interpolation (LateUpdate phase)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Interpolate transform visuals between previous and current physics state.
 *
 * This is critical for smooth rendering: without interpolation, objects
 * visually "jump" between 60Hz physics ticks, producing micro-stutter
 * especially at high refresh rates (120/144 Hz monitors).
 *
 * The interpolation ratio `alpha` represents how far into the next
 * physics step we are:
 *   visual_pos = lerp(prev_pos, curr_pos, alpha)
 *   visual_rot = slerp(prev_rot, curr_rot, alpha)
 *
 * @param world - ECS world with current + previous transform data
 * @param alpha - Interpolation factor [0, 1)
 * @param outputPositions - Buffer to write interpolated positions (3 floats per entity)
 * @param outputRotations - Buffer to write interpolated rotations (4 floats per entity)
 */
export function interpolateTransforms(
    world: ECSWorld,
    alpha: number,
    outputPositions: Float32Array,
    outputRotations: Float32Array,
): void {
    const archetypes = world.archetypeRegistry.query(ComponentFlag.Transform);
    const curr = world.stores.transform;
    const prev = world.prevTransform;
    const tStride = COMPONENT_STRIDES.Transform;

    // Acquire temp buffers from frame pool (auto-reset at end of frame)
    const prevPos = tempVec3Pool.acquire();
    const currPos = tempVec3Pool.acquire();
    const prevRot = tempQuatPool.acquire();
    const currRot = tempQuatPool.acquire();

    for (let a = 0; a < archetypes.length; a++) {
        const entities = archetypes[a].entities;
        for (let i = 0; i < entities.length; i++) {
            const e = entities[i] as number;

            // Read previous frame pos/rot from snapshot
            const pOff = e * 7;
            prevPos[0] = prev[pOff];
            prevPos[1] = prev[pOff + 1];
            prevPos[2] = prev[pOff + 2];
            prevRot[0] = prev[pOff + 3];
            prevRot[1] = prev[pOff + 4];
            prevRot[2] = prev[pOff + 5];
            prevRot[3] = prev[pOff + 6];

            // Read current pos/rot from live store
            const cOff = e * tStride;
            currPos[0] = curr[cOff];
            currPos[1] = curr[cOff + 1];
            currPos[2] = curr[cOff + 2];
            currRot[0] = curr[cOff + 3];
            currRot[1] = curr[cOff + 4];
            currRot[2] = curr[cOff + 5];
            currRot[3] = curr[cOff + 6];

            // Interpolate
            const outPos = outputPositions.subarray(e * 3, e * 3 + 3);
            const outRot = outputRotations.subarray(e * 4, e * 4 + 4);
            lerpVec3(outPos, prevPos, currPos, alpha);
            slerpQuat(outRot, prevRot, currRot, alpha);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Loop Manager
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Core game loop manager implementing a fixed-timestep accumulator.
 *
 * How it works:
 * ─────────────
 * 1. Each frame, the raw delta from `useFrame` is clamped to MAX_FRAME_DELTA
 *    and added to the accumulator.
 * 2. While the accumulator >= FIXED_DT, we:
 *    a. Snapshot current transforms (for interpolation)
 *    b. Run ALL FixedUpdate callbacks (physics, logic, ECS systems)
 *    c. Subtract FIXED_DT from accumulator
 * 3. Compute `alpha = accumulator / FIXED_DT` for interpolation.
 * 4. Run ALL LateUpdate callbacks with this alpha.
 * 5. Run ALL FrameUpdate callbacks.
 * 6. Reset temp pools.
 *
 * Why fixed timestep?
 * ───────────────────
 * Variable dt causes non-deterministic physics: objects can "tunnel" through
 * walls on slow frames, or simulation diverges from replay. Fixed dt at 60Hz
 * guarantees consistent behavior regardless of rendering speed.
 */
export class LoopManager {
    /** Time accumulator for fixed-step simulation. */
    private accumulator: number = 0;

    /** Callbacks for each phase. */
    private fixedCallbacks: FixedUpdateFn[] = [];
    private lateCallbacks: LateUpdateFn[] = [];
    private frameCallbacks: FrameUpdateFn[] = [];

    /** Performance metrics. */
    private _fixedStepsThisFrame: number = 0;
    private _totalFixedSteps: number = 0;
    private _frameCount: number = 0;

    /** Reference to ECS world for transform snapshotting. */
    private world: ECSWorld | null = null;

    /** Interpolation output buffers (pre-allocated). */
    readonly interpolatedPositions: Float32Array;
    readonly interpolatedRotations: Float32Array;

    /** Whether the loop is paused. */
    private paused: boolean = false;

    constructor() {
        // Pre-allocate interpolation buffers using MAX_ENTITIES from types
        // Importing at module level to keep the constant synchronized
        const MAX_ENTITIES = 65_536;
        this.interpolatedPositions = new Float32Array(MAX_ENTITIES * 3);
        this.interpolatedRotations = new Float32Array(MAX_ENTITIES * 4);
    }

    /** Bind the ECS world. Must be called before first tick. */
    setWorld(world: ECSWorld): void {
        this.world = world;
    }

    // ─── Phase Registration ──────────────────────────────────────────────────

    /** Register a callback for FixedUpdate (physics/logic, 60Hz). */
    addFixedUpdate(fn: FixedUpdateFn): void {
        this.fixedCallbacks.push(fn);
    }

    /** Register a callback for LateUpdate (visual interpolation). */
    addLateUpdate(fn: LateUpdateFn): void {
        this.lateCallbacks.push(fn);
    }

    /** Register a callback for per-frame update (rendering prep). */
    addFrameUpdate(fn: FrameUpdateFn): void {
        this.frameCallbacks.push(fn);
    }

    /** Remove a fixed update callback. */
    removeFixedUpdate(fn: FixedUpdateFn): void {
        this.fixedCallbacks = this.fixedCallbacks.filter(cb => cb !== fn);
    }

    /** Remove a late update callback. */
    removeLateUpdate(fn: LateUpdateFn): void {
        this.lateCallbacks = this.lateCallbacks.filter(cb => cb !== fn);
    }

    /** Remove a frame update callback. */
    removeFrameUpdate(fn: FrameUpdateFn): void {
        this.frameCallbacks = this.frameCallbacks.filter(cb => cb !== fn);
    }

    // ─── Main Tick ───────────────────────────────────────────────────────────

    /**
     * Main tick — called from R3F `useFrame(state, delta)`.
     *
     * @param rawDelta - Frame delta in seconds (from requestAnimationFrame)
     */
    tick(rawDelta: number): void {
        if (this.paused) return;

        this._frameCount++;

        // Clamp delta to prevent spiral-of-death after tab switches / debugger pauses.
        // Without this, the accumulator could spike to seconds, causing hundreds of
        // FixedUpdate iterations in a single frame.
        const delta = Math.min(rawDelta, MAX_FRAME_DELTA);
        this.accumulator += delta;
        this._fixedStepsThisFrame = 0;

        // ── Fixed Update Phase (deterministic 60 Hz) ───────────────────────────
        while (this.accumulator >= FIXED_DT) {
            // Snapshot transforms BEFORE physics step for interpolation
            if (this.world) {
                this.world.snapshotTransforms();
            }

            // Execute all fixed-step systems
            for (let i = 0; i < this.fixedCallbacks.length; i++) {
                this.fixedCallbacks[i](FIXED_DT);
            }

            // Also run the ECS system manager's fixed systems
            if (this.world) {
                this.world.systemManager.executeFixed(this.world, FIXED_DT);
            }

            this.accumulator -= FIXED_DT;
            this._fixedStepsThisFrame++;
            this._totalFixedSteps++;
        }

        // ── Late Update Phase (visual interpolation) ───────────────────────────
        const alpha = this.accumulator / FIXED_DT;

        if (this.world) {
            interpolateTransforms(
                this.world,
                alpha,
                this.interpolatedPositions,
                this.interpolatedRotations,
            );
        }

        for (let i = 0; i < this.lateCallbacks.length; i++) {
            this.lateCallbacks[i](alpha);
        }

        // ── Frame Update Phase (per-frame, variable dt) ────────────────────────
        for (let i = 0; i < this.frameCallbacks.length; i++) {
            this.frameCallbacks[i](delta);
        }

        // Also run the ECS system manager's per-frame systems
        if (this.world) {
            this.world.systemManager.executeFrame(this.world, delta);
        }

        // ── Cleanup ────────────────────────────────────────────────────────────
        // Reset frame-scoped temp pools — all acquire() results become invalid
        tempVec3Pool.resetFrame();
        tempQuatPool.resetFrame();
        tempMat4Pool.resetFrame();
    }

    // ─── Control ─────────────────────────────────────────────────────────────

    pause(): void {
        this.paused = true;
    }

    resume(): void {
        this.paused = false;
        // Reset accumulator on resume to avoid catch-up burst
        this.accumulator = 0;
    }

    isPaused(): boolean {
        return this.paused;
    }

    // ─── Metrics ─────────────────────────────────────────────────────────────

    /** Number of FixedUpdate iterations in the most recent frame. Usually 1. */
    get fixedStepsThisFrame(): number {
        return this._fixedStepsThisFrame;
    }

    /** Total fixed steps since engine start. */
    get totalFixedSteps(): number {
        return this._totalFixedSteps;
    }

    /** Total render frames since engine start. */
    get frameCount(): number {
        return this._frameCount;
    }

    /** Current interpolation alpha (for debug). */
    get currentAlpha(): number {
        return this.accumulator / FIXED_DT;
    }
}
