"use client";

import { useState } from "react";
import {
  Plus,
  Play,
  XCircle,
  ShieldCheck,
  ShieldX,
  Mail,
  MessageSquare,
} from "lucide-react";
import type { CampaignSummary, MessageTemplate, ChannelType } from "@/modules/conversations/types";
import {
  createCampaign,
  launchCampaign,
  cancelCampaign,
  listCampaigns,
} from "@/modules/campaigns/commands";

interface CampaignsClientProps {
  workspace: string;
  initialCampaigns: CampaignSummary[];
  templates: MessageTemplate[];
}

export function CampaignsClient({
  workspace,
  initialCampaigns,
  templates,
}: CampaignsClientProps) {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>(initialCampaigns);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const [name, setName] = useState("");
  const [channel, setChannel] = useState<ChannelType>("email");
  const [templateVersionId, setTemplateVersionId] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const refreshCampaigns = async () => {
    const res = await listCampaigns(workspace);
    if (res.campaigns) {
      setCampaigns(res.campaigns);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !templateVersionId) return;

    setLoading(true);
    setErrorMsg(null);

    const res = await createCampaign({
      workspace,
      name,
      channel,
      templateVersionId,
    });

    setLoading(false);

    if (res.error) {
      setErrorMsg(res.error);
    } else {
      setShowCreateModal(false);
      setName("");
      refreshCampaigns();
    }
  };

  const handleLaunch = async (campaignId: string) => {
    const res = await launchCampaign({ workspace, campaignId });
    if (res.error) {
      alert(`Launch error: ${res.error}`);
    } else {
      refreshCampaigns();
    }
  };

  const handleCancel = async (campaignId: string) => {
    const res = await cancelCampaign({ workspace, campaignId });
    if (res.error) {
      alert(`Cancel error: ${res.error}`);
    } else {
      refreshCampaigns();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200">
        <div className="text-xs text-slate-500">
          Total Campaigns: <span className="font-semibold text-slate-900">{campaigns.length}</span>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs transition"
        >
          <Plus className="w-4 h-4" /> Create Campaign
        </button>
      </div>

      {/* Campaigns Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50/70 border-b border-slate-200 text-slate-400 font-semibold uppercase text-[10px] tracking-wider">
              <tr>
                <th className="py-3 px-4">Campaign Name</th>
                <th className="py-3 px-4">Channel</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Recipients</th>
                <th className="py-3 px-4">Compliance Breakdown</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {campaigns.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400 text-xs">
                    No campaigns created yet. Click Create Campaign above.
                  </td>
                </tr>
              ) : (
                campaigns.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/50 transition">
                    <td className="py-3 px-4 font-semibold text-slate-900">{c.name}</td>
                    <td className="py-3 px-4">
                      <span className="capitalize inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700">
                        {c.channel === "email" ? (
                          <Mail className="w-3 h-3" />
                        ) : (
                          <MessageSquare className="w-3 h-3" />
                        )}
                        {c.channel}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          c.status === "running"
                            ? "bg-emerald-50 text-emerald-700"
                            : c.status === "completed"
                            ? "bg-blue-50 text-blue-700"
                            : c.status === "cancelled"
                            ? "bg-rose-50 text-rose-700"
                            : "bg-amber-50 text-amber-800"
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-mono">{c.recipient_count}</span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3 text-[11px]">
                        <span className="flex items-center gap-1 text-emerald-700 font-medium">
                          <ShieldCheck className="w-3.5 h-3.5" /> {c.eligible_count} Eligible
                        </span>
                        <span className="flex items-center gap-1 text-rose-700 font-medium">
                          <ShieldX className="w-3.5 h-3.5" /> {c.suppressed_count} Suppressed
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {c.status === "draft" && (
                        <button
                          type="button"
                          onClick={() => handleLaunch(c.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs transition"
                        >
                          <Play className="w-3 h-3" /> Launch
                        </button>
                      )}
                      {c.status === "running" && (
                        <button
                          type="button"
                          onClick={() => handleCancel(c.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold shadow-xs transition"
                        >
                          <XCircle className="w-3 h-3" /> Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Campaign Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <h2 className="text-base font-bold text-slate-900">Create New Campaign</h2>

            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Campaign Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="e.g. Q4 Reactivation"
                  className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Channel</label>
                <select
                  value={channel}
                  onChange={(e) => setChannel(e.target.value as ChannelType)}
                  className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg bg-white"
                >
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                  <option value="whatsapp">WhatsApp</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Published Template</label>
                <select
                  value={templateVersionId}
                  onChange={(e) => setTemplateVersionId(e.target.value)}
                  required
                  className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg bg-white"
                >
                  <option value="">Select Template...</option>
                  {templates
                    .filter((t) => t.channel === channel)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} (v{t.current_version || 1})
                      </option>
                    ))}
                </select>
              </div>

              {errorMsg && <p className="text-xs text-rose-600 font-medium">{errorMsg}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || !name.trim() || !templateVersionId}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition"
                >
                  {loading ? "Creating..." : "Create Campaign"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
