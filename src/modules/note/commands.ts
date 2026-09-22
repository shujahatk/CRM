"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/server/database/supabase";
import { log } from "@/server/telemetry/logger";

const createNoteSchema = z.object({
  workspaceId: z.string().uuid(),
  leadId: z.string().uuid(),
  body: z.string().min(1, "Note content cannot be empty"),
  pinned: z.boolean().optional().default(false),
  important: z.boolean().optional().default(false),
});

export async function createNoteAction(
  _prevState: { error?: string; success?: boolean; noteId?: string } | null,
  formData: FormData
): Promise<{ error?: string; success?: boolean; noteId?: string }> {
  const parsed = createNoteSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    leadId: formData.get("leadId"),
    body: formData.get("body"),
    pinned: formData.get("pinned") === "true",
    important: formData.get("important") === "true",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid note" };
  }

  const { workspaceId, leadId, body, pinned, important } = parsed.data;
  const client = await createSupabaseServerClient(true);

  const { data: noteId, error } = await client.rpc("create_note", {
    p_workspace: workspaceId,
    p_lead: leadId,
    p_body: body.trim(),
    p_pinned: pinned,
    p_important: important,
  });

  if (error) {
    log({ event: "note.create", outcome: "error", code: error.code });
    if (error.code === "42501") return { error: "Permission denied to add notes to this lead." };
    return { error: "Failed to create note." };
  }

  revalidatePath(`/${workspaceId}/leads/${leadId}`);
  return { success: true, noteId };
}

const editNoteSchema = z.object({
  workspaceId: z.string().uuid(),
  leadId: z.string().uuid(),
  noteId: z.string().uuid(),
  body: z.string().min(1, "Note content cannot be empty"),
});

export async function editNoteAction(
  _prevState: { error?: string; success?: boolean } | null,
  formData: FormData
): Promise<{ error?: string; success?: boolean }> {
  const parsed = editNoteSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    leadId: formData.get("leadId"),
    noteId: formData.get("noteId"),
    body: formData.get("body"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { workspaceId, leadId, noteId, body } = parsed.data;
  const client = await createSupabaseServerClient(true);

  const { error } = await client.rpc("edit_note", {
    p_workspace: workspaceId,
    p_note: noteId,
    p_body: body.trim(),
  });

  if (error) {
    log({ event: "note.edit", outcome: "error", code: error.code });
    if (error.code === "42501") return { error: "Permission denied to edit note." };
    return { error: "Failed to update note." };
  }

  revalidatePath(`/${workspaceId}/leads/${leadId}`);
  return { success: true };
}
