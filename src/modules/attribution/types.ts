export type TouchType = 'pageview' | 'form_submission' | 'vsl_watch' | 'ad_click';

export interface AttributionTouch {
  id: string;
  workspace_id: string;
  visitor_id: string;
  site_session_id: string;
  lead_id: string | null;
  form_submission_id: string | null;
  touch_type: TouchType;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  external_campaign_id: string | null;
  external_adset_id: string | null;
  external_ad_id: string | null;
  external_creative_id: string | null;
  landing_url: string | null;
  referrer: string | null;
  occurred_at: string;
}

export interface LeadAttributionSnapshot {
  id: string;
  workspace_id: string;
  lead_id: string;
  model: 'first_touch' | 'latest_touch';
  attribution_touch_id: string;
  first_touch_at: string;
  calculated_at: string;
}

export interface ConsentEvent {
  id: string;
  workspace_id: string;
  visitor_id: string | null;
  site_session_id: string | null;
  lead_id: string | null;
  form_submission_id: string | null;
  consent_policy_version_id: string;
  consent_category: 'analytics' | 'marketing' | 'essential';
  state: 'granted' | 'denied' | 'withdrawn';
  source: 'cookie_banner' | 'form_checkbox' | 'api' | 'user_profile';
  ip_country_code: string | null;
  occurred_at: string;
}

export interface ChannelPerformance {
  channel: string;
  leads_count: number;
  deals_won: number;
  total_cash_minor: string;
  close_rate: string;
}
