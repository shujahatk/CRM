# Test and verification strategy

Status: future implementation test plan. No application exists and no runtime tests have been claimed or run. Architecture validation consists of reading all eight source pages, checking traceability, relationships, permission boundaries and the six documents' consistency.

Phase 1 update: Vitest unit tests, actual PGlite PostgreSQL migration/RLS tests, a separate local Supabase SQL runner and Playwright browser smoke tests are implemented. The embedded suite models only the Auth database contract, not GoTrue/real JWT verification or PostgREST. Current executed results and skipped hosted/service checks are listed in [PHASE_1_VERIFICATION.md](PHASE_1_VERIFICATION.md); the remaining strategy below still governs future phases.

## Layers and tools

Propose TypeScript unit/property tests (Vitest with a property-testing library where useful), PostgreSQL integration/RLS tests (pgTAP or SQL assertions against disposable Supabase), browser flows (Playwright), provider contract fixtures and targeted load tests. Select/pin actual versions after implementation approval. CI uses synthetic fixtures, no real leads or credentials. Isolated test doubles can model provider responses; they must not be wired into production or presented as successful integration evidence.

Test behavior/invariants rather than duplicating implementation. Database tests execute as actual anon/authenticated/worker roles with realistic JWT claims; a successful test using a superuser does not prove RLS. Public API and browser tests cover the same policies through their normal paths.

## Required suites

| Domain | Scenarios | Required invariant/evidence |
|---|---|---|
| Tenant/RBAC/RLS | Two workspaces; each role; same/different team; assigned/unassigned; explicit grants; inactive member; stale JWT after revocation; guessed IDs | No cross-tenant row, count, export, storage URL, message, RPC or Realtime leak; WITH CHECK rejects forged tenant/ownership |
| Auth/admin | Invite reuse/expiry/wrong email; session expiry/recovery; MFA requirement; last-owner demotion; editable metadata role claim | No privilege escalation; owner removal serialized; safe redirect |
| Command authorization | Bypass UI and call action/RPC/route directly; setter attempts financial correction/assignment; read-only sends or writes | Every entry point denies forbidden operation; failure leaves no partial activity/outbox |
| Identity | Case/whitespace, E.164/default-country ambiguity, plus-tag emails, shared phone, conflicting email+phone, provider mapping | Documented normalization; ambiguous conflict queue; no fuzzy auto-merge or PII overwrite |
| Dedup concurrency | Two forms/manual/webhook intake arrive together; same key/different body; transaction retries | One canonical lead/claim, one source intake side effect; differing payload conflicts |
| Merge | Active journey conflict; source/survivor already merged; cross-tenant source; suppression union; financial history | No cycles/lost records; historical fact and credit stable; public visitor cannot trigger merge |
| Assignment | Concurrent round-robin; disabled rep; manager outside team; reassignment mid-action | Fair atomic cursor; eligible assignee only; historical credit unchanged; conflict handled |
| Pipeline/quick actions | All PDF stages/buttons; drag to won without deal; double SET/SHOW/CLOSE; reopen; simultaneous moves | Required context enforced; exactly one semantic fact; version conflict refreshes |
| Notes/important markers | Edit/redact/pin; target belongs to other lead; HTML/script payload | Revision history and scope preserved; content sanitized |
| Tasks/time | Today/upcoming/overdue; no next action; DST gap/fold; midnight; complete/reopen/retry | UTC scheduling and stated local reporting boundaries; no duplicated completion fact |
| Meetings | Duplicate booking; cancel+create reschedule; multiple invitees; missing closer; late booking after won; corrected attendance | One booking chain credit; no terminal regression; unknown mapping reviewed |
| Automations | 24h/1h example reminders; reschedule/cancel during dispatch; late scheduler; no-show/reply/opt-out stops | Obsolete jobs skipped; current schedule/permission rechecked; every real send intent/history recorded |
| Messages | Inbound routing ambiguity; duplicate/reordered receipts; unsupported opens/read; failure/unknown | Correct lead or restricted inbox; honest status; no duplicate thread/message |
| Campaigns/sequences | Audience snapshot; shared destination; personalization; changes after launch; batch restart; quotas; pause/reply/book/close exit | Each eligible recipient/step sends at most one intentional operation; no cross-team audience leakage |
| DNC/consent | Person/global/channel/purpose opt-out; import/remerge; re-opt-in evidence; provider unsubscribe mid-batch | Most restrictive applies; queued work cancelled; dispatch recheck; evidence not erased |
| Forms/API/CSV | All PDF field types; immutable answers; bad redirect/origin; forged hidden owner; replay; formula payload; row resume | Durable idempotent intake; no identity enumeration; no arbitrary URL/role escalation |
| Finance | Zero initial cash; installments; partial/refund/overpayment; duplicate receipt; concurrent refunds; differing currency | Exact minor-unit totals; no false receipt from scheduled installment; no over-refund or mixed currency sum |
| EOD | All metrics; duplicate facts; late event; reassignment; submitted revision; manager drilldown | Numbers exactly reconcile to frozen evidence; late data creates amendment; qualitative-only entry |
| Reporting | Cohorts, timezone, unknown attendance, canceled meetings, two rep roles, multiple currencies | Declared numerator/denominator; no role-credit double count; missing capability not zero |
| Meta attribution | Full graph; unknown IDs; creative reuse; direct visits; late touches; backfill; renamed campaigns; repeated lead journey | Raw evidence preserved; first/latest distinct; historical snapshots stable; no double-counted ad grains/models |
| Webhooks | Exact-byte signature validation; altered body; stale/replay timestamp where supported; wrong account; duplicate ID/different body | Verify before queue; trusted workspace; durable ack only; quarantined mismatch |
| Jobs/outbox | Crash before/after commit; overlapping cron; lease expiry; stale worker result; retry storm; 429/5xx/auth error | No lost committed intent; fencing prevents stale completion; bounded retries/fairness/dead-letter evidence |
| Provider ambiguity | Send accepted then connection drops; retry without provider idempotency | `unknown` plus reconciliation; no blind automatic duplicate send or fabricated success |
| Privacy | Consent decline/withdrawal; visitor proof replay; shared device; erasure/hold; raw payload expiry | No unauthorized stitching; bounded link; traceable deletion and affected rollup rebuild |
| Outbound boundary | Duplicate call disposition; forged scope; outdated suppression; stage/owner overwrite request | External IDs idempotent; CRM retains authority; no dialer execution inside CRM |

