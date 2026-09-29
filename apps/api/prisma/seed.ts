import { PrismaClient } from '@prisma/client';
import { seed } from './seed-data';

async function main() {
  const production = process.env.NODE_ENV === 'production';
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? (production ? undefined : 'admin@example.com');
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? (production ? undefined : 'ChangeMe123!');
  if (!adminEmail || !adminPassword) {
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD to seed a production database');
  }
  if (adminPassword.length < 8) throw new Error('SEED_ADMIN_PASSWORD must be at least 8 characters');
  const prisma = new PrismaClient();
  try {
    const res = await seed(prisma, {
      adminEmail,
      adminPassword,
      adminTelegramId: process.env.SEED_ADMIN_TELEGRAM_ID || null,
      companyName: process.env.SEED_COMPANY_NAME,
      timezone: process.env.TIMEZONE,
      demoUsers: !production,
    });
    console.log(`Seeded company "${res.company.name}" (${res.company.id}); admin: ${adminEmail}`);
    if (!production) console.log('Demo users (password DemoPassword123!): admin/manager/accountant/employee .demo@example.com');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
