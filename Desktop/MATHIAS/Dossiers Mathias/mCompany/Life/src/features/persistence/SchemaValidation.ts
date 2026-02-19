/**
 * @fileoverview LIFE Engine — Schema Validation (Zod)
 *
 * Defines the canonical GameSave schema using Zod.
 * This acts as the single source of truth for data shapes:
 *   - Infers TypeScript types to avoid duplication.
 *   - Acts as a sanitizer on load (strips unknown keys, validates ranges).
 *   - Is used by SaveSystem on both write AND read paths.
 *
 * @module persistence/SchemaValidation
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Primitive / Shared Sub-Schemas
// ─────────────────────────────────────────────────────────────────────────────

/** SemVer pattern: "major.minor.patch" */
const SemVerSchema = z.string().regex(/^\d+\.\d+\.\d+$/, 'Must be a valid SemVer string e.g. "1.2.0"');

/** UUID v4 pattern */
const UUIDSchema = z.string().uuid('Must be a valid UUID v4');

/** 3D position vector */
export const Vec3Schema = z.object({
    x: z.number(),
    y: z.number(),
    z: z.number(),
});

/** Quaternion for rotation */
export const QuatSchema = z.object({
    x: z.number(),
    y: z.number(),
    z: z.number(),
    w: z.number(),
});

/** Active status effect on the player */
export const StatusEffectSchema = z.object({
    id: z.string(),
    /** Remaining duration in seconds */
    duration_remaining: z.number().nonnegative(),
    /** Effect intensity multiplier */
    intensity: z.number(),
    source: z.string().optional(),
});

/** Item modification */
const ItemModSchema = z.object({
    mod_id: z.string(),
    level: z.number().int().nonnegative(),
});

/** A single slot in an inventory */
export const InventorySlotSchema = z.object({
    id: z.string(),
    qty: z.number().int().positive(),
    durability: z.number().min(0).max(1).optional(), // 0=broken, 1=perfect
    metadata: z.object({
        /** Hex color or named color string */
        color: z.string().optional(),
        mods: z.array(ItemModSchema).optional(),
        ammo_count: z.number().int().nonnegative().optional(),
        /** Arbitrary extra flags for extensibility */
        extra: z.record(z.string(), z.unknown()).optional(),
    }).optional(),
});

/** State of a single quest */
export const QuestStateSchema = z.object({
    status: z.enum(['NOT_STARTED', 'ACTIVE', 'COMPLETED', 'FAILED']),
    steps_completed: z.array(z.string()),
    timestamps: z.object({
        started: z.number().optional(),
        completed: z.number().optional(),
        failed: z.number().optional(),
    }),
});

/** Serialisable vehicle data for parked vehicles */
export const VehicleDataSchema = z.object({
    vehicle_id: z.string(),
    model_ref: z.string(),
    transform: z.object({
        pos: Vec3Schema,
        rot: QuatSchema,
    }),
    health: z.number().min(0).max(1),
    fuel: z.number().min(0).max(1),
    inventory: z.array(InventorySlotSchema).optional(),
    license_plate: z.string().optional(),
});

