/**
 * @module features/traffic
 * Traffic & vehicle feature barrel.
 *
 * Import via: import { VehicleController, createVehicle } from '@features/traffic'
 */

export {
    VehicleController,
    VehicleDamageState,
    createVehicle,
    createDefaultWheelConfigs,
    VEHICLE_PROFILES,
    DamageZone,
} from '../../gameplay/VehiclePhysics';

export type {
    VehicleProfile,
    WheelConfig,
    WheelState,
    IVehiclePhysicsBody,
    VehicleDamageEvent,
} from '../../gameplay/VehiclePhysics';
