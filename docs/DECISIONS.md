# Decisions, risks and questions

Status: proposed architecture awaiting user approval, 2026-09-21. No decision below authorizes implementation or provider activation. Confirmed instructions take precedence over proposals.

Approval update, 2026-09-22: architecture approved; Phase 1 only authorized. Concrete implementation choices: exposed `api` functions over private `crm` tables; NOLOGIN `crm_owner`; database-enforced MFA for Admin/Owner with minimal own-membership metadata allowed solely for MFA routing; separate global self-only profile records; PostgreSQL membership checks revoke workspace access immediately without globally disabling a user's other workspaces. Supabase-wide user suspension/session revocation remains an operator Auth-admin task, not a service-role shortcut in the web app. Ownership transfer is deliberately unavailable through ordinary membership-role changes and requires reviewed operator handling. Invitation codes are hashed, expire after 48 hours, can be revoked, and require an already provisioned, email-confirmed Auth account; automated invitation delivery is not implemented. See the Phase 1 verification document for test evidence and remaining infrastructure work.

## Confirmed requirements

- Standalone 80/20 CRM using Next.js, TypeScript, Tailwind, Supabase PostgreSQL/Auth, appropriate Realtime, Vercel and Git/GitHub.
- Existing 80/20 Outbound/Dialer stays separate; architecture supports a future interface only.
- Preserve the entire eight-page client brief and additional Meta attribution/VSL requirements.
- No external provider integration now, no fake success responses, no invented credentials or source-code secrets.
- This phase creates only the six requested architecture documents. Stop and wait for review/approval before initializing application features.

## Source discrepancy

`docs/client-requirements.pdf` is absent. The only PDF is `80-20_CRM_Simple_Developer_Brief_Updated.pdf` at repository root, eight pages, read completely. Its SHA-256 is recorded in [ARCHITECTURE.md](ARCHITECTURE.md). This is treated as the intended brief provisionally and not renamed or altered. If another client PDF was intended, reconcile it before implementation.

## Proposed architectural decisions

| ID | Decision | Reason and tradeoff |
|---|---|---|
| ADR-01 | Modular Next.js monolith with PostgreSQL domain transactions | Keeps deployment and business logic coherent; isolate modules so high-volume workers can move later without microservices now |
| ADR-02 | Tenant-ready workspace keys even for one internal business | Prevents accidental future data mixing; modest schema/RLS overhead, not a promise of SaaS billing or self-service tenancy |
| ADR-03 | Current relational state plus immutable activity/facts/outbox | Auditable reporting and reliable jobs without full event-sourcing complexity; projections require reconciliation |
| ADR-04 | One canonical lead with many identities/journeys/deals | Preserves repeat sales and source history; ambiguous/shared identity needs review rather than unsafe auto-merge |
| ADR-05 | One active journey per lead initially | Fits one-card pipeline brief; concurrent offers/sales require explicit extension |
| ADR-06 | Current assignment separate from historical credit | Reassignment does not rewrite old set/close/EOD performance; rep historical detail access must be decided |
| ADR-07 | RLS plus per-command authorization and field permissions | UI guards are insufficient; private helpers/definer RPCs require rigorous testing and narrow grants |
| ADR-08 | Invite-only Auth, owner protection, privileged MFA | Internal sales workspace assumption; client to confirm sign-in and staff provisioning requirements |
| ADR-09 | Integer money ledger, currency-specific reporting | Prevents rounding/mixed-currency errors; FX and full accounting remain out of scope |
| ADR-10 | Durable DB queue/outbox, at-least-once jobs with semantic idempotency | Survives retries/crashes; external exactly-once sends cannot be guaranteed without provider support |
| ADR-11 | Bounded Vercel workers initially; measured move to dedicated runtime | Avoids unsupported endless functions; reminder precision/capacity can require extra infrastructure |
| ADR-12 | Channel-neutral contracts; disabled unconnected capabilities | Preserves future providers without false send/booking results; final acceptance waits for real channels |
| ADR-13 | Immutable touchpoints, versioned first/latest selections and conversion snapshots | Late evidence handled transparently; slightly more storage than overwriting lead UTMs |
| ADR-14 | Consent-scoped anonymous links and no fingerprinting | Avoids treating shared browsers/cookies as verified people; some cross-domain attribution remains unknown |
| ADR-15 | Playback intervals validated from continuous samples | Seeking earns no credit; missing telemetry conservatively undercounts instead of inventing views |
| ADR-16 | Asset-version analytics with replay-safe contributions | Retention/heatmaps remain correct on retry; large video volume needs sizing and retention limits |
| ADR-17 | Submitted EOD revisions frozen with supporting facts | Managers can audit numbers; late data creates visible amendments |
| ADR-18 | Minimal private Realtime invalidations and authorized refetch | Limits stale membership/channel data leakage; may need measured batching/poll fallback |
| ADR-19 | Separate production/staging projects and migration CI | Prevents preview data/sending accidents; costs additional environment resources |
| ADR-20 | Future Outbound API/event contract, no shared schema/credentials | Maintains product boundary; requires explicit source-of-truth and suppression synchronization agreement |

