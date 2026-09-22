"use server";

import { revalidatePath } from "next/cache";
import { authenticatedClient } from "@/server/auth/session";
import { databaseError, publicError } from "@/server/errors";
import { log } from "@/server/telemetry/logger";
import type { MessageTemplate, ChannelType } from "@/modules/conversations/types";
import { validateTemplateText } from "./parser";

function refresh(workspace: string) {
  revalidatePath(`/${workspace}/templates`);
}

export async function listMessageTemplates(
  workspace: string
): Promise<{ error?: string; templates?: MessageTemplate[] }> {
  try {
    const { client } = await authenticatedClient();
    const { data, error } = await client.rpc("list_message_templates", {
      p_workspace: workspace,
    });
    if (error) {
      throw databaseError(error.code);
    }
    return { templates: (data as MessageTemplate[]) || [] };
  } catch (error) {
    return { error: publicError(error).message };
  }
}

export async function createMessageTemplate(input: {
  workspace: string;
  name: string;
  channel: ChannelType;
}): Promise<{ error?: string; id?: string }> {
  try {
    const { client } = await authenticatedClient();
    const { data, error } = await client.rpc("create_template", {
      p_workspace: input.workspace,
      p_name: input.name,
      p_channel: input.channel,
    });
    if (error) {
      log({ event: "template.create", outcome: "error", code: error.code });
      throw databaseError(error.code);
    }
    log({ event: "template.create", outcome: "success" });
    refresh(input.workspace);
    return data as { id: string };
  } catch (error) {
    return { error: publicError(error).message };
  }
}

export async function publishMessageTemplateVersion(input: {
  workspace: string;
  templateId: string;
  subject?: string | null;
  body: string;
}): Promise<{ error?: string; version_id?: string; version?: number }> {
  validateTemplateText(input.subject, input.body);

  try {
    const { client } = await authenticatedClient();
    const { data, error } = await client.rpc("publish_template_version", {
      p_workspace: input.workspace,
      p_template_id: input.templateId,
      p_subject: input.subject || null,
      p_body: input.body,
    });
    if (error) {
      log({ event: "template.publish", outcome: "error", code: error.code });
      throw databaseError(error.code);
    }
    log({ event: "template.publish", outcome: "success" });
    refresh(input.workspace);
    return data as { version_id: string; version: number };
  } catch (error) {
    return { error: publicError(error).message };
  }
}
