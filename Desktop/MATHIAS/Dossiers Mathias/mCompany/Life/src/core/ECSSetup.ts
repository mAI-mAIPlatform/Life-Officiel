/**
 * @fileoverview LIFE Engine — ECS Core (Entity Component System)
 *
 * Architecture: Archetype-based, Struct-of-Arrays (SoA) storage.
 *
 * Design Rationale:
 * ────────────────
 * Traditional OOP (Object-of-Arrays / AoS) scatters component data across
 * heap objects, causing cache misses on every iteration. SoA stores each
 * component field in a contiguous TypedArray, so iterating over e.g. all
 * positions is a linear memory scan — maximizing L1/L2 cache hit ratio.
 *
 * Archetype Grouping:
 * ───────────────────
 * Entities with the same component set share an "archetype". Queries filter
 * by archetype bitmask first (O(A) where A = number of archetypes, typically
 * < 50), then iterate the dense entity list per archetype (O(N/A) average).
 * This avoids checking every entity against a query mask.
 *
 * Zero-Allocation:
 * ────────────────
 * All arrays are pre-allocated at world creation via MAX_ENTITIES. Entity
 * creation/destruction only flips bits and pushes/pops from a free-list
 * (Uint16Array stack). No `new`, no GC pressure at runtime.
 *
 * @module ECSSetup
 */

