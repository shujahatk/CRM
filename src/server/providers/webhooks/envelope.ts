import "server-only";
import { createHash } from "node:crypto";

export const MAX_WEBHOOK_PAYLOAD_BYTES = 256 * 1024; // 256 KiB safety ceiling

export const SENSITIVE_KEY_PATTERNS = [
  /authorization/i,
  /bearer/i,
  /api[-_]?key/i,
  /secret/i,
  /token/i,
  /cookie/i,
  /password/i,
  /credential/i,
];

/**
 * Computes a deterministic SHA-256 hash of the exact raw or normalized payload string.
 */
export function computePayloadHash(payload: string | Buffer): string {
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Validates that the payload size does not exceed the allowed maximum.
 */
export function validatePayloadSize(payloadLength: number, maxBytes = MAX_WEBHOOK_PAYLOAD_BYTES): boolean {
  return payloadLength > 0 && payloadLength <= maxBytes;
}

/**
 * Recursively sanitizes a parsed JSON payload, stripping sensitive headers, tokens, and secret patterns.
 */
export function sanitizeWebhookPayload(data: unknown, depth = 0): unknown {
  if (depth > 10) return "[MAX_DEPTH_EXCEEDED]";
  if (data === null || data === undefined) return data;

  if (typeof data === "string" || typeof data === "number" || typeof data === "boolean") {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeWebhookPayload(item, depth + 1));
  }

  if (typeof data === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
      if (isSensitive) {
        sanitized[key] = "[REDACTED]";
      } else {
        sanitized[key] = sanitizeWebhookPayload(value, depth + 1);
      }
    }
    return sanitized;
  }

  return "[UNSUPPORTED_TYPE]";
}
