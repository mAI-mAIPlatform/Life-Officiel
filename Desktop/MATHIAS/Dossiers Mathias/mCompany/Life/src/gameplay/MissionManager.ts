/**
 * @fileoverview LIFE — MissionManager.ts
 * @description  Mission system: abstract Mission class, concrete mission types
 *               (Delivery, Assassination, Hacking, Race), grid-based hacking
 *               minigame, and a procedural mission generator driven by
 *               faction reputation.
 */

import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Shared Types
// ─────────────────────────────────────────────────────────────────────────────

export const enum MissionStatus {
    AVAILABLE = 'AVAILABLE',
    ASSIGNED = 'ASSIGNED',
    ACTIVE = 'ACTIVE',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
}

export const enum MissionType {
    DELIVERY = 'DELIVERY',
    ASSASSINATION = 'ASSASSINATION',
    HACKING = 'HACKING',
    RACE = 'RACE',
    HEIST = 'HEIST',
}

export const enum ObjectiveType {
    GO_TO = 'GO_TO',
    ELIMINATE = 'ELIMINATE',
    COLLECT = 'COLLECT',
    SURVIVE = 'SURVIVE',
    HACK = 'HACK',
    DELIVER = 'DELIVER',
    RACE_FINISH = 'RACE_FINISH',
}

export interface MissionObjective {
    id: string;
    type: ObjectiveType;
    description: string;
    completed: boolean;
    failed: boolean;
    position: THREE.Vector3 | null;
    radius: number;         // completion zone radius (m)
    optional: boolean;
    // For elimination targets
    targetEntityId?: string;
    // For timer objectives
    timeLimit?: number;         // seconds
    timeElapsed?: number;
    // For collection
    collectCount?: number;
    collected?: number;
}

export interface MissionReward {
    credits: number;
    xp: number;
    itemIds: string[];
    reputation: Partial<Record<string, number>>; // factionId → delta
}

export interface MissionContext {
    playerPosition: THREE.Vector3;
    playerReputation: Record<string, number>; // factionId → value
    playerLevel: number;
    completedMissionIds: Set<string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Abstract Mission
// ─────────────────────────────────────────────────────────────────────────────

export abstract class Mission {
    abstract readonly type: MissionType;
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly reward: MissionReward;
    readonly difficulty: number; // 1–5

    status: MissionStatus = MissionStatus.AVAILABLE;
    objectives: MissionObjective[] = [];

    protected timeElapsed: number = 0;
    protected startTime: number = 0;

    constructor(id: string, name: string, description: string, reward: MissionReward, difficulty: number) {
        this.id = id;
        this.name = name;
        this.description = description;
        this.reward = reward;
        this.difficulty = difficulty;
    }

    /** Call when player accepts the mission. */
    assign(): void {
        if (this.status !== MissionStatus.AVAILABLE) return;
        this.status = MissionStatus.ASSIGNED;
        this.startTime = performance.now();
        this.onAssign();
    }

    /** Call when player arrives at starting point. */
    start(): void {
        if (this.status !== MissionStatus.ASSIGNED) return;
        this.status = MissionStatus.ACTIVE;
        this.onStart();
    }

    /**
     * Per-frame update. Returns new status if changed, or null.
     */
    update(ctx: MissionContext, dt: number): MissionStatus | null {
        if (this.status !== MissionStatus.ACTIVE) return null;
        this.timeElapsed += dt;

        const result = this.onUpdate(ctx, dt);
        if (result) this.status = result;
        return result ?? null;
    }

    /** Force fail (police, death, timeout). */
    fail(reason: string): void {
        this.status = MissionStatus.FAILED;
        this.onFail(reason);
    }

    protected complete(): MissionStatus {
        this.status = MissionStatus.COMPLETED;
        this.onComplete();
        return MissionStatus.COMPLETED;
    }

    // ── Hooks ─────────────────────────────────────────────────────────────────

    protected onAssign(): void { }
    protected onStart(): void { }
    protected abstract onUpdate(ctx: MissionContext, dt: number): MissionStatus | null;
    protected onFail(_reason: string): void { }
    protected onComplete(): void { }

    // ── Objective Helpers ────────────────────────────────────────────────────-

    protected checkProximity(playerPos: THREE.Vector3, obj: MissionObjective): boolean {
        if (!obj.position) return false;
        return playerPos.distanceTo(obj.position) <= obj.radius;
    }

    protected allRequired(): boolean {
        return this.objectives.filter(o => !o.optional).every(o => o.completed);
    }

