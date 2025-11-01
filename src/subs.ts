import {
  NotificationType,
  decodeNotificationPayload,
  decodeTransaction
} from 'app-store-server-api';
import { auth, androidpublisher_v3 } from '@googleapis/androidpublisher';
import { prisma } from './prisma';
import { env } from './config';

const googleAuth = createGoogleAuth();
const androidPublisher = new androidpublisher_v3.Androidpublisher({});

function createGoogleAuth() {
  if (!env.google.clientEmail || !env.google.privateKey) {
    return null;
  }

  return new auth.JWT({
    email: env.google.clientEmail,
    key: env.google.privateKey,
    scopes: ['https://www.googleapis.com/auth/androidpublisher']
  });
}

export async function getEntitlementForNpub(npub: string) {
  const now = new Date();

  const active = await prisma.entitlement.findFirst({
    where: {
      npub,
      status: { in: ['active', 'grace'] },
      expiresAt: {
        gt: now
      }
    },
    orderBy: { expiresAt: 'desc' }
  });

  if (active) {
    return active;
  }

  if (env.freeTrial.enabled) {
    const trial = await ensureFreeTrialEntitlement(npub, now);
    if (trial && trial.expiresAt > now && ['active', 'grace'].includes(trial.status)) {
      return trial;
    }
  }

  return prisma.entitlement.findFirst({
    where: { npub },
    orderBy: { expiresAt: 'desc' }
  });
}

export async function upsertAppleNotification(body: any) {
  const signedPayload = body?.signedPayload;
  if (!signedPayload) {
    throw new Error('Missing signedPayload from Apple notification.');
  }

  const notification = await decodeNotificationPayload(signedPayload);
  const transactionInfo = notification.data?.signedTransactionInfo
    ? await decodeTransaction(notification.data.signedTransactionInfo)
    : null;

  if (!transactionInfo) return;

  const originalTransactionId = transactionInfo.originalTransactionId;
  const productId = transactionInfo.productId;
  const expiresMs = Number(transactionInfo.expiresDate);
  const appAccountToken = transactionInfo.appAccountToken ?? undefined;

  const npub = await findNpubByOriginalTxIdOrAccountToken(originalTransactionId, appAccountToken);
  if (!npub) {
    await upsertApplePurchaseMapping(originalTransactionId, appAccountToken);
    return;
  }

  await ensureUserExists(npub);

  await prisma.entitlement.upsert({
    where: { npub_productId: { npub, productId } },
    update: {
      platform: 'ios',
      productId,
      originalTxId: originalTransactionId,
      status: mapAppleStatus(notification.notificationType),
      expiresAt: new Date(expiresMs),
      quotaBytes: BigInt(planToQuota(productId))
    },
    create: {
      npub,
      platform: 'ios',
      productId,
      originalTxId: originalTransactionId,
      status: mapAppleStatus(notification.notificationType),
      expiresAt: new Date(expiresMs),
      quotaBytes: BigInt(planToQuota(productId)),
      purchaseToken: null
    }
  });

  await upsertApplePurchaseMapping(originalTransactionId, appAccountToken, npub);
}

export async function upsertGoogleNotification(body: any) {
  const { packageName, subscriptionId, purchaseToken } = body ?? {};
  if (!packageName || !subscriptionId || !purchaseToken) {
    throw new Error('Missing Google subscription notification payload values.');
  }

  const authClient = await getAuthorizedGoogleClient();

  const { data } = await androidPublisher.purchases.subscriptions.get({
    packageName,
    subscriptionId,
    token: purchaseToken,
    auth: authClient
  });

  const npub = await findNpubByPurchaseToken(purchaseToken);
  if (!npub) {
    await upsertGooglePurchaseMapping(purchaseToken, packageName, subscriptionId);
    return;
  }

  await ensureUserExists(npub);

  await prisma.entitlement.upsert({
    where: { npub_productId: { npub, productId: subscriptionId } },
    update: {
      platform: 'android',
      productId: subscriptionId,
      purchaseToken,
      status: mapGoogleStatus(data),
      expiresAt: new Date(Number(data.expiryTimeMillis)),
      quotaBytes: BigInt(planToQuota(subscriptionId))
    },
    create: {
      npub,
      platform: 'android',
      productId: subscriptionId,
      purchaseToken,
      status: mapGoogleStatus(data),
      expiresAt: new Date(Number(data.expiryTimeMillis)),
      quotaBytes: BigInt(planToQuota(subscriptionId)),
      originalTxId: null
    }
  });

  await upsertGooglePurchaseMapping(purchaseToken, packageName, subscriptionId, npub);
}