## Contradictions and unresolved requirements

| Issue | Resolution proposed | Approval impact |
|---|---|---|
| Requested PDF path differs from supplied filename | Record actual source and confirm before code | Source confirmation |
| PDF final acceptance requires connected providers; user prohibits integration now | Preserve provider acceptance in later explicitly authorized phase | Architecture-only is complete; product acceptance is not claimed |
| "Simple CRM" vs detailed Meta/VSL/campaign analytics | Keep simple navigation; use dedicated data/worker modules, no scope deletion | Cost/sequence need agreement |
| Pipeline list has no No Show stage but journey/button references it | Store meeting attendance=no_show plus follow-up; optional stage after approval | Stage behavior decision |
| Every person one record vs shared email/phone and ambiguous form claims | Canonical lead + identity associations/claims + conflict queue | Some captures need human review |
| One current pipeline vs repeat sales/multiple deals | One active journey initially; retained past journeys/deals | Confirm concurrent opportunities |
| Immediate report update vs scalable asynchronous analytics | Core transactional facts immediately consistent; heavier rollups show as-of/lag | Agree freshness targets |
| Immutable history vs privacy erasure/corrections | Append corrections; erasable content references; audited de-identification/holds | Legal/retention policy required |
| Admin "everything" vs privileged platform secrets | Admin manages connection lifecycle but does not read back tokens | Confirm least-privilege operational model |
| All KPI drilldowns vs rep access after reassignment | Preserve own numeric credit; current detail scope governs drilldown | Manager visibility assured; rep detail grants explicit |
| Meta messaging "where supported" | Capability-gated adapter, no claim all inboxes/channel features available | Provider/use-case permissions later |
| Confirmation email and text required vs DNC/channel unavailable | Suppression wins; log blocked/missing-channel outcome and alert | Client chooses operational fallback, never bypass consent |

## Risk register

| Risk | Severity | Mitigation / release gate |
|---|---|---|
| RLS/service-role/report/Realtime bypass exposes leads | Critical | Least privilege, scoped commands/DTOs, cross-tenant negative tests on every surface |
| Public form/visitor claim overwrites or reveals existing person | High | Untrusted input, proof-bound association, no public identity lookup, conflict queue |
| Duplicate/out-of-order events alter revenue or send repeatedly | High | Domain semantic keys, transactions, provider operation journal and reconciliation |
| Provider accepted send but response lost | High | Explicit unknown state; provider idempotency or reconcile/review before retry |
| Attribution overstates certainty or silently rewrites revenue source | High | Raw touch evidence, model versions, conversion snapshots, unknown/inferred labels |
| Shared device/cross-domain cookie restrictions misidentify viewers | High | Session-bounded consented links, no fingerprinting, explicit unknown continuity |
| High-volume VSL telemetry dominates DB cost | High | Forecast/model, batching, bounded events, retention, partition/dedup design and load test |
| Automated mass sends violate consent/window/registration rules | High | Eligibility gates, suppression at dispatch, approved provider setup and bounded pilot |
| EOD and cash drift through mutable history/timezone/currency | High | Ledger/fact evidence, frozen revisions, exact amounts, explicit timezone/cohorts |
| Cron delay/function quota causes late reminders/backlog | High | Durable jobs, lag alerts, bounded batches and dedicated worker if targets require |
| Raw webhook/log/form content leaks PII/secrets | High | Restricted encrypted payloads, minimization/redaction, retention and access audit |
| Restore replays previously accepted external operations | High | Stop sends, retain operation keys, reconcile providers before resume |
| Missing provider approvals delay final acceptance | Medium–High | Early credential/capability inventory after approval, no false connected states |
| Undefined manager/team/finance visibility gives excessive access | High | Approve permission matrix before production data |
| Too many flexible settings create unsupported workflows | Medium | Versioned finite initial rules; explicit transition constraints and scoped extensions |
| Source file may not be the intended final brief | Medium | Client confirms PDF identity before implementation |

## Questions for client review

These are actual decisions; no need to supply secrets in answers. Proposed defaults permit architecture review but do not silently settle business policy.

### Resolve before implementation of affected core domains

