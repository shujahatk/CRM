import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Resend } from "resend";
import { getResendWebhookSecret } from "./client";

export interface ResendWebhookHeaders {
  id: string;
  timestamp: string;
  signature: string;
}

/**
 * Extracts Svix / standard webhook signature headers from request headers.
 */
export function extractResendWebhookHeaders(headers: Headers): ResendWebhookHeaders | null {
  const id = headers.get("svix-id") ?? headers.get("webhook-id");
  const timestamp = headers.get("svix-timestamp") ?? headers.get("webhook-timestamp");
  const signature = headers.get("svix-signature") ?? headers.get("webhook-signature");

  if (!id || !timestamp || !signature) {
    return null;
  }

  return { id, timestamp, signature };
}

/**
 * Cryptographically verifies Resend / Svix webhook signature.
 * Uses timing-safe comparison to prevent side-channel timing attacks.
 * Allows a default 5-minute (300 seconds) tolerance for replay attacks.
 */
export function verifyResendWebhookSignature(input: {
  payload: string;
  id: string;
  timestamp: string;
  signature: string;
  secret: string;
  toleranceSeconds?: number;
}): boolean {
  if (!input.secret || !input.payload || !input.id || !input.timestamp || !input.signature) {
    return false;
  }

  try {
    // 1. Verify timestamp drift (anti-replay)
    const ts = parseInt(input.timestamp, 10);
    if (isNaN(ts)) return false;

    const tolerance = input.toleranceSeconds ?? 300;
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - ts) > tolerance) {
      return false;
    }

    // 2. Compute expected HMAC-SHA256 signature
    const rawKey = input.secret.startsWith("whsec_") ? input.secret.slice(6) : input.secret;
    const keyBytes = Buffer.from(rawKey, "base64");
    const signedContent = `${input.id}.${input.timestamp}.${input.payload}`;
    const expectedSig = createHmac("sha256", keyBytes).update(signedContent).digest("base64");
    const expectedBuf = Buffer.from(expectedSig);

    // 3. Compare signatures with timingSafeEqual
    const signatureParts = input.signature.split(" ");
    for (const part of signatureParts) {
      const [version, sig] = part.split(",");
      if (version === "v1" && sig) {
        const sigBuf = Buffer.from(sig);
        if (sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf)) {
          return true;
        }
      }
    }

    // 4. Also fallback to official SDK verifier if available
    try {
      const r = new Resend("re_verify_dummy");
      const sdkResult = r.webhooks.verify({
        payload: input.payload,
        headers: {
          id: input.id,
          timestamp: input.timestamp,
          signature: input.signature,
        },
        webhookSecret: input.secret,
      });
      return Boolean(sdkResult);
    } catch {
      // Ignore SDK error if manual check already resolved
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Creates a valid cryptographic Svix signature for test mocks and fixtures.
 */
export function createResendWebhookSignature(
  payload: string,
  secret: string,
  customId?: string,
  customTimestamp?: string
): {
  id: string;
  timestamp: string;
  signature: string;
  headers: Record<string, string>;
} {
  const id = customId ?? `msg_${randomUUID()}`;
  const timestamp = customTimestamp ?? Math.floor(Date.now() / 1000).toString();
  const rawKey = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const keyBytes = Buffer.from(rawKey, "base64");
  const signedContent = `${id}.${timestamp}.${payload}`;
  const sig = createHmac("sha256", keyBytes).update(signedContent).digest("base64");
  const formattedSig = `v1,${sig}`;

  return {
    id,
    timestamp,
    signature: formattedSig,
    headers: {
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": formattedSig,
    },
  };
}

/**
 * Resolves configured webhook secret.
 */
export function resolveWebhookSecret(): string | null {
  return getResendWebhookSecret();
}
