/**
 * @fileoverview LIFE — VehiclePhysics.ts
 * @description  Arcade/Simulation hybrid Raycast Vehicle controller.
 *
 * Architecture:
 *  - VehicleProfile: per-model tunable parameters.
 *  - WheelState:     per-wheel suspension, contact and force accumulators.
 *  - VehicleController: main simulation loop.
 *  - VehicleDamageState: localized damage with visual + mechanical effects.
 *
 * Physics model:
 *  - Suspension via spring-damper raycast per wheel.
 *  - Engine torque → wheel angular velocity → linear force.
 *  - Lateral friction slip curve: Pacejka "magic formula" simplified.
 *  - Handbrake locks rear wheels → controlled oversteer/drift.
 */

import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Vehicle Profile (per-model)
// ─────────────────────────────────────────────────────────────────────────────

export interface VehicleProfile {
    name: string;
    // Engine
    enginePower: number; // kW equivalent
    maxSpeedKPH: number;
    engineBraking: number;
    gearRatios: number[];
    finalDrive: number;
    // Braking
    brakingForce: number;
    brakeBalance: number; // 0=rear,1=front
    // Suspension
    suspensionRestLength: number; // m
    suspensionStiffness: number; // N/m
    suspensionDamping: number;
    suspensionTravel: number; // m
    // Steering
    maxSteerAngle: number; // radians
    steerSpeed: number;
    steerReturnSpeed: number;
    speedSensitiveSteering: boolean;
    // Friction & Drift
    frictionSlip: number;
    lateralFriction: number;
    driftSlipAngle: number; // radians
    driftFrictionMult: number;
    // Body
    mass: number; // kg
    centerOfMassOffset: THREE.Vector3;
    wheelBase: number; // m
    trackWidth: number; // m
    wheelRadius: number; // m
}

