import { requireWorkspace } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/server/database/supabase";
import { TemplatesClient } from "./templates-client";
import type { MessageTemplate } from "@/modules/conversations/types";

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  await requireWorkspace(workspace);

  const client = await createSupabaseServerClient();

  const { data } = await client.rpc("list_message_templates", {
    p_workspace: workspace,
  });

  const templates: MessageTemplate[] = data || [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Message Templates</h1>
          <p className="text-xs text-slate-500 mt-1">
            Immutable, versioned message templates with variable allowlist validation and required-field enforcement.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs bg-emerald-50 text-emerald-700 font-medium px-2.5 py-1 rounded-full border border-emerald-200">
            Strict Allowlist Validation
          </span>
        </div>
      </div>

      <TemplatesClient workspace={workspace} initialTemplates={templates} />
    </div>
  );
}
