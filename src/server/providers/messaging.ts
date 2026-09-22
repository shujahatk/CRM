import "server-only";
import type { ChannelType } from "@/modules/conversations/types";

export interface ProviderMessagePayload {
  messageId: string;
  workspaceId: string;
  channel: ChannelType;
  senderAddress: string;
  recipientAddress: string;
  subject?: string | null;
  textBody: string;
  htmlBody?: string | null;
}

export interface ProviderDispatchResult {
  dispatched: boolean;
  providerStatus: "awaiting_provider" | "dispatched" | "suppressed";
  providerMessageId?: string;
  error?: string;
}

export interface MessagingProviderAdapter {
  readonly channel: ChannelType;
  isConfigured(): boolean;
  dispatch(payload: ProviderMessagePayload): Promise<ProviderDispatchResult>;
}

/**
 * Phase 5 Disconnected Provider Adapter
 *
 * Per Phase 5 Architecture Policy (Corrections 6 & 7):
 * - No external provider calls (no Resend, Twilio, Meta/WhatsApp).
 * - Messages terminate internally at status = 'queued', dispatch_status = 'awaiting_provider'.
 * - No fake failure or synthetic retries are generated.
 */
export class DisconnectedProviderAdapter implements MessagingProviderAdapter {
  constructor(readonly channel: ChannelType) {}

  isConfigured(): boolean {
    // Explicitly unconfigured in Phase 5
    return false;
  }

  async dispatch(payload: ProviderMessagePayload): Promise<ProviderDispatchResult> {
    // Terminate internally at awaiting_provider without network calls or fake failures
    return {
      dispatched: false,
      providerStatus: "awaiting_provider",
      error: `Provider dispatch disabled in Phase 5: ${payload.channel} adapter is disconnected by policy`,
    };
  }
}

export function getMessagingProvider(channel: ChannelType): MessagingProviderAdapter {
  // Phase 5 strictly provides disconnected provider adapters
  return new DisconnectedProviderAdapter(channel);
}
