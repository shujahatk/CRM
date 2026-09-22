"use client";

import { useState } from "react";
import { CheckSquare, Square, Plus, AlertCircle, Calendar } from "lucide-react";
import { createTaskAction, completeTaskAction, reopenTaskAction } from "@/modules/task/commands";
import type { Member } from "@/server/database/types";

export function LeadTasksControl({
  workspaceId,
  leadId,
  tasks,
  members,
}: {
  workspaceId: string;
  leadId: string;
  tasks: Array<{
    id: string;
    title: string;
    due_at: string;
    priority: "low" | "medium" | "high" | "urgent";
    status: "open" | "completed" | "cancelled";
    assignee_id: string;
    assignee_name: string | null;
    completed_at: string | null;
    created_at: string;
  }>;
  members: Member[];
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleToggleTask(task: { id: string; status: string }) {
    setIsPending(true);
    setErrorMessage(null);

    const res =
      task.status === "open"
        ? await completeTaskAction(workspaceId, task.id, leadId)
        : await reopenTaskAction(workspaceId, task.id, leadId);

    setIsPending(false);
    if (res.error) setErrorMessage(res.error);
  }

  async function handleCreateTask(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsPending(true);
    setErrorMessage(null);

    const formData = new FormData(e.currentTarget);
    const due = new Date(String(formData.get("dueAt")));
    if (Number.isNaN(due.getTime())) { setIsPending(false); setErrorMessage("Valid due date required."); return; }
    formData.set("dueAt", due.toISOString());
    formData.set("workspaceId", workspaceId);
    formData.set("leadId", leadId);

    const res = await createTaskAction(null, formData);
    setIsPending(false);

    if (res.error) {
      setErrorMessage(res.error);
    } else {
      setIsAdding(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckSquare size={16} className="text-[#116c58]" />
          <h3 className="text-sm font-bold text-slate-900">Tasks & Next Actions</h3>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
            {tasks.filter((t) => t.status === "open").length} open
          </span>
        </div>
        <button
          onClick={() => setIsAdding(!isAdding)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition"
        >
          <Plus size={13} /> Add Task
        </button>
      </div>

      {errorMessage && (
        <div className="flex items-center gap-2 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700 border border-rose-200">
          <AlertCircle size={14} className="shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Add Task Form */}
      {isAdding && (
        <form onSubmit={handleCreateTask} className="rounded-xl border border-indigo-200 bg-indigo-50/20 p-4 space-y-3">
          <h4 className="text-xs font-bold text-slate-800">New Task</h4>
          <input
            type="text"
            name="title"
            required
            placeholder="e.g. Call back regarding pricing proposal..."
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#116c58] outline-hidden"
          />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600">Due Date & Time</label>
              <input
                type="datetime-local"
                name="dueAt"
                required
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-hidden focus:border-[#116c58]"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600">Assignee</label>
              <select
                name="assigneeId"
                required
                defaultValue={members[0]?.id || ""}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-hidden focus:border-[#116c58]"
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.role} ({m.id.slice(0, 8)})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600">Priority</label>
              <select
                name="priority"
                defaultValue="medium"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-hidden focus:border-[#116c58]"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="rounded-lg px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-[#116c58] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#0e5847] disabled:opacity-50 transition"
            >
              {isPending ? "Creating..." : "Save Task"}
            </button>
          </div>
        </form>
      )}

      {/* Task List */}
      <div className="space-y-2">
        {tasks.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">No tasks created yet.</p>
        ) : (
          tasks.map((task) => {
            const isCompleted = task.status === "completed";
            const isPastDue = !isCompleted && new Date(task.due_at) < new Date();

            return (
              <div
                key={task.id}
                className={`flex items-start gap-3 rounded-xl border p-3 shadow-2xs transition ${
                  isCompleted ? "border-slate-100 bg-slate-50/50 opacity-60" : "border-slate-200 bg-white"
                }`}
              >
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleToggleTask(task)}
                  className="mt-0.5 text-slate-400 hover:text-[#116c58] transition"
                >
                  {isCompleted ? (
                    <CheckSquare size={16} className="text-emerald-600" />
                  ) : (
                    <Square size={16} />
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p
                      className={`text-xs font-semibold ${
                        isCompleted ? "line-through text-slate-500" : "text-slate-900"
                      }`}
                    >
                      {task.title}
                    </p>
                    <span
                      className={`rounded px-1.5 py-0.2 text-[10px] font-semibold uppercase ${
                        task.priority === "urgent"
                          ? "bg-rose-100 text-rose-800"
                          : task.priority === "high"
                          ? "bg-amber-100 text-amber-800"
                          : task.priority === "low"
                          ? "bg-slate-100 text-slate-600"
                          : "bg-blue-50 text-blue-700"
                      }`}
                    >
                      {task.priority}
                    </span>
                  </div>

                  <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-500">
                    <span
                      className={`inline-flex items-center gap-1 font-medium ${
                        isPastDue ? "text-rose-600 font-semibold" : ""
                      }`}
                    >
                      <Calendar size={12} />
                      {new Date(task.due_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "numeric",
                      })}
                      {isPastDue && " (Overdue)"}
                    </span>

                    <span>Assigned to: {task.assignee_name || "Team Member"}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