    get activeObjective(): MissionObjective | undefined {
        return this.objectives.find(o => !o.completed && !o.failed);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Delivery Mission
// ─────────────────────────────────────────────────────────────────────────────

export interface DeliveryConfig {
    pickupPos: THREE.Vector3;
    dropoffPos: THREE.Vector3;
    timeLimit: number;   // seconds
    fragile: boolean;  // cargo takes damage
    maxCargoDamage: number;   // if fragile, how much damage triggers fail
}

export class DeliveryMission extends Mission {
    readonly type = MissionType.DELIVERY;
    private cfg: DeliveryConfig;
    private cargoPickedUp = false;
    private cargoDamage = 0;

    constructor(id: string, name: string, cfg: DeliveryConfig, reward: MissionReward, diff: number) {
        super(id, name, `Livrez la cargaison en ${Math.floor(cfg.timeLimit / 60)}:${String(cfg.timeLimit % 60).padStart(2, '0')}`, reward, diff);
        this.cfg = cfg;
        this.objectives = [
            {
                id: `${id}_pickup`, type: ObjectiveType.GO_TO,
                description: 'Récupérer la cargaison',
                completed: false, failed: false,
                position: cfg.pickupPos, radius: 3.0, optional: false,
                collectCount: 1, collected: 0,
            },
            {
                id: `${id}_dropoff`, type: ObjectiveType.DELIVER,
                description: 'Livrer la cargaison',
                completed: false, failed: false,
                position: cfg.dropoffPos, radius: 3.5, optional: false,
                timeLimit: cfg.timeLimit, timeElapsed: 0,
            },
        ];
    }

    onUpdate(ctx: MissionContext, dt: number): MissionStatus | null {
        const [pickup, dropoff] = this.objectives;
        if (!pickup || !dropoff) return null;

        if (!this.cargoPickedUp) {
            if (this.checkProximity(ctx.playerPosition, pickup)) {
                pickup.completed = true;
                this.cargoPickedUp = true;
            }
        } else {
            dropoff.timeElapsed = (dropoff.timeElapsed ?? 0) + dt;

            // Time limit check
            if ((dropoff.timeElapsed ?? 0) >= (dropoff.timeLimit ?? Infinity)) {
                this.fail('Temps écoulé');
                return MissionStatus.FAILED;
            }

            // Fragile cargo damage check
            if (this.cfg.fragile && this.cargoDamage >= this.cfg.maxCargoDamage) {
                this.fail('Cargaison détruite');
                return MissionStatus.FAILED;
            }

            if (this.checkProximity(ctx.playerPosition, dropoff)) {
                dropoff.completed = true;
                return this.complete();
            }
        }
        return null;
    }

    /** Called by physics system when player vehicle takes heavy damage. */
    applyCargoDamage(amount: number): void {
        if (this.cfg.fragile) this.cargoDamage += amount;
    }

    get timeRemaining(): number {
        const dropoff = this.objectives[1];
        if (!dropoff?.timeLimit) return Infinity;
        return dropoff.timeLimit - (dropoff.timeElapsed ?? 0);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Assassination Mission
// ─────────────────────────────────────────────────────────────────────────────

export interface AssassinationConfig {
    targetEntityId: string;
    targetName: string;
    targetPosition: THREE.Vector3;
    allowedMethods: Array<'stealth' | 'combat' | 'any'>;
    stealthBonus: number;   // credits bonus for silent kill
    collateralLimit: number;   // max civilian casualties before fail
}

export class AssassinationMission extends Mission {
    readonly type = MissionType.ASSASSINATION;
    private cfg: AssassinationConfig;
    private collateralCount = 0;
    private wasStealthy = false;

    constructor(id: string, name: string, cfg: AssassinationConfig, reward: MissionReward, diff: number) {
        super(id, name, `Éliminez ${cfg.targetName}`, reward, diff);
        this.cfg = cfg;
        this.objectives = [
            {
                id: `${id}_find`, type: ObjectiveType.GO_TO,
                description: `Localiser ${cfg.targetName}`,
                completed: false, failed: false,
                position: cfg.targetPosition, radius: 30.0, optional: false,
            },
            {
                id: `${id}_kill`, type: ObjectiveType.ELIMINATE,
                description: `Éliminer ${cfg.targetName}`,
                completed: false, failed: false,
                position: null, radius: 0, optional: false,
                targetEntityId: cfg.targetEntityId,
            },
        ];
    }

    onUpdate(ctx: MissionContext, _dt: number): MissionStatus | null {
        const [find, kill] = this.objectives;
        if (!find || !kill) return null;

        // Collateral check
        if (this.collateralCount >= this.cfg.collateralLimit) {
            this.fail(`${this.collateralCount} victimes civiles — mission abandonnée`);
            return MissionStatus.FAILED;
        }

        if (!find.completed) {
            if (this.checkProximity(ctx.playerPosition, find)) find.completed = true;
        }

        return null;
    }

    /** Called by game when an entity dies. */
    onEntityKilled(entityId: string, isCivilian: boolean, wasStealthKill: boolean): MissionStatus | null {
        if (isCivilian) { this.collateralCount++; return null; }
        if (entityId === this.cfg.targetEntityId) {
            const kill = this.objectives[1];
            if (kill) kill.completed = true;
            this.wasStealthy = wasStealthKill;
            return this.complete();
        }
        return null;
    }

    protected onComplete(): void {
        // Apply stealth bonus retroactively
        if (this.wasStealthy) {
            this.reward.credits += this.cfg.stealthBonus;
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hacking Minigame (Pipe Connection Puzzle)
// ─────────────────────────────────────────────────────────────────────────────

export type PipePorts = Set<'N' | 'S' | 'E' | 'W'>;

export interface HexTile {
    row: number;
    col: number;
    ports: PipePorts;     // which sides have connections
    rotation: number;        // 0, 90, 180, 270 degrees
    locked: boolean;       // cannot be rotated
    isSource: boolean;
    isTarget: boolean;
    powered: boolean;       // computed: connected to source
}

const OPPOSITE: Record<string, string> = { N: 'S', S: 'N', E: 'W', W: 'E' };

function rotatePorts(ports: PipePorts, rotateDeg: number): PipePorts {
    const steps = ((rotateDeg / 90) % 4 + 4) % 4;
    const order = ['N', 'E', 'S', 'W'];
    const result = new Set<'N' | 'S' | 'E' | 'W'>();
    for (const p of ports) {
        const idx = order.indexOf(p);
        if (idx >= 0) result.add(order[(idx + steps) % 4] as 'N' | 'S' | 'E' | 'W');
    }
    return result;
}

function getRotatedPorts(tile: HexTile): PipePorts {
    return rotatePorts(tile.ports, tile.rotation);
}

function canConnect(fromTile: HexTile, toTile: HexTile, direction: 'N' | 'S' | 'E' | 'W'): boolean {
    const fromPorts = getRotatedPorts(fromTile);
    const toPorts = getRotatedPorts(toTile);
    return fromPorts.has(direction) && toPorts.has(OPPOSITE[direction] as 'N' | 'S' | 'E' | 'W');
}

export class HackingMinigame {
    readonly rows: number;
    readonly cols: number;
    grid: HexTile[][];
    timeLimit: number;   // seconds
    timeElapsed: number = 0;
    solved: boolean = false;
    failed: boolean = false;

    constructor(rows: number, cols: number, timeLimit: number) {
        this.rows = rows;
        this.cols = cols;
        this.timeLimit = timeLimit;
        this.grid = this.generateGrid();
    }

    private generateGrid(): HexTile[][] {
        const grid: HexTile[][] = [];
        for (let r = 0; r < this.rows; r++) {
            grid.push([]);
            for (let c = 0; c < this.cols; c++) {
                const portCount = 2 + Math.floor(Math.random() * 2);
                const allPorts = ['N', 'S', 'E', 'W'] as const;
                const shuffled = [...allPorts].sort(() => Math.random() - 0.5).slice(0, portCount);
                grid[r]!.push({
                    row: r, col: c,
                    ports: new Set(shuffled),
                    rotation: [0, 90, 180, 270][Math.floor(Math.random() * 4)]!,
                    locked: Math.random() < 0.15,
                    isSource: r === 0 && c === 0,
                    isTarget: r === this.rows - 1 && c === this.cols - 1,
                    powered: false,
                });
            }
        }
        return grid;
    }

    /** Rotate a tile 90° clockwise. */
    rotateTile(row: number, col: number): void {
        const tile = this.grid[row]?.[col];
        if (!tile || tile.locked) return;
        tile.rotation = (tile.rotation + 90) % 360;
        this.recomputePower();
    }

    /** BFS from source — sets .powered on connected tiles. */
    recomputePower(): boolean {
        for (const row of this.grid) for (const tile of row) tile.powered = false;

        const source = this.grid[0]?.[0];
        if (!source) return false;
        source.powered = true;

        const queue: HexTile[] = [source];
        const dirs: Array<{ d: 'N' | 'S' | 'E' | 'W'; dr: number; dc: number }> = [
            { d: 'N', dr: -1, dc: 0 }, { d: 'S', dr: 1, dc: 0 },
            { d: 'E', dr: 0, dc: 1 }, { d: 'W', dr: 0, dc: -1 },
        ];

        while (queue.length > 0) {
            const current = queue.shift()!;
            for (const { d, dr, dc } of dirs) {
                const nr = current.row + dr;
                const nc = current.col + dc;
                const neighbor = this.grid[nr]?.[nc];
                if (!neighbor || neighbor.powered) continue;
                if (canConnect(current, neighbor, d)) {
                    neighbor.powered = true;
                    queue.push(neighbor);
                }
            }
        }

        const target = this.grid[this.rows - 1]?.[this.cols - 1];
        this.solved = target?.powered ?? false;
        return this.solved;
    }

    tick(dt: number): 'playing' | 'solved' | 'failed' {
        if (this.solved) return 'solved';
        if (this.failed) return 'failed';
        this.timeElapsed += dt;
        if (this.timeElapsed >= this.timeLimit) { this.failed = true; return 'failed'; }
        return 'playing';
    }

    get progress(): number { return this.timeElapsed / this.timeLimit; }
    get timeRemaining(): number { return Math.max(0, this.timeLimit - this.timeElapsed); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hacking Mission
// ─────────────────────────────────────────────────────────────────────────────

export interface HackingConfig {
    terminalPosition: THREE.Vector3;
    gridRows: number;
    gridCols: number;
    timeLimit: number;   // minigame timer
    missionTimeLimit: number;   // total mission timeout
    targetEntityId: string;   // what unlocks on success (door, safe, etc.)
}

export class HackingMission extends Mission {
    readonly type = MissionType.HACKING;
    private cfg: HackingConfig;
    minigame: HackingMinigame | null = null;
    private inProgress = false;

    constructor(id: string, name: string, cfg: HackingConfig, reward: MissionReward, diff: number) {
        super(id, name, `Hackez le terminal sécurisé`, reward, diff);
        this.cfg = cfg;
        this.objectives = [
            {
                id: `${id}_reach`, type: ObjectiveType.GO_TO,
                description: 'Atteindre le terminal',
                completed: false, failed: false,
                position: cfg.terminalPosition, radius: 2.0, optional: false,
            },
            {
                id: `${id}_hack`, type: ObjectiveType.HACK,
                description: 'Pirater le système',
                completed: false, failed: false,
                position: cfg.terminalPosition, radius: 2.0, optional: false,
                timeLimit: cfg.missionTimeLimit, timeElapsed: 0,
            },
        ];
    }

    onUpdate(ctx: MissionContext, dt: number): MissionStatus | null {
        const [reach, hack] = this.objectives;
        if (!reach || !hack) return null;

        // Mission-level timeout
        hack.timeElapsed = (hack.timeElapsed ?? 0) + dt;
        if ((hack.timeElapsed ?? 0) >= (hack.timeLimit ?? Infinity)) {
            this.fail('Délai mission dépassé');
            return MissionStatus.FAILED;
        }

        if (!reach.completed) {
            if (this.checkProximity(ctx.playerPosition, reach)) {
                reach.completed = true;
                // Auto-start minigame
                this.startHacking();
            }
        }

        // Update minigame if active
        if (this.minigame && this.inProgress) {
            const result = this.minigame.tick(dt);
            if (result === 'solved') {
                if (hack) hack.completed = true;
                this.inProgress = false;
                return this.complete();
            } else if (result === 'failed') {
                this.inProgress = false;
                this.fail('Hack échoué — alarme déclenchée');
                return MissionStatus.FAILED;
            }
        }
        return null;
    }

    startHacking(): HackingMinigame {
        this.minigame = new HackingMinigame(this.cfg.gridRows, this.cfg.gridCols, this.cfg.timeLimit);
        this.inProgress = true;
        return this.minigame;
    }

    /** Player input — rotate tile at [row,col]. */
    rotateTile(row: number, col: number): void {
        this.minigame?.rotateTile(row, col);
        if (this.minigame?.solved) {
            // Immediately resolve next update tick
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Race Mission
// ─────────────────────────────────────────────────────────────────────────────

export interface RaceConfig {
    checkpoints: THREE.Vector3[];
    laps: number;
    timeLimit: number;  // seconds for total race
    aiRacerIds: string[];
    rubberBanding: boolean; // AI speeds up/down based on player position
}

export class RaceMission extends Mission {
    readonly type = MissionType.RACE;
    private cfg: RaceConfig;
    private currentLap: number = 0;
    private currentCP: number = 0;
    private playerPosition: number = 1; // race position (1 = first)

    constructor(id: string, name: string, cfg: RaceConfig, reward: MissionReward, diff: number) {
        super(id, name, `Terminez la course en 1ère position`, reward, diff);
        this.cfg = cfg;
        this.objectives = cfg.checkpoints.map((pos, i) => ({
            id: `${id}_cp_${i}`,
            type: ObjectiveType.RACE_FINISH,
            description: i === cfg.checkpoints.length - 1 ? 'Ligne d\'arrivée' : `Checkpoint ${i + 1}`,
            completed: false,
            failed: false,
            position: pos,
            radius: 6.0,
            optional: false,
            timeLimit: cfg.timeLimit,
            timeElapsed: 0,
        }));
    }

    onUpdate(ctx: MissionContext, dt: number): MissionStatus | null {
        for (const obj of this.objectives) {
            if (obj.timeElapsed !== undefined) obj.timeElapsed += dt;
        }

        // Total time limit
        if ((this.objectives[0]?.timeElapsed ?? 0) >= this.cfg.timeLimit) {
            this.fail('Temps écoulé');
            return MissionStatus.FAILED;
        }

        const currentObj = this.objectives[this.currentCP];
        if (!currentObj || currentObj.completed) return null;

        if (this.checkProximity(ctx.playerPosition, currentObj)) {
            currentObj.completed = true;
            this.currentCP++;

            // Lap completion
            if (this.currentCP >= this.cfg.checkpoints.length) {
                this.currentLap++;
                if (this.currentLap >= this.cfg.laps) {
                    return this.complete();
                }
                // Reset checkpoints for next lap
                this.currentCP = 0;
                for (const obj of this.objectives) obj.completed = false;
            }
        }
        return null;
    }

    /** Called by AI system to notify player position change. */
    updateRacePosition(pos: number): void {
        this.playerPosition = pos;
    }

    get lapProgress(): string { return `Tour ${this.currentLap + 1}/${this.cfg.laps}`; }
    get racePosition(): number { return this.playerPosition; }
    get nextCheckpoint(): THREE.Vector3 | null {
        return this.cfg.checkpoints[this.currentCP] ?? null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Procedural Mission Generator
// ─────────────────────────────────────────────────────────────────────────────

export interface FactionReputation {
    factionId: string;
    name: string;
    value: number;   // -100 to +100
}

export interface GeneratorConfig {
    playerLevel: number;
    playerPos: THREE.Vector3;
    reputations: FactionReputation[];
    district: string;
    seed?: number;
}

const FACTION_MISSION_WEIGHTS: Record<string, MissionType[]> = {
    police: [MissionType.RACE],
    criminals: [MissionType.DELIVERY, MissionType.ASSASSINATION],
    hackers: [MissionType.HACKING],
    corp: [MissionType.HACKING, MissionType.DELIVERY],
    neutral: [MissionType.DELIVERY, MissionType.RACE],
};

function seededRandom(seed: number): () => number {
    let s = seed;
    return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
}

export class ProceduralMissionGenerator {
    private missionCounter = 0;

    generate(cfg: GeneratorConfig, count: number = 3): Mission[] {
        const rng = seededRandom(cfg.seed ?? Date.now());
        const results: Mission[] = [];

        for (let i = 0; i < count; i++) {
            // Pick a faction with positive reputation where possible
            const eligible = cfg.reputations.filter(r => r.value > -50);
            if (eligible.length === 0) continue;
            const faction = eligible[Math.floor(rng() * eligible.length)]!;

            const weights = FACTION_MISSION_WEIGHTS[faction.factionId] ?? FACTION_MISSION_WEIGHTS['neutral']!;
            const mType = weights[Math.floor(rng() * weights.length)]!;
            const diff = Math.min(5, Math.max(1, Math.round(1 + cfg.playerLevel / 5 + rng() * 2)));

            const mission = this.buildMission(mType, faction, diff, cfg, rng);
            if (mission) results.push(mission);
        }

        return results;
    }

    private buildMission(
        type: MissionType,
        faction: FactionReputation,
        diff: number,
        cfg: GeneratorConfig,
        rng: () => number,
    ): Mission | null {
        const id = `proc_${++this.missionCounter}_${type}`;
        const credits = Math.round(500 + diff * 800 + rng() * 1000);
        const xp = Math.round(100 + diff * 150 + rng() * 200);
        const reward: MissionReward = {
            credits,
            xp,
            itemIds: [],
            reputation: { [faction.factionId]: diff * 5 },
        };

        const offset = () => new THREE.Vector3(
            (rng() - 0.5) * 400, 0, (rng() - 0.5) * 400
        ).add(cfg.playerPos);

        switch (type) {
            case MissionType.DELIVERY: {
                const cfg2: DeliveryConfig = {
                    pickupPos: offset(),
                    dropoffPos: offset(),
                    timeLimit: 120 + diff * 60,
                    fragile: rng() > 0.6,
                    maxCargoDamage: 50 - diff * 8,
                };
                return new DeliveryMission(id, `Livraison [${faction.name}]`, cfg2, reward, diff);
            }
            case MissionType.ASSASSINATION: {
                const cfg2: AssassinationConfig = {
                    targetEntityId: `npc_target_${Math.floor(rng() * 1000)}`,
                    targetName: `Cible ${Math.floor(rng() * 1000)}`,
                    targetPosition: offset(),
                    allowedMethods: ['any'],
                    stealthBonus: Math.round(credits * 0.5),
                    collateralLimit: diff <= 2 ? 1 : 3,
                };
                return new AssassinationMission(id, `Contrat [${faction.name}]`, cfg2, reward, diff);
            }
            case MissionType.HACKING: {
                const cfg2: HackingConfig = {
                    terminalPosition: offset(),
                    gridRows: 3 + diff,
                    gridCols: 3 + diff,
                    timeLimit: 30 + diff * 10,
                    missionTimeLimit: 300 + diff * 60,
                    targetEntityId: `terminal_${Math.floor(rng() * 1000)}`,
                };
                return new HackingMission(id, `Infiltration numérique [${faction.name}]`, cfg2, reward, diff);
            }
            case MissionType.RACE: {
                const checkpoints: THREE.Vector3[] = [];
                for (let i = 0; i < 4 + diff; i++) checkpoints.push(offset());
                const cfg2: RaceConfig = {
                    checkpoints, laps: 1 + Math.floor(rng() * 2),
                    timeLimit: 180 + diff * 60, aiRacerIds: [],
                    rubberBanding: true,
                };
                return new RaceMission(id, `Course [${faction.name}]`, cfg2, reward, diff);
            }
            default:
                return null;
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mission Manager — registry + active mission orchestration
// ─────────────────────────────────────────────────────────────────────────────

export class MissionManager {
    private registry: Map<string, Mission> = new Map();
    private active: Mission[] = [];
    private completed: Set<string> = new Set();
    readonly generator: ProceduralMissionGenerator;

    constructor() {
        this.generator = new ProceduralMissionGenerator();
    }

    register(mission: Mission): void {
        this.registry.set(mission.id, mission);
    }

    assign(missionId: string): boolean {
        const m = this.registry.get(missionId);
        if (!m || m.status !== MissionStatus.AVAILABLE) return false;
        m.assign();
        return true;
    }

    start(missionId: string): boolean {
        const m = this.registry.get(missionId);
        if (!m || m.status !== MissionStatus.ASSIGNED) return false;
        m.start();
        this.active.push(m);
        return true;
    }

    tick(ctx: MissionContext, dt: number): Array<{ mission: Mission; newStatus: MissionStatus }> {
        const changes: Array<{ mission: Mission; newStatus: MissionStatus }> = [];
        for (const m of this.active) {
            const result = m.update(ctx, dt);
            if (result) {
                changes.push({ mission: m, newStatus: result });
                if (result === MissionStatus.COMPLETED) this.completed.add(m.id);
            }
        }
        // Remove finished missions from active
        this.active = this.active.filter(m => m.status === MissionStatus.ACTIVE);
        return changes;
    }

    /** Generate and auto-register procedural missions. */
    populateProceduralMissions(genConfig: GeneratorConfig, count = 3): Mission[] {
        const missions = this.generator.generate(genConfig, count);
        for (const m of missions) this.register(m);
        return missions;
    }

    getAvailable(): Mission[] { return [...this.registry.values()].filter(m => m.status === MissionStatus.AVAILABLE); }
    getActive(): Mission[] { return this.active; }
    getMission(id: string): Mission | undefined { return this.registry.get(id); }
    isCompleted(id: string): boolean { return this.completed.has(id); }
}
