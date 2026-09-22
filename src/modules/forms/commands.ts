"use server";

import { revalidatePath } from 'next/cache';
import { authenticatedClient } from '@/server/auth/session';
import { createClient } from '@supabase/supabase-js';
import { databaseError, publicError } from '@/server/errors';
import { log } from '@/server/telemetry/logger';
import {
  createTrackingSiteSchema,
  createFormSchema,
  publishFormVersionSchema,
  publicSubmitFormSchema,
} from './validation';
import type { FormSubmissionResult } from './types';

function refresh(workspace: string) {
  for (const path of ['forms', 'attribution', 'leads']) {
    revalidatePath(`/${workspace}/${path}`);
  }
}

export async function createTrackingSite(input: unknown): Promise<{ error?: string; site_id?: string; public_key?: string }> {
  const parsed = createTrackingSiteSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid tracking site fields.' };

  try {
    const { client } = await authenticatedClient();
    const { data, error } = await client.rpc('create_tracking_site', {
      p_workspace: parsed.data.workspace,
      p_name: parsed.data.name,
      p_allowed_origins: parsed.data.allowed_origins,
      p_is_public_any_origin: parsed.data.is_public_any_origin,
    });
    if (error) {
      log({ event: 'forms.create_site', outcome: 'error', code: error.code });
      throw databaseError(error.code);
    }
    refresh(parsed.data.workspace);
    return data as { site_id: string; public_key: string };
  } catch (error) {
    return { error: publicError(error).message };
  }
}

export async function createForm(input: unknown): Promise<{ error?: string; form_id?: string; public_key?: string }> {
  const parsed = createFormSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid form creation fields.' };

  try {
    const { client } = await authenticatedClient();
    const { data, error } = await client.rpc('create_form', {
      p_workspace: parsed.data.workspace,
      p_tracking_site_id: parsed.data.tracking_site_id,
      p_name: parsed.data.name,
    });
    if (error) {
      log({ event: 'forms.create_form', outcome: 'error', code: error.code });
      throw databaseError(error.code);
    }
    refresh(parsed.data.workspace);
    return data as { form_id: string; public_key: string };
  } catch (error) {
    return { error: publicError(error).message };
  }
}

export async function publishFormVersion(input: unknown): Promise<{ error?: string; version_id?: string }> {
  const parsed = publishFormVersionSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid form publish fields.' };

  try {
    const { client } = await authenticatedClient();
    const { data, error } = await client.rpc('publish_form_version', {
      p_workspace: parsed.data.workspace,
      p_form_id: parsed.data.form_id,
      p_pipeline_id: parsed.data.pipeline_id,
      p_stage_id: parsed.data.stage_id,
      p_fields: parsed.data.fields,
      p_redirect_url: parsed.data.redirect_url ?? null,
    });
    if (error) {
      log({ event: 'forms.publish_version', outcome: 'error', code: error.code });
      throw databaseError(error.code);
    }
    refresh(parsed.data.workspace);
    return data as { version_id: string };
  } catch (error) {
    return { error: publicError(error).message };
  }
}

/**
 * Public form submission intake.
 * Uses anon client to invoke public RPC api.public_submit_form.
 */
export async function submitPublicForm(input: unknown): Promise<{ error?: string; result?: FormSubmissionResult }> {
  const parsed = publicSubmitFormSchema.safeParse(input);
  if (!parsed.success) {
    return { error: 'Invalid submission data.' };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'anon-key-placeholder';
  const client = createClient(supabaseUrl, supabaseAnonKey);

  try {
    const { data, error } = await client.rpc('public_submit_form', {
      p_form_key: parsed.data.publicKey,
      p_answers: parsed.data.answers,
      p_visitor_token: parsed.data.visitorToken ?? null,
      p_attribution: parsed.data.attribution,
      p_idempotency_key: parsed.data.idempotencyKey ?? null,
    });

    if (error) {
      log({ event: 'forms.public_submit', outcome: 'error', code: error.code });
      return { error: error.message || 'Form submission failed.' };
    }

    return { result: data as FormSubmissionResult };
  } catch (err) {
    return { error: publicError(err).message };
  }
}
