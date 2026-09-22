export type ChannelType = "email" | "sms" | "whatsapp";
export type MessageDirection = "inbound" | "outbound";
export type MessageStatus =
  | "draft"
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "failed"
  | "bounced"
  | "received"
  | "cancelled"
  | "suppressed";

export type DispatchStatus =
  | "awaiting_provider"
  | "pending_dispatch"
  | "dispatched"
  | "suppressed"
  | "cancelled"
  | "received";

export type ConversationStatus = "open" | "pending" | "closed" | "archived";

export interface ChannelAccount {
  id: string;
  workspace_id: string;
  channel: ChannelType;
  sender_address: string;
  display_name: string;
  is_default: boolean;
  status: "active" | "inactive" | "pending_verification";
  created_at: string;
}

export interface ConversationSummary {
  id: string;
  lead_id: string;
  lead_name: string;
  lead_company: string | null;
  channel: ChannelType;
  destination: string;
  status: ConversationStatus;
  unread_count: number;
  last_message_at: string;
  last_message_snippet: string | null;
  assigned_to_name: string | null;
}

export interface MessageDetail {
  id: string;
  direction: MessageDirection;
  channel: ChannelType;
  sender: string;
  recipient: string;
  subject: string | null;
  text_body: string;
  status: MessageStatus;
  dispatch_status: DispatchStatus;
  created_at: string;
  author_name: string | null;
}

export interface InboundMessageReview {
  id: string;
  channel: ChannelType;
  sender_address: string;
  recipient_address: string;
  subject: string | null;
  text_body: string;
  occurred_at: string;
  resolution_state: "pending" | "resolved" | "dismissed";
  resolution_reason: "unmatched_sender" | "ambiguous_identity_conflict" | "missing_channel_account";
  candidate_lead_ids: string[];
}

export interface MessageTemplate {
  id: string;
  name: string;
  channel: ChannelType;
  status?: string;
  current_version?: number | null;
  active_version?: number | null;
  active_version_id?: string | null;
  subject?: string | null;
  active_subject?: string | null;
  body?: string | null;
  active_body?: string | null;
  variables_used?: string[];
  created_at?: string;
  updated_at?: string;
}

export interface CampaignSummary {
  id: string;
  name: string;
  channel: ChannelType;
  status: string;
  scheduled_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  recipient_count?: number;
  eligible_count?: number;
  suppressed_count?: number;
  template_version_id?: string | null;
}
