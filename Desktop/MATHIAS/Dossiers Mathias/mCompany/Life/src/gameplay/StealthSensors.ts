/**
 * @fileoverview LIFE — StealthSensors.ts
 * @description  Realistic AI Perception System (VisionCone, HearingSystem, LightLevel)
 *               and a full Wanted Level state machine (Investigation → Chase → Tactical → Escalation).
 *
 * Architecture:
 *  - SensorComponent: attached to each AI entity, owns its perception state.
 *  - SensorManager: orchestrates all sensors, updated at AI tick rate (10Hz).
 *  - WantedLevelSystem: singleton managing the global police response escalation.
 *  - NoiseEventBus: decoupled pubsub so gameplay systems can emit NoiseEvents
 *    without tight coupling to AI.
 */

import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const SENSOR_CONSTANTS = {
    // Vision
    VISION_FOV_DEFAULT: 110,    // degrees — total arc
    VISION_RANGE_NEAR: 8,      // m — full detection speed
    VISION_RANGE_FAR: 30,     // m — reduced detection speed
    VISION_PERIPH_FOV: 200,    // degrees — peripheral zone (slow detection)
    VISION_MULTICAST_OFFSETS: [   // local offsets on target for multipoint occlusion check
        new THREE.Vector3(0, 1.7, 0), // head
        new THREE.Vector3(0, 0.9, 0), // torso
        new THREE.Vector3(0, 0.1, 0), // feet
        new THREE.Vector3(0.3, 0.9, 0), // left shoulder
        new THREE.Vector3(-0.3, 0.9, 0), // right shoulder
    ],

    // Awareness gauge
    AWARENESS_MAX: 100,
    AWARENESS_RATE_NEAR: 45,    // units/sec inside near zone
    AWARENESS_RATE_FAR: 18,    // units/sec in far zone
    AWARENESS_RATE_PERIPH: 8,     // units/sec peripheral
    AWARENESS_DECAY_IDLE: 12,    // units/sec decay when no LOS
    AWARENESS_CURIOUS_THR: 25,    // threshold to enter CURIOUS
    AWARENESS_SUSPECT_THR: 60,    // threshold to enter SUSPECT
    AWARENESS_HOSTILE_THR: 100,   // threshold to enter HOSTILE

    // Hearing
    NOISE_PROPAGATION_SPEED: 340,  // m/s (speed of sound — instant for gameplay, but max radius per type)
    HEARING_OCCLUSION_WALL: 0.4, // factor per wall crossed (0 = total block, 1 = no attenuation)
    HEARING_OCCLUSION_CHECKS: 3, // number of sample rays for occlusion

    // Light
    LIGHT_DETECTION_MULT_MAX: 1.5, // fully lit → 50% faster detection
    LIGHT_DETECTION_MULT_MIN: 0.0, // in shadow → no visual detection

    // Wanted level timing
    WANTED_INVESTIGATE_TIME: 20,  // seconds before giving up in phase 1
    WANTED_CHASE_TIMEOUT: 60,  // secconds of no LOS before downgrading
    WANTED_RADIO_RANGE: 80,  // m — inter-unit communication radius
    WANTED_ESCALATION_THRESH: [0, 1, 3, 7], // thresholds per phase
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

export const enum AlertState {
    IDLE = 'IDLE',
    CURIOUS = 'CURIOUS',
    SUSPECT = 'SUSPECT',
    HOSTILE = 'HOSTILE',
}

export const enum WantedPhase {
    NONE = 0,
    INVESTIGATION = 1,
    CHASE = 2,
    TACTICAL = 3,
    ESCALATION = 4,
}

export const enum NoiseType {
    CROUCH_WALK = 'CROUCH_WALK',
    WALK = 'WALK',
    SPRINT = 'SPRINT',
    LAND = 'LAND',
    MELEE = 'MELEE',
    SILENCED_GUN = 'SILENCED_GUN',
    GUNSHOT = 'GUNSHOT',
    EXPLOSION = 'EXPLOSION',
    VEHICLE = 'VEHICLE',
    GLASS_BREAK = 'GLASS_BREAK',
}

// ─────────────────────────────────────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface IWorldQuery {
    /** Cast a ray and return the first hit (occlusion check). */
    castRay(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, mask?: number): { hit: boolean; distance: number; normal: THREE.Vector3; tag: string };
    /** Get current ambient light level [0,1] at a world position. */
    getLightLevel(pos: THREE.Vector3): number;
    /** Get all AI agent handles in radius. */
    getAgentsInRadius(center: THREE.Vector3, radius: number): AIAgent[];
}

