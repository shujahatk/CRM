import type { MemberRole } from "@/modules/auth/policies";
import type { SalesDetail,SalesReport,EodRevision } from '@/modules/sales/types';

export type Access = { workspace_id: string; workspace_name: string; membership_id: string; role: MemberRole; is_owner: boolean };
export type Workspace = { id: string; name: string; timezone: string; role: MemberRole; is_owner: boolean };
export type Member = { id: string; user_id: string; role: MemberRole; is_owner: boolean; status: string; version: number };

export type LeadSummaryRow = {
  id: string;
  display_name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  stage_code: string | null;
  stage_label: string | null;
  stage_category: "open" | "won" | "lost" | "nurture" | null;
  setter_id: string | null;
  setter_name: string | null;
  closer_id: string | null;
  closer_name: string | null;
  next_action_due: string | null;
  next_action_title: string | null;
  created_at: string;
  total_count: number;
};

export type LeadDetailData = {
  lead: {
    id: string;
    display_name: string;
    company: string | null;
    status: string;
    version: number;
    created_at: string;
    updated_at: string;
    setter_id: string | null;
    setter_name: string | null;
    closer_id: string | null;
    closer_name: string | null;
    team_id: string | null;
    team_name: string | null;
  };
  journey: {
    id: string;
    pipeline_id: string;
    stage_id: string;
    stage_code: string;
    stage_label: string;
    stage_category: string;
    version: number;
    opened_at: string;
  } | null;
  identities: Array<{
    id: string;
    kind: "email" | "phone" | "provider";
    normalized_value: string;
    raw_value: string | null;
    is_primary: boolean;
  }>;
  tags: Array<{
    id: string;
    name: string;
    color: string;
  }>;
  custom_values: Array<{
    key: string;
    label: string;
    data_type: string;
    value: unknown;
  }>;
  next_action: {
    task_id: string;
    title: string;
    due_at: string;
    priority: string;
    assignee_name: string | null;
  } | null;
  notes: Array<{
    id: string;
    pinned: boolean;
    important: boolean;
    author_id: string;
    author_name: string | null;
    created_at: string;
    updated_at: string;
    body: string;
    revision_number: number;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    due_at: string;
    priority: "low" | "medium" | "high" | "urgent";
    status: "open" | "completed" | "cancelled";
    assignee_id: string;
    assignee_name: string | null;
    completed_at: string | null;
    created_at: string;
  }>;
  activities: Array<{
    id: string;
    event_type: string;
    occurred_at: string;
    actor_name: string | null;
    payload: Record<string, unknown>;
  }>;
};

export type TaskRow = {
  id: string;
  lead_id: string;
  lead_name: string;
  title: string;
  due_at: string;
  priority: "low" | "medium" | "high" | "urgent";
  status: "open" | "completed" | "cancelled";
  assignee_id: string;
  assignee_name: string | null;
  created_at: string;
  completed_at: string | null;
  total_count: number;
};

export type PipelineBoardLead = {
  id: string;
  display_name: string;
  company: string | null;
  setter_name: string | null;
  closer_name: string | null;
  next_action_due: string | null;
  next_action_title: string | null;
  journey_version: number;
  created_at: string;
};

export type PipelineBoardStage = {
  stage_code: string;
  label: string;
  category: "open" | "won" | "lost" | "nurture";
  sort_order: number;
  leads: PipelineBoardLead[];
};

export type DashboardMetrics = {
  total_active_leads: number;
  new_leads_7d: number;
  unassigned_leads: number;
  tasks_due_today: number;
  tasks_overdue: number;
  leads_no_next_action: number;
  stage_distribution: Array<{
    stage_code: string;
    label: string;
    category: string;
    sort_order: number;
    count: number;
  }>;
};

export type StageRow = {
  stage_code: string;
  label: string;
  category: "open" | "won" | "lost" | "nurture";
  sort_order: number;
};

export type LostReasonRow = {
  id: string;
  code: string;
  label: string;
};

