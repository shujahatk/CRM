import { requireWorkspace } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/server/database/supabase";
import { CampaignsClient } from "./campaigns-client";
import type { CampaignSummary, MessageTemplate } from "@/modules/conversations/types";

export default async function CampaignsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  await requireWorkspace(workspace);

  const client = await createSupabaseServerClient();

  const [campaignsRes, templatesRes] = await Promise.all([
    client.rpc("list_campaigns", { p_workspace: workspace }),
    client.rpc("list_message_templates", { p_workspace: workspace }),
  ]);

  const campaigns: CampaignSummary[] = campaignsRes.data || [];
  const templates: MessageTemplate[] = templatesRes.data || [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Campaign Orchestration</h1>
          <p className="text-xs text-slate-500 mt-1">
            Dynamic audience evaluation with transactional frozen recipient materialization and JIT suppression.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs bg-indigo-50 text-indigo-700 font-medium px-2.5 py-1 rounded-full border border-indigo-200">
            Frozen Audiences & DNC Audit
          </span>
        </div>
      </div>

      <CampaignsClient
        workspace={workspace}
        initialCampaigns={campaigns}
        templates={templates}
      />
    </div>
  );
}
