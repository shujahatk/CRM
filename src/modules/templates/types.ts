import type { ChannelType } from "@/modules/conversations/types";

export interface MessageTemplate {
  id: string;
  name: string;
  channel: ChannelType;
  status: "active" | "archived";
  current_version: number | null;
  subject: string | null;
  body: string | null;
  variables_used: string[];
}

export interface MessageTemplateVersion {
  id: string;
  template_id: string;
  version: number;
  subject: string | null;
  body: string;
  variables_used: string[];
  published_by_membership_id: string;
  published_at: string;
}

export const ALLOWED_TEMPLATE_VARIABLES = [
  "first_name",
  "last_name",
  "company",
  "setter_name",
  "closer_name",
  "workspace_name",
  "meeting_url",
] as const;

export type TemplateVariable = (typeof ALLOWED_TEMPLATE_VARIABLES)[number];
