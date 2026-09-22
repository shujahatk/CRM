"use client";

import { useState } from "react";
import { Pin, Edit3, MessageSquare, AlertCircle, Plus, X } from "lucide-react";
import { createNoteAction, editNoteAction } from "@/modules/note/commands";

export function LeadNotesControl({
  workspaceId,
  leadId,
  notes,
}: {
  workspaceId: string;
  leadId: string;
  notes: Array<{
    id: string;
    pinned: boolean;
    important: boolean;
    author_id: string;
    author_name: string | null;
    created_at: string;
    updated_at: string;
    body: string;
    revision_number: number;
  }>;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingNote, setEditingNote] = useState<{ id: string; body: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleCreateNote(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsPending(true);
    setErrorMessage(null);

    const formData = new FormData(e.currentTarget);
    formData.set("workspaceId", workspaceId);
    formData.set("leadId", leadId);

    const res = await createNoteAction(null, formData);
    setIsPending(false);

    if (res.error) {
      setErrorMessage(res.error);
    } else {
      setIsAdding(false);
    }
  }

  async function handleEditNote(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editingNote) return;

    setIsPending(true);
    setErrorMessage(null);

    const formData = new FormData(e.currentTarget);
    formData.set("workspaceId", workspaceId);
    formData.set("leadId", leadId);
    formData.set("noteId", editingNote.id);

    const res = await editNoteAction(null, formData);
    setIsPending(false);

    if (res.error) {
      setErrorMessage(res.error);
    } else {
      setEditingNote(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare size={16} className="text-[#116c58]" />
          <h3 className="text-sm font-bold text-slate-900">Notes & History</h3>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
            {notes.length}
          </span>
        </div>
        <button
          onClick={() => setIsAdding(!isAdding)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition"
        >
          <Plus size={13} /> Add Note
        </button>
      </div>

      {errorMessage && (
        <div className="flex items-center gap-2 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700 border border-rose-200">
          <AlertCircle size={14} className="shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Add Note Form */}
      {isAdding && (
        <form onSubmit={handleCreateNote} className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-4 space-y-3">
          <h4 className="text-xs font-bold text-slate-800">New Note</h4>
          <textarea
            name="body"
            required
            rows={3}
            placeholder="Log call discussion, next steps, objections, or qualification notes..."
            className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs text-slate-900 focus:border-[#116c58] outline-hidden shadow-2xs"
          />
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 cursor-pointer text-slate-700">
                <input type="checkbox" name="pinned" value="true" className="rounded text-[#116c58]" />
                <Pin size={12} className="text-slate-400" /> Pin Note
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer text-slate-700">
                <input type="checkbox" name="important" value="true" className="rounded text-amber-600" />
                <span>Mark Important</span>
              </label>
            </div>
            <div className="flex items-center gap-2">
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
                {isPending ? "Saving..." : "Save Note"}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Notes List */}
      <div className="space-y-3">
        {notes.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">No notes recorded yet.</p>
        ) : (
          notes.map((note) => (
            <div
              key={note.id}
              className={`rounded-xl border p-4 shadow-2xs transition ${
                note.pinned ? "border-amber-200 bg-amber-50/20" : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-900">{note.author_name || "Team Member"}</span>
                  <span className="text-[11px] text-slate-400 font-mono">
                    {new Date(note.created_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "numeric",
                    })}
                  </span>
                  {note.revision_number > 1 && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-500">
                      rev {note.revision_number} (edited)
                    </span>
                  )}
                  {note.pinned && (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                      <Pin size={10} /> Pinned
                    </span>
                  )}
                  {note.important && (
                    <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-800">
                      Important
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setEditingNote({ id: note.id, body: note.body })}
                  className="rounded p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
                  title="Edit note (creates immutable revision)"
                >
                  <Edit3 size={13} />
                </button>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-700 whitespace-pre-wrap">{note.body}</p>
            </div>
          ))
        )}
      </div>

      {/* Edit Note Modal */}
      {editingNote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h4 className="text-sm font-bold text-slate-900">Edit Note</h4>
                <p className="text-[11px] text-slate-500">
                  Editing creates an immutable new revision, preserving previous note history.
                </p>
              </div>
              <button
                onClick={() => setEditingNote(null)}
                className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleEditNote} className="mt-4 space-y-3">
              <textarea
                name="body"
                defaultValue={editingNote.body}
                required
                rows={4}
                className="w-full rounded-lg border border-slate-300 p-3 text-xs text-slate-900 focus:border-[#116c58] outline-hidden"
              />
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingNote(null)}
                  className="rounded-lg px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-lg bg-[#116c58] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#0e5847] disabled:opacity-50"
                >
                  {isPending ? "Saving..." : "Save Revision"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
