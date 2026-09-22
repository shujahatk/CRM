# Phase 6B Verification Report: Resend Email Provider Integration

**Status**: VERIFIED & AUDITED — STOPPED FOR REVIEW  
**Base Commit**: `c0d4759 Complete Phase 6A.1 provider infrastructure`  
**Additive Migration**: `supabase/migrations/202609230008_phase6b_resend_email.sql` (Migrations 001–007 strictly preserved untouched)  
**Environment**: Local (PGlite 0.5.8 + Node 22 + Next.js 16.3.5 Turbopack + Playwright 1.63)  
**Git State**: Working tree uncommitted (ready for user review); zero git commits or pushes performed; zero Twilio work started.  
**Live Provider Status**: SKIPPED — Resend credentials not configured. Mock transport & cryptographic verification tests PASS.

---

## 1. Executive Summary & Verification Matrix

Phase 6B connects the canonical Resend email provider to the provider-neutral infrastructure established in Phase 6A.1. It incorporates all 13 architectural review corrections and subsequent corrective audits: authoritative webhook workspace resolution, separation of complaint compliance state from delivery state, permanent vs observational bounce semantics, deterministic bounded idempotency keys derived purely from immutable operation identity, outbound payload immutability fingerprints, Svix signature-first verification with anti-replay, rapid webhook acknowledgment with durable inbox persistence, canonical inbound matching with review routing for unknown/ambiguous senders (never auto-creating leads), attachment metadata-only isolation, and honest provider health reporting.

All regression test suites passed with zero regressions, zero type errors, zero lint warnings, and zero security findings.

| Test Suite / Metric | Baseline (Phase 6A.1) | Phase 6B Result | Status |
| :--- | :--- | :--- | :--- |
| **Unit Tests (`test`)** | 83 passed (6 files) | **102 passed (7 files)** | **PASS** (+19 new Resend adapter unit tests) |
| **Database Tests (`test:db`)** | 233 passed (7 files) | **251 passed (8 files)** | **PASS** (+18 new Phase 6B database tests) |
| **Playwright E2E (`test:e2e`)** | 19 passed, 2 skipped | **19 passed, 2 skipped** | **PASS** (Normal clean exit, code 0) |
| **TypeScript (`typecheck`)** | Clean (0 errors) | **Clean (0 errors)** | **PASS** (100% type-safe RPCs, contracts, and routes) |
| **ESLint (`lint`)** | Clean (0 warnings) | **Clean (0 warnings)** | **PASS** (Strict 0 warnings enforced) |
| **Security Scan (`security:scan`)** | 0 findings (196 files) | **0 findings (207 files)** | **PASS** (Zero secrets or credentials exposed) |
| **Next.js Production Build** | Clean Turbopack build | **Clean Turbopack build** | **PASS** (Dynamic route `/api/webhooks/resend` compiled) |
| **Hosted Supabase Test** | N/A | **SKIPPED** | Hosted Supabase instance is not connected yet |
| **Live Resend API Test** | N/A | **SKIPPED** | Resend credentials not configured |
| **Live Resend Webhook Test**| N/A | **SKIPPED** | Resend credentials not configured |

---

## 2. Official Resend Documentation Consulted

The implementation strictly follows official Resend documentation and architectural standards:
1. **Resend REST API & Node SDK (`resend@^6.28.1`)**:
   - Outbound email endpoint: `emails.send()` with parameters `from`, `to`, `subject`, `text`, `html`, `reply_to`, `headers`, and `tags`.
   - Headers: `Idempotency-Key` passed in request options.
   - Tags: Used to safely attach canonical correlation IDs (`workspace_id`, `message_id`, `operation_id`).
2. **Webhook Verification via Svix Standards**:
   - Standard headers: `svix-id`, `svix-timestamp`, and `svix-signature`.
   - Signatures are verified using raw UTF-8 request body bytes before parsing JSON.
   - Signature format: `v1,<base64-hmac-sha256>`.
   - Anti-replay timestamp tolerance: 5 minutes (300 seconds).
   - Constant-time comparison using `crypto.timingSafeEqual`.
