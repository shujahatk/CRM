import "server-only";
import { getProviderAdapter } from "../registry";
import {
  computeOutboundPayloadFingerprint,
  type ResendProviderAdapter,
} from "./adapter";
import { log } from "@/server/telemetry/logger";

export interface QueryChain {
  eq(col: string, val: string): QueryChain;
  single(): Promise<{ data: unknown; error: { message: string } | null }>;
  maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }>;
}

export interface DispatchQueryClient {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
  from(table: string): {
    select(columns: string): QueryChain;
  };
}

interface CanonicalMessageRow {
  id: string;
  workspace_id: string;
  channel: string;
  sender_address: string;
  recipient_address: string;
  subject: string | null;
  text_body: string;
  html_body: string | null;
  status: string;
}

interface PreSendPolicyResult {
  is_eligible: boolean;
  block_reason: string | null;
  error_classification: string | null;
}

export interface DispatchJobResult {
  jobId: string;
  messageId: string;
  success: boolean;
  status: "completed" | "blocked" | "failed" | "skipped";
  providerMessageId?: string;
  error?: string;
  errorClassification?: string;
}

/**
 * Executes a single Resend dispatch job with JIT pre-send policy evaluation,
 * payload immutability enforcement, and atomic provider reference recording.
 */
export async function executeResendDispatchJob(
  client: DispatchQueryClient,
  job: {
    job_id: string;
    workspace_id: string;
    message_id: string;
    channel: string;
    channel_account_id: string;
    provider: string;
    fence: number;
    attempt_count: number;
  },
  customAdapter?: ResendProviderAdapter
): Promise<DispatchJobResult> {
  const { workspace_id: workspaceId, job_id: jobId, message_id: messageId } = job;

  // 1. JIT Pre-send Policy Check (DNC, suppression, campaign, sequence, lead check)
  const { data: evalPolicy, error: evalError } = await client.rpc(
    "evaluate_pre_send_policy",
    {
      p_workspace_id: workspaceId,
      p_job_id: jobId,
    }
  );

  if (evalError) {
    return {
      jobId,
      messageId,
      success: false,
      status: "failed",
      error: evalError.message,
      errorClassification: "unknown",
    };
  }

  const evalResult = Array.isArray(evalPolicy)
    ? (evalPolicy[0] as PreSendPolicyResult)
    : (evalPolicy as PreSendPolicyResult);

  if (!evalResult?.is_eligible) {
    const blockReason = evalResult?.block_reason ?? "pre_send_policy_blocked";
    const classification = evalResult?.error_classification ?? "permanent";

    log({
      event: "provider.dispatch_blocked",
      outcome: "denied",
      provider: "resend",
      jobId,
      code: blockReason,
    });

    return {
      jobId,
      messageId,
      success: false,
      status: "blocked",
      error: blockReason,
      errorClassification: classification,
    };
  }

  // 2. Fetch canonical message details
  const { data: msgData, error: msgError } = await client
    .from("messages")
    .select("id, workspace_id, channel, sender_address, recipient_address, subject, text_body, html_body, status")
    .eq("workspace_id", workspaceId)
    .eq("id", messageId)
    .single();

  if (msgError || !msgData) {
    return {
      jobId,
      messageId,
      success: false,
      status: "failed",
      error: msgError?.message ?? "Message not found",
      errorClassification: "permanent",
    };
  }

  const msg = msgData as CanonicalMessageRow;
  const operationKey = `op:${workspaceId}:${jobId}`;
  const payloadFingerprint = computeOutboundPayloadFingerprint({
    senderAddress: msg.sender_address,
    recipientAddress: msg.recipient_address,
    subject: msg.subject,
    textBody: msg.text_body,
    htmlBody: msg.html_body,
  });

  // Verify payload immutability across retries if existing provider operation exists
  const { data: existingOp } = (await client
    .from("provider_operations")
    .select("request_hash")
    .eq("workspace_id", workspaceId)
    .eq("provider", "resend")
    .eq("operation_key", operationKey)
    .maybeSingle()) as { data: { request_hash?: string } | null; error: unknown };

  if (existingOp && existingOp.request_hash !== payloadFingerprint) {
    log({
      event: "provider.dispatch_failed",
      outcome: "error",
      provider: "resend",
      jobId,
      code: "payload_mutation_conflict",
    });

    return {
      jobId,
      messageId,
      success: false,
      status: "failed",
      error: "payload_mutation_conflict",
      errorClassification: "permanent",
    };
  }

  // 3. Obtain adapter
  const adapter = customAdapter ?? (getProviderAdapter("resend") as ResendProviderAdapter);

  // 4. Dispatch through Resend adapter
  log({
    event: "provider.dispatch_claimed",
    outcome: "success",
    provider: "resend",
    jobId,
  });

  const dispatchResult = await adapter.dispatch({
    messageId,
    workspaceId,
    channel: "email",
    senderAddress: msg.sender_address,
    recipientAddress: msg.recipient_address,
    subject: msg.subject,
    textBody: msg.text_body,
    htmlBody: msg.html_body,
    metadata: {
      operationKey,
      payloadFingerprint,
    },
  });

  // 5. Handle Outcome
  if (dispatchResult.dispatched && dispatchResult.providerMessageId) {
    return {
      jobId,
      messageId,
      success: true,
      status: "completed",
      providerMessageId: dispatchResult.providerMessageId,
    };
  }

  const classification = dispatchResult.errorClassification ?? "unknown";
  log({
    event: "provider.dispatch_failed",
    outcome: "error",
    provider: "resend",
    jobId,
    code: dispatchResult.error,
  });

  return {
    jobId,
    messageId,
    success: false,
    status: "failed",
    error: dispatchResult.error,
    errorClassification: classification,
  };
}
