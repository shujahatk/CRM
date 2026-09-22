import { requireWorkspace } from '@/server/auth/session';
import { createSupabaseServerClient } from '@/server/database/supabase';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createVslAsset } from '@/modules/vsl/commands';
import { Play, Film, Clock, Users, Plus, AlertCircle } from 'lucide-react';

interface VslAssetRow {
  id: string;
  name: string;
  public_key: string;
  player_type: string;
  status: string;
  created_at: string;
  duration_seconds: number;
  session_count: number;
  completed_count: number;
}

export default async function VslAnalyticsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  if (!z.uuid().safeParse(workspace).success) notFound();
  await requireWorkspace(workspace);
  const client = await createSupabaseServerClient();

  // Fetch tracking sites and VSL assets via RPC
  const [sitesRes, assetsRes] = await Promise.all([
    client.rpc('list_tracking_sites', { p_workspace: workspace }),
    client.rpc('list_vsl_assets', { p_workspace: workspace }),
  ]);

  const sites = sitesRes.data ?? [];
  const assets: VslAssetRow[] = (assetsRes.data as VslAssetRow[]) ?? [];

  const totalSessions = assets.reduce((acc: number, a: VslAssetRow) => acc + (a.session_count ?? 0), 0);
  const totalCompleted = assets.reduce((acc: number, a: VslAssetRow) => acc + (a.completed_count ?? 0), 0);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <Play className="w-7 h-7 text-indigo-600 fill-indigo-600" />
            VSL Analytics & Telemetry
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Continuous watch-interval telemetry, drop-off heatmaps, and observational cohort segmentation.
          </p>
        </div>
      </div>

      {/* Observational Notice (Correction 8) */}
      <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-amber-950 space-y-1">
          <p className="font-semibold text-amber-900">VSL Engagement Segment Performance</p>
          <p className="text-amber-800/90 leading-relaxed">
            Differences between viewer cohorts (e.g., &gt;80% watched vs &lt;20% watched) represent observational
            segmentation. Descriptive correlation reflects viewer interest and intent, but does not claim causal impact.
          </p>
        </div>
      </div>

      {/* Top Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">VSL Assets</span>
            <Film className="w-5 h-5 text-indigo-500" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">{assets.length}</p>
          <p className="text-xs text-slate-500 mt-1">Tracked video assets</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Sessions</span>
            <Users className="w-5 h-5 text-blue-500" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">{totalSessions}</p>
          <p className="text-xs text-slate-500 mt-1">Anonymous & known viewers</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Completion Rate</span>
            <Clock className="w-5 h-5 text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">
            {totalSessions > 0 ? `${Math.round((totalCompleted / totalSessions) * 100)}%` : '—'}
          </p>
          <p className="text-xs text-slate-500 mt-1">Sessions reaching &gt;=95% completion</p>
        </div>
      </div>

      {/* VSL Assets Table */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
              <Film className="w-4 h-4 text-indigo-600" />
              Active VSL Assets
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Authoritative duration from version metadata (Correction 6)</p>
          </div>
        </div>

        <div className="p-6">
          {assets.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500">
                    <th className="pb-3 font-semibold">VSL Name</th>
                    <th className="pb-3 font-semibold">Public Key</th>
                    <th className="pb-3 font-semibold">Player</th>
                    <th className="pb-3 font-semibold">Duration</th>
                    <th className="pb-3 font-semibold">Sessions</th>
                    <th className="pb-3 font-semibold">Completed</th>
                    <th className="pb-3 font-semibold text-right">Telemetry Endpoint</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {assets.map((asset) => {
                    const duration = asset.duration_seconds ?? 0;
                    const sessions = asset.session_count ?? 0;
                    const completed = asset.completed_count ?? 0;

                    return (
                      <tr key={asset.id} className="hover:bg-slate-50/60 transition">
                        <td className="py-3 font-medium text-slate-900">{asset.name}</td>
                        <td className="py-3 font-mono text-xs text-slate-600">{asset.public_key}</td>
                        <td className="py-3 capitalize text-xs text-slate-600">{asset.player_type}</td>
                        <td className="py-3 text-slate-700">
                          {Math.floor(duration / 60)}m {duration % 60}s
                        </td>
                        <td className="py-3 text-slate-600">{sessions}</td>
                        <td className="py-3 text-emerald-600 font-medium">
                          {completed} ({sessions > 0 ? Math.round((completed / sessions) * 100) : 0}%)
                        </td>
                        <td className="py-3 text-right">
                          <span className="text-xs text-indigo-600 font-mono">
                            /api/public/vsl/{asset.public_key}/session
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-slate-500 text-sm">
              No VSL assets created yet. Create an asset to embed video tracking.
            </div>
          )}

          {/* Quick Create VSL Asset */}
          {sites.length > 0 && (
            <form
              action={async (formData: FormData) => {
                'use server';
                const name = formData.get('name') as string;
                const siteId = formData.get('site_id') as string;
                const duration = parseInt(formData.get('duration') as string, 10);
                await createVslAsset({
                  workspace,
                  tracking_site_id: siteId,
                  name,
                  duration_seconds: duration,
                  player_type: 'custom',
                });
              }}
              className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap items-center gap-3"
            >
              <select
                name="site_id"
                required
                className="text-xs px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
              >
                <option value="">Select Tracking Site</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                name="name"
                placeholder="VSL Name (e.g. Core Pitch VSL)"
                required
                className="text-xs px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 flex-1 min-w-[180px]"
              />
              <input
                type="number"
                name="duration"
                placeholder="Duration (sec)"
                required
                min="1"
                className="text-xs px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 w-28"
              />
              <button
                type="submit"
                className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-3 py-1.5 rounded-lg flex items-center gap-1 transition"
              >
                <Plus className="w-3.5 h-3.5" /> Create VSL
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
