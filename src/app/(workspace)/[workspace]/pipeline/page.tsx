import Link from "next/link";
import { requireWorkspace } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/server/database/supabase";
import { KanbanBoard } from "@/components/pipeline/kanban-board";
import { Users } from "lucide-react";
import type { PipelineBoardStage, LostReasonRow } from "@/server/database/types";

export default async function PipelinePage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  await requireWorkspace(workspace);

  const client = await createSupabaseServerClient();

  const [boardRes, lostReasonsRes] = await Promise.all([
    client.rpc("pipeline_board", { p_workspace: workspace }),
    client.rpc("list_lost_reasons", { p_workspace: workspace }),
  ]);

  const stages: PipelineBoardStage[] = boardRes.data || [];
  const lostReasons: LostReasonRow[] = lostReasonsRes.data || [];

  const totalBoardLeads = stages.reduce((acc, s) => acc + s.leads.length, 0);

  return (
    <div className="space-y-6 max-w-full">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#116c58]">Visual Pipeline</p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 mt-1">Sales Pipeline Board</h1>
          <p className="text-sm text-slate-500 mt-1">
            Authoritative transactional stage transitions across all 13 pipeline stages ({totalBoardLeads} leads active).
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/${workspace}/leads`}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition"
          >
            <Users size={14} /> Leads List View
          </Link>
        </div>
      </div>

      {/* Kanban Board Container */}
      <KanbanBoard
        workspaceId={workspace}
        stages={stages}
        lostReasons={lostReasons}
      />
    </div>
  );
}
