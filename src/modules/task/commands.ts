"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/server/database/supabase";
import { log } from "@/server/telemetry/logger";

const createTaskSchema = z.object({
  workspaceId: z.string().uuid(),
  leadId: z.string().uuid(),
  assigneeId: z.string().uuid(),
  title: z.string().min(1, "Task title is required").max(200),
  dueAt: z.string().min(1, "Due date is required"),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional().default("medium"),
});

export async function createTaskAction(
  _prevState: { error?: string; success?: boolean; taskId?: string } | null,
  formData: FormData
): Promise<{ error?: string; success?: boolean; taskId?: string }> {
  const parsed = createTaskSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    leadId: formData.get("leadId"),
    assigneeId: formData.get("assigneeId"),
    title: formData.get("title"),
    dueAt: formData.get("dueAt"),
    priority: formData.get("priority") || "medium",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid task" };
  }

  const { workspaceId, leadId, assigneeId, title, dueAt, priority } = parsed.data;
  const client = await createSupabaseServerClient(true);

  const { data: taskId, error } = await client.rpc("create_task", {
    p_workspace: workspaceId,
    p_lead: leadId,
    p_assignee: assigneeId,
    p_title: title.trim(),
    p_due_at: new Date(dueAt).toISOString(),
    p_priority: priority,
  });

  if (error) {
    log({ event: "task.create", outcome: "error", code: error.code });
    if (error.code === "42501") return { error: "Permission denied to create tasks on this lead." };
    return { error: error.message || "Failed to create task." };
  }

  revalidatePath(`/${workspaceId}/leads/${leadId}`);
  revalidatePath(`/${workspaceId}/tasks`);
  revalidatePath(`/${workspaceId}/dashboard`);
  return { success: true, taskId };
}

export async function completeTaskAction(
  workspaceId: string,
  taskId: string,
  leadId?: string
): Promise<{ error?: string; success?: boolean }> {
  const client = await createSupabaseServerClient(true);
  const { error } = await client.rpc("complete_task", {
    p_workspace: workspaceId,
    p_task: taskId,
  });

  if (error) {
    log({ event: "task.complete", outcome: "error", code: error.code });
    return { error: error.message || "Failed to complete task." };
  }

  if (leadId) revalidatePath(`/${workspaceId}/leads/${leadId}`);
  revalidatePath(`/${workspaceId}/tasks`);
  revalidatePath(`/${workspaceId}/dashboard`);
  return { success: true };
}

export async function reopenTaskAction(
  workspaceId: string,
  taskId: string,
  leadId?: string
): Promise<{ error?: string; success?: boolean }> {
  const client = await createSupabaseServerClient(true);
  const { error } = await client.rpc("reopen_task", {
    p_workspace: workspaceId,
    p_task: taskId,
  });

  if (error) {
    log({ event: "task.reopen", outcome: "error", code: error.code });
    return { error: error.message || "Failed to reopen task." };
  }

  if (leadId) revalidatePath(`/${workspaceId}/leads/${leadId}`);
  revalidatePath(`/${workspaceId}/tasks`);
  revalidatePath(`/${workspaceId}/dashboard`);
  return { success: true };
}
