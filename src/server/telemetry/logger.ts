import "server-only";
import { serverEnv } from "@/server/config/env";
import type { ErrorCode } from "@/server/errors";

type LogEntry = {
  event: "auth.login" | "auth.logout" | "auth.callback" | "request.failed" | "invitation.accept";
  outcome: "success" | "denied" | "error";
  requestId: string;
  errorCode?: ErrorCode;
};
export function log(entry: LogEntry) {
  // Construct explicitly. Never spread an error/request/form/provider payload into a log.
  const level = entry.outcome === "error" ? "error" : entry.outcome === "denied" ? "warn" : "info";
  const levels = { info: 0, warn: 1, error: 2 };
  if (levels[level] < levels[serverEnv().LOG_LEVEL]) return;
  console[level](JSON.stringify({ time: new Date().toISOString(), level, service: "8020-crm", event: entry.event,
    outcome: entry.outcome, requestId: entry.requestId, ...(entry.errorCode ? { errorCode: entry.errorCode } : {}) }));
}
