"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/server/database/supabase";
import { log } from "@/server/telemetry/logger";

const transitionSchema = z.object({
  workspaceId: z.string().uuid(),
  leadId: z.string().uuid(),
  toStageCode: z.string().min(1),
  lostReasonId: z.string().uuid().optional().nullable(),
  expectedStageCode: z.string().optional().nullable(),
  version: z.number().int().nonnegative().optional().nullable(),
  commandKey: z.string().optional().nullable(),
});

export async function transitionStageAction(input: {
  workspaceId: string;
  leadId: string;
  toStageCode: string;
  lostReasonId?: string | null;
  expectedStageCode?: string | null;
  version?: number | null;
  commandKey?: string | null;
}): Promise<{ success?: boolean; error?: string }> {
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid transition parameters" };
  }

  const { workspaceId, leadId, toStageCode, lostReasonId, expectedStageCode, version, commandKey } = parsed.data;
  const client = await createSupabaseServerClient(true);

  const { error } = await client.rpc("transition_stage", {
    p_workspace: workspaceId,
    p_lead: leadId,
    p_to_stage_code: toStageCode,
    p_lost_reason_id: lostReasonId ?? null,
    p_expected_stage_code: expectedStageCode ?? null,
    p_version: version ?? null,
    p_command_key: commandKey ?? crypto.randomUUID(),
  });

  if (error) {
    log({ event: "stage.transition", outcome: "error", code: error.code });
    if (error.code === "22023") {
      return { error: "A lost reason is required when moving a lead to Closed Lost." };
    }
    if (error.code === "40001") {
      return { error: "Stage changed concurrently by another user. Refreshing..." };
    }
    if (error.code === "42501") {
      return { error: "Permission denied to transition this lead's stage." };
    }
    return { error: error.message || "Failed to update pipeline stage." };
  }

  revalidatePath(`/${workspaceId}/pipeline`);
  revalidatePath(`/${workspaceId}/leads/${leadId}`);
  revalidatePath(`/${workspaceId}/dashboard`);
  return { success: true };
}
