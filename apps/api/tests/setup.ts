// Test environment — never real secrets.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-long-enough-1234567890';
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
process.env.CLOPOS_ADAPTER ??= 'mock';
process.env.FRONTEND_URL ??= 'http://localhost:3000';
process.env.LOG_LEVEL = 'silent';
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL ??= 'postgresql://invalid:invalid@localhost:1/none';
