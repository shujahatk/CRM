import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, beforeEach, afterEach, expect, it } from 'vitest';

const w = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherW = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let db: PGlite;

async function actor(n: number) {
  await db.exec(`set local role authenticated;select set_config('request.jwt.claims','${JSON.stringify({
    sub: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    aal: 'aal2',
    role: 'authenticated',
  })}',true);`);
}

async function value<T>(sql: string, params: unknown[] = []): Promise<T> {
  const res = await db.query<{ v: T }>(sql, params);
  return res.rows[0].v;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(await readFile('tests/support/auth-compat.sql', 'utf8'));
  for (const f of (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(await readFile(`supabase/migrations/${f}`, 'utf8'));
  }
  await db.exec(await readFile('supabase/tests/fixtures.sql', 'utf8'));
});

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec('begin');
  await actor(1); // admin
  await value("select api.create_lead($1, 'Init Pipeline', null, null, null) v", [w]);
});

afterEach(async () => {
  await db.exec('rollback');
});

it('tracking site creation and allowed origins configuration', async () => {
  const site = await value<{ site_id: string; public_key: string }>(
    "select api.create_tracking_site($1, 'Marketing Landing Page', array['https://example.com'], false) v",
    [w]
  );
  expect(site.site_id).toBeTruthy();
  expect(site.public_key).toMatch(/^site_/);

  const status = await value<string>('select status v from crm.tracking_sites where id = $1', [site.site_id]);
  expect(status).toBe('active');
});

it('form draft -> publish version creates immutable published form version and fields', async () => {
  const site = await value<{ site_id: string; public_key: string }>(
    "select api.create_tracking_site($1, 'Site 1', array['https://example.com'], false) v",
    [w]
  );
  const form = await value<{ form_id: string; public_key: string }>(
    "select api.create_form($1, $2, 'Consultation Form') v",
    [w, site.site_id]
  );
  expect(form.form_id).toBeTruthy();

  const pipeline = await value<string>('select id v from crm.pipelines where workspace_id = $1 limit 1', [w]);
  const stage = await value<string>('select id v from crm.stages where workspace_id = $1 and pipeline_id = $2 limit 1', [w, pipeline]);

  const fields = JSON.stringify([
    { key: 'first_name', label: 'First Name', field_type: 'text', is_required: true },
    { key: 'email', label: 'Email', field_type: 'email', is_required: true },
    { key: 'phone', label: 'Phone', field_type: 'phone', is_required: false },
  ]);
  const config = JSON.stringify({
    title: 'Book a call',
    submit_button_text: 'Apply Now',
    redirect_url: 'https://example.com/thank-you',
  });

  const published = await value<{ version_id: string; version: number }>(
    'select api.publish_form_version($1, $2, $3, $4, $5::jsonb, $6::jsonb) v',
    [w, form.form_id, pipeline, stage, fields, config]
  );
  expect(published.version).toBe(1);

  const fieldCount = await value<number>('select count(*)::int v from crm.form_fields where form_version_id = $1', [published.version_id]);
  expect(fieldCount).toBe(3);
});

it('public form submission creates canonical lead, answers, attribution touch and first-touch snapshot', async () => {
  const site = await value<{ site_id: string }>("select api.create_tracking_site($1, 'Site', array['*'], true) v", [w]);
  const form = await value<{ form_id: string; public_key: string }>("select api.create_form($1, $2, 'Lead Form') v", [w, site.site_id]);
  const pipeline = await value<string>('select id v from crm.pipelines where workspace_id = $1 limit 1', [w]);
  const stage = await value<string>('select id v from crm.stages where workspace_id = $1 and pipeline_id = $2 limit 1', [w, pipeline]);

  await value('select api.publish_form_version($1, $2, $3, $4, $5::jsonb) v', [
    w, form.form_id, pipeline, stage,
    JSON.stringify([
      { key: 'name', label: 'Full Name', field_type: 'text', is_required: true },
      { key: 'email', label: 'Email', field_type: 'email', is_required: true },
    ])
  ]);

  // Switch to anon role for public submission
  await db.exec('set local role anon');

  const answers = JSON.stringify({ name: 'Alice Smith', email: 'alice@example.com' });
  const attribution = JSON.stringify({
    utm_source: 'facebook',
    utm_medium: 'cpc',
    utm_campaign: 'retargeting_q4',
    landing_url: 'https://example.com/landing',
    referrer: 'https://m.facebook.com'
  });

  const sub = await value<{ submission_id: string; lead_id: string; redirect_url: string }>(
    'select api.public_submit_form($1, $2::jsonb, $3, $4::jsonb) v',
    [form.public_key, answers, 'visitor_token_123', attribution]
  );

  expect(sub.submission_id).toBeTruthy();
  expect(sub.lead_id).toBeTruthy();

  await actor(1);

  // Verify lead created
  expect(await value<string>('select display_name v from crm.leads where id = $1', [sub.lead_id])).toBe('Alice Smith');

  // Verify answer stored
  expect(await value<string>("select typed_value v from crm.submission_answers where form_submission_id = $1 and field_key = 'email'", [sub.submission_id])).toBe('alice@example.com');

  // Verify attribution touch & snapshot
  const touch = await value<{ utm_source: string; utm_campaign: string }>(
    'select jsonb_build_object(\'utm_source\', utm_source, \'utm_campaign\', utm_campaign) v from crm.attribution_touches where lead_id = $1',
    [sub.lead_id]
  );
  expect(touch.utm_source).toBe('facebook');
  expect(touch.utm_campaign).toBe('retargeting_q4');

  const firstTouch = await value<string>(
    "select model v from crm.lead_attribution_snapshots where lead_id = $1 and model = 'first_touch'",
    [sub.lead_id]
  );
  expect(firstTouch).toBe('first_touch');
});

