"use server";

import { revalidatePath } from "next/cache";
import { authenticatedClient } from "@/server/auth/session";
import { databaseError, publicError } from "@/server/errors";
import { log } from "@/server/telemetry/logger";
import type { SequenceSummary, ExitCondition } from "./types";

function refresh(workspace: string) {
  revalidatePath(`/${workspace}/sequences`);
}

export async function listSequences(
  workspace: string
): Promise<{ error?: string; sequences?: SequenceSummary[] }> {
  try {
    const { client } = await authenticatedClient();
    const { data, error } = await client.rpc("list_sequences", {
      p_workspace: workspace,
    });
    if (error) {
      throw databaseError(error.code);
    }
    return { sequences: (data as SequenceSummary[]) || [] };
  } catch (error) {
    return { error: publicError(error).message };
  }
}

export async function createSequence(input: {
  workspace: string;
  name: string;
  description?: string;
}): Promise<{ error?: string; id?: string }> {
  try {
    const { client } = await authenticatedClient();
    const { data, error } = await client.rpc("create_sequence", {
      p_workspace: input.workspace,
      p_name: input.name,
      p_description: input.description || null,
    });
    if (error) {
      log({ event: "sequence.create", outcome: "error", code: error.code });
      throw databaseError(error.code);
    }
    log({ event: "sequence.create", outcome: "success", sequenceId: (data as { id: string }).id });
    refresh(input.workspace);
    return data as { id: string };
  } catch (error) {
    return { error: publicError(error).message };
  }
}

export async function publishSequenceVersion(input: {
  workspace: string;
  sequenceId: string;
  steps: Array<{
    step_number: number;
    delay_seconds: number;
    channel: string;
    template_version_id: string;
  }>;
  exitConditions?: ExitCondition[];
}): Promise<{ error?: string; version_id?: string; version?: number }> {
  try {
    const { client } = await authenticatedClient();
    const { data, error } = await client.rpc("publish_sequence_version", {
      p_workspace: input.workspace,
      p_sequence_id: input.sequenceId,
      p_steps: input.steps,
      p_exit_conditions: input.exitConditions || ["reply_received", "meeting_booked", "closed_won", "closed_lost", "dnc"],
    });
    if (error) {
      log({ event: "sequence.publish", outcome: "error", code: error.code, sequenceId: input.sequenceId });
      throw databaseError(error.code);
    }
    log({ event: "sequence.publish", outcome: "success", sequenceId: input.sequenceId });
    refresh(input.workspace);
    return data as { version_id: string; version: number };
  } catch (error) {
    return { error: publicError(error).message };
  }
}

export async function enrollLeadSequence(input: {
  workspace: string;
  sequenceId: string;
  leadId: string;
}): Promise<{ error?: string; enrollment_id?: string; status?: string; reason?: string }> {
  try {
    const { client } = await authenticatedClient();
    const { data, error } = await client.rpc("enroll_lead_sequence", {
      p_workspace: input.workspace,
      p_sequence_id: input.sequenceId,
      p_lead_id: input.leadId,
    });
    if (error) {
      log({ event: "sequence.enroll", outcome: "error", code: error.code, sequenceId: input.sequenceId });
      throw databaseError(error.code);
    }
    log({ event: "sequence.enroll", outcome: "success", sequenceId: input.sequenceId });
    refresh(input.workspace);
    return data as { enrollment_id?: string; status: string; reason?: string };
  } catch (error) {
    return { error: publicError(error).message };
  }
}
