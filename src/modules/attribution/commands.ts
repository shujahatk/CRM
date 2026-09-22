"use server";

import { z } from 'zod';
import { authenticatedClient } from '@/server/auth/session';
import { databaseError, publicError } from '@/server/errors';
import { log } from '@/server/telemetry/logger';

const leadAttributionQuerySchema = z.object({
  workspace: z.string().uuid(),
  leadId: z.string().uuid(),
});

export async function getLeadAttribution(input: unknown): Promise<{
  error?: string;
  firstTouch?: Record<string, unknown> | null;
  latestTouch?: Record<string, unknown> | null;
  touches?: Record<string, unknown>[];
}> {
  const parsed = leadAttributionQuerySchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid lead ID or workspace' };

  try {
    const { client } = await authenticatedClient();

    const { data, error } = await client.rpc('get_lead_attribution', {
      p_workspace: parsed.data.workspace,
      p_lead_id: parsed.data.leadId,
    });

    if (error) {
      log({ event: 'attribution.get_snapshots', outcome: 'error', code: error.code });
      throw databaseError(error.code);
    }

    const list = data ?? [];
    const first = list.find((s) => s.model === 'first_touch')?.touch ?? null;
    const latest = list.find((s) => s.model === 'latest_touch')?.touch ?? null;

    return {
      firstTouch: first as Record<string, unknown> | null,
      latestTouch: latest as Record<string, unknown> | null,
      touches: list.map((s) => s.touch) as Record<string, unknown>[],
    };
  } catch (error) {
    return { error: publicError(error).message };
  }
}
