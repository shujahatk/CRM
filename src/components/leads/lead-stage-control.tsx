"use client";

import { useState } from "react";
import { transitionStageAction } from "@/modules/pipeline/commands";
import type { StageRow, LostReasonRow } from "@/server/database/types";

export function LeadStageControl({
  workspaceId,
  leadId,
  currentStageCode,
  currentVersion,
  stages,
  lostReasons,
}: {
  workspaceId: string;
  leadId: string;
  currentStageCode: string;
  currentVersion: number;
  stages: StageRow[];
  lostReasons: LostReasonRow[];
}) {
  const [selectedStage, setSelectedStage] = useState(currentStageCode);
  const [lostReasonId, setLostReasonId] = useState<string>("");
  const [showLostModal, setShowLostModal] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleStageChange(targetCode: string) {
    if (targetCode === currentStageCode) return;
    setErrorMessage(null);

    if (targetCode === "closed_lost") {
      setSelectedStage(targetCode);
      setShowLostModal(true);
      return;
    }

    setIsPending(true);
    const res = await transitionStageAction({
      workspaceId,
      leadId,
      toStageCode: targetCode,
      expectedStageCode: currentStageCode,
      version: currentVersion,
    });
    setIsPending(false);

    if (res.error) {
      setErrorMessage(res.error);
      setSelectedStage(currentStageCode);
    } else {
      setSelectedStage(targetCode);
    }
  }

  async function handleLostConfirm() {
    if (!lostReasonId) {
      setErrorMessage("Please select a lost reason.");
      return;
    }

    setIsPending(true);
    const res = await transitionStageAction({
      workspaceId,
      leadId,
      toStageCode: "closed_lost",
      lostReasonId,
      expectedStageCode: currentStageCode,
      version: currentVersion,
    });
    setIsPending(false);

    if (res.error) {
      setErrorMessage(res.error);
      setSelectedStage(currentStageCode);
    } else {
      setShowLostModal(false);
    }
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <label htmlFor="stage-select" className="text-xs font-semibold text-slate-500">
          Stage:
        </label>
        <select
          id="stage-select"
          disabled={isPending}
          value={selectedStage}
          onChange={(e) => handleStageChange(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-2xs hover:border-slate-400 focus:border-[#116c58] focus:ring-1 focus:ring-[#116c58] outline-hidden cursor-pointer"
        >
          {stages.map((s) => (
            <option key={s.stage_code} value={s.stage_code}>
              {s.label}
            </option>
          ))}
        </select>
        {isPending && <span className="text-[11px] text-slate-400 animate-pulse">Updating...</span>}
      </div>

      {errorMessage && (
        <p className="absolute top-full right-0 mt-1 text-[11px] font-medium text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 whitespace-nowrap z-10">
          {errorMessage}
        </p>
      )}

      {/* Closed Lost Reason Modal */}
      {showLostModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl border border-slate-200">
            <h4 className="text-sm font-bold text-slate-900">Select Lost Reason</h4>
            <p className="text-xs text-slate-500 mt-1">
              Authoritative pipeline integrity requires a lost reason when moving to Closed Lost.
            </p>

            <div className="mt-4">
              <label className="block text-xs font-medium text-slate-700">Reason</label>
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
                  setShowLostModal(false);
                  setSelectedStage(currentStageCode);
                }}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isPending || !lostReasonId}
                onClick={handleLostConfirm}
                className="rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {isPending ? "Saving..." : "Confirm Lost"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
