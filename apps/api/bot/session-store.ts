import type { Prisma, PrismaClient } from '@prisma/client';
import type { BotSession } from './context';

/** Telegraf SessionStore backed by Postgres (survives restarts, works with several instances). */
export function prismaSessionStore(prisma: PrismaClient) {
  return {
    async get(key: string): Promise<BotSession | undefined> {
      const row = await prisma.botSession.findUnique({ where: { key } });
      return (row?.data as BotSession | undefined) ?? undefined;
    },
    async set(key: string, value: BotSession): Promise<void> {
      const data = value as unknown as Prisma.InputJsonValue;
      await prisma.botSession.upsert({ where: { key }, create: { key, data }, update: { data } });
    },
    async delete(key: string): Promise<void> {
      await prisma.botSession.deleteMany({ where: { key } });
    },
  };
}

export function memorySessionStore() {
  const map = new Map<string, BotSession>();
  return {
    get: async (key: string) => map.get(key),
    set: async (key: string, value: BotSession) => void map.set(key, structuredClone(value)),
    delete: async (key: string) => void map.delete(key),
    map,
  };
}
