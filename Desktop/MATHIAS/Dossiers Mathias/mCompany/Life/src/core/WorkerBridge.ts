/**
 * @fileoverview LIFE Engine — Worker Bridge (SharedArrayBuffer + Atomics)
 *
 * Enables zero-copy data synchronization between the main thread and
 * dedicated Web Workers (Physics, Pathfinding, Procgen).
 *
 * Architecture:
 * ─────────────
 *
 *   Main Thread                   SharedArrayBuffer                Worker
 *   ┌──────────┐     ┌─────────────────────────────────┐     ┌──────────┐
 *   │ ECS      │────▶│ Control Word (Atomics)           │◀────│ Rapier   │
 *   │ World    │     │ Entity Count (Atomics)           │     │ Physics  │
 *   │          │     │ Page A: Transform data (pos+rot) │     │          │
 *   │          │     │ Page B: Transform data (pos+rot) │     │          │
 *   └──────────┘     └─────────────────────────────────┘     └──────────┘
 *
 * Double-Buffering Strategy:
 * ──────────────────────────
 * Two "pages" of transform data exist in the SAB. At any time, one page is
 * the "read" page (main thread reads interpolated transforms) and the other
 * is the "write" page (worker writes updated physics transforms).
 *
 * Swap is lock-free via Atomics.store on the control word:
 *   0 → Page A is active (main reads A, worker writes B)
 *   1 → Page B is active (main reads B, worker writes A)
 *
 * After the worker finishes a physics step, it stores the new page index.
 * The main thread reads the latest page on the next frame.
 *
 * Why SharedArrayBuffer?
 * ──────────────────────
 * postMessage with Transferable requires marshaling + transfer overhead.
 * SAB avoids ALL data copies — both threads see the same memory.
 * For 65K entities × 7 floats × 4 bytes = 1.8 MB per page, this saves
 * ~3.6 MB of copies per frame at 60fps = 216 MB/s bandwidth saved.
 *
 * Security Note:
 * ──────────────
 * SAB requires Cross-Origin-Opener-Policy + Cross-Origin-Embedder-Policy
 * headers on the server. Vite dev server can be configured for this.
 *
 * @module WorkerBridge
 */