export interface IPlayerHandle {
    position(): THREE.Vector3;
    velocity(): THREE.Vector3;
    isInShadow(): boolean;
    lightExposure(): number;   // 0.0 (dark) → 1.0 (fully lit)
    isCrouching(): boolean;
}

/** Minimum data surface of an AI agent. */
export interface AIAgent {
    id: string;
    position(): THREE.Vector3;
    lookAt(): THREE.Vector3;  // world-space look direction
    sensor: SensorComponent;
    behavior: BehaviorController;
}

export interface NoiseEvent {
    type: NoiseType;
    position: THREE.Vector3;
    radius: number;          // effective hearing radius in meters
    timestamp: number;
}

/** Loudness table — maps noise type to effective radius in meters. */
const NOISE_RADIUS: Record<NoiseType, number> = {
    [NoiseType.CROUCH_WALK]: 3,
    [NoiseType.WALK]: 8,
    [NoiseType.SPRINT]: 16,
    [NoiseType.LAND]: 12,
    [NoiseType.MELEE]: 10,
    [NoiseType.SILENCED_GUN]: 6,
    [NoiseType.GUNSHOT]: 50,
    [NoiseType.EXPLOSION]: 120,
    [NoiseType.VEHICLE]: 30,
    [NoiseType.GLASS_BREAK]: 15,
};

// ─────────────────────────────────────────────────────────────────────────────
// Noise Event Bus
// ─────────────────────────────────────────────────────────────────────────────

export class NoiseEventBus {
    private static _instance: NoiseEventBus;
    private queue: NoiseEvent[] = [];
    private listeners: Array<(e: NoiseEvent) => void> = [];

    static get instance(): NoiseEventBus {
        if (!NoiseEventBus._instance) NoiseEventBus._instance = new NoiseEventBus();
        return NoiseEventBus._instance;
    }

    emit(type: NoiseType, position: THREE.Vector3): void {
        const event: NoiseEvent = {
            type,
            position: position.clone(),
            radius: NOISE_RADIUS[type],
            timestamp: performance.now(),
        };
        this.queue.push(event);
        this.listeners.forEach(fn => fn(event));
    }

    subscribe(fn: (e: NoiseEvent) => void): () => void {
        this.listeners.push(fn);
        return () => { this.listeners = this.listeners.filter(l => l !== fn); };
    }

