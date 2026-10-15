# Shared Trainwise Supabase project

Decision: use Trainwise’s existing project, Supabase user accounts, and authentication configuration. Fantasy data remains in `public.fantasy_workspaces`, one current row per user. No workbook files or import archive are stored.

## Deployment

1. Open the existing Trainwise project. Run `supabase/preflight.sql` to inspect the fantasy namespace and confirm Trainwise objects are present. If fantasy objects already exist, inspect their definitions before applying the migration.
2. Apply `supabase/migrations/001_workspace.sql`. Its table, policy, and functions have fantasy-specific names. It does not alter Trainwise tables, policies, functions, users, or records.
3. Preserve the current Auth site URL and redirect entries. Append the exact destinations `https://ech3lon7.github.io/fantasy-football-lab/` and `https://ech3lon7.github.io/fantasy-football-lab/#/data` to the redirect allowlist. Retain existing email/password and confirmation settings.
4. Set the Fantasy GitHub repository variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the existing project URL and publishable (or legacy anon) key. Never put a service-role key, secret key, password, or administrative token in these variables. Trigger the Pages workflow.
5. Sign into Fantasy with the existing Trainwise account. Import the workbook locally, then choose Sync now and initialize the current fantasy workspace. Sign in on a second device and sync to verify the same dataset, team, settings, and draft.
6. Verify Trainwise still reads and syncs normally. Fantasy sign-out must leave the Trainwise session active. Changes to Fantasy's dataset must leave fitness records unchanged.

The apps share user accounts but keep independent sessions. Fantasy uses an app- and project-specific auth storage key and `signOut({ scope: "local" })`; Supabase's default global sign-out would revoke sessions across apps. [Supabase sign-out scopes](https://supabase.com/docs/guides/auth/signout)

Fantasy RPCs validate payloads, require the authenticated user's ID, and enforce revision checks. Row-level security restricts reads to the current user's row; direct client writes are revoked. Repeated imports replace the row's dataset. Cloud account deletion or password changes are project-wide; the app's Delete cloud workspace action only removes that account's fantasy row.

## Verification status

The fantasy migration is installed in the selected Trainwise project (`nmsdzunslpqxtiujxutv`). Before/after data and access-rule fingerprints confirmed existing fitness tables, records, policies, permissions, and the sync function were unchanged.

Hosted PostgreSQL checks passed for fantasy initialization, dataset/state updates, idempotent retries, revision conflicts, direct-write denial, and cross-account read isolation. Synthetic changes were rolled back. The public Auth settings endpoint confirmed email/password login is enabled; anonymous RPC access was denied. Local checks include 32 tests and the real-workbook browser workflow.

The public URL and anon key are set in GitHub repository build variables. Both exact Fantasy authentication redirects were saved and verified after user approval on October 14, 2026. The existing site URL was preserved. Actual user sign-in and cross-device sync remain to be exercised with the user's Trainwise account; database tests do not substitute for that browser acceptance check.
