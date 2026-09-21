# 80/20 CRM

Phase 1 platform foundation. No sales modules or external provider integrations are implemented.

## Local application

Use Node 24 and npm. Run `npm ci`. Copy `.env.example` to an ignored `.env.local` and fill the required values from an actual isolated Supabase project (or running local Supabase). Do not commit local credentials. Configure Supabase to expose **only `api`**, disable public/anonymous signup, enable TOTP MFA and set exact approved Auth redirect URLs. Then run `npm run dev`.

Startup intentionally fails without valid configuration. A valid public key does not grant workspace access: the signed-in user also needs an active PostgreSQL membership. The app has no secret/service-role client.

## Database and initial access

Install Docker and the Supabase CLI, then use `supabase start` and `supabase db reset --local --no-seed` for a disposable local environment. Never reset a production database. The checked-in migration is the only schema authority; use reviewed migrations for changes.

Provision the first user through the Supabase administration interface, verify their email, and use a migration administrator to call `private.bootstrap_workspace(owner_user_uuid, workspace_name, IANA_timezone, currency_code)` with the real approved inputs. This function is not available to application users or the Data API. It creates the owner membership and audit record atomically. No seeded production owner or password is included. Owners/Admins must enroll and verify an authenticator at `/mfa` before accessing workspace data or commands.

Invite-ready access: an authenticated MFA-verified admin may call `api.issue_invitation`; share the returned code once through an approved secure channel. Provision the invited Auth identity separately using Supabase administration with email confirmation (there is no public signup or mail-provider integration). The user signs in and submits the code at `/invite`; acceptance verifies the confirmed email against Auth, locks and consumes the invitation, and cannot reactivate an existing inactive membership. Email delivery and complete administrative management screens are outside this phase.

## Checks

- `npm run typecheck` — route generation and strict TypeScript, requires runtime configuration.
- `npm run lint` — Next/TypeScript/React rules, no explicit `any`, zero warnings.
- `npm test` — unit tests.
- `npm run test:db` — actual embedded PostgreSQL migration and role/RLS assertions, with an explicitly test-only Auth schema contract.
- `npm run test:db:live` — same permission scenarios against a migrated disposable local Supabase database via `TEST_DATABASE_URL`; refuses hosted targets and exits 2 if not configured.
- `npm run build` — production compilation with real deployment configuration.
- `npm run test:e2e` — Chromium anonymous shell/API checks against a test-configured build.
- `npm run security:scan` — source/configuration/document credential-pattern scan.

For credential-free compile verification only: `node scripts/with-test-env.mjs typegen`, `npx tsc --noEmit`, and `node scripts/with-test-env.mjs build`. This uses an unmistakable noncredential public test string and a loopback URL. It cannot sign in to Supabase and must **never** be deployed as a real environment. It does not bypass startup validation or report any service as connected.

CI has separate application and actual local Supabase jobs. GitHub execution, branch protection, hosted staging, production deployments and end-to-end real Auth verification still require client infrastructure. See [Phase 1 verification](docs/PHASE_1_VERIFICATION.md) for actual results and [architecture](docs/ARCHITECTURE.md) for approved future scope.
