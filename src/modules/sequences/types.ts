import type { ChannelType } from "@/modules/conversations/types";

export type SequenceStatus = "draft" | "active" | "archived";
export type EnrollmentStatus = "active" | "completed" | "exited" | "paused";
export type ExecutionStatus =
  | "scheduled"
  | "running"
  | "completed"
  | "skipped"
  | "failed"
  | "cancelled";

export type ExitCondition =
  | "reply_received"
  | "meeting_booked"
  | "showed"
  | "closed_won"
  | "closed_lost"
  | "dnc";

export interface SequenceSummary {
  id: string;
  name: string;
  description: string | null;
  status: string;
  current_version: number | null;
  active_version?: number | null;
  exit_conditions: string[];
  step_count: number;
  steps_count?: number;
  active_enrollments: number;
  enrollments_count?: number;
}

export interface SequenceStep {
  id: string;
  sequence_version_id: string;
  step_number: number;
  delay_seconds: number;
  channel: ChannelType;
  template_version_id: string;
}

export interface SequenceEnrollment {
  id: string;
  sequence_version_id: string;
  lead_id: string;
  status: EnrollmentStatus;
  current_step_number: number;
  start_at: string;
  completed_at: string | null;
  exited_at: string | null;
  exit_reason: string | null;
}