1. Is the supplied root-level eight-page PDF the intended `docs/client-requirements.pdf`?
2. One internal business only, or separate workspaces/businesses? How many teams and managers, and may managers see all teams or only theirs? Proposal: tenant-ready schema with one initial workspace and team-scoped managers.
3. Can a user be both setter and closer, and may setters record SHOW/CLOSE/payments? Proposal: one primary role plus deliberate capability grants; closer handles attendance/close/cash, manager handles corrections.
4. Can one lead have multiple simultaneous opportunities/pipelines? Proposal: one active journey, multiple retained historical journeys and deals.
5. Confirm the exact stage list and what Call 1–4 means. Is No Show its own stage or only attendance? What fields/criteria define offers/opportunities moved forward?
6. Who receives set/show/close/cash credit when a booking is rescheduled, reps change or a manager closes? Does one booking chain count as one set? Proposal: frozen event-time credit; reschedules do not create extra sets.
7. What does "contacted" mean: attempt, accepted message, reply or live conversation? Approve show/close rate denominators and cohorts. Proposal: distinguish attempted from successful contact and use documented attendance/outcome cohorts.
8. Reporting timezone/business-day cutoff, default currency and whether multi-currency/FX is needed? Define refunds, payment plans, overpayments and who may correct money. Proposal: per-currency reporting; no FX conversion.
9. How should ambiguous email/phone matches, shared contacts, unassigned leads and unavailable reps be handled? Who reviews merge/conflict queues? Proposal: manager queue, no unsafe auto-merge.
10. Can reps inspect historical lead details after reassignment? Do read-only users see message/form/financial PII or summary reports only? Proposal: explicit scope; no bulk export by default.
11. Who approves submitted EOD, what is the submission cutoff, and how are late corrections handled? Proposal: immutable submitted revision plus visible amendment; optional approval workflow only if required.

### Resolve before public tracking or sending

12. Which visitor jurisdictions, consent-management platform, purposes, retention and deletion rules apply? May pre-consent ephemeral statistics be collected? Proposal: nonessential persistence/association off until allowed; no claim of legal compliance without policy review.
13. Which VSL player/host(s), video lengths/versions and external VSL/ASL/form/Calendly domains? Can those pages install an approved script? Should background playback count? Proposal: count verified playing time under a visible-player policy, configure after client agreement.
14. Approve completion threshold (proposed 95% unique coverage), session/drop-off grace (30 minutes), heartbeat (5 seconds), bin width and viewer-vs-session graph defaults. What attribution lookback/direct-traffic rule is wanted? No silent default window is assumed.
15. What are required email/SMS confirmation/reminder timings, recipient timezone/send windows, no-show/cancel messages and sequence exit/re-enrollment rules? Which transactional messages remain allowed after marketing unsubscribe?
16. Which exact Meta accounts, Lead Ads forms, reporting breakdowns, Pixel/CAPI events and messaging use cases are in V1 delivery? Are ad spend/ROAS required alongside campaign revenue? Proposal: retain model support, report provider measures only when available and approved.
17. What expected leads, concurrent staff, campaigns/recipients/day, webhook peaks and VSL sessions/minutes/day? Budget and acceptable report/reminder latency? Approve worker hosting if Vercel limits cannot meet them.
18. What production region, domains, availability/backup targets, support ownership and launch window? Proposed RPO ≤15 minutes/RTO ≤4 hours need plan/budget confirmation.
19. Are there existing spreadsheets/messages/records to migrate, and which fields are authoritative? What are data quality, duplicates, consent provenance and import cutoff expectations?
20. For later Outbound integration, who owns its API contract, external identifiers, authentication, dispositions and suppression reconciliation? No access to the existing product is needed for this architecture phase.

## Client accounts/information eventually required

Client-owned GitHub repository/org, Vercel project/team, Supabase projects/region/plan and domain/DNS access; approved staff/team roster and initial owner; stage/metric/assignment/financial policies; privacy/retention/consent policy; source data and migration authorization. Later: Meta business/ad/Page/dataset/WhatsApp assets and approved permissions; Calendly organization/event types and closer mapping; Resend verified domain; Twilio business numbers/registrations; WhatsApp templates/eligibility; external player/site access; separate Outbound contract and service identity. Exact secret handling and variables are in [ENVIRONMENT.md](ENVIRONMENT.md).

## Evidence and references

Client evidence: supplied PDF pages 1–8, requirement trace in [ARCHITECTURE.md](ARCHITECTURE.md), complete acceptance trace in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). Current platform guidance checked during architecture drafting:

- [Next.js authentication and authorization](https://nextjs.org/docs/app/guides/authentication): authenticate/authorize at server entry points, not only route guards.
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security): database access boundary, grants and elevated-function risk.
- [Supabase Realtime authorization](https://supabase.com/docs/guides/realtime/authorization): channel authorization is an explicit concern.
- [Vercel Cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs) and [usage/timing](https://vercel.com/docs/cron-jobs/usage-and-pricing): finite execution and overlapping/delayed schedules require durable coordination.

These references support platform design, not guarantees of future provider capabilities or pricing. Reverify selected versions/plans and provider contracts before implementation. No external service was integrated to produce these documents.
