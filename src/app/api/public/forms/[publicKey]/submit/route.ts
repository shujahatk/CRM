import { createClient } from '@supabase/supabase-js';
import { getRateLimiter } from '@/server/security/rate-limit';
import { publicSubmitFormSchema, validateOrigin, hashSubmissionPayload } from '@/modules/forms/validation';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ publicKey: string }> }
) {
  const { publicKey } = await params;
  const origin = request.headers.get('origin');

  // Rate Limiting (Correction 1): Replaceable abstraction, limit public submissions to 20/min per IP/token
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown-ip';
  const limiter = getRateLimiter();
  const rl = await limiter.limit(`form_submit:${ip}`, 20, 60);
  if (!rl.success) {
    return Response.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.resetMs / 1000)) } }
    );
  }

  // Parse Body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const parsed = publicSubmitFormSchema.safeParse({
    ...(typeof body === 'object' && body !== null ? body : {}),
    publicKey,
  });

  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'anon-key-placeholder';
  const client = createClient(supabaseUrl, supabaseAnonKey);

  // Check form and tracking site origin (Correction 9)
  const { data: form } = await client
    .from('forms')
    .select(`
      id, status,
      tracking_sites!inner(allowed_origins, is_public_any_origin)
    `)
    .eq('public_key', publicKey)
    .eq('status', 'published')
    .single();

  if (!form) {
    return Response.json({ error: 'Form not found or inactive' }, { status: 404 });
  }

  const site = Array.isArray(form.tracking_sites) ? form.tracking_sites[0] : form.tracking_sites;
  if (site && !validateOrigin(origin, site.allowed_origins ?? [], site.is_public_any_origin ?? false)) {
    return Response.json({ error: 'Forbidden origin' }, { status: 403 });
  }

  // Authoritative payload hash for idempotency (Correction 11)
  const payloadHash = hashSubmissionPayload(parsed.data.answers);
  const idempotencyKey = parsed.data.idempotencyKey || null;

  // Execute database RPC
  const { data, error } = await client.rpc('public_submit_form', {
    p_form_key: publicKey,
    p_answers: parsed.data.answers,
    p_visitor_token: parsed.data.visitorToken ?? null,
    p_attribution: {
      ...parsed.data.attribution,
      _payload_hash: payloadHash,
    },
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    const status = error.code === '40001' ? 409 : 400;
    return Response.json({ error: error.message }, { status });
  }

  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key',
  };

  return Response.json(data, { status: 201, headers: corsHeaders });
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin') || '*';
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key',
    },
  });
}
