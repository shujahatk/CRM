"use client";

import { useState } from "react";
import { UserCheck, Edit2, AlertCircle } from "lucide-react";
import { assignLeadAction } from "@/modules/lead/commands";
import type { Member } from "@/server/database/types";

export function LeadAssignmentControl({
  workspaceId,
  leadId,
  setterId,
  setterName,
  closerId,
  closerName,
  version,
  members,
  userRole,
}: {
  workspaceId: string;
  leadId: string;
  setterId: string | null;
  setterName: string | null;
  closerId: string | null;
  closerName: string | null;
  version: number;
  members: Member[];
  userRole: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const canAssign = userRole === "admin" || userRole === "manager";

  async function handleAssign(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsPending(true);
    setErrorMessage(null);

    const formData = new FormData(e.currentTarget);
    formData.set("workspaceId", workspaceId);
    formData.set("leadId", leadId);
    formData.set("version", String(version));

    const res = await assignLeadAction(null, formData);
    setIsPending(false);

    if (res.error) {
      setErrorMessage(res.error);
    } else {
      setIsOpen(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <UserCheck size={16} className="text-[#116c58]" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Team Assignment</h3>
        </div>
        {canAssign && (
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 transition"
          >
            <Edit2 size={12} /> Reassign
          </button>
        )}
      </div>

      {errorMessage && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-rose-50 p-2 text-xs text-rose-700 border border-rose-200">
          <AlertCircle size={14} className="shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="mt-3 space-y-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-slate-500">Assigned Setter:</span>
          <span className="font-semibold text-slate-900">{setterName || "Unassigned"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-500">Assigned Closer:</span>
          <span className="font-semibold text-slate-900">{closerName || "Unassigned"}</span>
        </div>
      </div>

      {isOpen && (
        <form onSubmit={handleAssign} className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3 text-xs">
          <div>
            <label className="block font-semibold text-slate-700">Setter</label>
            <select
              name="setterId"
              defaultValue={setterId || ""}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-hidden focus:border-[#116c58]"
            >
              <option value="">-- None --</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.role} ({m.id.slice(0, 8)})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-700">Closer</label>
            <select
              name="closerId"
              defaultValue={closerId || ""}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-hidden focus:border-[#116c58]"
            >
              <option value="">-- None --</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.role} ({m.id.slice(0, 8)})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-700">Reason for Reassignment</label>
            <input
              type="text"
              name="reason"
              placeholder="e.g. Territory realignment, setter out of office"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-hidden focus:border-[#116c58]"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-md px-2.5 py-1 text-slate-600 hover:bg-slate-200 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-[#116c58] px-3 py-1 font-semibold text-white hover:bg-[#0e5847] disabled:opacity-50 transition"
            >
              {isPending ? "Assigning..." : "Save Assignment"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
