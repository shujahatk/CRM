# Phase 6 — provider integration plan and repository analysis

Planning date: 2026-09-23 (Asia/Karachi). **PLANNING COMPLETE; implementation and provider activation require review.** This document is the only intended repository change. No source, migration, environment, dependency, connection, commit or push is authorized by this planning pass.

## 1. Verified checkpoint and baseline

The initial working tree was clean on `main`. HEAD, local `origin/main`, and the remote `refs/heads/main` returned by `git ls-remote` all resolved to **`0cabe2944ca59821babf4e460a5d024ac89108af`**, titled **Complete Phase 5 messaging and campaign orchestration**. The remote read required network approval after the sandbox attempt failed; it performed no push or fetch mutation.

History, newest first: `0cabe29` Phase 5; `0d20036` Phase 4; `f73f5bd` Phase 3; `af76859` Phase 2; `63ddf88` Phase 1. There are five commits, so `git log --oneline -6` returned five.

Reviewed inputs: the eight-page root PDF `80-20_CRM_Simple_Developer_Brief_Updated.pdf`; ARCHITECTURE, DATABASE_SCHEMA, IMPLEMENTATION_PLAN, DECISIONS, TEST_STRATEGY and ENVIRONMENT; Phase 1–5 verification reports; migrations 001–005; current communication modules, provider boundary, database client, logging, environment configuration, tests and CI. The PDF SHA-256 recorded by the architecture is `A067692B2F2BDFBB697FE717C617510F9AAE9962A43CC1B8B2DFAD5E7F15F90A`. The PDF requires both email and text/SMS booking confirmations, filtered bulk campaigns, stored replies, reschedules/cancellations, and separate Outbound. These remain acceptance requirements.

Documentation contains historical approval headings and implementation claims that do not always match SQL. Existing code is evidence of current behavior, not permission to weaken the approved requirements. This plan identifies the differences explicitly.

| Check executed during this planning pass | Result | Limit |
|---|---|---|
| `npm.cmd test` | PASS — 67/67, five files | Unit tests only |
| `npm.cmd run test:db` | PASS — 158/158, five files | PGlite with Auth compatibility fixtures; not hosted Supabase |
| Database breakdown | PASS — 50 platform, 19 Phase 2, 60 Phase 3, 13 Phase 4, 16 Phase 5 | Coverage gaps below remain |
| `npm.cmd run typecheck` | PASS | Includes route type generation |
| `npm.cmd run lint` | PASS | Zero-warning configuration |
| `npm.cmd run security:scan` | PASS — 183 files before plan, 184 after plan, zero findings | Pattern scanner, not proof against every secret type |
| `node scripts/with-test-env.mjs build` | PASS | Production compilation using explicit disconnected test configuration |
| `npm.cmd run test:e2e` | 19 individual tests PASS, 2 SKIPPED; overall command INCOMPLETE / interrupted (exit 1) | All test outcomes printed, but runner did not exit; see final note |
| Hosted Auth/PostgREST/mutation E2E | SKIPPED — hosted Supabase not connected yet | Existing authenticated browser tests are explicitly skipped |
| Real provider tests | SKIPPED — provider credentials/test environment not configured | No network send or connection attempted |
| Dependency installation / audit | NOT RUN | Installation prohibited in this pass; existing dependencies used |

No local `.env*` file other than `.env.example`, linked Supabase project reference, or Vercel project link was found. Inspected process configuration contained no Supabase public URL, test database URL, or checked Resend/Twilio/WhatsApp/Calendly/Meta/Outbound credentials. **None detected locally** is not a claim about accounts or secrets stored elsewhere. No secret values were printed. CI defines a local Supabase reset job; its existence does not prove it ran successfully here.

## 2. Phase 5 integration analysis and activation blockers

Keep `crm.channel_accounts`, `crm.conversations`, `crm.messages`, `crm.message_events`, `crm.inbound_message_reviews`, `crm.suppressions`, `crm.campaigns`, `crm.campaign_recipients`, templates, sequences/enrollments/step executions as canonical. Keep `private.jobs`, `private.command_receipts`, existing outbox, activities and audit. Do not add parallel email/SMS, campaign, queue or lead systems.

`src/server/providers/messaging.ts` currently always returns a disconnected adapter. It performs no HTTP and never claims a successful delivery. Module commands use the authenticated Supabase client and API functions. This boundary is useful, but existing orchestration is **not ready for live activation**.

The following additional probes used an isolated in-memory PGlite database with migrations 001–005 and test fixtures, not a hosted database. They are separate from the passing baseline suite:

| Finding | Evidence / status | Required correction |
|---|---|---|
| Cross-workspace inbound write | **FAIL, reproduced:** read-only member of workspace A called `api.ingest_inbound_message` targeting B and received `unresolved_inbound` | Remove ordinary-user ingress execution; authenticated internal principal and connection-derived workspace; explicit canonical command authorization |
| Excessive message access | **FAIL, reproduced:** read-only member without lead grant selected an existing workspace message | Replace membership-only child policies and RPC reads with lead/team/report scope |
| Broken list RPCs | **FAIL, reproduced:** conversations, campaigns, sequences, message templates and inbound reviews each returned SQLSTATE `42803` | Correct aggregate ordering, paginate, add authenticated result tests |
| Campaign audience ignored | Source inspection: launch stores filters but selects workspace leads without applying them; command key unused | Validate filter grammar; freeze only authorized eligible audience; receipt/locking and accurate counts |
| Unsafe dispatch activation | Source inspection: manual messages do not enqueue a dispatch job; `system@8020crm.local` fallback can be persisted; account/channel and recipient/lead binding incomplete | Explicit verified sender, immutable destination/account snapshot, atomic message/job, quarantine legacy queue |
| Inbound dedupe incomplete | Source inspection: lookup is workspace/channel/provider ID, not account-qualified unique constraint; unresolved paths and null-account conversations can duplicate | Account-scoped external mapping, null-safe thread uniqueness, locked review resolution, hash-bound receipts |
| False actor / weak receipts | Source inspection: inbound selects an admin as actor; several commands create fresh keys or do not bind payload; launch key unused | Genuine service principal, stable caller key, same-key/different-payload conflict |
| Campaign/sequence worker gaps | Source inspection: batch does not require active parent; sequence execution lacks locking/due checks and next-step progression; partial rendering bypasses required variables | Fenced jobs, final parent and exit checks, shared renderer, complete bounded orchestration |
| Suppression history incomplete | Source inspection: mutable suppression/release state without append-only evidence; no explicit message purpose; helper callable without workspace authorization | Append suppression events, validated scope, consent policy and narrow helper grants |
| Template/message integrity gaps | Source inspection: publishing allows non-read-only roles more broadly than creation; version race; message trigger protects only selected fields | Scope-correct publishing, locked versions, freeze all send-critical fields and reject ordinary deletion |
| Missing relational boundaries | Source inspection: message campaign/enrollment references lack FKs; lead/conversation/account-channel consistency incomplete | Composite and parent-consistency constraints with data audit before validation |
| Elevated ownership / broad grants | Source inspection: Phase 4/5 differ from earlier owner-role migration discipline and grant all API functions to authenticated | Audit actual function owners, search paths and grants; explicit per-function allowlist |

The list failures also warrant checking `get_conversation_messages`, which combines a read with marking unread state. Read-only inspection must never write; use a separate authorized read-receipt command. Inbound review resolution must recheck current lead scope, serialize competing reviewers, append activity and apply sequence exits exactly once.

Phase 4 also needs prerequisite hardening before real public tracking/Meta intake: membership-only reporting/PII access; public form linking without adequate consent/proof; caller-supplied lead IDs accepted by VSL session creation; session UUID used without ownership proof; heartbeat ranges accepted without elapsed-time/continuity or event dedupe. Attribution reporting mixes monetary values without grouping currency and labels missing evidence as direct. Several list queries have aggregate-ordering or column-name inconsistencies. Treat these as source-observed risks requiring regression reproduction and repair, not already fixed functionality.

