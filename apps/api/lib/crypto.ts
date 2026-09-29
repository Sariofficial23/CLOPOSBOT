import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * AES-256-GCM encryption for secrets at rest (Clopos client secret and tokens).
 * Format: v1.<iv b64url>.<tag b64url>.<ciphertext b64url>
 */
export class Encryptor {
  private readonly key: Buffer;

  constructor(rawKey: string) {
    this.key = Encryptor.parseKey(rawKey);
  }

  /**
   * 64 hex chars or base64 of 32 bytes are used as-is. Any other random string
   * of at least 32 characters (e.g. Render's "Generate" button) is stretched
   * to a 256-bit key with SHA-256.
   */
  static parseKey(raw: string): Buffer {
    const trimmed = raw.trim();
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, 'hex');
    if (/^[A-Za-z0-9+/]{43}=?$/.test(trimmed)) {
      const b64 = Buffer.from(trimmed, 'base64');
      if (b64.length === 32) return b64;
    }
    if (trimmed.length >= 32) return createHash('sha256').update(trimmed, 'utf8').digest();
    throw new Error('ENCRYPTION_KEY must be at least 32 characters. Generate: openssl rand -hex 32');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.');
  }

  decrypt(payload: string): string {
    const [version, iv, tag, data] = payload.split('.');
    if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported ciphertext format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  }
}

/** Constant-time string comparison (length leak only). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}
