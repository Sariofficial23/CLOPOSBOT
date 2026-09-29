import { createHash, createHmac } from 'node:crypto';
import { safeEqual } from './crypto';

export interface TelegramLoginPayload {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number | string;
  hash: string;
}

/**
 * Verify data from the Telegram Login Widget.
 * https://core.telegram.org/widgets/login#checking-authorization
 */
export function verifyTelegramLogin(
  payload: TelegramLoginPayload,
  botToken: string,
  now: Date = new Date(),
  maxAgeSeconds = 86_400,
): boolean {
  const { hash, ...fields } = payload;
  if (!hash || typeof hash !== 'string') return false;
  const dataCheckString = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secret = createHash('sha256').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (!safeEqual(expected, hash)) return false;
  const authDate = Number(payload.auth_date);
  if (!Number.isFinite(authDate)) return false;
  const age = now.getTime() / 1000 - authDate;
  return age >= -60 && age <= maxAgeSeconds;
}
