import { ReportView } from '@/components/sales/report-view';
import { databaseError } from '@/server/errors';
import Link from "next/link";
import { requireWorkspace } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/server/database/supabase";
import { Users, UserPlus, UserX, Clock, AlertTriangle, ArrowRight, Columns3 } from "lucide-react";
import type { DashboardMetrics } from "@/server/database/types";

export default async function DashboardPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const context = await requireWorkspace(workspace);

  const client = await createSupabaseServerClient();
  const { data: metricsList, error: metricsError } = await client.rpc("dashboard_metrics", { p_workspace: workspace });
  if (metricsError) throw databaseError(metricsError.code);
  const today = new Intl.DateTimeFormat('en-CA', {timeZone:context.workspace.timezone}).format(new Date());
  const sales = await client.rpc('sales_report', {p_workspace:workspace,p_from:today,p_to:today});
  if (sales.error) throw databaseError(sales.error.code);
  const metrics: DashboardMetrics = metricsList?.[0] || {
    total_active_leads: 0,
    new_leads_7d: 0,
    unassigned_leads: 0,
    tasks_due_today: 0,
    tasks_overdue: 0,
    leads_no_next_action: 0,
    stage_distribution: [],
  };

  const stages = metrics.stage_distribution || [];
  const maxStageCount = Math.max(...stages.map((s) => s.count), 1);

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#116c58]">Sales Intelligence</p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 mt-1">Lead & Pipeline Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">Truthful real-time metrics powered by transactional database projections.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/${workspace}/leads`}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 transition"
          >
            <Users size={16} /> All Leads
          </Link>
          <Link
            href={`/${workspace}/pipeline`}
            className="inline-flex items-center gap-2 rounded-lg bg-[#116c58] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#0e5847] transition"
          >
            <Columns3 size={16} /> Pipeline Board
          </Link>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Active Leads</span>
            <div className="rounded-xl bg-emerald-50 p-2.5 text-[#116c58]">
              <Users size={20} />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900">{metrics.total_active_leads}</span>
            <span className="text-xs text-slate-500">leads in funnel</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">All non-archived leads currently in sales workflows.</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">New (7 Days)</span>
            <div className="rounded-xl bg-blue-50 p-2.5 text-blue-600">
              <UserPlus size={20} />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900">{metrics.new_leads_7d}</span>
            <span className="text-xs text-slate-500">fresh prospects</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">Leads created within the last 7 calendar days.</p>
        </div>

        <div className={`rounded-2xl border bg-white p-5 shadow-xs transition hover:shadow-md ${
          metrics.unassigned_leads > 0 ? "border-amber-200" : "border-slate-200"
        }`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Unassigned Leads</span>
            <div className={`rounded-xl p-2.5 ${metrics.unassigned_leads > 0 ? "bg-amber-50 text-amber-600" : "bg-slate-50 text-slate-400"}`}>
              <UserX size={20} />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className={`text-3xl font-extrabold ${metrics.unassigned_leads > 0 ? "text-amber-700" : "text-slate-900"}`}>
              {metrics.unassigned_leads}
            </span>
            <span className="text-xs text-slate-500">require setter/closer</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">Leads with no assigned setter or closer.</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Tasks Due Today</span>
            <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600">
              <Clock size={20} />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900">{metrics.tasks_due_today}</span>
            <span className="text-xs text-slate-500">actions pending</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">Action items scheduled for today.</p>
        </div>

        <div className={`rounded-2xl border bg-white p-5 shadow-xs transition hover:shadow-md ${
          metrics.tasks_overdue > 0 ? "border-rose-200" : "border-slate-200"
        }`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Overdue Tasks</span>
            <div className={`rounded-xl p-2.5 ${metrics.tasks_overdue > 0 ? "bg-rose-50 text-rose-600" : "bg-slate-50 text-slate-400"}`}>
              <AlertTriangle size={20} />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className={`text-3xl font-extrabold ${metrics.tasks_overdue > 0 ? "text-rose-600" : "text-slate-900"}`}>
              {metrics.tasks_overdue}
            </span>
            <span className="text-xs text-slate-500">past due date</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">Incomplete actions with a past due date.</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">No Next Action</span>
            <div className="rounded-xl bg-amber-50 p-2.5 text-amber-600">
              <Clock size={20} />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900">{metrics.leads_no_next_action}</span>
            <span className="text-xs text-slate-500">leads at risk</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">Active leads with no open scheduled tasks.</p>
        </div>
      </div>

      <section className="space-y-4"><h2 className="text-lg font-semibold">Sales today</h2><ReportView report={sales.data} workspace={workspace} compact/></section>
      {/* Stage Distribution Section */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Pipeline Stage Distribution</h2>
            <p className="text-xs text-slate-500">Live lead distribution across all 13 authoritative sales pipeline stages.</p>
          </div>
          <Link
            href={`/${workspace}/pipeline`}
            className="text-xs font-semibold text-[#116c58] hover:underline flex items-center gap-1"
          >
            Open Kanban Board <ArrowRight size={14} />
          </Link>
        </div>

        <div className="space-y-3">
          {stages.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">No active stages found.</p>
          ) : (
            stages.map((stage) => {
              const pct = Math.round((stage.count / maxStageCount) * 100);
              return (
                <div key={stage.stage_code} className="flex items-center gap-4 text-xs">
                  <span className="w-36 font-medium text-slate-700 truncate">{stage.label}</span>
                  <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        stage.category === "won"
                          ? "bg-emerald-500"
                          : stage.category === "lost"
                          ? "bg-rose-400"
                          : stage.category === "nurture"
                          ? "bg-amber-400"
                          : "bg-[#116c58]"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-10 text-right font-semibold text-slate-700">{stage.count}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
