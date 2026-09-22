import type { ChannelType } from "@/modules/conversations/types";

export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

export type RecipientEligibility = "eligible" | "suppressed" | "missing_destination";

export type RecipientStatus =
  | "pending"
  | "queued"
  | "dispatched"
  | "skipped"
  | "failed"
  | "cancelled";

export interface CampaignSummary {
  id: string;
  name: string;
  channel: ChannelType;
  status: CampaignStatus;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  recipient_count: number;
  eligible_count: number;
  suppressed_count: number;
}

export interface CampaignRecipient {
  id: string;
  campaign_id: string;
  lead_id: string;
  destination_normalized: string;
  eligibility_status: RecipientEligibility;
  suppression_rule_applied: string | null;
  suppression_reason: string | null;
  status: RecipientStatus;
  message_id: string | null;
  created_at: string;
}
