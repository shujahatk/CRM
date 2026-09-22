"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, X, AlertCircle } from "lucide-react";
import { createLeadAction } from "@/modules/lead/commands";

export function CreateLeadDialog({ workspaceId }: { workspaceId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    const formData = new FormData(e.currentTarget);
    formData.set("workspaceId", workspaceId);

    const res = await createLeadAction(null, formData);
    setIsSubmitting(false);

    if (res.error) {
      setErrorMessage(res.error);
    } else if (res.success && res.leadId) {
      setIsOpen(false);
      router.push(`/${workspaceId}/leads/${res.leadId}`);
    } else {
      setIsOpen(false);
      router.refresh();
    }
  }

  return (
    <>
      <button
        onClick={() => {
          setIsOpen(true);
          setErrorMessage(null);
        }}
        className="inline-flex items-center gap-2 rounded-lg bg-[#116c58] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#0e5847] transition active:scale-[0.98]"
      >
        <UserPlus size={16} /> New Lead
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Create New Lead</h3>
                <p className="text-xs text-slate-500">Add a prospect directly to your workspace sales pipeline.</p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>

            {errorMessage && (
              <div className="mt-4 flex items-start gap-2.5 rounded-lg bg-rose-50 p-3 text-xs text-rose-800 border border-rose-200">
                <AlertCircle size={16} className="text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Creation Blocked</p>
                  <p className="mt-0.5">{errorMessage}</p>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-5 space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Full Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  placeholder="e.g. Sarah Jenkins"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#116c58] focus:ring-1 focus:ring-[#116c58] outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Email Address</label>
                <input
                  type="email"
                  name="email"
                  placeholder="sarah@example.com"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#116c58] focus:ring-1 focus:ring-[#116c58] outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Phone Number</label>
                <input
                  type="tel"
                  name="phone"
                  placeholder="+1 (555) 234-5678"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#116c58] focus:ring-1 focus:ring-[#116c58] outline-hidden"
                />
                <p className="mt-1 text-[11px] text-slate-500">Include country prefix (e.g. +1, +44) if available.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Company / Organization</label>
                <input
                  type="text"
                  name="company"
                  placeholder="Acme Corp"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#116c58] focus:ring-1 focus:ring-[#116c58] outline-hidden"
                />
              </div>

              <div className="mt-6 flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-lg bg-[#116c58] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0e5847] transition disabled:opacity-50"
                >
                  {isSubmitting ? "Creating..." : "Create Lead"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
