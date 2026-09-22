-- Phase 6A.0 ONLY. Correct canonical authorization/contracts; no provider boundary.
-- Existing invalid relationships abort this transactional migration for operator review.
begin;


alter table crm.channel_accounts owner to crm_owner;

alter table crm.conversations owner to crm_owner;

alter table crm.conversation_participants owner to crm_owner;

alter table crm.message_templates owner to crm_owner;

alter table crm.message_template_versions owner to crm_owner;

alter table crm.messages owner to crm_owner;

alter table crm.message_events owner to crm_owner;

alter table crm.inbound_message_reviews owner to crm_owner;

alter table crm.suppressions owner to crm_owner;

alter table crm.campaigns owner to crm_owner;

alter table crm.campaign_recipients owner to crm_owner;

alter table crm.campaign_response_links owner to crm_owner;

alter table crm.sequences owner to crm_owner;

alter table crm.sequence_versions owner to crm_owner;

alter table crm.sequence_steps owner to crm_owner;

alter table crm.sequence_enrollments owner to crm_owner;

alter table crm.sequence_step_executions owner to crm_owner;

grant select on crm.consent_events to crm_owner;
set local role crm_owner;


-- A manager can review only evidence whose EVERY candidate is in their lead scope.
-- Unmatched/missing-account evidence has no team authority: Admin/Owner review only.
create function private.can_review_inbound(w uuid,candidates uuid[]) returns boolean
language sql stable security definer set search_path='' as $$
 select private.member_id(w) is not null and (
 private.member_role(w)='admin' or
 (private.member_role(w)='manager' and cardinality(candidates)>0 and
 not exists(select 1 from unnest(candidates) x where not private.can_work_lead(w,x))))
$$;
revoke all on function private.can_review_inbound(uuid,uuid[]) from public,anon;
grant execute on function private.can_review_inbound(uuid,uuid[]) to authenticated;

alter table crm.channel_accounts add unique(workspace_id,id,channel);
alter table crm.conversations add unique(workspace_id,id,lead_id,channel);
alter table crm.conversations add unique(workspace_id,id,lead_id);
alter table crm.conversations add constraint conversation_account_channel_fk
 foreign key(workspace_id,channel_account_id,channel) references crm.channel_accounts(workspace_id,id,channel);
alter table crm.messages add constraint message_conversation_subject_fk
 foreign key(workspace_id,conversation_id,lead_id,channel) references crm.conversations(workspace_id,id,lead_id,channel);
alter table crm.conversation_participants add constraint participant_conversation_lead_fk
 foreign key(workspace_id,conversation_id,lead_id) references crm.conversations(workspace_id,id,lead_id);
alter table crm.inbound_message_reviews add constraint review_account_channel_fk
 foreign key(workspace_id,channel_account_id,channel) references crm.channel_accounts(workspace_id,id,channel);
alter table crm.inbound_message_reviews add constraint review_resolved_conversation_fk
 foreign key(workspace_id,resolved_conversation_id,resolved_lead_id,channel) references crm.conversations(workspace_id,id,lead_id,channel);
alter table crm.messages add foreign key(workspace_id,campaign_id) references crm.campaigns(workspace_id,id);
alter table crm.messages add foreign key(workspace_id,sequence_enrollment_id) references crm.sequence_enrollments(workspace_id,id);
alter table crm.inbound_message_reviews add column resolution_notes text;
alter table crm.inbound_message_reviews add column resolved_message_id uuid;
alter table crm.inbound_message_reviews add foreign key(workspace_id,resolved_message_id) references crm.messages(workspace_id,id);

create function private.protect_inbound_evidence() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='DELETE' then raise exception using errcode='42501',message='Inbound evidence cannot be deleted'; end if;
 if TG_OP='UPDATE' and (
   (to_jsonb(new)-array['resolution_state','resolved_lead_id','resolved_conversation_id','resolved_by_membership_id','resolved_at','resolution_notes','resolved_message_id'])
   is distinct from
   (to_jsonb(old)-array['resolution_state','resolved_lead_id','resolved_conversation_id','resolved_by_membership_id','resolved_at','resolution_notes','resolved_message_id'])
   or old.resolution_state<>'pending') then
   raise exception using errcode='42501',message='Original inbound evidence is immutable';
 end if;
 if exists(select 1 from unnest(new.candidate_lead_ids) c where not exists(
   select 1 from crm.leads l where l.workspace_id=new.workspace_id and l.id=c)) then
   raise exception using errcode='23503',message='Candidate lead must belong to workspace';
 end if;
 return new;
end $$;
create trigger protect_inbound_evidence before insert or update or delete on crm.inbound_message_reviews
 for each row execute function private.protect_inbound_evidence();
revoke all on function private.protect_inbound_evidence() from public,anon,authenticated;


drop policy conversations_read on crm.conversations;
create policy conversations_read on crm.conversations for select to authenticated using (private.can_read_lead(workspace_id,lead_id));

drop policy messages_read on crm.messages;
create policy messages_read on crm.messages for select to authenticated using (private.can_read_lead(workspace_id,lead_id));

drop policy participants_read on crm.conversation_participants;
create policy participants_read on crm.conversation_participants for select to authenticated using (exists(select 1 from crm.conversations c where c.workspace_id=conversation_participants.workspace_id and c.id=conversation_id and private.can_read_lead(c.workspace_id,c.lead_id)));

drop policy message_events_read on crm.message_events;
create policy message_events_read on crm.message_events for select to authenticated using (exists(select 1 from crm.messages m where m.workspace_id=message_events.workspace_id and m.id=message_id and private.can_read_lead(m.workspace_id,m.lead_id)));

drop policy reviews_read on crm.inbound_message_reviews;
create policy reviews_read on crm.inbound_message_reviews for select to authenticated using (private.can_review_inbound(workspace_id,candidate_lead_ids));

drop policy campaign_recipients_read on crm.campaign_recipients;
create policy campaign_recipients_read on crm.campaign_recipients for select to authenticated using (private.can_read_lead(workspace_id,lead_id));

drop policy campaign_links_read on crm.campaign_response_links;
create policy campaign_links_read on crm.campaign_response_links for select to authenticated using (exists(select 1 from crm.messages m where m.workspace_id=campaign_response_links.workspace_id and m.id=inbound_message_id and private.can_read_lead(m.workspace_id,m.lead_id)));

drop policy sequence_enrollments_read on crm.sequence_enrollments;
create policy sequence_enrollments_read on crm.sequence_enrollments for select to authenticated using (private.can_read_lead(workspace_id,lead_id));

drop policy sequence_step_executions_read on crm.sequence_step_executions;
create policy sequence_step_executions_read on crm.sequence_step_executions for select to authenticated using (exists(select 1 from crm.sequence_enrollments e where e.workspace_id=sequence_step_executions.workspace_id and e.id=enrollment_id and private.can_read_lead(e.workspace_id,e.lead_id)));

drop policy suppressions_read on crm.suppressions;
create policy suppressions_read on crm.suppressions for select to authenticated using (private.member_role(workspace_id)='admin' or (lead_id is not null and private.can_work_lead(workspace_id,lead_id)));

reset role;

alter function private.is_suppressed(uuid,uuid,text,text) owner to crm_owner;

alter function api.create_outbound_message(uuid,uuid,text,text,text,text,text,uuid,text,uuid,jsonb) owner to crm_owner;

alter function api.ingest_inbound_message(uuid,text,text,text,text,text,text,text,timestamptz) owner to crm_owner;

alter function api.resolve_inbound_review(uuid,uuid,uuid,text) owner to crm_owner;

alter function api.upsert_channel_account(uuid,text,text,text,boolean) owner to crm_owner;

alter function api.create_template(uuid,text,text) owner to crm_owner;

alter function api.create_campaign(uuid,text,text,uuid,jsonb,integer) owner to crm_owner;

alter function api.create_sequence(uuid,text,text) owner to crm_owner;

alter function api.publish_sequence_version(uuid,uuid,jsonb,text[]) owner to crm_owner;

alter function api.publish_template_version(uuid,uuid,text,text) owner to crm_owner;

