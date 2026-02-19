/**
 * @fileoverview LIFE Engine — Memory Pools & Zero-Allocation Utilities
 *
 * The Garbage Collector is the #1 enemy of consistent 60fps in browsers.
 * Every `new Object()` / `new Float32Array()` creates heap pressure that
 * eventually triggers GC pauses of 2-16ms — destroying frame budgets.
 *
 * This module provides:
 * ─────────────────────
 * 1. Generic ObjectPool<T> — pre-allocates typed objects at startup.
 * 2. TempVec3Pool / TempQuatPool — frame-scoped stack allocators for
 *    intermediate math (no `new Vector3()` in hot loops).
 * 3. PoolDebugger — tracks high-water marks for tuning pool sizes.
 *
 * All pools use "Warmup" pattern: allocate at init, reuse at runtime.
 * Entities use soft-delete via alive bitmask in ECSWorld (see ECSSetup.ts).
 *
 * @module MemoryPools
 */

// ─────────────────────────────────────────────────────────────────────────────
// Generic Object Pool
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Factory function type for creating pool objects.
 * Called only during warmup — NEVER at runtime.
 */
type PoolFactory<T> = () => T;

/**
 * Reset function type — called when an object is returned to the pool.
 * Should zero/reset all mutable state to prevent data leaks.
 */
type PoolResetter<T> = (obj: T) => void;

/**
 * Generic typed object pool with O(1) acquire/release.
 *
 * Memory pattern:
 *   - Pool is backed by a fixed-size array (no dynamic resizing)
 *   - `acquire()` pops from the tail — O(1)
 *   - `release()` pushes to the tail after resetting — O(1)
 *   - If pool is exhausted, a warning is logged and a new object is created
 *     (but this means the pool was undersized — tune initial capacity!)
 *
 * @typeParam T - Type of pooled objects
 */
export class ObjectPool<T> {
    private readonly pool: T[];
    private top: number;
    private readonly factory: PoolFactory<T>;
    private readonly resetter: PoolResetter<T>;
    readonly capacity: number;

    /** Debug tracking */
    private _acquireCount = 0;
    private _highWater = 0;
    private _overflowCount = 0;

    /**
     * @param capacity - Number of objects to pre-allocate
     * @param factory  - Creates a new instance (called `capacity` times at init)
     * @param resetter - Resets an instance before returning to pool
     */
    constructor(capacity: number, factory: PoolFactory<T>, resetter: PoolResetter<T>) {
        this.capacity = capacity;
        this.factory = factory;
        this.resetter = resetter;
        this.pool = new Array<T>(capacity);
        this.top = capacity;

        // Warmup: pre-allocate all objects
        for (let i = 0; i < capacity; i++) {
            this.pool[i] = factory();
        }
    }

    /**
     * Acquire an object from the pool. O(1).
     *
     * If pool is empty, creates a new overflow object (triggers GC warning).
     * This should NEVER happen in production — increase pool capacity.
     */
    acquire(): T {
        this._acquireCount++;
        const inUse = this.capacity - this.top + 1;
        if (inUse > this._highWater) this._highWater = inUse;

        if (this.top > 0) {
            return this.pool[--this.top];
        }

        // Overflow — pool too small!
        this._overflowCount++;
        if (this._overflowCount <= 5) {
            console.warn(
                `[ObjectPool] OVERFLOW! Pool exhausted (capacity=${this.capacity}). ` +
                `Creating heap object — THIS CAUSES GC PRESSURE. Increase pool size.`
            );
        }
        return this.factory();
    }

    /**
     * Return an object to the pool after use. O(1).
     * The resetter clears all mutable state.
     */
    release(obj: T): void {
        this.resetter(obj);
        if (this.top < this.capacity) {
            this.pool[this.top++] = obj;
        }
        // If top >= capacity, the pool is full — object is dropped (GC collects it).
        // This can happen if release() is called more than acquire() due to a bug.
    }

    /** Number of objects currently available in the pool. */
    get available(): number {
        return this.top;
    }

    /** Number of objects currently in use (loaned out). */
    get inUse(): number {
        return this.capacity - this.top;
    }

    /** Debug stats for the pool debugger UI. */
    getStats(): PoolStats {
        return {
            capacity: this.capacity,
            available: this.top,
            inUse: this.capacity - this.top,
            highWater: this._highWater,
            totalAcquires: this._acquireCount,
            overflows: this._overflowCount,
        };
    }
}

