/**
 * @fileoverview LIFE Engine — Migration Handlers
 *
 * Implements a sequential schema migration pipeline.
 *
 * HOW MIGRATIONS WORK:
 *   1. Load raw data (unvalidated).
 *   2. Read `data.meta.version`.
 *   3. Find all migration steps where `fromVersion <= savedVersion < toVersion`.
 *   4. Apply them in order, one at a time.
 *   5. The final result is Zod-validated by the SaveSystem.
 *
 * HOW TO ADD A NEW MIGRATION:
 *   - Bump `CURRENT_GAME_VERSION` in package.json / config.
 *   - Add a new entry to `MIGRATIONS` below.
 *   - Write a pure function `(data) => data` that safely transforms the shape.
 *   - Never mutate without returning — treat data as immutable in each step.
 *
 * @module persistence/MigrationHandlers
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Current game version. Bump this with every release that has saves. */
export const CURRENT_GAME_VERSION = '0.1.0';

// ─────────────────────────────────────────────────────────────────────────────
// Version Utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Parses a SemVer string into comparable integers. */
function parseSemVer(version: string): [number, number, number] {
    const parts = version.split('.').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) {
        throw new Error(`[MigrationHandlers] Invalid SemVer: "${version}"`);
    }
    return parts as [number, number, number];
}

