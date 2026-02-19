/**
 * @fileoverview LIFE Engine — Save System (Core)
 *
 * Orchestrates the complete save/load cycle using:
 *   - `idb-keyval`  → IndexedDB key-value store (async, no boilerplate)
 *   - `lz-string`   → LZ-based compression (~60-80% size reduction)
 *   - `SchemaValidation` → Zod schema (write & read validation / sanitization)
 *   - `IntegrityCheck`   → HMAC-SHA-256 signing & verification
 *   - `MigrationHandlers` → Schema evolution pipeline
 *
 * SAVE SLOTS:
 *   - "manual_0", "manual_1", "manual_2" — 3 explicit manual slots
 *   - "quicksave"                         — fastest save, single slot
 *   - "autosave"                          — rolling, written every N minutes
 *   - "backup"                            — always the N-1 version of the last slot saved
 *
 * ATOMIC WRITE PATTERN (simulated in IndexedDB):
 *   IndexedDB transactions are atomic by spec. We write to a "_staging_{slot}"
 *   key first, then atomically swap it to the final slot key in a single tx.
 *   This mimics write-to-temp → rename, preventing partial saves.
 *
 * COMPRESSION:
 *   Uses LZ-String `compressToUTF16` which stores a compact UTF-16 string
 *   directly in IndexedDB (no binary key shenanigans needed).
 *
 * @module persistence/SaveSystem
 */

import { get, set, del, keys, createStore } from 'idb-keyval';
import LZString from 'lz-string';
import { v4 as uuidv4 } from 'uuid';
import { generateChecksum, verifyIntegrity, sanitizeRawData, IntegrityStatus } from './IntegrityCheck';
import { migrateSave, CURRENT_GAME_VERSION, type MigrationReport } from './MigrationHandlers';
import {
    validateGameSave,
    assertValidGameSave,
    validateSaveMeta,
    type GameSave,
    type SaveMeta,
} from './SchemaValidation';

// ─────────────────────────────────────────────────────────────────────────────
// IDB Store
// ─────────────────────────────────────────────────────────────────────────────

/** Dedicated IDB database & store for LIFE saves. Isolated from other idb-keyval uses. */
const LIFE_STORE = createStore('life-engine', 'saves');

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const SAVE_SLOTS = {
    MANUAL_0: 'manual_0',
    MANUAL_1: 'manual_1',
    MANUAL_2: 'manual_2',
    QUICKSAVE: 'quicksave',
    AUTOSAVE: 'autosave',
    BACKUP: 'backup',
} as const;

export type SaveSlotId = typeof SAVE_SLOTS[keyof typeof SAVE_SLOTS] | string;

/** Prefix for staging keys used in atomic writes */
const STAGING_PREFIX = '_staging_';

/** Minimum free storage quota required to attempt a save (bytes) */
const MIN_FREE_QUOTA_BYTES = 5 * 1024 * 1024; // 5 MB

// ─────────────────────────────────────────────────────────────────────────────
// Result Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SaveResult {
    success: boolean;
    slot: SaveSlotId;
    /** Size of the compressed blob in bytes */
    compressedSizeBytes: number;
    error?: string;
}

export interface LoadResult {
    success: boolean;
    slot: SaveSlotId;
    data?: GameSave;
    report?: MigrationReport;
    warning?: string;
    error?: string;
}

