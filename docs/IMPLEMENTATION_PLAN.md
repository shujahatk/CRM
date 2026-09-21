# Implementation plan and approval gates

Status: architecture-only deliverable. **Stop here until the user reviews and approves.** This file specifies later work; it does not authorize initializing the app, running migrations, connecting providers or deploying.

Approval update, 2026-09-22: architecture and Phase 1 implementation are explicitly approved. All later phase gates remain in effect. See [PHASE_1_VERIFICATION.md](PHASE_1_VERIFICATION.md) for implementation evidence and infrastructure limitations.

Source: all eight pages of the supplied brief and additional user requirements, mapped in [ARCHITECTURE.md](ARCHITECTURE.md). Schema, permissions, metrics and defaults remain subject to [DECISIONS.md](DECISIONS.md).

## Phase 0 — architecture review (this delivery)

Deliver the six requested documents, record PDF filename discrepancy, preserve every required feature, define security/transaction/identity/reporting boundaries, enumerate unresolved inputs. No package manifest, scaffold, feature screen, migration, sample credentials, live API connection or fake success response is part of this delivery.

Exit: client confirms intended PDF, scope, major decisions and permission to begin the next phase. Review especially tenant/team visibility, repeat sales, revenue/credit definitions, privacy, and integration sequencing. Approval of architecture alone is not permission to turn on campaigns or connect production services.

## Phase 1 — repository and platform foundation (after explicit approval)

Create Next.js App Router + TypeScript + Tailwind project, pin supported versions and lockfile, establish module boundaries, lint/type checks, CI and reviewed database migration workflow. Initialize Git/GitHub only in authorized repository/account. Create environment validation, secret handling, logging, typed errors and separate development/staging data. Establish Supabase schema exposure, least-privilege grants and test harness.

Implement invitation/session handling, membership/team roles, RLS helpers and audit. All five roles get explicit policies and negative tests before real lead data. Make integration capabilities disabled/unavailable by default.

Exit: empty workspace authentication and authorization proven; no cross-tenant access by API, RPC, report, export or Realtime. CI can build and reset a disposable database from migrations. No production credentials needed in source.

## Phase 2 — identity, lead work and durable commands

Implement canonical leads, identities/claims/conflicts, manual entry, CSV staging and idempotent internal intake. Build assignment rules/history, pipelines/journeys, versioned stage commands, activity/audit, notes/revisions/important markers, tags/custom fields, tasks and next-action views. Add Dashboard, Leads, Pipeline and Tasks only at this approved implementation stage.

Implement command receipts/outbox/jobs early so later automations reuse transaction guarantees. Every consequential action validates role, scope and expected version. Manual Call logs an attempt; no dialer.

Exit: lead capture and rep follow-up work without spreadsheets; concurrency/dedup tests pass; no duplicate business facts from repeat clicks; terminal stages cannot bypass outcome requirements.

## Phase 3 — meetings, outcomes, money, EOD and reporting core

Implement manual booking and booking-chain model, confirmations/attendance as internal facts, SET/SHOW/CLOSE/LOST/NURTURE, deal ledger/installments, historical rep credit, metric definitions and supporting drilldowns. Implement EOD drafts/submission/amendments with qualitative input only. Add accessible lead detail sections, EOD, Reports and Settings.

Exit: fixed fixture reconciles pipeline actions, sets/shows/closes, value, cash/refunds and EOD evidence to the cent and event; role permissions hold after reassignment. Manual booking is a core capability, not a substitute claim for Calendly integration acceptance.

## Phase 4 — forms, attribution and VSL core

Implement basic form configuration/versioning, public safe rendering/embedding, durable submissions, allowlisted redirects and consent evidence. Implement site/visitor sessions and association proofs, immutable touches, first/latest models and booking/deal/payment snapshots. Add typed authenticated external receiver without connecting a provider.

Implement external-player tracking contract and SDK only for the approved player(s), with all required play/pause/resume/seek/range/time/completion/replay events. Build deterministic range reducer, versioned video bins, retention/drop-off graphs and replay heatmaps. No funnel/page/video-hosting builder. Instrument approved external pages only after access and privacy review.

Exit: seek gaps earn zero credit; retries/out-of-order events preserve counts; multi-tab and cross-domain limitations are visible; form data joins to CRM only within consent scope. Load test with agreed traffic forecast and publish storage estimates.

## Phase 5 — internal messaging/campaign orchestration

Implement channel-neutral conversations/messages/status receipts, snippets, audience snapshots, campaign batching, sequence versions/enrollments, automation rules, delivery operations and suppression. Add Conversations, Campaigns and Forms navigation. Implement provider contracts and failure/unavailable behavior; do not return a mocked successful send in the product. Automated tests may use clearly isolated test doubles that never represent connected production providers.

