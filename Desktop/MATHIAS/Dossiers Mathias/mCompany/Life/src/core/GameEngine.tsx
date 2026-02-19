/**
 * @fileoverview LIFE Engine — Game Engine Shell (R3F Integration)
 *
 * This is the top-level React component that bootstraps and orchestrates
 * the entire engine. It wires together:
 *   - ECS World (ECSSetup)
 *   - Memory Pools (MemoryPools)
 *   - Game Loop (LoopManager)
 *   - Worker Bridge (WorkerBridge)
 *   - Asset Manager (streaming GLTF/textures)
 *   - Dynamic Grid (chunk-based world streaming with hysteresis)
 *   - Spatial Hash Grid (broad-phase entity lookup)
 *   - Zustand Game State Store
 *
 * Architecture:
 * ─────────────
 *   <GameEngine>
 *     └─ <Canvas> (R3F)
 *          └─ <EngineCore />  ← useFrame drives the game loop
 *          └─ <DebugOverlay /> ← optional pool/perf stats
 *
 * @module GameEngine
 */

import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { create } from 'zustand';

import { ECSWorld } from './ECSSetup';
import { LoopManager, TimeSlicedProcessor } from './LoopManager';
import { WorkerBridge } from './WorkerBridge';
import { PoolDebugger } from './MemoryPools';
import {
    GameState,
    ChunkPriority,
    CHUNK_SIZE,
    HYSTERESIS_BAND,
    type EntityId,
    NULL_ENTITY,
} from './types';

// Feature Imports
import { PostProcessingManager } from '../features/graphics/PostProcessingManager';
import { WeatherRenderer } from '../features/weather/WeatherRenderer';
import { CameraRig } from '../features/camera/CameraRig';
import { VFXSystem, VFXSystemHandle } from '../features/vfx/VFXSystem';

// ─────────────────────────────────────────────────────────────────────────────
// Zustand Game State Store
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Global game state managed by Zustand.
 *
 * Why Zustand over React Context?
 * ───────────────────────────────
 * Context triggers re-renders on ALL consumers when any value changes.
 * Zustand uses selector-based subscriptions — only components that read
 * the changed slice actually re-render. Critical for 60fps.
 */
export interface GameStore {
    /** Current game state (menu, loading, playing, paused). */
    gameState: GameState;
    /** Player entity ID in the ECS world. */
    playerEntityId: EntityId;
    /** Debug flags for development. */
    debugFlags: {
        showPoolStats: boolean;
        showPhysicsDebug: boolean;
        showChunkBorders: boolean;
        showFPS: boolean;
        wireframeMode: boolean;
    };
    /** Camera mode (first-person, third-person, free). */
    cameraMode: 'first-person' | 'third-person' | 'free';
    /** Current FPS (updated every second). */
    fps: number;
    /** Number of loaded chunks. */
    loadedChunkCount: number;

    // ─── Actions ──────────────────────────────────────────────────────────
    setGameState: (state: GameState) => void;
    setPlayerEntityId: (id: EntityId) => void;
    toggleDebugFlag: (flag: keyof GameStore['debugFlags']) => void;
    setCameraMode: (mode: GameStore['cameraMode']) => void;
    setFPS: (fps: number) => void;
    setLoadedChunkCount: (count: number) => void;
}

