/**
 * @module features/persistence
 * Save system feature barrel — re-exports all persistence utilities.
 *
 * Import via: import { saveGame, loadGame } from '@features/persistence'
 */

// SaveSystem — functions & types
export * from './SaveSystem';

// MigrationHandlers
export { migrateSave, CURRENT_GAME_VERSION } from './MigrationHandlers';
export type { MigrationReport } from './MigrationHandlers';

// IntegrityCheck
export { generateChecksum, verifyIntegrity, sanitizeRawData } from './IntegrityCheck';
export type { IntegrityResult } from './IntegrityCheck';

// Schema — Zod schemas and types
export {
    GameSaveSchema,
    PlayerDataSchema,
    WorldDataSchema,
    SaveMetaSchema,
    validateGameSave,
    assertValidGameSave,
    validateSaveMeta,
} from './SchemaValidation';
export type { GameSave, SaveMeta, PlayerData, WorldData } from './SchemaValidation';