alter function api.add_suppression(uuid,text,text,text,uuid,text,timestamptz) owner to crm_owner;

alter function api.revoke_suppression(uuid,uuid,text) owner to crm_owner;

alter function api.launch_campaign(uuid,uuid,text) owner to crm_owner;

alter function api.cancel_campaign(uuid,uuid) owner to crm_owner;

alter function private.process_campaign_batch(uuid,uuid,integer) owner to crm_owner;

alter function api.enroll_lead_sequence(uuid,uuid,uuid) owner to crm_owner;

alter function private.process_sequence_step_execution(uuid,uuid) owner to crm_owner;

alter function api.list_conversations(uuid,text,text) owner to crm_owner;

alter function api.get_conversation_messages(uuid,uuid) owner to crm_owner;

alter function api.list_inbound_reviews(uuid) owner to crm_owner;

alter function api.list_message_templates(uuid) owner to crm_owner;

alter function api.list_campaigns(uuid) owner to crm_owner;

alter function api.list_sequences(uuid) owner to crm_owner;

set local role crm_owner;

create or replace function api.create_outbound_message(
  p_workspace uuid,
  p_lead_id uuid,
  p_channel text,
  p_recipient_address text,
  p_text_body text default null,
  p_subject text default null,
  p_html_body text default null,
  p_template_version_id uuid default null,
  p_command_key text default null,
  p_channel_account_id uuid default null,
  p_template_variables jsonb default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  role text;
  v_lead crm.leads%rowtype;
  v_account crm.channel_accounts%rowtype;
  v_tpl_ver crm.message_template_versions%rowtype;
  v_var text;
  v_is_opt boolean;
  v_clean_var text;
  v_val text;
  v_body text;
  v_subject text;
  v_conv_id uuid;
  v_msg_id uuid;
  v_norm_dest text;
  v_suppression jsonb;
  v_status text := 'queued';
  v_dispatch_status text := 'awaiting_provider';
begin
  actor := private.member_id(p_workspace);
  role := private.member_role(p_workspace);
  if actor is null or role = 'read_only' then
    raise exception using errcode='42501', message='Active member with sending permission required';
  end if;

  select * into v_lead from crm.leads where workspace_id = p_workspace and id = p_lead_id;
  if not found then raise exception using errcode='42501', message='Lead not found'; end if;

  if not private.can_work_lead(p_workspace, p_lead_id) then
    raise exception using errcode='42501', message='Not authorized to message unassigned lead';
  end if;

  -- Normalize recipient address
  if p_channel = 'email' then
    v_norm_dest := lower(btrim(p_recipient_address));
  else
    v_norm_dest := regexp_replace(btrim(p_recipient_address), '[[:space:]\-\(\)\.]+', '', 'g');
  end if;

  -- Resolve channel account
  if p_channel_account_id is not null then
    select * into v_account from crm.channel_accounts
    where workspace_id = p_workspace and id = p_channel_account_id and channel=p_channel and status = 'active';
    if not found then raise exception using errcode='42501', message='Channel account not found or inactive'; end if;
  else
    select * into v_account from crm.channel_accounts
    where workspace_id = p_workspace and channel = p_channel and status = 'active'
    order by is_default desc, created_at asc limit 1;
  end if;

  -- Template resolution & variable validation (Correction 3)
  v_body := p_text_body;
  v_subject := p_subject;

  if p_template_version_id is not null then
    select * into v_tpl_ver from crm.message_template_versions
    where workspace_id = p_workspace and id = p_template_version_id;
    if not found then raise exception using errcode='42501', message='Template version not found'; end if;

    v_body := v_tpl_ver.body;
    v_subject := coalesce(p_subject, v_tpl_ver.subject);

    foreach v_var in array v_tpl_ver.variables_used loop
      v_is_opt := (v_var like '%:optional');
      v_clean_var := replace(v_var, ':optional', '');

      v_val := null;
      if p_template_variables is not null and p_template_variables ? v_clean_var then
        v_val := p_template_variables->>v_clean_var;
      elsif v_clean_var = 'first_name' then
        v_val := split_part(v_lead.display_name, ' ', 1);
      elsif v_clean_var = 'last_name' then
        v_val := nullif(substring(v_lead.display_name from position(' ' in v_lead.display_name) + 1), '');
      elsif v_clean_var = 'company' then
        v_val := v_lead.company;
      end if;

      if v_val is null or btrim(v_val) = '' then
        if not v_is_opt then
          raise exception using errcode='22023', message='Missing required template variable: {{' || v_clean_var || '}}';
        else
          v_val := '';
        end if;
      end if;

      v_body := replace(v_body, '{{' || v_var || '}}', v_val);
      if v_subject is not null then
        v_subject := replace(v_subject, '{{' || v_var || '}}', v_val);
      end if;
    end loop;
  end if;

  if v_body is null or btrim(v_body) = '' then
    raise exception using errcode='22023', message='Message body cannot be empty';
  end if;

  -- Just-in-Time Suppression Check (Correction 10 & 11)
  v_suppression := private.is_suppressed(p_workspace, p_lead_id, p_channel, v_norm_dest);
  if (v_suppression->>'is_suppressed')::boolean then
    raise exception using errcode='22023', message='Recipient address is suppressed: ' || (v_suppression->>'reason');
  end if;

  -- Deterministic Conversation Identity (Correction 1)
  insert into crm.conversations(
    workspace_id, lead_id, channel, channel_account_id, lead_destination_normalized,
    last_message_at, last_message_snippet, unread_count
  ) values (
    p_workspace, p_lead_id, p_channel, v_account.id, v_norm_dest,
    now(), substring(v_body from 1 for 100), 0
  )
  on conflict (workspace_id, lead_id, channel, channel_account_id, lead_destination_normalized)
  do update set
    last_message_at = now(),
    last_message_snippet = substring(v_body from 1 for 100),
    updated_at = now()
  returning id into v_conv_id;

  -- Insert Message Record
  insert into crm.messages(
    workspace_id, conversation_id, lead_id, channel, direction, author_membership_id,
    sender_address, recipient_address, subject, text_body, html_body,
    status, dispatch_status, template_version_id, send_operation_key, queued_at
  ) values (
    p_workspace, v_conv_id, p_lead_id, p_channel, 'outbound', actor,
    coalesce(v_account.sender_address, 'system@8020crm.local'), v_norm_dest,
    v_subject, v_body, p_html_body,
    v_status, v_dispatch_status, p_template_version_id, p_command_key, now()
  ) returning id into v_msg_id;

  -- Log Initial Message Event
  insert into crm.message_events(workspace_id, message_id, event_type, from_status, to_status, details)
  values (
    p_workspace, v_msg_id,
    'queued', 'draft', v_status,
    jsonb_build_object('provider_status', 'awaiting_provider')
  );

  -- Log Activity Stream
  insert into crm.activities(
    workspace_id, lead_id, aggregate_type, aggregate_id, event_type, actor_membership_id, payload
  ) values (
    p_workspace, p_lead_id, 'lead', p_lead_id,
    'message.queued', actor,
    jsonb_build_object('message_id', v_msg_id, 'channel', p_channel, 'destination', v_norm_dest, 'status', v_status)
  );

  return jsonb_build_object(
    'message_id', v_msg_id,
    'conversation_id', v_conv_id,
    'status', v_status,
    'dispatch_status', v_dispatch_status
  );
end $$;

create or replace function api.ingest_inbound_message(
  p_workspace uuid,
  p_channel text,
  p_sender_address text,
  p_recipient_address text,
  p_text_body text,
  p_subject text default null,
  p_provider_message_id text default null,
  p_idempotency_key text default null,
  p_occurred_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_norm_sender text;
  v_norm_recipient text;
  v_identity_matches uuid[];
  v_lead_id uuid;
  v_account crm.channel_accounts%rowtype;
  v_conv_id uuid;
  v_msg_id uuid;
  v_review_id uuid;
  v_actor uuid;
  v_res jsonb;
  v_request jsonb;
  v_existing record;
  v_time timestamptz := coalesce(p_occurred_at,now());
begin
  v_actor:=private.member_id(p_workspace);
  if v_actor is null or private.member_role(p_workspace) not in ('admin','manager') then
    raise exception using errcode='42501',message='Authorized internal reviewer required';
  end if;
  if p_channel is null or p_channel not in ('email','sms','whatsapp') or
     nullif(btrim(p_sender_address),'') is null or nullif(btrim(p_recipient_address),'') is null or
     nullif(btrim(p_text_body),'') is null then
    raise exception using errcode='22023',message='Channel, addresses and body required';
  end if;
  -- Normalize addresses
  if p_channel = 'email' then
    v_norm_sender := lower(btrim(p_sender_address));
    v_norm_recipient := lower(btrim(p_recipient_address));
  else
    v_norm_sender := regexp_replace(btrim(p_sender_address), '[[:space:]\-\(\)\.]+', '', 'g');
    v_norm_recipient := regexp_replace(btrim(p_recipient_address), '[[:space:]\-\(\)\.]+', '', 'g');
  end if;

  -- Resolve matching channel account
  select * into v_account from crm.channel_accounts
  where workspace_id = p_workspace and channel = p_channel and sender_address = v_norm_recipient limit 1;

  -- Exact Identity Matching on crm.identities
  select array_agg(distinct ic.lead_id) into v_identity_matches
  from crm.identities i
  join crm.identity_claims ic on ic.identity_id = i.id and ic.active = true and ic.workspace_id = p_workspace
  where i.workspace_id = p_workspace
    and i.normalized_value = v_norm_sender and i.kind::text=case when p_channel='email' then 'email' else 'phone' end;

  -- Authorization precedes receipt lookup, including replays after reassignment.
  if private.member_role(p_workspace)<>'admin' and
     (v_account.id is null or coalesce(cardinality(v_identity_matches),0)<>1 or
      not private.can_work_lead(p_workspace,v_identity_matches[1])) then
    raise exception using errcode='42501',message='Inbound lead scope required';
  end if;
  v_request:=jsonb_build_object('command','ingest_inbound_message','channel',p_channel,
    'sender',v_norm_sender,'recipient',v_norm_recipient,'body',p_text_body,'subject',p_subject,
    'provider_id',p_provider_message_id,'occurred_at',p_occurred_at);
  if p_idempotency_key is not null then
    v_res:=private.command_begin(p_workspace,p_idempotency_key,v_request);
    if v_res is not null then return v_res; end if;
  end if;
  -- Serialize provider evidence within its workspace/channel/recipient namespace.
  -- No provider account is connected by this internal command.
  if p_provider_message_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(p_workspace,p_channel,v_norm_recipient,p_provider_message_id)::text,0));
    select m.id,m.conversation_id,m.sender_address,m.recipient_address,m.text_body,m.subject,m.created_at into v_existing
      from crm.messages m where m.workspace_id=p_workspace and m.channel=p_channel
      and m.direction='inbound' and m.recipient_address=v_norm_recipient and m.provider_message_id=p_provider_message_id;
    if found then
      if (v_existing.sender_address,v_existing.text_body,v_existing.subject) is distinct from
         (v_norm_sender,p_text_body,p_subject) or (p_occurred_at is not null and v_existing.created_at<>p_occurred_at) then
        raise exception using errcode='40001',message='Conflicting inbound evidence';
      end if;
      v_res:=jsonb_build_object('message_id',v_existing.id,'conversation_id',v_existing.conversation_id,'status','received');
    else
      select r.id,r.sender_address_normalized,r.text_body,r.subject,r.occurred_at into v_existing
        from crm.inbound_message_reviews r where r.workspace_id=p_workspace and r.channel=p_channel
        and r.recipient_address=v_norm_recipient and r.provider_message_id=p_provider_message_id;
      if found then
        if (v_existing.sender_address_normalized,v_existing.text_body,v_existing.subject) is distinct from
           (v_norm_sender,p_text_body,p_subject) or (p_occurred_at is not null and v_existing.occurred_at<>p_occurred_at) then
          raise exception using errcode='40001',message='Conflicting inbound evidence';
        end if;
        v_res:=jsonb_build_object('review_id',v_existing.id,'status','unresolved_inbound');
      end if;
    end if;
    if v_res is not null then
      if p_idempotency_key is not null then perform private.command_finish(p_workspace,p_idempotency_key,v_request,v_res); end if;
      return v_res;
    end if;
  end if;
  -- Case A: 0 matches -> Inbound Message Review (Correction 2)
  if v_account.id is null or v_identity_matches is null or cardinality(v_identity_matches) = 0 then
    insert into crm.inbound_message_reviews(
      workspace_id, channel, channel_account_id, sender_address_normalized, recipient_address,
      subject, text_body, provider_message_id, occurred_at, resolution_state, resolution_reason
    ) values (
      p_workspace, p_channel, v_account.id, v_norm_sender, v_norm_recipient,
      p_subject, p_text_body, p_provider_message_id, v_time, 'pending', case when v_account.id is null then 'missing_channel_account' else 'unmatched_sender' end
    ) returning id into v_review_id;

    v_res := jsonb_build_object('review_id', v_review_id, 'status', 'unresolved_inbound', 'reason', case when v_account.id is null then 'missing_channel_account' else 'unmatched_sender' end);

    if p_idempotency_key is not null then
      perform private.command_finish(p_workspace,p_idempotency_key,v_request,v_res);
    end if;

    return v_res;
  end if;

  -- Case B: >1 matches -> Ambiguous Conflict Review (Correction 2)
  if cardinality(v_identity_matches) > 1 then
    insert into crm.inbound_message_reviews(
      workspace_id, channel, channel_account_id, sender_address_normalized, recipient_address,
      subject, text_body, provider_message_id, occurred_at, resolution_state, resolution_reason, candidate_lead_ids
    ) values (
      p_workspace, p_channel, v_account.id, v_norm_sender, v_norm_recipient,
      p_subject, p_text_body, p_provider_message_id, v_time, 'pending', 'ambiguous_identity_conflict', v_identity_matches
    ) returning id into v_review_id;

    v_res := jsonb_build_object('review_id', v_review_id, 'status', 'unresolved_inbound', 'reason', 'ambiguous_identity_conflict');

    if p_idempotency_key is not null then
      perform private.command_finish(p_workspace,p_idempotency_key,v_request,v_res);
    end if;

    return v_res;
  end if;

  -- Case C: Exactly 1 Match -> Ingest Inbound Message
  v_lead_id := v_identity_matches[1];

  -- Locate or create deterministic conversation
  insert into crm.conversations(
    workspace_id, lead_id, channel, channel_account_id, lead_destination_normalized,
    unread_count, last_message_at, last_message_snippet
  ) values (
    p_workspace, v_lead_id, p_channel, v_account.id, v_norm_sender,
    1, v_time, substring(p_text_body from 1 for 100)
  )
  on conflict (workspace_id, lead_id, channel, channel_account_id, lead_destination_normalized)
  do update set
    unread_count = crm.conversations.unread_count + 1,
    last_message_at = greatest(crm.conversations.last_message_at,v_time),
    last_message_snippet = substring(p_text_body from 1 for 100),
    status = 'open',
    updated_at = now()
  returning id into v_conv_id;

  -- Insert Received Message
  insert into crm.messages(
    workspace_id, conversation_id, lead_id, channel, direction,
    sender_address, recipient_address, subject, text_body,
    status, dispatch_status, provider_message_id, created_at
  ) values (
    p_workspace, v_conv_id, v_lead_id, p_channel, 'inbound',
    v_norm_sender, v_norm_recipient, p_subject, p_text_body,
    'received', 'received', p_provider_message_id, v_time
  ) returning id into v_msg_id;

  -- Event log
  insert into crm.message_events(workspace_id, message_id, event_type, from_status, to_status, occurred_at)
  values (p_workspace, v_msg_id, 'received', null, 'received', v_time);

  -- Evaluate Sequence Exit Triggers (Correction 14)
  update crm.sequence_enrollments
  set status = 'exited',
      exited_at = now(),
      exit_reason = 'reply_received',
      updated_at = now()
  where workspace_id = p_workspace
    and lead_id = v_lead_id
    and status = 'active'
    and exists (
      select 1 from crm.sequence_versions sv
      where sv.id = sequence_version_id and 'reply_received' = any(sv.exit_conditions)
    );

  -- Emit lead activity
  insert into crm.activities(
    workspace_id, lead_id, aggregate_type, aggregate_id, event_type, payload
  ) values (
    p_workspace, v_lead_id, 'lead', v_lead_id, 'message.received',
    jsonb_build_object('message_id', v_msg_id, 'channel', p_channel, 'sender', v_norm_sender)
  );

  v_res := jsonb_build_object(
    'message_id', v_msg_id,
    'conversation_id', v_conv_id,
    'lead_id', v_lead_id,
    'status', 'received'
  );

  if p_idempotency_key is not null then
    perform private.command_finish(p_workspace,p_idempotency_key,v_request,v_res);
  end if;

  return v_res;
