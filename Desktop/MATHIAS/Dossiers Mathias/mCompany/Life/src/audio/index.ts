/**
 * @fileoverview LIFE Engine — Audio Module Barrel
 *
 * Import everything from this single entry point:
 *   import { AudioEngine, OcclusionSystem, MusicController, FoleyManager } from '@/audio';
 */

export { AudioEngine } from './AudioEngine';
export type { SoundEmitter3D, SoundEmitter3DOptions, PlayOptions } from './AudioEngine';

export { OcclusionSystem } from './OcclusionSystem';
export type { ReverbZone, ReverbZoneType, ReverbZoneAABB, ReverbZoneSphere } from './OcclusionSystem';

export { MusicController } from './MusicController';
export type { MusicState } from './MusicController';

export { FoleyManager } from './FoleyManager';
export type { FloorMaterial, UIEvent, VehicleSource } from './FoleyManager';