import {
    MAX_ENTITIES,
    COMPONENT_STRIDES,
    ComponentFlag,
    NULL_ENTITY,
    hasFlags,
    type EntityId,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Component Stores — SoA TypedArray Pools
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SoA component store: one contiguous TypedArray per component type.
 *
 * Access pattern for entity `e`, component stride `S`:
 *   offset = e * S
 *   data[offset + 0] .. data[offset + S-1]
 *
 * This is cache-friendly: sequential entity iteration walks linearly in memory.
 */
export interface ComponentStores {
    /** pos(3) + rot(4) + scale(3) + parentID(1) = 11 floats per entity */
    transform: Float32Array;
    /** mass, friction, restitution, colliderShape, sensorFlags, collisionGroup */
    rigidBody: Float32Array;
    /** modelRef, lodLevel, visible, castShadow, receiveShadow */
    render: Float32Array;
    /** hp, hunger, stamina, stress, hygiene, bladder, addictionLevel, toxicity */
    characterStats: Float32Array;
    /** Circular buffer: 16 entries × 8 floats */
    inputState: Float32Array;
    /** FSM state + pathing + memory = 99 floats */
    aiState: Float32Array;
    /** Uint32 bitmask per entity for fast tag checks */
    tag: Uint32Array;
}

/**
 * Allocate all component stores up-front. O(MAX_ENTITIES × total_stride).
 * Called once at engine init — never again.
 *
 * @returns Pre-zeroed SoA stores sized for MAX_ENTITIES.
 */
function createComponentStores(): ComponentStores {
    return {
        transform: new Float32Array(MAX_ENTITIES * COMPONENT_STRIDES.Transform),
        rigidBody: new Float32Array(MAX_ENTITIES * COMPONENT_STRIDES.RigidBody),
        render: new Float32Array(MAX_ENTITIES * COMPONENT_STRIDES.Render),
        characterStats: new Float32Array(MAX_ENTITIES * COMPONENT_STRIDES.CharacterStats),
        inputState: new Float32Array(MAX_ENTITIES * COMPONENT_STRIDES.InputState),
        aiState: new Float32Array(MAX_ENTITIES * COMPONENT_STRIDES.AIState),
        tag: new Uint32Array(MAX_ENTITIES * COMPONENT_STRIDES.Tag),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Transform Accessors (inlined helpers — zero allocation)
// ─────────────────────────────────────────────────────────────────────────────

const T_STRIDE = COMPONENT_STRIDES.Transform;

/**
 * Write position directly into the SoA transform buffer.
 * @param store - Transform Float32Array
 * @param e     - Entity index
 * @param x,y,z - World position
 */
export function setPosition(store: Float32Array, e: EntityId, x: number, y: number, z: number): void {
    const o = (e as number) * T_STRIDE;
    store[o] = x;
    store[o + 1] = y;
    store[o + 2] = z;
}

/** Read position: returns [x, y, z] by writing into a caller-supplied output array. */
export function getPosition(store: Float32Array, e: EntityId, out: Float32Array): void {
    const o = (e as number) * T_STRIDE;
    out[0] = store[o];
    out[1] = store[o + 1];
    out[2] = store[o + 2];
}

/**
 * Write quaternion rotation directly into the SoA transform buffer.
 * @param store - Transform Float32Array
 * @param e     - Entity index
 * @param x,y,z,w - Quaternion components
 */
export function setRotation(store: Float32Array, e: EntityId, x: number, y: number, z: number, w: number): void {
    const o = (e as number) * T_STRIDE + 3;
    store[o] = x;
    store[o + 1] = y;
    store[o + 2] = z;
    store[o + 3] = w;
}

/** Read rotation quaternion into a caller-supplied output array. */
export function getRotation(store: Float32Array, e: EntityId, out: Float32Array): void {
    const o = (e as number) * T_STRIDE + 3;
    out[0] = store[o];
    out[1] = store[o + 1];
    out[2] = store[o + 2];
    out[3] = store[o + 3];
}

/** Write uniform or non-uniform scale. */
export function setScale(store: Float32Array, e: EntityId, x: number, y: number, z: number): void {
    const o = (e as number) * T_STRIDE + 7;
    store[o] = x;
    store[o + 1] = y;
    store[o + 2] = z;
}

/** Set parent entity ID for transform hierarchy. */
export function setParent(store: Float32Array, e: EntityId, parent: EntityId): void {
    store[(e as number) * T_STRIDE + 10] = parent as number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CharacterStats Accessors
// ─────────────────────────────────────────────────────────────────────────────

const CS_STRIDE = COMPONENT_STRIDES.CharacterStats;

export const enum StatIndex {
    HP = 0,
    Hunger = 1,
    Stamina = 2,
    Stress = 3,
    Hygiene = 4,
    Bladder = 5,
    AddictionLevel = 6,
    Toxicity = 7,
}

/** Get a single stat value for entity `e`. O(1). */
export function getStat(store: Float32Array, e: EntityId, stat: StatIndex): number {
    return store[(e as number) * CS_STRIDE + stat];
}

/** Set a single stat value for entity `e`. O(1). */
export function setStat(store: Float32Array, e: EntityId, stat: StatIndex, value: number): void {
    store[(e as number) * CS_STRIDE + stat] = value;
}

/** Modify a stat by delta, clamped to [min, max]. O(1). */
export function modifyStat(
    store: Float32Array, e: EntityId, stat: StatIndex,
    delta: number, min: number = 0, max: number = 100,
): void {
    const idx = (e as number) * CS_STRIDE + stat;
    store[idx] = Math.max(min, Math.min(max, store[idx] + delta));
}

// ─────────────────────────────────────────────────────────────────────────────
// Archetype Registry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An archetype groups entities that share the exact same set of components.
 *
 * `mask` is the bitwise OR of all ComponentFlags.
 * `entities` is a dense array of entity IDs — enables fast iteration.
 * `entitySet` maps EntityId → index in `entities` for O(1) removal.
 */
export interface Archetype {
    /** Bitmask of ComponentFlag values */
    readonly mask: number;
    /** Dense packed entity IDs */
    entities: EntityId[];
    /** Map from EntityId to index in entities[] — O(1) lookup */
    entityIndex: Map<number, number>;
}

/**
 * Registry of all archetypes. Key = component bitmask.
 * Typically < 50 unique archetypes even in complex games.
 */
export class ArchetypeRegistry {
    private archetypes: Map<number, Archetype> = new Map();

    /**
     * Get or create the archetype for a given component mask.
     * Lazy creation — first entity with this combination creates the archetype.
     */
    getOrCreate(mask: number): Archetype {
        let arch = this.archetypes.get(mask);
        if (!arch) {
            arch = { mask, entities: [], entityIndex: new Map() };
            this.archetypes.set(mask, arch);
        }
        return arch;
    }

    /** Remove an entity from its archetype. O(1) swap-remove. */
    removeEntity(mask: number, entity: EntityId): void {
        const arch = this.archetypes.get(mask);
        if (!arch) return;
        const idx = arch.entityIndex.get(entity as number);
        if (idx === undefined) return;

        // Swap-remove: move last element into the vacated slot
        const last = arch.entities.length - 1;
        if (idx !== last) {
            const moved = arch.entities[last];
            arch.entities[idx] = moved;
            arch.entityIndex.set(moved as number, idx);
        }
        arch.entities.pop();
        arch.entityIndex.delete(entity as number);
    }

    /** Add an entity to its archetype. O(1) push. */
    addEntity(mask: number, entity: EntityId): void {
        const arch = this.getOrCreate(mask);
        arch.entityIndex.set(entity as number, arch.entities.length);
        arch.entities.push(entity);
    }

    /**
     * Query all archetypes that include ALL specified component flags.
     * Returns matching archetype objects for iteration.
     *
     * Complexity: O(A) where A = number of distinct archetypes (usually < 50).
     */
    query(requiredMask: number): Archetype[] {
        const result: Archetype[] = [];
        for (const arch of this.archetypes.values()) {
            if (hasFlags(arch.mask, requiredMask)) {
                result.push(arch);
            }
        }
        return result;
    }

    /** Get all registered archetypes (for debug). */
    getAll(): Archetype[] {
        return Array.from(this.archetypes.values());
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// System Definition & Manager
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A System is a pure function that operates on a subset of entities.
 * It declares which components it reads/writes, enabling dependency analysis.
 */
export interface SystemDefinition {
    /** Unique system name (for debugging & dependency graph). */
    name: string;
    /** Component flags this system READS. */
    readComponents: number;
    /** Component flags this system WRITES. */
    writeComponents: number;
    /** The query mask: system iterates entities matching ALL these flags. */
    queryMask: number;
    /**
     * The system's update function.
     * Called with pre-queried archetypes — the system iterates entities directly.
     *
     * @param world - Reference to the ECS world (stores + metadata)
     * @param archetypes - Pre-filtered archetypes matching `queryMask`
     * @param dt - Fixed or variable delta time
     */
    execute: (world: ECSWorld, archetypes: Archetype[], dt: number) => void;
    /** Priority hint: lower = runs earlier. Used by topological sort. */
    priority: number;
    /** Whether this system runs in FixedUpdate (true) or every frame (false). */
    fixedUpdate: boolean;
}

/**
 * Manages system registration, dependency-sorted execution order,
 * and per-frame / fixed-update dispatch.
 *
 * Topological ordering ensures a system that writes component X runs
 * before any system that reads component X (within the same phase).
 */
export class SystemManager {
    private systems: SystemDefinition[] = [];
    /** Cached sorted order — rebuilt on addSystem(). */
    private sortedFixedSystems: SystemDefinition[] = [];
    private sortedFrameSystems: SystemDefinition[] = [];
    private dirty = true;

    /**
     * Register a system. Marks the execution order cache as dirty.
     * Duplicate names will throw.
     */
    addSystem(system: SystemDefinition): void {
        if (this.systems.some(s => s.name === system.name)) {
            throw new Error(`[ECS] Duplicate system name: "${system.name}"`);
        }
        this.systems.push(system);
        this.dirty = true;
    }

    /** Remove a system by name. */
    removeSystem(name: string): void {
        this.systems = this.systems.filter(s => s.name !== name);
        this.dirty = true;
    }

    /**
     * Sort systems by dependency + priority.
     *
     * Simple heuristic: systems that write components depended on by others
     * should run first. We approximate this with:
     *   1. Systems that only WRITE (producers) come first
     *   2. Then mixed read/write
     *   3. Then read-only (consumers) last
     *   4. Within each tier, sort by priority (ascending)
     */
    private rebuildOrder(): void {
        if (!this.dirty) return;

        const withWeight = this.systems.map(s => {
            // Weight: writers first (lower weight), readers last (higher weight)
            let weight = 0;
            if (s.writeComponents !== 0) weight -= 1000;
            if (s.readComponents !== 0) weight += 500;
            weight += s.priority;
            return { system: s, weight };
        });

        withWeight.sort((a, b) => a.weight - b.weight);

        this.sortedFixedSystems = withWeight
            .filter(w => w.system.fixedUpdate)
            .map(w => w.system);

        this.sortedFrameSystems = withWeight
            .filter(w => !w.system.fixedUpdate)
            .map(w => w.system);

        this.dirty = false;
    }

    /**
     * Execute all fixed-update systems in dependency order.
     * Called by LoopManager at exactly 60 Hz.
     */
    executeFixed(world: ECSWorld, dt: number): void {
        this.rebuildOrder();
        for (let i = 0; i < this.sortedFixedSystems.length; i++) {
            const sys = this.sortedFixedSystems[i];
            const archetypes = world.archetypeRegistry.query(sys.queryMask);
            sys.execute(world, archetypes, dt);
        }
    }

    /**
     * Execute all per-frame systems (e.g., rendering prep, interpolation).
     * Called once per render frame.
     */
    executeFrame(world: ECSWorld, dt: number): void {
        this.rebuildOrder();
        for (let i = 0; i < this.sortedFrameSystems.length; i++) {
            const sys = this.sortedFrameSystems[i];
            const archetypes = world.archetypeRegistry.query(sys.queryMask);
            sys.execute(world, archetypes, dt);
        }
    }

    /** Debug: list systems in current execution order. */
    getExecutionOrder(): { fixed: string[]; frame: string[] } {
        this.rebuildOrder();
        return {
            fixed: this.sortedFixedSystems.map(s => s.name),
            frame: this.sortedFrameSystems.map(s => s.name),
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ECS World — Central data hub
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The ECS World owns all component data, entity metadata, and registries.
 * It is the single source of truth — passed by reference to every system.
 */
export class ECSWorld {
    /** SoA component data stores */
    readonly stores: ComponentStores;
    /** Archetype registry for query acceleration */
    readonly archetypeRegistry: ArchetypeRegistry;
    /** System scheduling & execution */
    readonly systemManager: SystemManager;

    /**
     * Per-entity component mask: which components does entity `e` have?
     * Used to determine archetype membership.
     */
    readonly entityMasks: Uint32Array;

    /**
     * Alive bitfield: 1 bit per entity. Packed into Uint32Array.
     * Soft-delete: clearing the bit "kills" the entity without deallocation.
     *
     * Check alive: (alive[e >> 5] & (1 << (e & 31))) !== 0
     */
    readonly alive: Uint32Array;

    /**
     * Free-list stack for recycled entity IDs.
     * O(1) push/pop — avoids linear scan when spawning.
     */
    private readonly freeList: Uint32Array;
    private freeListTop: number;

    /** Total number of currently alive entities. */
    private entityCount: number = 0;

    /**
     * Previous-frame transform snapshot for interpolation.
     * Stores pos(3) + rot(4) = 7 floats per entity.
     */
    readonly prevTransform: Float32Array;

    constructor() {
        this.stores = createComponentStores();
        this.archetypeRegistry = new ArchetypeRegistry();
        this.systemManager = new SystemManager();
        this.entityMasks = new Uint32Array(MAX_ENTITIES);
        this.alive = new Uint32Array(Math.ceil(MAX_ENTITIES / 32));
        this.prevTransform = new Float32Array(MAX_ENTITIES * 7);

        // Initialize free-list: all IDs available, in reverse order (pop gives 0 first)
        this.freeList = new Uint32Array(MAX_ENTITIES);
        for (let i = 0; i < MAX_ENTITIES; i++) {
            this.freeList[i] = MAX_ENTITIES - 1 - i;
        }
        this.freeListTop = MAX_ENTITIES;
    }

    // ─── Entity Lifecycle ────────────────────────────────────────────────────

    /**
     * Spawn a new entity with the given component mask.
     * Time complexity: O(1) — pops from free-list, sets bitmask, adds to archetype.
     *
     * @param componentMask - Bitwise OR of ComponentFlag values
     * @returns The new entity ID, or NULL_ENTITY if pool is exhausted.
     */
    spawn(componentMask: number): EntityId {
        if (this.freeListTop === 0) {
            console.warn('[ECS] Entity pool exhausted! MAX_ENTITIES =', MAX_ENTITIES);
            return NULL_ENTITY;
        }

        const id = this.freeList[--this.freeListTop] as EntityId;

        // Mark alive
        this.alive[(id as number) >> 5] |= 1 << ((id as number) & 31);
        this.entityMasks[id as number] = componentMask;

        // Initialize default Transform (identity)
        if (hasFlags(componentMask, ComponentFlag.Transform)) {
            const o = (id as number) * COMPONENT_STRIDES.Transform;
            // position = (0,0,0) — already zeroed
            // rotation = identity quaternion (0,0,0,1)
            this.stores.transform[o + 6] = 1; // w = 1
            // scale = (1,1,1)
            this.stores.transform[o + 7] = 1;
            this.stores.transform[o + 8] = 1;
            this.stores.transform[o + 9] = 1;
            // parentID = NULL_ENTITY (-1)
            this.stores.transform[o + 10] = NULL_ENTITY as number;
        }

        // Register in archetype
        this.archetypeRegistry.addEntity(componentMask, id);
        this.entityCount++;

        return id;
    }

    /**
     * Soft-delete an entity: clear alive bit, return ID to free-list.
     * The data is NOT zeroed — it's overwritten when the ID is reused.
     * Time complexity: O(1).
     */
    despawn(entity: EntityId): void {
        const id = entity as number;
        if (!this.isAlive(entity)) return;

        // Clear alive bit
        this.alive[id >> 5] &= ~(1 << (id & 31));

        // Remove from archetype
        const mask = this.entityMasks[id];
        this.archetypeRegistry.removeEntity(mask, entity);

        // Return to free-list
        this.freeList[this.freeListTop++] = id;
        this.entityCount--;
    }

    /** Check if entity is alive. O(1) bitfield check. */
    isAlive(entity: EntityId): boolean {
        const id = entity as number;
        return (this.alive[id >> 5] & (1 << (id & 31))) !== 0;
    }

    /**
     * Add a component to a living entity. Moves it between archetypes.
     * O(1) swap-remove from old archetype + O(1) push to new archetype.
     */
    addComponent(entity: EntityId, flag: ComponentFlag): void {
        if (!this.isAlive(entity)) return;
        const id = entity as number;
        const oldMask = this.entityMasks[id];
        if (hasFlags(oldMask, flag)) return; // already has it

        const newMask = oldMask | flag;
        this.archetypeRegistry.removeEntity(oldMask, entity);
        this.entityMasks[id] = newMask;
        this.archetypeRegistry.addEntity(newMask, entity);
    }

    /**
     * Remove a component from a living entity. Moves it between archetypes.
     */
    removeComponent(entity: EntityId, flag: ComponentFlag): void {
        if (!this.isAlive(entity)) return;
        const id = entity as number;
        const oldMask = this.entityMasks[id];
        if (!hasFlags(oldMask, flag)) return; // doesn't have it

        const newMask = oldMask & ~flag;
        this.archetypeRegistry.removeEntity(oldMask, entity);
        this.entityMasks[id] = newMask;
        this.archetypeRegistry.addEntity(newMask, entity);
    }

    /** Get count of alive entities. */
    getEntityCount(): number {
        return this.entityCount;
    }

    /**
     * Snapshot current transforms into prevTransform buffer.
     * Called at the START of each FixedUpdate. Enables SLERP interpolation.
     *
     * Copies only pos + rot (7 floats) for alive entities with Transform.
     */
    snapshotTransforms(): void {
        const src = this.stores.transform;
        const dst = this.prevTransform;
        const archetypes = this.archetypeRegistry.query(ComponentFlag.Transform);

        for (let a = 0; a < archetypes.length; a++) {
            const entities = archetypes[a].entities;
            for (let i = 0; i < entities.length; i++) {
                const e = entities[i] as number;
                const srcOff = e * COMPONENT_STRIDES.Transform;
                const dstOff = e * 7;
                // Copy pos(3) + rot(4) = 7 floats
                dst[dstOff] = src[srcOff];
                dst[dstOff + 1] = src[srcOff + 1];
                dst[dstOff + 2] = src[srcOff + 2];
                dst[dstOff + 3] = src[srcOff + 3];
                dst[dstOff + 4] = src[srcOff + 4];
                dst[dstOff + 5] = src[srcOff + 5];
                dst[dstOff + 6] = src[srcOff + 6];
            }
        }
    }

    /**
     * Reset the world — despawn all entities, flush free-list.
     * Used when transitioning between game scenes.
     */
    reset(): void {
        this.alive.fill(0);
        this.entityMasks.fill(0);
        this.entityCount = 0;
        for (let i = 0; i < MAX_ENTITIES; i++) {
            this.freeList[i] = MAX_ENTITIES - 1 - i;
        }
        this.freeListTop = MAX_ENTITIES;
    }
}
