import "server-only";
import { createHash } from "node:crypto";
import type { Resend } from "resend";
import type {
  ProviderMessagePayload,
  ProviderDispatchResult,
  HealthStatus,
} from "../contracts";
import { classifyProviderError } from "../errors";
import { getResendClient, isResendConfigured } from "./client";

export interface ResendSendTransport {
  send(
    payload: {
      from: string;
      to: string[];
      subject: string;
      text: string;
      html?: string;
      replyTo?: string;
      tags?: Array<{ name: string; value: string }>;
    },
    options?: { idempotencyKey?: string }
  ): Promise<{ data: { id: string } | null; error: { message: string; name?: string } | null }>;
}

/**
 * Computes a deterministic, bounded idempotency key for Resend (<= 256 chars).
 * Format: resend:<sha256(canonical operation identity)> (71 characters total).
 */
export function computeResendIdempotencyKey(operationKey: string): string {
  const hash = createHash("sha256").update(operationKey).digest("hex");
  return `resend:${hash}`;
}

/**
 * Computes a deterministic payload fingerprint to enforce immutability on retry.
 */
export function computeOutboundPayloadFingerprint(payload: {
  senderAddress: string;
  recipientAddress: string;
  subject?: string | null;
  textBody: string;
  htmlBody?: string | null;
  replyTo?: string | null;
}): string {
  const normalized = {
    from: payload.senderAddress.trim().toLowerCase(),
    to: payload.recipientAddress.trim().toLowerCase(),
    subject: payload.subject?.trim() ?? "",
    text: payload.textBody.trim(),
    html: payload.htmlBody?.trim() ?? "",
    replyTo: payload.replyTo?.trim().toLowerCase() ?? "",
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

import { DisconnectedProviderAdapter } from "../disconnected";

export class ResendProviderAdapter extends DisconnectedProviderAdapter {
  constructor(
    private readonly customTransport?: ResendSendTransport,
    private readonly clientProvider: () => Resend | null = getResendClient
  ) {
    super("resend", ["email"]);
  }

  override isConfigured(): boolean {
    if (this.customTransport) return true;
    return isResendConfigured();
  }

  override async healthCheck(): Promise<{ status: HealthStatus; code?: string }> {
    if (!this.isConfigured()) {
      return super.healthCheck();
    }
    // When credentials exist, return active
    return {
      status: "active",
      code: "credentials_present",
    };
  }

  override async dispatch(payload: ProviderMessagePayload): Promise<ProviderDispatchResult> {
    if (!this.isConfigured()) {
      return super.dispatch(payload);
    }

    const operationKey =
      typeof payload.metadata?.operationKey === "string" && payload.metadata.operationKey.trim().length > 0
        ? payload.metadata.operationKey.trim()
        : `msg:${payload.workspaceId}:${payload.messageId}`;

    const replyTo =
      typeof payload.metadata?.replyTo === "string" && payload.metadata.replyTo.trim().length > 0
        ? payload.metadata.replyTo.trim()
        : undefined;

    // Verify payload immutability if expected fingerprint is specified
    const expectedFingerprint =
      typeof payload.metadata?.expectedFingerprint === "string" && payload.metadata.expectedFingerprint.length > 0
        ? payload.metadata.expectedFingerprint
        : null;

    if (expectedFingerprint) {
      const currentFingerprint = computeOutboundPayloadFingerprint({
        senderAddress: payload.senderAddress,
        recipientAddress: payload.recipientAddress,
        subject: payload.subject,
        textBody: payload.textBody,
        htmlBody: payload.htmlBody,
        replyTo,
      });

      if (currentFingerprint !== expectedFingerprint) {
        return {
          dispatched: false,
          error: "payload_mutation_conflict",
          errorClassification: "permanent",
          providerStatus: "failed",
        };
      }
    }

    const idempotencyKey = computeResendIdempotencyKey(operationKey);

    const emailPayload = {
      from: payload.senderAddress.trim(),
      to: [payload.recipientAddress.trim().toLowerCase()],
      subject: payload.subject?.trim() || "(No Subject)",
      text: payload.textBody,
      html: payload.htmlBody?.trim() || undefined,
      replyTo,
      tags: [
        { name: "workspace_id", value: payload.workspaceId },
        { name: "message_id", value: payload.messageId },
      ],
    };

    try {
      let res: { data: { id: string } | null; error: { message: string; name?: string } | null };

      if (this.customTransport) {
        res = await this.customTransport.send(emailPayload, { idempotencyKey });
      } else {
        const client = this.clientProvider();
        if (!client) {
          return {
            dispatched: false,
            providerStatus: "provider_not_configured",
            errorClassification: "configuration",
            error: "Resend client could not be initialized.",
          };
        }

        const sdkRes = await client.emails.send(emailPayload, { idempotencyKey });
        res = {
          data: sdkRes.data ? { id: sdkRes.data.id } : null,
          error: sdkRes.error ? { message: sdkRes.error.message, name: sdkRes.error.name } : null,
        };
      }

      if (res.error) {
        const classification = classifyProviderError(res.error);
        return {
          dispatched: false,
          providerStatus: "failed",
          errorClassification: classification,
          error: res.error.message,
        };
      }

      if (!res.data?.id) {
        return {
          dispatched: false,
          providerStatus: "failed",
          errorClassification: "unknown",
          error: "Resend API returned success without an email id.",
        };
      }

      return {
        dispatched: true,
        providerStatus: "dispatched",
        providerMessageId: res.data.id,
      };
    } catch (error) {
      const classification = classifyProviderError(error);
      return {
        dispatched: false,
        providerStatus: "failed",
        errorClassification: classification,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
