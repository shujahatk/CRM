import "server-only";
import { serverEnv } from "@/server/config/env";
import type { ErrorCode } from "@/server/errors";

export type TelemetryEvent =
  | "auth.login"
  | "auth.logout"
  | "auth.callback"
  | "request.failed"
  | "invitation.accept"
  | "lead.create"
  | "lead.update"
  | "lead.assign"
  | "note.create"
  | "note.edit"
  | "stage.transition"
  | "task.create"
  | "task.complete"
  | "sales.command"
  | "payment.command"
  | "task.reopen"
  | "forms.create_site"
  | "forms.create_form"
  | "forms.publish_version"
  | "forms.public_submit"
  | "vsl.create_asset"
  | "vsl.get_lead_history"
  | "vsl.get_analytics"
  | "vsl.public_start"
  | "vsl.public_heartbeat"
  | "attribution.get_snapshots"
  | "attribution.get_touches"
  | "messaging.outbound_create"
  | "messaging.inbound_ingest"
  | "messaging.inbound_resolve"
  | "messaging.suppression_add"
  | "messaging.suppression_revoke"
  | "template.create"
  | "template.publish"
  | "campaign.create"
  | "campaign.launch"
  | "campaign.cancel"
  | "sequence.create"
  | "sequence.publish"
  | "sequence.enroll"
  | "provider.dispatch_claimed"
  | "provider.dispatch_blocked"
  | "provider.dispatch_failed"
  | "provider.webhook_received"
  | "provider.webhook_rejected"
  | "provider.webhook_processed"
  | "provider.webhook_quarantined";

type LogEntry = {
  event: TelemetryEvent;
  outcome: "success" | "denied" | "error";
  requestId?: string;
  errorCode?: ErrorCode;
  code?: string;
  // Privacy-safe metadata (Never log full message bodies, auth headers, tokens, or raw PII)
  channel?: "email" | "sms" | "whatsapp";
  messageId?: string;
  conversationId?: string;
  campaignId?: string;
  sequenceId?: string;
  provider?: string;
  jobId?: string;
  eventId?: string;
  errorClassification?: string;
};

export function log(entry: LogEntry) {
  // Construct explicitly. Never spread an error/request/form/provider payload into a log.
  const level = entry.outcome === "error" ? "error" : entry.outcome === "denied" ? "warn" : "info";
  const levels = { info: 0, warn: 1, error: 2 };
  if (levels[level] < levels[serverEnv().LOG_LEVEL]) return;
  console[level](
    JSON.stringify({
      time: new Date().toISOString(),
      level,
      service: "8020-crm",
      event: entry.event,
      outcome: entry.outcome,
      requestId: entry.requestId || crypto.randomUUID(),
      ...(entry.errorCode ? { errorCode: entry.errorCode } : {}),
      ...(entry.code ? { code: entry.code } : {}),
      ...(entry.channel ? { channel: entry.channel } : {}),
      ...(entry.messageId ? { messageId: entry.messageId } : {}),
      ...(entry.conversationId ? { conversationId: entry.conversationId } : {}),
      ...(entry.campaignId ? { campaignId: entry.campaignId } : {}),
      ...(entry.sequenceId ? { sequenceId: entry.sequenceId } : {}),
      ...(entry.provider ? { provider: entry.provider } : {}),
      ...(entry.jobId ? { jobId: entry.jobId } : {}),
      ...(entry.eventId ? { eventId: entry.eventId } : {}),
      ...(entry.errorClassification ? { errorClassification: entry.errorClassification } : {}),
    })
  );
}