export interface PoolStats {
    capacity: number;
    available: number;
    inUse: number;
    highWater: number;
    totalAcquires: number;
    overflows: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Temp Vector / Quaternion Pools (Frame-Scoped Stack Allocators)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Frame-scoped stack allocator for temporary Vec3 / Quat values.
 *
 * Design:
 * ───────
 * Instead of `new Vector3()` for every intermediate calculation,
 * we pre-allocate a flat Float32Array and hand out sub-views.
 *
 * Usage pattern:
 *   const v = tempVec3.acquire();  // O(1) — just advances pointer
 *   v[0] = 1; v[1] = 2; v[2] = 3;
 *   // ... use v for calculations ...
 *   tempVec3.resetFrame();         // Called once at end of frame
 *
 * The "stack" resets every frame — no per-object release() needed.
 * This is safe because temp values are NEVER stored across frames.
 *
 * Memory: 256 Vec3s × 12 bytes = 3 KB. Fits in L1 cache.
 */
export class TempTypedPool {
    private readonly buffer: Float32Array;
    private readonly stride: number;
    private readonly maxSlots: number;
    private cursor: number = 0;
    private _frameHighWater: number = 0;

    /**
     * @param stride   - Elements per slot (3 for Vec3, 4 for Quat)
     * @param maxSlots - Maximum simultaneous temp values per frame
     */
    constructor(stride: number, maxSlots: number = 256) {
        this.stride = stride;
        this.maxSlots = maxSlots;
        this.buffer = new Float32Array(stride * maxSlots);
    }

    /**
     * Acquire a temporary typed-array view. O(1).
     *
     * IMPORTANT: The returned sub-array is valid ONLY until `resetFrame()`.
     * Never store it in persistent state.
     *
     * @returns A Float32Array view of length `stride` into the backing buffer.
     */
    acquire(): Float32Array {
        if (this.cursor >= this.maxSlots) {
            console.warn(`[TempTypedPool] Frame budget exceeded! stride=${this.stride}, max=${this.maxSlots}`);
            // Still return a view — wraps around (will corrupt data, but won't crash)
            this.cursor = 0;
        }
        const offset = this.cursor * this.stride;
        this.cursor++;
        if (this.cursor > this._frameHighWater) this._frameHighWater = this.cursor;
        return this.buffer.subarray(offset, offset + this.stride);
    }

    /**
     * Reset the stack pointer to 0. O(1).
     * Called once at the END of each frame. All previous acquire() results
     * become invalid — they will be overwritten next frame.
     */
    resetFrame(): void {
        this.cursor = 0;
    }

    /** Peak usage across all frames (for pool sizing). */
    get highWater(): number {
        return this._frameHighWater;
    }