## VSL algorithm acceptance fixtures

All fixtures use a 100,000 ms asset unless stated. Use exact synthetic monotonic timestamps and simulate a 5-second heartbeat with 2-second tolerance; do not grant a 20-second missing heartbeat gap as continuous watch.

1. Continuous playback sampled every 5s from 0 to 20s, seek to 80s, then play sampled 80–90s: ranges `[0,20000)` and `[80000,90000)`, unique/media coverage 30s and 30% completion. The skipped 60s receives zero credit; 90s playhead is not 90% watched.
2. Watch 0–20s twice with regular samples: unique 20s, total media 40s, replayed media 20s; at 1× active elapsed 40s. Seeking back without playing adds nothing.
3. Watch 0–20s at 2× with appropriate timestamps: unique/media 20s, active elapsed 10s. Label seconds correctly; cap allowed rates by approved player capability.
4. Pause 60 seconds at 20s then resume: paused elapsed contributes zero. Buffering and hidden playback follow approved visibility policy; unknown state contributes no speculative interval.
5. Jump from 5s to 95s between 5s heartbeats without seek event: reject interval as discontinuous. A seek-to-end followed by `ended` alone does not qualify completion.
6. Drop heartbeat for 60s: do not fill unobserved content; re-anchor after the gap. Show incomplete telemetry rather than inventing watch time.
7. Duplicate batches, out-of-order events within lateness bound, same sequence/different payload, reconnect and recomputation: unique intervals/rollups remain stable; conflicts quarantined and valid late data restates derivation once.
8. Overlapping sessions/tabs for same permitted viewer: viewer unique coverage is union; viewer active wall-clock time deduplicates overlaps; session totals remain individually accurate.
9. Different asset versions/durations: no blended retention bins. Out-of-range/negative/NaN positions, impossible rates and clock regressions fail validation.
10. Viewer A watches bin 0 twice, B once, C plays elsewhere: session/viewer retention denominator declared; repeated coverage affects heatmap, not distinct viewer count. Aggregate distinct viewers across days by identity set/contributions rather than summing daily counts.
11. Anonymous session → consented form link: scoped sessions associate once; no consent/invalid proof/shared-device conflict produces no automatic known-lead link. Unrelated domains do not silently stitch.
12. Drop-off grace window: in-progress sessions are censored, completed sessions excluded from abandonment, late resume recomputes with version and as-of time.

