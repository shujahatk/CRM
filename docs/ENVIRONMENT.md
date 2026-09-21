# Environment and deployment specification

Status: specification only. No credentials generated, accounts connected, `.env` files created or environments provisioned. Names below are proposed application configuration contracts, not invented credential values. Exact SDK key naming/support must be checked against pinned versions during implementation.

Phase 1 update: `.env.example` now contains empty names only. Startup/build configuration validates `APP_ENV`, `APP_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and optional `LOG_LEVEL` (default info). Only those two `NEXT_PUBLIC_` variables are allowed. No service/secret credential is accepted or used by the Phase 1 app. Later-phase variables in the inventory below are intentionally not required yet. `TEST_DATABASE_URL` is reserved for a disposable local test database; its runner refuses hosted targets. `scripts/with-test-env.mjs` provides explicit noncredential, loopback configuration for compilation/anonymous smoke tests; those artifacts must not be deployed. Real authenticated operation requires real isolated Supabase configuration. Node 24 is the documented runtime.

## Environment separation and configuration rules

Use isolated local/test, staging and production Supabase projects and Vercel environment scopes. Preview builds use disposable or isolated staging data with outbound delivery disabled, never production credentials. Supabase Auth identities, redirect URLs, Realtime policies, migrations, scheduled jobs and provider webhooks are configured separately per environment. Production uses client-owned accounts and least-privilege access, not a developer's personal account.

Read validated server config once per runtime; fail startup/deployment with missing variable names only, never echo values. Public variables are assumed downloadable by anyone. No secret may use `NEXT_PUBLIC_`, appear in rendered props, errors, logs, URLs, source maps, committed files or test fixtures. Runtime feature gates require both explicit activation and a validated connection; a flag cannot manufacture a successful integration. Keep a committed example file with names/empty placeholders only after scaffolding is approved; this phase does not create one.

## Core configuration

| Proposed variable | Visibility | Required when | Validation/purpose |
|---|---|---|---|
| `APP_ENV` | Server | Every runtime | local/test/staging/production; controls safety checks |
| `APP_BASE_URL` | Server | Web runtime | Absolute approved HTTPS origin except localhost |
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Auth/browser runtime | Correct environment's Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public | Auth/browser runtime | Browser-safe project key; security still relies on RLS/grants |
| `SUPABASE_SECRET_KEY` | Server secret | Elevated ingress/worker only | Restricted server credential with bypass risk; never needed by browser |
| `DATABASE_POOLER_URL` | Server secret | Direct SQL worker, if chosen | TLS pooled low-privilege connection; not used by ordinary browser requests |
| `DATABASE_MIGRATION_URL` | CI secret | Migration/recovery job only | Elevated direct/session-compatible connection; absent from Vercel web runtime |
| `CRON_SECRET` | Server secret | Dispatcher | High-entropy bearer secret; constant-time comparison and rotation |
| `INGESTION_TOKEN_SIGNING_KEY` | Server secret | Forms/tracking token issuance | Signed short-lived scoped session/association tokens; managed rotation/key IDs |
| `IDENTITY_LOOKUP_HMAC_KEY` | Server secret | Protected identity/suppression lookup | Distinct purpose key; versioned lookup and dual-read rotation |
| `SECRET_STORE_KEY_REF` | Server | Provider credential storage later | Reference to approved managed encryption/secret store; provider selection is a decision |
| `LOG_LEVEL` | Server | Every runtime | Allowlisted levels; production redaction always enabled |
| `OTEL_SERVICE_NAME` | Server | Tracing enabled | Nonsecret stable service label |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Server | Tracing exporter enabled | Approved telemetry destination and region |
| `OTEL_EXPORTER_OTLP_HEADERS` | Server secret | Authenticated exporter | Optional exporter credentials; never logged |
| `ERROR_TRACKING_DSN` | Server/config | Error platform chosen | Vendor-dependent sensitivity; redaction and residency review required |
| `OUTBOUND_DELIVERY_ENABLED` | Server | Future connected delivery | Default false; production-only explicit enablement with channel readiness |
| `PUBLIC_TRACKING_ENABLED` | Server | VSL rollout | Default false until privacy policy, site/asset scopes and capacity validated |
| `WORKER_BATCH_SIZE` | Server | Worker | Bounded positive integer sized to runtime budget |
| `WORKER_LEASE_SECONDS` | Server | Worker | Greater than bounded work duration; heartbeats/fencing mandatory |
| `MAX_INGEST_BODY_BYTES` | Server | Public ingress | Bounded request size consistent with host limit |
| `VSL_MAX_BATCH_EVENTS` | Server | Telemetry intake | Bound parser/DB resource use; reject oversize batches safely |

Do not configure both legacy and new Supabase key families without a reviewed compatibility reason. If an SDK requires different names, update this document and validation schema together. Migration role must not be reused as the application or worker role. Prefer narrow worker database grants over broad service credentials when feasible; any unavoidable bypass credential is isolated in dedicated server modules.

Timezone, currency, metric formulas, stage labels, assignment rules, tracking/consent purposes, allowed embed origins, retention, reminder offsets and sending windows are versioned workspace settings in PostgreSQL. Do not make tenant business policy a global environment variable. Platform safety ceilings can remain deployment configuration.

## Future provider credentials — do not request or configure now

Workspace-specific credentials belong in encrypted connection records/managed secret storage, referenced by ID. Only truly application-wide secrets belong in server environment configuration. Persist OAuth refresh tokens encrypted, rotate atomically and serialize refresh so concurrent workers cannot destroy a valid credential.

| Provider/capability | App-level configuration eventually needed | Client-owned connection data/approval |
|---|---|---|
| Meta Marketing API/Lead Ads/messaging | `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_GRAPH_API_VERSION` | Business/ad account/Page IDs; permitted access token; approved scopes and app review/business verification where required; test lead source and eligible messaging use case |
| Meta Pixel/CAPI | No secret browser token; Pixel ID may be public when enabled | Dataset/Pixel ID, CAPI token/connection, domain control, agreed events/value/currency, consent and event dedup mapping; test-event configuration kept out of live reporting |
| Calendly | `CALENDLY_OAUTH_CLIENT_ID`, `CALENDLY_OAUTH_CLIENT_SECRET` if OAuth chosen | Organization/user access, supported subscription/event types, webhook verification material and owner-to-closer mapping; PAT versus OAuth selected later |
| Resend | App-wide configuration only if architecture selects one shared account | Scoped API key, verified sending domain, DNS access, reply/inbound setup and signing secret per webhook endpoint |
| Twilio SMS | App-level account strategy decided before integration | Account/subaccount SID, secret credentials required by selected auth/verification method, approved sender/number, messaging service ID, registration and callback signing requirements |
| WhatsApp Business/Cloud API | May share approved Meta application; separate capability | WABA ID, phone number ID, access token, approved templates, business verification and messaging eligibility |
| External VSL/player | `VSL_ALLOWED_PLAYER_TYPES` only if needed as platform capability | Approved player API, stable video versions/durations, site domains, embed deployment access and consent-management integration; hosting secrets only if genuinely needed |
| 80/20 Outbound | No shared database or copied credentials | Separate service identity/scopes, endpoint ownership, signing/OAuth contract, external ID mappings, suppression sync and reconciliation SLA |

Provider verification algorithms, required scopes, token types and plan-dependent features must be verified against official documentation during the integration phase. This is a requirements inventory, not a claim that accounts or permissions exist. Store no real token in these documents and never request credentials through a committed file.

## Deployment topology and release controls

1. GitHub: protected main, reviewed pull requests, lockfile, secret/dependency scanning, type/lint/tests and disposable migration tests. CI uses environment-restricted secrets; prefer federated identities where supported. No production secrets in untrusted fork jobs.
2. Vercel: Next.js app with server-only ingress/commands and bounded dispatch/worker routes; region aligned with Supabase; environment-specific domains and allowed redirects. Scheduled route authenticates before touching the queue. Public telemetry/webhooks get payload/rate limits.
3. Supabase: PostgreSQL/Auth/private Realtime, restricted schema exposure, migrations run by CI release job, backups/PITR per verified plan, project access review and strong admin authentication. Optional future file storage is private and independently covered by recovery.
4. Jobs: database is durable source; dispatcher claims small leased batches. Measure cron precision/function duration against reminder SLA. A dedicated worker runtime is required if agreed throughput or timing cannot be met by bounded Vercel work. Selecting that runtime requires a later infrastructure decision, not pretending Vercel supports an endless worker.
5. Observability: approved metrics/traces/error service with PII scrubbing, region/retention controls and alert ownership. Provider secrets are excluded from all diagnostics.

Deploy schema expansions first, compatible app second, backfill third, contractions in a later release. Take/verify backup before risky migrations. App rollback is supported by backward-compatible schema; database rollback may require forward correction or restore, never an unreviewed destructive down migration. Disable dispatch during restore to prevent replayed external sends; reconcile retained operation IDs against providers before resuming.

## Operations checklist before production

- Confirm domain/DNS ownership, HTTPS, Auth redirect allowlist, CSP/embed origins, cookie behavior and cross-domain consent assumptions.
- Verify actual Vercel/Supabase quotas, region, concurrency, connections, backup/PITR retention and Realtime fan-out. Test restoration into an isolated environment with sends disabled.
- Validate shared public-intake rate limits across instances; process-local counters are insufficient. Select a distributed enforcement mechanism within budget before public launch.
- Record secret owner, scope, expiry, rotation, revocation and compromise response. Exercise rotation without logging values; revoke old keys after validated cutover.
- Confirm backup inventory includes database, secret references/recovery process, provider registrations and any storage objects; no assumption a database backup restores external resources.
- Agree monitoring/on-call, RPO/RTO, retention/legal holds, export permissions and production data migration authorization.

Required client inputs and open decisions are in [DECISIONS.md](DECISIONS.md). No credentials are required to review this architecture.
