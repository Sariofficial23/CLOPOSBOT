import {
  canAssignRole,
  hasPermission,
  loginSchema,
  type Role,
  userCreateSchema,
  userUpdateSchema,
} from '@cpos/shared';
import type { PrismaClient, User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { AppError, Errors } from '../lib/errors';
import { isUniqueViolation } from '../lib/prisma';
import { type TelegramLoginPayload, verifyTelegramLogin } from '../lib/telegram-auth';
import { AuditAction, type AuditService } from './audit.service';
import type { Actor } from './types';

const BCRYPT_ROUNDS = 12;
// Used when the email is unknown so response time doesn't reveal account existence.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 4);

export const telegramLoginSchema = z.object({
  id: z.union([z.number().int().positive(), z.string().regex(/^\d{1,20}$/)]),
  first_name: z.string().max(255).optional(),
  last_name: z.string().max(255).optional(),
  username: z.string().max(64).optional(),
  photo_url: z.string().max(1024).optional(),
  auth_date: z.union([z.number().int(), z.string().regex(/^\d+$/)]),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
});

export function publicUser(u: User) {
  return {
    id: u.id,
    companyId: u.companyId,
    name: u.name,
    email: u.email,
    telegramId: u.telegramId,
    role: u.role as Role,
    active: u.active,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly telegramBotToken?: string,
  ) {}

  static hashPassword(password: string) {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  async login(raw: unknown, ip?: string) {
    const input = loginSchema.parse(raw);
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !user.passwordHash || !ok || !user.active) {
      await this.audit.log({
        companyId: user?.companyId ?? null,
        userId: user?.id ?? null,
        action: AuditAction.AUTH_LOGIN_FAILED,
        entity: 'User',
        entityId: user?.id ?? null,
        // log the attempted email for security review; never the password
        metadata: { email: input.email, reason: !user ? 'unknown_user' : !user.active ? 'inactive' : 'bad_password' },
        ip,
      });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Неверный email или пароль');
    }
    return this.completeLogin(user, AuditAction.AUTH_LOGIN, ip);
  }

  async loginWithTelegram(raw: unknown, ip?: string) {
    if (!this.telegramBotToken) throw new AppError(501, 'TELEGRAM_LOGIN_DISABLED', 'Telegram login is not configured');
    const payload = telegramLoginSchema.parse(raw) as TelegramLoginPayload;
    if (!verifyTelegramLogin(payload, this.telegramBotToken)) {
      await this.audit.log({ action: AuditAction.AUTH_LOGIN_FAILED, entity: 'User', metadata: { method: 'telegram', reason: 'bad_signature' }, ip });
      throw new AppError(401, 'INVALID_TELEGRAM_SIGNATURE', 'Не удалось подтвердить вход через Telegram');
    }
    const user = await this.prisma.user.findUnique({ where: { telegramId: String(payload.id) } });
    if (!user || !user.active) {
      await this.audit.log({ action: AuditAction.AUTH_LOGIN_FAILED, entity: 'User', metadata: { method: 'telegram', reason: 'unknown_user' }, ip });
      throw new AppError(403, 'TELEGRAM_USER_NOT_ALLOWED', 'Этот Telegram-аккаунт не привязан к пользователю');
    }
    return this.completeLogin(user, AuditAction.AUTH_TELEGRAM_LOGIN, ip);
  }

  private async completeLogin(user: User, action: typeof AuditAction.AUTH_LOGIN | typeof AuditAction.AUTH_TELEGRAM_LOGIN, ip?: string) {
    if (!hasPermission(user.role as Role, 'dashboard:view') && !hasPermission(user.role as Role, 'salary:view')) {
      // EMPLOYEE works through Telegram only
      throw new AppError(403, 'DASHBOARD_NOT_ALLOWED', 'Для вашей роли доступен только Telegram-бот');
    }
    const updated = await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ companyId: user.companyId, userId: user.id, action, entity: 'User', entityId: user.id, ip });
    return publicUser(updated);
  }

  /** Current, active user for a JWT subject (role changes apply immediately). */
  async resolveActor(userId: string, companyId: string): Promise<Actor | null> {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u || !u.active || u.companyId !== companyId) return null;
    return { id: u.id, companyId: u.companyId, role: u.role as Role, name: u.name, telegramId: u.telegramId };
  }

  async resolveTelegramActor(telegramId: string): Promise<Actor | null> {
    const u = await this.prisma.user.findUnique({ where: { telegramId } });
    if (!u || !u.active) return null;
    return { id: u.id, companyId: u.companyId, role: u.role as Role, name: u.name, telegramId: u.telegramId };
  }

  // ------------------------------------------------------------------- users
  async listUsers(companyId: string) {
    const users = await this.prisma.user.findMany({ where: { companyId }, orderBy: { createdAt: 'asc' } });
    return users.map(publicUser);
  }

  async createUser(actor: Actor, raw: unknown) {
    const input = userCreateSchema.parse(raw);
    if (!canAssignRole(actor.role, input.role)) throw Errors.forbidden('Нельзя назначить роль выше своей');
    try {
      const user = await this.prisma.user.create({
        data: {
          companyId: actor.companyId,
          name: input.name,
          role: input.role,
          email: input.email ?? null,
          telegramId: input.telegramId ?? null,
          passwordHash: input.password ? await AuthService.hashPassword(input.password) : null,
        },
      });
      await this.audit.log({
        companyId: actor.companyId,
        userId: actor.id,
        action: AuditAction.USER_CREATE,
        entity: 'User',
        entityId: user.id,
        metadata: { name: user.name, role: user.role, email: user.email, telegramId: user.telegramId },
        ip: actor.ip,
      });
      return publicUser(user);
    } catch (err) {
      if (isUniqueViolation(err)) throw Errors.conflict('USER_EXISTS', 'Пользователь с таким email или Telegram ID уже существует');
      throw err;
    }
  }

  async updateUser(actor: Actor, id: string, raw: unknown) {
    const input = userUpdateSchema.parse(raw);
    const target = await this.prisma.user.findFirst({ where: { id, companyId: actor.companyId } });
    if (!target) throw Errors.notFound('User');
    if (!canAssignRole(actor.role, target.role as Role)) throw Errors.forbidden('Нельзя изменять пользователя с более высокой ролью');
    if (input.role && !canAssignRole(actor.role, input.role)) throw Errors.forbidden('Нельзя назначить роль выше своей');
    if (target.id === actor.id && (input.active === false || (input.role && input.role !== actor.role))) {
      throw Errors.badRequest('Нельзя отключить себя или изменить собственную роль');
    }
    try {
      const user = await this.prisma.user.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          ...(input.telegramId !== undefined ? { telegramId: input.telegramId } : {}),
          ...(input.password ? { passwordHash: await AuthService.hashPassword(input.password) } : {}),
        },
      });
      await this.audit.log({
        companyId: actor.companyId,
        userId: actor.id,
        action: AuditAction.USER_UPDATE,
        entity: 'User',
        entityId: id,
        metadata: {
          fields: Object.keys(input).filter((k) => k !== 'password'),
          passwordChanged: !!input.password,
          role: input.role,
          active: input.active,
        },
        ip: actor.ip,
      });
      return publicUser(user);
    } catch (err) {
      if (isUniqueViolation(err)) throw Errors.conflict('USER_EXISTS', 'Этот Telegram ID уже привязан к другому пользователю');
      throw err;
    }
  }
}
