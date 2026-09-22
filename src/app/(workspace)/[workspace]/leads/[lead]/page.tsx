import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/server/database/supabase";
import { LeadStageControl } from "@/components/leads/lead-stage-control";
import { LeadNotesControl } from "@/components/leads/lead-notes-control";
import { LeadTasksControl } from "@/components/leads/lead-tasks-control";
import { LeadAssignmentControl } from "@/components/leads/lead-assignment-control";
import {
  ArrowLeft,
  Building,
  Mail,
  Phone,
  History,
  Tag,
  CalendarCheck,
  CreditCard,
} from "lucide-react";
import type { LeadDetailData, StageRow, LostReasonRow, Member } from "@/server/database/types";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ workspace: string; lead: string }>;
}) {
  const { workspace, lead: leadId } = await params;
  const context = await requireWorkspace(workspace);

  const client = await createSupabaseServerClient();

  const [leadDetailRes, stagesRes, lostReasonsRes, membersRes] = await Promise.all([
    client.rpc("get_lead_detail", { p_workspace: workspace, p_lead: leadId }),
    client.rpc("list_stages", { p_workspace: workspace }),
    client.rpc("list_lost_reasons", { p_workspace: workspace }),
    client.rpc("list_members", { p_workspace: workspace }),
  ]);

  if (leadDetailRes.error || !leadDetailRes.data) {
    notFound();
  }

  const detail = leadDetailRes.data as LeadDetailData;
  const stages: StageRow[] = stagesRes.data || [];
  const lostReasons: LostReasonRow[] = lostReasonsRes.data || [];
  const members: Member[] = membersRes.data || [];

  const { lead, journey, identities, tags, custom_values, notes, tasks, activities } = detail;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Back link & Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Link
            href={`/${workspace}/leads`}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#116c58] hover:underline"
          >
            <ArrowLeft size={14} /> Back to Leads Directory
          </Link>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
              {lead.display_name}
            </h1>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-mono text-slate-500">
              v{lead.version}
            </span>
          </div>
          {lead.company && (
            <p className="mt-1 flex items-center gap-1 text-sm font-medium text-slate-500">
              <Building size={14} /> {lead.company}
            </p>
          )}
        </div>

        {/* Server-authoritative Stage Switcher */}
        {journey && (
          <div className="flex items-center gap-3">
            <LeadStageControl
              workspaceId={workspace}
              leadId={leadId}
              currentStageCode={journey.stage_code}
              currentVersion={journey.version}
              stages={stages}
              lostReasons={lostReasons}
            />
          </div>
        )}
      </div>

      {/* Main 2-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (5 cols): Identity, Assignment, Custom Data, Phase 3 cards */}
        <div className="lg:col-span-5 space-y-5">
          {/* Identity & Contact Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 pb-3 border-b border-slate-100">
              Contact & Identities
            </h3>

            <div className="mt-4 space-y-3">
              {identities.length === 0 ? (
                <p className="text-xs text-slate-400">No contact identities recorded.</p>
              ) : (
                identities.map((id) => (
                  <div key={id.id} className="flex items-start justify-between text-xs">
                    <div className="flex items-center gap-2">
                      {id.kind === "email" ? (
                        <Mail size={14} className="text-slate-400" />
                      ) : id.kind === "phone" ? (
                        <Phone size={14} className="text-slate-400" />
                      ) : (
                        <span className="text-slate-400">#</span>
                      )}
                      <div>
                        <span className="font-semibold text-slate-900">{id.normalized_value}</span>
                        {id.raw_value && id.raw_value !== id.normalized_value && (
                          <span className="ml-1.5 text-[11px] text-slate-400 font-mono">
                            (raw: {id.raw_value})
                          </span>
                        )}
                      </div>
                    </div>
                    {id.is_primary && (
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-[#116c58] border border-emerald-100">
                        Primary
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Tags */}
            {tags.length > 0 && (
              <div className="mt-4 pt-3 border-t border-slate-100">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <span
                      key={t.id}
                      className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700"
                    >
                      <Tag size={10} /> {t.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Custom Values */}
            {custom_values.length > 0 && (
              <div className="mt-4 pt-3 border-t border-slate-100 space-y-1.5">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Custom Fields</p>
                {custom_values.map((cv) => (
                  <div key={cv.key} className="flex justify-between text-xs">
                    <span className="text-slate-500">{cv.label}:</span>
                    <span className="font-medium text-slate-800">{String(cv.value)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Team Assignment Control */}
          <LeadAssignmentControl
            workspaceId={workspace}
            leadId={leadId}
            setterId={lead.setter_id}
            setterName={lead.setter_name}
            closerId={lead.closer_id}
            closerName={lead.closer_name}
            version={lead.version}
            members={members}
            userRole={context.workspace.role}
          />

          {/* Phase 3 Informational Blocks (Constrained: strictly non-fabricated) */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4 opacity-75">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <CalendarCheck size={16} className="text-slate-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Calendar & Meetings</h3>
              </div>
              <span className="text-[10px] font-mono font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                Phase 3
              </span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Live Calendly integration and scheduled meeting bookings will connect here in Phase 3. No mock records fabricated.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4 opacity-75">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <CreditCard size={16} className="text-slate-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Deals & Checkout</h3>
              </div>
              <span className="text-[10px] font-mono font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                Phase 3
              </span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Stripe checkout session creation, revenue contracts, and deal ledgers will connect here in Phase 3.
            </p>
          </div>
        </div>

        {/* Right Column (7 cols): Notes, Tasks, Activity Audit Trail */}
        <div className="lg:col-span-7 space-y-6">
          {/* Notes Section */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <LeadNotesControl workspaceId={workspace} leadId={leadId} notes={notes} />
          </div>

          {/* Tasks Section */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <LeadTasksControl workspaceId={workspace} leadId={leadId} tasks={tasks} members={members} />
          </div>

          {/* Activity Timeline (Immutable audit trail) */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
              <History size={16} className="text-[#116c58]" />
              <h3 className="text-sm font-bold text-slate-900">Activity & Audit Timeline</h3>
            </div>

            <div className="mt-4 space-y-3">
              {activities.length === 0 ? (
                <p className="py-4 text-center text-xs text-slate-400">No activity logged.</p>
              ) : (
                activities.map((act) => (
                  <div key={act.id} className="relative pl-5 border-l-2 border-slate-200 text-xs py-1">
                    <div className="absolute -left-[5px] top-2 h-2 w-2 rounded-full bg-[#116c58]" />
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-800 font-mono text-[11px]">
                        {act.event_type}
                      </span>
                      <span className="text-[11px] text-slate-400 font-mono">
                        {new Date(act.occurred_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-0.5 text-slate-500 text-[11px]">
                      By {act.actor_name || "System"} &bull; {JSON.stringify(act.payload)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
