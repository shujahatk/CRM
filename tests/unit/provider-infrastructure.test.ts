import { describe, it, expect } from "vitest";
import { getProviderAdapter, DisconnectedProviderAdapter } from "@/server/providers/registry";
import { classifyProviderError, isRetryable, calculateBackoffSeconds } from "@/server/providers/errors";
import { canTransitionStatus, reconcileStatus } from "@/server/providers/status";
import {
  computePayloadHash,
  sanitizeWebhookPayload,
  validatePayloadSize,
  MAX_WEBHOOK_PAYLOAD_BYTES,
} from "@/server/providers/webhooks/envelope";

describe("Provider Adapter Contract", () => {
  it("disconnected adapters return provider_not_configured and do not pretend success", async () => {
    const resend = getProviderAdapter("resend");
    expect(resend.isConfigured()).toBe(false);
    expect(resend.provider).toBe("resend");

    const health = await resend.healthCheck?.();
    expect(health?.status).toBe("not_configured");

    const result = await resend.dispatch({
      messageId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      channel: "email",
      senderAddress: "inbox@example.test",
      recipientAddress: "lead@example.test",
      textBody: "Hello world",
    });

    expect(result.dispatched).toBe(false);
    expect(result.providerStatus).toBe("provider_not_configured");
    expect(result.errorClassification).toBe("configuration");
    expect(result.error).toContain("disconnected in Phase 6A.1");
  });

  it("all 7 providers are initialized as disconnected adapters", () => {
    const providers = ["resend", "twilio", "whatsapp", "calendly", "meta", "vsl", "outbound"] as const;
    for (const p of providers) {
      const adapter = getProviderAdapter(p);
      expect(adapter).toBeInstanceOf(DisconnectedProviderAdapter);
      expect(adapter.isConfigured()).toBe(false);
    }
  });
});

describe("Error Classification & Retry Policy", () => {
  it("correctly classifies rate limits as retryable", () => {
    const err = { status: 429, message: "Too many requests" };
    const classification = classifyProviderError(err);
    expect(classification).toBe("rate_limited");
    expect(isRetryable(classification)).toBe(true);
  });

  it("correctly classifies 5xx and timeout errors as transient retryable", () => {
    const serverErr = { status: 503, message: "Service Unavailable" };
    expect(classifyProviderError(serverErr)).toBe("transient");
    expect(isRetryable("transient")).toBe(true);

    const timeoutErr = new Error("Connection timeout ETIMEDOUT");
    expect(classifyProviderError(timeoutErr)).toBe("transient");
  });

  it("classifies authentication errors as terminal non-retryable", () => {
    const authErr = { status: 401, message: "Invalid API Key provided" };
    const classification = classifyProviderError(authErr);
    expect(classification).toBe("authentication");
    expect(isRetryable(classification)).toBe(false);
  });

  it("classifies suppressed and DNC errors as terminal non-retryable", () => {
    const dncErr = new Error("Recipient address is suppressed or opted out");
    const classification = classifyProviderError(dncErr);
    expect(classification).toBe("suppressed");
    expect(isRetryable(classification)).toBe(false);
  });

  it("classifies invalid destination as terminal non-retryable", () => {
    const destErr = new Error("Invalid email domain or unroutable address");
    const classification = classifyProviderError(destErr);
    expect(classification).toBe("invalid_destination");
    expect(isRetryable(classification)).toBe(false);
  });

  it("computes bounded exponential backoff with ceiling", () => {
    expect(calculateBackoffSeconds(1, 5)).toBe(5);
    expect(calculateBackoffSeconds(2, 5)).toBe(10);
    expect(calculateBackoffSeconds(3, 5)).toBe(20);
    expect(calculateBackoffSeconds(4, 5)).toBe(40);
    expect(calculateBackoffSeconds(15, 5, 300)).toBe(300); // capped at maxSeconds
  });
});

describe("Status Monotonic Progression", () => {
  it("allows progression from queued to accepted, sent, delivered, read", () => {
    expect(canTransitionStatus("queued", "accepted")).toBe(true);
    expect(canTransitionStatus("accepted", "sent")).toBe(true);
    expect(canTransitionStatus("sent", "delivered")).toBe(true);
    expect(canTransitionStatus("delivered", "read")).toBe(true);
  });

  it("strictly prevents status regression from delivered to sent", () => {
    expect(canTransitionStatus("delivered", "sent")).toBe(false);
    expect(reconcileStatus("delivered", "sent")).toBe("delivered");
  });

  it("strictly prevents status regression from read to delivered or sent", () => {
    expect(canTransitionStatus("read", "delivered")).toBe(false);
    expect(canTransitionStatus("read", "sent")).toBe(false);
    expect(reconcileStatus("read", "sent")).toBe("read");
  });

  it("allows terminal transition from any non-terminal state", () => {
    expect(canTransitionStatus("queued", "failed")).toBe(true);
    expect(canTransitionStatus("sent", "bounced")).toBe(true);
    expect(canTransitionStatus("delivered", "complained")).toBe(true);
  });

  it("disallows progression once a message has entered a terminal state", () => {
    expect(canTransitionStatus("failed", "sent")).toBe(false);
    expect(canTransitionStatus("bounced", "delivered")).toBe(false);
    expect(canTransitionStatus("complained", "read")).toBe(false);
  });
});

describe("Webhook Envelope, Hashing & Redaction", () => {
  it("computes deterministic SHA-256 payload hash", () => {
    const payload = JSON.stringify({ event: "message.sent", id: "evt_123" });
    const hash1 = computePayloadHash(payload);
    const hash2 = computePayloadHash(payload);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("validates payload size against safety limit", () => {
    expect(validatePayloadSize(100)).toBe(true);
    expect(validatePayloadSize(MAX_WEBHOOK_PAYLOAD_BYTES)).toBe(true);
    expect(validatePayloadSize(MAX_WEBHOOK_PAYLOAD_BYTES + 1)).toBe(false);
    expect(validatePayloadSize(0)).toBe(false);
  });

  it("sanitizes sensitive authorization headers, tokens, and api keys from payloads", () => {
    const raw = {
      event_id: "evt_abc123",
      headers: {
        authorization: "Bearer secret_jwt_token",
        "x-api-key": "secret_api_key_value",
        "user-agent": "Webhook-Service/1.0",
      },
      body: {
        account_token: "tok_sensitive",
        recipient: "lead@example.test",
        safe_data: "normal value",
      },
    };

    const sanitized = sanitizeWebhookPayload(raw) as {
      event_id: string;
      headers: Record<string, string>;
      body: Record<string, string>;
    };

    expect(sanitized.event_id).toBe("evt_abc123");
    expect(sanitized.headers.authorization).toBe("[REDACTED]");
    expect(sanitized.headers["x-api-key"]).toBe("[REDACTED]");
    expect(sanitized.headers["user-agent"]).toBe("Webhook-Service/1.0");
    expect(sanitized.body.account_token).toBe("[REDACTED]");
    expect(sanitized.body.recipient).toBe("lead@example.test");
    expect(sanitized.body.safe_data).toBe("normal value");
  });
});
