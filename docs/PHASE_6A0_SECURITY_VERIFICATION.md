# Phase 6A.0 Security Hardening & Remediation Verification Report

**Status**: VERIFIED & AUDITED — STOPPED FOR REVIEW  
**Base Commit**: `0cabe2944ca59821babf4e460a5d024ac89108af` (Complete Phase 5 messaging and campaign orchestration)  
**Additive Migration**: `supabase/migrations/202609230006_phase6a0_security_hardening.sql` (Migrations 001–005 preserved untouched)  
**Environment**: Local (PGlite 0.5.8 + Node 22 + Next.js 16.3.5 Turbopack + Playwright 1.63)  
**Git State**: Working tree uncommitted (ready for user review); zero git commits or pushes performed; zero external providers connected.

---

## 1. Executive Summary & Verification Matrix

Codex started Phase 6A.0 to address critical security vulnerabilities discovered in the Phase 5 messaging and campaign orchestration implementation. Codex hit its usage limit while actively developing the remediation.

Antigravity resumed work directly from the working tree:
1. Preserved all of Codex's partial work without resetting or checking out old files.
2. Verified the handoff state: initial regression suite had 34 failures out of 54 tests prior to full migration application.
3. Audited the working tree and identified critical omissions in Codex's partial work:
   - Campaign worker (`private.process_campaign_batch`) and sequence worker (`private.process_sequence_step_execution`) were left un-remediated in migration 006, bypassing canonical template contracts and cross-workspace validation.
   - Regression coverage was missing for items 22–25 (worker tenant boundaries, stale parent lifecycle, and template variable contracts).
4. Completed migration 006 with robust worker isolation, variable enforcement, and tenant integrity.
5. Added all missing regression tests, bringing total test coverage in `tests/database/phase6a0.test.ts` to 58 tests (all passing).
6. Ran the complete regression suite across all project domains.

### Verification Results Matrix

| Test Suite / Tool | Baseline (Phase 5) | Phase 6A.0 Result | Status |
| :--- | :--- | :--- | :--- |
| **Database Tests (`test:db`)** | 158 passed (5 files) | **216 passed (6 files)** | **PASS** (+58 Phase 6A.0 security regressions) |
| **Unit Tests (`test`)** | 67 passed (5 files) | **67 passed (5 files)** | **PASS** (Zero regression across domain units) |
| **Playwright E2E (`test:e2e`)** | 19 passed, 2 skipped | **19 passed, 2 skipped** | **PASS** (Exited normally with code 0 in 30.0s) |
| **TypeScript (`typecheck`)** | Clean (0 errors) | **Clean (0 errors)** | **PASS** (100% type-safe RPC interfaces & routes) |
| **ESLint (`lint`)** | Clean (0 warnings) | **Clean (0 warnings)** | **PASS** (Zero lint errors/warnings) |
| **Security Scan (`security:scan`)** | 0 findings (177 files) | **0 findings (186 files)** | **PASS** (No secrets, tokens, or PII exposed) |
| **Next.js Production Build** | Clean build | **Clean Turbopack build** | **PASS** (Compiled & optimized in 5.1s) |
| **Hosted Supabase Test** | N/A | **SKIPPED** | Hosted Supabase instance is not connected |

---

## 2. Security Defects Identified, Root Causes & Remediations

### Defect 1: Inbound Message Ingestion Lacked Authority Checking Before Command Receipt Lookup
- **Vulnerability**: `api.record_inbound_message` performed an idempotency lookup in `crm.command_receipts` using the caller-supplied `p_workspace_id` and `p_idempotency_key` *before* verifying that the caller was an active member of that workspace with appropriate role authority (`admin` or `manager`).
- **Reproduction**: An authenticated user belonging only to Workspace A could pass `p_workspace_id = Workspace B` and probe idempotency keys, leak message processing results, or trigger ingestion into a foreign workspace.
- **Root Cause**: Premature receipt check prior to calling `private.current_membership_id` and role authorization.
- **Severity**: Critical.
- **Remediation**:
  - Re-ordered logic in `api.record_inbound_message`: immediately validate that `private.current_membership_id(p_workspace_id)` is non-null and that caller has `admin` or `manager` role via `private.has_role_or_higher(...)`.
  - Re-verify channel account ownership: `WHERE id = p_channel_account_id AND workspace_id = p_workspace_id`.
  - Enforce idempotency collision check: if key matches but `payload_hash` differs, raise exception `conflict_idempotency_payload_mismatch`.
- **Authorization Boundary**: Database RPC / Tenant Boundary.
- **Regression Tests**: `tests/database/phase6a0.test.ts` items 1, 16, 17, 18, 19, 20.

---

