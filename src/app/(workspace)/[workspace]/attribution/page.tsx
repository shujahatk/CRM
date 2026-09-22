import { requireWorkspace } from '@/server/auth/session';
import { createSupabaseServerClient } from '@/server/database/supabase';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ChartNoAxesCombined, Compass, Layers } from 'lucide-react';

interface ChannelRow {
  channel: string;
  leads_count: number;
  deals_won: number;
  close_rate: string;
  total_cash_minor: string;
}

export default async function AttributionPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  if (!z.uuid().safeParse(workspace).success) notFound();
  await requireWorkspace(workspace);
  const client = await createSupabaseServerClient();

  // Query channel performance via database RPC
  const { data: channelData } = await client.rpc('get_attribution_report', {
    p_workspace: workspace,
    p_model: 'first_touch',
  });

  const channels: ChannelRow[] = (channelData as ChannelRow[]) ?? [];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <ChartNoAxesCombined className="w-7 h-7 text-indigo-600" />
            First-Party Attribution
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Deterministic multi-touch attribution with immutable historical touches and derived lead snapshots.
          </p>
        </div>
      </div>

      {/* Model Definitions Banner */}
      <div className="bg-indigo-50/60 border border-indigo-100 rounded-xl p-4 flex items-start gap-3">
        <Compass className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-indigo-950 space-y-1">
          <p className="font-semibold text-indigo-900">Deterministic Attribution Architecture</p>
          <p className="text-indigo-800/90 leading-relaxed">
            <strong>First-Touch:</strong> Immutable initial acquisition source based on session provenance.{' '}
            <strong>Latest-Touch:</strong> Derived current state snapshot updated on recent interactions. All raw
            touches are stored immutably and never overwritten.
          </p>
        </div>
      </div>

      {/* Channel Breakdown Table */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-600" />
            Acquisition Channel Performance
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">Leads and closed revenue attributed to primary sources</p>
        </div>

        <div className="p-6">
          {channels.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500">
                    <th className="pb-3 font-semibold">Channel / UTM Source</th>
                    <th className="pb-3 font-semibold">Leads</th>
                    <th className="pb-3 font-semibold">Deals Won</th>
                    <th className="pb-3 font-semibold">Close Rate</th>
                    <th className="pb-3 font-semibold text-right">Cash Collected</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {channels.map((c, i) => (
                    <tr key={i} className="hover:bg-slate-50/60 transition">
                      <td className="py-3 font-medium text-slate-900">{c.channel}</td>
                      <td className="py-3 text-slate-600">{c.leads_count}</td>
                      <td className="py-3 text-emerald-600 font-medium">{c.deals_won}</td>
                      <td className="py-3 text-slate-600">{c.close_rate}</td>
                      <td className="py-3 text-right font-mono text-slate-900 font-medium">{c.total_cash_minor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-slate-500 text-sm">
              No attributed leads yet. Once form submissions or tracked sessions occur, channel performance will populate.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
