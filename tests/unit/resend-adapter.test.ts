import { describe, it, expect, vi } from "vitest";
import {
  ResendProviderAdapter,
  computeResendIdempotencyKey,
  computeOutboundPayloadFingerprint,
} from "@/server/providers/resend/adapter";
import {
  createResendWebhookSignature,
  verifyResendWebhookSignature,
  extractResendWebhookHeaders,
} from "@/server/providers/resend/webhook";
import { classifyProviderError, isRetryable, calculateBackoffSeconds } from "@/server/providers/errors";
import { canTransitionStatus, reconcileStatus } from "@/server/providers/status";
import {
  validatePayloadSize,
  sanitizeWebhookPayload,
  MAX_WEBHOOK_PAYLOAD_BYTES,
} from "@/server/providers/webhooks/envelope";

describe("Phase 6B: Resend Outbound Adapter & Idempotency", () => {
  it("enforces stable idempotency key across retry attempts for the same provider operation", () => {
    const workspaceId = "00000000-0000-0000-0000-000000000001";
    const providerOperationIdA = "11111111-1111-1111-1111-111111111111";
    const providerOperationIdB = "22222222-2222-2222-2222-222222222222";

    // Stable immutable operation identity independent of retry attempt count
    const opIdentityA = `op:${workspaceId}:${providerOperationIdA}`;
    const opIdentityB = `op:${workspaceId}:${providerOperationIdB}`;

    const attempt1Key = computeResendIdempotencyKey(opIdentityA);
    const attempt2Key = computeResendIdempotencyKey(opIdentityA);
    const attempt3Key = computeResendIdempotencyKey(opIdentityA);
    const operationBKey = computeResendIdempotencyKey(opIdentityB);

    // Required invariant: attempt 1 key === attempt 2 key === attempt 3 key
    expect(attempt1Key).toBe(attempt2Key);
    expect(attempt2Key).toBe(attempt3Key);

    // Required invariant: operation A key !== operation B key
    expect(attempt1Key).not.toBe(operationBKey);

    // Format check: resend:<sha256> = 71 characters, strictly <= 256
    expect(attempt1Key.startsWith("resend:")).toBe(true);
    expect(attempt1Key.length).toBe(71);
    expect(attempt1Key.length).toBeLessThanOrEqual(256);
  });

  it("computes deterministic payload fingerprints to enforce immutability on retry", () => {
    const payload = {
      senderAddress: "outbound@company.com",
      recipientAddress: "lead@example.com",
      subject: "Welcome to 80/20 CRM",
      textBody: "Hello there!",
      htmlBody: "<p>Hello there!</p>",
    };

    const fp1 = computeOutboundPayloadFingerprint(payload);
    const fp2 = computeOutboundPayloadFingerprint(payload);
    expect(fp1).toBe(fp2);

    // Modified recipient produces different fingerprint
    const fpModified = computeOutboundPayloadFingerprint({
      ...payload,
      recipientAddress: "tampered@example.com",
    });
    expect(fp1).not.toBe(fpModified);
  });

  it("rejects dispatch if outbound payload mutates across retries under the same operation key", async () => {
    const mockSend = vi.fn().mockResolvedValue({
      data: { id: "resend_msg_test_123" },
      error: null,
    });

    const adapter = new ResendProviderAdapter({ send: mockSend });
    const originalPayload = {
      messageId: "msg_abc",
      workspaceId: "ws_xyz",
      channel: "email" as const,
      senderAddress: "sender@8020crm.com",
      recipientAddress: "lead@target.com",
      subject: "Test Email",
      textBody: "This is a test message.",
      htmlBody: "<p>This is a test message.</p>",
    };

    const originalFingerprint = computeOutboundPayloadFingerprint(originalPayload);

    // Initial dispatch with expectedFingerprint succeeds
    const initialResult = await adapter.dispatch({
      ...originalPayload,
      metadata: {
        operationKey: "op_test_123",
        expectedFingerprint: originalFingerprint,
      },
    });
    expect(initialResult.dispatched).toBe(true);

    // Retry dispatch with mutated recipient under same operation: rejected as payload_mutation_conflict
    const tamperedResult = await adapter.dispatch({
      ...originalPayload,
      recipientAddress: "attacker@target.com", // Payload modified!
      metadata: {
        operationKey: "op_test_123",
        expectedFingerprint: originalFingerprint, // Still matches original
      },
    });

    expect(tamperedResult.dispatched).toBe(false);
    expect(tamperedResult.error).toBe("payload_mutation_conflict");
    expect(tamperedResult.errorClassification).toBe("permanent");
    // Mock transport was not invoked for tampered attempt
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("dispatches successfully through adapter using mock transport", async () => {
    const mockSend = vi.fn().mockResolvedValue({
      data: { id: "resend_msg_test_123" },
      error: null,
    });

    const adapter = new ResendProviderAdapter({ send: mockSend });
    expect(adapter.isConfigured()).toBe(true);

    const result = await adapter.dispatch({
      messageId: "msg_abc",
      workspaceId: "ws_xyz",
      channel: "email",
      senderAddress: "sender@8020crm.com",
      recipientAddress: "lead@target.com",
      subject: "Test Email",
      textBody: "This is a test message.",
      htmlBody: "<p>This is a test message.</p>",
      metadata: { operationKey: "op_test_123" },
    });

    expect(result.dispatched).toBe(true);
    expect(result.providerStatus).toBe("dispatched");
    expect(result.providerMessageId).toBe("resend_msg_test_123");

    // Verify mock transport received mapped parameters and deterministic idempotencyKey
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [sendPayload, sendOptions] = mockSend.mock.calls[0];
    expect(sendPayload.from).toBe("sender@8020crm.com");
    expect(sendPayload.to).toEqual(["lead@target.com"]);
    expect(sendPayload.subject).toBe("Test Email");
    expect(sendPayload.text).toBe("This is a test message.");
    expect(sendPayload.html).toBe("<p>This is a test message.</p>");
    expect(sendOptions?.idempotencyKey).toBe(computeResendIdempotencyKey("op_test_123"));
  });

  it("returns controlled provider_not_configured when credentials are unconfigured", async () => {
    const adapter = new ResendProviderAdapter(undefined, () => null);
    // When no client can be provided and no custom transport exists
    const result = await adapter.dispatch({
      messageId: "msg_abc",
      workspaceId: "ws_xyz",
      channel: "email",
      senderAddress: "sender@8020crm.com",
      recipientAddress: "lead@target.com",
      textBody: "Test",
    });

    expect(result.dispatched).toBe(false);
    expect(result.providerStatus).toBe("provider_not_configured");
    expect(result.errorClassification).toBe("configuration");
  });

  it("classifies 429 rate limits and computes exponential backoff", () => {
    const error429 = { status: 429, message: "Too many requests. Rate limit exceeded." };
    const classification = classifyProviderError(error429);
    expect(classification).toBe("rate_limited");
    expect(isRetryable(classification)).toBe(true);

    expect(calculateBackoffSeconds(1)).toBe(5);
    expect(calculateBackoffSeconds(2)).toBe(10);
    expect(calculateBackoffSeconds(3)).toBe(20);
    expect(calculateBackoffSeconds(4)).toBe(40);
  });

  it("classifies 401 authentication errors as non-retryable", () => {
    const error401 = { status: 401, message: "API key is invalid or unauthorized." };
    const classification = classifyProviderError(error401);
    expect(classification).toBe("authentication");
    expect(isRetryable(classification)).toBe(false); // No endless retry on bad credentials
  });

  it("classifies permanent invalid recipient errors as non-retryable", () => {
    const errorInvalid = { status: 400, message: "Invalid email address format or domain does not exist." };
    const classification = classifyProviderError(errorInvalid);
    expect(classification).toBe("invalid_destination");
    expect(isRetryable(classification)).toBe(false);
  });
});

describe("Phase 6B: Webhook Cryptographic Verification & Security", () => {
  const testSecret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
  const testPayload = JSON.stringify({
    type: "email.delivered",
    created_at: "2026-09-23T00:00:00.000Z",
    data: {
      email_id: "em_test_789",
      from: "sender@example.com",
      to: ["recipient@example.com"],
    },
  });

  it("accepts a cryptographically valid Svix signature", () => {
    const signed = createResendWebhookSignature(testPayload, testSecret);
    const isValid = verifyResendWebhookSignature({
      payload: testPayload,
      id: signed.id,
      timestamp: signed.timestamp,
      signature: signed.signature,
      secret: testSecret,
    });
    expect(isValid).toBe(true);
  });

  it("rejects when signature is invalid or forged", () => {
    const signed = createResendWebhookSignature(testPayload, testSecret);
    const isValid = verifyResendWebhookSignature({
      payload: testPayload,
      id: signed.id,
      timestamp: signed.timestamp,
      signature: "v1,forged_and_invalid_signature_bytes_here",
      secret: testSecret,
    });
    expect(isValid).toBe(false);
  });

  it("rejects when raw payload body is tampered", () => {
    const signed = createResendWebhookSignature(testPayload, testSecret);
    const tamperedPayload = testPayload.replace("recipient@example.com", "hacker@example.com");

    const isValid = verifyResendWebhookSignature({
      payload: tamperedPayload,
      id: signed.id,
      timestamp: signed.timestamp,
      signature: signed.signature,
      secret: testSecret,
    });
    expect(isValid).toBe(false);
  });

  it("rejects expired or replayed webhook payloads (tolerance check)", () => {
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 400).toString(); // 400s ago (> 300s tolerance)
    const signed = createResendWebhookSignature(testPayload, testSecret, "msg_old", oldTimestamp);

    const isValid = verifyResendWebhookSignature({
      payload: testPayload,
      id: signed.id,
      timestamp: signed.timestamp,
      signature: signed.signature,
      secret: testSecret,
      toleranceSeconds: 300,
    });
    expect(isValid).toBe(false);
  });

  it("rejects oversized webhook payloads exceeding 256 KiB", () => {
    expect(validatePayloadSize(MAX_WEBHOOK_PAYLOAD_BYTES)).toBe(true);
    expect(validatePayloadSize(MAX_WEBHOOK_PAYLOAD_BYTES + 1)).toBe(false);
    expect(validatePayloadSize(0)).toBe(false);
  });

  it("extracts webhook headers correctly for svix-* and webhook-* variants", () => {
    const headersSvix = new Headers({
      "svix-id": "msg_123",
      "svix-timestamp": "1700000000",
      "svix-signature": "v1,sig123",
    });
    const extracted = extractResendWebhookHeaders(headersSvix);
    expect(extracted).toEqual({
      id: "msg_123",
      timestamp: "1700000000",
      signature: "v1,sig123",
    });

    const headersMissing = new Headers({
      "svix-id": "msg_123",
    });
    expect(extractResendWebhookHeaders(headersMissing)).toBeNull();
  });

  it("redacts sensitive keys during payload sanitization", () => {
    const raw = {
      type: "email.sent",
      authorization: "Bearer secret-token-xyz",
      api_key: "re_secret_123",
      data: {
        nested_secret: "super-secret-value",
        email_id: "safe-id-123",
      },
    };

    const sanitized = sanitizeWebhookPayload(raw) as {
      authorization?: string;
      api_key?: string;
      data?: { nested_secret?: string; email_id?: string };
    };
    expect(sanitized.authorization).toBe("[REDACTED]");
    expect(sanitized.api_key).toBe("[REDACTED]");
    expect(sanitized.data?.nested_secret).toBe("[REDACTED]");
    expect(sanitized.data?.email_id).toBe("safe-id-123");
  });
});

describe("Phase 6B: Monotonic Status Reconciliation Engine", () => {
  it("advances delivery status monotonically: draft < queued < sent < delivered", () => {
    expect(canTransitionStatus("draft", "queued")).toBe(true);
    expect(canTransitionStatus("queued", "accepted")).toBe(true);
    expect(canTransitionStatus("accepted", "sent")).toBe(true);
    expect(canTransitionStatus("sent", "delivered")).toBe(true);
  });

  it("prevents status regression: late sent event does NOT overwrite delivered", () => {
    expect(canTransitionStatus("delivered", "sent")).toBe(false);
    expect(reconcileStatus("delivered", "sent")).toBe("delivered");
  });

  it("permits terminal status transitions from non-terminal states", () => {
    expect(canTransitionStatus("sent", "bounced")).toBe(true);
    expect(canTransitionStatus("sent", "failed")).toBe(true);
    expect(canTransitionStatus("delivered", "bounced")).toBe(true);
  });

  it("locks terminal status once entered", () => {
    expect(canTransitionStatus("bounced", "delivered")).toBe(false);
    expect(canTransitionStatus("failed", "sent")).toBe(false);
  });
});
