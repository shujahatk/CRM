"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/server/database/supabase";

import { log } from "@/server/telemetry/logger";

const createLeadSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1, "Name is required").max(160),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  company: z.string().max(160).optional().nullable(),
  commandKey: z.string().optional().nullable(),
});

export async function createLeadAction(
  _prevState: { error?: string; success?: boolean; leadId?: string } | null,
  formData: FormData
): Promise<{ error?: string; success?: boolean; leadId?: string }> {
  const raw = {
    workspaceId: formData.get("workspaceId"),
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    company: formData.get("company"),
    commandKey: formData.get("commandKey") || crypto.randomUUID(),
  };

  const parsed = createLeadSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { workspaceId, name, email, phone, company, commandKey } = parsed.data;

  // Normalization preserving raw value and avoiding country guessing


  const client = await createSupabaseServerClient(true);
  const { data: leadId, error } = await client.rpc("create_lead", {
    p_workspace: workspaceId,
    p_name: name.trim(),
    p_email: email?.trim() || null,
    p_phone: phone?.trim() || null,
    p_company: company ? company.trim() : null,
    p_command_key: commandKey ?? null,
  });

  if (error) {
    log({ event: "lead.create", outcome: "error", code: error.code });
    if (error.code === "40001") {
      return { error: "Identity conflict: A lead with this contact information already exists or conflicts with existing records." };
    }
    if (error.code === "42501") {
      return { error: "You do not have permission to create leads in this workspace." };
    }
    return { error: "Failed to create lead." };
  }

  if (!leadId) return { error: "Contact details conflict. A review record has been saved for your administrator." };
  revalidatePath(`/${workspaceId}/leads`);
  revalidatePath(`/${workspaceId}/pipeline`);
  revalidatePath(`/${workspaceId}/dashboard`);
  return { success: true, leadId };
}

const updateLeadSchema = z.object({
  workspaceId: z.string().uuid(),
  leadId: z.string().uuid(),
  displayName: z.string().min(1, "Name is required").max(160),
  company: z.string().max(160).optional().nullable(),
  version: z.coerce.number().int().nonnegative(),
});

export async function updateLeadAction(
  _prevState: { error?: string; success?: boolean } | null,
  formData: FormData
): Promise<{ error?: string; success?: boolean }> {
  const parsed = updateLeadSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    leadId: formData.get("leadId"),
    displayName: formData.get("displayName"),
    company: formData.get("company"),
    version: formData.get("version"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { workspaceId, leadId, displayName, company, version } = parsed.data;
  const client = await createSupabaseServerClient(true);

  const { error } = await client.rpc("update_lead", {
    p_workspace: workspaceId,
    p_lead: leadId,
    p_display_name: displayName.trim(),
    p_company: company ? company.trim() : null,
    p_version: version,
  });

  if (error) {
    log({ event: "lead.update", outcome: "error", code: error.code });
    if (error.code === "40001") {
      return { error: "This lead was modified by another user. Please refresh and try again." };
    }
    if (error.code === "42501") {
      return { error: "Permission denied to update lead." };
    }
    return { error: "Failed to update lead." };
  }

  revalidatePath(`/${workspaceId}/leads/${leadId}`);
  revalidatePath(`/${workspaceId}/leads`);
  return { success: true };
}

const assignLeadSchema = z.object({
  workspaceId: z.string().uuid(),
  leadId: z.string().uuid(),
  setterId: z.string().uuid().optional().nullable(),
  closerId: z.string().uuid().optional().nullable(),
  teamId: z.string().uuid().optional().nullable(),
  reason: z.string().max(500).optional().nullable(),
  version: z.coerce.number().int().nonnegative(),
});

export async function assignLeadAction(
  _prevState: { error?: string; success?: boolean } | null,
  formData: FormData
): Promise<{ error?: string; success?: boolean }> {
  const parsed = assignLeadSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    leadId: formData.get("leadId"),
    setterId: formData.get("setterId") || null,
    closerId: formData.get("closerId") || null,
    teamId: formData.get("teamId") || null,
    reason: formData.get("reason") || null,
    version: formData.get("version"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { workspaceId, leadId, setterId, closerId, teamId, reason, version } = parsed.data;
  const client = await createSupabaseServerClient(true);

  const { error } = await client.rpc("assign_lead", {
    p_workspace: workspaceId,
    p_lead: leadId,
    p_setter: setterId,
    p_closer: closerId,
    p_team: teamId,
    p_reason: reason,
    p_version: version,
  });

  if (error) {
    log({ event: "lead.assign", outcome: "error", code: error.code });
    if (error.code === "40001") {
      return { error: "Assignment conflict: Lead was updated concurrently." };
    }
    if (error.code === "42501") {
      return { error: "Only admins and managers can reassign leads." };
    }
    return { error: "Failed to assign lead." };
  }

  revalidatePath(`/${workspaceId}/leads/${leadId}`);
  revalidatePath(`/${workspaceId}/leads`);
  return { success: true };
}
