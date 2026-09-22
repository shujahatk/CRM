"use server";

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { authenticatedClient } from '@/server/auth/session';
import { createClient } from '@supabase/supabase-js';
import { databaseError, publicError } from '@/server/errors';
import { log } from '@/server/telemetry/logger';
import type { LeadVslHistoryItem } from './types';

const createVslAssetSchema = z.object({
  workspace: z.string().uuid(),
  tracking_site_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  duration_seconds: z.number().int().positive().max(86400),
  player_type: z.enum(['custom', 'html5', 'embed']).default('custom'),
  external_video_id: z.string().max(255).optional().nullable(),
});

function refresh(workspace: string) {
  for (const path of ['vsl', 'attribution', 'leads']) {
    revalidatePath(`/${workspace}/${path}`);
  }
}

export async function createVslAsset(input: unknown): Promise<{ error?: string; asset_id?: string; version_id?: string; public_key?: string }> {
  const parsed = createVslAssetSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid VSL asset fields.' };

  try {
    const { client } = await authenticatedClient();
    const { data, error } = await client.rpc('create_vsl_asset', {
      p_workspace: parsed.data.workspace,
      p_tracking_site_id: parsed.data.tracking_site_id,
      p_name: parsed.data.name,
      p_duration: parsed.data.duration_seconds,
      p_player_type: parsed.data.player_type,
      p_external_id: parsed.data.external_video_id ?? null,
    });

    if (error) {
      log({ event: 'vsl.create_asset', outcome: 'error', code: error.code });
      throw databaseError(error.code);
    }

    refresh(parsed.data.workspace);
    return data as { asset_id: string; version_id: string; public_key: string };
  } catch (error) {
    return { error: publicError(error).message };
  }
}

export async function getLeadVslHistory(workspace: string, leadId: string): Promise<{ error?: string; history?: LeadVslHistoryItem[] }> {
  try {
    const { client } = await authenticatedClient();
    const { data, error } = await client.rpc('get_lead_vsl_history', {
      p_workspace: workspace,
      p_lead_id: leadId,
    });

    if (error) {
      log({ event: 'vsl.get_lead_history', outcome: 'error', code: error.code });
      throw databaseError(error.code);
    }

    return { history: (data ?? []) as LeadVslHistoryItem[] };
  } catch (error) {
    return { error: publicError(error).message };
  }
}

export async function getVslAnalytics(workspace: string, assetId: string): Promise<{ error?: string; analytics?: Record<string, unknown> }> {
  try {
    const { client } = await authenticatedClient();
    const { data, error } = await client.rpc('get_vsl_analytics', {
      p_workspace: workspace,
      p_vsl_asset_id: assetId,
    });

    if (error) {
      log({ event: 'vsl.get_analytics', outcome: 'error', code: error.code });
      throw databaseError(error.code);
    }

    return { analytics: data as Record<string, unknown> };
  } catch (error) {
    return { error: publicError(error).message };
  }
}

/**
 * Public intake: Start VSL Session
 */
export async function startPublicVslSession(input: {
  publicKey: string;
  visitorToken?: string;
  leadId?: string;
}): Promise<{ error?: string; session?: { vsl_session_id: string; duration_seconds: number; bin_width_seconds: number } }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'anon-key-placeholder';
  const client = createClient(supabaseUrl, supabaseAnonKey);

  try {
    const { data, error } = await client.rpc('start_vsl_session', {
      p_public_key: input.publicKey,
      p_visitor_token: input.visitorToken ?? null,
      p_lead_id: input.leadId ?? null,
    });

    if (error) {
      log({ event: 'vsl.public_start', outcome: 'error', code: error.code });
      return { error: error.message };
    }

    return { session: data as { vsl_session_id: string; duration_seconds: number; bin_width_seconds: number } };
  } catch (err) {
    return { error: publicError(err).message };
  }
}

/**
 * Public intake: Record Heartbeat Batch
 */
export async function recordPublicVslHeartbeat(input: {
  vslSessionId: string;
  intervals: [number, number][];
}): Promise<{ error?: string; result?: { unique_seconds_watched: number; completion_percent: number; completed: boolean } }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'anon-key-placeholder';
  const client = createClient(supabaseUrl, supabaseAnonKey);

  try {
    const { data, error } = await client.rpc('record_vsl_heartbeat', {
      p_vsl_session_id: input.vslSessionId,
      p_intervals: input.intervals,
    });

    if (error) {
      log({ event: 'vsl.public_heartbeat', outcome: 'error', code: error.code });
      return { error: error.message };
    }

    return { result: data as { unique_seconds_watched: number; completion_percent: number; completed: boolean } };
  } catch (err) {
    return { error: publicError(err).message };
  }
}