    /** Number of slots used this frame so far. */
    get usedThisFrame(): number {
        return this.cursor;
    }
}

/** Pre-instantiated Vec3 temp pool (256 slots × 3 floats = 3 KB). */
export const tempVec3Pool = new TempTypedPool(3, 256);

/** Pre-instantiated Quat temp pool (128 slots × 4 floats = 2 KB). */
export const tempQuatPool = new TempTypedPool(4, 128);

/** Pre-instantiated Mat4 temp pool (32 slots × 16 floats = 2 KB). */
export const tempMat4Pool = new TempTypedPool(16, 32);

// ─────────────────────────────────────────────────────────────────────────────
// Math Helpers (zero-allocation, operates on Float32Array views)
// ─────────────────────────────────────────────────────────────────────────────

/** Vec3 linear interpolation: out = a + (b - a) * t. O(1). */
export function lerpVec3(
    out: Float32Array, a: Float32Array, b: Float32Array, t: number,
): void {
    out[0] = a[0] + (b[0] - a[0]) * t;
    out[1] = a[1] + (b[1] - a[1]) * t;
    out[2] = a[2] + (b[2] - a[2]) * t;
}

/**
 * Quaternion SLERP: out = slerp(a, b, t). O(1).
 *
 * Spherical Linear Interpolation ensures smooth rotation transitions
 * at constant angular velocity — unlike NLERP which distorts at wide angles.
 *
 * Handles dot < 0 (shortest path) and degenerate cases (dot ≈ 1 → lerp).
 */
export function slerpQuat(
    out: Float32Array, a: Float32Array, b: Float32Array, t: number,
): void {
    let ax = a[0], ay = a[1], az = a[2], aw = a[3];
    let bx = b[0], by = b[1], bz = b[2], bw = b[3];

    let dot = ax * bx + ay * by + az * bz + aw * bw;

    // Take shortest path
    if (dot < 0) {
        dot = -dot;
        bx = -bx; by = -by; bz = -bz; bw = -bw;
    }

    let s0: number, s1: number;
    if (dot > 0.9999) {
        // Nearly identical — NLERP fallback (avoids division by ~0)
        s0 = 1.0 - t;
        s1 = t;
    } else {
        const omega = Math.acos(dot);
        const sinOmega = Math.sin(omega);
        s0 = Math.sin((1.0 - t) * omega) / sinOmega;
        s1 = Math.sin(t * omega) / sinOmega;
    }

    out[0] = s0 * ax + s1 * bx;
    out[1] = s0 * ay + s1 * by;
    out[2] = s0 * az + s1 * bz;
    out[3] = s0 * aw + s1 * bw;
}

/** Vec3 distance squared (avoids sqrt). O(1). */
export function distSqVec3(a: Float32Array, b: Float32Array): number {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const dz = a[2] - b[2];
    return dx * dx + dy * dy + dz * dz;
}

/** Vec3 dot product. O(1). */
export function dotVec3(a: Float32Array, b: Float32Array): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Vec3 normalize in-place. O(1). */
export function normalizeVec3(v: Float32Array): void {
    const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    if (len > 1e-8) {
        const inv = 1.0 / len;
        v[0] *= inv;
        v[1] *= inv;
        v[2] *= inv;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pool Debugger — Runtime Memory Monitor
// ─────────────────────────────────────────────────────────────────────────────

interface PoolRegistration {
    name: string;
    getStats: () => PoolStats | { usedThisFrame: number; highWater: number };
}

/**
 * Central registry for all pools — exposes debug data for an overlay UI.
 *
 * Usage:
 *   poolDebugger.register('bullets', bulletPool);
 *   poolDebugger.register('tempVec3', { getStats: () => ... });
 *
 * The debug overlay reads `poolDebugger.getReport()` every N frames
 * and renders a table of pool utilization.
 */
export class PoolDebugger {
    private static instance: PoolDebugger | null = null;
    private pools: PoolRegistration[] = [];

    static getInstance(): PoolDebugger {
        if (!PoolDebugger.instance) {
            PoolDebugger.instance = new PoolDebugger();
        }
        return PoolDebugger.instance;
    }

    /** Register an ObjectPool for monitoring. */
    registerObjectPool<T>(name: string, pool: ObjectPool<T>): void {
        this.pools.push({ name, getStats: () => pool.getStats() });
    }

    /** Register a TempTypedPool for monitoring. */
    registerTempPool(name: string, pool: TempTypedPool): void {
        this.pools.push({
            name,
            getStats: () => ({
                usedThisFrame: pool.usedThisFrame,
                highWater: pool.highWater,
            }),
        });
    }

    /**
     * Generate a full debug report. Called by debug overlay.
     *
     * @returns Array of pool stats for rendering.
     */
    getReport(): Array<{ name: string; stats: ReturnType<PoolRegistration['getStats']> }> {
        return this.pools.map(p => ({ name: p.name, stats: p.getStats() }));
    }

    /**
     * Log a summary to console. Useful for quick checks.
     * Shows pools that exceeded 80% capacity (potential overflow risk).
     */
    logWarnings(): void {
        for (const p of this.pools) {
            const stats = p.getStats();
            if ('capacity' in stats) {
                const usage = stats.highWater / stats.capacity;
                if (usage > 0.8) {
                    console.warn(
                        `[PoolDebug] "${p.name}" at ${(usage * 100).toFixed(1)}% capacity ` +
                        `(${stats.highWater}/${stats.capacity}). Consider increasing pool size.`
                    );
                }
                if ('overflows' in stats && (stats as PoolStats).overflows > 0) {
                    console.error(
                        `[PoolDebug] "${p.name}" had ${(stats as PoolStats).overflows} OVERFLOWS! ` +
                        `Each overflow creates a heap allocation → GC pressure.`
                    );
                }
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-register built-in temp pools
// ─────────────────────────────────────────────────────────────────────────────

const debugger_ = PoolDebugger.getInstance();
debugger_.registerTempPool('tempVec3', tempVec3Pool);
debugger_.registerTempPool('tempQuat', tempQuatPool);
debugger_.registerTempPool('tempMat4', tempMat4Pool);