export const VEHICLE_PROFILES: Record<string, VehicleProfile> = {
    sedan: {
        name: 'Sedan', enginePower: 120, maxSpeedKPH: 180, engineBraking: 0.15,
        gearRatios: [3.5, 2.1, 1.4, 1.0, 0.72], finalDrive: 3.7,
        brakingForce: 8000, brakeBalance: 0.62,
        suspensionRestLength: 0.35, suspensionStiffness: 22000, suspensionDamping: 2800, suspensionTravel: 0.18,
        maxSteerAngle: 0.55, steerSpeed: 3.0, steerReturnSpeed: 4.0, speedSensitiveSteering: true,
        frictionSlip: 1.6, lateralFriction: 1.8, driftSlipAngle: 0.18, driftFrictionMult: 0.55,
        mass: 1400, centerOfMassOffset: new THREE.Vector3(0, -0.3, 0.1),
        wheelBase: 2.7, trackWidth: 1.6, wheelRadius: 0.33,
    },
    sportscar: {
        name: 'Sports Car', enginePower: 320, maxSpeedKPH: 320, engineBraking: 0.08,
        gearRatios: [3.2, 2.0, 1.35, 1.0, 0.68, 0.55], finalDrive: 3.5,
        brakingForce: 14000, brakeBalance: 0.70,
        suspensionRestLength: 0.28, suspensionStiffness: 42000, suspensionDamping: 4500, suspensionTravel: 0.13,
        maxSteerAngle: 0.60, steerSpeed: 4.0, steerReturnSpeed: 5.0, speedSensitiveSteering: true,
        frictionSlip: 2.4, lateralFriction: 2.8, driftSlipAngle: 0.12, driftFrictionMult: 0.70,
        mass: 1100, centerOfMassOffset: new THREE.Vector3(0, -0.45, -0.2),
        wheelBase: 2.5, trackWidth: 1.7, wheelRadius: 0.30,
    },
    suv: {
        name: 'SUV', enginePower: 160, maxSpeedKPH: 200, engineBraking: 0.12,
        gearRatios: [3.7, 2.3, 1.5, 1.0, 0.78], finalDrive: 4.1,
        brakingForce: 10000, brakeBalance: 0.58,
        suspensionRestLength: 0.45, suspensionStiffness: 28000, suspensionDamping: 3200, suspensionTravel: 0.24,
        maxSteerAngle: 0.48, steerSpeed: 2.5, steerReturnSpeed: 3.5, speedSensitiveSteering: true,
        frictionSlip: 1.5, lateralFriction: 1.6, driftSlipAngle: 0.22, driftFrictionMult: 0.45,
        mass: 2100, centerOfMassOffset: new THREE.Vector3(0, -0.1, 0.0),
        wheelBase: 3.0, trackWidth: 1.75, wheelRadius: 0.38,
    },
    motorcycle: {
        name: 'Motorcycle', enginePower: 80, maxSpeedKPH: 240, engineBraking: 0.20,
        gearRatios: [3.2, 2.2, 1.6, 1.2, 0.9, 0.7], finalDrive: 3.0,
        brakingForce: 6000, brakeBalance: 0.55,
        suspensionRestLength: 0.32, suspensionStiffness: 18000, suspensionDamping: 2200, suspensionTravel: 0.16,
        maxSteerAngle: 0.55, steerSpeed: 4.5, steerReturnSpeed: 5.5, speedSensitiveSteering: true,
        frictionSlip: 1.8, lateralFriction: 2.0, driftSlipAngle: 0.15, driftFrictionMult: 0.6,
        mass: 220, centerOfMassOffset: new THREE.Vector3(0, -0.15, 0.0),
        wheelBase: 1.4, trackWidth: 0.0, wheelRadius: 0.29,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Wheel
// ─────────────────────────────────────────────────────────────────────────────

export interface WheelConfig {
    localPosition: THREE.Vector3;
    isPowered: boolean;
    isSteered: boolean;
    isHandbraked: boolean;
}

export interface WheelState {
    config: WheelConfig;
    compressionRatio: number;
    springForce: number;
    damperForce: number;
    previousLength: number;
    contactPoint: THREE.Vector3 | null;
    contactNormal: THREE.Vector3;
    isGrounded: boolean;
    angularVelocity: number;
    steerAngle: number;
    slipRatio: number;
    slipAngle: number;
    isDrifting: boolean;
    flatTire: boolean;
    worldPosition: THREE.Vector3;
}

// ─────────────────────────────────────────────────────────────────────────────
// Physics body interface
// ─────────────────────────────────────────────────────────────────────────────

export interface IVehiclePhysicsBody {
    position(): THREE.Vector3;
    rotation(): THREE.Quaternion;
    velocity(): THREE.Vector3;
    applyForceAtPoint(force: THREE.Vector3, worldPoint: THREE.Vector3): void;
    castRay(from: THREE.Vector3, dir: THREE.Vector3, maxDist: number): {
        hit: boolean; distance: number; normal: THREE.Vector3;
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pacejka Magic Formula (simplified)
// ─────────────────────────────────────────────────────────────────────────────

function pacejkaLateral(slipAngle: number, peak: number): number {
    const B = 10, C = 1.9, D = peak, E = 0.97;
    return D * Math.sin(C * Math.atan(B * slipAngle - E * (B * slipAngle - Math.atan(B * slipAngle))));
}

function pacejkaLongitudinal(slipRatio: number, peak: number): number {
    const B = 11, C = 1.65, D = peak;
    return D * Math.sin(C * Math.atan(B * slipRatio));
}

// ─────────────────────────────────────────────────────────────────────────────
// Vehicle Controller
// ─────────────────────────────────────────────────────────────────────────────

export class VehicleController {
    readonly profile: VehicleProfile;
    wheels: WheelState[];
    damage: VehicleDamageState;

    private throttle: number = 0;
    private brake: number = 0;
    private handbrake: boolean = false;
    private steerInput: number = 0;
    private currentSteer: number = 0;
    private currentGear: number = 0;
    private rpm: number = 800;

    private readonly MAX_RPM = 7500;
    private readonly IDLE_RPM = 800;

    constructor(profile: VehicleProfile, wheelConfigs: WheelConfig[]) {
        this.profile = profile;
        this.damage = new VehicleDamageState();
        this.wheels = wheelConfigs.map(cfg => ({
            config: cfg, compressionRatio: 0, springForce: 0, damperForce: 0,
            previousLength: profile.suspensionRestLength, contactPoint: null,
            contactNormal: new THREE.Vector3(0, 1, 0), isGrounded: false,
            angularVelocity: 0, steerAngle: 0, slipRatio: 0, slipAngle: 0,
            isDrifting: false, flatTire: false, worldPosition: cfg.localPosition.clone(),
        }));
    }

    setThrottle(v: number): void { this.throttle = THREE.MathUtils.clamp(v, 0, 1); }
    setBrake(v: number): void { this.brake = THREE.MathUtils.clamp(v, 0, 1); }
    setHandbrake(v: boolean): void { this.handbrake = v; }
    setSteering(v: number): void { this.steerInput = THREE.MathUtils.clamp(v, -1, 1); }

    fixedUpdate(body: IVehiclePhysicsBody, dt: number): void {
        const velocity = body.velocity();
        const speedKPH = velocity.length() * 3.6;

        // Speed-sensitive steering
        const steerMult = this.profile.speedSensitiveSteering
            ? Math.max(0.25, 1.0 - (speedKPH / this.profile.maxSpeedKPH) * 0.70) : 1.0;
        const targetSteer = this.steerInput * this.profile.maxSteerAngle * steerMult;
        const steerRate = Math.abs(this.steerInput) > 0.01 ? this.profile.steerSpeed : this.profile.steerReturnSpeed;
        const delta = targetSteer - this.currentSteer;
        this.currentSteer += Math.sign(delta) * Math.min(Math.abs(delta), steerRate * dt);

        this.updateGearbox(speedKPH);

        let groundedCount = 0;
        for (const wheel of this.wheels) {
            this.updateSuspension(wheel, body, dt);
            if (wheel.isGrounded) { this.updateFriction(wheel, body, velocity, dt); groundedCount++; }
        }

        if (groundedCount > 0 && this.throttle < 0.05 && this.brake < 0.05) {
            const speed = velocity.length();
            if (speed > 0.2) {
                const decel = this.profile.engineBraking * speed * this.profile.mass;
                body.applyForceAtPoint(velocity.clone().normalize().multiplyScalar(-decel * dt), body.position());
            }
        }

        this.damage.tick(dt);
    }

    private updateSuspension(wheel: WheelState, body: IVehiclePhysicsBody, dt: number): void {
        const rot = body.rotation();
        const worldOffset = wheel.config.localPosition.clone().applyQuaternion(rot);
        wheel.worldPosition.copy(body.position()).add(worldOffset);

        if (wheel.config.isSteered) wheel.steerAngle = this.currentSteer;

        const rayDown = new THREE.Vector3(0, -1, 0).applyQuaternion(rot);
        const maxDist = this.profile.suspensionRestLength + this.profile.suspensionTravel + this.profile.wheelRadius;
        const hit = body.castRay(wheel.worldPosition, rayDown, maxDist);

        if (hit.hit) {
            wheel.isGrounded = true;
            wheel.contactPoint = wheel.worldPosition.clone().add(rayDown.clone().multiplyScalar(hit.distance));
            wheel.contactNormal.copy(hit.normal);

            const currentLen = hit.distance - this.profile.wheelRadius;
            const compression = this.profile.suspensionRestLength - currentLen;
            wheel.compressionRatio = compression / this.profile.suspensionTravel;
            wheel.springForce = compression * this.profile.suspensionStiffness;

            const compVel = (currentLen - wheel.previousLength) / dt;
            wheel.damperForce = -compVel * this.profile.suspensionDamping;
            wheel.previousLength = currentLen;

            const totalForce = wheel.springForce + wheel.damperForce;
            if (totalForce > 0) {
                body.applyForceAtPoint(hit.normal.clone().multiplyScalar(totalForce), wheel.contactPoint);
            }
        } else {
            wheel.isGrounded = false;
            wheel.contactPoint = null;
            wheel.previousLength = this.profile.suspensionRestLength;
        }
    }

    private updateFriction(wheel: WheelState, body: IVehiclePhysicsBody, velocity: THREE.Vector3, dt: number): void {
        if (!wheel.contactPoint) return;

        const effectiveFriction = wheel.flatTire ? this.profile.frictionSlip * 0.2 : this.profile.frictionSlip;
        const rot = body.rotation();

        const wheelFwd = new THREE.Vector3(Math.sin(wheel.steerAngle), 0, Math.cos(wheel.steerAngle)).applyQuaternion(rot);
        const wheelRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), wheelFwd).normalize();

        const vehicleLong = velocity.dot(wheelFwd);
        const vehicleLat = velocity.dot(wheelRight);

        // Engine torque
        if (wheel.config.isPowered && this.throttle > 0 && !wheel.flatTire) {
            const ratio = this.profile.gearRatios[this.currentGear] ?? 1;
            const torque = this.computeEngineTorque(this.rpm) * ratio * this.profile.finalDrive * this.throttle;
            const dmgMult = this.damage.engine > 0.7 ? 0.4 : 1.0;
            wheel.angularVelocity += (torque * dmgMult / (this.profile.mass * this.profile.wheelRadius * 0.5)) * dt;
        }

        // Braking
        const brakeForce = this.brake * this.profile.brakingForce *
            (wheel.config.isHandbraked ? 1 - this.profile.brakeBalance : this.profile.brakeBalance);
        const handbrakeMult = (this.handbrake && wheel.config.isHandbraked) ? 3.0 : 0.0;
        const totalBrake = brakeForce + handbrakeMult * this.profile.brakingForce;
        const brakeTorque = -(Math.sign(wheel.angularVelocity) * totalBrake * this.profile.wheelRadius);
        wheel.angularVelocity = THREE.MathUtils.clamp(wheel.angularVelocity + brakeTorque * dt, -80, 80);

        const wheelLinear = wheel.angularVelocity * this.profile.wheelRadius;
        const maxSpd = Math.max(Math.abs(vehicleLong), Math.abs(wheelLinear), 0.001);
        wheel.slipRatio = (wheelLinear - vehicleLong) / maxSpd;
        wheel.slipAngle = Math.abs(vehicleLat) > 0.1 ? Math.atan2(vehicleLat, Math.abs(vehicleLong) + 0.001) : 0;
        wheel.isDrifting = Math.abs(wheel.slipAngle) > this.profile.driftSlipAngle && (this.handbrake || this.throttle > 0.5);

        const latFriction = wheel.isDrifting ? this.profile.lateralFriction * this.profile.driftFrictionMult : this.profile.lateralFriction;

        const longForce = pacejkaLongitudinal(wheel.slipRatio, effectiveFriction);
        const latForce = pacejkaLateral(wheel.slipAngle, latFriction);

        body.applyForceAtPoint(wheelFwd.clone().multiplyScalar(longForce * dt), wheel.contactPoint);
        body.applyForceAtPoint(wheelRight.clone().multiplyScalar(-latForce * dt), wheel.contactPoint);

        // Speed cap enforcement
        const speedKPH = velocity.length() * 3.6;
        const maxEff = this.damage.engine > 0.7 ? this.profile.maxSpeedKPH * 0.5 : this.profile.maxSpeedKPH;
        if (speedKPH > maxEff && this.throttle > 0) {
            const overSpeed = (speedKPH - maxEff) / 3.6;
            body.applyForceAtPoint(
                velocity.clone().normalize().multiplyScalar(-overSpeed * this.profile.mass * 0.2),
                wheel.contactPoint
            );
        }
    }

    private computeEngineTorque(rpm: number): number {
        const normalized = rpm / this.MAX_RPM;
        const curve = Math.sin(normalized * Math.PI * 0.85 + 0.1);
        return this.profile.enginePower * Math.max(0.2, curve);
    }

    private updateGearbox(speedKPH: number): void {
        const gears = this.profile.gearRatios;
        const speedMS = speedKPH / 3.6;
        const ratio = gears[this.currentGear] ?? 1;
        this.rpm = THREE.MathUtils.clamp(
            (speedMS / this.profile.wheelRadius) * ratio * this.profile.finalDrive * (60 / (Math.PI * 2)),
            this.IDLE_RPM, this.MAX_RPM
        );
        if (this.rpm > this.MAX_RPM * 0.85 && this.currentGear < gears.length - 1) this.currentGear++;
        else if (this.rpm < this.MAX_RPM * 0.40 && this.currentGear > 0) this.currentGear--;
    }

    get driftState(): { anyDrifting: boolean; avgSlipAngle: number } {
        const drifting = this.wheels.filter(w => w.isDrifting);
        return {
            anyDrifting: drifting.length > 0,
            avgSlipAngle: drifting.reduce((s, w) => s + w.slipAngle, 0) / Math.max(drifting.length, 1),
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Vehicle Damage State
// ─────────────────────────────────────────────────────────────────────────────

export enum DamageZone {
    HOOD = 'HOOD',
    TRUNK = 'TRUNK',
    LEFT_DOOR = 'LEFT_DOOR',
    RIGHT_DOOR = 'RIGHT_DOOR',
    WINDSHIELD = 'WINDSHIELD',
    ENGINE = 'ENGINE',
    FUEL_TANK = 'FUEL_TANK',
    WHEEL_FL = 'WHEEL_FL',
    WHEEL_FR = 'WHEEL_FR',
    WHEEL_RL = 'WHEEL_RL',
    WHEEL_RR = 'WHEEL_RR',
}

export interface VehicleDamageEvent {
    zone: DamageZone;
    value: number;
    type: 'visual_deform' | 'engine_smoke' | 'engine_fire' | 'fuel_leak' | 'flat_tire' | 'explosion_risk';
}

export class VehicleDamageState {
    panels: Map<DamageZone, number> = new Map(Object.values(DamageZone).map(z => [z as DamageZone, 0]));
    engine: number = 0;     // [0,1]
    fuel: number = 1.0;
    fuelLeakRate: number = 0;
    engineOnFire: boolean = false;
    pendingExplosion: boolean = false;

    applyImpact(zone: DamageZone, amount: number): VehicleDamageEvent[] {
        const events: VehicleDamageEvent[] = [];
        const current = (this.panels.get(zone) ?? 0);
        this.panels.set(zone, Math.min(1, current + amount));
        events.push({ zone, value: Math.min(1, current + amount), type: 'visual_deform' });

        if (zone === DamageZone.ENGINE) {
            this.engine = Math.min(1, this.engine + amount * 1.2);
            if (this.engine > 0.5) events.push({ zone, value: this.engine, type: 'engine_smoke' });
            if (this.engine > 0.85) events.push({ zone, value: this.engine, type: 'engine_fire' });
        }

        if (zone === DamageZone.FUEL_TANK) {
            const dmg = this.panels.get(DamageZone.FUEL_TANK) ?? 0;
            if (dmg > 0.4) { this.fuelLeakRate = dmg * 0.08; events.push({ zone, value: this.fuelLeakRate, type: 'fuel_leak' }); }
        }

        const wheelZones: DamageZone[] = [DamageZone.WHEEL_FL, DamageZone.WHEEL_FR, DamageZone.WHEEL_RL, DamageZone.WHEEL_RR];
        if (wheelZones.includes(zone) && (this.panels.get(zone) ?? 0) >= 0.85) {
            events.push({ zone, value: 1, type: 'flat_tire' });
        }
        return events;
    }

    tick(dt: number): VehicleDamageEvent[] {
        const events: VehicleDamageEvent[] = [];
        if (this.fuelLeakRate > 0) {
            this.fuel = Math.max(0, this.fuel - this.fuelLeakRate * dt);
            if (this.fuel <= 0 && this.engine > 0.5) {
                this.engineOnFire = true;
                this.pendingExplosion = true;
                events.push({ zone: DamageZone.FUEL_TANK, value: 0, type: 'explosion_risk' });
            }
        }
        return events;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory helpers
// ─────────────────────────────────────────────────────────────────────────────

export function createDefaultWheelConfigs(profile: VehicleProfile): WheelConfig[] {
    const hx = profile.trackWidth / 2;
    const hz = profile.wheelBase / 2;
    return [
        { localPosition: new THREE.Vector3(-hx, 0, hz), isPowered: false, isSteered: true, isHandbraked: false },
        { localPosition: new THREE.Vector3(hx, 0, hz), isPowered: false, isSteered: true, isHandbraked: false },
        { localPosition: new THREE.Vector3(-hx, 0, -hz), isPowered: true, isSteered: false, isHandbraked: true },
        { localPosition: new THREE.Vector3(hx, 0, -hz), isPowered: true, isSteered: false, isHandbraked: true },
    ];
}

export function createVehicle(profileKey: string): VehicleController {
    const profile = VEHICLE_PROFILES[profileKey];
    if (!profile) throw new Error(`Unknown vehicle profile: "${profileKey}"`);
    return new VehicleController(profile, createDefaultWheelConfigs(profile));
}
