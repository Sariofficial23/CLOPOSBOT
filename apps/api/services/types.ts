import type { Role } from '@cpos/shared';

/** The authenticated actor (web JWT or verified Telegram user). */
export interface Actor {
  id: string;
  companyId: string;
  role: Role;
  name: string;
  telegramId?: string | null;
  ip?: string;
}
