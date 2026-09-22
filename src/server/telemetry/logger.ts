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
  | "attribution.get_touches";

type LogEntry = {
  event: TelemetryEvent;
  outcome: "success" | "denied" | "error";
  requestId?: string;
  errorCode?: ErrorCode;
  code?: string;
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
    })
  );
}