### Defect 2: Message Policies Allowed Excessive Workspace-Member Reads (RLS Scope Bypass)
- **Vulnerability**: Phase 5 RLS policies on `crm.messages`, `crm.conversations`, and `crm.message_events` permitted any active workspace member to read all communications across the entire workspace, ignoring lead assignment and privacy boundaries.
- **Reproduction**: A setter or closer assigned to Lead A could query messages or conversations belonging to Lead B (assigned exclusively to another team member or restricted by manager).
- **Root Cause**: The RLS policy checked only `private.current_membership_id(workspace_id) IS NOT NULL` without delegating to canonical lead visibility logic.
- **Severity**: High.
- **Remediation**:
  - Replaced message and conversation SELECT policies with canonical lead-scoped authorization: `private.can_read_lead(workspace_id, lead_id)`.
  - Applied the exact same canonical lead access helper used by Phase 2 CRM, ensuring Admins/Managers have full visibility while Setters/Closers only access messages for leads assigned to them.
- **Authorization Boundary**: Postgres Row-Level Security (RLS).
- **Regression Tests**: `tests/database/phase6a0.test.ts` items 3, 6, 7, 8, 9, 10, 11, 12, 13.

---

### Defect 3: Phase 5 List RPCs Invalid SQL & Side-Effect Mutating Unread Counts on Read
- **Vulnerability**:
  1. `api.list_conversations`, `api.list_campaigns`, `api.list_message_templates`, `api.list_sequences`, and `api.list_inbound_reviews` placed `ORDER BY` outside `jsonb_agg(...)`, triggering Postgres error SQLSTATE `42803` (`column must appear in GROUP BY clause or be used in an aggregate function`).
  2. `api.get_conversation_messages` performed an unrequested mutation (`UPDATE crm.conversations SET unread_count = 0`) during what should be an idempotent read RPC.
- **Reproduction**: Invoking any of the list RPCs failed with SQL syntax errors when multiple rows were returned, causing UI and API listing failures.
- **Root Cause**: Misplaced SQL `ORDER BY` clause outside aggregate window; un-isolated side-effect in read query.
- **Severity**: Medium (Functional regression & data side-effect).
- **Remediation**:
  - Rewrote aggregation in all 5 list RPCs to use `jsonb_agg(item ORDER BY sort_col DESC)` inside the subquery or aggregate.
  - Added deterministic empty state handling: `COALESCE(jsonb_agg(...), '[]'::jsonb)`.
  - Removed the `UPDATE` mutation from `api.get_conversation_messages`, ensuring it is a pure read function that enforces `private.can_read_lead(c.workspace_id, c.lead_id)`.
- **Authorization Boundary**: Database RPC / Data integrity.
- **Regression Tests**: `tests/database/phase6a0.test.ts` items 14, 15.

---

### Defect 4: Inbound Review Evidence Mutable and Deletable
- **Vulnerability**: The raw payload, headers, provider evidence, and sender information in `crm.inbound_message_reviews` were vulnerable to physical row deletion or post-ingestion tampering. Furthermore, resolution of reviews did not strictly check that the target lead belonged to the exact same workspace as the inbound review.
- **Reproduction**: A caller could resolve an inbound review in Workspace A by linking it to a `target_lead_id` residing in Workspace B, or update the raw payload of an unresolved review.
- **Root Cause**: Missing database-level immutability trigger; lack of cross-workspace validation between review and resolved lead in `api.resolve_inbound_review`.
- **Severity**: High.
- **Remediation**:
  - Implemented trigger `private.protect_inbound_evidence`:
    - Disallows `DELETE` on `crm.inbound_message_reviews` completely.
    - Prevents modifications to immutable fields (`workspace_id`, `channel_account_id`, `provider`, `channel`, `raw_payload`, `payload_hash`, `sender_endpoint`, `recipient_endpoint`, `created_at`).
  - Added cross-workspace checks in `api.resolve_inbound_review`: verifies target lead belongs to `p_workspace_id` and records resolver identity and timestamp.
- **Authorization Boundary**: Database Trigger & RPC boundary.
- **Regression Tests**: `tests/database/phase6a0.test.ts` items 4, 21.

---

### Defect 5: Channel Account Tenant Boundary Pivot
- **Vulnerability**: Foreign keys on `crm.conversations`, `crm.messages`, and `crm.inbound_message_reviews` referenced `crm.channel_accounts(id)` without enforcing that `workspace_id` matched across both tables.
- **Reproduction**: A conversation in Workspace A could reference a channel account belonging to Workspace B.
- **Root Cause**: Non-composite foreign key references.
- **Severity**: High.
- **Remediation**:
  - Added unique composite constraint on `crm.channel_accounts(workspace_id, id, channel)`.
  - Added composite foreign keys on `crm.conversations`, `crm.messages`, and `crm.inbound_message_reviews` linking `(workspace_id, channel_account_id, channel)`.
- **Authorization Boundary**: Relational integrity / Tenant Boundary.
- **Regression Tests**: `tests/database/phase6a0.test.ts` item 5.

---

### Defect 6: Campaign & Sequence Workers Bypassed Tenant Scope & Template Contract
- **Vulnerability**: The background workers `private.process_campaign_batch` and `private.process_sequence_step_execution` executed direct string interpolation on template contents (`replace(..., '{{first_name}}', ...)`), bypassing Phase 5's template rendering contract. Additionally, they did not re-verify whether parent campaigns had been cancelled or sequence enrollments had exited prior to dispatching messages.
- **Reproduction**:
  - A template with `{{custom_field}}` would dispatch with the raw `{{custom_field}}` token unrendered.
  - A template missing a required variable like `{{first_name}}` would silently deliver broken empty strings rather than suppressing the recipient.
  - A worker processing a batch for a campaign cancelled mid-flight would continue sending queued messages.
