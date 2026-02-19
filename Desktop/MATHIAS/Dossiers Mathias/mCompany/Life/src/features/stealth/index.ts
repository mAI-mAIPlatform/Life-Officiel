/**
 * @module features/stealth
 * Stealth & awareness feature barrel.
 *
 * Import via: import { SensorManager, WantedLevelSystem } from '@features/stealth'
 */

export {
    SensorManager,
    SensorComponent,
    VisionCone,
    HearingSystem,
    LightLevelSystem,
    NoiseEventBus,
    WantedLevelSystem,
    SENSOR_CONSTANTS,
} from '../../gameplay/StealthSensors';

export type {
    AIAgent,
    NoiseEvent,
    IWorldQuery,
    IPlayerHandle,
    BehaviorController,
    WantedLevelCallbacks,
} from '../../gameplay/StealthSensors';