Property tests: union length never exceeds asset duration; intervals remain sorted/disjoint; adding a seek adds no watch credit; duplicate accepted event does not change metrics; replay increases total/repeated media without increasing already-covered unique time; reordering within supported bounds yields the same deterministic result.

## Security and abuse verification

Exercise SQL/filter injection, stored XSS in notes/templates/answers, CSRF/session mutation, CORS assumptions, public key misuse, lead enumeration, arbitrary redirects, SSRF via configured URLs, oversized/deep JSON, request floods and CSV formula injection. Verify no secret in build artifacts/client bundles/logs. Check public form output excludes routing credentials and unpublished answers. Test reports/rollups and every new view/partition for RLS bypass. Confirm private Realtime channels cannot be guessed/subscribed across users; stale authorized channels receive no sensitive payload and refetch denies revoked access.

Provider signature tests must be based on official provider examples and captured sandbox samples at implementation time; signing a fixture with one's own incorrect algorithm is not verification. Run real sandbox send/receive/status/opt-out tests before each capability is called connected. Actual business permissions/template approval cannot be proven by unit tests.

## Performance and resilience

Agree production load and SLOs before capacity sign-off. Provisional design targets, not measured claims: ordinary lead query p95 ≤500ms server time, transactional command p95 ≤1s excluding providers, operational report p95 ≤2s for a bounded query, queue start lag ≤60s when reminders require it, reporting lag ≤60s for ordinary facts and ≤5 minutes for VSL rollups. Tune or revise with client-approved load/plan constraints.

Load fixtures vary tenant sizes, concurrent reps, hot teams, task backlog, campaign recipients, webhook bursts, video heartbeats and report date ranges. Inspect EXPLAIN plans/RLS helper costs, DB connections, job locks and memory. Test one busy workspace cannot starve others. Large imports/campaigns/exports are bounded jobs; realtime notification load is measured separately from database ingestion.

Failure injection: DB unavailable during intake (no false acceptance), worker termination at each transaction/network boundary, provider timeout/429, expired tokens, delayed webhook, duplicate cron, lost Realtime connection, partial aggregation, dead-letter replay, migration failure and restore. Prove safe backpressure and operational visibility. Disconnect Realtime: refetch/poll still converges; it is not the source of truth.

## Deployment and release gates

- Each PR: typecheck/lint, affected unit/property tests, migration replay and relevant database/RLS integration tests. Changes to permissions require the entire RLS matrix.
- Staging: synthetic end-to-end journey across setter/closer/manager/read-only, report reconciliation, timezone fixtures, accessibility/keyboard pipeline and quick actions, responsive layouts and supported browsers.
- Provider activation: sandbox evidence, consent/DNC, signatures, retries, real inbound/outbound linkage, approved sender/templates and monitoring; no skipped integration test passed off as success.
- Production: security review, forecast load, quota validation, isolated backup restore, migration/rollback rehearsal, redaction/retention, alert runbooks and named release owner.
- Final client acceptance: execute every row of the PDF p.8 matrix in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), plus Meta/VSL additions, and retain scoped evidence. A core-only application cannot pass the provider-dependent rows.

Recovery test target proposal: RPO ≤15 minutes, RTO ≤4 hours; measure actual restoration and reconcile provider operations before dispatch resumes. Client/budget must approve these targets. Failed/untested criteria remain visibly open; no fabricated pass results.
