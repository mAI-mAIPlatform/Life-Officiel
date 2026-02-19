/**
 * @fileoverview LIFE Engine — Integrity Check & Anti-Tamper
 *
 * Uses the browser's native `SubtleCrypto` (Web Crypto API) for HMAC-SHA-256
 * signing and verification. This provides:
 *   1. Corruption detection — if the data was partially written.
 *   2. Casual tamper detection — if a user edits the stored blob.
 *
 * NOTE: This is CLIENT-SIDE security. A sophisticated user can still bypass
 * it by also updating the key or patching the JS. For server-authoritative
 * anti-cheat, server-side verification is required.
 *
 * @module persistence/IntegrityCheck
 */

import type { GameSave } from './SchemaValidation';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * IMPORTANT: Rotate this salt periodically (requires a migration that
 * re-signs existing saves). Embedding it here is a basic deterrent.
 * For production, derive this from a user-specific token or environment variable.
 */
const HMAC_KEY_MATERIAL = 'LIFE_ENGINE_HMAC_KEY_V1_NeoCity_2035';
const ALGORITHM: HmacKeyGenParams = { name: 'HMAC', hash: 'SHA-256' };

// ─────────────────────────────────────────────────────────────────────────────
// Integrity Status
// ─────────────────────────────────────────────────────────────────────────────

export const enum IntegrityStatus {
    VALID = 'VALID',
    /** Checksum field is missing or not a string */
    MISSING_CHECKSUM = 'MISSING_CHECKSUM',
    /** Data does not match checksum — could be corruption OR tampering */
    INVALID = 'INVALID',
    /** WebCrypto not available in this environment */
    CRYPTO_UNAVAILABLE = 'CRYPTO_UNAVAILABLE',
}

export interface IntegrityResult {
    status: IntegrityStatus;
    message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: Key Caching
// ─────────────────────────────────────────────────────────────────────────────

let _cachedKey: CryptoKey | null = null;

async function getHmacKey(): Promise<CryptoKey> {
    if (_cachedKey) return _cachedKey;

    if (!globalThis.crypto?.subtle) {
        throw new Error('[IntegrityCheck] SubtleCrypto is not available in this environment.');
    }

    const keyData = new TextEncoder().encode(HMAC_KEY_MATERIAL);
    _cachedKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        ALGORITHM,
        false,          // not extractable
        ['sign', 'verify']
    );

    return _cachedKey;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: Signing payload serialization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Produces the canonical string that is signed/verified.
 * Crucially EXCLUDES `meta.checksum` to avoid the chicken-and-egg problem.
 * Uses a deterministic JSON serialization by sorting keys.
 */
function buildSigningPayload(data: GameSave): string {
    // Deep-clone to avoid mutating the original object
    const payload = JSON.parse(JSON.stringify(data)) as GameSave;
    // Remove the checksum from the signed payload
    delete (payload.meta as Partial<GameSave['meta']>).checksum;
    return JSON.stringify(payload, Object.keys(payload).sort());
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates an HMAC-SHA-256 checksum for the given save data.
 *
 * The checksum covers the entire save EXCEPT `meta.checksum` itself.
 * The result is a lowercase hex string (64 chars).
 */
export async function generateChecksum(data: GameSave): Promise<string> {
    const key = await getHmacKey();
    const payload = buildSigningPayload(data);
    const msgBuffer = new TextEncoder().encode(payload);

    const signatureBuffer = await crypto.subtle.sign(ALGORITHM.name, key, msgBuffer);
    return bufferToHex(signatureBuffer);
}

/**
 * Verifies the integrity of a loaded save.
 *
 * Computes the expected HMAC and compares it to `data.meta.checksum` using
 * a constant-time comparison to prevent timing attacks.
 *
 * @returns An `IntegrityResult` with detailed status.
 */
export async function verifyIntegrity(data: GameSave): Promise<IntegrityResult> {
    if (!globalThis.crypto?.subtle) {
        return {
            status: IntegrityStatus.CRYPTO_UNAVAILABLE,
            message: 'Web Crypto API is not available. Integrity check skipped.',
        };
    }

    if (!data.meta.checksum || typeof data.meta.checksum !== 'string') {
        return {
            status: IntegrityStatus.MISSING_CHECKSUM,
            message: 'The save file does not contain a checksum. It may be from an older version or corrupted.',
        };
    }

    const key = await getHmacKey();
    const payload = buildSigningPayload(data);
    const msgBuffer = new TextEncoder().encode(payload);

    // Use SubtleCrypto's verify for constant-time comparison
    const expectedSigHex = data.meta.checksum;
    const expectedSigBuffer = hexToBuffer(expectedSigHex);

    let isValid: boolean;
    try {
        isValid = await crypto.subtle.verify(ALGORITHM.name, key, expectedSigBuffer, msgBuffer);
    } catch {
        isValid = false;
    }

    if (isValid) {
        return {
            status: IntegrityStatus.VALID,
            message: 'Save integrity verified successfully.',
        };
    }

    return {
        status: IntegrityStatus.INVALID,
        message:
            'Save checksum mismatch. The file may be corrupted or has been externally modified. ' +
            'A backup save may be available.',
    };
}

/**
 * Deep-sanitizes a raw loaded object before Zod parsing.
 *
 * Primary role: strip properties that could cause prototype pollution or
 * code injection if the save is ever transmitted/shared online.
 * Secondary role: Zod's own `strip` mode removes unknown keys on parse,
 * so this acts as a belt-and-suspenders pre-pass.
 */
export function sanitizeRawData(raw: unknown): unknown {
    if (typeof raw !== 'object' || raw === null) return raw;

    if (Array.isArray(raw)) {
        return raw.map(sanitizeRawData);
    }

    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        // Block prototype pollution vectors
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            console.warn(`[IntegrityCheck] Blocked dangerous key: "${key}"`);
            continue;
        }
        // Recursively sanitize strings to strip potential script tags
        if (typeof value === 'string') {
            sanitized[key] = value.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '').trim();
        } else {
            sanitized[key] = sanitizeRawData(value);
        }
    }
    return sanitized;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: Buffer ↔ Hex Conversion
// ─────────────────────────────────────────────────────────────────────────────

function bufferToHex(buffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(buffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

function hexToBuffer(hex: string): ArrayBuffer {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes.buffer;
}