/** Global economy modifiers */
export const EconomyStateSchema = z.object({
    /** Per-faction price multipliers, e.g. { "corp_a": 1.2, "rebels": 0.8 } */
    faction_price_modifiers: z.record(z.string(), z.number()),
    /** Per-item-category price multipliers, e.g. { "weapons": 1.5 } */
    category_price_modifiers: z.record(z.string(), z.number()),
    /** Global inflation multiplier */
    inflation: z.number().positive(),
    /** Timestamp of last market event */
    last_market_event: z.number().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Top-Level Sub-Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const SaveMetaSchema = z.object({
    /** SemVer of the game version that created this save */
    version: SemVerSchema,
    /** Build identifier (e.g. git commit hash) */
    build_id: z.string(),
    /** Unique ID for this specific save record */
    save_id: UUIDSchema,
    /** Unix epoch ms of initial creation */
    created_at: z.number().positive(),
    /** Unix epoch ms of last update */
    updated_at: z.number().positive(),
    /** Total gameplay time in seconds */
    playtime_seconds: z.number().nonnegative(),
    /** Base64 encoded low-res JPEG thumbnail, no larger than ~10 KB */
    screenshot_thumbnail: z.string().optional(),
    /**
     * HMAC-SHA-256 hex digest of the save payload.
     * Computed excluding this field itself.
     */
    checksum: z.string(),
});

export const PlayerDataSchema = z.object({
    transform: z.object({
        pos: Vec3Schema,
        rot: QuatSchema,
        /** Chunk grid identifier, e.g. "chunk_12_-5" */
        chunkID: z.string(),
        /** True if the player is in a non-death-zone area */
        safe_location: z.boolean(),
    }),
    status: z.object({
        hp: z.number().min(0).max(200),
        hunger: z.number().min(0).max(100),
        stamina: z.number().min(0).max(100),
        effects: z.array(StatusEffectSchema),
    }),
    inventory: z.array(InventorySlotSchema).max(128),
    /** Map of skill ID → total XP earned in that skill */
    skills: z.record(z.string(), z.number().nonnegative()),
    progression: z.object({
        level: z.number().int().min(1).max(1000),
        /** XP within the current level */
        xp: z.number().nonnegative(),
        karma: z.number().min(-1000).max(1000),
    }),
});

export const WorldDataSchema = z.object({
    /** 0–24 float representing in-game hour */
    time_of_day: z.number().min(0).max(24),
    weather_state: z.string(),
    /** Named boolean flags set by game events */
    global_flags: z.record(z.string(), z.boolean()),
    /**
     * Map of quest_id → quest state.
     * Using strict to reject unknown quest states.
     */
    quest_log: z.record(z.string(), QuestStateSchema),
    /** Map of container_id → its modified inventory */
    containers: z.record(z.string(), z.array(InventorySlotSchema)),
    parked_vehicles: z.array(VehicleDataSchema),
    economy_modifiers: EconomyStateSchema,
    /** NPC-id → relation value (-100=hostile, 0=neutral, 100=ally) */
    npc_relations: z.record(z.string(), z.number().min(-100).max(100)),
});

// ─────────────────────────────────────────────────────────────────────────────
// Root GameSave Schema
// ─────────────────────────────────────────────────────────────────────────────

export const GameSaveSchema = z.object({
    meta: SaveMetaSchema,
    player: PlayerDataSchema,
    world: WorldDataSchema,
});

// ─────────────────────────────────────────────────────────────────────────────
// Inferred TypeScript Types
// ─────────────────────────────────────────────────────────────────────────────

export type Vec3 = z.infer<typeof Vec3Schema>;
export type Quat = z.infer<typeof QuatSchema>;
export type StatusEffect = z.infer<typeof StatusEffectSchema>;
export type InventorySlot = z.infer<typeof InventorySlotSchema>;
export type QuestState = z.infer<typeof QuestStateSchema>;
export type VehicleData = z.infer<typeof VehicleDataSchema>;
export type EconomyState = z.infer<typeof EconomyStateSchema>;

export type SaveMeta = z.infer<typeof SaveMetaSchema>;
export type PlayerData = z.infer<typeof PlayerDataSchema>;
export type WorldData = z.infer<typeof WorldDataSchema>;

/** The canonical, fully-validated game save type. */
export type GameSave = z.infer<typeof GameSaveSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Validation Helpers
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationResult {
    success: boolean;
    data?: GameSave;
    errors?: string[];
}

/**
 * Safely parse and validate a raw unknown value against the GameSave schema.
 *
 * Uses `safeParse` so it never throws — returns a discriminated union result.
 * Strips unknown keys via Zod's default `strip` mode.
 */
export function validateGameSave(rawData: unknown): ValidationResult {
    const result = GameSaveSchema.safeParse(rawData);

    if (result.success) {
        return { success: true, data: result.data };
    }

    const errors = result.error.issues.map(
        (issue) => `[${issue.path.join('.')}] ${issue.message}`
    );
    return { success: false, errors };
}

/**
 * Parse and validate — throws a formatted Error on failure.
 * Use this on the write path where you want to fail-fast.
 */
export function assertValidGameSave(rawData: unknown): GameSave {
    const result = GameSaveSchema.safeParse(rawData);
    if (result.success) return result.data;

    const errorLines = result.error.issues.map(
        (issue) => `  • [${issue.path.join('.')}] ${issue.message}`
    );
    throw new Error(`[SchemaValidation] Invalid GameSave:\n${errorLines.join('\n')}`);
}

/**
 * Partial validation — only checks the `meta` object.
 * Useful for reading slot metadata without loading the full save.
 */
export function validateSaveMeta(rawMeta: unknown): SaveMeta | null {
    const result = SaveMetaSchema.safeParse(rawMeta);
    return result.success ? result.data : null;
}