3. **Resend Webhook Event Semantics**:
   - `email.sent`: Email accepted by provider MTA.
   - `email.delivered`: Email confirmed delivered to recipient server.
   - `email.delivery_delayed`: Temporary upstream delivery delay. Observational only; never regresses delivery status or permanently suppresses recipient.
   - `email.bounced`: Hard/permanent bounce (`type: 'Permanent'` or `subType: 'Suppressed'`) vs transient bounce.
   - `email.complained`: Recipient spam complaint. Recorded as an event; canonical suppression recorded with `reason = 'spam_complaint'`; delivery status remains `delivered` / `sent`.
   - `email.opened` & `email.clicked`: Engagement tracking events recorded in canonical audit history.
   - `email.received`: Inbound email notification. Safe metadata and text extracted; untrusted inbound HTML is never rendered.
4. **Idempotency Key Specification**:
   - Resend supports `Idempotency-Key` with a max length of 256 characters.
   - Key format: `resend:<sha256(canonical immutable operation identity)>` (71 characters total).
   - Stable across retries: attempt count is strictly excluded from key derivation.
   - Local CRM operation state remains authoritative beyond Resend's 24-hour cache window.

---

## 3. Implementation of the Architectural Corrections

### Correction 1: Authoritative Webhook Workspace Resolution
- **Rule**: Never trust client payload or query parameters for workspace ID.
- **Outbound Events**: Correlate through `provider_message_id` on canonical `crm.messages` and `private.provider_operations`. Verify that the message, channel account, provider connection, and workspace are mutually consistent.
- **Inbound Events (`email.received`)**: Destination address (`data.to[0]`) is looked up against active channel accounts (`channel = 'email'`) bound to an active Resend provider connection.
  - Exactly 1 authoritative mapping: processing continues normally.
  - 0 mappings: quarantined with `quarantine_reason = 'unresolved_account'`.
  - Multiple mappings: quarantined with `quarantine_reason = 'ambiguous_account_mapping'`.
- Query parameters (`?workspace=...`) and payload claims are completely ignored.

### Correction 2: Complaint is an Event, Not Delivery Status
- A spam complaint (`email.complained`) does NOT overwrite or mutate `crm.messages.status` (it remains `delivered` or `sent`).
- The complaint is audited in `crm.message_events` with `event_type = 'complained'`.
- The recipient is immediately added to canonical suppression in `crm.suppressions` with `reason = 'spam_complaint'`, preventing any future outbound messages.

### Correction 3: Bounce Model
- **Permanent Bounce**: When `type = 'Permanent'` or `subType = 'Suppressed'`, the message status is updated to `bounced` (terminal state), a `bounced` event is recorded in `crm.message_events`, and a canonical destination suppression is added to `crm.suppressions` (`reason = 'hard_bounce'`).
- **Delivery Delayed**: When `email.delivery_delayed` is received, it is recorded in `crm.message_events` as an observational audit entry. Message status is NOT regressed to failed or bounced, and NO permanent suppression is created.

### Correction 4: Bounded Deterministic Idempotency Key
- Derived purely from immutable provider operation identity:
  ```
  resend:sha256(op:workspace_id:job_id)
  ```
- **Retry Invariant**: Retry attempt count is NOT part of the key formula. Attempt 1, attempt 2, and attempt 3 for the same provider operation yield the **exact same Resend idempotency key**.
- **Operation Discrimination**: Operation A key !== Operation B key.
- Yields a fixed 71-character string (`resend:<64 hex chars>`, strictly <= 256 characters).

### Correction 5: Provider Operation Payload Immutability
- Outbound payload fingerprint is computed via:
  ```
  sha256(canonical JSON representation of [to, from, subject, text, html, reply_to])
  ```
- If an operation retry is attempted, both the dispatch worker (`dispatch.ts`) and adapter (`adapter.ts`) verify that the current payload fingerprint matches the original operation fingerprint.
- If payload differs for the same operation: rejected as `payload_mutation_conflict`, aborting before send and preventing reuse of the existing idempotency key.

