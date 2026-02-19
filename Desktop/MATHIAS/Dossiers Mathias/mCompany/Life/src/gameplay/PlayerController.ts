/**
 * @fileoverview LIFE — PlayerController.ts
 * @description  Kinematic Character Controller with Hierarchical State Machine.
 *
 * Architecture:
 *  - HierarchicalStateMachine manages a stack of IPlayerState instances.
 *  - Each state implements enter/exit/update/handleInput.
 *  - Raw physics is delegated to Rapier3D (or a stub) via IPhysicsBody.
 *  - All "game feel" constants are grouped in PLAYER_CONSTANTS for easy tuning.
 *
 * States implemented:
 *  LOCOMOTION  → Walk / Run / Sprint (inertia, body lean)
 *  AIR         → Jump (variable height) / Fall / Land / CoyoteTime / JumpBuffer
 *  PARKOUR     → WallRun / Mantle / Slide / Vault
 *  COMBAT      → Aim / Shoot / Cover / Reload
 *  VEHICLE     → Driving / Passenger / DriveBy
 */

import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Game-Feel Constants  (tweak here, nowhere else)
// ─────────────────────────────────────────────────────────────────────────────

export const PLAYER_CONSTANTS = {
    // --- Locomotion ---
    WALK_SPEED: 3.5,   // m/s
    RUN_SPEED: 6.0,   // m/s
    SPRINT_SPEED: 9.5,   // m/s
    CROUCH_SPEED: 2.0,   // m/s
    ACCEL_GROUND: 18.0,   // m/s² — how fast we reach target speed
    DECEL_GROUND: 22.0,   // m/s² — braking friction
    BODY_LEAN_MAX: 0.18,  // radians lean at full lateral speed
    BODY_LEAN_SMOOTH: 8.0,   // lerp factor for lean angle

    // --- Air ---
    JUMP_IMPULSE: 5.5,   // m/s initial vertical velocity
    JUMP_HOLD_GRAV: 0.4,   // gravity multiplier while jump button held (variable height)
    FALL_GRAV_MULT: 2.2,   // extra gravity on the way down (snappier arcs)
    AIR_ACCEL: 6.0,   // m/s² — reduced air control
    COYOTE_TIME: 0.15,  // seconds after leaving platform where jump is still allowed
    JUMP_BUFFER: 0.10,  // seconds before landing where a jump input is queued
    HARD_LAND_FALL_T: 1.2,   // seconds of fall → triggers landing roll
    LAND_ROLL_SPEED: 4.0,   // roll impulse

    // --- Parkour ---
    WALL_RUN_MIN_SPEED: 4.0, // m/s — minimum lateral speed to initiate wall-run
    WALL_RUN_GRAVITY: 0.5, // reduced gravity during wall-run
    WALL_RUN_DURATION: 2.5, // max seconds before falling
    MANTLE_REACH: 1.5, // m — how far ahead to detect mantleable ledges
    MANTLE_HEIGHT: 1.8, // m — max ledge height we can mantle
    SLIDE_SPEED_MIN: 5.0, // m/s — min speed to initiate slide
    SLIDE_FRICTION: 0.15,// kinetic friction during slide
    SLIDE_DURATION: 1.0, // max slide time in seconds
    VAULT_REACH: 1.2, // m — max obstacle depth to vault

    // --- Combat ---
    AIM_FOV: 60,  // degrees — zoomed FOV while aiming
    DEFAULT_FOV: 75,  // degrees
    RECOIL_RETURN_SPEED: 8.0, // spring return speed (damping)
    COVER_SNAP_DIST: 0.8, // m — distance from wall to snap-to-cover

    // --- Interaction ---
    INTERACT_RANGE: 2.5, // m
    INTERACT_ANGLE: 45,  // degrees from forward for door kick vs open
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Interfaces & Enums
// ─────────────────────────────────────────────────────────────────────────────

export const enum PlayerStateId {
    LOCOMOTION = 'LOCOMOTION',
    WALKING = 'WALKING',
    RUNNING = 'RUNNING',
    SPRINTING = 'SPRINTING',
    CROUCHING = 'CROUCHING',
    AIR = 'AIR',
    JUMPING = 'JUMPING',
    FALLING = 'FALLING',
    LANDING = 'LANDING',
    PARKOUR = 'PARKOUR',
    WALL_RUN = 'WALL_RUN',
    MANTLE = 'MANTLE',
    SLIDING = 'SLIDING',
    VAULTING = 'VAULTING',
    COMBAT = 'COMBAT',
    AIMING = 'AIMING',
    RELOADING = 'RELOADING',
    IN_COVER = 'IN_COVER',
    VEHICLE = 'VEHICLE',
    DRIVING = 'DRIVING',
    PASSENGER = 'PASSENGER',
}

export interface InputFrame {
    move: THREE.Vector2;  // WASD/left-stick, magnitude = speed intent [0,1]
    aim: THREE.Vector2;  // Mouse/right-stick delta
    jump: boolean;
    sprint: boolean;
    crouch: boolean;
    fire: boolean;
    aim_btn: boolean;
    reload: boolean;
    interact: boolean;
    roll: boolean;
    timestamp: number;         // performance.now()
}

export interface RaycastHit {
    hit: boolean;
    point: THREE.Vector3;
    normal: THREE.Vector3;
    distance: number;
    // Collider tag — allows wall-type detection
    tag: string;
}

/**
 * Minimal physics body interface — wired to your Rapier3D rigid body.
 * The controller never touches Rapier directly; it talks to this interface.
 */
export interface IPhysicsBody {
    position(): THREE.Vector3;
    velocity(): THREE.Vector3;
    setVelocity(v: THREE.Vector3): void;
    applyImpulse(v: THREE.Vector3): void;
    isGrounded(): boolean;
    castRay(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): RaycastHit;
    castCapsule(origin: THREE.Vector3, dir: THREE.Vector3, radius: number, maxDist: number): RaycastHit;
}

export interface ICameraRig {
    worldForward(): THREE.Vector3;
    worldRight(): THREE.Vector3;
    setFOV(fov: number, lerpSpeed: number): void;
    addRecoil(pitch: number, yaw: number): void;
    tilt(roll: number, lerpSpeed: number): void;  // for wall-run lean
}

/**
 * Shared mutable context passed to every state. States read & write here.
 * No per-state heap allocation in hot path.
 */
export interface StateContext {
    body: IPhysicsBody;
    camera: ICameraRig;
    input: InputFrame;
    prevInput: InputFrame;

    // Movement
    velocity: THREE.Vector3;    // authoritative velocity modified by states
    wishDir: THREE.Vector3;    // desired movement direction (world-space)

    // Air tracking
    airTime: number;           // seconds since left ground
    coyoteTimer: number;           // counts down from COYOTE_TIME
    jumpBuffer: number;           // counts down — queued jump intent
    jumpHeld: boolean;          // for variable height jump

    // Body lean (animation feedback)
    bodyLean: number;           // current lean radians (smoothed)

    // Parkour
    wallNormal: THREE.Vector3;    // last detected wall normal
    wallRunTimer: number;

    // Combat
    equippedWeaponId: string | null;
    isAiming: boolean;
    coverNormal: THREE.Vector3;    // wall normal of current cover

    // Interaction
    lastInteractHit: InteractionTarget | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Smart Interaction System
// ─────────────────────────────────────────────────────────────────────────────

export const enum InteractionType {
    DOOR_OPEN = 'DOOR_OPEN',
    DOOR_KICK = 'DOOR_KICK',
    DOOR_PEEK = 'DOOR_PEEK',
    PICKUP_ITEM = 'PICKUP_ITEM',
    PICKUP_WEAPON = 'PICKUP_WEAPON',
    TALK_NPC = 'TALK_NPC',
    ENTER_VEHICLE = 'ENTER_VEHICLE',
    HACK_TERMINAL = 'HACK_TERMINAL',
    VAULT_OBSTACLE = 'VAULT_OBSTACLE',
    REVIVE_ALLY = 'REVIVE_ALLY',
}

export interface InteractionTarget {
    type: InteractionType;
    label: string;          // Display text, e.g. "Ouvrir" / "Défoncer la porte"
    entityId: string;
    position: THREE.Vector3;
    distance: number;
}

export class SmartInteractionResolver {
    private static readonly RAY_STEPS = 8;

    resolve(
        ctx: StateContext,
        stateId: PlayerStateId,
    ): InteractionTarget | null {
        const origin = ctx.body.position().clone().add(new THREE.Vector3(0, 1.6, 0));
        const dir = ctx.camera.worldForward().clone().normalize();
        const hit = ctx.body.castRay(origin, dir, PLAYER_CONSTANTS.INTERACT_RANGE);

        if (!hit.hit) return null;

        const distance = hit.distance;
        const tag = hit.tag;

        // Dynamic label/type based on context
        if (tag === 'door') {
            const isSprinting = stateId === PlayerStateId.SPRINTING;
            const isCrouching = stateId === PlayerStateId.CROUCHING;
            const angle = dir.dot(hit.normal);

            if (isSprinting || Math.abs(angle) > 0.8) {
                return { type: InteractionType.DOOR_KICK, label: 'Défoncer la porte', entityId: hit.tag, position: hit.point, distance };
            } else if (isCrouching) {
                return { type: InteractionType.DOOR_PEEK, label: 'Entrouvrir', entityId: hit.tag, position: hit.point, distance };
            }
            return { type: InteractionType.DOOR_OPEN, label: 'Ouvrir', entityId: hit.tag, position: hit.point, distance };
        }

        if (tag === 'pickup') return { type: InteractionType.PICKUP_ITEM, label: 'Ramasser', entityId: hit.tag, position: hit.point, distance };
        if (tag === 'weapon') return { type: InteractionType.PICKUP_WEAPON, label: 'Prendre l\'arme', entityId: hit.tag, position: hit.point, distance };
        if (tag === 'npc') return { type: InteractionType.TALK_NPC, label: 'Parler', entityId: hit.tag, position: hit.point, distance };
        if (tag === 'car') return { type: InteractionType.ENTER_VEHICLE, label: 'Monter en voiture', entityId: hit.tag, position: hit.point, distance };
        if (tag === 'terminal') return { type: InteractionType.HACK_TERMINAL, label: 'Hacker', entityId: hit.tag, position: hit.point, distance };

        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Base State Class
// ─────────────────────────────────────────────────────────────────────────────

export abstract class PlayerState {
    abstract readonly id: PlayerStateId;

    /** Called when entering this state. */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    enter(_ctx: StateContext, _hsm: HierarchicalStateMachine): void { }

    /** Called when leaving this state. */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    exit(_ctx: StateContext): void { }

    /**
     * Update tick — called every fixed-step (dt = FIXED_DT).
     * Return a new PlayerStateId to trigger a transition, or null to stay.
     */
    abstract update(ctx: StateContext, dt: number): PlayerStateId | null;

    /**
     * Raw input event (key down). Allows states to react immediately.
     * Return a PlayerStateId to request a transition.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    handleInput(_ctx: StateContext, _input: InputFrame): PlayerStateId | null { return null; }

    // ── Shared Helpers ──────────────────────────────────────────────────────────

    protected applyGroundMovement(ctx: StateContext, targetSpeed: number, dt: number): void {
        const wishDir = this.getWishDir(ctx);
        ctx.wishDir.copy(wishDir);

        const currentSpeed = ctx.velocity.length();
        const targetVel = wishDir.clone().multiplyScalar(targetSpeed);

        if (wishDir.lengthSq() > 0.001) {
            // Accelerate toward desired direction
            const accel = PLAYER_CONSTANTS.ACCEL_GROUND * dt;
            ctx.velocity.lerp(targetVel, Math.min(accel, 1));
        } else {
            // Decelerate (friction)
            const decel = PLAYER_CONSTANTS.DECEL_GROUND * dt;
            const decelerationFactor = Math.max(0, currentSpeed - decel) / Math.max(currentSpeed, 0.001);
            ctx.velocity.multiplyScalar(decelerationFactor);
        }

        // Body lean: proportional to cross-product of forward and velocity direction
        const forward = ctx.camera.worldForward();
        const right = ctx.camera.worldRight();
        const lateralSpeed = ctx.velocity.dot(right);
        const targetLean = THREE.MathUtils.clamp(
            lateralSpeed / targetSpeed * PLAYER_CONSTANTS.BODY_LEAN_MAX,
            -PLAYER_CONSTANTS.BODY_LEAN_MAX,
            PLAYER_CONSTANTS.BODY_LEAN_MAX
        );
        void forward; // used implicitly via camera forward direction
        ctx.bodyLean = THREE.MathUtils.lerp(ctx.bodyLean, targetLean, PLAYER_CONSTANTS.BODY_LEAN_SMOOTH * dt);
    }

    protected getWishDir(ctx: StateContext): THREE.Vector3 {
        const fwd = ctx.camera.worldForward().clone();
        const right = ctx.camera.worldRight().clone();
        fwd.y = 0; fwd.normalize();
        right.y = 0; right.normalize();
        const dir = new THREE.Vector3()
            .addScaledVector(fwd, ctx.input.move.y)
            .addScaledVector(right, ctx.input.move.x);
        if (dir.lengthSq() > 1) dir.normalize();
        return dir;
    }

    protected isJustPressed(ctx: StateContext, key: keyof InputFrame): boolean {
        return !!(ctx.input[key]) && !(ctx.prevInput[key]);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCOMOTION States
// ─────────────────────────────────────────────────────────────────────────────

class WalkingState extends PlayerState {
    readonly id = PlayerStateId.WALKING;

    update(ctx: StateContext, dt: number): PlayerStateId | null {
        if (!ctx.body.isGrounded()) return PlayerStateId.FALLING;
        if (ctx.input.sprint && ctx.input.move.lengthSq() > 0.1) return PlayerStateId.SPRINTING;
        if (ctx.input.crouch) return PlayerStateId.CROUCHING;

        const speed = ctx.input.move.length() > 0.5 ? PLAYER_CONSTANTS.RUN_SPEED : PLAYER_CONSTANTS.WALK_SPEED;
        this.applyGroundMovement(ctx, speed, dt);

        // Coyote window resets while grounded
        ctx.coyoteTimer = PLAYER_CONSTANTS.COYOTE_TIME;

        if (this.isJustPressed(ctx, 'jump') || ctx.jumpBuffer > 0) {
            ctx.jumpBuffer = 0;
            return PlayerStateId.JUMPING;
        }
        return null;
    }
}

class RunningState extends PlayerState {
    readonly id = PlayerStateId.RUNNING;

    update(ctx: StateContext, dt: number): PlayerStateId | null {
        if (!ctx.body.isGrounded()) return PlayerStateId.FALLING;
        if (!ctx.input.sprint) return PlayerStateId.WALKING;
        if (ctx.input.crouch && ctx.velocity.length() > PLAYER_CONSTANTS.SLIDE_SPEED_MIN) {
            return PlayerStateId.SLIDING;
        }
        this.applyGroundMovement(ctx, PLAYER_CONSTANTS.RUN_SPEED, dt);
        ctx.coyoteTimer = PLAYER_CONSTANTS.COYOTE_TIME;
        if (this.isJustPressed(ctx, 'jump') || ctx.jumpBuffer > 0) {
            ctx.jumpBuffer = 0;
            return PlayerStateId.JUMPING;
        }
        return null;
    }
}

class SprintingState extends PlayerState {
    readonly id = PlayerStateId.SPRINTING;

    update(ctx: StateContext, dt: number): PlayerStateId | null {
        if (!ctx.body.isGrounded()) return PlayerStateId.FALLING;
        if (!ctx.input.sprint || ctx.input.move.lengthSq() < 0.1) return PlayerStateId.WALKING;
        if (ctx.input.crouch) return PlayerStateId.SLIDING;

        this.applyGroundMovement(ctx, PLAYER_CONSTANTS.SPRINT_SPEED, dt);
        ctx.coyoteTimer = PLAYER_CONSTANTS.COYOTE_TIME;

        if (this.isJustPressed(ctx, 'jump') || ctx.jumpBuffer > 0) {
            ctx.jumpBuffer = 0;
            return PlayerStateId.JUMPING;
        }

        // Detect wall-run opportunity
        if (this.detectWallRun(ctx)) return PlayerStateId.WALL_RUN;

        return null;
    }

    private detectWallRun(ctx: StateContext): boolean {
        const speed = ctx.velocity.length();
        if (speed < PLAYER_CONSTANTS.WALL_RUN_MIN_SPEED) return false;
        const pos = ctx.body.position().clone().add(new THREE.Vector3(0, 1.0, 0));
        const rightHit = ctx.body.castRay(pos, ctx.camera.worldRight(), 0.65);
        const leftHit = ctx.body.castRay(pos, ctx.camera.worldRight().clone().negate(), 0.65);
        if (rightHit.hit && rightHit.tag === 'wall') {
            ctx.wallNormal.copy(rightHit.normal);
            return true;
        }
        if (leftHit.hit && leftHit.tag === 'wall') {
            ctx.wallNormal.copy(leftHit.normal);
            return true;
        }
        return false;
    }
}

class CrouchingState extends PlayerState {
    readonly id = PlayerStateId.CROUCHING;

    update(ctx: StateContext, dt: number): PlayerStateId | null {
        if (!ctx.input.crouch) return PlayerStateId.WALKING;
        if (!ctx.body.isGrounded()) return PlayerStateId.FALLING;
        this.applyGroundMovement(ctx, PLAYER_CONSTANTS.CROUCH_SPEED, dt);
        if (this.isJustPressed(ctx, 'jump')) return PlayerStateId.JUMPING;
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// AIR States
// ─────────────────────────────────────────────────────────────────────────────

class JumpingState extends PlayerState {
    readonly id = PlayerStateId.JUMPING;

    enter(ctx: StateContext): void {
        // Vertical impulse — triggers jump
        const vel = ctx.velocity.clone();
        vel.y = PLAYER_CONSTANTS.JUMP_IMPULSE;
        ctx.velocity.copy(vel);
        ctx.jumpHeld = true;
        ctx.coyoteTimer = 0;
    }

    update(ctx: StateContext, dt: number): PlayerStateId | null {
        // Air control
        const wishDir = this.getWishDir(ctx);
        ctx.velocity.addScaledVector(wishDir, PLAYER_CONSTANTS.AIR_ACCEL * dt);

        // Variable height: reduce gravity while holding jump until apex
        if (!ctx.input.jump) ctx.jumpHeld = false;

        // Apply reduced gravity when holding jump on the way up
        const gravMult = (ctx.jumpHeld && ctx.velocity.y > 0)
            ? PLAYER_CONSTANTS.JUMP_HOLD_GRAV
            : PLAYER_CONSTANTS.FALL_GRAV_MULT;
        ctx.velocity.y -= 9.81 * gravMult * dt;

        // Mantle detection during ascent
        if (this.detectMantle(ctx)) return PlayerStateId.MANTLE;

        if (ctx.body.isGrounded() && ctx.velocity.y <= 0) return PlayerStateId.LANDING;
        if (ctx.velocity.y < 0) return PlayerStateId.FALLING;
        return null;
    }

    private detectMantle(ctx: StateContext): boolean {
        const pos = ctx.body.position().clone().add(new THREE.Vector3(0, 1.6, 0));
        const fwd = ctx.camera.worldForward().clone(); fwd.y = 0; fwd.normalize();
        // Cast forward to check for a wall
        const wallHit = ctx.body.castRay(pos, fwd, PLAYER_CONSTANTS.MANTLE_REACH);
        if (!wallHit.hit) return false;
        // Cast downward from above to find ledge top
        const topOrigin = pos.clone().add(fwd.clone().multiplyScalar(PLAYER_CONSTANTS.MANTLE_REACH))
            .add(new THREE.Vector3(0, PLAYER_CONSTANTS.MANTLE_HEIGHT, 0));
        const topHit = ctx.body.castRay(topOrigin, new THREE.Vector3(0, -1, 0), PLAYER_CONSTANTS.MANTLE_HEIGHT * 2);
        if (topHit.hit && topHit.point.y > ctx.body.position().y) {
            return true;
        }
        return false;
    }
}

class FallingState extends PlayerState {
    readonly id = PlayerStateId.FALLING;

    enter(ctx: StateContext): void {
        // Start air timer if not already running
    }

    update(ctx: StateContext, dt: number): PlayerStateId | null {
        ctx.airTime += dt;
        ctx.coyoteTimer = Math.max(0, ctx.coyoteTimer - dt);

        // Jump buffering — queue jump intent before landing
        if (this.isJustPressed(ctx, 'jump')) {
            ctx.jumpBuffer = PLAYER_CONSTANTS.JUMP_BUFFER;
        }
        if (ctx.jumpBuffer > 0) ctx.jumpBuffer -= dt;

        // Coyote jump
        if (this.isJustPressed(ctx, 'jump') && ctx.coyoteTimer > 0) {
            return PlayerStateId.JUMPING;
        }

        // Increased fall gravity for weight feel
        ctx.velocity.y -= 9.81 * PLAYER_CONSTANTS.FALL_GRAV_MULT * dt;

        // Air steering
        const wishDir = this.getWishDir(ctx);
        ctx.velocity.addScaledVector(wishDir, PLAYER_CONSTANTS.AIR_ACCEL * dt);

        if (ctx.body.isGrounded()) return PlayerStateId.LANDING;

        // Wall-run detection during fall
        if (this.detectWallRunEntry(ctx)) return PlayerStateId.WALL_RUN;
        // Vault detection
        if (this.detectVault(ctx)) return PlayerStateId.VAULTING;

        return null;
    }

    private detectWallRunEntry(ctx: StateContext): boolean {
        if (ctx.velocity.length() < PLAYER_CONSTANTS.WALL_RUN_MIN_SPEED) return false;
        const pos = ctx.body.position().clone().add(new THREE.Vector3(0, 1.0, 0));
        const rightHit = ctx.body.castRay(pos, ctx.camera.worldRight(), 0.7);
        const leftHit = ctx.body.castRay(pos, ctx.camera.worldRight().clone().negate(), 0.7);
        if (rightHit.hit && rightHit.tag === 'wall') { ctx.wallNormal.copy(rightHit.normal); return true; }
        if (leftHit.hit && leftHit.tag === 'wall') { ctx.wallNormal.copy(leftHit.normal); return true; }
        return false;
    }

    private detectVault(ctx: StateContext): boolean {
        const pos = ctx.body.position().clone().add(new THREE.Vector3(0, 0.8, 0));
        const fwd = ctx.camera.worldForward().clone(); fwd.y = 0; fwd.normalize();
        const hit = ctx.body.castRay(pos, fwd, PLAYER_CONSTANTS.VAULT_REACH);
        return hit.hit && hit.tag === 'vaultable';
    }
}

class LandingState extends PlayerState {
    readonly id = PlayerStateId.LANDING;
    private timer = 0;
    private isRoll = false;

    enter(ctx: StateContext): void {
        this.isRoll = ctx.airTime > PLAYER_CONSTANTS.HARD_LAND_FALL_T;
        this.timer = this.isRoll ? 0.6 : 0.15;
        ctx.airTime = 0;

        // If rolling, convert some vertical velocity into forward momentum
        if (this.isRoll) {
            const fwd = ctx.camera.worldForward().clone(); fwd.y = 0; fwd.normalize();
            ctx.velocity.copy(fwd.multiplyScalar(PLAYER_CONSTANTS.LAND_ROLL_SPEED));
        } else {
            ctx.velocity.y = 0;
        }
    }

    update(_ctx: StateContext, dt: number): PlayerStateId | null {
        this.timer -= dt;
        if (this.timer <= 0) return PlayerStateId.WALKING;
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PARKOUR States
// ─────────────────────────────────────────────────────────────────────────────

class WallRunState extends PlayerState {
    readonly id = PlayerStateId.WALL_RUN;
    private timer = 0;

    enter(ctx: StateContext): void {
        this.timer = PLAYER_CONSTANTS.WALL_RUN_DURATION;
        ctx.wallRunTimer = this.timer;
    }

    update(ctx: StateContext, dt: number): PlayerStateId | null {
        this.timer -= dt;

        // Verify wall still present
        const pos = ctx.body.position().clone().add(new THREE.Vector3(0, 1.0, 0));
        const toWall = ctx.wallNormal.clone().negate();
        const still = ctx.body.castRay(pos, toWall, 0.8);
        if (!still.hit) return PlayerStateId.FALLING;

        if (this.timer <= 0) return PlayerStateId.FALLING;
        if (ctx.body.isGrounded()) return PlayerStateId.WALKING;

        // Jump off wall
        if (this.isJustPressed(ctx, 'jump')) {
            const jumpDir = ctx.wallNormal.clone().add(new THREE.Vector3(0, 0.7, 0)).normalize();
            ctx.velocity.copy(jumpDir.multiplyScalar(PLAYER_CONSTANTS.JUMP_IMPULSE * 1.1));
            return PlayerStateId.JUMPING;
        }

        // Keep running along the wall surface
        const along = new THREE.Vector3().crossVectors(ctx.wallNormal, new THREE.Vector3(0, 1, 0)).normalize();
        // Ensure forward direction  aligns with run direction
        if (ctx.camera.worldForward().dot(along) < 0) along.negate();
        ctx.velocity.copy(along.multiplyScalar(PLAYER_CONSTANTS.SPRINT_SPEED));
        ctx.velocity.y -= 9.81 * PLAYER_CONSTANTS.WALL_RUN_GRAVITY * dt;

        // Camera tilt based on which side the wall is
        const isRight = ctx.camera.worldRight().dot(ctx.wallNormal.clone().negate()) > 0;
        ctx.camera.tilt(isRight ? -0.25 : 0.25, 6.0);

        return null;
    }

    exit(ctx: StateContext): void {
        ctx.camera.tilt(0, 5.0);  // restore camera tilt
    }
}

class MantleState extends PlayerState {
    readonly id = PlayerStateId.MANTLE;
    private progress = 0;
    private ledgePos = new THREE.Vector3();

    enter(ctx: StateContext): void {
        this.progress = 0;
        // Approximate ledge position: forward + up
        const fwd = ctx.camera.worldForward().clone(); fwd.y = 0; fwd.normalize();
        this.ledgePos.copy(ctx.body.position())
            .add(fwd.multiplyScalar(1.0))
            .setY(ctx.body.position().y + PLAYER_CONSTANTS.MANTLE_HEIGHT);
        ctx.velocity.set(0, 0, 0);
    }

    update(ctx: StateContext, dt: number): PlayerStateId | null {
        this.progress += dt * 3.0;  // ~0.33s to complete
        const t = Math.min(this.progress, 1.0);
        // Smoothly arc body up and over the ledge
        const currentPos = ctx.body.position();
        const interpolated = currentPos.clone().lerp(this.ledgePos, t);
        // Move physics body (via velocity toward target)
        const diff = interpolated.clone().sub(currentPos);
        ctx.velocity.copy(diff.multiplyScalar(10));

        if (t >= 1.0) return PlayerStateId.WALKING;
        return null;
    }
}

class SlidingState extends PlayerState {
    readonly id = PlayerStateId.SLIDING;
    private timer = 0;

    enter(ctx: StateContext): void {
        this.timer = PLAYER_CONSTANTS.SLIDE_DURATION;
    }

    update(ctx: StateContext, dt: number): PlayerStateId | null {
        this.timer -= dt;

        if (!ctx.body.isGrounded()) return PlayerStateId.FALLING;
        if (!ctx.input.crouch && this.timer > 0.2) return PlayerStateId.CROUCHING;
        if (this.timer <= 0 || ctx.velocity.length() < 1.0) return PlayerStateId.CROUCHING;

        // Friction deceleration during slide
        const decayFactor = 1.0 - PLAYER_CONSTANTS.SLIDE_FRICTION;
        ctx.velocity.multiplyScalar(decayFactor);
        ctx.velocity.y = 0;

        // Slope acceleration — check ground ahead
        const fwd = ctx.velocity.clone().normalize();
        const slopeHit = ctx.body.castRay(
            ctx.body.position().clone().add(new THREE.Vector3(0, 0.1, 0)),
            new THREE.Vector3(0, -1, 0), 0.5
        );
        if (slopeHit.hit && slopeHit.normal.y < 0.95) {
            // Downhill — add a little extra push
            const slopeAccel = (1.0 - slopeHit.normal.y) * 8.0;
            ctx.velocity.addScaledVector(fwd, slopeAccel * dt);
        }

        return null;
    }
}

class VaultingState extends PlayerState {
    readonly id = PlayerStateId.VAULTING;
    private progress = 0;

    enter(ctx: StateContext): void {
        this.progress = 0;
        ctx.velocity.set(0, 0, 0);
    }

    update(ctx: StateContext, dt: number): PlayerStateId | null {
        this.progress += dt * 4.0; // ~0.25s vault duration
        const fwd = ctx.camera.worldForward().clone(); fwd.y = 0; fwd.normalize();
        ctx.velocity.copy(fwd.multiplyScalar(5.0));
        ctx.velocity.y = Math.sin(this.progress * Math.PI) * 3.5;

        if (this.progress >= 1.0) return PlayerStateId.WALKING;
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMBAT States
// ─────────────────────────────────────────────────────────────────────────────

class AimingState extends PlayerState {
    readonly id = PlayerStateId.AIMING;

    enter(ctx: StateContext): void {
        ctx.isAiming = true;
        ctx.camera.setFOV(PLAYER_CONSTANTS.AIM_FOV, 8.0);
    }

    exit(ctx: StateContext): void {
        ctx.isAiming = false;
        ctx.camera.setFOV(PLAYER_CONSTANTS.DEFAULT_FOV, 5.0);
    }

    update(ctx: StateContext, dt: number): PlayerStateId | null {
        if (!ctx.input.aim_btn) return PlayerStateId.WALKING;
        // Slower movement while aiming
        this.applyGroundMovement(ctx, PLAYER_CONSTANTS.WALK_SPEED * 0.65, dt);
        if (!ctx.body.isGrounded()) return PlayerStateId.FALLING;
        if (this.isJustPressed(ctx, 'reload')) return PlayerStateId.RELOADING;
        return null;
    }
}

class ReloadingState extends PlayerState {
    readonly id = PlayerStateId.RELOADING;
    private timer = 0;
    private readonly RELOAD_TIME = 1.8; // seconds (base)
    private activeReloadWindowStart = 0;
    private activeReloadWindowEnd = 0;
    readonly ACTIVE_RELOAD_PERFECT = 0.12; // window in seconds for perfect
    readonly ACTIVE_RELOAD_GOOD = 0.28; // window in seconds for good
    activeReloadResult: 'perfect' | 'good' | 'fail' | null = null;

    enter(_ctx: StateContext): void {
        this.timer = this.RELOAD_TIME;
        this.activeReloadResult = null;
        // Active reload window: ~40–60% through animation
        this.activeReloadWindowStart = this.RELOAD_TIME * 0.40;
        this.activeReloadWindowEnd = this.RELOAD_TIME * 0.60;
    }

    update(ctx: StateContext, dt: number): PlayerStateId | null {
        const elapsed = this.RELOAD_TIME - this.timer;
        this.timer -= dt;

        // Active Reload: player presses R again during the window
        if (this.isJustPressed(ctx, 'reload') && this.activeReloadResult === null) {
            if (elapsed >= this.activeReloadWindowStart &&
                elapsed <= this.activeReloadWindowStart + this.ACTIVE_RELOAD_PERFECT) {
                this.activeReloadResult = 'perfect';
                this.timer = 0; // instantly finish
            } else if (elapsed <= this.activeReloadWindowEnd) {
                this.activeReloadResult = 'good';
                this.timer = Math.max(this.timer - 0.4, 0); // speed up reload
            } else {
                this.activeReloadResult = 'fail';
                this.timer += 2.0; // jammed — extra 2s delay
            }
        }

        if (this.timer <= 0) {
            return ctx.input.aim_btn ? PlayerStateId.AIMING : PlayerStateId.WALKING;
        }
        return null;
    }
}

class InCoverState extends PlayerState {
    readonly id = PlayerStateId.IN_COVER;

    enter(ctx: StateContext): void {
        // Snap to wall — offset player by cover snap distance along normal
        const snapPos = ctx.body.position().clone()
            .add(ctx.coverNormal.clone().multiplyScalar(PLAYER_CONSTANTS.COVER_SNAP_DIST));
        snapPos.y = ctx.body.position().y;
        // Teleport body to snap point (via velocity set to zero next frame)
        ctx.velocity.set(0, 0, 0);
        void snapPos;
    }

    update(ctx: StateContext, dt: number): PlayerStateId | null {
        if (!ctx.body.isGrounded()) return PlayerStateId.FALLING;

        // Verify cover wall still there
        const wallHit = ctx.body.castRay(
            ctx.body.position().clone().add(new THREE.Vector3(0, 1.0, 0)),
            ctx.coverNormal.clone().negate(), 1.2
        );
        if (!wallHit.hit) return PlayerStateId.WALKING;

        // Move laterally along cover
        const wallRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), ctx.coverNormal);
        const lateral = ctx.input.move.x;
        ctx.velocity.copy(wallRight.multiplyScalar(lateral * PLAYER_CONSTANTS.CROUCH_SPEED));

        // Lean-peek: when moving toward the cover edge, we peek out
        if (this.isJustPressed(ctx, 'jump')) return PlayerStateId.WALKING;
        if (ctx.input.aim_btn) return PlayerStateId.AIMING; // cover + aim = peek aim
        if (ctx.input.sprint) return PlayerStateId.WALKING;

        void dt;
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// VEHICLE States
// ─────────────────────────────────────────────────────────────────────────────

export interface IVehicle {
    entityId: string;
    applyThrottle(value: number): void;
    applyBrake(value: number): void;
    applySteering(value: number): void;
    applyHandbrake(active: boolean): void;
    exitVehicle(): THREE.Vector3; // returns world pos for player to spawn at
    getSeatPosition(seat: 'driver' | 'passenger'): THREE.Vector3;
}

class DrivingState extends PlayerState {
    readonly id = PlayerStateId.DRIVING;
    vehicle: IVehicle | null = null;

    enter(ctx: StateContext, _hsm: HierarchicalStateMachine): void {
        void ctx;
        // vehicle reference is set externally before state activation
    }

    update(ctx: StateContext, _dt: number): PlayerStateId | null {
        if (!this.vehicle) return PlayerStateId.WALKING;

        const throttle = ctx.input.move.y;
        const brake = throttle < 0 ? Math.abs(throttle) : (ctx.input.crouch ? 1 : 0);
        const steering = ctx.input.move.x;

        this.vehicle.applyThrottle(Math.max(0, throttle));
        this.vehicle.applyBrake(brake);
        this.vehicle.applySteering(steering);
        this.vehicle.applyHandbrake(ctx.input.roll);  // spacebar = drift/handbrake

        // Drive-by: fire while driving
        if (ctx.input.fire && ctx.equippedWeaponId) {
            // Fire event dispatched through CombatSystem integration
        }

        if (this.isJustPressed(ctx, 'interact')) {
            this.vehicle.exitVehicle();
            this.vehicle = null;
            return PlayerStateId.WALKING;
        }
        return null;
    }
}

class PassengerState extends PlayerState {
    readonly id = PlayerStateId.PASSENGER;
    vehicle: IVehicle | null = null;

    update(ctx: StateContext, _dt: number): PlayerStateId | null {
        if (!this.vehicle) return PlayerStateId.WALKING;
        // Drive-by shooting as passenger
        if (this.isJustPressed(ctx, 'interact')) {
            this.vehicle.exitVehicle();
            this.vehicle = null;
            return PlayerStateId.WALKING;
        }
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hierarchical State Machine
// ─────────────────────────────────────────────────────────────────────────────

export class HierarchicalStateMachine {
    private stateMap: Map<PlayerStateId, PlayerState>;
    private currentState: PlayerState;
    private parentMap: Partial<Record<PlayerStateId, PlayerStateId>>;

    private readonly defaultChild: Partial<Record<PlayerStateId, PlayerStateId>> = {
        [PlayerStateId.LOCOMOTION]: PlayerStateId.WALKING,
        [PlayerStateId.AIR]: PlayerStateId.FALLING,
        [PlayerStateId.PARKOUR]: PlayerStateId.WALL_RUN,
        [PlayerStateId.COMBAT]: PlayerStateId.AIMING,
        [PlayerStateId.VEHICLE]: PlayerStateId.DRIVING,
    };

    constructor() {
        const states: PlayerState[] = [
            new WalkingState(),
            new RunningState(),
            new SprintingState(),
            new CrouchingState(),
            new JumpingState(),
            new FallingState(),
            new LandingState(),
            new WallRunState(),
            new MantleState(),
            new SlidingState(),
            new VaultingState(),
            new AimingState(),
            new ReloadingState(),
            new InCoverState(),
            new DrivingState(),
            new PassengerState(),
        ];

        this.stateMap = new Map(states.map(s => [s.id, s]));

        // Parent relationships
        this.parentMap = {
            [PlayerStateId.WALKING]: PlayerStateId.LOCOMOTION,
            [PlayerStateId.RUNNING]: PlayerStateId.LOCOMOTION,
            [PlayerStateId.SPRINTING]: PlayerStateId.LOCOMOTION,
            [PlayerStateId.CROUCHING]: PlayerStateId.LOCOMOTION,
            [PlayerStateId.JUMPING]: PlayerStateId.AIR,
            [PlayerStateId.FALLING]: PlayerStateId.AIR,
            [PlayerStateId.LANDING]: PlayerStateId.AIR,
            [PlayerStateId.WALL_RUN]: PlayerStateId.PARKOUR,
            [PlayerStateId.MANTLE]: PlayerStateId.PARKOUR,
            [PlayerStateId.SLIDING]: PlayerStateId.PARKOUR,
            [PlayerStateId.VAULTING]: PlayerStateId.PARKOUR,
            [PlayerStateId.AIMING]: PlayerStateId.COMBAT,
            [PlayerStateId.RELOADING]: PlayerStateId.COMBAT,
            [PlayerStateId.IN_COVER]: PlayerStateId.COMBAT,
            [PlayerStateId.DRIVING]: PlayerStateId.VEHICLE,
            [PlayerStateId.PASSENGER]: PlayerStateId.VEHICLE,
        };

        this.currentState = this.stateMap.get(PlayerStateId.WALKING)!;
    }

    get currentStateId(): PlayerStateId { return this.currentState.id; }

    transition(ctx: StateContext, targetId: PlayerStateId): void {
        // Resolve compound state to default child
        const resolvedId = this.defaultChild[targetId] ?? targetId;
        const nextState = this.stateMap.get(resolvedId);
        if (!nextState || nextState === this.currentState) return;

        this.currentState.exit(ctx);
        this.currentState = nextState;
        this.currentState.enter(ctx, this);
    }

    update(ctx: StateContext, dt: number): void {
        const result = this.currentState.update(ctx, dt);
        if (result !== null) {
            this.transition(ctx, result);
        }
    }

    handleInput(ctx: StateContext, input: InputFrame): void {
        const result = this.currentState.handleInput(ctx, input);
        if (result !== null) {
            this.transition(ctx, result);
        }
    }

    /** Enter vehicle — wires the vehicle reference into driving state. */
    enterVehicle(ctx: StateContext, vehicle: IVehicle, seat: 'driver' | 'passenger'): void {
        const stateId = seat === 'driver' ? PlayerStateId.DRIVING : PlayerStateId.PASSENGER;
        const state = this.stateMap.get(stateId) as DrivingState | PassengerState;
        state.vehicle = vehicle;
        this.transition(ctx, stateId);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PlayerController — Top-Level Facade
// ─────────────────────────────────────────────────────────────────────────────

export class PlayerController {
    private hsm: HierarchicalStateMachine;
    private ctx: StateContext;
    private resolver: SmartInteractionResolver;

    constructor(body: IPhysicsBody, camera: ICameraRig) {
        this.hsm = new HierarchicalStateMachine();
        this.resolver = new SmartInteractionResolver();

        const zeroV2 = new THREE.Vector2();
        const zeroV3 = new THREE.Vector3();
        const emptyInput: InputFrame = {
            move: zeroV2.clone(), aim: zeroV2.clone(),
            jump: false, sprint: false, crouch: false,
            fire: false, aim_btn: false, reload: false,
            interact: false, roll: false, timestamp: 0,
        };

        this.ctx = {
            body, camera,
            input: { ...emptyInput },
            prevInput: { ...emptyInput },
            velocity: zeroV3.clone(),
            wishDir: zeroV3.clone(),
            airTime: 0,
            coyoteTimer: 0,
            jumpBuffer: 0,
            jumpHeld: false,
            bodyLean: 0,
            wallNormal: zeroV3.clone(),
            wallRunTimer: 0,
            equippedWeaponId: null,
            isAiming: false,
            coverNormal: zeroV3.clone(),
            lastInteractHit: null,
        };
    }

    /** Called once per fixed physics step. */
    fixedUpdate(dt: number): void {
        this.hsm.update(this.ctx, dt);

        // Apply velocity to physics body
        this.ctx.body.setVelocity(this.ctx.velocity.clone());

        // Resolve interaction target every frame
        this.ctx.lastInteractHit = this.resolver.resolve(this.ctx, this.hsm.currentStateId);

        // Swap input buffers
        Object.assign(this.ctx.prevInput, this.ctx.input);
    }

    /** Called from input system on every raw input event. */
    onInput(input: Partial<InputFrame>): void {
        Object.assign(this.ctx.input, input);
        this.hsm.handleInput(this.ctx, this.ctx.input);
    }

    /** Enter a vehicle. */
    enterVehicle(vehicle: IVehicle, seat: 'driver' | 'passenger' = 'driver'): void {
        this.hsm.enterVehicle(this.ctx, vehicle, seat);
    }

    /** Trigger cover-snap to the nearest wall. */
    snapToCover(): void {
        const pos = this.ctx.body.position().clone().add(new THREE.Vector3(0, 1.0, 0));
        for (const dir of [
            this.ctx.camera.worldRight(),
            this.ctx.camera.worldRight().clone().negate(),
            this.ctx.camera.worldForward().clone().negate(),
        ]) {
            const hit = this.ctx.body.castRay(pos, dir, PLAYER_CONSTANTS.COVER_SNAP_DIST * 2);
            if (hit.hit && hit.tag === 'wall') {
                this.ctx.coverNormal.copy(hit.normal);
                this.hsm.transition(this.ctx, PlayerStateId.IN_COVER);
                return;
            }
        }
    }

    // ── Getters ───────────────────────────────────────────────────────────────

    get stateId(): PlayerStateId { return this.hsm.currentStateId; }
    get interactionTarget(): InteractionTarget | null { return this.ctx.lastInteractHit; }
    get bodyLean(): number { return this.ctx.bodyLean; }
    get isAiming(): boolean { return this.ctx.isAiming; }
    get velocity(): THREE.Vector3 { return this.ctx.velocity.clone(); }
}
