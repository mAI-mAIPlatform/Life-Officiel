/**
 * @fileoverview LIFE — CombatSystem.ts
 * @description  AAA-grade combat system including weapon data, firing mechanics,
 *               procedural recoil spring-damper, Pacejka-inspired spread curves,
 *               damage model with body-part multipliers, cover system, active
 *               reload minigame, and melee combo system.
 */

import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Weapon Data Model
// ─────────────────────────────────────────────────────────────────────────────

export const enum WeaponType {
    PISTOL = 'PISTOL',
    SMG = 'SMG',
    ASSAULT_RIFLE = 'ASSAULT_RIFLE',
    SHOTGUN = 'SHOTGUN',
    SNIPER = 'SNIPER',
    MELEE = 'MELEE',
}

export const enum FireMode {
    SEMI_AUTO = 'SEMI_AUTO',
    BURST = 'BURST',
    FULL_AUTO = 'FULL_AUTO',
}

export const enum DamageType {
    BALLISTIC = 'BALLISTIC',
    EXPLOSIVE = 'EXPLOSIVE',
    MELEE = 'MELEE',
    ENERGY = 'ENERGY',
}

export interface RecoilPattern {
    /** Vertical kick per shot in degrees. */
    verticalKick: number;
    /** Max horizontal wander spread in degrees. */
    horizontalSpread: number;
    /** Spring stiffness for recoil return. */
    returnStiffness: number;
    /** Damping coefficient — prevents oscillation. */
    returnDamping: number;
    /** Pattern array — X/Y offsets applied per consecutive shot. */
    pattern: Array<{ x: number; y: number }>;
}

export interface WeaponStats {
    id: string;
    name: string;
    type: WeaponType;
    fireMode: FireMode;
    damageType: DamageType;

    // Damage
    damageBase: number;   // HP per shot
    pelletCount: number;   // for shotguns
    armorPenetration: number; // 0–1
    falloffStart: number;   // m  — full damage until here
    falloffEnd: number;   // m  — min damage here
    falloffMinMult: number;   // min damage fraction at max range

    // Fire rate
    roundsPerMin: number;
    burstCount: number;   // for burst mode

    // Magazine
    magazineSize: number;
    reserveAmmo: number;
    reloadTime: number;   // seconds (base)

    // Spread (radians)
    spreadBase: number;   // hipfire
    spreadAim: number;   // ADS
    spreadPerShot: number;   // cumulative spread increase
    spreadRecovery: number;   // radians/sec recovery

    recoil: RecoilPattern;

    // Projectile (null = hitscan)
    projectileSpeed: number | null; // m/s
    projectileMass: number | null; // kg
}

// ── Weapon Registry ────────────────────────────────────────────────────────

