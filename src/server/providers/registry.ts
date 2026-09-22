import "server-only";
import type {
  ProviderType,
  ProviderAdapter,
} from "./contracts";

import { ResendProviderAdapter } from "./resend/adapter";
import { DisconnectedProviderAdapter } from "./disconnected";

export { DisconnectedProviderAdapter };

const REGISTRY = new Map<ProviderType, ProviderAdapter>();

function initDefaultAdapters() {
  REGISTRY.set("resend", new ResendProviderAdapter());
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
