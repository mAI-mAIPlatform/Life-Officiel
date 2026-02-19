/**
 * @fileoverview LIFE Engine — Shared Types, Constants & Bitmask Helpers
 *
 * All numeric constants are `as const` to enable literal type narrowing.
 * Bitmask helpers use bitwise ops — O(1) per operation, zero allocation.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Global Engine Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum number of entities the ECS can handle. Power-of-2 for alignment. */
export const MAX_ENTITIES = 65_536;

/** Fixed physics/logic timestep in seconds (60 Hz). */
export const FIXED_DT = 1 / 60;

/** Maximum frame delta allowed (250ms) to avoid spiral-of-death. */
export const MAX_FRAME_DELTA = 0.25;

/** Chunk size in meters for spatial partitioning. */
export const CHUNK_SIZE = 100;

/** Hysteresis band in meters to prevent boundary thrashing. */
export const HYSTERESIS_BAND = 10;

/** Number of input entries in the circular buffer per entity. */
export const INPUT_BUFFER_SIZE = 16;

/** Number of pathing nodes in AIState. */
export const AI_PATHING_NODE_COUNT = 32;

/** Number of memory entries in AIState. */
export const AI_MEMORY_ENTRY_COUNT = 16;

// ─────────────────────────────────────────────────────────────────────────────
// Entity ID Type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Branded type for entity IDs — prevents accidental misuse of plain numbers.
 * Entities are indices into SoA arrays: range [0, MAX_ENTITIES).
 */
export type EntityId = number & { readonly __brand: 'EntityId' };

/** Sentinel for "no entity". */
export const NULL_ENTITY = -1 as EntityId;

// ─────────────────────────────────────────────────────────────────────────────
// Component Bitmask Enum (Archetype Keys)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Each component type gets a unique power-of-2 flag.
 * An archetype is defined by the bitwise OR of its component flags.
 * This allows O(1) archetype matching with simple `&` checks.
 */
export const enum ComponentFlag {
    None = 0,
    Transform = 1 << 0,
    RigidBody = 1 << 1,
    Render = 1 << 2,
    CharacterStats = 1 << 3,
    InputState = 1 << 4,
    AIState = 1 << 5,
    Tag = 1 << 6,
}

// ─────────────────────────────────────────────────────────────────────────────
// Tag Bitmask (inside TagComponent's Uint32Array)
// ─────────────────────────────────────────────────────────────────────────────