it('duplicate form submission with same idempotency key replays cached response', async () => {
  const site = await value<{ site_id: string }>("select api.create_tracking_site($1, 'Site', array['*'], true) v", [w]);
  const form = await value<{ form_id: string; public_key: string }>("select api.create_form($1, $2, 'Lead Form') v", [w, site.site_id]);
  const pipeline = await value<string>('select id v from crm.pipelines where workspace_id = $1 limit 1', [w]);
  const stage = await value<string>('select id v from crm.stages where workspace_id = $1 and pipeline_id = $2 limit 1', [w, pipeline]);
  await value('select api.publish_form_version($1, $2, $3, $4, $5::jsonb) v', [
    w, form.form_id, pipeline, stage,
    JSON.stringify([{ key: 'email', label: 'Email', field_type: 'email' }])
  ]);

  await db.exec('set local role anon');
  const answers = JSON.stringify({ email: 'bob@example.com' });
  const key = 'form_idem_001';

  const sub1 = await value<{ submission_id: string }>(
    'select api.public_submit_form($1, $2::jsonb, $3, $4::jsonb, $5) v',
    [form.public_key, answers, 'vid_1', '{}', key]
  );

  const sub2 = await value<{ submission_id: string }>(
    'select api.public_submit_form($1, $2::jsonb, $3, $4::jsonb, $5) v',
    [form.public_key, answers, 'vid_1', '{}', key]
  );

  await actor(1);
  expect(sub1.submission_id).toBe(sub2.submission_id);
  expect(await value<number>('select count(*)::int v from crm.form_submissions where idempotency_key = $1', [key])).toBe(1);
});

it('idempotency key reused with mismatched payload throws 40001 conflict', async () => {
  const site = await value<{ site_id: string }>("select api.create_tracking_site($1, 'Site', array['*'], true) v", [w]);
  const form = await value<{ form_id: string; public_key: string }>("select api.create_form($1, $2, 'Lead Form') v", [w, site.site_id]);
  const pipeline = await value<string>('select id v from crm.pipelines where workspace_id = $1 limit 1', [w]);
  const stage = await value<string>('select id v from crm.stages where workspace_id = $1 and pipeline_id = $2 limit 1', [w, pipeline]);
  await value('select api.publish_form_version($1, $2, $3, $4, $5::jsonb) v', [
    w, form.form_id, pipeline, stage,
    JSON.stringify([{ key: 'email', label: 'Email', field_type: 'email' }])
  ]);

  await db.exec('set local role anon');
  const key = 'form_idem_diff';

  await value('select api.public_submit_form($1, $2::jsonb, $3, $4::jsonb, $5) v', [
    form.public_key, JSON.stringify({ email: 'first@example.com' }), 'vid_1', '{}', key
  ]);

  await expect(
    value('select api.public_submit_form($1, $2::jsonb, $3, $4::jsonb, $5) v', [
      form.public_key, JSON.stringify({ email: 'second@example.com' }), 'vid_1', '{}', key
    ])
  ).rejects.toMatchObject({ code: '40001' });
});

