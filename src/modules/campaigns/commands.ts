"use server";

import { revalidatePath } from "next/cache";
import { authenticatedClient } from "@/server/auth/session";
import { databaseError, publicError } from "@/server/errors";
import { log } from "@/server/telemetry/logger";
import type { CampaignSummary, ChannelType } from "@/modules/conversations/types";

function refresh(workspace: string) {
  revalidatePath(`/${workspace}/campaigns`);
}

export async function listCampaigns(
  workspace: string
): Promise<{ error?: string; campaigns?: CampaignSummary[] }> {
  try {
    const { client } = await authenticatedClient();
    const { data, error } = await client.rpc("list_campaigns", {
      p_workspace: workspace,
    });
    if (error) {
      throw databaseError(error.code);
    }
    return { campaigns: (data as CampaignSummary[]) || [] };
  } catch (error) {
    return { error: publicError(error).message };
  }
}

export async function createCampaign(input: {
  workspace: string;
  name: string;
  channel: ChannelType;
  templateVersionId: string;
  audienceFilters?: Record<string, unknown>;
  batchSize?: number;
}): Promise<{ error?: string; id?: string }> {
  try {
    const { client } = await authenticatedClient();
    const { data, error } = await client.rpc("create_campaign", {
      p_workspace: input.workspace,
      p_name: input.name,
      p_channel: input.channel,
      p_template_version_id: input.templateVersionId,
      p_audience_filters: input.audienceFilters || {},
      p_batch_size: input.batchSize || 100,
    });
    if (error) {
      log({ event: "campaign.create", outcome: "error", code: error.code });
      throw databaseError(error.code);
    }
    log({ event: "campaign.create", outcome: "success", campaignId: (data as { id: string }).id });
    refresh(input.workspace);
    return data as { id: string };
  } catch (error) {
    return { error: publicError(error).message };
  }
}

export async function launchCampaign(input: {
  workspace: string;
  campaignId: string;
}): Promise<{ error?: string; campaign_id?: string; total_recipients?: number; eligible_count?: number; suppressed_count?: number }> {
  try {
    const { client } = await authenticatedClient();
    const { data, error } = await client.rpc("launch_campaign", {
      p_workspace: input.workspace,
      p_campaign_id: input.campaignId,
      p_command_key: crypto.randomUUID(),
    });
    if (error) {
      log({ event: "campaign.launch", outcome: "error", code: error.code, campaignId: input.campaignId });
      throw databaseError(error.code);
    }
    log({ event: "campaign.launch", outcome: "success", campaignId: input.campaignId });
    refresh(input.workspace);
    return data as { campaign_id: string; total_recipients: number; eligible_count: number; suppressed_count: number };
  } catch (error) {
    return { error: publicError(error).message };
  }
}

export async function cancelCampaign(input: {
  workspace: string;
  campaignId: string;
}): Promise<{ error?: string; campaign_id?: string; status?: string }> {
  try {
    const { client } = await authenticatedClient();
    const { data, error } = await client.rpc("cancel_campaign", {
      p_workspace: input.workspace,
      p_campaign_id: input.campaignId,
    });
    if (error) {
      log({ event: "campaign.cancel", outcome: "error", code: error.code, campaignId: input.campaignId });
      throw databaseError(error.code);
    }
    log({ event: "campaign.cancel", outcome: "success", campaignId: input.campaignId });
    refresh(input.workspace);
    return data as { campaign_id: string; status: string };
  } catch (error) {
    return { error: publicError(error).message };
  }
}
