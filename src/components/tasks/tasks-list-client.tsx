"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckSquare, Square, Calendar, User, ArrowUpRight } from "lucide-react";
import { completeTaskAction, reopenTaskAction } from "@/modules/task/commands";
import type { TaskRow } from "@/server/database/types";

export function TasksListClient({
  workspaceId,
  tasks,
}: {
  workspaceId: string;
  tasks: TaskRow[];
}) {
  const [isPending, setIsPending] = useState(false);

  async function handleToggle(task: TaskRow) {
    setIsPending(true);
    if (task.status === "open") {
      await completeTaskAction(workspaceId, task.id, task.lead_id);
    } else {
      await reopenTaskAction(workspaceId, task.id, task.lead_id);
    }
    setIsPending(false);
  }

  if (tasks.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center text-sm text-slate-400">
        No tasks found in this view.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-700">
          <thead className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="w-10 px-4 py-3.5">Status</th>
              <th className="px-4 py-3.5">Task Title</th>
              <th className="px-4 py-3.5">Lead / Contact</th>
              <th className="px-4 py-3.5">Priority</th>
              <th className="px-4 py-3.5">Assignee</th>
              <th className="px-4 py-3.5">Due Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tasks.map((task) => {
              const isCompleted = task.status === "completed";
              const isPastDue = !isCompleted && new Date(task.due_at) < new Date();

              return (
                <tr key={task.id} className="hover:bg-slate-50/70 transition">
                  <td className="px-4 py-3.5">
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleToggle(task)}
                      className="text-slate-400 hover:text-[#116c58] transition"
                    >
                      {isCompleted ? (
                        <CheckSquare size={16} className="text-emerald-600" />
                      ) : (
                        <Square size={16} />
                      )}
                    </button>
                  </td>

                  <td className="px-4 py-3.5 font-medium text-slate-900">
                    <span className={isCompleted ? "line-through text-slate-400" : ""}>
                      {task.title}
                    </span>
                  </td>

                  <td className="px-4 py-3.5">
                    <Link
                      href={`/${workspaceId}/leads/${task.lead_id}`}
                      className="inline-flex items-center gap-1 font-semibold text-slate-800 hover:text-[#116c58] hover:underline"
                    >
                      {task.lead_name} <ArrowUpRight size={12} className="text-slate-400" />
                    </Link>
                  </td>

                  <td className="px-4 py-3.5">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
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
                  </td>

                  <td className="px-4 py-3.5 text-slate-600">
                    <span className="inline-flex items-center gap-1">
                      <User size={12} className="text-slate-400" />
                      {task.assignee_name || "Team Member"}
                    </span>
                  </td>

                  <td className="px-4 py-3.5">
                    <span
                      className={`inline-flex items-center gap-1 font-medium ${
                        isPastDue ? "text-rose-600 font-bold" : "text-slate-600"
                      }`}
                    >
                      <Calendar size={12} className={isPastDue ? "text-rose-500" : "text-slate-400"} />
                      {new Date(task.due_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "numeric",
                      })}
                      {isPastDue && " (Overdue)"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