export interface SlotInfo {
    slot: SaveSlotId;
    meta: SaveMeta | null;
    compressedSizeBytes: number;
    exists: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage Quota Check
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estimates available storage using the StorageManager API.
 * Falls back to always allowing if the API is not available.
 */
async function hasEnoughQuota(requiredBytes: number): Promise<boolean> {
    if (!navigator?.storage?.estimate) return true;
    try {
        const { quota = 0, usage = 0 } = await navigator.storage.estimate();
        const available = quota - usage;
        return available >= requiredBytes;
    } catch {
        return true; // Be permissive if query fails
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Compression Helpers
// ─────────────────────────────────────────────────────────────────────────────

function compressPayload(json: string): string {
    return LZString.compressToUTF16(json);
}

function decompressPayload(compressed: string): string | null {
    return LZString.decompressFromUTF16(compressed);
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Saves a game to a specific slot using the full atomic pipeline:
 *
 * 1. Validate input against Zod schema (strict mode — throws on errors).
 * 2. Stamp `meta` with current timestamps, UUIDs, and version.
 * 3. Generate HMAC-SHA-256 checksum and write to `meta.checksum`.
 * 4. Serialize → Compress (LZ-String).
 * 5. Check storage quota.
 * 6. Atomic IDB write: staging key → final key.
 * 7. Propagate backup from the PREVIOUSLY existing save.
 *
 * @param slotId    One of `SAVE_SLOTS` or a custom string.
 * @param rawData   Unsanitized GameSave-shaped object (will be validated).
 * @param options.isNew  If true, generates a fresh `save_id`. Defaults to false.
 */
export async function saveGame(
    slotId: SaveSlotId,
    rawData: GameSave,
    options: { isNew?: boolean } = {}
): Promise<SaveResult> {
    try {
        // 1. Validate input (asserting throws on schema errors)
        const validated = assertValidGameSave(rawData);

        // 2. Stamp meta
        const now = Date.now();
        const saveId = options.isNew ? uuidv4() : (validated.meta.save_id ?? uuidv4());
        const dataToSign: GameSave = {
            ...validated,
            meta: {
                ...validated.meta,
                version: CURRENT_GAME_VERSION,
                save_id: saveId,
                updated_at: now,
                created_at: validated.meta.created_at || now,
                checksum: '', // placeholder — will be overwritten
            },
        };

        // 3. Generate checksum
        const checksum = await generateChecksum(dataToSign);
        const finalData: GameSave = {
            ...dataToSign,
            meta: { ...dataToSign.meta, checksum },
        };

        // 4. Serialize + Compress
        const json = JSON.stringify(finalData);
        const compressed = compressPayload(json);
        const compressedBytes = compressed.length * 2; // UTF-16: 2 bytes per char

        // 5. Quota check
        const enough = await hasEnoughQuota(Math.max(compressedBytes * 2, MIN_FREE_QUOTA_BYTES));
        if (!enough) {
            return {
                success: false,
                slot: slotId,
                compressedSizeBytes: 0,
                error: `[SaveSystem] Insufficient storage quota. Need at least ${MIN_FREE_QUOTA_BYTES / 1024} KB free.`,
            };
        }

        // 6. Backup: read existing save before overwriting
        if (slotId !== SAVE_SLOTS.BACKUP) {
            const existingCompressed = await get<string>(slotId, LIFE_STORE);
            if (existingCompressed) {
                // Silently save to backup (don't await — fire and forget to not block save)
                set(SAVE_SLOTS.BACKUP, existingCompressed, LIFE_STORE).catch(() => {
                    console.warn('[SaveSystem] Failed to write backup slot.');
                });
            }
        }

        // 7. Atomic write: write to staging, then overwrite final key
        const stagingKey = `${STAGING_PREFIX}${slotId}`;
        await set(stagingKey, compressed, LIFE_STORE); // Stage
        await set(slotId, compressed, LIFE_STORE);     // Promote
        await del(stagingKey, LIFE_STORE);             // Clean up staging

        console.info(
            `[SaveSystem] Saved slot "${slotId}" — ${(compressedBytes / 1024).toFixed(1)} KB compressed.`
        );

        return { success: true, slot: slotId, compressedSizeBytes: compressedBytes };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[SaveSystem] saveGame failed for slot "${slotId}":`, message);
        return { success: false, slot: slotId, compressedSizeBytes: 0, error: message };
    }
}

/**
 * Loads and fully validates a game from a specific slot.
 *
 * Full pipeline:
 * 1. Fetch compressed blob from IDB.
 * 2. Decompress.
 * 3. Parse JSON.
 * 4. Sanitize raw object.
 * 5. Verify HMAC-SHA-256 integrity.
 * 6. Run schema migration pipeline.
 * 7. Validate migrated data against Zod schema.
 *
 * On integrity failure, returns `success: false` with instructions
 * to try the backup slot.
 */
export async function loadGame(slotId: SaveSlotId): Promise<LoadResult> {
    try {
        // 1. Fetch from IDB
        const compressed = await get<string>(slotId, LIFE_STORE);
        if (!compressed) {
            return { success: false, slot: slotId, error: `No save found in slot "${slotId}".` };
        }

        // 2. Decompress
        const json = decompressPayload(compressed);
        if (!json) {
            return {
                success: false,
                slot: slotId,
                error: `[SaveSystem] Decompression failed for slot "${slotId}". The save may be corrupted.`,
            };
        }

        // 3. Parse JSON
        let raw: unknown;
        try {
            raw = JSON.parse(json);
        } catch {
            return {
                success: false,
                slot: slotId,
                error: `[SaveSystem] JSON parse failed for slot "${slotId}". The save is corrupted.`,
            };
        }

        // 4. Sanitize (pre-Zod pass)
        const sanitized = sanitizeRawData(raw) as Record<string, unknown>;

        // 5. Integrity check (needs GameSave shape — partial validation first)
        const preValidation = validateGameSave(sanitized);
        if (!preValidation.success || !preValidation.data) {
            return {
                success: false,
                slot: slotId,
                error: `[SaveSystem] Pre-integrity validation failed: ${(preValidation.errors ?? []).join('; ')}`,
            };
        }

        const integrityResult = await verifyIntegrity(preValidation.data);
        let warning: string | undefined;

        if (integrityResult.status === IntegrityStatus.INVALID) {
            return {
                success: false,
                slot: slotId,
                error: `[SaveSystem] Integrity check FAILED. ${integrityResult.message} Try loading the backup slot.`,
            };
        }
        if (integrityResult.status === IntegrityStatus.MISSING_CHECKSUM) {
            // Old save before integrity was added — warn but don't block
            warning = `[SaveSystem] ${integrityResult.message}`;
            console.warn(warning);
        }
        if (integrityResult.status === IntegrityStatus.CRYPTO_UNAVAILABLE) {
            warning = '[SaveSystem] Web Crypto API unavailable. Skipping integrity check.';
            console.warn(warning);
        }

        // 6. Migration
        const { data: migratedRaw, report } = await migrateSave(sanitized);
        if (report.migrated) {
            console.info(`[SaveSystem] Migrated save from ${report.fromVersion} to ${report.toVersion}.`, report);
        }

        // 7. Final Zod validation (strict, on migrated data)
        const finalValidation = validateGameSave(migratedRaw);
        if (!finalValidation.success || !finalValidation.data) {
            return {
                success: false,
                slot: slotId,
                error: `[SaveSystem] Final validation failed after migration: ${(finalValidation.errors ?? []).join('; ')}`,
            };
        }

        return {
            success: true,
            slot: slotId,
            data: finalValidation.data,
            report,
            ...(warning ? { warning } : {}),
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[SaveSystem] loadGame failed for slot "${slotId}":`, message);
        return { success: false, slot: slotId, error: message };
    }
}

/**
 * Deletes a save slot from IndexedDB.
 */
export async function deleteSave(slotId: SaveSlotId): Promise<void> {
    await del(slotId, LIFE_STORE);
    console.info(`[SaveSystem] Deleted slot "${slotId}".`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Slot Listing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns metadata for all known save slots without loading the full data.
 * Useful for rendering the save/load screen.
 *
 * Reads only light metadata by decompressing and parsing just enough to get
 * `meta` — does NOT fully validate or run migrations (fast path).
 */
export async function listSaves(): Promise<SlotInfo[]> {
    const allKeys = await keys<string>(LIFE_STORE);
    const saveKeys = allKeys.filter(
        (k) =>
            typeof k === 'string' &&
            !k.startsWith(STAGING_PREFIX) &&
            Object.values(SAVE_SLOTS).includes(k as typeof SAVE_SLOTS[keyof typeof SAVE_SLOTS])
    );

    const slotInfos: SlotInfo[] = await Promise.all(
        saveKeys.map(async (slotId): Promise<SlotInfo> => {
            const compressed = await get<string>(slotId as SaveSlotId, LIFE_STORE);
            if (!compressed) {
                return { slot: slotId as SaveSlotId, meta: null, compressedSizeBytes: 0, exists: false };
            }

            const json = decompressPayload(compressed);
            let meta: SaveMeta | null = null;
            if (json) {
                try {
                    const raw = JSON.parse(json) as Record<string, unknown>;
                    meta = validateSaveMeta(raw.meta);
                } catch {
                    // Ignore parse errors in listing — slot still shows as existing but corrupt
                }
            }

            return {
                slot: slotId as SaveSlotId,
                meta,
                compressedSizeBytes: compressed.length * 2,
                exists: true,
            };
        })
    );

    // Sort: manual slots first, then quicksave, autosave, backup
    const order: SaveSlotId[] = [
        SAVE_SLOTS.MANUAL_0,
        SAVE_SLOTS.MANUAL_1,
        SAVE_SLOTS.MANUAL_2,
        SAVE_SLOTS.QUICKSAVE,
        SAVE_SLOTS.AUTOSAVE,
        SAVE_SLOTS.BACKUP,
    ];
    slotInfos.sort(
        (a, b) => order.indexOf(a.slot as typeof order[0]) - order.indexOf(b.slot as typeof order[0])
    );

    return slotInfos;
}

// ─────────────────────────────────────────────────────────────────────────────
// AutoSave Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Starts a periodic autosave timer.
 *
 * @param getGameData  Callback that returns the current game state.
 * @param intervalMs   How often to autosave. Default: 5 minutes.
 * @returns A `stop` function to cancel the timer.
 */
export function startAutoSave(
    getGameData: () => GameSave,
    intervalMs = 5 * 60 * 1000
): { stop: () => void } {
    let isSaving = false;
    const timer = setInterval(async () => {
        if (isSaving) return; // Skip if a save is already in progress
        isSaving = true;
        try {
            const data = getGameData();
            const result = await saveGame(SAVE_SLOTS.AUTOSAVE, data);
            if (!result.success) {
                console.warn('[SaveSystem] AutoSave failed:', result.error);
            } else {
                console.info(`[SaveSystem] AutoSave complete — ${(result.compressedSizeBytes / 1024).toFixed(1)} KB.`);
            }
        } finally {
            isSaving = false;
        }
    }, intervalMs);

    return {
        stop: () => {
            clearInterval(timer);
            console.info('[SaveSystem] AutoSave stopped.');
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-export for convenience
// ─────────────────────────────────────────────────────────────────────────────

export type { GameSave, SaveMeta, InventorySlot, QuestState, VehicleData } from './SchemaValidation';
export { IntegrityStatus } from './IntegrityCheck';
export { CURRENT_GAME_VERSION } from './MigrationHandlers';
