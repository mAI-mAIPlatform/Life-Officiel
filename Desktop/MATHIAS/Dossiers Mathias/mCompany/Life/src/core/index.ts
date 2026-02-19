/**
 * @module core
 * Barrel export for the LIFE RPG core engine.
 * Import via: import { GameEngine } from '@core'
 */

// Engine
export { GameEngine } from './GameEngine';

// ECS — World, Registries, System management
export {
    ECSWorld,
    ArchetypeRegistry,
    SystemManager,
    // Transform accessors
    setPosition,
    getPosition,
    setRotation,
    getRotation,
    setScale,
    setParent,
    // CharacterStats accessors
    getStat,
    setStat,
    modifyStat,
    StatIndex,
    // Interfaces
} from './ECSSetup';
export type { ComponentStores, Archetype, SystemDefinition } from './ECSSetup';

// Loop
export { LoopManager } from './LoopManager';

// Workers
export { WorkerBridge } from './WorkerBridge';

// Memory
export {
    ObjectPool,
    TempTypedPool,
    PoolDebugger,
    tempVec3Pool,
    tempQuatPool,
    tempMat4Pool,
    lerpVec3,
    slerpQuat,
    distSqVec3,
    dotVec3,
    normalizeVec3,
} from './MemoryPools';
export type { PoolStats } from './MemoryPools';

// Types
export type * from './types';
