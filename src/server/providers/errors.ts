import "server-only";
import type { ErrorClassification } from "./contracts";

export function classifyProviderError(error: unknown): ErrorClassification {
  if (!error) return "unknown";

  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message).toLowerCase()
        : String(error).toLowerCase();
  const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status: unknown }).status) : null;
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code).toLowerCase() : "";

  // 1. Rate Limiting
  if (status === 429 || message.includes("rate limit") || message.includes("too many requests") || code === "rate_limit_exceeded") {
    return "rate_limited";
  }

  // 2. Authentication / Credentials
  if (status === 401 || status === 403 || message.includes("unauthorized") || message.includes("forbidden") || message.includes("api key") || message.includes("invalid token") || message.includes("bad credentials")) {
    return "authentication";
  }

  // 3. Transient Network / Server errors
  if (
    (status && status >= 500 && status <= 599) ||
    message.includes("timeout") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("network error") ||
    code === "etimedout" ||
    code === "econnreset"
  ) {
    return "transient";
  }

  // 4. Invalid Destination
  if (
    message.includes("invalid email") ||
    message.includes("invalid phone") ||
    message.includes("unroutable") ||
    message.includes("does not exist") ||
    message.includes("invalid_recipient")
  ) {
    return "invalid_destination";
  }

  // 5. Suppressed / Opted Out
  if (message.includes("suppressed") || message.includes("unsubscribed") || message.includes("dnc") || message.includes("opt-out")) {
    return "suppressed";
  }

  // 6. Provider Configuration
  if (message.includes("not configured") || message.includes("unverified domain") || message.includes("unregistered sender") || message.includes("missing channel account")) {
    return "configuration";
  }

  // 7. Provider Rejection (Bad Request)
  if (status === 400 || message.includes("bad request") || message.includes("rejected by provider") || message.includes("validation error")) {
    return "provider_rejected";
  }

  return "unknown";
}

export function isRetryable(classification: ErrorClassification): boolean {
  switch (classification) {
    case "transient":
    case "rate_limited":
      return true;
    case "authentication":
    case "configuration":
    case "invalid_destination":
    case "suppressed":
    case "provider_rejected":
    case "permanent":
    case "unknown":
    default:
      return false;
  }
}

export function calculateBackoffSeconds(attempt: number, baseSeconds = 5, maxSeconds = 3600): number {
  if (attempt <= 0) return baseSeconds;
  // Exponential backoff: base * 2^(attempt - 1)
  const exp = Math.min(attempt - 1, 10);
  const backoff = baseSeconds * Math.pow(2, exp);
  return Math.min(backoff, maxSeconds);
}
