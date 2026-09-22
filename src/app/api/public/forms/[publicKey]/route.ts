import { createClient } from '@supabase/supabase-js';
import { validateOrigin } from '@/modules/forms/validation';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ publicKey: string }> }
) {
  const { publicKey } = await params;
  if (!publicKey || publicKey.length < 5) {
    return Response.json({ error: 'Invalid form key' }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'anon-key-placeholder';
  const client = createClient(supabaseUrl, supabaseAnonKey);

  // Fetch form and tracking site
  const { data: form, error: formError } = await client
    .from('forms')
    .select(`
      id, name, public_key, status, current_version_id,
      tracking_sites!inner(allowed_origins, is_public_any_origin, status)
    `)
    .eq('public_key', publicKey)
    .eq('status', 'published')
    .single();

  if (formError || !form || !form.current_version_id) {
    return Response.json({ error: 'Form not found or unpublished' }, { status: 404 });
  }

  const site = Array.isArray(form.tracking_sites) ? form.tracking_sites[0] : form.tracking_sites;
  const origin = request.headers.get('origin');
  if (site && !validateOrigin(origin, site.allowed_origins ?? [], site.is_public_any_origin ?? false)) {
    return Response.json({ error: 'Forbidden origin' }, { status: 403 });
  }

  // Fetch published fields
  const { data: fields } = await client
    .from('form_fields')
    .select('key, label, field_type, is_required, options, placeholder, help_text')
    .eq('form_version_id', form.current_version_id)
    .order('position', { ascending: true });

  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=60, s-maxage=300',
  };

  return Response.json(
    {
      form: {
        publicKey: form.public_key,
        name: form.name,
        fields: fields ?? [],
      },
    },
    { headers: corsHeaders }
  );
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin') || '*';
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
