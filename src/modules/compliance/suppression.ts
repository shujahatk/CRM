import type { ChannelType } from "@/modules/conversations/types";

export type SuppressionScope =
  | "workspace_dnc"
  | "lead_dnc"
  | "destination_block"
  | "channel_suppression";

export type SuppressionReason =
  | "manual_dnc"
  | "unsubscribe"
  | "hard_bounce"
  | "spam_complaint"
  | "consent_withdrawn"
  | "invalid_destination";

export type SuppressionStatus = "active" | "revoked" | "expired" | "superseded";

export interface SuppressionRecord {
  id: string;
  workspace_id: string;
  scope: SuppressionScope;
  destination_normalized: string | null;
  channel: ChannelType | null;
  lead_id: string | null;
  reason: SuppressionReason;
  source: "rep_ui" | "inbound_stop" | "provider_webhook" | "api" | "consent_sync";
  status: SuppressionStatus;
  actor_membership_id: string | null;
  revoked_by_membership_id: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
  created_at: string;
  expires_at: string | null;
}

export interface SuppressionEvaluationResult {
  isSuppressed: boolean;
  ruleApplied?: string;
  reason?: string;
  refId?: string;
}