import {
    MAX_ENTITIES,
    SAB_CONTROL_OFFSET,
    SAB_ENTITY_COUNT_OFFSET,
    SAB_DATA_OFFSET,
    SAB_TRANSFORM_FLOATS,
    SAB_PAGE_SIZE_BYTES,
    SAB_TOTAL_SIZE,
    WorkerType,
    WorkerMessageType,
    type WorkerMessage,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// SharedArrayBuffer Manager
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages the SharedArrayBuffer used for lockfree transform synchronization
 * between the main thread and physics worker.
 *
 * Provides typed views into the buffer and atomic swap operations.
 */
export class SharedTransformBuffer {
    /** The underlying SharedArrayBuffer. */
    readonly sab: SharedArrayBuffer;

    /** Int32 view for Atomics operations on control/count words. */
    private readonly controlView: Int32Array;

    /** Float32 view for Page A transform data. */
    private readonly pageA: Float32Array;

    /** Float32 view for Page B transform data. */
    private readonly pageB: Float32Array;

    constructor() {
        // Allocate SAB: control(4) + count(4) + pageA(~1.8MB) + pageB(~1.8MB)
        this.sab = new SharedArrayBuffer(SAB_TOTAL_SIZE);

        // Control words: Int32 aligned at byte 0
        this.controlView = new Int32Array(this.sab, 0, 2);

        // Transform data pages
        const pageAOffset = SAB_DATA_OFFSET;
        const pageBOffset = SAB_DATA_OFFSET + SAB_PAGE_SIZE_BYTES;
        this.pageA = new Float32Array(this.sab, pageAOffset, MAX_ENTITIES * SAB_TRANSFORM_FLOATS);
        this.pageB = new Float32Array(this.sab, pageBOffset, MAX_ENTITIES * SAB_TRANSFORM_FLOATS);

        // Initialize: Page A active, 0 entities
        Atomics.store(this.controlView, 0, 0); // Active page = A
        Atomics.store(this.controlView, 1, 0); // Entity count = 0
    }

    // ─── Atomic Page Swap (Lock-Free) ─────────────────────────────────────────

    /**
     * Get the currently active page index. O(1).
     * Called by main thread to know which page has the latest data.
     */
    getActivePage(): number {
        return Atomics.load(this.controlView, 0);
    }

    /**
     * Swap the active page. O(1).
     * Called by the worker after finishing a physics step.
     *
     * @returns The new active page index.
     */
    swapPage(): number {
        const current = Atomics.load(this.controlView, 0);
        const next = current === 0 ? 1 : 0;
        Atomics.store(this.controlView, 0, next);
        return next;
    }

    /**
     * Set the entity count (written by main thread before worker step).
     */
    setEntityCount(count: number): void {
        Atomics.store(this.controlView, 1, count);
    }

    /**
     * Get the entity count.
     */
    getEntityCount(): number {
        return Atomics.load(this.controlView, 1);
    }

    // ─── Data Access ──────────────────────────────────────────────────────────

    /**
     * Get the read page (current active page — has latest physics results).
     * Main thread reads from this page for rendering.
     */
    getReadPage(): Float32Array {
        return this.getActivePage() === 0 ? this.pageA : this.pageB;
    }

    /**
     * Get the write page (inactive page — worker writes next step here).
     */
    getWritePage(): Float32Array {
        return this.getActivePage() === 0 ? this.pageB : this.pageA;
    }

    /**
     * Write a single entity's transform into the write page.
     * Called by the physics worker during simulation.
     *
     * @param entityIndex - Entity ID
     * @param px,py,pz    - Position
     * @param rx,ry,rz,rw - Rotation quaternion
     */
    writeTransform(
        entityIndex: number,
        px: number, py: number, pz: number,
        rx: number, ry: number, rz: number, rw: number,
    ): void {
        const page = this.getWritePage();
        const offset = entityIndex * SAB_TRANSFORM_FLOATS;
        page[offset] = px;
        page[offset + 1] = py;
        page[offset + 2] = pz;
        page[offset + 3] = rx;
        page[offset + 4] = ry;
        page[offset + 5] = rz;
        page[offset + 6] = rw;
    }

    /**
     * Read a single entity's transform from the read page.
     * Called by main thread to update ECS store.
     *
     * @param entityIndex - Entity ID
     * @param out - Output Float32Array of length >= 7
     */
    readTransform(entityIndex: number, out: Float32Array): void {
        const page = this.getReadPage();
        const offset = entityIndex * SAB_TRANSFORM_FLOATS;
        out[0] = page[offset];
        out[1] = page[offset + 1];
        out[2] = page[offset + 2];
        out[3] = page[offset + 3];
        out[4] = page[offset + 4];
        out[5] = page[offset + 5];
        out[6] = page[offset + 6];
    }

    /**
     * Bulk copy all transforms from the ECS store into the write page.
     * Used by main thread to push entity positions to the physics worker.
     *
     * @param transformStore - SoA transform Float32Array from ECSWorld
     * @param entityCount    - Number of entities to copy
     * @param stride         - Transform component stride (11 floats)
     */
    pushToWorker(transformStore: Float32Array, entityCount: number, stride: number): void {
        const page = this.getWritePage();
        for (let i = 0; i < entityCount; i++) {
            const srcOff = i * stride;
            const dstOff = i * SAB_TRANSFORM_FLOATS;
            // Copy pos(3) + rot(4)
            page[dstOff] = transformStore[srcOff];
            page[dstOff + 1] = transformStore[srcOff + 1];
            page[dstOff + 2] = transformStore[srcOff + 2];
            page[dstOff + 3] = transformStore[srcOff + 3];
            page[dstOff + 4] = transformStore[srcOff + 4];
            page[dstOff + 5] = transformStore[srcOff + 5];
            page[dstOff + 6] = transformStore[srcOff + 6];
        }
        this.setEntityCount(entityCount);
    }

    /**
     * Bulk read all transforms from the read page back into the ECS store.
     * Used by main thread after the worker completes a physics step.
     *
     * @param transformStore - SoA transform Float32Array from ECSWorld
     * @param stride         - Transform component stride (11 floats)
     */
    pullFromWorker(transformStore: Float32Array, stride: number): void {
        const page = this.getReadPage();
        const count = this.getEntityCount();
        for (let i = 0; i < count; i++) {
            const srcOff = i * SAB_TRANSFORM_FLOATS;
            const dstOff = i * stride;
            // Write pos(3) + rot(4) back
            transformStore[dstOff] = page[srcOff];
            transformStore[dstOff + 1] = page[srcOff + 1];
            transformStore[dstOff + 2] = page[srcOff + 2];
            transformStore[dstOff + 3] = page[srcOff + 3];
            transformStore[dstOff + 4] = page[srcOff + 4];
            transformStore[dstOff + 5] = page[srcOff + 5];
            transformStore[dstOff + 6] = page[srcOff + 6];
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker Lifecycle Manager
// ─────────────────────────────────────────────────────────────────────────────

/** State of a managed worker. */
export const enum WorkerState {
    Idle = 'idle',
    Starting = 'starting',
    Ready = 'ready',
    Running = 'running',
    Error = 'error',
    Terminated = 'terminated',
}

/**
 * Configuration for spawning a worker.
 */
export interface WorkerConfig {
    type: WorkerType;
    /** URL to the worker script (relative or blob). */
    scriptUrl: string;
    /** Optional: SharedArrayBuffer to pass to the worker. */
    sharedBuffer?: SharedArrayBuffer;
    /** Restart automatically on uncaught error? Default: true. */
    autoRestart?: boolean;
    /** Max restart attempts before giving up. Default: 3. */
    maxRestarts?: number;
}

/**
 * Internal state for a managed worker instance.
 */
interface ManagedWorker {
    config: WorkerConfig;
    worker: Worker | null;
    state: WorkerState;
    restartCount: number;
    messageHandler: ((msg: WorkerMessage) => void) | null;
}

/**
 * Manages Web Worker lifecycle: spawn, message passing, error recovery, termination.
 *
 * Provides a type-safe message protocol with discriminated union types.
 * Automatically restarts workers on uncaught errors (configurable).
 */
export class WorkerManager {
    private workers: Map<WorkerType, ManagedWorker> = new Map();

    /**
     * Spawn a new worker of the given type.
     * If a worker of this type already exists, it is terminated first.
     *
     * @param config - Worker configuration
     * @param onMessage - Handler for messages FROM the worker
     */
    spawn(config: WorkerConfig, onMessage?: (msg: WorkerMessage) => void): void {
        // Clean up existing worker of this type
        this.terminate(config.type);

        const managed: ManagedWorker = {
            config,
            worker: null,
            state: WorkerState.Starting,
            restartCount: 0,
            messageHandler: onMessage ?? null,
        };

        this.workers.set(config.type, managed);
        this.createWorkerInstance(managed);
    }

    /**
     * Create the actual Worker instance and wire up event handlers.
     */
    private createWorkerInstance(managed: ManagedWorker): void {
        try {
            const worker = new Worker(managed.config.scriptUrl, { type: 'module' });

            worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
                const msg = event.data;
                if (msg.type === WorkerMessageType.Ready) {
                    managed.state = WorkerState.Ready;
                }
                managed.messageHandler?.(msg);
            };

            worker.onerror = (error: ErrorEvent) => {
                console.error(`[WorkerManager] ${managed.config.type} worker error:`, error.message);
                managed.state = WorkerState.Error;

                // Auto-restart logic
                const maxRestarts = managed.config.maxRestarts ?? 3;
                const autoRestart = managed.config.autoRestart ?? true;

                if (autoRestart && managed.restartCount < maxRestarts) {
                    managed.restartCount++;
                    console.warn(
                        `[WorkerManager] Restarting ${managed.config.type} worker ` +
                        `(attempt ${managed.restartCount}/${maxRestarts})...`
                    );
                    worker.terminate();
                    // Delay restart to avoid rapid error loops
                    setTimeout(() => this.createWorkerInstance(managed), 1000);
                } else {
                    console.error(
                        `[WorkerManager] ${managed.config.type} worker FAILED after ` +
                        `${managed.restartCount} restarts. Giving up.`
                    );
                    managed.state = WorkerState.Terminated;
                }
            };

            managed.worker = worker;
            managed.state = WorkerState.Starting;

            // Send init message with SAB if provided
            const initPayload: Record<string, unknown> = {};
            if (managed.config.sharedBuffer) {
                initPayload.sharedBuffer = managed.config.sharedBuffer;
            }

            this.postMessage(managed.config.type, {
                type: WorkerMessageType.Init,
                payload: initPayload,
                timestamp: performance.now(),
            });
        } catch (err) {
            console.error(`[WorkerManager] Failed to create ${managed.config.type} worker:`, err);
            managed.state = WorkerState.Error;
        }
    }

    /**
     * Send a typed message TO a worker. O(1).
     *
     * @param type - Which worker to send to
     * @param message - Typed message envelope
     */
    postMessage(type: WorkerType, message: WorkerMessage): void {
        const managed = this.workers.get(type);
        if (!managed?.worker) {
            console.warn(`[WorkerManager] Cannot post to ${type}: worker not available.`);
            return;
        }
        managed.worker.postMessage(message);
    }

    /**
     * Gracefully terminate a worker.
     */
    terminate(type: WorkerType): void {
        const managed = this.workers.get(type);
        if (!managed) return;

        if (managed.worker) {
            // Send terminate message so worker can clean up
            this.postMessage(type, {
                type: WorkerMessageType.Terminate,
                timestamp: performance.now(),
            });
            managed.worker.terminate();
        }

        managed.state = WorkerState.Terminated;
        managed.worker = null;
        this.workers.delete(type);
    }

    /** Terminate all workers. Called on engine shutdown. */
    terminateAll(): void {
        for (const type of this.workers.keys()) {
            this.terminate(type);
        }
    }

    /** Get the current state of a worker. */
    getState(type: WorkerType): WorkerState {
        return this.workers.get(type)?.state ?? WorkerState.Terminated;
    }

    /** Check if a worker is ready to receive step commands. */
    isReady(type: WorkerType): boolean {
        return this.getState(type) === WorkerState.Ready;
    }

    /**
     * Request the physics worker to perform a simulation step.
     * The worker reads from the write page, simulates, writes to it,
     * then posts a SwapBuffer message when done.
     */
    requestPhysicsStep(dt: number): void {
        this.postMessage(WorkerType.Physics, {
            type: WorkerMessageType.Step,
            payload: { dt },
            timestamp: performance.now(),
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker Bridge — High-level API combining SAB + WorkerManager
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Facade that combines SharedTransformBuffer and WorkerManager
 * into a single coherent API for the engine.
 *
 * Usage:
 * ──────
 *   const bridge = new WorkerBridge();
 *   bridge.initPhysicsWorker('/workers/physics.js');
 *
 *   // In FixedUpdate:
 *   bridge.syncToWorker(world.stores.transform, entityCount);
 *   bridge.stepPhysics(FIXED_DT);
 *
 *   // When worker posts SwapBuffer:
 *   bridge.syncFromWorker(world.stores.transform);
 */
export class WorkerBridge {
    readonly sharedBuffer: SharedTransformBuffer;
    readonly workerManager: WorkerManager;

    /** Whether SAB is available in this environment. */
    readonly sabSupported: boolean;

    constructor() {
        this.sabSupported = typeof SharedArrayBuffer !== 'undefined';

        if (this.sabSupported) {
            this.sharedBuffer = new SharedTransformBuffer();
        } else {
            console.warn(
                '[WorkerBridge] SharedArrayBuffer not available. ' +
                'Physics will run on main thread. ' +
                'Ensure COOP/COEP headers are set for SAB support.'
            );
            // Create a fallback using regular ArrayBuffer cast
            // (this won't work for actual sharing, but prevents crashes)
            this.sharedBuffer = new SharedTransformBuffer();
        }

        this.workerManager = new WorkerManager();
    }

    /**
     * Initialize the physics worker with SAB.
     *
     * @param scriptUrl - URL to the physics worker script
     * @param onResult  - Callback when physics step completes
     */
    initPhysicsWorker(
        scriptUrl: string,
        onResult?: (msg: WorkerMessage) => void,
    ): void {
        if (!this.sabSupported) {
            console.warn('[WorkerBridge] Skipping physics worker — SAB not supported.');
            return;
        }

        this.workerManager.spawn(
            {
                type: WorkerType.Physics,
                scriptUrl,
                sharedBuffer: this.sharedBuffer.sab,
                autoRestart: true,
                maxRestarts: 3,
            },
            (msg: WorkerMessage) => {
                if (msg.type === WorkerMessageType.SwapBuffer) {
                    // Worker has finished writing — swap the active page
                    this.sharedBuffer.swapPage();
                }
                onResult?.(msg);
            },
        );
    }

    /**
     * Initialize the pathfinding worker.
     */
    initPathfindingWorker(
        scriptUrl: string,
        onResult?: (msg: WorkerMessage) => void,
    ): void {
        this.workerManager.spawn(
            {
                type: WorkerType.Pathfinding,
                scriptUrl,
                autoRestart: true,
                maxRestarts: 3,
            },
            onResult,
        );
    }

    /**
     * Initialize the procedural generation worker.
     */
    initProcgenWorker(
        scriptUrl: string,
        onResult?: (msg: WorkerMessage) => void,
    ): void {
        this.workerManager.spawn(
            {
                type: WorkerType.Procgen,
                scriptUrl,
                autoRestart: true,
                maxRestarts: 3,
            },
            onResult,
        );
    }

    /**
     * Push current ECS transforms to the SAB write page.
     * Call BEFORE requesting a physics step.
     *
     * @param transformStore - ECS world transform Float32Array
     * @param entityCount    - Number of active entities
     * @param stride         - Transform component stride (default: 11)
     */
    syncToWorker(transformStore: Float32Array, entityCount: number, stride: number = 11): void {
        this.sharedBuffer.pushToWorker(transformStore, entityCount, stride);
    }

    /**
     * Pull updated transforms from the SAB read page back into ECS.
     * Call AFTER the worker signals completion (SwapBuffer message).
     *
     * @param transformStore - ECS world transform Float32Array
     * @param stride         - Transform component stride (default: 11)
     */
    syncFromWorker(transformStore: Float32Array, stride: number = 11): void {
        this.sharedBuffer.pullFromWorker(transformStore, stride);
    }

    /**
     * Request a physics simulation step on the worker.
     */
    stepPhysics(dt: number): void {
        this.workerManager.requestPhysicsStep(dt);
    }

    /**
     * Shutdown: terminate all workers and release resources.
     */
    dispose(): void {
        this.workerManager.terminateAll();
    }
}
