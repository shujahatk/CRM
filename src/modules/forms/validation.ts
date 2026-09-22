import { z } from 'zod';
import { createHash } from 'node:crypto';

export const fieldTypeEnum = z.enum(['text', 'email', 'phone', 'number', 'select', 'boolean']);

export const formFieldDefinitionSchema = z.object({
  key: z.string().min(1).max(50).regex(/^[a-z0-9_]+$/, 'Field key must be lowercase alphanumeric and underscores'),
  label: z.string().min(1).max(100),
  field_type: fieldTypeEnum,
  is_required: z.boolean().default(false),
  options: z.array(z.string().max(100)).max(50).optional(),
  placeholder: z.string().max(100).optional(),
  help_text: z.string().max(200).optional(),
});

export const createTrackingSiteSchema = z.object({
  workspace: z.string().uuid(),
  name: z.string().min(1).max(120),
  allowed_origins: z.array(z.string().url()).max(50),
  is_public_any_origin: z.boolean().default(false),
});

export const createFormSchema = z.object({
  workspace: z.string().uuid(),
  tracking_site_id: z.string().uuid(),
  name: z.string().min(1).max(120),
});

export const publishFormVersionSchema = z.object({
  workspace: z.string().uuid(),
  form_id: z.string().uuid(),
  pipeline_id: z.string().uuid(),
  stage_id: z.string().uuid(),
  redirect_url: z.string().url().max(500).optional().nullable(),
  fields: z.array(formFieldDefinitionSchema).min(1).max(100),
});

/**
 * Strict validation and normalization for answers submitted to forms.
 * Rejects arbitrary rich HTML and oversized inputs (Correction 7).
 */
export const publicSubmitFormSchema = z.object({
  publicKey: z.string().min(5).max(100),
  answers: z.record(
    z.string().max(50),
    z.union([
      z.string().max(2000), // Strict length limit
      z.number(),
      z.boolean(),
    ])
  ),
  visitorToken: z.string().max(255).optional(),
  attribution: z.object({
    utm_source: z.string().max(100).optional(),
    utm_medium: z.string().max(100).optional(),
    utm_campaign: z.string().max(100).optional(),
    utm_term: z.string().max(100).optional(),
    utm_content: z.string().max(100).optional(),
    external_campaign_id: z.string().max(100).optional(),
    external_adset_id: z.string().max(100).optional(),
    external_ad_id: z.string().max(100).optional(),
    external_creative_id: z.string().max(100).optional(),
    landing_url: z.string().max(2000).optional(),
    referrer: z.string().max(2000).optional(),
    session_token: z.string().max(255).optional(),
    consent_status: z.enum(['granted', 'denied', 'unknown']).optional(),
  }).default({}),
  idempotencyKey: z.string().max(255).optional(),
});

/**
 * Computes deterministic SHA-256 hash of normalized form submission payload (Correction 11).
 * Used for authoritative payload-bound idempotency verification.
 */
export function hashSubmissionPayload(answers: Record<string, unknown>): string {
  // Sort keys deterministically
  const sortedKeys = Object.keys(answers).sort();
  const normalized: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    const val = answers[k];
    if (typeof val === 'string') {
      normalized[k] = val.trim();
    } else {
      normalized[k] = val;
    }
  }
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

/**
 * Validates request Origin against tracking site configuration (Correction 9).
 * In development, localhost and 127.0.0.1 are allowed.
 * In production, strict origin matching is required unless is_public_any_origin is deliberately enabled.
 */
export function validateOrigin(
  origin: string | null,
  allowedOrigins: string[],
  isPublicAnyOrigin: boolean,
  isDev: boolean = process.env.NODE_ENV !== 'production'
): boolean {
  if (isPublicAnyOrigin) return true;
  if (!origin) return false;

  try {
    const originUrl = new URL(origin);
    if (isDev && (originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1')) {
      return true;
    }

    const normalizedOrigin = originUrl.origin.toLowerCase();
    return allowedOrigins.some((allowed) => {
      try {
        return new URL(allowed).origin.toLowerCase() === normalizedOrigin;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}
