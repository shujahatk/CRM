"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { transitionStageAction } from "@/modules/pipeline/commands";
import {
  Calendar,
  Building,
  AlertCircle,
  MoveRight,
  User,
} from "lucide-react";
import type { PipelineBoardStage, PipelineBoardLead, LostReasonRow } from "@/server/database/types";

export function KanbanBoard({
  workspaceId,
  stages: initialStages,
  lostReasons,
}: {
  workspaceId: string;
  stages: PipelineBoardStage[];
  lostReasons: LostReasonRow[];
}) {
  const stages = initialStages;
  const [draggedLead, setDraggedLead] = useState<{ leadId: string; currentStageCode: string; version: number } | null>(null);
  const [pendingMove, setPendingMove] = useState<{ leadId: string; currentStageCode: string; version: number; targetStageCode: string } | null>(null);
  const [lostReasonId, setLostReasonId] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const router = useRouter();

  async function executeTransition(leadId: string, currentStageCode: string, targetStageCode: string, version: number, reasonId?: string) {
    setIsUpdating(true);
    setErrorMessage(null);

    const res = await transitionStageAction({
      workspaceId,
      leadId,
      toStageCode: targetStageCode,
      expectedStageCode: currentStageCode,
      lostReasonId: reasonId ?? null,
      version,
    });

    setIsUpdating(false);

    if (res.error) {
      setErrorMessage(res.error);
    } else {
      router.refresh();
    }
  }

  function handleDragStart(e: React.DragEvent, lead: PipelineBoardLead, stageCode: string) {
    setDraggedLead({ leadId: lead.id, currentStageCode: stageCode, version: lead.journey_version });
    e.dataTransfer.setData("application/json", JSON.stringify({ leadId: lead.id, currentStageCode: stageCode, version: lead.journey_version }));
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDrop(e: React.DragEvent, targetStageCode: string) {
    e.preventDefault();
    const data = draggedLead || (e.dataTransfer.getData("application/json") ? JSON.parse(e.dataTransfer.getData("application/json")) : null);
    if (!data) return;

    const { leadId, currentStageCode, version } = data;
    if (currentStageCode === targetStageCode) return;

    if (targetStageCode === "closed_lost") {
      setPendingMove({ leadId, currentStageCode, version, targetStageCode });
      return;
    }

    executeTransition(leadId, currentStageCode, targetStageCode, version);
    setDraggedLead(null);
  }

  function handleSelectMove(lead: PipelineBoardLead, currentStageCode: string, targetStageCode: string) {
    if (targetStageCode === currentStageCode) return;
    if (targetStageCode === "closed_lost") {
      setPendingMove({ leadId: lead.id, currentStageCode, version: lead.journey_version, targetStageCode });
      return;
    }
    executeTransition(lead.id, currentStageCode, targetStageCode, lead.journey_version);
  }

  async function handleConfirmLost() {
    if (!pendingMove || !lostReasonId) {
      setErrorMessage("Please select a lost reason.");
      return;
    }

    await executeTransition(
      pendingMove.leadId,
      pendingMove.currentStageCode,
      pendingMove.targetStageCode,
      pendingMove.version,
      lostReasonId
    );
    setPendingMove(null);
    setLostReasonId("");
  }

  return (
    <div className="space-y-4">
      {errorMessage && (
        <div className="flex items-center gap-2 rounded-xl bg-rose-50 p-3 text-xs text-rose-800 border border-rose-200 shadow-2xs">
          <AlertCircle size={16} className="text-rose-600 shrink-0" />
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage(null)} className="ml-auto text-xs underline font-semibold">
            Dismiss
          </button>
        </div>
      )}

      {/* Kanban Columns Horizontal Container */}
      <div className="flex gap-4 overflow-x-auto pb-6 pt-1 snap-x scrollbar-thin">
        {stages.map((stage) => {
          const isWon = stage.category === "won";
          const isLost = stage.category === "lost";
          const isNurture = stage.category === "nurture";

          return (
            <div
              key={stage.stage_code}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, stage.stage_code)}
              className="flex flex-col w-72 shrink-0 rounded-2xl border border-slate-200/90 bg-slate-100/70 p-3 shadow-2xs transition hover:border-slate-300"
            >
              {/* Column Header */}
              <div className="flex items-center justify-between pb-3 px-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      isWon ? "bg-emerald-500" : isLost ? "bg-rose-500" : isNurture ? "bg-amber-400" : "bg-[#116c58]"
                    }`}
                  />
                  <h3 className="text-xs font-bold text-slate-800 truncate" title={stage.label}>
                    {stage.label}
                  </h3>
                </div>
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-600 shadow-2xs">
                  {stage.leads.length}
                </span>
              </div>

              {/* Cards Container */}
              <div className="flex-1 space-y-2.5 min-h-[360px] max-h-[70vh] overflow-y-auto pr-1">
                {stage.leads.length === 0 ? (
                  <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-slate-200 text-[11px] text-slate-400">
                    Drop leads here
                  </div>
                ) : (
                  stage.leads.map((lead) => (
                    <div
                      key={lead.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, lead, stage.stage_code)}
                      className="group cursor-grab active:cursor-grabbing rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs transition hover:shadow-md hover:border-slate-300"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={`/${workspaceId}/leads/${lead.id}`}
                          className="font-bold text-xs text-slate-900 group-hover:text-[#116c58] transition leading-snug"
                        >
                          {lead.display_name}
                        </Link>
                      </div>

                      {lead.company && (
                        <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
                          <Building size={11} className="text-slate-400" /> {lead.company}
                        </p>
                      )}

                      {(lead.setter_name || lead.closer_name) && (
                        <div className="mt-2 flex items-center gap-1 text-[10px] text-slate-500 bg-slate-50 px-2 py-1 rounded-md">
                          <User size={10} className="text-slate-400" />
                          <span>{lead.setter_name || "No setter"}</span>
                          <span className="text-slate-300">/</span>
                          <span>{lead.closer_name || "No closer"}</span>
                        </div>
                      )}

                      {lead.next_action_due && (
                        <div className="mt-2 flex items-center gap-1 text-[10px] font-medium text-emerald-800 bg-emerald-50/70 px-2 py-0.5 rounded">
                          <Calendar size={10} className="text-[#116c58]" />
                          <span>
                            Due:{" "}
                            {new Date(lead.next_action_due).toLocaleDateString(undefined, {
                              month: "numeric",
                              day: "numeric",
                            })}
                          </span>
                        </div>
                      )}

                      {/* Accessible Stage Move Dropdown (for non-drag users) */}
                      <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                        <span className="text-slate-400 flex items-center gap-1">
                          <MoveRight size={10} /> Move:
                        </span>
                        <select
                          disabled={isUpdating}
                          value={stage.stage_code}
                          onChange={(e) => handleSelectMove(lead, stage.stage_code, e.target.value)}
                          className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 outline-hidden hover:bg-white"
                        >
                          {stages.map((s) => (
                            <option key={s.stage_code} value={s.stage_code}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Closed Lost Reason Modal */}
      {pendingMove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl border border-slate-200">
            <h4 className="text-sm font-bold text-slate-900">Select Lost Reason</h4>
            <p className="text-xs text-slate-500 mt-1">
              Authoritative pipeline integrity requires a lost reason when moving to Closed Lost.
            </p>

            <div className="mt-4">
              <label className="block text-xs font-semibold text-slate-700">Lost Reason</label>
              <select
                value={lostReasonId}
                onChange={(e) => setLostReasonId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 outline-hidden focus:border-[#116c58]"
              >
                <option value="">-- Choose reason --</option>
                {lostReasons.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPendingMove(null);
                  setLostReasonId("");
                }}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isUpdating || !lostReasonId}
                onClick={handleConfirmLost}
                className="rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {isUpdating ? "Saving..." : "Confirm Lost"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
