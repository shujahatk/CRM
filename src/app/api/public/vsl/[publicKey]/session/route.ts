import { createClient } from '@supabase/supabase-js';
import { getRateLimiter } from '@/server/security/rate-limit';
import { validateOrigin } from '@/modules/forms/validation';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ publicKey: string }> }
) {
  const { publicKey } = await params;
  const origin = request.headers.get('origin');

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown-ip';
  const limiter = getRateLimiter();
  const rl = await limiter.limit(`vsl_session:${ip}`, 30, 60);
  if (!rl.success) {
    return Response.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.resetMs / 1000)) } }
    );
  }

  let body: { visitorToken?: string; leadId?: string } = {};
  try {
    body = await request.json();
  } catch {
    // Body is optional
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'anon-key-placeholder';
  const client = createClient(supabaseUrl, supabaseAnonKey);

  // Check asset and tracking site origin (Correction 9)
  const { data: asset } = await client
    .from('vsl_assets')
    .select(`
      id, status,
      tracking_sites!inner(allowed_origins, is_public_any_origin)
    `)
    .eq('public_key', publicKey)
    .eq('status', 'active')
    .single();

  if (!asset) {
    return Response.json({ error: 'VSL asset not found or inactive' }, { status: 404 });
  }

  const site = Array.isArray(asset.tracking_sites) ? asset.tracking_sites[0] : asset.tracking_sites;
  if (site && !validateOrigin(origin, site.allowed_origins ?? [], site.is_public_any_origin ?? false)) {
    return Response.json({ error: 'Forbidden origin' }, { status: 403 });
  }

  const { data, error } = await client.rpc('start_vsl_session', {
    p_public_key: publicKey,
    p_visitor_token: body.visitorToken ?? null,
    p_lead_id: body.leadId ?? null,
  });

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