Exit: schedules/reschedules, cancellation, consent withdrawal, reply/conversion exits and job retries work against deterministic test fixtures; outbound product actions remain unavailable until real channels are configured. This phase alone does not satisfy PDF messaging acceptance.

## Phase 6 — provider integrations (separate explicit authorization)

Requires client-owned accounts, scoped credentials and verified provider documentation/capabilities. Suggested order:

1. Calendly booking/reschedule/cancel and event-type→closer mapping; reconciliation and identity conflict handling.
2. Resend email, Twilio SMS and WhatsApp Business, one approved channel at a time; verified senders, inbound routing, receipts, opt-out and approved WhatsApp templates/windows. Confirmation email and text/SMS are both required by PDF acceptance unless client explicitly changes it.
3. Live campaigns and meeting automations with bounded pilot recipients, suppression recheck, uncertain-send reconciliation and provider limits.
4. Meta Lead Ads/webhooks and Marketing API dimensions/insights; Pixel/CAPI consent and event deduplication; supported Meta messaging only when app permissions and use cases are approved.
5. Agreed external VSL player instrumentation and, later, 80/20 Outbound contract. Neither includes rebuilding external products.

Exit per adapter: signature fixtures plus real sandbox evidence, credential rotation/revocation, provider rate limit/error handling, duplicate/reordered webhooks, connection failure and reconciliation tests. Never mark a channel ready because configuration fields merely exist.

## Phase 7 — production readiness and acceptance

Run the security and load suites, accessibility/browser checks, restore drills, migration rehearsal, privacy retention workflows and incident runbooks. Resolve plan quotas, reminder latency, telemetry costs and escalation ownership. Client approves real-data migration and production channel activation. Use isolated staging first, then a bounded production pilot and monitored expansion. Preview deployments cannot access production Supabase or send to real recipients.

Exit: acceptance checklist below passed with recorded evidence; release owner signs off, backup/restore measured, logs/alerts actionable, rollback documented. No promise of delivery dates until volumes, staffing and credentials are known.

## Client acceptance checklist trace

| PDF p.8 criterion | Phase | Evidence |
|---|---|---|
| Lead enters correct pipeline | 2, 4, 6 | Manual/import/form/provider intake matrix, one canonical lead |
| Setter moves lead, notes/follow-ups | 2 | Assigned-role browser workflow and permission denials |
| Calendly attaches to existing lead | 6 | Real booking webhook and conflicting-identity case |
| Closer sees full lead history | 2–3 | Authorized handoff including answers, important notes, meetings/payments |
| SET/SHOW/CLOSE/LOST/NURTURE update pipeline/reports | 3 | Transaction/duplicate/concurrency and metric reconciliation |
| Deal value/cash entered and reported | 3 | Minor-unit ledger, refunds/corrections, per-currency totals |
| Email/SMS/WhatsApp connected and stored | 6 | Actual approved provider send/reply/receipt evidence |
| Bulk campaigns to filtered groups | 5–6 | Authorized audience, batch rate limits and per-recipient results |
| Booking triggers confirmation email and SMS/text stored under lead | 6 | Actual dual-channel confirmation, suppression and retry evidence |
| Mass email, SMS and WhatsApp | 6 | Separate channel tests including WhatsApp eligibility/approval |
| Embedded form redirects to Calendly | 4, 6 | External-origin submit, durable answers, safe redirect, linked booking |
| EOD calculated automatically | 3 | Submitted report with evidence and late-event amendment |
| Managers see leads behind numbers | 3 | Scope-correct drilldown reconciles to displayed metric |
| No Excel needed for core workflow | 7 | Client completes end-to-end journey using CRM |
| Additional Meta attribution and VSL analytics | 4, 6 | Full chain with known/unattributed examples and seek/replay graph tests |

## Dependencies and change control

Identity and tenant boundaries precede all feature work. Activity/fact definitions precede EOD and automation. Consent/suppression precede public tracking and sends. Durable jobs/idempotency precede providers. VSL/Meta launch depends on approved external page/player/domain access and realistic volume. Paid plan, email/SMS/WhatsApp approval and Meta permissions may dominate lead time; these are external dependencies, not reasons to ship pretend success.

Record client changes as decision amendments and update schema, acceptance evidence and affected phases together. Any removal of a PDF acceptance item requires explicit client agreement. Do not silently reinterpret "simple" as permission to omit integrity, privacy, messaging or reporting requirements.