**First checkpoint is 6A.0: canonical authorization and orchestration hardening, with all providers disabled.** Security fixes span affected Phase 4/5 surfaces because enabling a provider on an unsafe shared core would compound the problem. Full VSL analytics corrections belong in 6G before player rollout. Passing 158 tests is not a security release certificate.

## 3. Provider-neutral architecture

Outbound path: authorized canonical command → frozen Phase 5 message and durable job in one transaction → worker eligibility/DNC/consent and parent-state checks → provider adapter → provider operation result → immutable message event → status projection.

Inbound path: bounded raw request → official authenticity verification → configured account resolution → durable private inbox and job → provider normalization → restricted canonical command → existing identity/conversation/meeting/lead logic → activity/outbox and any ordinary notification messages.

UI, campaigns and Calendly never call send SDKs. Adapters normalize protocols and provider policy; they cannot arbitrarily update business tables. Public routes never accept a workspace or provider name as authority. VSL browser adapters are telemetry-only and receive public site configuration, never send credentials.

Use Next.js Node runtime for webhook SDKs and bounded workers; no background work that relies on a response process staying alive. An authenticated scheduler triggers small batches of existing jobs. Lease expiry permits recovery; watchdogs measure queue age. Decide Vercel schedule/timeout suitability against required reminder latency and volumes; move the same worker to a dedicated runtime if measured limits require it. No second queue merely to accommodate a provider.

## 4. Connection, account and secret model

Use **`crm.provider_connections`** as the implementation name for the architecture's proposed `integration_connections`; do not create both. It is new, unlike existing channel accounts. Store workspace, provider enum, external account ID, status, capability flags, configuration version, verified timestamps and safe health code. Unique `(workspace_id, provider, external_account_id)`; uniquely route each external sending/receiving account to one enabled tenant unless an explicit shared-account routing design is approved. Default to separate provider accounts/subaccounts per workspace.

Keep secrets and secret-store references in a **private connection-secret binding**, inaccessible to CRM reads. The reference maps to a managed deployment secret initially; do not pretend Vercel environment variables support safe arbitrary tenant self-service updates. Operator-managed secret provisioning plus an Admin configure/verify/disable UI is the initial recommendation. If self-service OAuth is required, add an encrypted managed vault, refresh locking, revocation and audited rotation in its checkpoint. Never store tokens in normal JSON configuration.

Extend existing channel accounts with same-workspace connection reference, explicit channel, verified sender identity, capabilities and version. An account configured for email cannot service an SMS message. Distinguish credentials present, verification passed, capability enabled and connection active. Activation is deliberate and cannot flush historical `awaiting_provider` records automatically; review their sender, purpose, consent, template and age first.

Environment names proposed for implementation, with no values here:

