import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  computePayloadHash,
  sanitizeWebhookPayload,
  validatePayloadSize,
} from "@/server/providers/webhooks/envelope";
import {
  extractResendWebhookHeaders,
  resolveWebhookSecret,
  verifyResendWebhookSignature,
} from "@/server/providers/resend/webhook";
import { log } from "@/server/telemetry/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  // 1. Read raw request body as string (strict requirement for cryptographic verification)
  const rawBody = await request.text();

  // 2. Enforce maximum payload size ceiling
  if (!validatePayloadSize(rawBody.length)) {
    return new NextResponse("Payload too large or empty", { status: 413 });
  }

  // 3. Collect required Svix / Resend signature headers
  const sigHeaders = extractResendWebhookHeaders(request.headers);
  if (!sigHeaders) {
    log({
      event: "provider.webhook_rejected",
      outcome: "denied",
      provider: "resend",
      code: "missing_signature_headers",
    });
    return new NextResponse("Missing required signature headers", { status: 400 });
  }

  // 4. Resolve configured webhook secret
  const secret = resolveWebhookSecret();
  if (!secret) {
    log({
      event: "provider.webhook_rejected",
      outcome: "error",
      provider: "resend",
      code: "secret_not_configured",
    });
    return new NextResponse("Webhook secret not configured", { status: 500 });
  }

  // 5. Cryptographic signature verification BEFORE any parsing or mutation
  const isValid = verifyResendWebhookSignature({
    payload: rawBody,
    id: sigHeaders.id,
    timestamp: sigHeaders.timestamp,
    signature: sigHeaders.signature,
    secret,
  });

  if (!isValid) {
    log({
      event: "provider.webhook_rejected",
      outcome: "denied",
      provider: "resend",
      code: "invalid_signature",
    });
    return new NextResponse("Invalid webhook signature", { status: 400 });
  }

  // 6. Safe JSON Parsing
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    log({
      event: "provider.webhook_rejected",
      outcome: "denied",
      provider: "resend",
      code: "malformed_json",
    });
    return new NextResponse("Malformed JSON payload", { status: 400 });
  }

  // 7. Compute deterministic envelope hash & sanitize payload
  const payloadHash = computePayloadHash(rawBody);
  const sanitizedPayload = sanitizeWebhookPayload(parsed) as Record<string, unknown>;
  const eventType = typeof parsed.type === "string" ? parsed.type : "unknown";
  const dataObj =
    typeof parsed.data === "object" && parsed.data !== null
      ? (parsed.data as Record<string, unknown>)
      : {};

  const providerEmailId =
    typeof dataObj.email_id === "string"
      ? dataObj.email_id
      : typeof dataObj.id === "string"
        ? dataObj.id
        : null;

  let recipientAddress: string | null = null;
  if (Array.isArray(dataObj.to) && typeof dataObj.to[0] === "string") {
    recipientAddress = dataObj.to[0];
  } else if (typeof dataObj.to === "string") {
    recipientAddress = dataObj.to;
  }

  // Authenticated external event ID from Svix headers (Correction 6)
  const externalEventId = sigHeaders.id;

  // 8. Invoke authoritative database RPC
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "anon-key-placeholder";
  const client = createClient(supabaseUrl, supabaseAnonKey);

  const { data, error } = await client.rpc("ingest_resend_webhook", {
    p_external_event_id: externalEventId,
    p_event_type: eventType,
    p_payload_hash: payloadHash,
    p_sanitized_payload: sanitizedPayload,
    p_provider_email_id: providerEmailId,
    p_recipient_address: recipientAddress,
    p_provider_timestamp: typeof parsed.created_at === "string" ? parsed.created_at : null,
  });

  if (error) {
    log({
      event: "provider.webhook_rejected",
      outcome: "error",
      provider: "resend",
      code: error.message,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const result = data as {
    outcome: string;
    event_id?: string;
    workspace_id?: string;
    error?: string;
  };

  // Handle unresolvable or ambiguous account outcomes (Correction 1)
  if (result.outcome === "unresolved_account") {
    log({
      event: "provider.webhook_quarantined",
      outcome: "denied",
      provider: "resend",
      code: "unresolved_account",
    });
    return NextResponse.json(
      { error: "Unresolved account: no authoritative workspace found" },
      { status: 422 }
    );
  }

  if (result.outcome === "ambiguous_account_mapping") {
    log({
      event: "provider.webhook_quarantined",
      outcome: "denied",
      provider: "resend",
      code: "ambiguous_account_mapping",
    });
    return NextResponse.json(
      { error: "Ambiguous account mapping: multiple channel accounts match destination" },
      { status: 422 }
    );
  }

  if (result.outcome === "quarantined_conflict") {
    log({
      event: "provider.webhook_quarantined",
      outcome: "denied",
      provider: "resend",
      code: "conflicting_payload",
      eventId: result.event_id,
    });
    return NextResponse.json({ outcome: "quarantined_conflict", event_id: result.event_id });
  }

  log({
    event: "provider.webhook_received",
    outcome: "success",
    provider: "resend",
    eventId: result.event_id,
    code: result.outcome,
  });

  return NextResponse.json({
    received: true,
    outcome: result.outcome,
    event_id: result.event_id,
  });
}