end $$;

create or replace function api.resolve_inbound_review(
  p_workspace uuid,
  p_review_id uuid,
  p_lead_id uuid,
  p_resolution_notes text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  role text;
  v_review crm.inbound_message_reviews%rowtype;
  v_lead crm.leads%rowtype;
  v_conv_id uuid;
  v_msg_id uuid;
begin
  actor := private.member_id(p_workspace);
  role := private.member_role(p_workspace);
  if actor is null or role not in ('admin','manager') then
    raise exception using errcode='42501', message='Active member with lead editing permission required';
  end if;

  select * into v_review from crm.inbound_message_reviews
  where workspace_id = p_workspace and id = p_review_id for update;
  if not found then raise exception using errcode='42501', message='Inbound review not found'; end if;
  if not private.can_review_inbound(p_workspace,v_review.candidate_lead_ids) or not private.can_work_lead(p_workspace,p_lead_id) then
    raise exception using errcode='42501',message='Review and target lead scope required';
  end if;
  if v_review.resolution_state <> 'pending' then
    raise exception using errcode='42501', message='Inbound review already resolved or dismissed';
  end if;

  select * into v_lead from crm.leads
  where workspace_id = p_workspace and id = p_lead_id;
  if not found then raise exception using errcode='42501', message='Lead not found'; end if;

  if v_review.channel_account_id is null then raise exception using errcode='22023',message='Channel account must be resolved before linking'; end if;

  -- Create or locate conversation for chosen lead
  insert into crm.conversations(
    workspace_id, lead_id, channel, channel_account_id, lead_destination_normalized,
    unread_count, last_message_at, last_message_snippet
  ) values (
    p_workspace, p_lead_id, v_review.channel, v_review.channel_account_id, v_review.sender_address_normalized,
    1, v_review.occurred_at, substring(v_review.text_body from 1 for 100)
  )
  on conflict (workspace_id, lead_id, channel, channel_account_id, lead_destination_normalized)
  do update set
    unread_count = crm.conversations.unread_count + 1,
    last_message_at = v_review.occurred_at,
    last_message_snippet = substring(v_review.text_body from 1 for 100),
    status = 'open',
    updated_at = now()
  returning id into v_conv_id;

  -- Insert authoritative message
  insert into crm.messages(
    workspace_id, conversation_id, lead_id, channel, direction,
    sender_address, recipient_address, subject, text_body,
    status, dispatch_status, provider_message_id, created_at
  ) values (
    p_workspace, v_conv_id, p_lead_id, v_review.channel, 'inbound',
    v_review.sender_address_normalized, v_review.recipient_address, v_review.subject, v_review.text_body,
    'received', 'received', v_review.provider_message_id, v_review.occurred_at
  ) returning id into v_msg_id;

  -- Event log
  insert into crm.message_events(workspace_id, message_id, event_type, from_status, to_status, occurred_at)
  values (p_workspace, v_msg_id, 'received', null, 'received', v_review.occurred_at);

  -- Update review record
  update crm.inbound_message_reviews
  set resolution_state = 'resolved',
      resolved_lead_id = p_lead_id,
      resolved_conversation_id = v_conv_id,
      resolved_by_membership_id = actor,
      resolved_at = now(),
      resolution_notes=p_resolution_notes,
      resolved_message_id=v_msg_id
  where id = p_review_id;

  return jsonb_build_object(
    'review_id', p_review_id,
    'conversation_id', v_conv_id,
    'message_id', v_msg_id,
    'status', 'resolved'
  );
end $$;

create or replace function api.list_conversations(
  p_workspace uuid,
  p_channel text default null,
  p_status text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  v_res jsonb;
begin
  actor := private.member_id(p_workspace);
  if actor is null then raise exception using errcode='42501', message='Active membership required'; end if;

  select jsonb_agg(jsonb_build_object(
    'id', c.id,
    'lead_id', c.lead_id,
    'lead_name', l.display_name,
    'lead_company', l.company,
    'channel', c.channel,
    'destination', c.lead_destination_normalized,
    'status', c.status,
    'unread_count', c.unread_count,
    'last_message_at', c.last_message_at,
    'last_message_snippet', c.last_message_snippet,
    'assigned_to_name', (select p.display_name from crm.memberships m left join crm.profiles p on p.user_id=m.user_id where m.workspace_id=p_workspace and m.id=c.assigned_membership_id)
  ) order by c.last_message_at desc,c.id) into v_res
  from crm.conversations c
  join crm.leads l on l.id = c.lead_id and l.workspace_id = p_workspace
  where c.workspace_id = p_workspace and private.can_read_lead(p_workspace,c.lead_id)
    and (p_channel is null or c.channel = p_channel)
    and (p_status is null or c.status = p_status);

  return coalesce(v_res, '[]'::jsonb);
end $$;

create or replace function api.get_conversation_messages(
  p_workspace uuid,
  p_conversation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  v_res jsonb;
begin
  actor := private.member_id(p_workspace);
  if actor is null then raise exception using errcode='42501', message='Active membership required'; end if;

  if not exists(select 1 from crm.conversations c where c.workspace_id=p_workspace and c.id=p_conversation_id and private.can_read_lead(p_workspace,c.lead_id)) then
    raise exception using errcode='42501',message='Conversation access required';
  end if;

  select jsonb_agg(jsonb_build_object(
    'id', m.id,
    'direction', m.direction,
    'channel', m.channel,
    'sender', m.sender_address,
    'recipient', m.recipient_address,
    'subject', m.subject,
    'text_body', m.text_body,
    'status', m.status,
    'dispatch_status', m.dispatch_status,
    'author_name', (select p.display_name from crm.memberships mm left join crm.profiles p on p.user_id=mm.user_id where mm.workspace_id=p_workspace and mm.id=m.author_membership_id),
    'created_at', m.created_at
  ) order by m.created_at asc,m.id) into v_res
  from crm.messages m
  where m.workspace_id = p_workspace and m.conversation_id = p_conversation_id;

  return coalesce(v_res, '[]'::jsonb);
end $$;

create or replace function api.list_inbound_reviews(
  p_workspace uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  v_res jsonb;
begin
  actor := private.member_id(p_workspace);
  if actor is null then raise exception using errcode='42501', message='Active membership required'; end if;

  select jsonb_agg(jsonb_build_object(
    'id', r.id,
    'channel', r.channel,
    'sender_address', r.sender_address_normalized,
    'recipient_address', r.recipient_address,
    'subject', r.subject,
    'text_body', r.text_body,
    'occurred_at', r.occurred_at,
    'resolution_state', r.resolution_state,
    'resolution_reason', r.resolution_reason,
    'candidate_lead_ids', r.candidate_lead_ids
  ) order by r.occurred_at desc,r.id) into v_res
  from crm.inbound_message_reviews r
  where r.workspace_id = p_workspace and private.can_review_inbound(p_workspace,r.candidate_lead_ids) and r.resolution_state = 'pending';

  return coalesce(v_res, '[]'::jsonb);
end $$;

create or replace function api.list_message_templates(
  p_workspace uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  v_res jsonb;
begin
  actor := private.member_id(p_workspace);
  if actor is null then raise exception using errcode='42501', message='Active membership required'; end if;

  select jsonb_agg(jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'channel', t.channel,
    'status', t.status,
    'current_version', v.version,
    'active_version', v.version,
    'active_version_id', v.id,
    'active_subject', v.subject,
    'active_body', v.body,
    'subject', v.subject,
    'body', v.body,
    'variables_used', coalesce(v.variables_used,'{}'::text[]),
    'published_at', v.published_at
  ) order by t.created_at desc,t.id) into v_res
  from crm.message_templates t
  left join crm.message_template_versions v on v.id = t.current_version_id and v.workspace_id=t.workspace_id
  where t.workspace_id = p_workspace;

  return coalesce(v_res, '[]'::jsonb);
end $$;

create or replace function api.list_campaigns(
  p_workspace uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  v_res jsonb;
begin
  actor := private.member_id(p_workspace);
  if actor is null then raise exception using errcode='42501', message='Active membership required'; end if;

  select jsonb_agg(jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'channel', c.channel,
    'status', c.status,
    'scheduled_at', c.scheduled_at,
    'started_at', c.started_at,
    'completed_at', c.completed_at,
    'recipient_count', (select count(*)::int from crm.campaign_recipients r where r.workspace_id=p_workspace and r.campaign_id = c.id and private.can_read_lead(p_workspace,r.lead_id)),
    'eligible_count', (select count(*)::int from crm.campaign_recipients r where r.workspace_id=p_workspace and r.campaign_id = c.id and private.can_read_lead(p_workspace,r.lead_id) and r.eligibility_status = 'eligible'),
    'suppressed_count', (select count(*)::int from crm.campaign_recipients r where r.workspace_id=p_workspace and r.campaign_id = c.id and private.can_read_lead(p_workspace,r.lead_id) and r.eligibility_status = 'suppressed')
  ) order by c.created_at desc,c.id) into v_res
  from crm.campaigns c
  where c.workspace_id = p_workspace;

  return coalesce(v_res, '[]'::jsonb);
end $$;

create or replace function api.list_sequences(
  p_workspace uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  v_res jsonb;
begin
  actor := private.member_id(p_workspace);
  if actor is null then raise exception using errcode='42501', message='Active membership required'; end if;

  select jsonb_agg(jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'description', s.description,
    'status', s.status,
    'current_version', v.version,
    'exit_conditions', coalesce(v.exit_conditions,'{}'::text[]),
    'step_count', (select count(*)::int from crm.sequence_steps ss where ss.sequence_version_id = v.id),
    'active_enrollments', (select count(*)::int from crm.sequence_enrollments se where se.workspace_id=p_workspace and se.sequence_version_id = v.id and private.can_read_lead(p_workspace,se.lead_id) and se.status = 'active')
  ) order by s.created_at desc,s.id) into v_res
  from crm.sequences s
  left join crm.sequence_versions v on v.id = s.current_version_id and v.workspace_id=s.workspace_id
  where s.workspace_id = p_workspace;

  return coalesce(v_res, '[]'::jsonb);
end $$;

create or replace function api.publish_template_version(
  p_workspace uuid,
  p_template_id uuid,
  p_subject text,
  p_body text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  role text;
  v_next_version integer;
  v_ver_id uuid;
  v_match text;
  v_vars text[] := '{}';
begin
  actor := private.member_id(p_workspace);
  role := private.member_role(p_workspace);
  if actor is null or role not in ('admin','manager') then
    raise exception using errcode='42501', message='Active member with template editing permission required';
  end if;

  -- Validate variable allowlist: {{first_name}}, {{last_name}}, {{company}}, {{setter_name}}, {{closer_name}}
  for v_match in select unnest(regexp_matches(coalesce(p_subject, '') || ' ' || p_body, '\{\{([a-zA-Z0-9_:]+)\}\}', 'g')) loop
    if v_match not in ('first_name', 'last_name', 'company', 'setter_name', 'closer_name',
                       'first_name:optional', 'last_name:optional', 'company:optional', 'setter_name:optional', 'closer_name:optional') then
      raise exception using errcode='22023', message='Disallowed template variable: {{' || v_match || '}}. Only approved variables allowed.';
    end if;
    v_vars := array_append(v_vars, v_match);
  end loop;

  select coalesce(max(version), 0) + 1 into v_next_version
  from crm.message_template_versions where workspace_id = p_workspace and template_id = p_template_id;

  insert into crm.message_template_versions(
    workspace_id, template_id, version, subject, body, variables_used, published_by_membership_id
  ) values (
    p_workspace, p_template_id, v_next_version, p_subject, p_body, v_vars, actor
  ) returning id into v_ver_id;

  update crm.message_templates
  set current_version_id = v_ver_id, updated_at = now()
  where workspace_id = p_workspace and id = p_template_id;

  return jsonb_build_object('template_id', p_template_id, 'version_id', v_ver_id, 'version', v_next_version);
end $$;

create or replace function api.enroll_lead_sequence(
  p_workspace uuid,
  p_sequence_id uuid,
  p_lead_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  role text;
  v_seq crm.sequences%rowtype;
  v_ver crm.sequence_versions%rowtype;
  v_enroll_id uuid;
  v_first_step crm.sequence_steps%rowtype;
begin
  actor := private.member_id(p_workspace);
  role := private.member_role(p_workspace);
  if actor is null or not private.can_work_lead(p_workspace,p_lead_id) then
    raise exception using errcode='42501', message='Active member with sequence editing permission required';
  end if;

  select * into v_seq from crm.sequences where workspace_id = p_workspace and id = p_sequence_id;
  if not found or v_seq.current_version_id is null then
    raise exception using errcode='42501', message='Sequence not found or has no published version';
  end if;

  select * into v_ver from crm.sequence_versions where id = v_seq.current_version_id;

  -- Check if already actively enrolled in this sequence version
  select id into v_enroll_id from crm.sequence_enrollments
  where workspace_id = p_workspace and sequence_version_id = v_ver.id and lead_id = p_lead_id and status = 'active';
  if found then
    return jsonb_build_object('enrollment_id', v_enroll_id, 'status', 'already_active');
  end if;

  -- Check authoritative exit signals (Correction 14: Phase 3 meetings and sales outcomes)
  if 'meeting_booked' = any(v_ver.exit_conditions) then
    if exists (select 1 from crm.meetings where workspace_id = p_workspace and lead_id = p_lead_id and booking_state in ('booked', 'confirmed')) then
      return jsonb_build_object('status', 'skipped', 'reason', 'meeting_already_booked');
    end if;
  end if;

  if 'closed_won' = any(v_ver.exit_conditions) then
    if exists (select 1 from crm.deals where workspace_id = p_workspace and lead_id = p_lead_id and status = 'won') then
      return jsonb_build_object('status', 'skipped', 'reason', 'lead_already_won');
    end if;
  end if;

  if 'closed_lost' = any(v_ver.exit_conditions) then
    if exists (select 1 from crm.deals where workspace_id = p_workspace and lead_id = p_lead_id and status = 'lost') then
      return jsonb_build_object('status', 'skipped', 'reason', 'lead_already_lost');
    end if;
  end if;

  insert into crm.sequence_enrollments(
    workspace_id, sequence_version_id, lead_id, status, current_step_number, start_at
  ) values (
    p_workspace, v_ver.id, p_lead_id, 'active', 1, now()
  ) returning id into v_enroll_id;

  -- Schedule Step 1
  select * into v_first_step
  from crm.sequence_steps
  where workspace_id = p_workspace and sequence_version_id = v_ver.id and step_number = 1;

  if found then
    insert into crm.sequence_step_executions(
      workspace_id, enrollment_id, sequence_step_id, status, run_at
    ) values (
      p_workspace, v_enroll_id, v_first_step.id, 'scheduled', now() + (v_first_step.delay_seconds || ' seconds')::interval
    );

    -- Schedule durable job in private.jobs
    insert into private.jobs(workspace_id, type, dedup_key, run_at, payload)
    values (
      p_workspace, 'sequence_step',
      v_enroll_id::text || '-step-1',
      now() + (v_first_step.delay_seconds || ' seconds')::interval,
      jsonb_build_object('enrollment_id', v_enroll_id, 'step_id', v_first_step.id)
    ) on conflict do nothing;
  end if;

  return jsonb_build_object('enrollment_id', v_enroll_id, 'status', 'active');
end $$;

create or replace function api.launch_campaign(
  p_workspace uuid,
  p_campaign_id uuid,
  p_command_key text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  role text;
  v_camp crm.campaigns%rowtype;
  v_lead record;
  v_dest text;
  v_ident_id uuid;
  v_sup jsonb;
  v_status text;
  v_reason text;
  v_rule text;
  v_ref_id uuid;
  v_total integer := 0;
  v_eligible integer := 0;
  v_suppressed integer := 0;
begin
  actor := private.member_id(p_workspace);
  role := private.member_role(p_workspace);
  if actor is null or role in ('setter', 'closer', 'read_only') then
    raise exception using errcode='42501', message='Admin or manager permission required to launch campaigns';
  end if;

  select * into v_camp from crm.campaigns where workspace_id = p_workspace and id = p_campaign_id;
  if not found then raise exception using errcode='42501', message='Campaign not found'; end if;
  if v_camp.status not in ('draft', 'scheduled') then
    raise exception using errcode='42501', message='Campaign cannot be launched from current state: ' || v_camp.status;
  end if;

  -- Transactionally materialize audience into crm.campaign_recipients
  for v_lead in
    select l.id as lead_id
    from crm.leads l
    where l.workspace_id = p_workspace and private.can_work_lead(p_workspace,l.id)
  loop
    v_dest := null;
    v_ident_id := null;

    -- Deterministic primary destination selection
    if v_camp.channel = 'email' then
      select i.id, i.normalized_value into v_ident_id, v_dest
      from crm.lead_identities li
      join crm.identities i on i.id = li.identity_id and i.workspace_id = p_workspace and i.kind = 'email'
      where li.workspace_id = p_workspace and li.lead_id = v_lead.lead_id and li.valid_to is null
      order by li.is_primary desc, li.valid_from asc limit 1;
    else
      select i.id, i.normalized_value into v_ident_id, v_dest
      from crm.lead_identities li
      join crm.identities i on i.id = li.identity_id and i.workspace_id = p_workspace and i.kind = 'phone'
      where li.workspace_id = p_workspace and li.lead_id = v_lead.lead_id and li.valid_to is null
      order by li.is_primary desc, li.valid_from asc limit 1;
    end if;

    if v_dest is null then
      v_status := 'missing_destination';
      v_reason := 'No identity registered for ' || v_camp.channel;
      v_rule := null;
      v_ref_id := null;
    else
      -- Check Suppression
      v_sup := private.is_suppressed(p_workspace, v_lead.lead_id, v_camp.channel, v_dest);
      if (v_sup->>'is_suppressed')::boolean then
        v_status := 'suppressed';
        v_reason := v_sup->>'reason';
        v_rule := v_sup->>'rule_applied';
        v_ref_id := (v_sup->>'ref_id')::uuid;
        v_suppressed := v_suppressed + 1;
      else
        v_status := 'eligible';
        v_reason := null;
        v_rule := null;
        v_ref_id := null;
        v_eligible := v_eligible + 1;
      end if;
    end if;

    -- Insert Frozen Recipient Snapshot (Ignoring duplicate destinations)
    insert into crm.campaign_recipients(
      workspace_id, campaign_id, lead_id, destination_normalized, destination_identity_id,
      eligibility_status, suppression_rule_applied, suppression_reason, suppression_ref_id, status
    ) values (
      p_workspace, p_campaign_id, v_lead.lead_id, coalesce(v_dest, 'unknown'), v_ident_id,
      v_status, v_rule, v_reason, v_ref_id, case when v_status = 'eligible' then 'pending' else 'skipped' end
    )
    on conflict do nothing;

    v_total := v_total + 1;
  end loop;

  -- Create Background Batch Dispatch Jobs via private.jobs (Correction 14 & 15)
  insert into private.jobs(workspace_id, type, dedup_key, payload)
  values (
    p_workspace, 'campaign_dispatch_batch',
    p_campaign_id::text || '-batch-1',
    jsonb_build_object('campaign_id', p_campaign_id, 'batch_size', v_camp.batch_size)
  ) on conflict do nothing;

  update crm.campaigns
  set status = 'running', started_at = now(), updated_at = now()
  where workspace_id = p_workspace and id = p_campaign_id;

  return jsonb_build_object(
    'campaign_id', p_campaign_id,
    'total_recipients', v_total,
    'eligible_count', v_eligible,
    'suppressed_count', v_suppressed,
    'status', 'running'
  );
end $$;

create or replace function private.process_campaign_batch(
  p_workspace uuid,
  p_campaign_id uuid,
  p_batch_size integer default 100
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_camp crm.campaigns%rowtype;
  v_rec crm.campaign_recipients%rowtype;
  v_tpl_ver crm.message_template_versions%rowtype;
  v_account crm.channel_accounts%rowtype;
  v_lead crm.leads%rowtype;
  v_sup jsonb;
  v_msg_id uuid;
  v_conv_id uuid;
  v_body text;
  v_subject text;
  v_var text;
  v_clean_var text;
  v_is_opt boolean;
  v_val text;
  v_var_missing boolean;
  v_dispatched_count integer := 0;
  v_suppressed_count integer := 0;
begin
  select * into v_camp from crm.campaigns where workspace_id = p_workspace and id = p_campaign_id;
  if not found then return jsonb_build_object('error', 'campaign_not_found'); end if;

  -- Correction 15: Re-check parent campaign status. If cancelled, do NOT dispatch
  if v_camp.status = 'cancelled' then
    update crm.campaign_recipients
    set status = 'cancelled', updated_at = now()
    where workspace_id = p_workspace and campaign_id = p_campaign_id and status = 'pending';
    return jsonb_build_object('campaign_id', p_campaign_id, 'status', 'cancelled', 'dispatched', 0);
  end if;

  select * into v_tpl_ver from crm.message_template_versions
  where workspace_id = p_workspace and id = v_camp.template_version_id;
  if not found then return jsonb_build_object('error', 'template_version_not_found'); end if;

  select * into v_account from crm.channel_accounts
  where workspace_id = p_workspace and channel = v_camp.channel and status = 'active'
  order by is_default desc, created_at asc limit 1;
  if not found then return jsonb_build_object('error', 'active_channel_account_not_found'); end if;

  for v_rec in
    select * from crm.campaign_recipients
    where workspace_id = p_workspace and campaign_id = p_campaign_id and status = 'pending' and eligibility_status = 'eligible'
    limit p_batch_size
    for update skip locked
  loop
    -- Correction 10 & 11: Just-in-Time Suppression Check immediately before dispatch
    v_sup := private.is_suppressed(p_workspace, v_rec.lead_id, v_camp.channel, v_rec.destination_normalized);

    if (v_sup->>'is_suppressed')::boolean then
      -- Mark recipient suppressed
      update crm.campaign_recipients
      set status = 'skipped',
          eligibility_status = 'suppressed',
          suppression_rule_applied = v_sup->>'rule_applied',
          suppression_reason = v_sup->>'reason',
          suppression_ref_id = (v_sup->>'ref_id')::uuid,
          updated_at = now()
      where id = v_rec.id;

      v_suppressed_count := v_suppressed_count + 1;
    else
      -- Verify lead belongs to same workspace
      select * into v_lead from crm.leads where workspace_id = p_workspace and id = v_rec.lead_id;
      if not found then
        update crm.campaign_recipients set status = 'skipped', eligibility_status = 'suppressed', suppression_reason = 'lead_not_found', updated_at = now() where id = v_rec.id;
        v_suppressed_count := v_suppressed_count + 1;
        continue;
      end if;

      -- Canonical Template Rendering Check (Section 14 & Correction 3)
      v_body := v_tpl_ver.body;
      v_subject := coalesce(v_tpl_ver.subject, '');
      v_var_missing := false;

      foreach v_var in array coalesce(v_tpl_ver.variables_used, '{}'::text[]) loop
        v_is_opt := (v_var like '%:optional');
        v_clean_var := replace(v_var, ':optional', '');

        v_val := null;
        if v_clean_var = 'first_name' then
          v_val := split_part(v_lead.display_name, ' ', 1);
        elsif v_clean_var = 'last_name' then
          v_val := nullif(substring(v_lead.display_name from position(' ' in v_lead.display_name) + 1), '');
        elsif v_clean_var = 'company' then
          v_val := v_lead.company;
        elsif v_clean_var = 'setter_name' then
          select p.display_name into v_val from crm.memberships m left join crm.profiles p on p.user_id=m.user_id where m.id=v_lead.assigned_setter_id and m.workspace_id=p_workspace;
        elsif v_clean_var = 'closer_name' then
          select p.display_name into v_val from crm.memberships m left join crm.profiles p on p.user_id=m.user_id where m.id=v_lead.assigned_closer_id and m.workspace_id=p_workspace;
        end if;

        if v_val is null or btrim(v_val) = '' then
          if not v_is_opt then
            v_var_missing := true;
            exit;
          else
            v_val := '';
          end if;
        end if;

        v_body := replace(v_body, '{{' || v_var || '}}', v_val);
        if v_subject is not null then
          v_subject := replace(v_subject, '{{' || v_var || '}}', v_val);
        end if;
      end loop;

      if v_var_missing or v_body is null or btrim(v_body) = '' then
        update crm.campaign_recipients
        set status = 'skipped',
            eligibility_status = 'suppressed',
            suppression_reason = 'missing_required_template_variable: ' || v_clean_var,
            updated_at = now()
        where id = v_rec.id;

        v_suppressed_count := v_suppressed_count + 1;
        continue;
      end if;

      -- Deterministic Conversation
      insert into crm.conversations(
        workspace_id, lead_id, channel, channel_account_id, lead_destination_normalized,
        last_message_at, last_message_snippet, unread_count
      ) values (
        p_workspace, v_rec.lead_id, v_camp.channel, v_account.id, v_rec.destination_normalized,
        now(), substring(v_body from 1 for 100), 0
      )
      on conflict (workspace_id, lead_id, channel, channel_account_id, lead_destination_normalized)
      do update set
        last_message_at = now(),
        last_message_snippet = substring(v_body from 1 for 100),
        updated_at = now()
      returning id into v_conv_id;

      -- Correction 6 & 9: Providerless message queued at awaiting_provider
      insert into crm.messages(
        workspace_id, conversation_id, lead_id, channel, direction, author_membership_id,
        sender_address, recipient_address, subject, text_body,
        status, dispatch_status, template_version_id, campaign_id, queued_at
      ) values (
        p_workspace, v_conv_id, v_rec.lead_id, v_camp.channel, 'outbound', v_camp.created_by_membership_id,
        coalesce(v_account.sender_address, 'system@8020crm.local'), v_rec.destination_normalized,
        v_subject, v_body,
        'queued', 'awaiting_provider', v_tpl_ver.id, p_campaign_id, now()
      ) returning id into v_msg_id;

      insert into crm.message_events(workspace_id, message_id, event_type, from_status, to_status, details)
      values (p_workspace, v_msg_id, 'queued', 'draft', 'queued', jsonb_build_object('campaign_id', p_campaign_id, 'dispatch_status', 'awaiting_provider'));

      update crm.campaign_recipients
      set status = 'dispatched',
          message_id = v_msg_id,
          updated_at = now()
      where id = v_rec.id;

      v_dispatched_count := v_dispatched_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'campaign_id', p_campaign_id,
    'dispatched', v_dispatched_count,
    'suppressed', v_suppressed_count
  );
end $$;

create or replace function private.process_sequence_step_execution(
  p_workspace uuid,
  p_execution_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_exec crm.sequence_step_executions%rowtype;
  v_enroll crm.sequence_enrollments%rowtype;
  v_step crm.sequence_steps%rowtype;
  v_tpl_ver crm.message_template_versions%rowtype;
  v_account crm.channel_accounts%rowtype;
  v_lead crm.leads%rowtype;
  v_dest text;
  v_sup jsonb;
  v_msg_id uuid;
  v_conv_id uuid;
  v_body text;
  v_subject text;
  v_var text;
  v_clean_var text;
  v_is_opt boolean;
  v_val text;
  v_var_missing boolean;
begin
  select * into v_exec from crm.sequence_step_executions where workspace_id = p_workspace and id = p_execution_id;
  if not found then return jsonb_build_object('error', 'execution_not_found'); end if;
  if v_exec.status <> 'scheduled' then return jsonb_build_object('status', v_exec.status, 'skipped', true); end if;

  select * into v_enroll from crm.sequence_enrollments where workspace_id = p_workspace and id = v_exec.enrollment_id;
  if not found then
    update crm.sequence_step_executions set status = 'cancelled', skip_reason = 'enrollment_not_found' where id = p_execution_id;
    return jsonb_build_object('status', 'cancelled', 'reason', 'enrollment_not_found');
  end if;

  -- Correction 15: Re-check parent enrollment status. If not active (e.g. exited or paused), do NOT dispatch
  if v_enroll.status <> 'active' then
    update crm.sequence_step_executions
    set status = 'cancelled', skip_reason = 'enrollment_status_' || v_enroll.status
    where id = p_execution_id;
    return jsonb_build_object('status', 'cancelled', 'reason', 'enrollment_not_active');
  end if;

  select * into v_step from crm.sequence_steps where workspace_id = p_workspace and id = v_exec.sequence_step_id;
  if not found then
    update crm.sequence_step_executions set status = 'failed', skip_reason = 'step_not_found' where id = p_execution_id;
    return jsonb_build_object('status', 'failed', 'reason', 'step_not_found');
  end if;

  select * into v_tpl_ver from crm.message_template_versions where workspace_id = p_workspace and id = v_step.template_version_id;
  if not found then
    update crm.sequence_step_executions set status = 'failed', skip_reason = 'template_version_not_found' where id = p_execution_id;
    return jsonb_build_object('status', 'failed', 'reason', 'template_version_not_found');
  end if;

  -- Resolve destination
  if v_step.channel = 'email' then
    select i.normalized_value into v_dest
    from crm.lead_identities li
    join crm.identities i on i.id = li.identity_id and i.workspace_id = p_workspace and i.kind = 'email'
    where li.workspace_id = p_workspace and li.lead_id = v_enroll.lead_id and li.valid_to is null
    order by li.is_primary desc, li.valid_from asc limit 1;
  else
    select i.normalized_value into v_dest
    from crm.lead_identities li
    join crm.identities i on i.id = li.identity_id and i.workspace_id = p_workspace and i.kind = 'phone'
    where li.workspace_id = p_workspace and li.lead_id = v_enroll.lead_id and li.valid_to is null
    order by li.is_primary desc, li.valid_from asc limit 1;
  end if;

  if v_dest is null then
    update crm.sequence_step_executions
    set status = 'skipped', skip_reason = 'missing_destination'
    where id = p_execution_id;
    return jsonb_build_object('status', 'skipped', 'reason', 'missing_destination');
  end if;

  -- Correction 10 & 11: Just-in-Time Suppression Check immediately before step dispatch
  v_sup := private.is_suppressed(p_workspace, v_enroll.lead_id, v_step.channel, v_dest);
  if (v_sup->>'is_suppressed')::boolean then
    update crm.sequence_step_executions
    set status = 'skipped', skip_reason = 'suppressed_' || (v_sup->>'reason')
    where id = p_execution_id;
    return jsonb_build_object('status', 'skipped', 'reason', 'suppressed');
  end if;

  select * into v_account from crm.channel_accounts
  where workspace_id = p_workspace and channel = v_step.channel and status = 'active'
  order by is_default desc, created_at asc limit 1;
  if not found then
    update crm.sequence_step_executions set status = 'failed', skip_reason = 'no_active_channel_account' where id = p_execution_id;
    return jsonb_build_object('status', 'failed', 'reason', 'no_active_channel_account');
  end if;

  select * into v_lead from crm.leads where workspace_id = p_workspace and id = v_enroll.lead_id;
  if not found then
    update crm.sequence_step_executions set status = 'skipped', skip_reason = 'lead_not_found' where id = p_execution_id;
    return jsonb_build_object('status', 'skipped', 'reason', 'lead_not_found');
  end if;

  -- Canonical Template Rendering Check (Section 14 & Correction 3)
  v_body := v_tpl_ver.body;
  v_subject := coalesce(v_tpl_ver.subject, '');
  v_var_missing := false;

  foreach v_var in array coalesce(v_tpl_ver.variables_used, '{}'::text[]) loop
    v_is_opt := (v_var like '%:optional');
    v_clean_var := replace(v_var, ':optional', '');

    v_val := null;
    if v_clean_var = 'first_name' then
      v_val := split_part(v_lead.display_name, ' ', 1);
    elsif v_clean_var = 'last_name' then
      v_val := nullif(substring(v_lead.display_name from position(' ' in v_lead.display_name) + 1), '');
    elsif v_clean_var = 'company' then
      v_val := v_lead.company;
    elsif v_clean_var = 'setter_name' then
      select p.display_name into v_val from crm.memberships m left join crm.profiles p on p.user_id=m.user_id where m.id=v_lead.assigned_setter_id and m.workspace_id=p_workspace;
    elsif v_clean_var = 'closer_name' then
      select p.display_name into v_val from crm.memberships m left join crm.profiles p on p.user_id=m.user_id where m.id=v_lead.assigned_closer_id and m.workspace_id=p_workspace;
    end if;

    if v_val is null or btrim(v_val) = '' then
      if not v_is_opt then
        v_var_missing := true;
        exit;
      else
        v_val := '';
      end if;
    end if;

    v_body := replace(v_body, '{{' || v_var || '}}', v_val);
    if v_subject is not null then
      v_subject := replace(v_subject, '{{' || v_var || '}}', v_val);
    end if;
  end loop;

  if v_var_missing or v_body is null or btrim(v_body) = '' then
    update crm.sequence_step_executions
    set status = 'skipped', skip_reason = 'missing_required_template_variable: ' || v_clean_var
    where id = p_execution_id;
    return jsonb_build_object('status', 'skipped', 'reason', 'missing_required_template_variable');
  end if;

  insert into crm.conversations(
    workspace_id, lead_id, channel, channel_account_id, lead_destination_normalized,
    last_message_at, last_message_snippet, unread_count
  ) values (
    p_workspace, v_enroll.lead_id, v_step.channel, v_account.id, v_dest,
    now(), substring(v_body from 1 for 100), 0
  )
  on conflict (workspace_id, lead_id, channel, channel_account_id, lead_destination_normalized)
  do update set
    last_message_at = now(),
    last_message_snippet = substring(v_body from 1 for 100),
    updated_at = now()
  returning id into v_conv_id;

  insert into crm.messages(
    workspace_id, conversation_id, lead_id, channel, direction, author_membership_id,
    sender_address, recipient_address, subject, text_body,
    status, dispatch_status, template_version_id, sequence_enrollment_id, queued_at
  ) values (
    p_workspace, v_conv_id, v_enroll.lead_id, v_step.channel, 'outbound', null,
    coalesce(v_account.sender_address, 'system@8020crm.local'), v_dest,
    v_subject, v_body,
    'queued', 'awaiting_provider', v_tpl_ver.id, v_enroll.id, now()
  ) returning id into v_msg_id;

  insert into crm.message_events(workspace_id, message_id, event_type, from_status, to_status, details)
  values (p_workspace, v_msg_id, 'queued', 'draft', 'queued', jsonb_build_object('sequence_enrollment_id', v_enroll.id, 'dispatch_status', 'awaiting_provider'));

  update crm.sequence_step_executions
  set status = 'completed', message_id = v_msg_id, executed_at = now()
  where id = p_execution_id;

  return jsonb_build_object('status', 'completed', 'message_id', v_msg_id);
end $$;

-- Private helpers are internal only. No new provider role, ingress or worker.
revoke all on function private.is_suppressed(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function private.process_campaign_batch(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function private.process_sequence_step_execution(uuid,uuid) from public,anon,authenticated;


revoke all on function private.is_suppressed(uuid,uuid,text,text) from public,anon;

revoke all on function api.create_outbound_message(uuid,uuid,text,text,text,text,text,uuid,text,uuid,jsonb) from public,anon;

grant execute on function api.create_outbound_message(uuid,uuid,text,text,text,text,text,uuid,text,uuid,jsonb) to authenticated;

revoke all on function api.ingest_inbound_message(uuid,text,text,text,text,text,text,text,timestamptz) from public,anon;

grant execute on function api.ingest_inbound_message(uuid,text,text,text,text,text,text,text,timestamptz) to authenticated;

revoke all on function api.resolve_inbound_review(uuid,uuid,uuid,text) from public,anon;

grant execute on function api.resolve_inbound_review(uuid,uuid,uuid,text) to authenticated;

revoke all on function api.upsert_channel_account(uuid,text,text,text,boolean) from public,anon;

grant execute on function api.upsert_channel_account(uuid,text,text,text,boolean) to authenticated;

revoke all on function api.create_template(uuid,text,text) from public,anon;

grant execute on function api.create_template(uuid,text,text) to authenticated;

revoke all on function api.create_campaign(uuid,text,text,uuid,jsonb,integer) from public,anon;

grant execute on function api.create_campaign(uuid,text,text,uuid,jsonb,integer) to authenticated;

revoke all on function api.create_sequence(uuid,text,text) from public,anon;

grant execute on function api.create_sequence(uuid,text,text) to authenticated;

revoke all on function api.publish_sequence_version(uuid,uuid,jsonb,text[]) from public,anon;

grant execute on function api.publish_sequence_version(uuid,uuid,jsonb,text[]) to authenticated;

revoke all on function api.publish_template_version(uuid,uuid,text,text) from public,anon;

grant execute on function api.publish_template_version(uuid,uuid,text,text) to authenticated;

revoke all on function api.add_suppression(uuid,text,text,text,uuid,text,timestamptz) from public,anon;

grant execute on function api.add_suppression(uuid,text,text,text,uuid,text,timestamptz) to authenticated;

revoke all on function api.revoke_suppression(uuid,uuid,text) from public,anon;

grant execute on function api.revoke_suppression(uuid,uuid,text) to authenticated;

revoke all on function api.launch_campaign(uuid,uuid,text) from public,anon;

grant execute on function api.launch_campaign(uuid,uuid,text) to authenticated;

revoke all on function api.cancel_campaign(uuid,uuid) from public,anon;

grant execute on function api.cancel_campaign(uuid,uuid) to authenticated;

revoke all on function private.process_campaign_batch(uuid,uuid,integer) from public,anon;

revoke all on function api.enroll_lead_sequence(uuid,uuid,uuid) from public,anon;

grant execute on function api.enroll_lead_sequence(uuid,uuid,uuid) to authenticated;

revoke all on function private.process_sequence_step_execution(uuid,uuid) from public,anon;

revoke all on function api.list_conversations(uuid,text,text) from public,anon;

grant execute on function api.list_conversations(uuid,text,text) to authenticated;

revoke all on function api.get_conversation_messages(uuid,uuid) from public,anon;

grant execute on function api.get_conversation_messages(uuid,uuid) to authenticated;

revoke all on function api.list_inbound_reviews(uuid) from public,anon;

grant execute on function api.list_inbound_reviews(uuid) to authenticated;

revoke all on function api.list_message_templates(uuid) from public,anon;

grant execute on function api.list_message_templates(uuid) to authenticated;

revoke all on function api.list_campaigns(uuid) from public,anon;

grant execute on function api.list_campaigns(uuid) to authenticated;

revoke all on function api.list_sequences(uuid) from public,anon;

grant execute on function api.list_sequences(uuid) to authenticated;

commit;

