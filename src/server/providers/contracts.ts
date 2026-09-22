import "server-only";
import type { ChannelType } from "@/modules/conversations/types";

export type ProviderType =
  | "resend"
  | "twilio"
  | "whatsapp"
  | "calendly"
  | "meta"
  | "vsl"
  | "outbound";

export type ConnectionState =
  | "not_configured"
  | "configured"
  | "verification_required"
  | "active"
  | "degraded"
  | "disabled"
  | "error";

export type HealthStatus =
  | "not_configured"
  | "active"
  | "degraded"
  | "error"
  | "disabled"
  | "verification_required";

export type ErrorClassification =
  | "transient"
  | "rate_limited"
  | "authentication"
  | "configuration"
  | "invalid_destination"
  | "suppressed"
  | "provider_rejected"
  | "permanent"
  | "unknown";

export interface ProviderConnectionDTO {
  id: string;
  provider: ProviderType;
  externalAccountId: string;
  connectionState: ConnectionState;
  capabilities: string[];
  configurationMetadata: Record<string, unknown>;
  healthStatus: HealthStatus;
  lastHealthCheckAt?: string | null;
  lastHealthCheckCode?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderMessagePayload {
  messageId: string;
  workspaceId: string;
  channel: ChannelType;
  senderAddress: string;
  recipientAddress: string;
  subject?: string | null;
  textBody: string;
  htmlBody?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ProviderDispatchResult {
  dispatched: boolean;
  providerStatus: "awaiting_provider" | "dispatched" | "suppressed" | "failed" | "provider_not_configured";
  providerMessageId?: string;
  errorClassification?: ErrorClassification;
  error?: string;
}

export interface NormalizedWebhookEvent {
  externalEventId: string;
  eventType: string;
  providerTimestamp?: string | null;
  sanitizedPayload: Record<string, unknown>;
  rawPayloadHash: string;
}

export interface ProviderWebhookResult {
  verified: boolean;
  outcome: "received" | "replay_safe" | "quarantined_conflict" | "rejected";
  eventId?: string;
  error?: string;
}

export interface ProviderAdapter {
  readonly provider: ProviderType;
  readonly supportedChannels: readonly ChannelType[];
  isConfigured(): boolean;
  healthCheck?(): Promise<{ status: HealthStatus; code?: string }>;
  dispatch(payload: ProviderMessagePayload): Promise<ProviderDispatchResult>;
}
