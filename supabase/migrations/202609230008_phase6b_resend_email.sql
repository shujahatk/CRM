-- ====================================================================
-- 80/20 CRM — PHASE 6B MIGRATION: RESEND EMAIL PROVIDER INTEGRATION
-- Additive only: strictly preserves migrations 001–007 untouched.
-- Establishes provider reference indexes, expands message event types
-- for observational/compliance events, and implements server-side
-- webhook workspace resolution and Resend event reconciliation.
-- ====================================================================

-- 1. Index on crm.messages provider reference for fast webhook reconciliation
create index if not exists idx_messages_provider_ref 
  on crm.messages(workspace_id, provider_message_id) 
  where provider_message_id is not null;

-- 2. Index on private.provider_operations provider message id
create index if not exists idx_provider_operations_provider_msg_id 
  on private.provider_operations(workspace_id, provider, provider_message_id) 
  where provider_message_id is not null;

-- 3. Extend crm.message_events.event_type check constraint
-- Permits observational events (opened, clicked, delivery_delayed) and compliance events (complained)
do $$
begin
  alter table crm.message_events 
    drop constraint if exists message_events_event_type_check;

  alter table crm.message_events 
    add constraint message_events_event_type_check 
    check (event_type in (
      'draft_created', 'queued', 'dispatch_started', 'provider_accepted', 
      'sent', 'delivered', 'failed', 'bounced', 'received', 'cancelled', 
      'suppressed', 'delivery_delayed', 'opened', 'clicked', 'complained'
    ));
end $$;

-- 4. Extend private.provider_webhook_quarantine quarantine_reason check constraint
-- Permits 'ambiguous_account_mapping' per Phase 6B Correction 1
do $$
begin
  alter table private.provider_webhook_quarantine 
    drop constraint if exists provider_webhook_quarantine_quarantine_reason_check;

  alter table private.provider_webhook_quarantine 
    add constraint provider_webhook_quarantine_quarantine_reason_check 
    check (quarantine_reason in (
      'conflicting_payload', 'unresolved_account', 'ambiguous_account_mapping', 
      'unsupported_event', 'invalid_mapping', 'suspicious_replay'
    ));
end $$;

-- 5. Adjust crm.identity_claims unique constraint to allow multiple lead claims per identity
-- This enables ambiguous identity conflict detection when multiple leads claim the same email
do $$
begin
  alter table crm.identity_claims 
    drop constraint if exists identity_claims_workspace_id_identity_id_key;

  if not exists (
    select 1 from pg_constraint where conname = 'identity_claims_workspace_lead_identity_unique'
  ) then
    alter table crm.identity_claims 
      add constraint identity_claims_workspace_lead_identity_unique 
      unique (workspace_id, lead_id, identity_id);
  end if;
end $$;

-- 6. Webhook Workspace Resolution Engine (Correction 1)
-- Resolves workspace authoritatively from provider evidence.
-- Outbound events: resolves provider operation / message provider reference.
-- Inbound events: resolves active channel account + provider connection relationship.
create or replace function private.resolve_resend_webhook_workspace(
  p_event_type text,
  p_provider_email_id text,
  p_recipient_address text default null
)
returns table (
  workspace_id uuid,
  message_id uuid,
  channel_account_id uuid,
  provider_connection_id uuid,
  resolution_state text
)
language plpgsql
security definer
set search_path = public, crm, private, pg_temp
as $$
declare
  v_count integer;
  v_res record;
