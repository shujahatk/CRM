import Link from "next/link";
import { requireWorkspace } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/server/database/supabase";
import { CreateLeadDialog } from "@/components/leads/create-lead-dialog";
import { Search, Filter, Calendar, ChevronLeft, ChevronRight, Mail, Phone, Building } from "lucide-react";
import type { LeadSummaryRow, StageRow } from "@/server/database/types";

export default async function LeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ query?: string; stage?: string; page?: string }>;
}) {
  const { workspace } = await params;
  const sp = await searchParams;
  await requireWorkspace(workspace);

  const query = sp.query || null;
  const stage = sp.stage || null;
  const pageNumber = Math.max(1, parseInt(sp.page || "1", 10) || 1);
  const pageSize = 25;
  const offset = (pageNumber - 1) * pageSize;

  const client = await createSupabaseServerClient();

  const [leadsRes, stagesRes] = await Promise.all([
    client.rpc("list_leads", {
      p_workspace: workspace,
      p_query: query,
      p_stage: stage,
      p_limit: pageSize,
      p_offset: offset,
    }),
    client.rpc("list_stages", { p_workspace: workspace }),
  ]);

  const leads: LeadSummaryRow[] = leadsRes.data || [];
  const stages: StageRow[] = stagesRes.data || [];
  const totalCount = leads[0]?.total_count ? Number(leads[0].total_count) : 0;
  const totalPages = Math.ceil(totalCount / pageSize) || 1;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#116c58]">Lead Management</p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 mt-1">Leads & Prospects</h1>
          <p className="text-sm text-slate-500 mt-1">
            Server-paginated directory of active leads with identity deduplication.
          </p>
        </div>
        <CreateLeadDialog workspaceId={workspace} />
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
        <form method="get" className="flex flex-1 items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              name="query"
              defaultValue={query || ""}
              placeholder="Search by name, company, email, phone..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50/50 pl-9 pr-3 py-2 text-xs text-slate-900 focus:bg-white focus:border-[#116c58] focus:ring-1 focus:ring-[#116c58] outline-hidden transition"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter size={15} className="text-slate-400" />
            <select
              name="stage"
              defaultValue={stage || ""}
              className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs text-slate-700 focus:bg-white focus:border-[#116c58] outline-hidden transition"
            >
              <option value="">All Stages</option>
              {stages.map((s) => (
                <option key={s.stage_code} value={s.stage_code}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="rounded-lg bg-slate-100 hover:bg-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition"
          >
            Apply
          </button>

          {(query || stage) && (
            <Link
              href={`/${workspace}/leads`}
              className="text-xs text-slate-500 hover:text-rose-600 underline font-medium"
            >
              Reset
            </Link>
          )}
        </form>

        <div className="text-xs text-slate-500 self-center sm:self-auto font-medium">
          {totalCount === 0 ? "No leads found" : `Showing ${offset + 1}–${Math.min(offset + leads.length, totalCount)} of ${totalCount}`}
        </div>
      </div>

      {/* Leads Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3.5">Lead / Contact</th>
                <th className="px-5 py-3.5">Company</th>
                <th className="px-5 py-3.5">Pipeline Stage</th>
                <th className="px-5 py-3.5">Setter / Closer</th>
                <th className="px-5 py-3.5">Next Action</th>
                <th className="px-5 py-3.5 text-right">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {leads.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-sm text-slate-400">
                    No leads match your filter criteria.
                  </td>
                </tr>
              ) : (
                leads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-slate-50/70 transition group">
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/${workspace}/leads/${lead.id}`}
                        className="font-semibold text-slate-900 group-hover:text-[#116c58] transition"
                      >
                        {lead.display_name}
                      </Link>
                      <div className="mt-0.5 flex items-center gap-3 text-[11px] text-slate-500">
                        {lead.email && (
                          <span className="inline-flex items-center gap-1 truncate max-w-[160px]">
                            <Mail size={12} className="text-slate-400" /> {lead.email}
                          </span>
                        )}
                        {lead.phone && (
                          <span className="inline-flex items-center gap-1">
                            <Phone size={12} className="text-slate-400" /> {lead.phone}
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="px-5 py-3.5 font-medium text-slate-600">
                      {lead.company ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Building size={13} className="text-slate-400" /> {lead.company}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>

                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                          lead.stage_category === "won"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : lead.stage_category === "lost"
                            ? "bg-rose-50 text-rose-700 border border-rose-200"
                            : lead.stage_category === "nurture"
                            ? "bg-amber-50 text-amber-700 border border-amber-200"
                            : "bg-[#e8f3ee] text-[#116c58] border border-emerald-100"
                        }`}
                      >
                        {lead.stage_label || "New Lead"}
                      </span>
                    </td>

                    <td className="px-5 py-3.5 text-slate-600">
                      <div className="text-xs">
                        <span className="text-slate-400">S: </span>
                        <span className="font-medium">{lead.setter_name || "Unassigned"}</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        <span className="text-slate-400">C: </span>
                        <span>{lead.closer_name || "Unassigned"}</span>
                      </div>
                    </td>

                    <td className="px-5 py-3.5">
                      {lead.next_action_due ? (
                        <div>
                          <div className="flex items-center gap-1 font-semibold text-slate-800">
                            <Calendar size={12} className="text-slate-400" />
                            {new Date(lead.next_action_due).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })}
                          </div>
                          <p className="text-[11px] text-slate-500 truncate max-w-[180px]">
                            {lead.next_action_title || "Follow-up"}
                          </p>
                        </div>
                      ) : (
                        <span className="text-[11px] font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100">
                          No Next Action
                        </span>
                      )}
                    </td>

                    <td className="px-5 py-3.5 text-right font-mono text-[11px] text-slate-400">
                      {new Date(lead.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/50 px-5 py-3">
            <span className="text-xs text-slate-500">
              Page {pageNumber} of {totalPages}
            </span>
            <div className="flex items-center gap-2">
              {pageNumber > 1 ? (
                <Link
                  href={`/${workspace}/leads?${new URLSearchParams({
                    ...(query ? { query } : {}),
                    ...(stage ? { stage } : {}),
                    page: String(pageNumber - 1),
                  }).toString()}`}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  <ChevronLeft size={14} /> Previous
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-400 cursor-not-allowed">
                  <ChevronLeft size={14} /> Previous
                </span>
              )}

              {pageNumber < totalPages ? (
                <Link
                  href={`/${workspace}/leads?${new URLSearchParams({
                    ...(query ? { query } : {}),
                    ...(stage ? { stage } : {}),
                    page: String(pageNumber + 1),
                  }).toString()}`}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  Next <ChevronRight size={14} />
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-400 cursor-not-allowed">
                  Next <ChevronRight size={14} />
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
