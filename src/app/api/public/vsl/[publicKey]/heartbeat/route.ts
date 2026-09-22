import { createClient } from '@supabase/supabase-js';
import { getRateLimiter } from '@/server/security/rate-limit';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ publicKey: string }> }
) {
  await params;
  const origin = request.headers.get('origin');

  // Rate Limiting (Correction 1): Limit heartbeat telemetry batches to 120/min per IP
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown-ip';
  const limiter = getRateLimiter();
  const rl = await limiter.limit(`vsl_heartbeat:${ip}`, 120, 60);
  if (!rl.success) {
    return Response.json(
      { error: 'Heartbeat rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.resetMs / 1000)) } }
    );
  }

  let body: { vslSessionId?: string; intervals?: [number, number][] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  if (!body.vslSessionId || !Array.isArray(body.intervals) || !body.intervals.length) {
    return Response.json({ error: 'Missing vslSessionId or intervals array' }, { status: 400 });
  }

  // Validate intervals structure
  for (const interval of body.intervals) {
    if (!Array.isArray(interval) || interval.length !== 2 || typeof interval[0] !== 'number' || typeof interval[1] !== 'number') {
      return Response.json({ error: 'Intervals must be array of [start, end] numbers' }, { status: 400 });
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'anon-key-placeholder';
  const client = createClient(supabaseUrl, supabaseAnonKey);

  const { data, error } = await client.rpc('record_vsl_heartbeat', {
    p_vsl_session_id: body.vslSessionId,
    p_intervals: body.intervals,
  });

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  return Response.json(data, { status: 200, headers: corsHeaders });
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