begin
  -- Case A: Outbound events (identified by provider_email_id)
  if p_event_type <> 'email.received' and p_provider_email_id is not null and p_provider_email_id <> '' then
    -- Check private.provider_operations first
    select po.workspace_id, po.message_id, po.provider_connection_id, j.channel_account_id
    into v_res
    from private.provider_operations po
    left join private.provider_dispatch_jobs j 
      on j.workspace_id = po.workspace_id and j.message_id = po.message_id
    where po.provider = 'resend' 
      and po.provider_message_id = p_provider_email_id
    limit 1;

    if found and v_res.workspace_id is not null then
      return query select 
        v_res.workspace_id, 
        v_res.message_id, 
        v_res.channel_account_id, 
        v_res.provider_connection_id, 
        'resolved'::text;
      return;
    end if;

    -- Check crm.messages directly if operation link wasn't populated
    select m.workspace_id, m.id as message_id, null::uuid as channel_account_id, null::uuid as provider_connection_id
    into v_res
    from crm.messages m
    where m.channel = 'email' 
      and m.provider_message_id = p_provider_email_id
    limit 1;

    if found and v_res.workspace_id is not null then
      return query select 
        v_res.workspace_id, 
        v_res.message_id, 
        v_res.channel_account_id, 
        v_res.provider_connection_id, 
        'resolved'::text;
      return;
    end if;

    -- Unresolved outbound email_id
    return query select null::uuid, null::uuid, null::uuid, null::uuid, 'unresolved'::text;
    return;
  end if;

  -- Case B: Inbound events (email.received resolved through active channel account)
  if p_event_type = 'email.received' and p_recipient_address is not null and p_recipient_address <> '' then
    select count(*)
    into v_count
    from crm.channel_accounts ca
    join crm.provider_connections pc 
      on pc.workspace_id = ca.workspace_id and pc.id = ca.provider_connection_id
    where ca.channel = 'email'
      and ca.status = 'active'
      and lower(btrim(ca.sender_address)) = lower(btrim(p_recipient_address))
      and pc.provider = 'resend'
      and pc.connection_state in ('configured', 'active', 'verification_required');

    if v_count = 1 then
      select ca.workspace_id, null::uuid as message_id, ca.id as channel_account_id, ca.provider_connection_id
      into v_res
      from crm.channel_accounts ca
      join crm.provider_connections pc 
        on pc.workspace_id = ca.workspace_id and pc.id = ca.provider_connection_id
      where ca.channel = 'email'
        and ca.status = 'active'
        and lower(btrim(ca.sender_address)) = lower(btrim(p_recipient_address))
        and pc.provider = 'resend'
        and pc.connection_state in ('configured', 'active', 'verification_required')
      limit 1;

      return query select 
        v_res.workspace_id, 
        v_res.message_id, 
        v_res.channel_account_id, 
        v_res.provider_connection_id, 
        'resolved'::text;
      return;
    elsif v_count > 1 then
      return query select null::uuid, null::uuid, null::uuid, null::uuid, 'ambiguous'::text;
      return;
    else
      return query select null::uuid, null::uuid, null::uuid, null::uuid, 'unresolved'::text;
      return;
    end if;
  end if;

  return query select null::uuid, null::uuid, null::uuid, null::uuid, 'unresolved'::text;
end;
$$;

revoke all on function private.resolve_resend_webhook_workspace from public, anon, authenticated;

