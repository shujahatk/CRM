"use server";

import { revalidatePath } from "next/cache";
import { authenticatedClient } from "@/server/auth/session";
import { databaseError, publicError } from "@/server/errors";
import { log } from "@/server/telemetry/logger";
import type {
  ConversationSummary,
  MessageDetail,
  InboundMessageReview,
  ChannelType,
} from "./types";
import { validateOutboundMessage } from "./validation";

function refresh(workspace: string) {
  for (const path of ["conversations", "leads"]) {
    revalidatePath(`/${workspace}/${path}`);
  }
}

export async function listConversations(
  workspace: string,
  channel?: ChannelType,
  status?: string
): Promise<{ error?: string; conversations?: ConversationSummary[] }> {
  try {
    const { client } = await authenticatedClient();
    const { data, error } = await client.rpc("list_conversations", {
      p_workspace: workspace,
      p_channel: channel || null,
      p_status: status || null,
    });
    if (error) {
      log({ event: "messaging.outbound_create", outcome: "error", code: error.code });
      throw databaseError(error.code);
    }
    return { conversations: (data as ConversationSummary[]) || [] };
  } catch (error) {
    return { error: publicError(error).message };
  }
}

export async function getConversationMessages(
  workspace: string,
  conversationId: string
): Promise<{ error?: string; messages?: MessageDetail[] }> {
  try {
    const { client } = await authenticatedClient();
    const { data, error } = await client.rpc("get_conversation_messages", {
      p_workspace: workspace,
      p_conversation_id: conversationId,
    });
    if (error) {
      log({ event: "messaging.outbound_create", outcome: "error", code: error.code });
      throw databaseError(error.code);
    }
    return { messages: (data as MessageDetail[]) || [] };
  } catch (error) {
    return { error: publicError(error).message };
  }
}

export async function sendOutboundMessage(input: {
  workspace: string;
  leadId: string;
  channel: ChannelType;
  recipientAddress: string;
  textBody?: string | null;
  subject?: string | null;
  htmlBody?: string | null;
  templateVersionId?: string | null;
  templateVariables?: Record<string, string>;
  channelAccountId?: string | null;
}): Promise<{ error?: string; message_id?: string; conversation_id?: string; status?: string }> {
  validateOutboundMessage({
    channel: input.channel,
    recipientAddress: input.recipientAddress,
    textBody: input.textBody,
    templateVersionId: input.templateVersionId,
  });

  try {
    const { client } = await authenticatedClient();
    const { data, error } = await client.rpc("create_outbound_message", {
      p_workspace: input.workspace,
      p_lead_id: input.leadId,
      p_channel: input.channel,
      p_recipient_address: input.recipientAddress,
      p_text_body: input.textBody || null,
      p_subject: input.subject || null,
      p_html_body: input.htmlBody || null,
      p_template_version_id: input.templateVersionId || null,
      p_command_key: crypto.randomUUID(),
      p_channel_account_id: input.channelAccountId || null,
      p_template_variables: input.templateVariables || null,
    });

    if (error) {
      log({ event: "messaging.outbound_create", outcome: "error", code: error.code, channel: input.channel });
      throw databaseError(error.code);
    }

    log({
      event: "messaging.outbound_create",
      outcome: "success",
      channel: input.channel,
      messageId: (data as { message_id: string }).message_id,
      conversationId: (data as { conversation_id: string }).conversation_id,
    });

    refresh(input.workspace);
    return data as { message_id: string; conversation_id: string; status: string };
  } catch (error) {
    return { error: publicError(error).message };
  }
}

export async function listInboundReviews(
  workspace: string
): Promise<{ error?: string; reviews?: InboundMessageReview[] }> {
  try {
    const { client } = await authenticatedClient();
    const { data, error } = await client.rpc("list_inbound_reviews", {
      p_workspace: workspace,
    });
    if (error) {
      throw databaseError(error.code);
    }
    return { reviews: (data as InboundMessageReview[]) || [] };
  } catch (error) {
    return { error: publicError(error).message };
  }
}

export async function resolveInboundReview(input: {
  workspace: string;
  reviewId: string;
  leadId: string;
  resolutionNotes?: string;
}): Promise<{ error?: string; review_id?: string; conversation_id?: string; message_id?: string }> {
  try {
    const { client } = await authenticatedClient();
    const { data, error } = await client.rpc("resolve_inbound_review", {
      p_workspace: input.workspace,
      p_review_id: input.reviewId,
      p_lead_id: input.leadId,
      p_resolution_notes: input.resolutionNotes || null,
    });

    if (error) {
      log({ event: "messaging.inbound_resolve", outcome: "error", code: error.code });
      throw databaseError(error.code);
    }

    log({
      event: "messaging.inbound_resolve",
      outcome: "success",
      messageId: (data as { message_id: string }).message_id,
      conversationId: (data as { conversation_id: string }).conversation_id,
    });

    refresh(input.workspace);
    return data as { review_id: string; conversation_id: string; message_id: string };
  } catch (error) {
    return { error: publicError(error).message };
  }
}