it('ambiguous identity conflict logs open conflict and leaves submission with lead_id = null', async () => {
  // Setup: Lead 1 has email, Lead 2 has phone
  const lead1 = await value<string>("select api.create_lead($1, 'User One', 'user1@example.com', null, null) v", [w]);
  const lead2 = await value<string>("select api.create_lead($1, 'User Two', null, '+14155552671', null) v", [w]);
  expect(lead1).not.toBe(lead2);

  const site = await value<{ site_id: string }>("select api.create_tracking_site($1, 'Site', array['*'], true) v", [w]);
  const form = await value<{ form_id: string; public_key: string }>("select api.create_form($1, $2, 'Conflict Form') v", [w, site.site_id]);
  const pipeline = await value<string>('select id v from crm.pipelines where workspace_id = $1 limit 1', [w]);
  const stage = await value<string>('select id v from crm.stages where workspace_id = $1 and pipeline_id = $2 limit 1', [w, pipeline]);
  await value('select api.publish_form_version($1, $2, $3, $4, $5::jsonb) v', [
    w, form.form_id, pipeline, stage,
    JSON.stringify([
      { key: 'email', label: 'Email', field_type: 'email' },
      { key: 'phone', label: 'Phone', field_type: 'phone' }
    ])
  ]);

  await db.exec('set local role anon');
  // Submitting email of Lead 1 and phone of Lead 2
  const sub = await value<{ submission_id: string; lead_id: string | null }>(
    'select api.public_submit_form($1, $2::jsonb, $3, $4::jsonb) v',
    [form.public_key, JSON.stringify({ email: 'user1@example.com', phone: '+14155552671' }), 'vid_conflict', '{}']
  );

  expect(sub.submission_id).toBeTruthy();
  expect(sub.lead_id).toBeNull();

  // Verify conflict was recorded in crm.identity_conflicts
  await actor(1);
  expect(await value<number>("select count(*)::int v from crm.identity_conflicts where workspace_id = $1 and intake_source = 'form_submit'", [w])).toBe(1);
});

it('shared visitor on distinct sessions for Lead A and Lead B creates distinct provenance links without cross-contaminating history', async () => {
  const site = await value<{ site_id: string }>("select api.create_tracking_site($1, 'Site', array['*'], true) v", [w]);
  const form = await value<{ form_id: string; public_key: string }>("select api.create_form($1, $2, 'Shared Form') v", [w, site.site_id]);
  const pipeline = await value<string>('select id v from crm.pipelines where workspace_id = $1 limit 1', [w]);
  const stage = await value<string>('select id v from crm.stages where workspace_id = $1 and pipeline_id = $2 limit 1', [w, pipeline]);
  await value('select api.publish_form_version($1, $2, $3, $4, $5::jsonb) v', [
    w, form.form_id, pipeline, stage,
    JSON.stringify([{ key: 'email', label: 'Email', field_type: 'email' }])
  ]);

  await db.exec('set local role anon');
  const sharedVid = 'shared_browser_token_xyz';

  // Session 1: Lead A submits with Campaign A
  const subA = await value<{ submission_id: string; lead_id: string }>(
    'select api.public_submit_form($1, $2::jsonb, $3, $4::jsonb) v',
    [form.public_key, JSON.stringify({ email: 'personA@example.com' }), sharedVid, JSON.stringify({ utm_campaign: 'campaign_A' })]
  );

  // Session 2: Lead B submits on same browser with Campaign B
  const subB = await value<{ submission_id: string; lead_id: string }>(
    'select api.public_submit_form($1, $2::jsonb, $3, $4::jsonb) v',
    [form.public_key, JSON.stringify({ email: 'personB@example.com' }), sharedVid, JSON.stringify({ utm_campaign: 'campaign_B' })]
  );

  await actor(1);
  expect(subA.lead_id).not.toBe(subB.lead_id);

  // Lead A's first touch must strictly be campaign A
  const leadATouch = await value<string>(
    'select t.utm_campaign v from crm.lead_attribution_snapshots s join crm.attribution_touches t on t.id = s.attribution_touch_id where s.lead_id = $1 and s.model = \'first_touch\'',
    [subA.lead_id]
  );
  expect(leadATouch).toBe('campaign_A');

  // Lead B's first touch must strictly be campaign B
  const leadBTouch = await value<string>(
    'select t.utm_campaign v from crm.lead_attribution_snapshots s join crm.attribution_touches t on t.id = s.attribution_touch_id where s.lead_id = $1 and s.model = \'first_touch\'',
    [subB.lead_id]
  );
  expect(leadBTouch).toBe('campaign_B');

  // Provenance links are distinct
  expect(await value<number>('select count(*)::int v from crm.visitor_lead_links where workspace_id = $1', [w])).toBe(2);
});

