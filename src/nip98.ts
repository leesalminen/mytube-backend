import type { FastifyRequest } from 'fastify';
import { verifyEvent, nip19 } from 'nostr-tools';
import { createHash } from 'crypto';

type ChallengeStore = Map<string, { exp: number }>;

export interface VerifyContext {
  req: FastifyRequest;
  challenges: ChallengeStore;
}

export interface Nip98Result {
  npub: string;
}

const AUTH_PREFIX = 'Nostr ';

export async function verifyNip98({ req, challenges }: VerifyContext): Promise<Nip98Result | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith(AUTH_PREFIX)) return null;

  const payloadB64 = authHeader.slice(AUTH_PREFIX.length).trim();
  let event: any;
  try {
    const json = Buffer.from(payloadB64, 'base64').toString('utf8');
    event = JSON.parse(json);
  } catch {
    return null;
  }

  const content = typeof event.content === 'string' ? event.content : '';
  const params = Object.fromEntries(new URLSearchParams(content));
  const challenge = params['challenge'];
  if (!challenge) return null;

  const challengeEntry = challenges.get(challenge);
  if (!challengeEntry) return null;
  if (challengeEntry.exp < Math.floor(Date.now() / 1000)) {
    challenges.delete(challenge);
    return null;
  }

  if ((params['method'] || '').toUpperCase() !== req.method) return null;

  const expectedPath = req.routeOptions?.url ?? extractPath(req.url ?? '');
  if (params['url'] && params['url'] !== expectedPath) return null;

  const bodyHash = params['body'];
  if (bodyHash) {
    const rawBody = await getRequestBody(req);
    if (!rawBody) return null;
    const computed = createHash('sha256').update(rawBody).digest('hex');
    if (computed !== bodyHash) return null;
  }

  if (!verifyEvent(event)) return null;

  challenges.delete(challenge);

  const hexPubKey = event.pubkey as string;
  const npub = nip19.npubEncode(hexPubKey);

  return { npub };
}

function extractPath(url: string): string {
  const idx = url.indexOf('?');
  return idx === -1 ? url : url.slice(0, idx);
}

async function getRequestBody(req: FastifyRequest): Promise<Buffer | null> {
  const body = req.body;
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body);
  try {
    return Buffer.from(JSON.stringify(body));
  } catch {
    return null;
  }
}