export const useGameStore = create<GameStore>((set) => ({
    gameState: GameState.Menu,
    playerEntityId: NULL_ENTITY,
    debugFlags: {
        showPoolStats: false,
        showPhysicsDebug: false,
        showChunkBorders: false,
        showFPS: true,
        wireframeMode: false,
    },
    cameraMode: 'third-person',
    fps: 0,
    loadedChunkCount: 0,

    setGameState: (state) => set({ gameState: state }),
    setPlayerEntityId: (id) => set({ playerEntityId: id }),
    toggleDebugFlag: (flag) =>
        set((s) => ({
            debugFlags: { ...s.debugFlags, [flag]: !s.debugFlags[flag] },
        })),
    setCameraMode: (mode) => set({ cameraMode: mode }),
    setFPS: (fps) => set({ fps }),
    setLoadedChunkCount: (count) => set({ loadedChunkCount: count }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Spatial Hash Grid — O(1) insert/remove, O(k) range query
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Spatial hash grid for broad-phase entity lookups.
 *
 * How it works:
 * ─────────────
 * The world is divided into cells of `cellSize` meters.
 * Each entity is hashed into a cell based on its (x, z) position.
 * Querying a region returns all entities in overlapping cells.
 *
 * Complexity:
 *   - insert: O(1) — hash + Set.add
 *   - remove: O(1) — hash + Set.delete
 *   - query(radius): O(k) where k = entities in overlapping cells
 *
 * This is faster than a QuadTree for dynamic objects because there's
 * no tree re-balancing. The trade-off is slightly larger query sets.
 */
export class SpatialHashGrid {
    private readonly cellSize: number;
    private readonly invCellSize: number;
    private readonly cells: Map<number, Set<EntityId>> = new Map();

    /**
     * @param cellSize - Grid cell size in world units (meters). Default: CHUNK_SIZE.
     */
    constructor(cellSize: number = CHUNK_SIZE) {
        this.cellSize = cellSize;
        this.invCellSize = 1.0 / cellSize;
    }

    /**
     * Compute a hash key from (x, z) world coordinates.
     * Uses a simple Cantor-like pairing function.
     * We shift to handle negative coordinates.
     */
    private hash(x: number, z: number): number {
        const cx = Math.floor(x * this.invCellSize) + 32768;
        const cz = Math.floor(z * this.invCellSize) + 32768;
        return (cx << 16) | (cz & 0xFFFF);
    }

    /**
     * Insert an entity at position (x, z). O(1).
     */
    insert(entity: EntityId, x: number, z: number): void {
        const key = this.hash(x, z);
        let cell = this.cells.get(key);
        if (!cell) {
            cell = new Set();
            this.cells.set(key, cell);
        }
        cell.add(entity);
    }

    /**
     * Remove an entity from position (x, z). O(1).
     * Must be called with the SAME position used for insert.
     */
    remove(entity: EntityId, x: number, z: number): void {
        const key = this.hash(x, z);
        const cell = this.cells.get(key);
        if (cell) {
            cell.delete(entity);
            if (cell.size === 0) this.cells.delete(key);
        }
    }

    /**
     * Update an entity's position. O(1) — remove from old cell, add to new.
     */
    update(entity: EntityId, oldX: number, oldZ: number, newX: number, newZ: number): void {
        const oldKey = this.hash(oldX, oldZ);
        const newKey = this.hash(newX, newZ);
        if (oldKey === newKey) return; // Same cell — no-op

        this.remove(entity, oldX, oldZ);
        this.insert(entity, newX, newZ);
    }

    /**
     * Query all entities within a circular region.
     *
     * @param cx   - Center X
     * @param cz   - Center Z
     * @param radius - Query radius in world units
     * @param out  - Output array to push EntityIds into (avoids allocation)
     *
     * Complexity: O(cells_in_range × avg_entities_per_cell)
     */
    queryRadius(cx: number, cz: number, radius: number, out: EntityId[]): void {
        const minCx = Math.floor((cx - radius) * this.invCellSize);
        const maxCx = Math.floor((cx + radius) * this.invCellSize);
        const minCz = Math.floor((cz - radius) * this.invCellSize);
        const maxCz = Math.floor((cz + radius) * this.invCellSize);

        for (let gx = minCx; gx <= maxCx; gx++) {
            for (let gz = minCz; gz <= maxCz; gz++) {
                const key = ((gx + 32768) << 16) | ((gz + 32768) & 0xFFFF);
                const cell = this.cells.get(key);
                if (cell) {
                    for (const entity of cell) {
                        out.push(entity);
                    }
                }
            }
        }
    }

    /** Clear all entries. */
    clear(): void {
        this.cells.clear();
    }

    /** Total number of tracked entities. */
    get entityCount(): number {
        let count = 0;
        for (const cell of this.cells.values()) {
            count += cell.size;
        }
        return count;
    }

    /** Number of non-empty cells. */
    get cellCount(): number {
        return this.cells.size;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic Grid / Chunk System with Hysteresis
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Chunk state for streaming.
 */
export interface ChunkData {
    /** Grid coordinates (not world coords). */
    cx: number;
    cz: number;
    /** Current priority tier. */
    priority: ChunkPriority;
    /** Whether the chunk's assets are loaded. */
    loaded: boolean;
    /** Whether a load/unload operation is in progress. */
    loading: boolean;
    /** Timestamp of last priority evaluation (for debouncing). */
    lastEval: number;
}

/**
 * Dynamic Grid System — manages chunk-based world streaming.
 *
 * Hysteresis:
 * ───────────
 * To prevent rapid load/unload at zone boundaries (when the player
 * walks back and forth across a chunk edge), we use a hysteresis band.
 *
 * A chunk is promoted (Low→Medium, Medium→High) when the player enters
 * within `threshold - HYSTERESIS_BAND`. It is demoted only when the
 * player moves beyond `threshold + HYSTERESIS_BAND`.
 *
 * This creates a "dead zone" of 2×HYSTERESIS_BAND where no transitions
 * occur, eliminating the boundary thrashing problem.
 *
 *   ────────────────────────────────────
 *   |   Low   | Hyst |  Medium  | Hyst |   High   |
 *   ────────────────────────────────────
 *                 ↑ No transitions here ↑
 *
 * Priority Tiers:
 * ───────────────
 *   High (0-100m):   Full LOD, full physics, AI every frame
 *   Medium (100-300m): LOD low, static physics, AI every 10 frames
 *   Low (300-600m):  Impostors, no physics, no AI
 *   Unloaded (600m+): Not in memory
 */
export class DynamicGrid {
    private chunks: Map<number, ChunkData> = new Map();
    private readonly chunkSize: number;
    private readonly invChunkSize: number;

    /** Distance thresholds for priority tiers (in world units). */
    private readonly highThreshold: number;
    private readonly mediumThreshold: number;
    private readonly lowThreshold: number;

    /** Callbacks for chunk lifecycle. */
    private onLoadChunk: ((cx: number, cz: number, priority: ChunkPriority) => void) | null = null;
    private onUnloadChunk: ((cx: number, cz: number) => void) | null = null;
    private onPriorityChange: ((cx: number, cz: number, newPriority: ChunkPriority) => void) | null = null;

    /**
     * @param chunkSize       - Size of each chunk in meters (default: 100)
     * @param highThreshold   - Distance for High priority (default: 100m)
     * @param mediumThreshold - Distance for Medium priority (default: 300m)
     * @param lowThreshold    - Distance for Low priority (default: 600m)
     */
    constructor(
        chunkSize: number = CHUNK_SIZE,
        highThreshold: number = 100,
        mediumThreshold: number = 300,
        lowThreshold: number = 600,
    ) {
        this.chunkSize = chunkSize;
        this.invChunkSize = 1.0 / chunkSize;
        this.highThreshold = highThreshold;
        this.mediumThreshold = mediumThreshold;
        this.lowThreshold = lowThreshold;
    }

    /** Set lifecycle callbacks. */
    setCallbacks(
        onLoad: (cx: number, cz: number, priority: ChunkPriority) => void,
        onUnload: (cx: number, cz: number) => void,
        onPriorityChange: (cx: number, cz: number, newPriority: ChunkPriority) => void,
    ): void {
        this.onLoadChunk = onLoad;
        this.onUnloadChunk = onUnload;
        this.onPriorityChange = onPriorityChange;
    }

    /** Hash chunk coordinates to a map key. */
    private chunkKey(cx: number, cz: number): number {
        return ((cx + 32768) << 16) | ((cz + 32768) & 0xFFFF);
    }

    /**
     * Evaluate chunk priorities based on the player's current world position.
     * Called every frame (but chunked computations are cheap).
     *
     * @param playerX - Player world X
     * @param playerZ - Player world Z
     */
    update(playerX: number, playerZ: number): void {
        const pcx = Math.floor(playerX * this.invChunkSize);
        const pcz = Math.floor(playerZ * this.invChunkSize);

        // Determine the range of chunks to consider
        const rangeChunks = Math.ceil(this.lowThreshold * this.invChunkSize) + 1;

        // Track which chunks should exist
        const activeKeys = new Set<number>();

        for (let dx = -rangeChunks; dx <= rangeChunks; dx++) {
            for (let dz = -rangeChunks; dz <= rangeChunks; dz++) {
                const cx = pcx + dx;
                const cz = pcz + dz;
                const key = this.chunkKey(cx, cz);

                // Distance from chunk center to player (in world units)
                const worldCx = (cx + 0.5) * this.chunkSize;
                const worldCz = (cz + 0.5) * this.chunkSize;
                const distX = worldCx - playerX;
                const distZ = worldCz - playerZ;
                const dist = Math.sqrt(distX * distX + distZ * distZ);

                // Determine target priority WITH hysteresis
                const priority = this.evaluatePriority(dist, key);

                if (priority === ChunkPriority.Unloaded) continue;

                activeKeys.add(key);

                let chunk = this.chunks.get(key);
                if (!chunk) {
                    // New chunk — load it
                    chunk = {
                        cx, cz,
                        priority,
                        loaded: false,
                        loading: false,
                        lastEval: performance.now(),
                    };
                    this.chunks.set(key, chunk);
                    this.onLoadChunk?.(cx, cz, priority);
                    chunk.loaded = true;
                } else if (chunk.priority !== priority) {
                    // Priority changed — notify
                    const oldPriority = chunk.priority;
                    chunk.priority = priority;
                    chunk.lastEval = performance.now();
                    this.onPriorityChange?.(cx, cz, priority);
                }
            }
        }

        // Unload chunks that are no longer in range
        for (const [key, chunk] of this.chunks) {
            if (!activeKeys.has(key)) {
                this.onUnloadChunk?.(chunk.cx, chunk.cz);
                this.chunks.delete(key);
            }
        }
    }

    /**
     * Evaluate priority with hysteresis to prevent boundary thrashing.
     *
     * @param dist - Distance from chunk center to player
     * @param key  - Chunk key (for looking up current state)
     * @returns New chunk priority
     */
    private evaluatePriority(dist: number, key: number): ChunkPriority {
        const existing = this.chunks.get(key);
        const currentPriority = existing?.priority ?? ChunkPriority.Unloaded;
        const hyst = HYSTERESIS_BAND;

        // Apply hysteresis: use different thresholds for promotion vs demotion
        if (currentPriority === ChunkPriority.High) {
            // Currently High → demote only beyond threshold + hysteresis
            if (dist > this.highThreshold + hyst) {
                if (dist > this.mediumThreshold + hyst) {
                    if (dist > this.lowThreshold + hyst) return ChunkPriority.Unloaded;
                    return ChunkPriority.Low;
                }
                return ChunkPriority.Medium;
            }
            return ChunkPriority.High;
        }

        if (currentPriority === ChunkPriority.Medium) {
            // Can be promoted to High or demoted to Low
            if (dist < this.highThreshold - hyst) return ChunkPriority.High;
            if (dist > this.mediumThreshold + hyst) {
                if (dist > this.lowThreshold + hyst) return ChunkPriority.Unloaded;
                return ChunkPriority.Low;
            }
            return ChunkPriority.Medium;
        }

        if (currentPriority === ChunkPriority.Low) {
            if (dist < this.highThreshold - hyst) return ChunkPriority.High;
            if (dist < this.mediumThreshold - hyst) return ChunkPriority.Medium;
            if (dist > this.lowThreshold + hyst) return ChunkPriority.Unloaded;
            return ChunkPriority.Low;
        }

        // Unloaded — promote based on distance (no hysteresis for initial load)
        if (dist <= this.highThreshold) return ChunkPriority.High;
        if (dist <= this.mediumThreshold) return ChunkPriority.Medium;
        if (dist <= this.lowThreshold) return ChunkPriority.Low;
        return ChunkPriority.Unloaded;
    }

    /** Get all currently loaded chunks. */
    getLoadedChunks(): ChunkData[] {
        return Array.from(this.chunks.values());
    }

    /** Get chunk count by priority tier. */
    getChunkCounts(): Record<string, number> {
        const counts: Record<string, number> = { high: 0, medium: 0, low: 0 };
        for (const chunk of this.chunks.values()) {
            if (chunk.priority === ChunkPriority.High) counts.high++;
            else if (chunk.priority === ChunkPriority.Medium) counts.medium++;
            else if (chunk.priority === ChunkPriority.Low) counts.low++;
        }
        return counts;
    }

    /** Total loaded chunk count. */
    get loadedCount(): number {
        return this.chunks.size;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Asset Manager — Streaming GLTF/Texture Loader
// ─────────────────────────────────────────────────────────────────────────────

/** Asset types the manager handles. */
export const enum AssetType {
    GLTF = 'gltf',
    Texture = 'texture',
    Audio = 'audio',
}

/** Reference-counted asset entry. */
interface AssetEntry {
    type: AssetType;
    url: string;
    /** The loaded data (GLTF scene, Texture, AudioBuffer, etc.). */
    data: unknown;
    /** Number of active references. Unloaded when it reaches 0. */
    refCount: number;
    /** Whether the asset is currently loading. */
    loading: boolean;
    /** Size estimate in bytes (for memory tracking). */
    sizeBytes: number;
}

/**
 * Centralized asset manager with reference counting and async loading.
 *
 * Features:
 * ─────────
 * - Deduplication: same URL → same asset instance
 * - Reference counting: assets are unloaded when refCount drops to 0
 * - Async queue: loads assets without blocking the main thread
 * - Priority: high-priority assets (player zone) loaded first
 * - KTX2/Basis Universal: GPU-compressed texture support (via drei's loader)
 *
 * Memory management:
 * ──────────────────
 * The AssetManager tracks approximate memory usage. When total exceeds
 * a budget, it unloads lowest-priority zero-ref assets first (LRU).
 */
export class AssetManager {
    private assets: Map<string, AssetEntry> = new Map();
    private loadQueue: Array<{ url: string; type: AssetType; priority: number; resolve: (data: unknown) => void }> = [];
    private isProcessing: boolean = false;

    /** Maximum concurrent loads to avoid saturating bandwidth. */
    private readonly maxConcurrent: number;
    /** Approximate memory budget in bytes. */
    private readonly memoryBudget: number;
    private currentMemory: number = 0;

    /**
     * @param maxConcurrent - Max simultaneous download/parse operations (default: 4)
     * @param memoryBudgetMB - Memory budget in MB (default: 512 MB)
     */
    constructor(maxConcurrent: number = 4, memoryBudgetMB: number = 512) {
        this.maxConcurrent = maxConcurrent;
        this.memoryBudget = memoryBudgetMB * 1024 * 1024;
    }

    /**
     * Request an asset. Returns cached data if already loaded.
     * Otherwise queues for async loading.
     *
     * @param url      - Asset URL (relative or absolute)
     * @param type     - Asset type enum
     * @param priority - Loading priority (lower = higher priority)
     * @returns Promise resolving to the loaded asset data
     */
    async load(url: string, type: AssetType, priority: number = 0): Promise<unknown> {
        // Check cache first
        const existing = this.assets.get(url);
        if (existing) {
            existing.refCount++;
            if (existing.data !== null) return existing.data;
            // Asset is loading — wait for it
            return new Promise((resolve) => {
                this.loadQueue.push({ url, type, priority, resolve });
            });
        }

        // Register new asset
        const entry: AssetEntry = {
            type,
            url,
            data: null,
            refCount: 1,
            loading: true,
            sizeBytes: 0,
        };
        this.assets.set(url, entry);

        return new Promise((resolve) => {
            this.loadQueue.push({ url, type, priority, resolve });
            this.loadQueue.sort((a, b) => a.priority - b.priority);
            this.processQueue();
        });
    }

    /**
     * Release a reference to an asset. When refCount reaches 0,
     * the asset becomes eligible for eviction.
     */
    release(url: string): void {
        const entry = this.assets.get(url);
        if (!entry) return;

        entry.refCount = Math.max(0, entry.refCount - 1);

        // Don't immediately unload — keep in cache for potential reuse.
        // Eviction happens in evictIfNeeded() when memory pressure is high.
    }

    /**
     * Process the async load queue. Limits concurrent loads.
     */
    private async processQueue(): Promise<void> {
        if (this.isProcessing) return;
        this.isProcessing = true;

        while (this.loadQueue.length > 0) {
            // Take up to maxConcurrent items
            const batch = this.loadQueue.splice(0, this.maxConcurrent);

            await Promise.all(
                batch.map(async (item) => {
                    try {
                        const data = await this.fetchAsset(item.url, item.type);
                        const entry = this.assets.get(item.url);
                        if (entry) {
                            entry.data = data;
                            entry.loading = false;
                            // Rough size estimate
                            entry.sizeBytes = this.estimateSize(data);
                            this.currentMemory += entry.sizeBytes;
                        }
                        item.resolve(data);
                    } catch (err) {
                        console.error(`[AssetManager] Failed to load ${item.url}:`, err);
                        item.resolve(null);
                    }
                }),
            );

            // Check memory pressure after each batch
            this.evictIfNeeded();
        }

        this.isProcessing = false;
    }

    /**
     * Actually fetch and parse an asset. Override for custom loaders.
     */
    private async fetchAsset(url: string, type: AssetType): Promise<unknown> {
        switch (type) {
            case AssetType.GLTF: {
                // In production, use drei's useGLTF or GLTFLoader.
                // Here we provide the fetch scaffolding.
                const response = await fetch(url);
                const buffer = await response.arrayBuffer();
                return buffer; // Would be parsed by GLTFLoader in real usage
            }
            case AssetType.Texture: {
                // For KTX2/Basis Universal, use KTX2Loader from three.js
                const response = await fetch(url);
                const blob = await response.blob();
                const bitmap = await createImageBitmap(blob);
                return bitmap;
            }
            case AssetType.Audio: {
                const response = await fetch(url);
                const buffer = await response.arrayBuffer();
                return buffer;
            }
            default:
                throw new Error(`[AssetManager] Unknown asset type: ${type}`);
        }
    }

    /**
     * Rough size estimation for loaded assets.
     */
    private estimateSize(data: unknown): number {
        if (data instanceof ArrayBuffer) return data.byteLength;
        if (data instanceof ImageBitmap) return data.width * data.height * 4; // RGBA
        return 1024; // Fallback estimate
    }

    /**
     * Evict zero-ref assets when memory exceeds budget.
     * Uses a simple LRU-like strategy: evict zero-ref assets first.
     */
    private evictIfNeeded(): void {
        if (this.currentMemory <= this.memoryBudget) return;

        const evictable: [string, AssetEntry][] = [];
        for (const [url, entry] of this.assets) {
            if (entry.refCount === 0 && !entry.loading) {
                evictable.push([url, entry]);
            }
        }

        // Sort by size descending — evict largest first for maximum memory relief
        evictable.sort((a, b) => b[1].sizeBytes - a[1].sizeBytes);

        for (const [url, entry] of evictable) {
            if (this.currentMemory <= this.memoryBudget * 0.8) break; // Stop at 80%
            this.currentMemory -= entry.sizeBytes;
            this.assets.delete(url);
        }
    }

    /** Get memory usage stats. */
    getMemoryStats(): { currentMB: number; budgetMB: number; assetCount: number; loadingCount: number } {
        let loadingCount = 0;
        for (const entry of this.assets.values()) {
            if (entry.loading) loadingCount++;
        }
        return {
            currentMB: this.currentMemory / (1024 * 1024),
            budgetMB: this.memoryBudget / (1024 * 1024),
            assetCount: this.assets.size,
            loadingCount,
        };
    }

    /** Forcefully unload all assets. Called on scene transition. */
    unloadAll(): void {
        this.assets.clear();
        this.loadQueue.length = 0;
        this.currentMemory = 0;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine Context — Singleton-like engine references
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Central engine context holding all subsystem references.
 * Passed through React context to child components.
 */
export interface EngineContext {
    world: ECSWorld;
    loopManager: LoopManager;
    workerBridge: WorkerBridge;
    assetManager: AssetManager;
    dynamicGrid: DynamicGrid;
    spatialGrid: SpatialHashGrid;
    aiTimeSlice: TimeSlicedProcessor;
}

const EngineReactContext = React.createContext<EngineContext | null>(null);

/**
 * Hook to access engine subsystems from within R3F components.
 * Throws if used outside of <GameEngine>.
 */
export function useEngine(): EngineContext {
    const ctx = React.useContext(EngineReactContext);
    if (!ctx) throw new Error('[useEngine] Must be used within <GameEngine>');
    return ctx;
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine Core — Inner component that drives the game loop via useFrame
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Internal R3F component that connects the LoopManager to R3F's render loop.
 * Uses `useFrame` to receive the frame delta from requestAnimationFrame.
 */
function EngineCore(): null {
    const engine = useEngine();
    const fpsAccum = useRef({ frames: 0, elapsed: 0 });
    const setFPS = useGameStore((s) => s.setFPS);
    const setChunkCount = useGameStore((s) => s.setLoadedChunkCount);
    const gameState = useGameStore((s) => s.gameState);
    const playerEntityId = useGameStore((s) => s.playerEntityId);

    useFrame((_state, delta) => {
        // Only run when playing
        if (gameState !== GameState.Playing) return;

        // ── Drive the game loop ──────────────────────────────────────────────
        engine.loopManager.tick(delta);

        // ── Update dynamic grid based on player position ─────────────────────
        if (playerEntityId !== NULL_ENTITY) {
            const tStore = engine.world.stores.transform;
            const stride = 11;
            const offset = (playerEntityId as number) * stride;
            const px = tStore[offset];
            const pz = tStore[offset + 2];
            engine.dynamicGrid.update(px, pz);
            setChunkCount(engine.dynamicGrid.loadedCount);
        }

        // ── FPS counter (update once per second) ─────────────────────────────
        fpsAccum.current.frames++;
        fpsAccum.current.elapsed += delta;
        if (fpsAccum.current.elapsed >= 1.0) {
            setFPS(Math.round(fpsAccum.current.frames / fpsAccum.current.elapsed));
            fpsAccum.current.frames = 0;
            fpsAccum.current.elapsed = 0;
        }
    });

    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GameEngine — Top-Level React Component
// ─────────────────────────────────────────────────────────────────────────────

export interface GameEngineProps {
    /** Children to render inside the R3F Canvas (game scenes, meshes, etc.). */
    children?: React.ReactNode;
    /** Whether to show the debug overlay. */
    debug?: boolean;
    /** Canvas style overrides. */
    style?: React.CSSProperties;
}

/**
 * Top-level game engine component.
 *
 * Usage:
 * ──────
 *   <GameEngine debug>
 *     <YourGameScene />
 *   </GameEngine>
 */
export function GameEngine({ children, debug = false, style }: GameEngineProps): React.JSX.Element {
    // ── Initialize engine subsystems (once) ──────────────────────────────────
    const engine = useMemo<EngineContext>(() => {
        const world = new ECSWorld();
        const loopManager = new LoopManager();
        const workerBridge = new WorkerBridge();
        const assetManager = new AssetManager();
        const dynamicGrid = new DynamicGrid();
        const spatialGrid = new SpatialHashGrid();
        const aiTimeSlice = new TimeSlicedProcessor(10, 2.0);

        // Wire up the loop manager to the ECS world
        loopManager.setWorld(world);

        return { world, loopManager, workerBridge, assetManager, dynamicGrid, spatialGrid, aiTimeSlice };
    }, []);

    // ── Cleanup on unmount ───────────────────────────────────────────────────
    useEffect(() => {
        return () => {
            engine.workerBridge.dispose();
            engine.assetManager.unloadAll();
            engine.world.reset();
        };
    }, [engine]);

    // ── Global VFX System Reference ──
    const vfxRef = useRef<VFXSystemHandle>(null);
    // TODO: Expose vfxRef to ECS systems via context or store


    // ── Toggle debug flag on mount ───────────────────────────────────────────
    useEffect(() => {
        if (debug) {
            useGameStore.getState().debugFlags.showPoolStats = true;
            useGameStore.getState().debugFlags.showFPS = true;
        }
    }, [debug]);

    return (
        <EngineReactContext.Provider value={engine}>
            <Canvas
                style={{ width: '100vw', height: '100vh', ...style }}
                gl={{
                    antialias: true,
                    powerPreference: 'high-performance',
                    stencil: false,
                    depth: true,
                }}
                camera={{ fov: 60, near: 0.1, far: 2000 }}
                frameloop="always"
            >
                <EngineCore />
                <EngineCore />

                {/* ── Cinematic Features ── */}
                <WeatherRenderer />

                <CameraRig />

                <VFXSystem ref={vfxRef} />

                {children}

                {/* Post-Processing must be last */}
                <PostProcessingManager />
            </Canvas>
        </EngineReactContext.Provider>
    );
}

export default GameEngine;
