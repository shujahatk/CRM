import { requireWorkspace } from '@/server/auth/session';
import { createSupabaseServerClient } from '@/server/database/supabase';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createTrackingSite, createForm } from '@/modules/forms/commands';
import { FileText, Globe, Plus, CheckCircle2 } from 'lucide-react';

export default async function FormsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  if (!z.uuid().safeParse(workspace).success) notFound();
  await requireWorkspace(workspace);
  const client = await createSupabaseServerClient();

  // Fetch tracking sites & forms via RPC
  const [sitesRes, formsRes] = await Promise.all([
    client.rpc('list_tracking_sites', { p_workspace: workspace }),
    client.rpc('list_forms', { p_workspace: workspace }),
  ]);

  const sites = sitesRes.data ?? [];
  const forms = formsRes.data ?? [];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <FileText className="w-7 h-7 text-indigo-600" />
            Forms & Public Intake
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Build versioned intake forms with first-party attribution tracking, origin isolation, and replay protection.
          </p>
        </div>
      </div>

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Tracking Sites</span>
            <Globe className="w-5 h-5 text-indigo-500" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">{sites.length}</p>
          <p className="text-xs text-slate-500 mt-1">Configured origins & domains</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Forms</span>
            <FileText className="w-5 h-5 text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">
            {forms.filter((f) => f.status === 'published').length}
          </p>
          <p className="text-xs text-slate-500 mt-1">Accepting submissions</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Submissions</span>
            <CheckCircle2 className="w-5 h-5 text-blue-500" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">
            {forms.reduce((acc, f) => acc + (f.submission_count ?? 0), 0)}
          </p>
          <p className="text-xs text-slate-500 mt-1">With immutable attribution touch</p>
        </div>
      </div>

      {/* Tracking Sites Section */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <h2 className="font-semibold text-slate-800 flex items-center gap-2 text-sm">
              <Globe className="w-4 h-4 text-indigo-600" />
              Tracking Sites & Origins
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Origin enforcement blocks unauthorized embeds in production</p>
          </div>
        </div>

        <div className="p-6">
          {sites.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {sites.map((site) => (
                <div key={site.id} className="py-3 flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium text-slate-900">{site.name}</span>
                    <span className="ml-3 font-mono text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                      {site.public_key}
                    </span>
                    <div className="text-xs text-slate-500 mt-1">
                      Allowed Origins:{' '}
                      {site.is_public_any_origin ? (
                        <span className="text-amber-600 font-medium">Public (Any Origin)</span>
                      ) : (
                        site.allowed_origins.join(', ') || 'None'
                      )}
                    </div>
                  </div>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700">
                    Active
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-slate-500 text-sm">
              No tracking sites configured yet. Create a tracking site to bind allowed origins.
            </div>
          )}

          {/* Quick Create Site Form */}
          <form
            action={async (formData: FormData) => {
              'use server';
              const name = formData.get('name') as string;
              const origins = (formData.get('origins') as string)
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
              await createTrackingSite({
                workspace,
                name,
                allowed_origins: origins,
                is_public_any_origin: false,
              });
            }}
            className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap items-center gap-3"
          >
            <input
              type="text"
              name="name"
              placeholder="Site Name (e.g. Marketing Site)"
              required
              className="text-xs px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <input
              type="text"
              name="origins"
              placeholder="Allowed Origins (comma-separated URLs)"
              required
              className="text-xs px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 flex-1 min-w-[200px]"
            />
            <button
              type="submit"
              className="text-xs bg-slate-800 hover:bg-slate-900 text-white font-medium px-3 py-1.5 rounded-lg flex items-center gap-1 transition"
            >
              <Plus className="w-3.5 h-3.5" /> Add Site
            </button>
          </form>
        </div>
      </div>

      {/* Forms Section */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <h2 className="font-semibold text-slate-800 flex items-center gap-2 text-sm">
              <FileText className="w-4 h-4 text-indigo-600" />
              Intake Forms
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Immutable versioned schemas with stage assignment</p>
          </div>
        </div>

        <div className="p-6">
          {forms.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500">
                    <th className="pb-3 font-semibold">Form Name</th>
                    <th className="pb-3 font-semibold">Public Key</th>
                    <th className="pb-3 font-semibold">Status</th>
                    <th className="pb-3 font-semibold">Versions</th>
                    <th className="pb-3 font-semibold">Submissions</th>
                    <th className="pb-3 font-semibold text-right">Endpoint</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {forms.map((form) => (
                    <tr key={form.id} className="hover:bg-slate-50/60 transition">
                      <td className="py-3 font-medium text-slate-900">{form.name}</td>
                      <td className="py-3 font-mono text-xs text-slate-600">{form.public_key}</td>
                      <td className="py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            form.status === 'published'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {form.status}
                        </span>
                      </td>
                      <td className="py-3 text-slate-600">{form.version_count}</td>
                      <td className="py-3 text-slate-600">{form.submission_count}</td>
                      <td className="py-3 text-right">
                        <span className="text-xs text-indigo-600 font-mono">
                          /api/public/forms/{form.public_key}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-6 text-slate-500 text-sm">
              No forms created yet. Create a form and publish a version to begin collecting leads.
            </div>
          )}

          {/* Quick Create Form */}
          {sites.length > 0 && (
            <form
              action={async (formData: FormData) => {
                'use server';
                const name = formData.get('name') as string;
                const siteId = formData.get('site_id') as string;
                await createForm({
                  workspace,
                  tracking_site_id: siteId,
                  name,
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
                placeholder="Form Name (e.g. Free Audit Booking)"
                required
                className="text-xs px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 flex-1 min-w-[200px]"
              />
              <button
                type="submit"
                className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-3 py-1.5 rounded-lg flex items-center gap-1 transition"
              >
                <Plus className="w-3.5 h-3.5" /> Create Form
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
