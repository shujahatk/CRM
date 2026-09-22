import { requireWorkspace } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/server/database/supabase";
import { SequencesClient } from "./sequences-client";
import type { SequenceSummary } from "@/modules/sequences/types";
import type { MessageTemplate } from "@/modules/conversations/types";

export default async function SequencesPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  await requireWorkspace(workspace);

  const client = await createSupabaseServerClient();

  const [sequencesRes, templatesRes] = await Promise.all([
    client.rpc("list_sequences", { p_workspace: workspace }),
    client.rpc("list_message_templates", { p_workspace: workspace }),
  ]);

  const sequences: SequenceSummary[] = sequencesRes.data || [];
  const templates: MessageTemplate[] = templatesRes.data || [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Sequences & Drips</h1>
          <p className="text-xs text-slate-500 mt-1">
            Automated multi-step communication flows with authoritative exit condition evaluation and JIT consent checks.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs bg-indigo-50 text-indigo-700 font-medium px-2.5 py-1 rounded-full border border-indigo-200">
            Authoritative Sales Outcome Exits
          </span>
        </div>
      </div>

      <SequencesClient
        workspace={workspace}
        initialSequences={sequences}
        templates={templates}
      />
    </div>
  );
}
