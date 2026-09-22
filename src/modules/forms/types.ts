export type FieldType = 'text' | 'email' | 'phone' | 'number' | 'select' | 'boolean';

export interface FormFieldDefinition {
  key: string;
  label: string;
  field_type: FieldType;
  is_required?: boolean;
  options?: string[];
  placeholder?: string;
  help_text?: string;
}

export interface TrackingSite {
  id: string;
  workspace_id: string;
  name: string;
  public_key: string;
  allowed_origins: string[];
  is_public_any_origin: boolean;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export interface Form {
  id: string;
  workspace_id: string;
  tracking_site_id: string;
  name: string;
  public_key: string;
  status: 'draft' | 'published' | 'archived';
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FormVersion {
  id: string;
  workspace_id: string;
  form_id: string;
  version: number;
  pipeline_id: string;
  stage_id: string;
  redirect_url: string | null;
  published_by_membership_id: string;
  published_at: string;
  fields?: FormFieldDefinition[];
}

export interface FormSubmissionResult {
  submission_id: string;
  lead_id: string | null;
  redirect_url: string | null;
  cached?: boolean;
}