function mapAppleStatus(type?: NotificationType) {
  switch (type) {
    case NotificationType.DidRenew:
    case NotificationType.Subscribed:
      return 'active';
    case NotificationType.Expired:
      return 'expired';
    case NotificationType.GracePeriodExpired:
      return 'paused';
    case NotificationType.DidFailToRenew:
    case NotificationType.Refund:
    case NotificationType.RefundDeclined:
    case NotificationType.RefundReversed:
    case NotificationType.PriceIncrease:
    case NotificationType.RenewalExtension:
    case NotificationType.RenewalExtended:
    case NotificationType.DidChangeRenewalStatus:
    case NotificationType.DidChangeRenewalPref:
      return 'canceled';
    default:
      return 'active';
  }
}

function mapGoogleStatus(data: any) {
  if (data?.cancelReason != null) return 'canceled';
  if (data?.paymentState === 0) return 'pending';
  if (data?.paymentState === 1 || data?.paymentState === 2) return 'active';
  if (data?.expiryTimeMillis && Number(data.expiryTimeMillis) < Date.now()) return 'expired';
  return 'active';
}

function planToQuota(productId: string): number {
  if (productId.toLowerCase().includes('pro')) {
    return 200 * 1024 * 1024 * 1024;
  }
  if (productId.toLowerCase().includes('ultra')) {
    return 500 * 1024 * 1024 * 1024;
  }
  return 50 * 1024 * 1024 * 1024;
}

async function ensureUserExists(npub: string) {
  await prisma.user.upsert({
    where: { npub },
    update: {},
    create: { npub }
  });
}

async function getAuthorizedGoogleClient() {
  if (!googleAuth) {
    throw new Error('Google Play credentials are not configured.');
  }
  await googleAuth.authorize();
  return googleAuth;
}

async function findNpubByOriginalTxIdOrAccountToken(originalTxId: string, appAccountToken?: string | null) {
  const existingByTx = await prisma.applePurchase.findUnique({
    where: { originalTxId }
  });
  if (existingByTx) return existingByTx.npub;

  if (appAccountToken) {
    const existingByToken = await prisma.applePurchase.findFirst({
      where: { appAccountToken }
    });
    if (existingByToken) return existingByToken.npub;
  }

  return null;
}

async function findNpubByPurchaseToken(purchaseToken: string) {
  const record = await prisma.googlePurchase.findUnique({
    where: { purchaseToken }
  });
  return record?.npub ?? null;
}

async function upsertApplePurchaseMapping(originalTxId: string, appAccountToken?: string | null, npub?: string) {
  if (!npub) return;

  await prisma.applePurchase.upsert({
    where: { originalTxId },
    update: {
      appAccountToken: appAccountToken ?? null,
      npub
    },
    create: {
      originalTxId,
      appAccountToken: appAccountToken ?? null,
      npub
    }
  });
}

async function upsertGooglePurchaseMapping(
  purchaseToken: string,
  packageName: string,
  subscriptionId: string,
  npub?: string
) {
  if (!npub) return;

  await prisma.googlePurchase.upsert({
    where: { purchaseToken },
    update: {
      npub,
      packageName,
      subscriptionId
    },
    create: {
      purchaseToken,
      npub,
      packageName,
      subscriptionId
    }
  });
}

async function ensureFreeTrialEntitlement(npub: string, now: Date) {
  const trialId = `${npub}-trial`;
  const existing = await prisma.entitlement.findUnique({
    where: { id: trialId }
  });

  const durationMs = env.freeTrial.days * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(now.getTime() + durationMs);

  if (!existing) {
    return prisma.entitlement.create({
      data: {
        id: trialId,
        npub,
        platform: 'trial',
        productId: 'trial',
        status: 'active',
        expiresAt,
        quotaBytes: BigInt(planToQuota('trial')),
        originalTxId: null,
        purchaseToken: null
      }
    });
  }

  if (existing.expiresAt <= now && existing.status !== 'expired') {
    return prisma.entitlement.update({
      where: { id: trialId },
      data: { status: 'expired' }
    });
  }

  if (existing.expiresAt > now && existing.status !== 'active') {
    return prisma.entitlement.update({
      where: { id: trialId },
      data: { status: 'active' }
    });
  }

  return existing;
}
