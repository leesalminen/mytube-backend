/// <reference types="vitest" />
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { buildServer } from '../src/server';
import { env as runtimeEnv } from '../src/config';
import { prisma } from '../src/prisma';
import { finalizeEvent, getPublicKey, nip19 } from 'nostr-tools';

let app: Awaited<ReturnType<typeof buildServer>>['app'];
let cleanupInterval: NodeJS.Timeout;

const secretKey = randomBytes(32).toString('hex');
const publicKey = getPublicKey(secretKey);
const expectedNpub = nip19.npubEncode(publicKey);

beforeAll(async () => {
  const built = await buildServer();
  app = built.app;
  cleanupInterval = built.cleanupInterval;
});

afterAll(async () => {
  clearInterval(cleanupInterval);
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.upload.deleteMany();
  await prisma.entitlement.deleteMany();
  await prisma.applePurchase.deleteMany();
  await prisma.googlePurchase.deleteMany();
  await prisma.usage.deleteMany();
  await prisma.user.deleteMany();
});

async function getAuthHeader(method: string, url: string, targetApp = app) {
  const challengeRes = await targetApp.inject({
    method: 'POST',
    url: '/auth/challenge'
  });

  expect(challengeRes.statusCode).toBe(200);
  const { challenge } = challengeRes.json() as { challenge: string };

  const content = new URLSearchParams({
    challenge,
    method,
    url
  }).toString();

  const now = Math.floor(Date.now() / 1000);
  const event = finalizeEvent(
    {
      kind: 27235,
      created_at: now,
      tags: [],
      content,
      pubkey: publicKey
    },
    secretKey
  );

  const token = Buffer.from(JSON.stringify(event), 'utf8').toString('base64');
  return `Nostr ${token}`;
}

describe('server routes', () => {
  it('returns health status', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('issues nip-98 challenges', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/challenge' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { challenge: string; expires_at: string };
    expect(body.challenge).toHaveLength(48);
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('requires auth for entitlement access', async () => {
    const res = await app.inject({ method: 'GET', url: '/entitlement' });
    expect(res.statusCode).toBe(401);
  });

  it('creates user on authenticated entitlement fetch', async () => {
    const authHeader = await getAuthHeader('GET', '/entitlement');
  const res = await app.inject({
      method: 'GET',
      url: '/entitlement',
      headers: {
        authorization: authHeader
      }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.status).toBe('none');
    expect(body.plan).toBeNull();

    const user = await prisma.user.findUnique({ where: { npub: expectedNpub } });
    expect(user).not.toBeNull();
  });

  it('rejects presign when entitlement missing', async () => {
    const authHeader = await getAuthHeader('POST', '/presign/upload');
    const res = await app.inject({
      method: 'POST',
      url: '/presign/upload',
      headers: {
        authorization: authHeader,
        'content-type': 'application/json'
      },
      payload: {
        filename: 'clip.mp4',
        content_type: 'video/mp4',
        size_bytes: 1024
      }
    });

    expect(res.statusCode).toBe(402);
  });

  it('presigns upload when entitlement active', async () => {
    await prisma.user.create({ data: { npub: expectedNpub } });
    await prisma.entitlement.create({
      data: {
        id: 'entitlement-1',
        npub: expectedNpub,
        platform: 'ios',
        productId: 'pro-monthly',
        status: 'active',
        expiresAt: new Date(Date.now() + 86_400_000),
        quotaBytes: BigInt(10_000_000_000)
      }
    });

    const authHeader = await getAuthHeader('POST', '/presign/upload');
    const res = await app.inject({
      method: 'POST',
      url: '/presign/upload',
      headers: {
        authorization: authHeader,
        'content-type': 'application/json'
      },
      payload: {
        filename: 'clip.mp4',
        content_type: 'video/mp4',
        size_bytes: 2048
      }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { key: string; url: string; headers: Record<string, string> };
    expect(body.key).toContain(`videos/${expectedNpub}`);
    expect(body.url).toContain('http://localhost:9000');

    const upload = await prisma.upload.findFirst({ where: { npub: expectedNpub } });
    expect(upload).not.toBeNull();
    expect(upload?.status).toBe('pending');

    const usage = await prisma.usage.findUnique({ where: { npub: expectedNpub } });
    expect(usage?.storedBytes.toString()).toBe('2048');
  });
});

describe('free trial mode', () => {
  let trialApp: typeof app;
  let trialCleanup: NodeJS.Timeout;
  let previousTrialMode: boolean;
  let previousTrialDays: number;
  let previousTrialModeEnv: string | undefined;
  let previousTrialDaysEnv: string | undefined;

  beforeAll(async () => {
    previousTrialMode = runtimeEnv.freeTrial.enabled;
    previousTrialDays = runtimeEnv.freeTrial.days;
    previousTrialModeEnv = process.env.FREE_TRIAL_MODE;
    previousTrialDaysEnv = process.env.FREE_TRIAL_DAYS;

    runtimeEnv.freeTrial.enabled = true;
    runtimeEnv.freeTrial.days = 30;
    process.env.FREE_TRIAL_MODE = 'true';
    process.env.FREE_TRIAL_DAYS = '30';

    const built = await buildServer();
    trialApp = built.app;
    trialCleanup = built.cleanupInterval;
  });

  afterAll(async () => {
    clearInterval(trialCleanup);
    await trialApp.close();

    runtimeEnv.freeTrial.enabled = previousTrialMode;
    runtimeEnv.freeTrial.days = previousTrialDays;

    if (previousTrialModeEnv === undefined) {
      delete process.env.FREE_TRIAL_MODE;
    } else {
      process.env.FREE_TRIAL_MODE = previousTrialModeEnv;
    }
    if (previousTrialDaysEnv === undefined) {
      delete process.env.FREE_TRIAL_DAYS;
    } else {
      process.env.FREE_TRIAL_DAYS = previousTrialDaysEnv;
    }
  });

  it('grants active trial entitlement when no purchases exist', async () => {
    const authHeader = await getAuthHeader('GET', '/entitlement', trialApp);
    const res = await trialApp.inject({
      method: 'GET',
      url: '/entitlement',
      headers: {
        authorization: authHeader
      }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, string>;
    expect(body.status).toBe('active');
    expect(body.plan).toBe('trial');

    const user = await prisma.user.findUnique({ where: { npub: expectedNpub } });
    expect(user).not.toBeNull();

    const ent = await prisma.entitlement.findUnique({
      where: { id: `${expectedNpub}-trial` }
    });
    expect(ent).not.toBeNull();
    expect(ent?.status).toBe('active');
  });
});
