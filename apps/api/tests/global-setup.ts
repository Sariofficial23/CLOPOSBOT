import { execSync } from 'node:child_process';

/** Apply migrations to the test database once per run (only when TEST_DATABASE_URL is set). */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn('\n[tests] TEST_DATABASE_URL not set — database-backed suites are skipped.\n');
    return;
  }
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
}