/** Returns -1, 0, or 1 (like Array.sort comparator). */
function compareSemVer(a: string, b: string): number {
    const [aMaj, aMin, aPatch] = parseSemVer(a);
    const [bMaj, bMin, bPatch] = parseSemVer(b);
    if (aMaj !== bMaj) return aMaj < bMaj ? -1 : 1;
    if (aMin !== bMin) return aMin < bMin ? -1 : 1;
    if (aPatch !== bPatch) return aPatch < bPatch ? -1 : 1;
    return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Migration Registry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A migration step transforms the raw data from one version to the next.
 * The `from` version is inclusive. The `to` version is what the data will be
 * after successful migration.
 *
 * IMPORTANT: `handler` receives ANY shape (the previous version's shape).
 * Use optional chaining and nullish coalescing defensively.
 */
interface MigrationStep {
    from: string;
    to: string;
    description: string;
    handler: (data: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * MIGRATION DEFINITIONS
 * Add new entries here in ascending version order.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const MIGRATIONS: MigrationStep[] = [
    // ── Example: v0.0.1 → v0.1.0 ────────────────────────────────────────────
    // In v0.0.1, player.status did not have a "stamina" field.
    // In v0.1.0, we introduced progressive stats. We also renamed item IDs.
    {
        from: '0.0.1',
        to: '0.1.0',
        description: 'Add stamina to player.status, add world.economy_modifiers, rename legacy item IDs.',
        handler: (data) => {
            const player = (data.player ?? {}) as Record<string, unknown>;
            const status = (player.status ?? {}) as Record<string, unknown>;
            const world = (data.world ?? {}) as Record<string, unknown>;

            // 1. Inject stamina with default if missing
            if (typeof status.stamina !== 'number') {
                status.stamina = 100;
            }

            // 2. Inject progression.karma if missing
            const progression = (player.progression ?? {}) as Record<string, unknown>;
            if (typeof progression.karma !== 'number') {
                progression.karma = 0;
            }
            player.progression = progression;

            // 3. Add economy_modifiers if the entire world section was missing it
            if (!world.economy_modifiers) {
                world.economy_modifiers = {
                    faction_price_modifiers: {},
                    category_price_modifiers: {},
                    inflation: 1.0,
                };
            }

            // 4. Add npc_relations if missing
            if (!world.npc_relations) {
                world.npc_relations = {};
            }

            // 5. Add parked_vehicles if missing
            if (!Array.isArray(world.parked_vehicles)) {
                world.parked_vehicles = [];
            }

            // 6. Rename legacy item IDs (example: "sword_v1" → "melee_sword_01")
            const inventory = Array.isArray(player.inventory) ? player.inventory : [];
            player.inventory = inventory.map((slot: unknown) => {
                const s = slot as Record<string, unknown>;
                if (s.id === 'sword_v1') s.id = 'melee_sword_01';
                if (s.id === 'medkit_old') s.id = 'consumable_medkit_standard';
                return s;
            });

            // 7. Update meta version (handler should update this!)
            const meta = (data.meta ?? {}) as Record<string, unknown>;
            meta.version = '0.1.0';

            return {
                ...data,
                meta,
                player: { ...player, status },
                world,
            };
        },
    },

    // ── Future migration template ─────────────────────────────────────────────
    // {
    //   from: '0.1.0',
    //   to: '0.2.0',
    //   description: 'Add thirst stat, new faction system, remap quest IDs.',
    //   handler: (data) => {
    //     const player = (data.player ?? {}) as Record<string, unknown>;
    //     const status = (player.status ?? {}) as Record<string, unknown>;
    //     status.thirst = 100; // New stat with default
    //     const meta = (data.meta ?? {}) as Record<string, unknown>;
    //     meta.version = '0.2.0';
    //     return { ...data, meta, player: { ...player, status } };
    //   },
    // },
];

// Sort migrations to be safe (they should already be in order, but defensive)
MIGRATIONS.sort((a, b) => compareSemVer(a.from, b.from));

// ─────────────────────────────────────────────────────────────────────────────
// Public: Migration Entry Point
// ─────────────────────────────────────────────────────────────────────────────

export interface MigrationReport {
    /** Version of the save as originally loaded */
    fromVersion: string;
    /** Version after all migrations applied */
    toVersion: string;
    /** Ordered list of migration steps that ran */
    appliedMigrations: Array<{ from: string; to: string; description: string }>;
    /** Whether any migration was actually applied */
    migrated: boolean;
}

/**
 * Runs all necessary migrations on raw save data to bring it up to `CURRENT_GAME_VERSION`.
 *
 * - If the save is already on the current version, returns data as-is.
 * - If the save is from a FUTURE version (somehow), we refuse to load it
 *   to avoid corrupting downgraded saves.
 *
 * @param rawData The raw parsed JSON from storage (NOT Zod-validated yet)
 * @returns `{ data, report }` — migrated data + a migration report
 * @throws If version is missing, invalid, or is from an incompatible future.
 */
export async function migrateSave(
    rawData: Record<string, unknown>
): Promise<{ data: Record<string, unknown>; report: MigrationReport }> {
    const meta = rawData.meta as Record<string, unknown> | undefined;
    const savedVersion = (meta?.version as string | undefined) ?? '0.0.1';

    // Refuse future versions
    if (compareSemVer(savedVersion, CURRENT_GAME_VERSION) > 0) {
        throw new Error(
            `[MigrationHandlers] Save version "${savedVersion}" is newer than the current game version "${CURRENT_GAME_VERSION}". ` +
            'Cannot load a save from a newer version of the game.'
        );
    }

    const report: MigrationReport = {
        fromVersion: savedVersion,
        toVersion: savedVersion,
        appliedMigrations: [],
        migrated: false,
    };

    // Already up-to-date
    if (compareSemVer(savedVersion, CURRENT_GAME_VERSION) === 0) {
        return { data: rawData, report };
    }

    // Apply migrations sequentially
    let currentData = { ...rawData };
    let currentVersion = savedVersion;

    for (const migration of MIGRATIONS) {
        // Only apply migrations at or after the current version, and below the current game version
        if (
            compareSemVer(migration.from, currentVersion) >= 0 &&
            compareSemVer(migration.from, CURRENT_GAME_VERSION) < 0
        ) {
            console.info(
                `[MigrationHandlers] Applying migration: ${migration.from} → ${migration.to}: ${migration.description}`
            );
            try {
                currentData = migration.handler(currentData) as Record<string, unknown>;
                report.appliedMigrations.push({
                    from: migration.from,
                    to: migration.to,
                    description: migration.description,
                });
                currentVersion = migration.to;
                report.migrated = true;
            } catch (err) {
                throw new Error(
                    `[MigrationHandlers] Migration from ${migration.from} to ${migration.to} failed: ${(err as Error).message}`
                );
            }
        }
    }

    // Ensure version is stamped correctly even if no migration ran (e.g. skipped versions)
    const finalMeta = (currentData.meta ?? {}) as Record<string, unknown>;
    finalMeta.version = CURRENT_GAME_VERSION;
    currentData.meta = finalMeta;
    report.toVersion = CURRENT_GAME_VERSION;

    return { data: currentData, report };
}
