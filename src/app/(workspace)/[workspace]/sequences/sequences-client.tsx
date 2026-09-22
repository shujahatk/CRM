"use client";

import { useState } from "react";
import {
  GitFork,
  Plus,
  Users,
  AlertCircle,
  ShieldCheck,
} from "lucide-react";
import type { SequenceSummary, ExitCondition } from "@/modules/sequences/types";
import type { MessageTemplate } from "@/modules/conversations/types";
import {
  createSequence,
  publishSequenceVersion,
  enrollLeadSequence,
  listSequences,
} from "@/modules/sequences/commands";

interface SequencesClientProps {
  workspace: string;
  initialSequences: SequenceSummary[];
  templates: MessageTemplate[];
}

interface StepDraft {
  step_number: number;
  delay_seconds: number;
  channel: string;
  template_version_id: string;
}

export function SequencesClient({
  workspace,
  initialSequences,
  templates,
}: SequencesClientProps) {
  const [sequences, setSequences] = useState<SequenceSummary[]>(initialSequences);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedSequence, setSelectedSequence] = useState<SequenceSummary | null>(null);
  const [showEnrollModal, setShowEnrollModal] = useState<SequenceSummary | null>(null);

  // Create Sequence form
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Publish Version form
  const [steps, setSteps] = useState<StepDraft[]>([
    {
      step_number: 1,
      delay_seconds: 0,
      channel: "email",
      template_version_id: "",
    },
  ]);
  const [exitConditions, setExitConditions] = useState<ExitCondition[]>([
    "reply_received",
    "meeting_booked",
    "closed_won",
    "closed_lost",
    "dnc",
  ]);
  const [publishLoading, setPublishLoading] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  // Enroll Lead form
  const [enrollLeadId, setEnrollLeadId] = useState("");
  const [enrollLoading, setEnrollLoading] = useState(false);
  const [enrollResult, setEnrollResult] = useState<{ status: string; reason?: string } | null>(null);

  const refreshSequences = async () => {
    const res = await listSequences(workspace);
    if (res.sequences) {
      setSequences(res.sequences);
    }
  };

  const handleCreateSequence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setCreateLoading(true);
    setCreateError(null);

    const res = await createSequence({
      workspace,
      name: name.trim(),
      description: description.trim() || undefined,
    });

    setCreateLoading(false);

    if (res.error) {
      setCreateError(res.error);
    } else {
      setShowCreateModal(false);
      setName("");
      setDescription("");
      refreshSequences();
    }
  };

  const openPublishModal = (seq: SequenceSummary) => {
    setSelectedSequence(seq);
    // Initialize with 1 default step if none
    const firstPublished = templates.find((t) => t.active_version_id !== null);
    setSteps([
      {
        step_number: 1,
        delay_seconds: 0,
        channel: firstPublished ? firstPublished.channel : "email",
        template_version_id: firstPublished?.active_version_id || "",
      },
    ]);
    setPublishError(null);
  };

  const addStep = () => {
    const firstPublished = templates.find((t) => t.active_version_id !== null);
    setSteps((prev) => [
      ...prev,
      {
        step_number: prev.length + 1,
        delay_seconds: 86400, // 1 day
        channel: firstPublished ? firstPublished.channel : "email",
        template_version_id: firstPublished?.active_version_id || "",
      },
    ]);
  };

  const removeStep = (index: number) => {
    setSteps((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.map((s, idx) => ({ ...s, step_number: idx + 1 }));
    });
  };

  const updateStep = (index: number, patch: Partial<StepDraft>) => {
    setSteps((prev) =>
      prev.map((s, i) => {
        if (i !== index) return s;
        const updated = { ...s, ...patch };
        if (patch.template_version_id) {
          const t = templates.find((tmpl) => tmpl.active_version_id === patch.template_version_id);
          if (t) updated.channel = t.channel;
        }
        return updated;
      })
    );
  };

  const handlePublishVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSequence) return;

    for (const step of steps) {
      if (!step.template_version_id) {
        setPublishError(`Step ${step.step_number} requires a published template version.`);
        return;
      }
    }

    setPublishLoading(true);
    setPublishError(null);

    const res = await publishSequenceVersion({
      workspace,
      sequenceId: selectedSequence.id,
      steps,
      exitConditions,
    });

    setPublishLoading(false);

    if (res.error) {
      setPublishError(res.error);
    } else {
      setSelectedSequence(null);
      refreshSequences();
    }
  };

  const handleEnrollLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showEnrollModal || !enrollLeadId.trim()) return;

    setEnrollLoading(true);
    setEnrollResult(null);

    const res = await enrollLeadSequence({
      workspace,
      sequenceId: showEnrollModal.id,
      leadId: enrollLeadId.trim(),
    });

    setEnrollLoading(false);

    if (res.error) {
      setEnrollResult({ status: "error", reason: res.error });
    } else {
      setEnrollResult({
        status: res.status || "active",
        reason: res.reason,
      });
      refreshSequences();
    }
  };

  const publishedTemplates = templates.filter((t) => t.active_version_id !== null);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200">
        <div className="text-xs text-slate-500">
          Total Sequences: <span className="font-semibold text-slate-900">{sequences.length}</span>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 bg-[#116c58] hover:bg-[#0e5646] text-white text-xs font-semibold px-3.5 py-2 rounded-xl transition shadow-sm"
        >
          <Plus size={16} /> New Sequence
        </button>
      </div>

      {sequences.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <GitFork className="mx-auto h-12 w-12 text-slate-300" />
          <h3 className="mt-2 text-sm font-semibold text-slate-900">No communication sequences</h3>
          <p className="mt-1 text-xs text-slate-500">
            Build multi-step automated drips with authoritative stage exit conditions.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sequences.map((seq) => (
            <div
              key={seq.id}
              className="bg-white rounded-2xl border border-slate-200 p-5 hover:border-slate-300 hover:shadow-sm transition flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded capitalize ${
                      seq.status === "active"
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {seq.status}
                  </span>
                  {seq.current_version ?? seq.active_version ? (
                    <span className="text-[11px] font-mono font-medium text-slate-500">
                      v{seq.current_version ?? seq.active_version}
                    </span>
                  ) : (
                    <span className="text-[11px] text-amber-600 font-medium">Draft</span>
                  )}
                </div>

                <div>
                  <h3 className="font-semibold text-slate-900 text-sm">{seq.name}</h3>
                  {seq.description && (
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">{seq.description}</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded-xl border border-slate-100 text-center">
                  <div>
                    <span className="text-xs text-slate-500 block">Steps</span>
                    <span className="text-base font-bold text-slate-900">
                      {seq.step_count ?? seq.steps_count ?? 0}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 block">Enrollments</span>
                    <span className="text-base font-bold text-slate-900">
                      {seq.active_enrollments ?? seq.enrollments_count ?? 0}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                <button
                  onClick={() => openPublishModal(seq)}
                  className="text-xs font-medium text-[#116c58] hover:text-[#0e5646] hover:underline"
                >
                  Configure Steps
                </button>

                {(seq.current_version ?? seq.active_version) && (
                  <button
                    onClick={() => {
                      setShowEnrollModal(seq);
                      setEnrollResult(null);
                      setEnrollLeadId("");
                    }}
                    className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded-lg transition"
                  >
                    <Users size={12} /> Enroll Lead
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Sequence Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-900">Create Sequence</h2>
            <form onSubmit={handleCreateSequence} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Sequence Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Inbound Demo Nurture (5-Day)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#116c58]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Description (optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Exit immediately on reply, meeting booking, or sale."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#116c58]"
                />
              </div>

              {createError && (
                <div className="flex items-center gap-2 text-xs text-rose-600 bg-rose-50 p-2.5 rounded-lg border border-rose-200">
                  <AlertCircle size={15} />
                  <span>{createError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="text-xs font-medium px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createLoading}
                  className="text-xs font-semibold px-4 py-2 bg-[#116c58] text-white rounded-lg hover:bg-[#0e5646] disabled:opacity-50"
                >
                  {createLoading ? "Creating..." : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Configure Steps & Publish Version Modal */}
      {selectedSequence && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-2xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Configure Steps: {selectedSequence.name}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Publishing creates an immutable sequence version. Existing enrollments maintain version integrity.
              </p>
            </div>

            <form onSubmit={handlePublishVersion} className="space-y-4">
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-700">Sequence Steps</span>
                  <button
                    type="button"
                    onClick={addStep}
                    className="text-xs text-[#116c58] hover:underline font-semibold flex items-center gap-1"
                  >
                    <Plus size={14} /> Add Step
                  </button>
                </div>

                {steps.map((step, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-bold text-slate-800">
                        Step {step.step_number}
                      </span>
                      {steps.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeStep(idx)}
                          className="text-[11px] text-rose-600 hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] text-slate-500 mb-0.5">
                          Delay (Seconds from enrollment / previous step)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={step.delay_seconds}
                          onChange={(e) =>
                            updateStep(idx, { delay_seconds: parseInt(e.target.value) || 0 })
                          }
                          className="w-full text-xs px-2.5 py-1.5 border border-slate-200 rounded bg-white"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] text-slate-500 mb-0.5">
                          Template Version
                        </label>
                        <select
                          value={step.template_version_id}
                          onChange={(e) =>
                            updateStep(idx, { template_version_id: e.target.value })
                          }
                          className="w-full text-xs px-2.5 py-1.5 border border-slate-200 rounded bg-white"
                        >
                          <option value="">Select published template...</option>
                          {publishedTemplates.map((t) => (
                            <option key={t.active_version_id} value={t.active_version_id || ""}>
                              [{t.channel.toUpperCase()}] {t.name} (v{t.active_version})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Exit conditions checklist */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-[#116c58]" /> Authoritative Exit Conditions
                </span>
                <p className="text-[11px] text-slate-500">
                  Workers evaluate authoritative outcomes (Phase 3 meetings/deals/attendance) prior to dispatching each step.
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {(
                    [
                      ["reply_received", "Inbound Reply Received"],
                      ["meeting_booked", "Meeting Booked / Confirmed"],
                      ["showed", "Meeting Attended (Showed)"],
                      ["closed_won", "Deal Closed Won"],
                      ["closed_lost", "Deal Closed Lost"],
                      ["dnc", "DNC / Suppression Active"],
                    ] as const
                  ).map(([cond, label]) => {
                    const isChecked = exitConditions.includes(cond);
                    return (
                      <label key={cond} className="flex items-center gap-2 text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setExitConditions((prev) => [...prev, cond]);
                            } else {
                              setExitConditions((prev) => prev.filter((c) => c !== cond));
                            }
                          }}
                          className="rounded text-[#116c58] focus:ring-0"
                        />
                        <span>{label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {publishError && (
                <div className="flex items-center gap-2 text-xs text-rose-600 bg-rose-50 p-2.5 rounded-lg border border-rose-200">
                  <AlertCircle size={15} />
                  <span>{publishError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedSequence(null)}
                  className="text-xs font-medium px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={publishLoading}
                  className="text-xs font-semibold px-4 py-2 bg-[#116c58] text-white rounded-lg hover:bg-[#0e5646] disabled:opacity-50"
                >
                  {publishLoading ? "Publishing..." : "Publish Immutable Sequence Version"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Enroll Lead Modal */}
      {showEnrollModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-900">
              Enroll Lead into: {showEnrollModal.name}
            </h2>
            <form onSubmit={handleEnrollLead} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Lead UUID
                </label>
                <input
                  type="text"
                  required
                  placeholder="Paste Lead UUID here..."
                  value={enrollLeadId}
                  onChange={(e) => setEnrollLeadId(e.target.value)}
                  className="w-full text-xs font-mono px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#116c58]"
                />
              </div>

              {enrollResult && (
                <div
                  className={`p-3 rounded-lg text-xs border ${
                    enrollResult.status === "active"
                      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                      : "bg-amber-50 text-amber-800 border-amber-200"
                  }`}
                >
                  <span className="font-bold capitalize">{enrollResult.status}: </span>
                  {enrollResult.reason || "Enrolled successfully into sequence."}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEnrollModal(null)}
                  className="text-xs font-medium px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={enrollLoading}
                  className="text-xs font-semibold px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50"
                >
                  {enrollLoading ? "Enrolling..." : "Enroll Lead"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