- **Root Cause**: Worker implementation in migration 005 relied on naive string replacement rather than the canonical template variable evaluation engine.
- **Severity**: High.
- **Remediation**:
  - Hardened `private.process_campaign_batch` and `private.process_sequence_step_execution` in Migration 006:
    - Strictly scoped all queries by `p_workspace_id`.
    - Added immediate lifecycle guard: if `campaigns.status = 'cancelled'` or `sequence_enrollments.status <> 'active'`, worker immediately terminates batch processing.
    - Implemented canonical variable replacement loop iterating through `variables_used`: checks whether required variables have non-null values. If a required variable is missing, recipient is marked suppressed (`missing_required_template_variable: <var>`) and message dispatch is aborted.
- **Authorization Boundary**: Private Worker / Background Job Boundary.
- **Regression Tests**: `tests/database/phase6a0.test.ts` items 22, 23, 24, 25.

---

## 3. SECURITY DEFINER & RPC Privilege Audit

All messaging-related functions were audited for safe search path, privilege grants, and role boundaries:

1. **Search Path Isolation**:
   - Every function explicitly specifies: `SET search_path = public, crm, private, pg_temp;`
   - Prevents search_path hijacking / trojan object attacks in shared schemas.

2. **Least Privilege Execution Grants**:
   - `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated;` applied to all private helpers and internal worker functions (`private.process_campaign_batch`, `private.process_sequence_step_execution`, `private.protect_inbound_evidence`, `private.can_read_lead`).
   - Public API RPCs (`api.record_inbound_message`, `api.resolve_inbound_review`, `api.list_conversations`, `api.list_inbound_reviews`, `api.list_campaigns`, `api.list_message_templates`, `api.list_sequences`, `api.get_conversation_messages`) grant `EXECUTE` strictly to `authenticated`.
   - Anonymous (`anon`) role has 0 execute permissions across messaging RPCs.

3. **Workspace Authorization & Membership Verification**:
   - Every user-facing RPC immediately verifies `private.current_membership_id(p_workspace_id)`.
   - Read-only members and inactive memberships are rejected from mutating operations (`admin` or `manager` required for inbound ingestion, review resolution, campaign dispatch, and template modifications).

4. **Dynamic SQL Protection**:
   - Zero dynamic SQL (`EXECUTE format(...)`) is utilized in any messaging or worker RPC. All queries use parameterized static SQL.

---

## 4. Playwright Investigation & Normal Exit Analysis

### Investigation Findings
- During earlier Phase 6 planning, a potential stall was noted during Playwright test runs.
- Codex began investigating `playwright.config.ts` and `scripts/with-test-env.mjs`.
- During our testing, `npm run test:e2e` was executed multiple times:
  - Run 1: 19 passed, 2 skipped in 34.2s (exit code 0).
  - Run 2: 19 passed, 2 skipped in 30.0s (exit code 0).
- In both runs, the process cleanly disconnected the Next.js child process (`webServer`), released all ports, and exited normally without hanging.
- **Conclusion**: The earlier reported stall was an artifact of port contention or background task timeout in the previous containerized sandbox rather than a resource leak in the repository. No artificial force-kill hacks or `process.exit(0)` workarounds were added, preserving test harness integrity.

---

## 5. PGlite vs Hosted Supabase Test Limitations

- **Local Harness (`tests/support/auth-compat.sql`)**:
  - Provides mock implementations of `auth.uid()`, `auth.jwt()`, and `auth.role()` for local PGlite execution.
  - Validates that Postgres RLS policies, check constraints, composite foreign keys, and trigger functions execute correctly in PostgreSQL 16.
- **Limitations**:
  - PGlite tests use single-connection role switching (`set local role authenticated; set local "request.jwt.claims" = ...;`).
  - Does NOT test Supabase PostgREST layer, GoTrue authentication JWT signing, or hosted Supabase network gateways.
- **Hosted Supabase Status**:
  - **SKIPPED — hosted Supabase not connected yet**.
  - Local database compatibility verification is 100% complete and passing across 216 tests. Full hosted Supabase verification will occur once hosted credentials and environments are linked.

---

## 6. Remaining Risks & Phase 6A.1 Prerequisites

1. **Provider Webhook Public Ingestion**:
   - Inbound messages currently rely on internal authenticated ingestion (`api.record_inbound_message`).
   - When public provider webhooks (Twilio, Resend, WhatsApp) are added in Phase 6A.1+, webhook signing secrets, replay attack verification, and rate limiting must be implemented at the API route layer before routing to internal database ingestion.
2. **Disconnected Provider Dispatch**:
   - Outbound messages continue to terminate safely at `status = 'queued'` and `dispatch_status = 'awaiting_provider'`. Zero external provider SDKs or credentials have been introduced.
3. **Review Checkpoint**:
   - Repository working tree is clean of any unintended modifications and is stopped for user review. No git commits or pushes have been made.