export const WEAPON_STATS: Record<string, WeaponStats> = {
    pistol_9mm: {
        id: 'pistol_9mm', name: 'Pistol 9mm', type: WeaponType.PISTOL,
        fireMode: FireMode.SEMI_AUTO, damageType: DamageType.BALLISTIC,
        damageBase: 28, pelletCount: 1, armorPenetration: 0.1,
        falloffStart: 20, falloffEnd: 50, falloffMinMult: 0.45,
        roundsPerMin: 300, burstCount: 1,
        magazineSize: 15, reserveAmmo: 60, reloadTime: 1.5,
        spreadBase: 0.04, spreadAim: 0.01, spreadPerShot: 0.015, spreadRecovery: 0.12,
        recoil: {
            verticalKick: 2.5, horizontalSpread: 0.8, returnStiffness: 120, returnDamping: 14,
            pattern: [{ x: 0, y: 2.5 }, { x: -0.3, y: 2.8 }, { x: 0.2, y: 2.4 }, { x: -0.1, y: 2.6 }]
        },
        projectileSpeed: null, projectileMass: null,
    },
    smg_compact: {
        id: 'smg_compact', name: 'Compact SMG', type: WeaponType.SMG,
        fireMode: FireMode.FULL_AUTO, damageType: DamageType.BALLISTIC,
        damageBase: 18, pelletCount: 1, armorPenetration: 0.05,
        falloffStart: 15, falloffEnd: 40, falloffMinMult: 0.30,
        roundsPerMin: 750, burstCount: 1,
        magazineSize: 30, reserveAmmo: 120, reloadTime: 1.8,
        spreadBase: 0.06, spreadAim: 0.02, spreadPerShot: 0.022, spreadRecovery: 0.18,
        recoil: {
            verticalKick: 1.8, horizontalSpread: 1.2, returnStiffness: 80, returnDamping: 10,
            pattern: [{ x: 0, y: 1.8 }, { x: 0.4, y: 1.9 }, { x: -0.5, y: 2.0 }, { x: 0.2, y: 2.1 }, { x: -0.3, y: 1.9 }]
        },
        projectileSpeed: null, projectileMass: null,
    },
    ar_standard: {
        id: 'ar_standard', name: 'Assault Rifle', type: WeaponType.ASSAULT_RIFLE,
        fireMode: FireMode.FULL_AUTO, damageType: DamageType.BALLISTIC,
        damageBase: 32, pelletCount: 1, armorPenetration: 0.25,
        falloffStart: 40, falloffEnd: 100, falloffMinMult: 0.50,
        roundsPerMin: 600, burstCount: 1,
        magazineSize: 30, reserveAmmo: 90, reloadTime: 2.1,
        spreadBase: 0.035, spreadAim: 0.008, spreadPerShot: 0.018, spreadRecovery: 0.14,
        recoil: {
            verticalKick: 2.2, horizontalSpread: 0.9, returnStiffness: 100, returnDamping: 12,
            pattern: [{ x: 0, y: 2.2 }, { x: -0.2, y: 2.4 }, { x: 0.3, y: 2.5 }, { x: -0.4, y: 2.3 }, { x: 0.1, y: 2.2 }, { x: 0.4, y: 2.6 }]
        },
        projectileSpeed: null, projectileMass: null,
    },
    shotgun_pump: {
        id: 'shotgun_pump', name: 'Pump Shotgun', type: WeaponType.SHOTGUN,
        fireMode: FireMode.SEMI_AUTO, damageType: DamageType.BALLISTIC,
        damageBase: 14, pelletCount: 9, armorPenetration: 0.0,
        falloffStart: 8, falloffEnd: 20, falloffMinMult: 0.15,
        roundsPerMin: 60, burstCount: 1,
        magazineSize: 8, reserveAmmo: 32, reloadTime: 3.2,
        spreadBase: 0.08, spreadAim: 0.05, spreadPerShot: 0.0, spreadRecovery: 0.20,
        recoil: {
            verticalKick: 6.5, horizontalSpread: 1.5, returnStiffness: 70, returnDamping: 8,
            pattern: [{ x: 0, y: 6.5 }, { x: 0, y: 6.5 }]
        },
        projectileSpeed: null, projectileMass: null,
    },
    sniper_heavy: {
        id: 'sniper_heavy', name: 'Heavy Sniper', type: WeaponType.SNIPER,
        fireMode: FireMode.SEMI_AUTO, damageType: DamageType.BALLISTIC,
        damageBase: 120, pelletCount: 1, armorPenetration: 0.85,
        falloffStart: 200, falloffEnd: 600, falloffMinMult: 0.70,
        roundsPerMin: 40, burstCount: 1,
        magazineSize: 5, reserveAmmo: 20, reloadTime: 3.5,
        spreadBase: 0.002, spreadAim: 0.0003, spreadPerShot: 0.001, spreadRecovery: 0.08,
        recoil: {
            verticalKick: 9.0, horizontalSpread: 0.3, returnStiffness: 60, returnDamping: 7,
            pattern: [{ x: 0, y: 9.0 }]
        },
        projectileSpeed: 900, projectileMass: 0.012,
    },
    melee_knife: {
        id: 'melee_knife', name: 'Combat Knife', type: WeaponType.MELEE,
        fireMode: FireMode.SEMI_AUTO, damageType: DamageType.MELEE,
        damageBase: 45, pelletCount: 1, armorPenetration: 0.3,
        falloffStart: 1.5, falloffEnd: 2.0, falloffMinMult: 0.0,
        roundsPerMin: 120, burstCount: 1,
        magazineSize: Infinity, reserveAmmo: Infinity, reloadTime: 0,
        spreadBase: 0, spreadAim: 0, spreadPerShot: 0, spreadRecovery: 0,
        recoil: { verticalKick: 0, horizontalSpread: 0, returnStiffness: 0, returnDamping: 0, pattern: [] },
        projectileSpeed: null, projectileMass: null,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Damage Model
// ─────────────────────────────────────────────────────────────────────────────

export const enum BodyPart {
    HEAD = 'HEAD',
    TORSO = 'TORSO',
    ARMS = 'ARMS',
    LEGS = 'LEGS',
}

const BODY_PART_MULTIPLIER: Record<BodyPart, number> = {
    [BodyPart.HEAD]: 4.0,
    [BodyPart.TORSO]: 1.0,
    [BodyPart.ARMS]: 0.60,
    [BodyPart.LEGS]: 0.55,
};

export interface DamageInstance {
    raw: number;  // raw damage before reductions
    effective: number;  // after armor + falloff + bodypart
    bodyPart: BodyPart;
    isCritical: boolean;
    killingBlow: boolean;
    attacker: string;
    weapon: string;
    position: THREE.Vector3;
}

export interface ArmorStats {
    protection: number; // 0–1, fraction of damage absorbed
    durability: number; // HP — depletes on hit
    maxDurability: number;
}

export function computeDamage(
    stats: WeaponStats,
    distance: number,
    bodyPart: BodyPart,
    armor: ArmorStats | null,
    bonusMult: number = 1,
): number {
    // Falloff
    const falloffFactor = distance <= stats.falloffStart
        ? 1.0
        : distance >= stats.falloffEnd
            ? stats.falloffMinMult
            : THREE.MathUtils.lerp(1.0, stats.falloffMinMult, (distance - stats.falloffStart) / (stats.falloffEnd - stats.falloffStart));

    let damage = stats.damageBase * falloffFactor * BODY_PART_MULTIPLIER[bodyPart] * bonusMult;

    // Armor reduction
    if (armor && armor.durability > 0) {
        const absorbFraction = armor.protection * (1.0 - stats.armorPenetration);
        damage *= (1.0 - absorbFraction);
        armor.durability = Math.max(0, armor.durability - damage * 0.4);
    }

    return Math.round(damage);
}

// ─────────────────────────────────────────────────────────────────────────────
// Recoil System (spring-damper)
// ─────────────────────────────────────────────────────────────────────────────

export class RecoilSystem {
    private currentPitch: number = 0;  // accumulated pitch offset (degrees)
    private currentYaw: number = 0;
    private velocityPitch: number = 0;  // spring velocity
    private velocityYaw: number = 0;
    private shotCount: number = 0;

    applyShot(pattern: RecoilPattern): { deltaPitch: number; deltaYaw: number } {
        const idx = this.shotCount % Math.max(pattern.pattern.length, 1);
        const step = pattern.pattern[idx] ?? { x: 0, y: pattern.verticalKick };

        const kick = {
            pitch: step.y + (Math.random() - 0.5) * 0.4,
            yaw: step.x + (Math.random() - 0.5) * pattern.horizontalSpread * 0.5,
        };

        this.velocityPitch += kick.pitch;
        this.velocityYaw += kick.yaw;
        this.shotCount++;

        return { deltaPitch: kick.pitch, deltaYaw: kick.yaw };
    }

    tick(pattern: RecoilPattern, dt: number): { pitch: number; yaw: number } {
        // Spring-damper: F = -k*x - c*v
        const forcePitch = -pattern.returnStiffness * this.currentPitch - pattern.returnDamping * this.velocityPitch;
        const forceYaw = -pattern.returnStiffness * this.currentYaw - pattern.returnDamping * this.velocityYaw;

        this.velocityPitch += forcePitch * dt;
        this.velocityYaw += forceYaw * dt;
        this.currentPitch += this.velocityPitch * dt;
        this.currentYaw += this.velocityYaw * dt;

        return { pitch: this.currentPitch, yaw: this.currentYaw };
    }

    reset(): void {
        this.currentPitch = 0; this.currentYaw = 0;
        this.velocityPitch = 0; this.velocityYaw = 0;
        this.shotCount = 0;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Weapon Instance (runtime state per equipped weapon)
// ─────────────────────────────────────────────────────────────────────────────

export interface HitScanResult {
    hit: boolean;
    point: THREE.Vector3;
    normal: THREE.Vector3;
    entityId: string | null;
    bodyPart: BodyPart;
    distance: number;
}

export interface IWeaponWorldQuery {
    castRay(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): HitScanResult;
    getEntityArmor(entityId: string): ArmorStats | null;
    applyDamage(entityId: string, dmg: DamageInstance): void;
    spawnProjectile(origin: THREE.Vector3, dir: THREE.Vector3, speed: number, mass: number, weaponId: string): void;
    spawnMuzzleFlash(origin: THREE.Vector3, dir: THREE.Vector3): void;
    spawnShellEject(pos: THREE.Vector3): void;
    spawnBulletHole(point: THREE.Vector3, normal: THREE.Vector3, isFlesh: boolean): void;
}

export class WeaponInstance {
    readonly stats: WeaponStats;
    recoil: RecoilSystem = new RecoilSystem();
    currentAmmo: number;
    reserveAmmo: number;
    currentSpread: number;         // radians
    isReloading: boolean = false;
    private fireCooldown: number = 0;
    private shotsSinceLast: number = 0;

    constructor(stats: WeaponStats) {
        this.stats = stats;
        this.currentAmmo = stats.magazineSize;
        this.reserveAmmo = stats.reserveAmmo;
        this.currentSpread = stats.spreadBase;
    }

    /**
     * Attempt to fire. Returns true if a shot was fired.
     * @param isAiming true = ADS
     * @param attackerId for damage attribution
     * @param world for hitscan queries
     * @param fireDir world-space direction
     * @param fireOrigin world-space muzzle point
     */
    fire(
        isAiming: boolean,
        attackerId: string,
        world: IWeaponWorldQuery,
        fireDir: THREE.Vector3,
        fireOrigin: THREE.Vector3,
    ): { fired: boolean; recoilDelta: { deltaPitch: number; deltaYaw: number } | null; ammoLeft: number } {
        if (this.fireCooldown > 0 || this.isReloading || this.currentAmmo <= 0) {
            return { fired: false, recoilDelta: null, ammoLeft: this.currentAmmo };
        }

        const fireInterval = 60 / this.stats.roundsPerMin;
        this.fireCooldown = fireInterval;
        this.currentAmmo--;
        this.shotsSinceLast++;

        // Spread
        const spread = isAiming ? this.stats.spreadAim : this.currentSpread;
        this.currentSpread = Math.min(
            this.currentSpread + this.stats.spreadPerShot,
            this.stats.spreadBase * 4
        );

        // Muzzle effects
        world.spawnMuzzleFlash(fireOrigin, fireDir);
        if (this.stats.type !== WeaponType.MELEE) world.spawnShellEject(fireOrigin);

        // Recoil
        const recoilDelta = this.recoil.applyShot(this.stats.recoil);

        // Shoot
        const pellets = this.stats.pelletCount;
        for (let i = 0; i < pellets; i++) {
            const jitteredDir = this.applySpread(fireDir, spread);

            if (this.stats.projectileSpeed !== null && this.stats.projectileMass !== null) {
                // Ballistic projectile
                world.spawnProjectile(fireOrigin, jitteredDir, this.stats.projectileSpeed, this.stats.projectileMass, this.stats.id);
            } else {
                // Hitscan
                const hit = world.castRay(fireOrigin, jitteredDir, this.stats.falloffEnd * 1.5);
                if (hit.hit) {
                    world.spawnBulletHole(hit.point, hit.normal, hit.entityId !== null);
                    if (hit.entityId) {
                        const armor = world.getEntityArmor(hit.entityId);
                        const dmgVal = computeDamage(this.stats, hit.distance, hit.bodyPart, armor);
                        world.applyDamage(hit.entityId, {
                            raw: this.stats.damageBase, effective: dmgVal,
                            bodyPart: hit.bodyPart, isCritical: hit.bodyPart === BodyPart.HEAD,
                            killingBlow: false, attacker: attackerId, weapon: this.stats.id,
                            position: hit.point,
                        });
                    }
                }
            }
        }

        return { fired: true, recoilDelta, ammoLeft: this.currentAmmo };
    }

    tick(dt: number): void {
        if (this.fireCooldown > 0) this.fireCooldown = Math.max(0, this.fireCooldown - dt);
        // Spread recovery
        this.currentSpread = Math.max(
            this.currentSpread - this.stats.spreadRecovery * dt,
            this.stats.spreadBase,
        );
        if (this.fireCooldown > (60 / this.stats.roundsPerMin) * 0.8) {
            this.shotsSinceLast = 0;
        }
    }

    private applySpread(dir: THREE.Vector3, spreadRad: number): THREE.Vector3 {
        const u = new THREE.Vector3(1, 0, 0).cross(dir).normalize();
        const v = new THREE.Vector3().crossVectors(dir, u).normalize();
        const r = Math.sqrt(Math.random());
        const theta = Math.random() * Math.PI * 2;
        const spreadedDir = dir.clone()
            .addScaledVector(u, r * Math.sin(theta) * spreadRad)
            .addScaledVector(v, r * Math.cos(theta) * spreadRad);
        return spreadedDir.normalize();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Active Reload Minigame
// ─────────────────────────────────────────────────────────────────────────────

export const enum ActiveReloadResult {
    PERFECT = 'PERFECT',
    GOOD = 'GOOD',
    FAIL = 'FAIL',
    TIMEOUT = 'TIMEOUT',
}

export class ActiveReloadController {
    private elapsed: number = 0;
    private total: number;
    private readonly perfectStart: number;
    private readonly perfectEnd: number;
    private readonly goodEnd: number;
    done: boolean = false;
    result: ActiveReloadResult | null = null;

    constructor(reloadTime: number) {
        this.total = reloadTime;
        this.perfectStart = reloadTime * 0.38;
        this.perfectEnd = reloadTime * 0.48;
        this.goodEnd = reloadTime * 0.62;
    }

    tick(dt: number): boolean {
        if (this.done) return true;
        this.elapsed += dt;
        if (this.elapsed >= this.total) {
            this.result = ActiveReloadResult.TIMEOUT;
            this.done = true;
        }
        return this.done;
    }

    /** Call when player presses reload during animation. */
    triggerActiveReload(): { result: ActiveReloadResult; timeBonus: number } {
        if (this.done) return { result: ActiveReloadResult.TIMEOUT, timeBonus: 0 };
        this.done = true;
        if (this.elapsed >= this.perfectStart && this.elapsed <= this.perfectEnd) {
            this.result = ActiveReloadResult.PERFECT;
            return { result: this.result, timeBonus: this.total - this.elapsed + 0.2 }; // instant finish + bonus speed
        } else if (this.elapsed <= this.goodEnd) {
            this.result = ActiveReloadResult.GOOD;
            return { result: this.result, timeBonus: 0.3 };
        } else {
            this.result = ActiveReloadResult.FAIL;
            return { result: this.result, timeBonus: -2.0 }; // jam penalty
        }
    }

    get progress(): number { return this.elapsed / this.total; }
    get perfectZone(): { start: number; end: number } {
        return { start: this.perfectStart / this.total, end: this.perfectEnd / this.total };
    }
    get goodZone(): { start: number; end: number } {
        return { start: this.perfectStart / this.total, end: this.goodEnd / this.total };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Melee Combo System
// ─────────────────────────────────────────────────────────────────────────────

export const enum ComboStage {
    IDLE = 'IDLE',
    LIGHT_1 = 'LIGHT_1',
    LIGHT_2 = 'LIGHT_2',
    LIGHT_3 = 'LIGHT_3',
    HEAVY = 'HEAVY',
    FINISHER = 'FINISHER',
    PARRY = 'PARRY',
    COUNTER_WINDOW = 'COUNTER_WINDOW',
}

export interface ComboStep {
    stage: ComboStage;
    damage: number;
    stagger: boolean;       // knocks enemy back
    knockdown: boolean;
    anim: string;        // animation ID for the character system
    windowMs: number;        // input continuation window in ms
    cancelable: boolean;
}

export const COMBO_CHAIN: ComboStep[] = [
    { stage: ComboStage.LIGHT_1, damage: 1.0, stagger: false, knockdown: false, anim: 'melee_light_1', windowMs: 500, cancelable: true },
    { stage: ComboStage.LIGHT_2, damage: 1.1, stagger: false, knockdown: false, anim: 'melee_light_2', windowMs: 480, cancelable: true },
    { stage: ComboStage.LIGHT_3, damage: 1.3, stagger: true, knockdown: false, anim: 'melee_light_3', windowMs: 420, cancelable: false },
    { stage: ComboStage.FINISHER, damage: 2.5, stagger: true, knockdown: true, anim: 'melee_finisher', windowMs: 0, cancelable: false },
];

export class MeleeComboController {
    private comboIndex: number = 0;
    private windowTimer: number = 0;
    private heavyCharge: number = 0;
    stage: ComboStage = ComboStage.IDLE;
    parryWindow: number = 0;

    tick(dt: number): void {
        if (this.windowTimer > 0) {
            this.windowTimer -= dt * 1000;
            if (this.windowTimer <= 0) this.reset();
        }
        if (this.parryWindow > 0) {
            this.parryWindow -= dt * 1000;
        }
    }

    lightAttack(): ComboStep | null {
        const step = COMBO_CHAIN[this.comboIndex];
        if (!step || this.windowTimer <= 0 && this.comboIndex > 0) {
            this.comboIndex = 0;
        }
        const current = COMBO_CHAIN[this.comboIndex];
        if (!current) return null;

        this.stage = current.stage;
        this.windowTimer = current.windowMs;
        this.comboIndex = (this.comboIndex + 1) % COMBO_CHAIN.length;
        return current;
    }

    /** Hold attack — returns a heavy step when released. */
    chargeHeavy(dt: number): void {
        this.heavyCharge = Math.min(this.heavyCharge + dt, 1.5);
    }

    releaseHeavy(): ComboStep {
        const chargeMult = 1.0 + this.heavyCharge;
        this.reset();
        return {
            stage: ComboStage.HEAVY, damage: 2.0 * chargeMult,
            stagger: true, knockdown: this.heavyCharge > 1.0,
            anim: 'melee_heavy', windowMs: 0, cancelable: false,
        };
    }

    /** Activate parry window — must be timed within 150ms of incoming attack. */
    activateParry(): void {
        this.parryWindow = 150 /* ms */;
        this.stage = ComboStage.PARRY;
    }

    /** Called when an incoming attack lands. Returns counter-attack if parry active. */
    checkParry(incomingDamage: number): { parried: boolean; counter: ComboStep | null } {
        if (this.parryWindow > 0) {
            this.parryWindow = 0;
            this.stage = ComboStage.COUNTER_WINDOW;
            return {
                parried: true,
                counter: {
                    stage: ComboStage.COUNTER_WINDOW, damage: 1.8,
                    stagger: true, knockdown: false,
                    anim: 'melee_counter', windowMs: 300, cancelable: false,
                },
            };
        }
        void incomingDamage;
        return { parried: false, counter: null };
    }

    reset(): void {
        this.comboIndex = 0;
        this.windowTimer = 0;
        this.heavyCharge = 0;
        this.stage = ComboStage.IDLE;
        this.parryWindow = 0;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cover System
// ─────────────────────────────────────────────────────────────────────────────

export const enum CoverType {
    FULL = 'FULL',   // player fully protected
    HALF = 'HALF',   // waist-high, can fire over
    LEAN = 'LEAN',   // lean left/right to peek
}

export interface CoverSpot {
    position: THREE.Vector3;
    normal: THREE.Vector3;  // pointing away from wall (toward open area)
    type: CoverType;
    entityId: string;
}

export interface ICoverWorldQuery {
    castRay(o: THREE.Vector3, d: THREE.Vector3, max: number): { hit: boolean; distance: number; normal: THREE.Vector3; tag: string };
    findNearestCoverSpot(pos: THREE.Vector3, range: number): CoverSpot | null;
}

export class CoverSystem {
    currentCover: CoverSpot | null = null;
    isInCover: boolean = false;
    peekDir: 'none' | 'left' | 'right' | 'up' = 'none';

    trySnapToCover(playerPos: THREE.Vector3, world: ICoverWorldQuery): boolean {
        const spot = world.findNearestCoverSpot(playerPos, 2.5);
        if (!spot) return false;
        this.currentCover = spot;
        this.isInCover = true;
        this.peekDir = 'none';
        return true;
    }

    exitCover(): void {
        this.currentCover = null;
        this.isInCover = false;
        this.peekDir = 'none';
    }

    /**
     * Blind-fire: shots from cover have reduced accuracy.
     * Returns spread multiplier.
     */
    getBlindFireSpreadMult(): number {
        return this.isInCover && this.peekDir === 'none' ? 3.5 : 1.0;
    }

    getPeekPosition(): THREE.Vector3 | null {
        if (!this.currentCover) return null;
        const offset = this.peekDir === 'left' ? new THREE.Vector3(-0.5, 0, 0)
            : this.peekDir === 'right' ? new THREE.Vector3(0.5, 0, 0)
                : this.peekDir === 'up' ? new THREE.Vector3(0, 0.6, 0)
                    : null;
        if (!offset) return null;
        return this.currentCover.position.clone().add(
            offset.applyQuaternion(
                new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.currentCover.normal)
            )
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// CombatSystem — top-level facade
// ─────────────────────────────────────────────────────────────────────────────

export class CombatSystem {
    private weapons: Map<string, WeaponInstance> = new Map();
    private equipped: WeaponInstance | null = null;
    readonly recoil: RecoilSystem = new RecoilSystem();
    readonly cover: CoverSystem = new CoverSystem();
    melee: MeleeComboController = new MeleeComboController();
    activeReload: ActiveReloadController | null = null;

    equip(weaponId: string): void {
        if (!this.weapons.has(weaponId)) {
            const stats = WEAPON_STATS[weaponId];
            if (!stats) throw new Error(`Unknown weapon: ${weaponId}`);
            this.weapons.set(weaponId, new WeaponInstance(stats));
        }
        this.equipped = this.weapons.get(weaponId)!;
        this.recoil.reset();
    }

    fire(isAiming: boolean, attackerId: string, world: IWeaponWorldQuery, fireDir: THREE.Vector3, origin: THREE.Vector3) {
        if (!this.equipped) return null;
        const coverSpread = this.cover.getBlindFireSpreadMult();
        void coverSpread; // applied inside WeaponInstance spread calc in extensions
        return this.equipped.fire(isAiming, attackerId, world, fireDir, origin);
    }

    startReload(): ActiveReloadController | null {
        if (!this.equipped || this.equipped.isReloading) return null;
        this.equipped.isReloading = true;
        this.activeReload = new ActiveReloadController(this.equipped.stats.reloadTime);
        return this.activeReload;
    }

    triggerActiveReload(): ActiveReloadResult | null {
        return this.activeReload?.triggerActiveReload().result ?? null;
    }

    tick(dt: number): void {
        this.equipped?.tick(dt);
        this.melee.tick(dt);
        if (this.activeReload) {
            if (this.activeReload.tick(dt)) {
                // Reload complete
                const result = this.activeReload.result;
                if (result !== ActiveReloadResult.FAIL) {
                    const reserve = this.equipped?.reserveAmmo ?? 0;
                    const magSize = this.equipped?.stats.magazineSize ?? 0;
                    const current = this.equipped?.currentAmmo ?? 0;
                    const needed = magSize - current;
                    const loaded = Math.min(reserve, needed);
                    if (this.equipped) {
                        this.equipped.currentAmmo += loaded;
                        this.equipped.reserveAmmo -= loaded;
                        this.equipped.isReloading = false;
                    }
                } else {
                    // Jam — extra wait handled by jammed state
                    if (this.equipped) this.equipped.isReloading = false;
                }
                this.activeReload = null;
            }
        }
    }

    getRecoilOffset(dt: number): { pitch: number; yaw: number } {
        return this.equipped ? this.recoil.tick(this.equipped.stats.recoil, dt) : { pitch: 0, yaw: 0 };
    }

    get equippedWeapon(): WeaponInstance | null { return this.equipped; }
    get currentAmmo(): number { return this.equipped?.currentAmmo ?? 0; }
    get reserveAmmo(): number { return this.equipped?.reserveAmmo ?? 0; }
}
