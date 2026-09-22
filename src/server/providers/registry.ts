import "server-only";
import type { ChannelType } from "@/modules/conversations/types";
import type {
  ProviderType,
  ProviderAdapter,
  ProviderMessagePayload,
  ProviderDispatchResult,
  HealthStatus,
} from "./contracts";

export class DisconnectedProviderAdapter implements ProviderAdapter {
  constructor(
    readonly provider: ProviderType,
    readonly supportedChannels: readonly ChannelType[]
  ) {}

  isConfigured(): boolean {
    return false;
  }

  async healthCheck(): Promise<{ status: HealthStatus; code?: string }> {
    return {
      status: "not_configured",
      code: "provider_not_configured",
    };
  }

  async dispatch(payload: ProviderMessagePayload): Promise<ProviderDispatchResult> {
    return {
      dispatched: false,
      providerStatus: "provider_not_configured",
      errorClassification: "configuration",
      error: `Provider '${this.provider}' (${payload.channel}) is disconnected in Phase 6A.1: provider infrastructure is neutral; external provider is not configured.`,
    };
  }
}

const REGISTRY = new Map<ProviderType, ProviderAdapter>();

function initDefaultAdapters() {
  REGISTRY.set("resend", new DisconnectedProviderAdapter("resend", ["email"]));
  REGISTRY.set("twilio", new DisconnectedProviderAdapter("twilio", ["sms"]));
  REGISTRY.set("whatsapp", new DisconnectedProviderAdapter("whatsapp", ["whatsapp"]));
  REGISTRY.set("calendly", new DisconnectedProviderAdapter("calendly", []));
  REGISTRY.set("meta", new DisconnectedProviderAdapter("meta", []));
  REGISTRY.set("vsl", new DisconnectedProviderAdapter("vsl", []));
  REGISTRY.set("outbound", new DisconnectedProviderAdapter("outbound", []));
}

initDefaultAdapters();

export function getProviderAdapter(provider: ProviderType): ProviderAdapter {
  const adapter = REGISTRY.get(provider);
  if (!adapter) {
    throw new Error(`Unsupported provider: ${provider}`);
  }
  return adapter;
}

export function registerProviderAdapter(adapter: ProviderAdapter): void {
  REGISTRY.set(adapter.provider, adapter);
}