// Narrow API contract. Validate against generated Supabase types in deployment CI.
export type Database = {
  api: {
    Tables: Record<never, never>; Views: Record<never, never>; Enums: Record<never, never>; CompositeTypes: Record<never, never>;
    Functions: {
      sales_command:{Args:{p_workspace:string;p_lead:string;p_action:string;p_version:number;p_command_key:string;p_input:Record<string,string|number>};Returns:Record<string,unknown>};
      payment_command:{Args:{p_workspace:string;p_lead:string;p_deal:string;p_command_key:string;p_input:Record<string,string>};Returns:Record<string,unknown>};
      sales_detail:{Args:{p_workspace:string;p_lead:string};Returns:SalesDetail};
      sales_report:{Args:{p_workspace:string;p_from:string;p_to:string;p_filters?:Record<string,string|number>};Returns:SalesReport};
      submit_eod:{Args:{p_workspace:string;p_date:string;p_revision:number;p_command_key:string;p_qualitative:Record<string,string>;p_state:string};Returns:{report_id:string;revision:number}};
      eod_history:{Args:{p_workspace:string;p_date:string;p_member?:string};Returns:EodRevision[]};
      my_access: { Args: Record<never, never>; Returns: Access[] };
      workspace_context: { Args: { p_workspace: string }; Returns: Workspace[] };
      list_members: { Args: { p_workspace: string }; Returns: Member[] };
      set_membership_role: { Args: { p_workspace: string; p_member: string; p_role: MemberRole; p_active: boolean; p_version: number }; Returns: undefined };
      create_team: { Args: { p_workspace: string; p_name: string }; Returns: string };
      set_team_member: { Args: { p_workspace: string; p_team: string; p_member: string; p_manager: boolean }; Returns: undefined };
      issue_invitation: { Args: { p_workspace: string; p_email: string; p_role: MemberRole; p_team?: string }; Returns: string };
      accept_invitation: { Args: { p_token: string }; Returns: string };
      revoke_invitation: { Args: { p_workspace: string; p_invitation: string }; Returns: undefined };

      // Phase 2 Functions
      create_lead: {
        Args: {
          p_workspace: string;
          p_name: string;
          p_email?: string | null;
          p_phone?: string | null;
          p_company?: string | null;
          p_command_key?: string | null;
        };
        Returns: string;
      };
      update_lead: {
        Args: {
          p_workspace: string;
          p_lead: string;
          p_display_name: string;
          p_company?: string | null;
          p_version: number;
        };
        Returns: undefined;
      };
      record_identity_conflict: {
        Args: {
          p_workspace: string;
          p_source?: string;
          p_candidate_lead_ids: string[];
          p_conflicting_identities: unknown;
          p_reason: string;
        };
        Returns: string;
      };
      assign_lead: {
        Args: {
          p_workspace: string;
          p_lead: string;
          p_setter?: string | null;
          p_closer?: string | null;
          p_team?: string | null;
          p_reason?: string | null;
          p_version: number;
        };
        Returns: undefined;
      };
      transition_stage: {
        Args: {
          p_workspace: string;
          p_lead: string;
          p_to_stage_code: string;
          p_lost_reason_id?: string | null;
          p_expected_stage_code?: string | null;
          p_version?: number | null;
          p_command_key?: string | null;
        };
        Returns: undefined;
      };
      create_note: {
        Args: {
          p_workspace: string;
          p_lead: string;
          p_body: string;
          p_pinned?: boolean;
          p_important?: boolean;
        };
        Returns: string;
      };
      edit_note: {
        Args: {
          p_workspace: string;
          p_note: string;
          p_body: string;
        };
        Returns: undefined;
      };
      create_task: {
        Args: {
          p_workspace: string;
          p_lead: string;
          p_assignee: string;
          p_title: string;
          p_due_at: string;
          p_priority?: string;
        };
        Returns: string;
      };
      complete_task: {
        Args: {
          p_workspace: string;
          p_task: string;
        };
        Returns: undefined;
      };
      reopen_task: {
        Args: {
          p_workspace: string;
          p_task: string;
        };
        Returns: undefined;
      };
      dashboard_metrics: {
        Args: { p_workspace: string };
        Returns: DashboardMetrics[];
      };
      list_leads: {
        Args: {
          p_workspace: string;
          p_query?: string | null;
          p_stage?: string | null;
          p_setter?: string | null;
          p_closer?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: LeadSummaryRow[];
      };
      get_lead_detail: {
        Args: { p_workspace: string; p_lead: string };
        Returns: LeadDetailData;
      };
      list_tasks: {
        Args: {
          p_workspace: string;
          p_filter?: string;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: TaskRow[];
      };
      pipeline_board: {
        Args: { p_workspace: string };
        Returns: PipelineBoardStage[];
      };
      list_stages: {
        Args: { p_workspace: string };
        Returns: StageRow[];
      };
      list_lost_reasons: {
        Args: { p_workspace: string };
        Returns: LostReasonRow[];
      };
      create_tracking_site: {
        Args: { p_workspace: string; p_name: string; p_allowed_origins: string[]; p_is_public_any_origin: boolean };
        Returns: { site_id: string; public_key: string };
      };
      create_form: {
        Args: { p_workspace: string; p_tracking_site_id: string; p_name: string };
        Returns: { form_id: string; public_key: string };
      };
      publish_form_version: {
        Args: { p_workspace: string; p_form_id: string; p_pipeline_id: string; p_stage_id: string; p_fields: unknown; p_redirect_url?: string | null };
        Returns: { version_id: string };
      };
      public_submit_form: {
        Args: { p_form_key: string; p_answers: unknown; p_visitor_token?: string | null; p_attribution?: unknown; p_idempotency_key?: string | null };
        Returns: { submission_id: string; lead_id: string | null; redirect_url: string | null; cached?: boolean };
      };
      create_vsl_asset: {
        Args: { p_workspace: string; p_tracking_site_id: string; p_name: string; p_duration: number; p_player_type?: string; p_external_id?: string | null };
        Returns: { asset_id: string; version_id: string; public_key: string };
      };
      start_vsl_session: {
        Args: { p_public_key: string; p_visitor_token?: string | null; p_lead_id?: string | null };
        Returns: { vsl_session_id: string; duration_seconds: number; bin_width_seconds: number };
      };
      record_vsl_heartbeat: {
        Args: { p_vsl_session_id: string; p_intervals: unknown };
        Returns: { unique_seconds_watched: number; completion_percent: number; completed: boolean };
      };
      get_vsl_analytics: {
        Args: { p_workspace: string; p_vsl_asset_id: string };
        Returns: Record<string, unknown>;
      };
      get_lead_vsl_history: {
        Args: { p_workspace: string; p_lead_id: string };
        Returns: Array<{
          session_id: string;
          vsl_name: string;
          duration_seconds: number;
          started_at: string;
          total_unique_seconds_watched: number;
          completion_percent: number;
          completed: boolean;
          intervals: Array<{ start: number; end: number }>;
        }>;
      };
      record_consent_event: {
        Args: {
          p_workspace: string;
          p_policy_version_id: string;
          p_category: string;
          p_state: string;
          p_source: string;
          p_visitor_id?: string | null;
          p_lead_id?: string | null;
          p_form_submission_id?: string | null;
        };
        Returns: { consent_event_id: string };
      };
      get_attribution_analytics: {
        Args: { p_workspace: string };
        Returns: Array<{
          channel: string;
          leads_count: number;
          deals_won: number;
          total_cash_minor: string;
          close_rate: string;
        }>;
      };
      get_attribution_report: {
        Args: { p_workspace: string; p_model?: string };
        Returns: Array<{
          channel: string;
          leads_count: number;
          deals_won: number;
          total_cash_minor: string;
          close_rate: string;
        }>;
      };
      list_tracking_sites: {
        Args: { p_workspace: string };
        Returns: Array<{
          id: string;
          name: string;
          public_key: string;
          allowed_origins: string[];
          is_public_any_origin: boolean;
          status: string;
          created_at: string;
        }>;
      };
      list_forms: {
        Args: { p_workspace: string };
        Returns: Array<{
          id: string;
          name: string;
          public_key: string;
          status: string;
          created_at: string;
          current_version_id: string | null;
          submission_count: number;
          version_count: number;
        }>;
      };
      list_vsl_assets: {
        Args: { p_workspace: string };
        Returns: Array<{
          id: string;
          name: string;
          public_key: string;
          player_type: string;
          status: string;
          created_at: string;
          duration_seconds: number;
          session_count: number;
          completed_count: number;
        }>;
      };
      get_lead_attribution: {
        Args: { p_workspace: string; p_lead_id: string };
        Returns: Array<{
          model: string;
          first_touch_at: string;
          calculated_at: string;
          touch: {
            utm_source: string | null;
            utm_medium: string | null;
            utm_campaign: string | null;
            landing_url: string | null;
            referrer: string | null;
            occurred_at: string;
          };
        }>;
      };
      create_outbound_message: {
        Args: {
          p_workspace: string;
          p_lead_id: string;
          p_channel: string;
          p_recipient_address: string;
          p_text_body?: string | null;
          p_subject?: string | null;
          p_html_body?: string | null;
          p_template_version_id?: string | null;
          p_command_key?: string | null;
          p_channel_account_id?: string | null;
          p_template_variables?: Record<string, unknown> | null;
        };
        Returns: {
          message_id: string;
          conversation_id: string;
          status: string;
          dispatch_status: string;
        };
      };
      ingest_inbound_message: {
        Args: {
          p_workspace: string;
          p_channel: string;
          p_sender_address: string;
          p_recipient_address: string;
          p_text_body: string;
          p_subject?: string | null;
          p_provider_message_id?: string | null;
          p_idempotency_key?: string | null;
          p_occurred_at?: string;
        };
        Returns: {
          message_id?: string;
          conversation_id?: string;
          review_id?: string;
          lead_id?: string;
          status: string;
          duplicate?: boolean;
          reason?: string;
        };
      };
      resolve_inbound_review: {
        Args: {
          p_workspace: string;
          p_review_id: string;
          p_lead_id: string;
          p_resolution_notes?: string | null;
        };
        Returns: {
          review_id: string;
          conversation_id: string;
          message_id: string;
          status: string;
        };
      };
      upsert_channel_account: {
        Args: {
          p_workspace: string;
          p_channel: string;
          p_sender_address: string;
          p_display_name: string;
          p_is_default?: boolean;
        };
        Returns: { id: string; channel: string; sender_address: string };
      };
      create_template: {
        Args: { p_workspace: string; p_name: string; p_channel: string };
        Returns: { id: string; name: string; channel: string };
      };
      publish_template_version: {
        Args: { p_workspace: string; p_template_id: string; p_subject: string | null; p_body: string };
        Returns: { template_id: string; version_id: string; version: number };
      };
      create_campaign: {
        Args: {
          p_workspace: string;
          p_name: string;
          p_channel: string;
          p_template_version_id: string;
          p_audience_filters?: Record<string, unknown>;
          p_batch_size?: number;
        };
        Returns: { id: string; name: string; channel: string; status: string };
      };
      launch_campaign: {
        Args: { p_workspace: string; p_campaign_id: string; p_command_key?: string | null };
        Returns: {
          campaign_id: string;
          total_recipients: number;
          eligible_count: number;
          suppressed_count: number;
          status: string;
        };
      };
      cancel_campaign: {
        Args: { p_workspace: string; p_campaign_id: string };
        Returns: { campaign_id: string; status: string };
      };
      create_sequence: {
        Args: { p_workspace: string; p_name: string; p_description?: string | null };
        Returns: { id: string; name: string; status: string };
      };
      publish_sequence_version: {
        Args: {
          p_workspace: string;
          p_sequence_id: string;
          p_steps: Array<Record<string, unknown>>;
          p_exit_conditions?: string[];
        };
        Returns: { sequence_id: string; version_id: string; version: number };
      };
      enroll_lead_sequence: {
        Args: { p_workspace: string; p_sequence_id: string; p_lead_id: string };
        Returns: { enrollment_id?: string; status: string; reason?: string };
      };
      add_suppression: {
        Args: {
          p_workspace: string;
          p_scope: string;
          p_reason: string;
          p_destination?: string | null;
          p_lead_id?: string | null;
          p_channel?: string | null;
          p_expires_at?: string | null;
        };
        Returns: { suppression_id: string; status: string };
      };
      revoke_suppression: {
        Args: { p_workspace: string; p_suppression_id: string; p_reason?: string | null };
        Returns: { suppression_id: string; status: string };
      };
      list_conversations: {
        Args: { p_workspace: string; p_channel?: string | null; p_status?: string | null };
        Returns: Array<{
          id: string;
          lead_id: string;
          lead_name: string;
          lead_company: string | null;
          channel: "email" | "sms" | "whatsapp";
          destination: string;
          status: "open" | "pending" | "closed" | "archived";
          unread_count: number;
          last_message_at: string;
          last_message_snippet: string | null;
          assigned_to_name: string | null;
        }>;
      };
      get_conversation_messages: {
        Args: { p_workspace: string; p_conversation_id: string; p_limit?: number; p_offset?: number };
        Returns: Array<{
          id: string;
          direction: "inbound" | "outbound";
          channel: "email" | "sms" | "whatsapp";
          sender: string;
          recipient: string;
          subject: string | null;
          text_body: string;
          status: string;
          dispatch_status: string;
          created_at: string;
          author_name: string | null;
        }>;
      };
      list_inbound_reviews: {
        Args: { p_workspace: string };
        Returns: Array<{
          id: string;
          channel: "email" | "sms" | "whatsapp";
          sender_address: string;
          recipient_address: string;
          subject: string | null;
          text_body: string;
          occurred_at: string;
          resolution_state: "pending" | "resolved" | "dismissed";
          resolution_reason: "unmatched_sender" | "ambiguous_identity_conflict" | "missing_channel_account";
          candidate_lead_ids: string[];
        }>;
      };
      list_message_templates: {
        Args: { p_workspace: string };
        Returns: Array<{
          id: string;
          name: string;
          channel: "email" | "sms" | "whatsapp";
          status: "active" | "archived";
          current_version: number | null;
          subject: string | null;
          body: string | null;
          variables_used: string[];
        }>;
      };
      list_campaigns: {
        Args: { p_workspace: string };
        Returns: Array<{
          id: string;
          name: string;
          channel: "email" | "sms" | "whatsapp";
          status: string;
          scheduled_at: string | null;
          started_at: string | null;
          completed_at: string | null;
          recipient_count: number;
          eligible_count: number;
          suppressed_count: number;
        }>;
      };
      list_sequences: {
        Args: { p_workspace: string };
        Returns: Array<{
          id: string;
          name: string;
          description: string | null;
          status: string;
          current_version: number | null;
          exit_conditions: string[];
          step_count: number;
          active_enrollments: number;
        }>;
      };
      list_provider_connections: {
        Args: { p_workspace_id: string };
        Returns: Array<{
          id: string;
          provider: "resend" | "twilio" | "whatsapp" | "calendly" | "meta" | "vsl" | "outbound";
          external_account_id: string;
          connection_state: "not_configured" | "configured" | "verification_required" | "active" | "degraded" | "disabled" | "error";
          capabilities: string[];
          configuration_metadata: Record<string, unknown>;
          health_status: "not_configured" | "active" | "degraded" | "error" | "disabled" | "verification_required";
          last_health_check_at: string | null;
          last_health_check_code: string | null;
          created_at: string;
          updated_at: string;
        }>;
      };
      retry_dispatch_job: {
        Args: { p_workspace_id: string; p_job_id: string };
        Returns: string;
      };
    };
  };
};