it('VSL continuous interval merging: [0, 20] and [80, 100] yields 40 unique seconds (NOT 100)', async () => {
  const site = await value<{ site_id: string }>("select api.create_tracking_site($1, 'Site', array['*'], true) v", [w]);
  const vsl = await value<{ asset_id: string; public_key: string }>(
    "select api.create_vsl_asset($1, $2, 'Main VSL', 600, 'custom', null) v",
    [w, site.site_id]
  );

  await db.exec('set local role anon');
  const session = await value<{ vsl_session_id: string; duration_seconds: number }>(
    'select api.start_vsl_session($1, $2) v',
    [vsl.public_key, 'visitor_vsl_1']
  );
  expect(session.duration_seconds).toBe(600);

  // Heartbeat 1: watched 0-20 seconds
  await value('select api.record_vsl_heartbeat($1, $2::jsonb) v', [
    session.vsl_session_id,
    JSON.stringify([[0, 5], [5, 10], [10, 20]])
  ]);

  // Heartbeat 2: viewer skipped to 80 and watched 80-100 seconds
  const hb2 = await value<{ unique_seconds_watched: number; completion_percent: number; completed: boolean }>(
    'select api.record_vsl_heartbeat($1, $2::jsonb) v',
    [
      session.vsl_session_id,
      JSON.stringify([[80, 85], [85, 90], [90, 100]])
    ]
  );

  // Invariant check: 20s + 20s = 40 unique seconds (NOT 100s)
  expect(hb2.unique_seconds_watched).toBe(40);
  expect(hb2.completion_percent).toBe(6.67); // 40 / 600 * 100
  expect(hb2.completed).toBe(false);

  // Overlapping interval check: viewer re-watches [15, 30]
  const hb3 = await value<{ unique_seconds_watched: number }>(
    'select api.record_vsl_heartbeat($1, $2::jsonb) v',
    [
      session.vsl_session_id,
      JSON.stringify([[15, 30]])
    ]
  );
  // Merged: [0, 30] (30s) + [80, 100] (20s) = 50 unique seconds
  expect(hb3.unique_seconds_watched).toBe(50);
});

it('anonymous VSL session remains anonymous (lead_id = null) after later form submission', async () => {
  const site = await value<{ site_id: string }>("select api.create_tracking_site($1, 'Site', array['*'], true) v", [w]);
  const vsl = await value<{ asset_id: string; public_key: string }>(
    "select api.create_vsl_asset($1, $2, 'Discovery VSL', 300, 'custom', null) v",
    [w, site.site_id]
  );
  const form = await value<{ form_id: string; public_key: string }>("select api.create_form($1, $2, 'Form') v", [w, site.site_id]);
  const pipeline = await value<string>('select id v from crm.pipelines where workspace_id = $1 limit 1', [w]);
  const stage = await value<string>('select id v from crm.stages where workspace_id = $1 and pipeline_id = $2 limit 1', [w, pipeline]);
  await value('select api.publish_form_version($1, $2, $3, $4, $5::jsonb) v', [
    w, form.form_id, pipeline, stage,
    JSON.stringify([{ key: 'email', label: 'Email', field_type: 'email' }])
  ]);

  // Public visitor starts session & watches 0-30s
  await db.exec('set local role anon');
  const token = 'anon_vid_999';
  const vslSession = await value<{ vsl_session_id: string }>(
    'select api.start_vsl_session($1, $2) v',
    [vsl.public_key, token]
  );
  await value('select api.record_vsl_heartbeat($1, $2::jsonb) v', [
    vslSession.vsl_session_id,
    JSON.stringify([[0, 30]])
  ]);

  // Lead submits form later
  const sub = await value<{ lead_id: string }>(
    'select api.public_submit_form($1, $2::jsonb, $3, $4::jsonb) v',
    [form.public_key, JSON.stringify({ email: 'late_submit@example.com' }), token, '{}']
  );

  // Switch to staff to inspect
  await actor(1);

  // Invariant (Correction 5): Anonymous session's row in crm.vsl_sessions MUST NOT be mutated to lead_id = sub.lead_id
  const sessionLeadId = await value<string | null>('select lead_id v from crm.vsl_sessions where id = $1', [vslSession.vsl_session_id]);
  expect(sessionLeadId).toBeNull();

  // BUT Lead Detail VSL query resolves it via visitor_lead_links!
  const leadHistory = await value<Array<{ vsl_name: string; total_unique_seconds_watched: number }>>(
    'select api.get_lead_vsl_history($1, $2) v',
    [w, sub.lead_id]
  );
  expect(leadHistory).toHaveLength(1);
  expect(leadHistory[0].vsl_name).toBe('Discovery VSL');
  expect(leadHistory[0].total_unique_seconds_watched).toBe(30);
});

