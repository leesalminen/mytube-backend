import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.PORT = process.env.PORT ?? '0';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'file:./prisma/test.db';
process.env.S3_REGION = process.env.S3_REGION ?? 'us-east-1';
process.env.S3_ENDPOINT = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
process.env.S3_BUCKET = process.env.S3_BUCKET ?? 'test-bucket';
process.env.S3_PATH_STYLE = process.env.S3_PATH_STYLE ?? 'true';
process.env.S3_ACCESS_KEY = process.env.S3_ACCESS_KEY ?? 'test-access-key';
process.env.S3_SECRET_KEY = process.env.S3_SECRET_KEY ?? 'test-secret-key';
process.env.PRESIGN_TTL_SECONDS = process.env.PRESIGN_TTL_SECONDS ?? '600';
process.env.NIP98_CHALLENGE_TTL_SECONDS =
  process.env.NIP98_CHALLENGE_TTL_SECONDS ?? '300';
process.env.APPLE_ENVIRONMENT = process.env.APPLE_ENVIRONMENT ?? 'Sandbox';
process.env.FREE_TRIAL_MODE = process.env.FREE_TRIAL_MODE ?? 'false';
process.env.FREE_TRIAL_DAYS = process.env.FREE_TRIAL_DAYS ?? '30';

declare global {
  // eslint-disable-next-line no-var
  var __TEST_DB_PREPARED__: boolean | undefined;
}

if (!globalThis.__TEST_DB_PREPARED__) {
  const dbFile = path.resolve(__dirname, '../prisma/test.db');
  if (existsSync(dbFile)) {
    rmSync(dbFile);
  }

  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL
    }
  });

  globalThis.__TEST_DB_PREPARED__ = true;
}
