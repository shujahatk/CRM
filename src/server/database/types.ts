import type { MemberRole } from "@/modules/auth/policies";
export type Access = { workspace_id: string; workspace_name: string; membership_id: string; role: MemberRole; is_owner: boolean };
export type Workspace = { id: string; name: string; timezone: string; role: MemberRole; is_owner: boolean };
export type Member = { id: string; user_id: string; role: MemberRole; is_owner: boolean; status: string; version: number };
// Narrow API contract. Validate against generated Supabase types in deployment CI.
export type Database = {
  api: {
    Tables: Record<never, never>; Views: Record<never, never>; Enums: Record<never, never>; CompositeTypes: Record<never, never>;
    Functions: {
      my_access: { Args: Record<never, never>; Returns: Access[] };
      workspace_context: { Args: { p_workspace: string }; Returns: Workspace[] };
      list_members: { Args: { p_workspace: string }; Returns: Member[] };
      set_membership_role: { Args: { p_workspace: string; p_member: string; p_role: MemberRole; p_active: boolean; p_version: number }; Returns: undefined };
      create_team: { Args: { p_workspace: string; p_name: string }; Returns: string };
      set_team_member: { Args: { p_workspace: string; p_team: string; p_member: string; p_manager: boolean }; Returns: undefined };
      issue_invitation: { Args: { p_workspace: string; p_email: string; p_role: MemberRole; p_team?: string }; Returns: string };
      accept_invitation: { Args: { p_token: string }; Returns: string };
      revoke_invitation: { Args: { p_workspace: string; p_invitation: string }; Returns: undefined };
    };
  };
};
