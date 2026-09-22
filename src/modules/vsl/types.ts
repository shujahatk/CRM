export interface VslAsset {
  id: string;
  workspace_id: string;
  tracking_site_id: string;
  name: string;
  public_key: string;
  player_type: 'custom' | 'html5' | 'embed';
  external_video_id: string | null;
  current_version_id: string | null;
  status: 'active' | 'archived';
  created_at: string;
  updated_at: string;
}

export interface VslVersion {
  id: string;
  workspace_id: string;
  vsl_asset_id: string;
  version: number;
  duration_seconds: number; // Authoritative for analytics (Correction 6)
  bin_width_seconds: number;
  published_at: string;
}

export interface VslSession {
  id: string;
  workspace_id: string;
  vsl_version_id: string;
  visitor_id: string;
  site_session_id: string;
  lead_id: string | null; // Strict semantics: non-null only if known at session start (Correction 5)
  started_at: string;
  last_heartbeat_at: string;
  total_unique_seconds_watched: number;
  completion_percent: number;
  completed: boolean;
}

export interface LeadVslHistoryItem {
  session_id: string;
  vsl_name: string;
  duration_seconds: number;
  started_at: string;
  total_unique_seconds_watched: number;
  completion_percent: number;
  completed: boolean;
  intervals: Array<{ start: number; end: number }>;
}

export interface VslCohortMetrics {
  cohort_name: string; // Observational segment, e.g. ">80% watched", "<20% watched" (Correction 8)
  lead_count: number;
  close_rate_percent: string;
}