    flush(): NoiseEvent[] {
        const batch = this.queue;
        this.queue = [];
        return batch;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// VisionCone
// ─────────────────────────────────────────────────────────────────────────────

export class VisionCone {
    fovDeg: number;
    rangeFar: number;
    rangeNear: number;

    constructor(fovDeg = SENSOR_CONSTANTS.VISION_FOV_DEFAULT,
        rangeFar = SENSOR_CONSTANTS.VISION_RANGE_FAR) {
        this.fovDeg = fovDeg;
        this.rangeFar = rangeFar;
        this.rangeNear = SENSOR_CONSTANTS.VISION_RANGE_NEAR;
    }

    /**
     * Returns [0, 1] visibility fraction of the target.
     *  0   = not visible at all
     *  0.x = partially visible (some body parts occluded)
     *  1   = fully visible (all multi-cast points hit)
     *
     * lightMultiplier: from LightLevelSystem — boosts or suppresses detection.
     */
    checkVisibility(
        observerPos: THREE.Vector3,
        observerLookDir: THREE.Vector3,
        targetPos: THREE.Vector3,
        world: IWorldQuery,
        lightMultiplier: number,
    ): { visible: boolean; fraction: number; distance: number; detectionZone: 'near' | 'far' | 'peripheral' | 'none' } {
        const toTarget = targetPos.clone().sub(observerPos);
        const distance = toTarget.length();

        if (distance > this.rangeFar + 10) {
            return { visible: false, fraction: 0, distance, detectionZone: 'none' };
        }

        // Angle check
        const toTargetNorm = toTarget.clone().normalize();
        const cosAngle = observerLookDir.dot(toTargetNorm);
        const halfFOV = (this.fovDeg / 2) * THREE.MathUtils.DEG2RAD;
        const halfPeriph = (SENSOR_CONSTANTS.VISION_PERIPH_FOV / 2) * THREE.MathUtils.DEG2RAD;

        let detectionZone: 'near' | 'far' | 'peripheral' | 'none';
        if (cosAngle < Math.cos(halfPeriph)) {
            return { visible: false, fraction: 0, distance, detectionZone: 'none' };
        } else if (cosAngle < Math.cos(halfFOV)) {
            detectionZone = 'peripheral';
        } else if (distance <= this.rangeNear) {
            detectionZone = 'near';
        } else {
            detectionZone = 'far';
        }

        if (lightMultiplier <= 0.01 && detectionZone !== 'near') {
            // In near/pitch dark — only very close triggers
            return { visible: false, fraction: 0, distance, detectionZone: 'none' };
        }

        // Multi-point occlusion check
        let visiblePoints = 0;
        for (const offset of SENSOR_CONSTANTS.VISION_MULTICAST_OFFSETS) {
            const samplePoint = targetPos.clone().add(offset);
            const rayDir = samplePoint.clone().sub(observerPos).normalize();
            const rayDist = observerPos.distanceTo(samplePoint);
            const hit = world.castRay(observerPos, rayDir, rayDist);
            if (!hit.hit || hit.distance >= rayDist - 0.1) {
                visiblePoints++;
            }
        }

        const fraction = visiblePoints / SENSOR_CONSTANTS.VISION_MULTICAST_OFFSETS.length;
        const visible = fraction > 0;

        return { visible, fraction, distance, detectionZone };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hearing System
// ─────────────────────────────────────────────────────────────────────────────

export class HearingSystem {
    /**
     * Check if an agent at `observerPos` can hear a NoiseEvent.
     * Returns [0, 1] hearing intensity (0 = inaudible, 1 = full volume).
     * Walls reduce intensity via occlusion sampling.
     */
    checkHearing(observerPos: THREE.Vector3, event: NoiseEvent, world: IWorldQuery): number {
        const dist = observerPos.distanceTo(event.position);
        if (dist > event.radius) return 0;

        // Linear falloff
        const rawIntensity = 1.0 - (dist / event.radius);

        // Occlusion: cast N rays between source and receiver — each wall intersection attenuates
        const attenuation = this.computeOcclusion(observerPos, event.position, world);

        return rawIntensity * attenuation;
    }

    private computeOcclusion(
        from: THREE.Vector3,
        to: THREE.Vector3,
        world: IWorldQuery,
    ): number {
        const spread = 0.3; // meters — jitter radius for occlusion samples
        let totalAttenuation = 0;
        const samples = SENSOR_CONSTANTS.HEARING_OCCLUSION_CHECKS;

        for (let i = 0; i < samples; i++) {
            // Random offset in the perpendicular plane for soft occlusion
            const jitter = new THREE.Vector3(
                (Math.random() - 0.5) * spread,
                (Math.random() - 0.5) * spread,
                0,
            );
            const sampleFrom = from.clone().add(jitter);
            const sampleTo = to.clone().add(jitter);
            const dir = sampleTo.clone().sub(sampleFrom).normalize();
            const dist = sampleFrom.distanceTo(sampleTo);

            let sampleAtten = 1.0;
            let checked = 0;
            let rayDist = 0;

            // Walk ray, count wall hits
            while (rayDist < dist && checked < 5) {
                const hit = world.castRay(sampleFrom.clone().add(dir.clone().multiplyScalar(rayDist + 0.1)), dir, dist - rayDist);
                if (!hit.hit) break;
                // Each wall crossed attenuates
                sampleAtten *= SENSOR_CONSTANTS.HEARING_OCCLUSION_WALL;
                rayDist += hit.distance + 0.2;
                checked++;
            }
            totalAttenuation += sampleAtten;
        }

        return totalAttenuation / samples;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Light Level System
// ─────────────────────────────────────────────────────────────────────────────

export class LightLevelSystem {
    /**
     * Returns the vision detection multiplier based on player light exposure.
     * 0.0 (pitch dark) → 0.0 multiplier (AI cannot see at all).
     * 1.0 (fully lit)  → LIGHT_DETECTION_MULT_MAX.
     */
    computeDetectionMultiplier(player: IPlayerHandle): number {
        const exposure = player.lightExposure();
        return THREE.MathUtils.lerp(
            SENSOR_CONSTANTS.LIGHT_DETECTION_MULT_MIN,
            SENSOR_CONSTANTS.LIGHT_DETECTION_MULT_MAX,
            exposure,
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Behavior Controller (stub interface for AI action dispatch)
// ─────────────────────────────────────────────────────────────────────────────

export interface BehaviorController {
    goTo(pos: THREE.Vector3): void;
    lookAt(pos: THREE.Vector3): void;
    investigate(lkp: THREE.Vector3, radius: number): void;
    chase(target: IPlayerHandle): void;
    takeCover(): void;
    flank(target: THREE.Vector3): void;
    callForBackup(pos: THREE.Vector3): void;
    throwSmokeGrenade(pos: THREE.Vector3): void;
    retreat(): void;
    setAlertAnimation(state: AlertState): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sensor Component (per-agent)
// ─────────────────────────────────────────────────────────────────────────────

export class SensorComponent {
    vision: VisionCone;
    hearing: HearingSystem;
    light: LightLevelSystem;

    alertState: AlertState = AlertState.IDLE;
    awareness: number = 0;           // [0, AWARENESS_MAX]
    lkp: THREE.Vector3 | null = null; // Last Known Position
    lkpTime: number = 0;           // performance.now() when LKP was set
    hasLOS: boolean = false;       // current frame Line-of-Sight
    searchTimer: number = 0;

    constructor() {
        this.vision = new VisionCone();
        this.hearing = new HearingSystem();
        this.light = new LightLevelSystem();
    }

    /**
     * Main sensor tick — update awareness gauge and alert state.
     * @param dt Fixed delta time in seconds.
     */
    tick(
        agent: AIAgent,
        player: IPlayerHandle,
        world: IWorldQuery,
        dt: number,
    ): void {
        const agentPos = agent.position();
        const playerPos = player.position();
        const lookDir = agent.lookAt().clone().normalize();
        const lightMult = this.light.computeDetectionMultiplier(player);

        // ── Vision ────────────────────────────────────────────────────────────────
        const visResult = this.vision.checkVisibility(agentPos, lookDir, playerPos, world, lightMult);
        this.hasLOS = visResult.visible;

        if (visResult.visible) {
            const rateMultiplier = player.isCrouching() ? 0.5 : 1.0;
            const lightBoost = lightMult;

            let rate = 0;
            switch (visResult.detectionZone) {
                case 'near': rate = SENSOR_CONSTANTS.AWARENESS_RATE_NEAR; break;
                case 'far': rate = SENSOR_CONSTANTS.AWARENESS_RATE_FAR; break;
                case 'peripheral': rate = SENSOR_CONSTANTS.AWARENESS_RATE_PERIPH; break;
            }

            // Scale by how many body parts are visible (fraction) and light
            rate *= visResult.fraction * rateMultiplier * lightBoost;

            this.awareness = Math.min(
                this.awareness + rate * dt,
                SENSOR_CONSTANTS.AWARENESS_MAX,
            );
            this.lkp = playerPos.clone();
            this.lkpTime = performance.now();
        }

        // ── Hearing (processed by SensorManager, increments awareness directly) ──

        // ── Decay when no LOS ────────────────────────────────────────────────────
        if (!visResult.visible && this.alertState !== AlertState.HOSTILE) {
            this.awareness = Math.max(0, this.awareness - SENSOR_CONSTANTS.AWARENESS_DECAY_IDLE * dt);
        }

        // ── Alert State Transitions ───────────────────────────────────────────────
        this.updateAlertState(agent, player, dt);
    }

    private updateAlertState(agent: AIAgent, player: IPlayerHandle, dt: number): void {
        const prev = this.alertState;

        if (this.awareness >= SENSOR_CONSTANTS.AWARENESS_HOSTILE_THR) {
            this.alertState = AlertState.HOSTILE;
        } else if (this.awareness >= SENSOR_CONSTANTS.AWARENESS_SUSPECT_THR) {
            this.alertState = AlertState.SUSPECT;
        } else if (this.awareness >= SENSOR_CONSTANTS.AWARENESS_CURIOUS_THR) {
            this.alertState = AlertState.CURIOUS;
        } else {
            this.alertState = AlertState.IDLE;
        }

        // If state changed — fire behavior
        if (this.alertState !== prev) {
            agent.behavior.setAlertAnimation(this.alertState);
        }

        // Behavior dispatch per state
        switch (this.alertState) {
            case AlertState.CURIOUS:
                if (this.lkp) agent.behavior.goTo(this.lkp);
                break;
            case AlertState.SUSPECT:
                if (this.lkp) agent.behavior.investigate(this.lkp, 5.0);
                break;
            case AlertState.HOSTILE:
                agent.behavior.chase(player);
                break;
            case AlertState.IDLE:
                // Increment search timer — give up after WANTED_INVESTIGATE_TIME
                if (prev !== AlertState.IDLE) {
                    this.searchTimer = SENSOR_CONSTANTS.WANTED_INVESTIGATE_TIME;
                }
                this.searchTimer -= dt;
                break;
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sensor Manager (orchestrates all sensors)
// ─────────────────────────────────────────────────────────────────────────────

export class SensorManager {
    private noiseBus: NoiseEventBus;
    private hearingSystem: HearingSystem;

    constructor() {
        this.noiseBus = NoiseEventBus.instance;
        this.hearingSystem = new HearingSystem();
    }

    /**
     * Tick all agent sensors at AI rate (typically 10Hz).
     * Each agent gets its SensorComponent updated with vision + hearing.
     */
    tick(agents: AIAgent[], player: IPlayerHandle, world: IWorldQuery, dt: number): void {
        // Flush noise events from this batch
        const noiseEvents = this.noiseBus.flush();

        for (const agent of agents) {
            // Vision + AlertState
            agent.sensor.tick(agent, player, world, dt);

            // Hearing — add to awareness
            for (const ev of noiseEvents) {
                const intensity = this.hearingSystem.checkHearing(agent.position(), ev, world);
                if (intensity > 0) {
                    const awarenessGain = intensity * this.noiseToAwareness(ev.type);
                    agent.sensor.awareness = Math.min(
                        agent.sensor.awareness + awarenessGain,
                        SENSOR_CONSTANTS.AWARENESS_MAX,
                    );
                    // Update LKP if strong signal
                    if (intensity > 0.5) {
                        agent.sensor.lkp = ev.position.clone();
                        agent.sensor.lkpTime = ev.timestamp;
                    }
                }
            }

            // Inter-agent communication — share LKP if hostile and in radio range
            if (agent.sensor.alertState === AlertState.HOSTILE && agent.sensor.lkp) {
                this.broadcastLKP(agent, agents, world);
            }
        }
    }

    private noiseToAwareness(type: NoiseType): number {
        switch (type) {
            case NoiseType.EXPLOSION: return 80;
            case NoiseType.GUNSHOT: return 60;
            case NoiseType.GLASS_BREAK: return 35;
            case NoiseType.VEHICLE: return 30;
            case NoiseType.SILENCED_GUN: return 15;
            case NoiseType.SPRINT: return 20;
            case NoiseType.MELEE: return 25;
            case NoiseType.LAND: return 18;
            case NoiseType.WALK: return 8;
            case NoiseType.CROUCH_WALK: return 2;
        }
    }

    private broadcastLKP(source: AIAgent, all: AIAgent[], _world: IWorldQuery): void {
        const sourcePos = source.position();
        for (const other of all) {
            if (other.id === source.id) continue;
            const dist = sourcePos.distanceTo(other.position());
            if (dist <= SENSOR_CONSTANTS.WANTED_RADIO_RANGE) {
                // Elevate awareness of nearby units to chase threshold
                if (other.sensor.awareness < SENSOR_CONSTANTS.AWARENESS_SUSPECT_THR) {
                    other.sensor.awareness = SENSOR_CONSTANTS.AWARENESS_SUSPECT_THR;
                }
                if (source.sensor.lkp) {
                    other.sensor.lkp = source.sensor.lkp.clone();
                    other.sensor.lkpTime = source.sensor.lkpTime;
                }
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Wanted Level System
// ─────────────────────────────────────────────────────────────────────────────

export interface WantedLevelCallbacks {
    onPhaseChange(prev: WantedPhase, next: WantedPhase): void;
    spawnPoliceUnit(near: THREE.Vector3): AIAgent;
    spawnSWATUnit(near: THREE.Vector3): AIAgent;
    spawnHelicopter(over: THREE.Vector3): void;
    createRoadblock(pos: THREE.Vector3, dir: THREE.Vector3): void;
    requestAirSupport(pos: THREE.Vector3): void;
}

export class WantedLevelSystem {
    phase: WantedPhase = WantedPhase.NONE;
    stars: number = 0;   // 0–5 display stars
    private activeUnits: AIAgent[] = [];
    private noLOSTimer: number = 0;
    private chaseTimer: number = 0;
    private callbacks: WantedLevelCallbacks;
    private world: IWorldQuery;

    // Escalation thresholds in stars
    private readonly STAR_THRESHOLDS = [0, 1, 2, 3, 4] as const;

    constructor(callbacks: WantedLevelCallbacks, world: IWorldQuery) {
        this.callbacks = callbacks;
        this.world = world;
    }

    /** Call this whenever player commits a crime witnessed by an NPC/camera. */
    addWantedEvent(severity: number, witnessPos: THREE.Vector3): void {
        const prevPhase = this.phase;
        this.stars = Math.min(5, this.stars + severity);
        this.updatePhase(prevPhase, witnessPos);
    }

    /** Peacefully reduce wanted level over time (hide + no witnesses). */
    reduceWanted(dt: number): void {
        if (this.phase === WantedPhase.NONE) return;

        this.noLOSTimer += dt;
        // After 30s with no LOS to any hostile unit — reduce
        if (this.noLOSTimer > 30) {
            this.stars = Math.max(0, this.stars - 1);
            this.noLOSTimer = 0;
            if (this.stars === 0) {
                const prev = this.phase;
                this.phase = WantedPhase.NONE;
                this.callbacks.onPhaseChange(prev, WantedPhase.NONE);
            }
        }
    }

    tick(agents: AIAgent[], player: IPlayerHandle, dt: number): void {
        // Check if any unit has LOS to player
        const anyLOS = agents.some(a => a.sensor.hasLOS);

        if (anyLOS) {
            this.noLOSTimer = 0;
            this.chaseTimer = 0;
        } else {
            this.chaseTimer += dt;
        }

        // Phase-specific behavior orchestration
        switch (this.phase) {
            case WantedPhase.INVESTIGATION:
                this.handleInvestigation(agents, player, dt);
                break;
            case WantedPhase.CHASE:
                this.handleChase(agents, player, dt);
                break;
            case WantedPhase.TACTICAL:
                this.handleTactical(agents, player, dt);
                break;
            case WantedPhase.ESCALATION:
                this.handleEscalation(agents, player, dt);
                break;
        }

        void this.world;
    }

    // ── Phase Handlers ──────────────────────────────────────────────────────────

    private handleInvestigation(agents: AIAgent[], _player: IPlayerHandle, dt: number): void {
        // Send units to LKP
        for (const agent of agents) {
            if (agent.sensor.lkp && agent.sensor.alertState === AlertState.IDLE) {
                agent.behavior.investigate(agent.sensor.lkp, 8.0);
            }
        }

        // Escalate to CHASE if any unit gets LOS
        if (agents.some(a => a.sensor.hasLOS)) {
            this.setPhase(WantedPhase.CHASE);
        }

        // Give up after timeout
        this.noLOSTimer += dt;
        if (this.noLOSTimer > SENSOR_CONSTANTS.WANTED_INVESTIGATE_TIME) {
            this.setPhase(WantedPhase.NONE);
            this.stars = Math.max(0, this.stars - 1);
        }
    }

    private handleChase(agents: AIAgent[], player: IPlayerHandle, dt: number): void {
        for (const agent of agents) {
            if (agent.sensor.alertState === AlertState.HOSTILE) {
                agent.behavior.chase(player);
                agent.behavior.callForBackup(agent.position());
            }
        }

        // Escalate to TACTICAL at 3+ stars or sustained chase
        if (this.stars >= 3 || this.chaseTimer > 20) {
            this.setPhase(WantedPhase.TACTICAL);
        }

        // Downgrade if no LOS for a while
        if (this.chaseTimer > SENSOR_CONSTANTS.WANTED_CHASE_TIMEOUT) {
            this.setPhase(WantedPhase.INVESTIGATION);
        }
        void dt;
    }

    private handleTactical(agents: AIAgent[], player: IPlayerHandle, dt: number): void {
        // Coordinated tactics: flanking, cover, smoke
        const playerPos = player.position();
        let flanking = false;

        for (const agent of agents) {
            if (!flanking) {
                // One unit flanks
                const flankPos = playerPos.clone().add(
                    new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize().multiplyScalar(12)
                );
                agent.behavior.flank(flankPos);
                flanking = true;
            } else {
                agent.behavior.takeCover();
            }
        }

        // Smoke grenade usage
        if (Math.random() < 0.02 * dt && agents.length > 0) {
            agents[0].behavior.throwSmokeGrenade(playerPos);
        }

        // Escalate to full Escalation at 4–5 stars
        if (this.stars >= 4) {
            this.setPhase(WantedPhase.ESCALATION);
        }
        void dt;
    }

    private handleEscalation(agents: AIAgent[], player: IPlayerHandle, dt: number): void {
        // SWAT, helicopter, roadblocks
        const playerPos = player.position();

        // Periodic helicopter request
        if (Math.random() < 0.005 * dt) {
            this.callbacks.spawnHelicopter(playerPos.clone().add(new THREE.Vector3(0, 30, 0)));
        }

        // Roadblock creation on roads ahead
        if (Math.random() < 0.008 * dt) {
            const forward = player.velocity().clone().normalize();
            const blockPos = playerPos.clone().add(forward.multiplyScalar(80));
            this.callbacks.createRoadblock(blockPos, forward.clone().negate());
        }

        // All agents go full aggression
        for (const agent of agents) {
            agent.behavior.chase(player);
        }
        void dt;
    }

    // ── Private Helpers ─────────────────────────────────────────────────────────

    private updatePhase(prevPhase: WantedPhase, witnessPos: THREE.Vector3): void {
        let newPhase: WantedPhase;

        if (this.stars === 0) {
            newPhase = WantedPhase.NONE;
        } else if (this.stars <= 1) {
            newPhase = WantedPhase.INVESTIGATION;
        } else if (this.stars <= 2) {
            newPhase = WantedPhase.CHASE;
        } else if (this.stars <= 3) {
            newPhase = WantedPhase.TACTICAL;
        } else {
            newPhase = WantedPhase.ESCALATION;
        }

        if (newPhase !== prevPhase) {
            this.phase = newPhase;
            this.noLOSTimer = 0;
            this.chaseTimer = 0;
            this.callbacks.onPhaseChange(prevPhase, newPhase);
            this.spawnReinforcements(newPhase, witnessPos);
        }
    }

    private setPhase(phase: WantedPhase): void {
        const prev = this.phase;
        this.phase = phase;
        this.callbacks.onPhaseChange(prev, phase);
    }

    private spawnReinforcements(phase: WantedPhase, near: THREE.Vector3): void {
        switch (phase) {
            case WantedPhase.INVESTIGATION:
                this.activeUnits.push(this.callbacks.spawnPoliceUnit(near));
                this.activeUnits.push(this.callbacks.spawnPoliceUnit(near));
                break;
            case WantedPhase.CHASE:
                for (let i = 0; i < 4; i++) this.activeUnits.push(this.callbacks.spawnPoliceUnit(near));
                break;
            case WantedPhase.TACTICAL:
                for (let i = 0; i < 6; i++) this.activeUnits.push(this.callbacks.spawnPoliceUnit(near));
                break;
            case WantedPhase.ESCALATION:
                for (let i = 0; i < 4; i++) this.activeUnits.push(this.callbacks.spawnSWATUnit(near));
                this.callbacks.requestAirSupport(near);
                break;
            default: break;
        }
    }

    get activeUnitCount(): number { return this.activeUnits.length; }
}