-- 6. Resend Webhook Event Processing Stored Procedure
-- Handles status reconciliation, permanent bounce / complaint suppressions,
-- observational tracking events, and canonical inbound ingestion.
create or replace function private.process_resend_webhook_event(
  p_workspace_id uuid,
  p_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, crm, private, pg_temp
as $$
declare
  v_event record;
  v_payload jsonb;
  v_data jsonb;
  v_type text;
  v_provider_email_id text;
  v_msg record;
  v_lead_id uuid;
  v_recipient text;
  v_sender text;
  v_bounce_type text;
  v_bounce_subtype text;
  v_is_permanent_bounce boolean;
  v_identity_matches uuid[];
  v_conv_id uuid;
  v_inbound_msg_id uuid;
  v_review_id uuid;
  v_channel_account_id uuid;
  v_norm_sender text;
  v_norm_recipient text;
  v_subject text;
  v_text_body text;
  v_attachments_meta jsonb;
begin
  -- 1. Load webhook event
  select * into v_event
  from private.provider_webhook_events
  where workspace_id = p_workspace_id and id = p_event_id;

  if not found then
    raise exception 'webhook_event_not_found';
  end if;

  if v_event.processing_state = 'processed' then
    return jsonb_build_object('status', 'already_processed', 'event_id', p_event_id);
  end if;

  v_payload := v_event.sanitized_payload;
  v_type := coalesce(v_event.event_type, v_payload->>'type');
  v_data := coalesce(v_payload->'data', '{}'::jsonb);
  v_provider_email_id := coalesce(v_data->>'email_id', v_data->>'id', '');

  -- 2. Process Outbound Lifecycle Events
  if v_type in ('email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.complained', 'email.failed', 'email.opened', 'email.clicked') then
    -- Locate message
    select * into v_msg
    from crm.messages
    where workspace_id = p_workspace_id 
      and provider_message_id = v_provider_email_id;

    if not found then
      -- Message not found by email_id, mark processed with note
      update private.provider_webhook_events
      set processing_state = 'processed',
          processed_at = now(),
          error_detail = 'message_not_found_for_provider_email_id'
      where workspace_id = p_workspace_id and id = p_event_id;

      return jsonb_build_object('status', 'message_not_found', 'provider_email_id', v_provider_email_id);
    end if;

    v_recipient := lower(btrim(coalesce(v_msg.recipient_address, '')));
    v_lead_id := v_msg.lead_id;

    -- A. Sent event
    if v_type = 'email.sent' then
      perform private.apply_message_status_event(
        p_workspace_id,
        v_msg.id,
        'resend',
        'sent',
        v_event.external_event_id,
        v_event.payload_hash,
        jsonb_build_object('provider_email_id', v_provider_email_id)
      );
      if v_msg.sent_at is null then
        update crm.messages set sent_at = coalesce(v_event.provider_timestamp, now()) 
        where workspace_id = p_workspace_id and id = v_msg.id;
      end if;

    -- B. Delivered event
    elsif v_type = 'email.delivered' then
      perform private.apply_message_status_event(
        p_workspace_id,
        v_msg.id,
        'resend',
        'delivered',
        v_event.external_event_id,
        v_event.payload_hash,
        jsonb_build_object('provider_email_id', v_provider_email_id)
      );
      if v_msg.delivered_at is null then
        update crm.messages set delivered_at = coalesce(v_event.provider_timestamp, now()) 
        where workspace_id = p_workspace_id and id = v_msg.id;
      end if;

    -- C. Delivery Delayed (Correction 3: Observational only, NO permanent suppression, NO status regression)
    elsif v_type = 'email.delivery_delayed' then
      insert into crm.message_events (
        workspace_id,
        message_id,
        event_type,
        from_status,
        to_status,
        details
      ) values (
        p_workspace_id,
        v_msg.id,
        'delivery_delayed',
        v_msg.status,
        v_msg.status,
        jsonb_build_object(
          'provider', 'resend',
          'provider_event_id', v_event.external_event_id,
          'payload_hash', v_event.payload_hash,
          'message', v_data->'delivery'->>'message',
          'provider_email_id', v_provider_email_id
        )
      );

    -- D. Bounced event (Correction 3: Distinguish permanent bounce from transient)
    elsif v_type = 'email.bounced' then
      v_bounce_type := coalesce(v_data->'bounce'->>'type', '');
      v_bounce_subtype := coalesce(v_data->'bounce'->>'subType', '');
      v_is_permanent_bounce := (
        lower(v_bounce_type) = 'permanent' 
        or lower(v_bounce_subtype) = 'suppressed'
        or v_bounce_type = '' -- Default to conservative permanent bounce if unspecified
      );

      if v_is_permanent_bounce then
        -- Terminal status update
        perform private.apply_message_status_event(
          p_workspace_id,
          v_msg.id,
          'resend',
          'bounced',
          v_event.external_event_id,
          v_event.payload_hash,
          jsonb_build_object(
            'provider_email_id', v_provider_email_id,
            'bounce_type', v_bounce_type,
            'bounce_subtype', v_bounce_subtype,
            'message', v_data->'bounce'->>'message'
          )
        );

        -- Feed canonical suppression framework
        if v_recipient <> '' and not exists (
          select 1 from crm.suppressions
          where workspace_id = p_workspace_id
            and scope = 'destination_block'
            and channel = 'email'
            and destination_normalized = v_recipient
            and status = 'active'
        ) then
          insert into crm.suppressions (
            workspace_id,
            scope,
            destination_normalized,
            channel,
            lead_id,
            reason,
            source,
            status
          ) values (
            p_workspace_id,
            'destination_block',
            v_recipient,
            'email',
            v_lead_id,
            'hard_bounce',
            'provider_webhook',
            'active'
          );
        end if;
      else
        -- Transient / delayed bounce recorded as audit event without permanent suppression
        insert into crm.message_events (
          workspace_id,
          message_id,
          event_type,
          from_status,
          to_status,
          details
        ) values (
          p_workspace_id,
          v_msg.id,
          'delivery_delayed',
          v_msg.status,
          v_msg.status,
          jsonb_build_object(
            'provider', 'resend',
            'provider_event_id', v_event.external_event_id,
            'bounce_type', v_bounce_type,
            'bounce_subtype', v_bounce_subtype,
            'is_transient', true
          )
        );
      end if;

    -- E. Complained event (Correction 2: Event + Suppression; message status NOT set to complained)
    elsif v_type = 'email.complained' then
      -- Record complained in crm.message_events
      insert into crm.message_events (
        workspace_id,
        message_id,
        event_type,
        from_status,
        to_status,
        details
      ) values (
        p_workspace_id,
        v_msg.id,
        'complained',
        v_msg.status,
        v_msg.status,
        jsonb_build_object(
          'provider', 'resend',
          'provider_event_id', v_event.external_event_id,
          'payload_hash', v_event.payload_hash,
          'provider_email_id', v_provider_email_id,
          'complaint_feedback', v_data->'complaint'
        )
      );

      -- Feed canonical suppression framework
      if v_recipient <> '' and not exists (
        select 1 from crm.suppressions
        where workspace_id = p_workspace_id
          and scope = 'destination_block'
          and channel = 'email'
          and destination_normalized = v_recipient
          and status = 'active'
      ) then
        insert into crm.suppressions (
          workspace_id,
          scope,
          destination_normalized,
          channel,
          lead_id,
          reason,
          source,
          status
        ) values (
          p_workspace_id,
          'destination_block',
          v_recipient,
          'email',
          v_lead_id,
          'spam_complaint',
          'provider_webhook',
          'active'
        );
      end if;

    -- F. Failed event
    elsif v_type = 'email.failed' then
      perform private.apply_message_status_event(
        p_workspace_id,
        v_msg.id,
        'resend',
        'failed',
        v_event.external_event_id,
        v_event.payload_hash,
        jsonb_build_object(
          'provider_email_id', v_provider_email_id,
          'error', v_data->>'error'
        )
      );

    -- G. Tracking events: Opened & Clicked (Observational only)
    elsif v_type in ('email.opened', 'email.clicked') then
      insert into crm.message_events (
        workspace_id,
        message_id,
        event_type,
        from_status,
        to_status,
        details
      ) values (
        p_workspace_id,
        v_msg.id,
        case when v_type = 'email.opened' then 'opened' else 'clicked' end,
        v_msg.status,
        v_msg.status,
        jsonb_build_object(
          'provider', 'resend',
          'provider_event_id', v_event.external_event_id,
          'payload_hash', v_event.payload_hash,
          'provider_email_id', v_provider_email_id,
          'click_data', v_data->'click'
        )
      );
    end if;

  -- 3. Process Inbound Email Event (email.received)
  elsif v_type = 'email.received' then
    v_norm_sender := lower(btrim(coalesce(v_data->>'from', '')));
    -- Extract first recipient
    v_norm_recipient := lower(btrim(coalesce(
      v_data->'to'->>0, 
      case when jsonb_typeof(v_data->'to') = 'string' then v_data->>'to' else '' end
    )));
    v_subject := coalesce(v_data->>'subject', '(No Subject)');
    v_text_body := coalesce(v_data->>'text', v_data->>'snippet', '(Inbound message content in provider inbox)');
    v_attachments_meta := coalesce(v_data->'attachments', '[]'::jsonb);

    -- Check if inbound message or review already exists for this provider_email_id (deduplication)
    if v_provider_email_id <> '' then
      select id into v_inbound_msg_id
      from crm.messages
      where workspace_id = p_workspace_id 
        and provider_message_id = v_provider_email_id
      limit 1;

      if v_inbound_msg_id is not null then
        update private.provider_webhook_events
        set processing_state = 'processed',
            processed_at = now()
        where workspace_id = p_workspace_id and id = p_event_id;

        return jsonb_build_object('status', 'already_processed', 'message_id', v_inbound_msg_id);
      end if;

      select id into v_review_id
      from crm.inbound_message_reviews
      where workspace_id = p_workspace_id 
        and provider_message_id = v_provider_email_id
      limit 1;

      if v_review_id is not null then
        update private.provider_webhook_events
        set processing_state = 'processed',
            processed_at = now()
        where workspace_id = p_workspace_id and id = p_event_id;

        return jsonb_build_object('status', 'already_reviewed', 'review_id', v_review_id);
      end if;
    end if;

    -- Resolve channel account for recipient
    select id into v_channel_account_id
    from crm.channel_accounts
    where workspace_id = p_workspace_id
      and channel = 'email'
      and status = 'active'
      and lower(btrim(sender_address)) = v_norm_recipient
    limit 1;

    -- Exact Identity Matching on crm.identities (email kind)
    select array_agg(distinct ic.lead_id) into v_identity_matches
    from crm.identities i
    join crm.identity_claims ic 
      on ic.identity_id = i.id and ic.active = true and ic.workspace_id = p_workspace_id
    where i.workspace_id = p_workspace_id
      and i.kind = 'email'
      and i.normalized_value = v_norm_sender;

    -- Case A: 0 matches -> Inbound Message Review
    if v_channel_account_id is null or v_identity_matches is null or cardinality(v_identity_matches) = 0 then
      insert into crm.inbound_message_reviews (
        workspace_id,
        channel,
        channel_account_id,
        sender_address_normalized,
        recipient_address,
        subject,
        text_body,
        provider_message_id,
        occurred_at,
        resolution_state,
        resolution_reason
      ) values (
        p_workspace_id,
        'email',
        v_channel_account_id,
        v_norm_sender,
        v_norm_recipient,
        v_subject,
        v_text_body,
        v_provider_email_id,
        coalesce(v_event.provider_timestamp, now()),
        'pending',
        case when v_channel_account_id is null then 'missing_channel_account' else 'unmatched_sender' end
      ) returning id into v_review_id;

    -- Case B: >1 matches -> Ambiguous Conflict Review
    elsif cardinality(v_identity_matches) > 1 then
      insert into crm.inbound_message_reviews (
        workspace_id,
        channel,
        channel_account_id,
        sender_address_normalized,
        recipient_address,
        subject,
        text_body,
        provider_message_id,
        occurred_at,
        resolution_state,
        resolution_reason,
        candidate_lead_ids
      ) values (
        p_workspace_id,
        'email',
        v_channel_account_id,
        v_norm_sender,
        v_norm_recipient,
        v_subject,
        v_text_body,
        v_provider_email_id,
        coalesce(v_event.provider_timestamp, now()),
        'pending',
        'ambiguous_identity_conflict',
        v_identity_matches
      ) returning id into v_review_id;

    -- Case C: Exactly 1 Match -> Attach to canonical lead conversation
    else
      v_lead_id := v_identity_matches[1];

      -- Locate or create conversation
      select id into v_conv_id
      from crm.conversations
      where workspace_id = p_workspace_id
        and lead_id = v_lead_id
        and channel = 'email'
        and channel_account_id = v_channel_account_id
        and lead_destination_normalized = v_norm_sender
      limit 1;

      if v_conv_id is null then
        insert into crm.conversations (
          workspace_id,
          lead_id,
          channel,
          channel_account_id,
          lead_destination_normalized,
          unread_count,
          last_message_at,
          last_message_snippet
        ) values (
          p_workspace_id,
          v_lead_id,
          'email',
          v_channel_account_id,
          v_norm_sender,
          1,
          coalesce(v_event.provider_timestamp, now()),
          left(v_text_body, 120)
        ) returning id into v_conv_id;
      else
        update crm.conversations
        set unread_count = unread_count + 1,
            last_message_at = coalesce(v_event.provider_timestamp, now()),
            last_message_snippet = left(v_text_body, 120),
            updated_at = now()
        where workspace_id = p_workspace_id and id = v_conv_id;
      end if;

      -- Insert canonical message
      insert into crm.messages (
        workspace_id,
        conversation_id,
        lead_id,
        channel,
        direction,
        sender_address,
        recipient_address,
        subject,
        text_body,
        status,
        dispatch_status,
        provider_message_id,
        delivered_at
      ) values (
        p_workspace_id,
        v_conv_id,
        v_lead_id,
        'email',
        'inbound',
        v_norm_sender,
        v_norm_recipient,
        v_subject,
        v_text_body,
        'received',
        'received',
        v_provider_email_id,
        coalesce(v_event.provider_timestamp, now())
      ) returning id into v_inbound_msg_id;

      -- Insert message event
      insert into crm.message_events (
        workspace_id,
        message_id,
        event_type,
        to_status,
        details
      ) values (
        p_workspace_id,
        v_inbound_msg_id,
        'received',
        'received',
        jsonb_build_object(
          'provider', 'resend',
          'provider_email_id', v_provider_email_id,
          'attachments_count', jsonb_array_length(v_attachments_meta)
        )
      );
    end if;
  end if;

  -- 4. Mark event processed
  update private.provider_webhook_events
  set processing_state = 'processed',
      processed_at = now()
  where workspace_id = p_workspace_id and id = p_event_id;

  return jsonb_build_object(
    'status', 'processed',
    'event_id', p_event_id,
    'event_type', v_type,
    'message_id', v_inbound_msg_id,
    'review_id', v_review_id
  );
end;
$$;

revoke all on function private.process_resend_webhook_event from public, anon, authenticated;

-- 7. Public API Webhook Ingestion RPC (Correction 1, 6, 8)
-- Authenticated server webhook endpoint invokes this RPC after cryptographic verification.
create or replace function api.ingest_resend_webhook(
  p_external_event_id text,
  p_event_type text,
  p_payload_hash text,
  p_sanitized_payload jsonb,
  p_provider_email_id text default null,
  p_recipient_address text default null,
  p_provider_timestamp timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, crm, private, pg_temp
as $$
declare
  v_res record;
  v_rec record;
  v_process_res jsonb;
  v_matching_ws record;
begin
  -- 1. Authoritative Workspace Resolution (Correction 1)
  select * into v_res
  from private.resolve_resend_webhook_workspace(
    p_event_type,
    p_provider_email_id,
    p_recipient_address
  );

  -- Case A: Unresolved account
  if v_res.resolution_state = 'unresolved' or v_res.workspace_id is null then
    -- Record quarantine evidence under any configured resend connection workspaces
    for v_matching_ws in (
      select distinct workspace_id 
      from crm.provider_connections 
      where provider = 'resend' and connection_state in ('configured', 'active', 'verification_required')
    ) loop
      insert into private.provider_webhook_quarantine (
        workspace_id,
        provider,
        external_event_id,
        quarantine_reason,
        payload_hash,
        sanitized_payload
      ) values (
        v_matching_ws.workspace_id,
        'resend',
        p_external_event_id,
        'unresolved_account',
        p_payload_hash,
        p_sanitized_payload
      );
    end loop;

    return jsonb_build_object(
      'outcome', 'unresolved_account',
      'error', 'No authoritative workspace could be resolved from provider evidence'
    );
  end if;

  -- Case B: Ambiguous account mapping (Correction 1)
  if v_res.resolution_state = 'ambiguous' then
    for v_matching_ws in (
      select distinct ca.workspace_id
      from crm.channel_accounts ca
      join crm.provider_connections pc on pc.workspace_id = ca.workspace_id and pc.id = ca.provider_connection_id
      where ca.channel = 'email'
        and ca.status = 'active'
        and lower(btrim(ca.sender_address)) = lower(btrim(p_recipient_address))
        and pc.provider = 'resend'
    ) loop
      insert into private.provider_webhook_quarantine (
        workspace_id,
        provider,
        external_event_id,
        quarantine_reason,
        payload_hash,
        sanitized_payload
      ) values (
        v_matching_ws.workspace_id,
        'resend',
        p_external_event_id,
        'ambiguous_account_mapping',
        p_payload_hash,
        p_sanitized_payload
      );
    end loop;

    return jsonb_build_object(
      'outcome', 'ambiguous_account_mapping',
      'error', 'Multiple active channel accounts match destination address'
    );
  end if;

  -- Case C: Exactly one authoritative workspace resolved -> Continue!
  -- 2. Ingest into durable webhook inbox with deduplication & quarantine
  select * into v_rec
  from private.record_webhook_event(
    v_res.workspace_id,
    'resend',
    p_external_event_id,
    p_event_type,
    p_payload_hash,
    p_sanitized_payload,
    null,
    p_provider_timestamp
  );

  -- 3. If received (new event), process event immediately (reconciliation / bounce / inbound)
  if v_rec.outcome = 'received' and v_rec.event_id is not null then
    v_process_res := private.process_resend_webhook_event(v_res.workspace_id, v_rec.event_id);
    return jsonb_build_object(
      'outcome', v_rec.outcome,
      'event_id', v_rec.event_id,
      'workspace_id', v_res.workspace_id,
      'processing', v_process_res
    );
  end if;

  return jsonb_build_object(
    'outcome', v_rec.outcome,
    'event_id', v_rec.event_id,
    'workspace_id', v_res.workspace_id
  );
end;
$$;

revoke all on function api.ingest_resend_webhook from public;
grant execute on function api.ingest_resend_webhook to anon, authenticated;