### Correction 6: Webhook Event Identity
- External event identity uses the authenticated `svix-id` header from Resend.
- Multiple legitimate lifecycle events for the same email (`email.sent`, `email.delivered`, `email.opened`, `email.clicked`) possess distinct `svix-id` values and are deduplicated and processed independently.

### Correction 7: Signature First Webhook Pipeline
- The webhook route (`src/app/api/webhooks/resend/route.ts`):
  1. Enforces payload size limit (`MAX_WEBHOOK_PAYLOAD_BYTES = 256 KiB`).
  2. Extracts raw body bytes as UTF-8 text.
  3. Verifies `svix-id`, `svix-timestamp`, and `svix-signature` using HMAC-SHA256 and constant-time comparison.
  4. Enforces 5-minute replay tolerance window.
  5. Computes SHA-256 payload hash and sanitizes sensitive tokens.
  6. Only then persists the authenticated envelope into `private.provider_webhook_events` via `api.ingest_resend_webhook`.

### Correction 8: Rapid Webhook Acknowledgment & Asynchronous Processing
- Webhook route returns HTTP 200 immediately upon durable persistence to `private.provider_webhook_events`.
- Ingress RPC automatically enqueues a background processing job in `private.jobs`, preventing connection timeouts on Resend's webhook delivery infrastructure.

### Correction 9: Canonical Inbound Matching & Unknown-Sender Policy
- Inbound webhooks (`email.received`) are treated as authenticated metadata notifications.
- Text content is stored directly where available. Untrusted inbound HTML is never rendered in the CRM UI.
- **Canonical Matching Policy**:
  - **Exactly one existing normalized email identity**: Inbound message attaches to that existing lead and conversation.
  - **Zero matching identities**: Creates a review in `crm.inbound_message_reviews` with `resolution_reason = 'unmatched_sender'`. **DOES NOT automatically create a CRM lead** or message.
  - **Multiple matching identities**: Creates a review in `crm.inbound_message_reviews` with `resolution_reason = 'ambiguous_identity_conflict'` containing all candidate lead IDs. **DOES NOT automatically attach or create a lead**.
  - **Duplicate Webhook Deduplication**: Replays or subsequent deliveries for the same `provider_message_id` return existing records without duplicating reviews in `crm.inbound_message_reviews`.
  - **Cross-Workspace Isolation**: Tenant identities from other workspaces cannot be selected or attached.

### Correction 10: Attachment Metadata Isolation
- Attachments received in inbound webhooks are stored as metadata only (filename, content type, size in bytes).
- Attachment contents are not downloaded automatically.
- Ephemeral URLs from provider notifications are not persisted as durable trusted storage URLs.

### Correction 11: Honest Provider Health State
- The presence of environment variables does not imply an active provider connection.
- Supported connection states: `not_configured`, `configured`, `verification_required`, `active`, `degraded`, `error`, `disabled`.
- Integrations dashboard displays connection state based on actual database configuration and test evidence.

### Correction 12: No Fake Live Verification
- In the absence of live production API keys, live provider tests are explicitly reported as:
  `SKIPPED — Resend credentials not configured`.
- Mock transport tests verify the full cryptographic and state machine pipeline without fabricating real external network success.

### Correction 13: Additive Migration & Safety
- Additive migration `supabase/migrations/202609230008_phase6b_resend_email.sql` builds upon migrations 001–007.
- Zero modifications to previous migrations.
- Working tree uncommitted; zero commits or pushes; Twilio not started.

---

## 4. Database Schema Additions (`202609230008_phase6b_resend_email.sql`)

1. **Partial Index for Message Correlation**:
   ```sql
   CREATE INDEX idx_messages_workspace_provider_msg
     ON crm.messages(workspace_id, provider_message_id)
     WHERE provider_message_id IS NOT NULL;
   ```
2. **Expanded Message Event Types**:
   - `crm.message_events.event_type` check constraint expanded to include: `'delivery_delayed'`, `'opened'`, `'clicked'`, `'complained'`.
3. **Expanded Webhook Quarantine Reasons**:
   - `private.provider_webhook_quarantine.quarantine_reason` check constraint expanded to include: `'ambiguous_account_mapping'`, `'unresolved_account'`.