export const enum TagBit {
    IsPlayer = 1 << 0,
    IsEnemy = 1 << 1,
    IsNPC = 1 << 2,
    IsInteractable = 1 << 3,
    IsVisible = 1 << 4,
    IsProjectile = 1 << 5,
    IsParticle = 1 << 6,
    IsDebris = 1 << 7,
    IsStatic = 1 << 8,
    IsKinematic = 1 << 9,
    IsTrigger = 1 << 10,
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Behavior FSM States
// ─────────────────────────────────────────────────────────────────────────────

export const enum AIBehavior {
    Idle = 0,
    Patrol = 1,
    Chase = 2,
    Attack = 3,
    Flee = 4,
    Search = 5,
    Interact = 6,
    Dead = 7,
}

// ─────────────────────────────────────────────────────────────────────────────
// Collider Shape Enum
// ─────────────────────────────────────────────────────────────────────────────

export const enum ColliderShape {
    Box = 0,
    Sphere = 1,
    Capsule = 2,
    Cylinder = 3,
    ConvexHull = 4,
    Trimesh = 5,
}

// ─────────────────────────────────────────────────────────────────────────────
// LOD Levels
// ─────────────────────────────────────────────────────────────────────────────

export const enum LODLevel {
    High = 0,
    Medium = 1,
    Low = 2,
    Impostor = 3,  // Billboard / sprite
}

// ─────────────────────────────────────────────────────────────────────────────
// Game State
// ─────────────────────────────────────────────────────────────────────────────

export const enum GameState {
    Menu = 0,
    Loading = 1,
    Playing = 2,
    Paused = 3,
}

// ─────────────────────────────────────────────────────────────────────────────
// Chunk Priority (for Dynamic Grid streaming)
// ─────────────────────────────────────────────────────────────────────────────

export const enum ChunkPriority {
    /** Player zone: full physics, full AI, full LOD */
    High = 0,
    /** Adjacent: LOD low, simplified physics, AI every 10 ticks */
    Medium = 1,
    /** Distant: impostors only, no physics, no AI */
    Low = 2,
    /** Not loaded */
    Unloaded = 3,
}

// ─────────────────────────────────────────────────────────────────────────────
// Component Strides (floats per entity per component)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stride = number of float32 elements consumed per entity in the SoA store.
 * Used to compute byte offsets: `entityIndex * stride`.
 */
export const COMPONENT_STRIDES = {
    Transform: 11, // pos(3) + rot(4) + scale(3) + parentID(1)
    RigidBody: 6,  // mass, friction, restitution, colliderShape, sensorFlags, collisionGroup
    Render: 5,  // modelRef, lodLevel, visible, castShadow, receiveShadow
    CharacterStats: 8,  // hp, hunger, stamina, stress, hygiene, bladder, addictionLevel, toxicity
    InputState: INPUT_BUFFER_SIZE * 8, // 16 entries × (moveDir3 + aimDir3 + actionBitmask + timestamp)
    AIState: 3 + AI_PATHING_NODE_COUNT * 2 + AI_MEMORY_ENTRY_COUNT * 2,
    // currentBehavior(1) + targetEntityID(1) + alertnessLevel(1)
    // + pathingNodes(32×2=64) + memoryBuffer(16×2=32) = 99
    Tag: 1,  // uint32 bitmask (stored in Uint32Array, but stride=1 element)
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Worker Message Protocol
// ─────────────────────────────────────────────────────────────────────────────

export const enum WorkerType {
    Physics = 'physics',
    Pathfinding = 'pathfinding',
    Procgen = 'procgen',
}

export const enum WorkerMessageType {
    Init = 'init',
    Step = 'step',
    Result = 'result',
    Error = 'error',
    Terminate = 'terminate',
    Ready = 'ready',
    SwapBuffer = 'swap_buffer',
}

export interface WorkerMessage {
    type: WorkerMessageType;
    payload?: unknown;
    timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SharedArrayBuffer Layout (for double-buffered transforms)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SAB layout for physics ↔ main thread synchronization.
 *
 * Byte 0..3:     Control word (Atomics: 0=page_A_active, 1=page_B_active)
 * Byte 4..7:     Entity count (Atomics)
 * Byte 8..N:     Page A — Transform data (MAX_ENTITIES × 7 floats: pos3 + rot4)
 * Byte N..2N-8:  Page B — Transform data (mirror)
 *
 * 7 floats × 4 bytes × 65536 entities × 2 pages ≈ 3.5 MB
 */
export const SAB_CONTROL_OFFSET = 0;
export const SAB_ENTITY_COUNT_OFFSET = 4;
export const SAB_DATA_OFFSET = 8;
export const SAB_TRANSFORM_FLOATS = 7; // pos(3) + rot(4)
export const SAB_PAGE_SIZE_BYTES = MAX_ENTITIES * SAB_TRANSFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT;
export const SAB_TOTAL_SIZE = SAB_DATA_OFFSET + SAB_PAGE_SIZE_BYTES * 2;

// ─────────────────────────────────────────────────────────────────────────────
// Utility: Bitmask helpers (inline-friendly, zero allocation)
// ─────────────────────────────────────────────────────────────────────────────

/** Check if `mask` has all bits in `flags` set. O(1). */
export function hasFlags(mask: number, flags: number): boolean {
    return (mask & flags) === flags;
}

/** Check if `mask` has any bit in `flags` set. O(1). */
export function hasAnyFlag(mask: number, flags: number): boolean {
    return (mask & flags) !== 0;
}

/** Set `flags` on `mask`. O(1). */
export function addFlags(mask: number, flags: number): number {
    return mask | flags;
}

/** Clear `flags` from `mask`. O(1). */
export function removeFlags(mask: number, flags: number): number {
    return mask & ~flags;
}

/** Toggle `flags` on `mask`. O(1). */
export function toggleFlags(mask: number, flags: number): number {
    return mask ^ flags;
}