| Area | Server-only configuration / binding |
|---|---|
| Common | `PROVIDER_WEBHOOK_BASE_URL`, `PROVIDER_WORKER_DATABASE_URL`, `PROVIDER_INGRESS_DATABASE_URL`, `PROVIDER_WORKER_TRIGGER_SECRET`, optional managed secret-store binding |
| Resend | `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`; verified domain/sender and receiving domain in nonsecret account config |
| Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_AUTH_TOKEN`; Messaging Service SID/sender in account config; optional shared-key binding only if enabled |
| WhatsApp Cloud | `WHATSAPP_ACCESS_TOKEN`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`; WABA/phone-number IDs in restricted config |
| Calendly | `CALENDLY_ACCESS_TOKEN`, `CALENDLY_WEBHOOK_SECRET`; OAuth client/refresh secret bindings only if OAuth selected |
| Meta | `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, scoped `META_ACCESS_TOKEN`, `META_CAPI_ACCESS_TOKEN`; Page/ad account/dataset IDs and pinned Graph version in config |
| Outbound | `OUTBOUND_SIGNING_KEY_CURRENT`, `OUTBOUND_SIGNING_KEY_PREVIOUS`, `OUTBOUND_KEY_ID`, allowlisted service origin |

Names are proposals, not credentials or mandatory global startup requirements. Keep the public environment allowlist limited to approved public values. Validate common config at startup and each optional provider's complete configuration when enabling/using it. Missing Resend must not break lead work or SMS. Preview deployments have no production provider secret bindings, and staging enforces recipient allowlists and a spend/throughput cap.

## 5. Durable inbox and mappings

New structures each have a single purpose:

| Structure | Authoritative purpose and constraints |
|---|---|
| `private.provider_webhook_events` | Authenticated ingress evidence: workspace/connection, provider account, delivery/item key, type, schema version, exact-body hash, minimized payload, verified/received/provider timestamps, processing state, processed time, safe error code. Unique connection/event key; no authorization headers |
| `private.provider_external_object_links` | Provider identity to canonical identity, unique connection/object kind/external ID. Typed nullable message/meeting/lead/submission FKs with exactly-one-target checks; all composite tenant FKs. Do not rely on unchecked polymorphic UUIDs |
| `private.provider_operations` | One external side-effect identity per connection/semantic key: canonical message or conversion reference, immutable request hash, state, provider ID, idempotency deadline, attempt/fence, reconciliation outcome |
| `private.job_attempts` | Minimal append-only attempt evidence tied to existing job/fence; not another scheduler |
| `crm.suppression_events` | Append-only application/release evidence for existing suppression projections |

Reuse `private.jobs` attempt count, schedule, lease owner/expiry and fence rather than adding a competing inbox lease engine. Inbox processing status is a projection; jobs own execution. Jobs contain record IDs, not copied messages or secrets. Object mappings are private because external identifiers can expose provider resources; return only authorized DTOs.

Batch webhooks are verified as a whole and expanded into independently keyed normalized items. Persist all accepted items plus jobs atomically before acknowledging the batch, or fail the request so the provider can retry; never acknowledge unpersisted items. Inbox duplicates return the provider's successful acknowledgment without repeating domain effects. Same key with different content is retained as a quarantined conflict, never overwrites the original, raises an alert, and is acknowledged only after durable quarantine. Distinguish delivery ID from message ID and status event identity.

## 6. Webhook security per provider

Read bounded bytes once, preserve them for verification, then parse. Reject unsupported content types, malformed bodies, excessive nesting, oversized/decompressed payloads and invalid signatures before side effects. Content-Length alone is not a limit. Proposed application caps below are initial limits, **not advertised provider limits**; check representative maximum fixtures before activation. Signed but unknown account references quarantine without creating CRM records. Resolve candidate key by registered endpoint/connection, authenticate, then require signed provider account fields to match it.

| Provider | Verification, replay and account binding | Proposed cap / event identity |
|---|---|---|
| Resend | Official SDK/Svix verification over raw body and `svix-id`, `svix-timestamp`, `svix-signature`; enforce SDK freshness and rotation rules. Endpoint key plus configured account and known email mapping determine tenant | 256 KiB; connection + Svix delivery ID, with normalized item identity |
| Twilio SMS | Official SDK validates `X-Twilio-Signature` with configured Auth Token, exact externally visible URL including query, and all form parameters; JSON mode uses documented raw-body validation. AccountSid and destination/sender registration must match connection. Classic signature lacks a signed freshness timestamp: dedupe and canonical state checks are mandatory | 64 KiB; AccountSid + MessageSid + event kind/status + available event discriminator; inbound MessageSid is stable message identity |
| WhatsApp Cloud | Proposed Meta app-secret HMAC-SHA256 `X-Hub-Signature-256` over raw bytes; GET verify-token/challenge is subscription setup, not POST authentication. Validate WABA/phone-number ID. No invented signed freshness field | 1 MiB; connection + message ID + event kind/status + provider occurrence discriminator |
| Calendly | `Calendly-Webhook-Signature`: HMAC-SHA256 of timestamp + `.` + exact body, constant-time comparison, bounded past/future skew (proposed ±3 minutes); require signing even where provider setup makes it optional. Organization/subscription/user mapping fixes tenant | 256 KiB; documented event ID if supplied, otherwise event type + invitee URI + provider occurrence/version, with payload hash conflict detection |
| Meta Lead Ads | Proposed same app-secret raw-body signature and separate challenge verification; Page subscription/account binding fixes tenant; validate leadgen/form/account references before fetch. Timestamp in JSON is not an independent authentication mechanism | 1 MiB; Page/connection + leadgen ID + change type; replay of lead notification reuses intake |
| Outbound | Proposed versioned HMAC-SHA256 contract in section 22; timestamp, nonce and signed account binding; separate directional keys | 64 KiB; connection + event ID, request nonce retained for replay window |
| VSL | No provider webhook signature for browser playback: consent-bound expiring session capability, site/origin checks, rate quotas and event sequence validation. Browser telemetry remains untrusted | 64 KiB per batch; session + client event ID/sequence |

For Twilio on Vercel, reconstruct only from pinned `PROVIDER_WEBHOOK_BASE_URL` and exact registered path/query; do not trust arbitrary Host or forwarded headers. Test encoding and trailing slashes. A URL token, IP list or User-Agent never substitutes for signature verification. Twilio also documents an optional shared-key webhook configuration; enable that variant only after verifying actual account configuration and SDK support, not by guessing a signature algorithm from a request. [Twilio security](https://www.twilio.com/docs/usage/webhooks/webhooks-security), [shared keys](https://www.twilio.com/docs/usage/webhooks/webhook-shared-keys).

Return 400 for malformed requests, 413 for excessive size, 401/403 for failed authenticity, and 5xx when durable storage is unavailable. After persistence, respond promptly with the provider-prescribed success response. Twilio inbound receives empty successful TwiML, with no automatic reply outside canonical dispatch; callbacks receive the documented success status. [Twilio webhook FAQ](https://www.twilio.com/docs/usage/webhooks/webhooks-faq).

Resend and Calendly verification details were checked against current official pages. Meta direct documentation requests returned HTTP 429 during planning: the Meta mechanisms above are **proposed contracts requiring official re-verification before coding**, including accepted headers, challenge behavior, retries and identifiers. Do not infer fresh verification from these links. [Resend verification](https://resend.com/docs/webhooks/verify-webhooks-requests), [Calendly signatures](https://developer.calendly.com/api-docs/overview/webhooks/webhook-signatures).

## 7. Idempotency and replay boundaries

Use four separate identities: human/system command key, canonical business semantic key, provider operation key, and webhook delivery/item key. Bind keys to canonical payload hashes and tenant/account scopes. A retry cannot change recipient, sender, template version or body under the same operation key.

Extend existing `private.command_receipts` to support a genuine service principal alongside membership: exactly one actor kind, same-workspace service binding, and unique scoped key. Existing membership receipts remain valid. Do not fabricate the first admin as actor or introduce a second general command-receipt system. Internal canonical functions derive their service actor from the restricted connection/job context, never from JSON.

Retain semantic message/meeting/intake keys as long as their canonical records exist. Keep replay tombstones beyond payload deletion. Verification timestamps limit captured-request reuse only for protocols that actually sign timestamps; provider retries can be old business events with newly signed delivery envelopes. Do not reject legitimate delayed business facts solely on occurrence age.

## 8. Dispatch worker and concurrency

1. Claim due jobs using short transactions, `FOR UPDATE SKIP LOCKED`, bounded batch, lease and increasing fence; fair workspace/account quotas prevent one campaign monopolizing workers.
2. Load canonical message and immutable account/template/purpose snapshot. Lock required parent/message/policy records in a documented order. Check active workspace/connection, valid sender, current recipient association, campaign active state, sequence enrollment/exit rules, due/send window and schedule revision.
3. Recheck DNC, destination blocks, consent and provider policy. Suppression is authoritative even on manual retry. Prioritize inbound opt-out processing; pause an account if unresolved verified opt-out ingress could make sending unsafe.
4. Create or resume the unique provider operation, persist attempt/fence and commit. Perform network I/O outside the transaction with a bounded timeout.
5. Persist acceptance, permanent rejection, known-safe retry or **unknown acceptance**, append message event, finish/reschedule job under the matching fence. An expired worker cannot overwrite a newer result. Callback correlation may resolve an operation before its send response arrives.

Suppression can arrive after the final eligibility transaction but during network dispatch. Define that transaction as the decision point, record the race, cancel subsequent pending sends, and never promise recall of an accepted message. Do not hold a database transaction open across provider HTTP to pretend this race disappears.

Campaign recipients are queued/materialized until provider acceptance, not marked dispatched merely because an internal message exists. Batch continuation and campaign completion are durable jobs. Sequence advancement creates the next eligible execution exactly once; reply, booking, show/won/lost, DNC and cancellation checks occur both when scheduling and just before sending according to approved exits. Publication and personalization use one validated template renderer.

## 9. Crash recovery and effectively-once behavior

External network delivery is not exactly-once. Recovery distinguishes crash before send, explicit nonacceptance, provider acceptance with saved ID, and acceptance with lost response. Persist operation before send so an expired lease can identify ambiguity.

Resend documents idempotency keys lasting **24 hours**, with same-key/payload replay and conflicts for changed payload. Use one stable key within that window. Beyond it, reconcile or require review rather than blindly resend. [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

Do not assume Twilio or WhatsApp send endpoints offer equivalent idempotency. Timeouts and connection resets after a possible send become `unknown`; await verified callback, query a known provider ID, or seek operator reconciliation. Absence from a fuzzy phone/time search is not proof of nonacceptance. A deliberate new send requires a new semantic operation and a clear duplicate-risk decision. Provider retry responses such as rate limiting are retried only when documentation establishes nonacceptance; honor Retry-After, bounded exponential backoff and jitter. Auth/permission/sender/template failures pause affected work rather than exhaust retries noisily.

Restore procedure: disable dispatch first, restore durable keys, reconcile recent accepted/unknown operations and webhook history, then reopen a bounded pilot. Restoring an older database must not replay all historic sends.

## 10. Status reconciliation

Append every distinct authenticated provider fact to `crm.message_events`, including late events; derive effective state with a versioned reducer. Accepted → sent → delivered → read is a partial progression where supported. A late sent event cannot regress delivered. Failed, hard bounce and complaint are separate outcomes, not integers in one simplistic status ranking. A complaint may suppress a destination after delivery without erasing the delivery fact.

Conflicting terminal facts trigger reconciliation, preserve provenance/occurrence and receipt times, and never blindly trust arrival order. Provider acceptance is not delivery, email open is not proof of human reading, and missing callbacks remain unknown. Delivery-related activities and campaign counts use semantic event keys so duplicates cannot increase KPIs. Periodic reconciliation is bounded to account-owned known objects and approved provider APIs.

## 11. Resend email checkpoint

The adapter accepts existing canonical messages with verified From, normalized To, approved Reply-To, subject, text, safe HTML, frozen template version and stable operation key. Prevent header injection; sanitize rendering/links and suppress unsafe remote content in CRM display. Save provider email ID through the external mapping and operation journal. No provider SDK in client components.

Map available accepted/sent/delivered/delayed/failed/bounced/complaint events to canonical facts, status and safe error classes. Hard bounce and complaint apply existing suppression with immutable evidence; transient delay is not automatically a permanent block. Opens/clicks are capability- and consent-gated metrics, not a new tracking project.

Inbound email requires a configured receiving domain/MX and reply routing; outbound credentials alone do not provide mailbox synchronization. The official receiving flow uses `email.received` notifications and separate retrieval of content. Resolve provider message/thread references and exact identity evidence through canonical inbound handling; quarantine ambiguity and missing account mappings. Do not fetch arbitrary attachment/URL links from payloads; attachments remain out of scope unless separately approved. [Resend receiving](https://resend.com/docs/dashboard/receiving/introduction).

Before implementation verify SDK version, webhook event schemas/retries, API error semantics, domain authentication, receiving setup, reply headers and signing-key rotation. Live acceptance requires a controlled email recipient, actual delivery plus reply, bounce/complaint fixtures, signed duplicate replay and unknown-operation recovery.

## 12. Twilio SMS and opt-out checkpoint

Use E.164 identities with explicit country context, registered business number or Messaging Service, scoped API key for outbound and correct verification secret for callbacks. Persist MessageSid as an account-qualified mapping. Configure status callbacks and inbound routing; no Voice SDK, dialer, recording or call UI.

Normalize inbound SMS only after signature validation, then invoke the hardened canonical ingestion command. It resolves existing normalized identity claims, creates one conversation/message/activity, exits relevant sequences and links campaign response evidence. Zero/multiple matches and unknown sender account go to durable review; no fuzzy matching or duplicate route-local lead logic.

Twilio Advanced Opt-Out provides `OptOutType` for configured Messaging Services. Use it as verified provider evidence; do not assume every number/service emits it. STOP applies destination/channel provider block and cancels pending work; START can release only the corresponding provider-owned block after verified evidence. It cannot clear global DNC, complaint, other-channel suppression or manufacture marketing consent. Provider-managed confirmation must not cause a duplicate CRM auto-reply. HELP is not opt-in. Preserve apply/release history, and conservatively classify ambiguous text according to approved policy. [Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out).

Handle provider opt-out rejection as suppression evidence and operational failure. Do not promise a complete provider blocklist synchronization endpoint: verify account capabilities first. Live prerequisites include country-specific registrations, sender ownership, permitted test destinations and deliberate STOP/START test consent. Recheck callback fields, URL validation, opt-out configuration and error taxonomy before implementation.

## 13. WhatsApp provider comparison and recommendation

| Consideration | Meta WhatsApp Cloud API | Twilio WhatsApp |
|---|---|---|
| Boundary | Direct Meta adapter, canonical CRM unchanged | Twilio adapter, canonical CRM unchanged |
| Credentials | Meta business/app token, WABA and phone-number assets | Twilio credentials plus onboarded WhatsApp business/sender assets |
| Webhooks | Meta app signature, WABA/phone routing | Twilio signature and account/message routing |
| Templates | Meta template identities/language/approval lifecycle | Twilio content/template mapping and underlying WhatsApp approvals |
| Status/inbound | Meta message IDs and delivery/read events | Twilio message IDs with supported WhatsApp delivery/read/inbound fields |
| Dependency | Direct Meta operational responsibility | Twilio plus Meta; shared SMS operations but extra intermediary |
| Operations | Separate token, Graph version, subscription and quality management | Consolidated Twilio support/tooling; migration and provider-specific template mapping remain |

**Recommend Cloud API, conditional on client ownership/approval of Meta assets**, because Meta attribution/Lead Ads already require direct Meta operations and the CRM should retain direct WhatsApp account control. This is an architectural recommendation, not a verified claim of lower price or easier onboarding. If the client already operates an approved Twilio WhatsApp number/templates and prioritizes that operational setup, choose Twilio instead. Obtain account/migration facts before committing; implement one adapter only. Current Twilio documentation confirms its customer-service window and approved-template model, but Meta Cloud details still need direct documentation verification. [Twilio WhatsApp concepts](https://www.twilio.com/docs/whatsapp/key-concepts).

## 14. WhatsApp policy and canonical messages

A channel policy determines free-form eligibility from the last verified inbound customer message and the currently documented service window (typically 24 hours; reverify for selected API), or requires an approved template. Store template ID/name, language, category, approval state and variable mapping against existing immutable CRM template versions; rejection/paused template blocks dispatch, never silently falls back to free text.

Freeze provider policy evidence on each operation. Map read/delivered/inbound/failure to existing message events. Opt-in evidence and country/account limits are activation gates. Business-initiated bulk sends still use existing campaign audiences, consent, DNC, scheduling and sequence exits. No Twilio Conversations product or parallel WhatsApp inbox is required.

## 15. Calendly into Phase 3 meeting truth

Verified inbox → connection/event-type mapping → exact identity resolution → internal canonical meeting command → `crm.meetings` and existing meeting history/activity/credit → outbox → ordinary Phase 5 notification messages.

Existing Phase 3 commands require a human member and support manual meeting source. Add an internal provider facade over shared private business logic; extend source constraints additively. Do not impersonate a manager or call SET blindly. Uniquely map connection/invitee booking occurrence; lock booking chain, preserve one set credit across reschedules and current attendance truth. Late provider events must not reopen won/lost journeys or rewrite historical closer/setter credit.

Booking/cancellation/reschedule processing uses documented event relationships, not nearby timestamps. Persist cancellation/new-booking halves until their linkage can be resolved; support either arrival order, duplicates and missing halves. A cancelled old occurrence cannot cancel its replacement. Provider attendance/no-show signals are not imported unless explicitly approved; CRM remains authoritative for sales attendance.

Match verified opaque booking correlation and exact normalized email/phone claims within the workspace. Custom answers claiming a CRM lead UUID are untrusted without a server-issued binding. Conflicting identities or unmatched bookings remain in a restricted integration review queue backed by the inbox, not the message-specific inbound review table. Reviewer resolution reruns the same canonical command with a receipt and audit trail.

Calendly supports explicit signing keys for PAT subscriptions and generated signing keys for OAuth apps; require signing in either case. Reverify current plan/organization permissions, subscription scopes, event payloads, reschedule linkage and retry behavior before coding. PAT may suit one internal organization; OAuth is a separate decision for multi-organization self-service. [Calendly signatures](https://developer.calendly.com/api-docs/overview/webhooks/webhook-signatures).

## 16. Booking notifications and automation

Implement the architecture's missing `crm.automation_rules`, `crm.automation_rule_versions` and `crm.automation_executions` only for approved finite event triggers, reusing templates/messages/jobs. These represent versioned trigger intent and execution identity, not another delivery subsystem. Unique rule-version/trigger/subject/schedule-revision prevents duplicate notifications.

Booking confirmation produces **both email and SMS/text** messages when eligible. Reminders (proposed 24 hours and 1 hour), reschedule confirmation and cancellation notification use the same dispatch. No-show/cancellation follow-up may enroll an approved existing sequence; it must not create unlimited automation loops. Invalidation on schedule revision cancels obsolete reminders; worker checks revision again just before dispatch. Decide what happens when booking occurs inside a reminder window; proposed skip elapsed reminders and send only confirmation.

Each rule/template/message has `transactional` or `marketing` purpose under an approved versioned policy. Booking-service content is not a license to add promotions or bypass DNC. Record suppressed, missing-channel and missing-address outcomes and surface actionable follow-up. Do not silently substitute WhatsApp for required SMS or send from an unverified fallback. Consent absence blocks marketing where positive consent is required; jurisdiction and transactional exceptions require client policy approval.

## 17. Meta Lead Ads intake

Verify Page webhook and persist notification, then fetch necessary lead fields with a scoped token through a fixed, versioned Graph client. Never fetch payload-provided arbitrary URLs. Require configured Page/form ownership and source mapping before intake. Retry temporary retrieval/rate failures through jobs; auth loss pauses connection and preserves backlog.

Use existing `private.intake_records` with stable connection/leadgen key, the Phase 2 identity lock/claim/conflict model, Phase 4 form submission/answers and attribution. Extract one canonical private intake routine rather than reuse the unsafe anonymous public form entry point or create a second Meta lead database. Version external form/question mappings to existing form versions; missing fields remain missing, and provider claims never overwrite verified contact data silently. Attribution, assignment, journey, answers, activity and intake result commit together. Ambiguous identity stays reviewable.

Verify current Graph version, `leadgen` subscription schema, token type/lifetime, Page access, `leads_retrieval` and other actual required permissions/app review, test-lead tooling and retrieval retention before implementation. Permissions listed here are candidates, not a complete approval guarantee. [Official retrieval documentation — fetch blocked by 429 during planning](https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving/).

## 18. Meta attribution preservation

Preserve available campaign, ad set, ad, creative, Page, form and leadgen IDs as strings, with provider/source/trust and occurrence/receipt times. An ad ID alone does not prove creative or campaign metadata; enrich only through authorized provider relationships and leave missing values unknown. Client-supplied UTMs/external IDs are observed evidence, distinct from provider-verified identifiers.

Extend existing touches and first/latest projections with immutable selection revisions and conversion snapshots where missing, as specified by the approved schema. Retain original evidence and snapshot/model versions; late enrichment appends revisions rather than overwriting history. Join booking → setter/closer credits → won/lost/nurture → deal value/cash without mixing attribution models or currencies. Preserve fbp/fbc and other relevant identifiers only under approved consent and minimization policy.

The architecture also preserves Meta Marketing API dimension/insight support. Do not silently claim ad-spend/ROAS or all Meta messaging are delivered by Lead Ads. Treat dimensions/insights and supported Page/Instagram messaging as separately scoped capability decisions; existing raw IDs do not require a full ads reporting warehouse in 6F. If approved, use the architecture's ad account/campaign/ad set/ad/creative relations, historical revisions and grain-specific facts rather than messaging `crm.campaigns`.

## 19. Optional Meta CAPI — mappings require approval

| CRM fact | Proposed Meta mapping | Approval and semantic key |
|---|---|---|
| First qualifying canonical lead intake | `Lead` | One connection + qualifying intake/activity, not every duplicate form |
| New booking chain | `Schedule` | One original chain; reschedule does not emit another acquisition conversion |
| Verified attendance | Custom `Show` | Explicit business approval and current API validation; no invented standard event |
| Deal closed won | Custom `ClosedWon` initially | Do not equate contract value with cash automatically |
| Settled receipt, or won deal if chosen instead | `Purchase` | Client must choose trigger/value/currency/refund policy; never count both as the same sale |

Add `crm.conversion_emissions` from the approved schema to bind source fact, destination, approved mapping version and stable event ID, using existing jobs/provider operations for delivery. Pixel and CAPI, if both approved, share the same event name/event ID for the same event/dataset. Do not create a new ID on retry. No Pixel injection is implied by backend CAPI planning.

Consent is checked when creating and dispatching emissions. Minimize user data, normalize/hash only fields officially requiring it, never indiscriminately hash identifiers such as fbp/fbc, and protect even hashed PII. Preserve source event time rather than changing it to evade provider age limits. Expired retry windows become review outcomes. Reverify matching parameters, required fields, permitted event age, dedupe scope/window, test-event mode and current action-source rules before coding. [Official CAPI deduplication documentation — fetch blocked by 429](https://developers.facebook.com/docs/marketing-api/conversions-api/deduplicate-pixel-and-server-events/).

## 20. VSL adapter strategy

Client has not identified the actual player or installable page domains. Implement **one confirmed player**, not HTML5, Vimeo and Wistia together. Prefer HTML5 only if the real page uses native video; otherwise select its actual provider SDK. No video hosting, funnel builder or replacement analytics subsystem.

Normalize play/pause/resume/buffering/seek/rate/end into the existing VSL session contract, with monotonic elapsed time, position, rate, visibility, client event ID and sequence. Seek closes the old interval and opens a new anchor; no segment spans a jump. Validate server-side against authoritative asset duration and elapsed-time bounds. Retry/out-of-order events must recompute contributions without inflating replay/retention; total active elapsed, media coverage, unique coverage, completion and ended remain distinct.

Before adapter rollout, repair Phase 4 proof/consent and session authorization, add missing replay/dedup/sequence and derivation structures from the approved schema, implement total/replayed watch-time and drop-off/heatmap metrics actually required, and repair scope/currency/unknown attribution reporting. Existing integer-second storage may require additive millisecond fields with documented conservative backfill; do not reinterpret old numbers or fabricate sample timing. Label old unverified telemetry and exclude it from trusted aggregates when evidence is insufficient.

Anonymous-to-known linking must be bounded to a consented site session and server-issued submission proof, with withdrawal/expiry. Knowing a lead or session UUID is insufficient. Public-key/origin checks are abuse controls, not identity proof; do not fingerprint users. Require distributed rate limits before production telemetry; current in-memory limiter is not distributed.

Verify selected SDK events, seek/buffering semantics, duration/version and iframe origin behavior before coding. Native API reference: [HTMLMediaElement](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement). Vimeo/Wistia SDK selection and official fixture research remain pending actual player confirmation.

## 21. Separate 80/20 Outbound contract

6H first delivers a reviewed versioned contract, not a live connection. No shared database, direct Supabase query, copied code, dialer UI or unrestricted shared credential.

Proposed v1 envelope: schema version, event ID, occurrence time, source product/account, opaque mapped workspace reference, external aggregate ID/version, correlation/causation IDs and minimized typed payload. CRM owns lead/contact identity, assignments, pipeline, DNC/consent, outcomes and money. Outbound owns call execution/attempt identity and observed call facts.

CRM → Outbound: eligible contact snapshot, assignment context and priority DNC update. Future call request is reserved but disabled until separately approved. Outbound → CRM: started/completed call, duration, disposition and bounded notes, mapped to canonical activity/notes. A disposition is evidence, not authority to close a deal or overwrite assignment. Call event duplicates cannot add activity twice; late started cannot regress completed. Corrections append revisions with source references.

Define endpoint schemas, allowed transitions, field limits, HTTP error/ack contract, event-version negotiation and deprecation policy jointly with the Outbound owner. DNC is bidirectional, provenance-bearing and highest priority. Stop eligible-contact exports/call requests if suppression synchronization is stale; proposed five-minute freshness threshold needs operational approval. Reconciliation compares explicit cursors/versions, never direct tables. A failed DNC acknowledgment surfaces an alert and prevents further export for affected scope.

## 22. Outbound service authentication

Recommend TLS plus per-environment, per-direction, per-account HMAC-SHA256 initially. Sign canonical method, path/query, timestamp, nonce, account/key ID and exact-body SHA-256; publish canonicalization test vectors. Verify constant-time, ±5-minute skew, nonce uniqueness and allowed event scope. Persist event ID dedupe beyond nonce expiry. Requests cannot choose workspace through payload metadata.

A static scoped API key alone lacks body integrity/replay defense, so is insufficient by itself. OAuth client credentials with audience/scopes or mTLS may suit a mature gateway; choose only if both products can operate lifecycle and rotation. Keep a short audited old/new key overlap (proposal 24 hours), explicit key IDs, immediate revocation and no default fallback to unsigned traffic. Rotation preserves event identities; credentials never reach browser or shared database roles.

## 23. Failure recovery and operational actions

| Failure | Action / replay rule |
|---|---|
| Signature failure | Reject, count minimized security event; no business mutation; inspect endpoint/key configuration without logging request |
| Inbox processing failure | Durable job retry for classified transient errors; dead-letter/review after bound; same canonical semantic key |
| Auth revoked / disabled provider | Pause affected connection jobs, show actionable safe code, preserve queue; no failover to another sender |
| Sender/template misconfiguration | Block operation until corrected and explicitly revalidated; frozen payload cannot silently change |
| Unknown send acceptance | Reconcile provider fact; never ordinary automatic resend |
| Unresolved inbound / Calendly / Meta match | Role-scoped review, exact evidence, locked audited resolution; no speculative association |
| Rate limit / outage | Per-account circuit breaker, Retry-After and jitter, oldest-job alert, controlled recovery |
| DNC or consent withdrawal | Suppress/cancel pending sends and sequence work, retain evidence; retry cannot override |

Admin failure actions operate through idempotent commands with reason and current authorization. “Retry” means eligible safe recovery, not “send anyway.” Reprocessing uses stored authenticated provenance and current policy; it is not a public webhook-authentication bypass endpoint.

## 24. Settings → Integrations and health

Plan cards for Resend, SMS, WhatsApp, Calendly, Meta, VSL and Outbound with `not_configured`, `configured`, `verification_required`, `active`, `degraded`, `disabled`, `error`. Show independently verified capabilities, last safe check, last received/processed event, queue age and unresolved counts. Configured is never displayed as connected.

Admin can configure, verify, disable and review failure metadata; secret inputs are write-only through approved provisioning, with no readback. Verification uses harmless provider account checks before an explicitly controlled test send. Managers see operational state for their scope and allowed recovery actions, not account secrets/raw payloads. Do not build this UI in the planning pass.

## 25. Exact RBAC boundaries

| Action | Admin/Owner with existing MFA | Manager | Setter / Closer | Read-only |
|---|---|---|---|---|
| Configure/rotate/activate/disable connection | Yes, own workspace, audited | No | No | No |
| Safe connection health | Workspace | Managed team operational subset | Used-channel availability only | Approved reporting projection only |
| Read messages / send | Authorized workspace | Managed leads/team accounts | Assigned or explicitly granted lead/account | Only approved read scope; never send |
| Retry known-safe failed message | Authorized scope, policy enforced | Managed lead, safe retry only | Normal new messaging command only | No |
| Resolve unknown send / conflicting provider event | Privileged reviewed action | No default permission | No | No |
| Inbound/booking identity review | Yes | Managed-team candidates only; no cross-scope candidate PII | No default permission | No |
| Raw inbox / credentials | No normal UI read; controlled operator process | No | No | No |

Inactive memberships grant no access. Browser roles are never trusted. Export/report grants do not imply message content, integration administration or secret access. A manager cannot grant themselves integration privilege. Worker identity is distinct from human roles and can execute only configured provider canonical operations.

## 26. Database isolation and worker privileges

Every new tenant-owned structure has non-null workspace, unique `(workspace_id,id)` and composite tenant FKs. Enforce same message/conversation lead, account/channel, connection/account, campaign/enrollment and provider mapping relationships. Add type/shape checks so a suppression with missing subject cannot silently do nothing. Audit preexisting violations before adding/validating constraints; quarantine them rather than relabeling ownership.

Keep `crm` and `private` outside exposed Data API schemas. RLS applies lead/team/report scope on ordinary reads; only intentional API functions are executable. New definer functions have fixed empty search path, explicit owner and no PUBLIC default grants. Review all old blanket grants additively. Restrict access to lookup helpers that otherwise permit cross-tenant identity/suppression probing.

Use dedicated least-privilege ingress and worker database roles with execute rights on narrowly scoped private functions, no blanket table mutation or BYPASSRLS/service-role key. Bind their calls to registered connection/service principal; security-definer functions still validate every cross-reference. Human RPCs retain JWT membership checks. The existing `pg` dependency is dev-only; production worker packaging would require an explicit reviewed dependency move if direct PostgreSQL access is chosen. Use pooling, TLS and short transactions; no credentials in browser bundles.

Test all new functions as anon, each human role, inactive member, other tenant and each internal role. RLS alone does not protect a definer function that lacks its own checks. Realtime sends minimal scoped invalidations, not private inbox payloads, and refetch reauthorizes current membership.

## 27. Privacy and retention

Proposed defaults for approval: minimized successful webhook payloads 7 days; failed/review payloads 30 days with explicit hold; operational logs 30 days; delivery dedupe tombstones at least 90 days and beyond the accepted provider replay window. This refines the architecture's provisional 30-day raw-payload assumption; no deletion is authorized now. Canonical message/meeting/lead facts, operation semantic keys, suppression/consent and audit follow the approved business/legal schedule rather than arbitrary payload TTL.

Keep only fields needed for normalization/review, encrypt protected content at rest, exclude headers/secrets, and separate durable hashes/IDs from erasable PII. Retention jobs use existing queue and audited policy versions, bounded deletes and legal holds; erasure propagates to retained payloads and VSL contributions as required. Permanent domain semantic keys prevent archived replay from recreating sends after inbox tombstones expire. Restores require reapplying erasure obligations. Hashed identity is still sensitive data.

## 28. Telemetry, capacity and observability

Extend `src/server/telemetry/logger.ts` allowlists for `provider.send_attempt`, `provider.send_accepted`, `provider.send_failed`, `provider.webhook_received`, `provider.webhook_rejected`, `provider.webhook_processed`, `provider.webhook_failed`, reconciliation and suppression outcomes. Log request/event/job/operation/connection IDs, provider enum, safe code, duration, attempt and status; never bodies, phone/email, tokens, auth/signature headers, raw provider errors or form answers.

Metrics: ingress rejection/conflict rate, oldest queued age, lease expiry, attempts, unknown operations, acceptance/delivery latency, unresolved review age, auth failures, suppression blocks and per-account quota use. Alerts need named owner/runbook and explicit thresholds after volume/SLA approval. A health page is not monitoring by itself.

Index connection/event unique keys, external object lookup, workspace/message events by occurrence+ID, conversation cursor, account/operation state, and existing due/expired-lease jobs. Add partial indexes for actionable inbox/review states and suppression lookup; use EXPLAIN with realistic tenant volumes. Bounded batches, pagination and per-tenant fairness precede partitioning. Do not stream VSL raw events or full inbox records through Realtime.

## 29. Additive migration strategy

Never edit 001–005. The following are proposed filenames reserved by sequence; adjust date prefixes to actual implementation day before first creation, never rename an applied migration.

| Checkpoint | Proposed new migration | Scope |
|---|---|---|
| 6A.0 | `202609230006_phase6_canonical_hardening.sql` | Scope/grants/ownership, list RPC fixes, audience/sequence correctness, immutable suppression evidence, message/account constraints and receipts |
| 6A.1 | `202609230007_phase6_provider_infrastructure.sql` | Connections/private bindings, inbox, mappings, operations, job attempts, service principal receipts and narrow worker commands |
| 6B | None by default | Resend is an adapter; only add a migration if verified required capability cannot fit existing canonical fields |
| 6C | None by default | SMS reuses channel/account/suppression model |
| 6E | `202609230008_phase6_calendly_automation.sql` | Meeting source/mapping support, shared meeting commands and finite automation rules/executions |
| 6D | `202609230009_phase6_whatsapp_policy.sql` | Selected provider template binding/policy evidence, only where generic config is insufficient |
| 6F.1 | `202609230010_phase6_meta_intake_attribution.sql` | Canonical intake/form external binding and missing immutable attribution versions/snapshots |
| 6F.2 | `202609230011_phase6_meta_conversion_emissions.sql` | Approved opt-in CAPI emission identities |
| 6G | `202609230012_phase6_vsl_integrity.sql` | Session proof/consent, event dedupe/timing and missing trusted analytic derivations |
| 6H | None for contract-only checkpoint | No Outbound database coupling; later connection changes require separate approval |

Each migration has empty-database and upgrade-from-005 tests, grant/owner assertions, tenant constraint probes and bounded data backfill/quarantine. Additive includes replacing unsafe function bodies/policies and tightening grants in a new migration; it does not mean leaving a vulnerable old entry point available. Stage compatible deployment order and drain jobs where needed. Roll back app/activation flags while retaining new data; never revert a security fix or delete history to recover a provider rollout. Failed validation blocks activation, not a weakened constraint.

## 30. Expected file changes during later implementation

These are concrete planned paths, **not files created in this pass**. Keep each checkpoint narrow; do not scaffold unused providers.

| Checkpoint | Expected files |
|---|---|
| 6A.0 | Migration 006 above; `src/modules/conversations/commands.ts`, `validation.ts`, `types.ts`; `src/modules/campaigns/commands.ts`; `src/modules/sequences/commands.ts`; `src/modules/templates/commands.ts`; `src/modules/compliance/suppression.ts`; `tests/database/phase5.test.ts`; new `tests/database/phase6-hardening.test.ts`; affected Phase 4 authorization tests |
| 6A.1 | Migration 007; `src/server/providers/messaging.ts`; new `src/server/providers/contracts.ts`, `registry.ts`, `connections.ts`, `errors.ts`; `src/server/providers/webhooks/ingress.ts`, `envelope.ts`; `src/server/jobs/claim.ts`, `dispatch.ts`, `reconcile.ts`; `src/server/database/worker.ts`; `src/modules/compliance/policy.ts`; `src/modules/integrations/commands.ts`, `types.ts`; `src/server/config/schema.ts`, `env.ts`; `src/server/telemetry/logger.ts`; `src/server/security/rate-limit.ts`; `src/app/api/internal/jobs/route.ts`; `src/app/(workspace)/[workspace]/settings/integrations/page.ts`; `src/server/database/types.ts` |
| 6B | `src/server/providers/resend/adapter.ts`, `webhook.ts`, `normalize.ts`; `src/app/api/webhooks/resend/[connectionId]/route.ts` |
| 6C | `src/server/providers/twilio/adapter.ts`, `webhook.ts`, `normalize.ts`, `opt-out.ts`; `src/app/api/webhooks/twilio/[connectionId]/route.ts` |
| 6E | Migration 008; `src/server/providers/calendly/webhook.ts`, `normalize.ts`, `client.ts`; `src/app/api/webhooks/calendly/[connectionId]/route.ts`; `src/modules/sales/commands.ts`; new `src/modules/sales/provider-meetings.ts`; `src/modules/automations/booking.ts`; existing conversation/template commands as needed |
| 6D | Migration 009; `src/server/providers/whatsapp/adapter.ts`, `policy.ts`, `normalize.ts`; `src/app/api/webhooks/whatsapp/[connectionId]/route.ts`; `src/modules/templates/types.ts` and approved-template binding commands. If Twilio chosen, replace Cloud transport with `src/server/providers/twilio/whatsapp.ts`; do not ship both |
| 6F.1 | Migration 010; `src/server/providers/meta/graph.ts`, `lead-ads.ts`, `webhook.ts`; `src/app/api/webhooks/meta/[connectionId]/route.ts`; `src/modules/lead/commands.ts`; `src/modules/forms/commands.ts`; `src/modules/attribution/commands.ts`, `types.ts` |
| 6F.2 | Migration 011; `src/server/providers/meta/conversions.ts`; `src/modules/attribution/conversion-policy.ts` |
| 6G | Migration 012; `src/modules/vsl/commands.ts`, `math.ts`, `types.ts`; new `src/modules/vsl/player-contract.ts`, `session-proof.ts`; exactly one of `src/modules/vsl/players/html5.ts`, `vimeo.ts`, `wistia.ts`; `src/app/api/public/vsl/[publicKey]/session/route.ts`, `src/app/api/public/vsl/[publicKey]/heartbeat/route.ts`, `src/app/api/public/forms/[publicKey]/submit/route.ts`; matching approved player embed code |
| 6H | `docs/integrations/OUTBOUND_V1_CONTRACT.md`, `docs/integrations/OUTBOUND_V1_EXAMPLES.json`; no runtime adapter in contract-only scope |
| Shared verification / deployment | New `tests/unit/providers/*.test.ts`, `tests/database/phase6-*.test.ts`, `tests/contracts/providers/*.test.ts`, `tests/fixtures/providers/*.json`, `tests/e2e/integrations.spec.ts`; `scripts/test-database.mjs`, `.github/workflows/ci.yml`, `vitest.config.ts`, `playwright.config.ts` if needed; approved SDK additions to `package.json`/lockfile; `.env.example` names only; `vercel.json` worker scheduling only after hosting decision; `docs/PHASE_6_VERIFICATION.md` and relevant architecture/environment/decision amendments |

`*.test.ts`/fixture families are bounded by selected adapter and split into signature, normalization, status and recovery tests; actual test filenames must be listed in each implementation checkpoint review. Do not modify unrelated modules to manufacture a giant integration diff.

## 31. Unit, database, contract, browser and live tests

Unit: official signature vectors plus wrong-secret/raw-byte/URL variants; normalized payload validation; stable hashes; status partial order; retry/error classification; template safety; WhatsApp window/template rules; approved CAPI mapping; VSL seek/elapsed/union/replay reducer.

Database: all human/internal roles; account/workspace composite FKs; immutable records; command/inbox/operation same-key conflict; canonical inbound and review once; monotonic status; DNC propagation/release provenance; campaign filtered audience and account scope; cancelled/paused parents; sequence due/next/exit; meeting reschedule pair permutations and unchanged credits; Meta intake identity contention; late attribution/currency; lease/fence and receipt recovery. Use real PostgreSQL concurrent sessions for lock/race tests, not PGlite alone.

Contract: representative minimized fixtures sourced from current official documentation and version-pinned schemas. Test signed raw bytes, batched events, absent optional fields, new harmless fields, unknown enum quarantine and error responses. Label all fixtures/simulated provider acceptance as tests; production adapter must never return fixture success.

Browser: authenticated roles on configured staging/local Supabase, direct PostgREST attempts, Settings permissions, operational review, unsafe retry denial and actual canonical state changes. Existing unauthenticated routes alone do not verify these. CI's current live DB runner needs extension beyond its platform scenarios to cover all provider functions and real API exposure.

Live: isolated client-owned provider environment/recipients only after authorization. Verify configured account, send, actual receipt, reply, opt-out, signed callback, rotation/revocation and outage/recovery per channel. Calendly real booking/reschedule/cancel must create exactly one chain with canonical email and SMS intents/results. Meta test leads must dedupe and preserve available attribution; CAPI uses documented test mode and approved mappings. Selected real player must earn zero skipped coverage. A sandbox acceptance response is not production delivery proof.

## 32. Security threat model and explicit negative tests

| Threat | Required test and expected result |
|---|---|
| Forged Resend/Twilio/WhatsApp/Calendly/Meta webhook | Separate wrong/missing secret and tampered-byte cases for every adapter; zero inbox business effects, safe reject |
| Replay | Stale/future signed timestamp where available; repeated nonce; repeated valid event where no timestamp; reject or idempotent no-op as applicable |
| Duplicate / conflicting duplicate | Same key+hash produces one canonical effect; different hash quarantines, alerts, preserves original |
| Oversized/malformed input | Chunked/decompressed over-limit, bad JSON/form encoding, excessive array/depth; bounded failure without storage or crash |
| Cross-workspace event | Valid signature for A with B account/message/lead/meeting references; reject/quarantine, no B mutation or PII |
| Metadata injection | Workspace/actor/lead ID, provider URL, role and sender fields in payload cannot override registry or scoped commands |
| Unauthorized retry | Setter/closer/read-only/inactive member and wrong-team manager denied at API and DB; role spoof has no effect |
| DNC bypass | Suppress between scheduling and send, during retry and after merge; no subsequent permitted send; in-flight race recorded honestly |
| Secret / PII leak | Sentinel keys, body, email/phone and malicious SDK error checked across logs, telemetry, API DTOs, browser bundle and failure UI |
| Worker overreach | Ingress cannot dispatch; human cannot ingest provider facts; worker cannot change memberships, money or arbitrary tenant rows |
| Concurrency | Two workers, expired fence, callback-before-response, crash-after-acceptance, duplicate reschedule halves; no duplicate canonical effects or blind resend |
| SSRF / injection / abuse | Payload URLs cannot cause arbitrary fetch; SQL filters allowlisted; HTML/header injection escaped/rejected; distributed per-account/site limits |
| Consent / telemetry forgery | UUID-only lead association, arbitrary watched ranges, replayed heartbeat and seek-to-end rejected; withdrawal removes permitted future association |

## 33. Decisions requiring client review

1. Approve 6A.0 scope to repair discovered Phase 4/5 authorization and orchestration defects before enabling any provider; approve this as a prerequisite rather than treating passing baseline tests as acceptance.
2. Confirm workspace/account isolation and manager/team/reviewer scope; initial operator-managed credentials versus self-service OAuth; accountable integration operator.
3. Select WhatsApp Cloud or existing Twilio setup after inventorying numbers/WABA/templates and migration constraints.
4. Supply actual VSL player/site domains and script access; approve consent, session linkage, visibility, completion, drop-off and retention policy.
5. Approve marketing versus transactional rules, STOP/START/re-opt-in handling, countries/send windows and fallback tasks for blocked booking messages.
6. Confirm Calendly organization/event-type/closer mappings, unmatched-booking handling and reminder schedule; cancellation/no-show sequence rules.
7. Approve CAPI event mapping, deal value versus received cash, refund behavior, Pixel pairing and consent purposes. Decide whether Meta dimensions/spend/ROAS and supported non-WhatsApp messaging need separate delivery checkpoints.
8. Confirm volumes, throughput/budget, reminder lateness tolerance, worker hosting, alert owner and retention/legal hold schedule.
9. Nominate Outbound contract owner, identity/disposition schemas, source-of-truth conflict rules and DNC freshness SLA.

Unresolved choices block their affected activation, not unrelated offline hardening. No credentials should be pasted into a plan or chat to answer these questions.

## 34. Infrastructure and credentials required later

Client-controlled staging/production Supabase and Vercel, configured Auth/MFA users for all roles, private worker/ingress role provisioning, HTTPS webhook origins, distributed abuse control, migration/backup privileges and alert destinations. Verify regional requirements and account-plan quotas.

Resend: scoped API key, webhook signing secret, verified sender DNS and receiving DNS for replies. Twilio: account/subaccount, scoped API credentials, verification secret, sender/Messaging Service and country registrations. WhatsApp: chosen provider credentials, business/WABA/phone assets, approved templates and opt-in evidence. Calendly: authorized PAT or OAuth application, mandatory signing key, organization/user/event-type scopes and test event. Meta: owned app/Page/ad account/dataset assets, reviewed permissions, scoped tokens, signing secret and subscription verify token. VSL: actual player/domain control, consent configuration and test media/version. Outbound: approved contract, dedicated staging endpoint and directional service keys only when connecting is separately authorized.

Do not mark any capability active merely because these fields exist. Real production activation follows recorded staging evidence and a bounded recipient pilot; plan approval alone does not authorize uncontrolled sends.

## 35. Checkpoint acceptance, live prerequisites and rollback

All checkpoints require typecheck, lint, unit/DB regression, build and secret scan, plus relevant tests below. A skipped live test is recorded SKIPPED and cannot satisfy activation acceptance.

| Checkpoint | Acceptance tests / evidence | Live prerequisites | Rollback boundary |
|---|---|---|---|
| 6A.0 canonical hardening | Reproduce and fix each critical finding; cross-tenant inbound denied; scope-correct reads; filtered campaigns; valid lists; immutable suppression; locked safe orchestration; upgrade audit | No provider credentials; real local/staging PostgreSQL/Auth required to complete concurrency/API authorization evidence | Leave providers disabled; retain corrective migration; roll forward security fixes |
| 6A.1 infrastructure | Durable ACK, conflict inbox, narrow roles, atomic jobs, fenced crash recovery, unknown status, safe health UI and no secret exposure | Staging Supabase, role provisioning, secret store and scheduler; provider fixtures only | Disable worker/ingress activation; retain inbox/operation history and keys |
| 6B Resend | Canonical send/delivery/reply, correct signatures, bounce/complaint suppression, 24-hour idempotency edge tests | Verified domain/receiving DNS, scoped key and signing secret, controlled mailbox | Disable email account; stop new dispatch, continue verified reconciliation |
| 6C SMS | E.164 send/receipt/reply; URL signature variants; STOP/START immutable scope; DNC retry rejection | Registered Twilio sender/service and consented test phone | Disable SMS sending; preserve opt-out intake/reconciliation |
| 6E Calendly | Booking/reschedule/cancel permutations, exact match/review, one set credit, dual-channel confirmation, obsolete reminder cancellation | Signed subscription/event type; 6B+6C activated in staging for real notification evidence | Disable new automation/booking ingestion by connection, preserve meeting chain; drain/review old jobs |
| 6D WhatsApp | Chosen single transport, approved template and window policy, delivered/read/inbound and suppression, filtered campaign pilot | Approved business number/templates/token and test recipients | Disable WhatsApp sends; retain template/mapping/history; no automatic provider swap |
| 6F.1 Lead Ads/attribution | Signed Page events, retrieved owned form data, exact dedupe/answers, immutable first/latest and unknown values | Meta reviewed permissions, test form/lead tooling, current Graph docs verified | Disable subscription processing; preserve inbox/intake, no duplicate imports on resume |
| 6F.2 optional CAPI | Approved mapping/consent, stable IDs and browser/server pairing where enabled, no duplicate revenue, test-mode evidence | Client mapping approval, dataset/token/test-event setup | Disable emissions; retain keys and unknown state; no replay-all restart |
| 6G VSL | One real player; seek gaps zero; proof/consent, replay and multiple tabs; retention/replay heatmap/drop-off math and load evidence | Actual installable page/player plus privacy approval and forecast | Disable new telemetry script; retain versioned evidence, invalidate bad projections explicitly |
| 6H Outbound contract | Reviewed v1 schemas, signature vectors, replay/DNC/ordering examples and ownership agreement | Counterpart owner review; no live credentials needed for contract | Documentation version only; runtime connection remains disabled |

## 36. Exact recommended implementation order and official-document gates

**6A.0 → 6A.1 → 6B → 6C → 6E → 6D → 6F.1 → optional 6F.2 → 6G → 6H contract review.** Obtain account/player/Outbound ownership decisions early while implementing independent approved work. This deliberately changes the older plan's Calendly-first suggestion: prove canonical dispatch and both required notification channels first, then verify Calendly end to end. Labels retain the user's requested integration areas.

Before each checkpoint, recheck official docs and pin SDK/API/fixture versions. Resend verification/idempotency/receiving, Twilio signature/opt-out/WhatsApp concepts and Calendly signing were checked in planning. Remaining explicit gates: complete provider event/error/retry schemas, limits and key rotation; Calendly reschedule payload relationships/plan scope; Meta Cloud/Graph/Lead Ads/CAPI (official pages rate-limited here); selected Vimeo/Wistia SDK if applicable. Official Meta entry points: [webhooks](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/), [WhatsApp Cloud](https://developers.facebook.com/docs/whatsapp/cloud-api/overview/). These are research targets, not claims that their current contents were successfully fetched.

Do not collapse checkpoints into one giant migration or activation. Each needs a reviewed diff, reproducible migration/upgrade evidence, honest test matrix and named rollback operator. **STOP for architecture review. No Phase 6 implementation, provider connection, commit or push has been performed by this plan.**

## Final planning verification

The Playwright run printed 19 passing test outcomes and two explicitly skipped authenticated mutation workflows. It then remained running without a final summary or exit despite repeated checks. The run was interrupted after the prolonged completion stall and returned exit 1. Thus the expected **individual test counts are verified**, but the overall E2E command is **not reported PASS**. Process inspection through Windows CIM was denied in this environment, so the runner/shutdown cause is unresolved; diagnose it in 6A.0 before accepting CI/browser completion. No source/configuration was changed to suppress this issue. Lint and secret scan were run separately and completed successfully.

The extra PGlite probes reproduced authorization failures and list-query failures despite the passing baseline. These findings are release blockers and remain unfixed by design in this planning-only pass. Hosted mutation E2E and real provider tests remain SKIPPED for the reasons above.

Repository check after drafting: HEAD unchanged at `0cabe2944ca59821babf4e460a5d024ac89108af`; no tracked source/environment/migration diff; only new untracked `docs/PHASE_6_IMPLEMENTATION_PLAN.md`. Generated local build/test artifacts are ignored and were not committed. `git diff --check` passed for tracked changes; the new plan is checked separately for whitespace. No package installation, provider connection, commit or push occurred.