it('known-lead VSL session carries direct lead_id at session start', async () => {
  const leadId = await value<string>("select api.create_lead($1, 'Known Lead', 'known@example.com', null, null) v", [w]);
  const site = await value<{ site_id: string }>("select api.create_tracking_site($1, 'Site', array['*'], true) v", [w]);
  const vsl = await value<{ asset_id: string; public_key: string }>(
    "select api.create_vsl_asset($1, $2, 'Client VSL', 120, 'custom', null) v",
    [w, site.site_id]
  );

  await db.exec('set local role anon');
  const session = await value<{ vsl_session_id: string }>(
    'select api.start_vsl_session($1, $2, $3) v',
    [vsl.public_key, 'token_xyz', leadId]
  );

  await actor(1);
  const storedLeadId = await value<string>('select lead_id v from crm.vsl_sessions where id = $1', [session.vsl_session_id]);
  expect(storedLeadId).toBe(leadId);
});

it('cross-workspace composite foreign key constraint denies cross-tenant referencing', async () => {
  const site = await value<{ site_id: string }>("select api.create_tracking_site($1, 'Site', array['*'], true) v", [w]);
  const form = await value<{ form_id: string }>("select api.create_form($1, $2, 'Form W1') v", [w, site.site_id]);

  // Attempting to insert a form_version in workspace B referencing a form in workspace A
  await db.exec('reset role');
  await expect(
    db.exec(`
      insert into crm.form_versions(workspace_id, form_id, version, pipeline_id, stage_id, published_by_membership_id)
      values ('${otherW}', '${form.form_id}', 1, gen_random_uuid(), gen_random_uuid(), gen_random_uuid())
    `)
  ).rejects.toMatchObject({ code: '23503' }); // foreign_key_violation
});

it('immutability triggers block update or delete on historical tables', async () => {
  const site = await value<{ site_id: string }>("select api.create_tracking_site($1, 'Site', array['*'], true) v", [w]);
  const form = await value<{ form_id: string; public_key: string }>("select api.create_form($1, $2, 'Form') v", [w, site.site_id]);
  const pipeline = await value<string>('select id v from crm.pipelines where workspace_id = $1 limit 1', [w]);
  const stage = await value<string>('select id v from crm.stages where workspace_id = $1 and pipeline_id = $2 limit 1', [w, pipeline]);
  await value('select api.publish_form_version($1, $2, $3, $4, $5::jsonb) v', [
    w, form.form_id, pipeline, stage,
    JSON.stringify([{ key: 'email', label: 'Email', field_type: 'email' }])
  ]);

  await db.exec('set local role anon');
  const sub = await value<{ submission_id: string }>(
    'select api.public_submit_form($1, $2::jsonb, $3, $4::jsonb) v',
    [form.public_key, JSON.stringify({ email: 'immut@example.com' }), 'v1', '{}']
  );

  // Privileged direct SQL attempts to mutate or delete submission
  await db.exec('reset role');
  await db.exec('savepoint sp_immut1');
  await expect(db.exec(`update crm.form_submissions set raw_answers = '{"tampered": true}' where id = '${sub.submission_id}'`))
    .rejects.toMatchObject({ code: '42501' });
  await db.exec('rollback to savepoint sp_immut1');

  await db.exec('savepoint sp_immut2');
  await expect(db.exec(`delete from crm.form_submissions where id = '${sub.submission_id}'`))
    .rejects.toMatchObject({ code: '42501' });
  await db.exec('rollback to savepoint sp_immut2');
});

it('read-only member cannot create forms or VSL assets', async () => {
  const site = await value<{ site_id: string }>("select api.create_tracking_site($1, 'Site', array['*'], true) v", [w]);
  await actor(5); // user 5 is read_only

  await db.exec('savepoint sp_ro1');
  await expect(value("select api.create_form($1, $2, 'Illegal Form') v", [w, site.site_id]))
    .rejects.toMatchObject({ code: '42501' });
  await db.exec('rollback to savepoint sp_ro1');

  await db.exec('savepoint sp_ro2');
  await expect(value("select api.create_vsl_asset($1, $2, 'Illegal VSL', 100) v", [w, site.site_id]))
    .rejects.toMatchObject({ code: '42501' });
  await db.exec('rollback to savepoint sp_ro2');
});
