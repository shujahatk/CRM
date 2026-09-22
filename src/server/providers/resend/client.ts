import "server-only";
import { Resend } from "resend";
import { serverEnv } from "@/server/config/env";

let cachedClient: Resend | null = null;
let lastApiKey: string | undefined = undefined;

/**
 * Checks whether Resend has credentials configured in the environment.
 */
export function isResendConfigured(): boolean {
  try {
    const key = serverEnv().RESEND_API_KEY;
    return typeof key === "string" && key.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Returns a server-only instance of the official Resend client,
 * or null if credentials are not configured.
 */
export function getResendClient(): Resend | null {
  if (!isResendConfigured()) {
    return null;
  }

  const apiKey = serverEnv().RESEND_API_KEY!.trim();
  if (!cachedClient || lastApiKey !== apiKey) {
    cachedClient = new Resend(apiKey);
    lastApiKey = apiKey;
  }

  return cachedClient;
}

/**
 * Returns the Resend webhook signing secret, if configured.
 */
export function getResendWebhookSecret(): string | null {
  try {
    const secret = serverEnv().RESEND_WEBHOOK_SECRET;
    return typeof secret === "string" && secret.trim().length > 0 ? secret.trim() : null;
  } catch {
    return null;
  }
}
