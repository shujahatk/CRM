import Link from "next/link";
import { requireWorkspace } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/server/database/supabase";
import { TasksListClient } from "@/components/tasks/tasks-list-client";
import type { TaskRow } from "@/server/database/types";

const filters = [
  { id: "today", label: "Due Today" },
  { id: "upcoming", label: "Upcoming" },
  { id: "overdue", label: "Overdue" },
  { id: "completed", label: "Completed" },
  { id: "all", label: "All Tasks" },
] as const;

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { workspace } = await params;
  const sp = await searchParams;
  await requireWorkspace(workspace);

  const activeFilter = sp.filter || "today";
  const client = await createSupabaseServerClient();

  const { data: tasksList } = await client.rpc("list_tasks", {
    p_workspace: workspace,
    p_filter: activeFilter,
    p_limit: 50,
    p_offset: 0,
  });

  const tasks: TaskRow[] = tasksList || [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#116c58]">Sales Execution</p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 mt-1">
            Tasks & Follow-Ups
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Track daily cadence, phone callbacks, proposals, and required next actions.
          </p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 border-b border-slate-200 pb-2">
        {filters.map((f) => {
          const isActive = activeFilter === f.id;
          return (
            <Link
              key={f.id}
              href={`/${workspace}/tasks?filter=${f.id}`}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                isActive
                  ? "bg-[#116c58] text-white shadow-2xs"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {/* Task List */}
      <TasksListClient workspaceId={workspace} tasks={tasks} />
    </div>
  );
}