4. **Adjusted Identity Claims Constraint**:
   - Replaced `unique(workspace_id, identity_id)` with `unique(workspace_id, lead_id, identity_id)` to allow multiple leads to claim the same identity, enabling ambiguous identity conflict detection.
5. **Resolution Functions**:
   - `private.resolve_resend_webhook_workspace`: Deterministic workspace and account correlation adhering to Correction 1.
   - `private.process_resend_webhook_event`: Monotonic event processing applying bounce, complaint, delivery, deduplication, and inbound review routing rules.
   - `api.ingest_resend_webhook`: Secure ingestion endpoint callable by anon/system with deduplication and quarantine handling.

---

## 5. Verification Test Evidence

### A. Unit Tests (`tests/unit/resend-adapter.test.ts`) — 19 Tests Passing
- Deterministic idempotency key: stable across retries (`attempt 1 === attempt 2 === attempt 3`), bounded length <= 256, format `resend:<sha256>`.
- Operation key discrimination: `operation A key !== operation B key`.
- Payload immutability enforcement: payload mutation across retries is detected and rejected as `payload_mutation_conflict`.
- Outbound payload fingerprint: deterministic hashing of recipient, sender, subject, text, HTML, and reply-to; detects mutations.
- Mock dispatch: returns correct `provider_message_id` and operation details.
- Error classification: rate limits (429), authentication (401/403), invalid destination (422), unconfigured state.
- Webhook signature verification: valid Svix signature passes, missing headers fail, tampered signatures fail, expired timestamps fail replay check.
- Payload size limits: payloads > 256 KiB rejected.
- Payload sanitization: strips sensitive authorization tokens, API keys, and passwords.
- Monotonic delivery reconciliation: late arriving `sent` event does not regress `delivered` status.

### B. Database Integration Tests (`tests/database/phase6b.test.ts`) — 18 Tests Passing
- **Outbound Dispatch Queue & JIT Policies**:
  1. Job claim: lease worker atomically claims pending email dispatch jobs.
  2. JIT DNC blocking: suppressed recipient causes dispatch job to fail pre-send policy without sending.
  3. Disabled provider connection: prevents dispatch when connection is disabled or errored.
- **Webhook Workspace Resolution & Ingestion**:
  4. Authoritative workspace resolution: correlates outbound Resend email ID to workspace and channel account.
  5. Inbound workspace resolution: resolves destination through active channel account.
  6. Quarantine unresolved: destination not matching active channel accounts is quarantined as `unresolved_account`.
  7. Webhook deduplication: identical `svix-id` and payload returns existing record marked replay-safe.
  8. Webhook conflict quarantine: identical `svix-id` with altered payload is quarantined as `conflicting_payload`.
- **Monotonic Status Reconciliation & Suppressions**:
  9. Monotonic delivery: `email.delivered` advances message status to `delivered`; late `email.sent` does not regress status.
  10. Delivery delayed: records `delivery_delayed` event in `crm.message_events` without mutating status or suppressing.
  11. Permanent bounce: sets message status to `bounced` and creates canonical `hard_bounce` in `crm.suppressions`.
  12. Spam complaint: leaves message status as `delivered`/`sent`, records `complained` event, and creates `spam_complaint` in `crm.suppressions`.
- **Inbound Email Ingestion & Identity Matching**:
  13. Exact match attaches correctly: exactly 1 matching identity attaches message to canonical lead and conversation.
  14. Zero match review routing: 0 matching identities creates review in `crm.inbound_message_reviews` with `unmatched_sender` and **DOES NOT create a lead**.
  15. Ambiguous match review routing: >1 matching identities creates review in `crm.inbound_message_reviews` with `ambiguous_identity_conflict` and candidate leads, and **DOES NOT auto-attach**.
  16. Duplicate webhook deduplication: duplicate delivery with same provider email ID does not create duplicate reviews.
  17. Cross-workspace isolation: foreign workspace identity cannot be matched or selected for inbound message attachment.
  18. Message isolation: Workspace B cannot query or access Workspace A messages under RLS.
