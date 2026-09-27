# People and Groups setup

## Database migration

The app uses the `people`, `groups`, `group_members`, `group_invitations`, `memory_people`, and `memory_groups` tables. Account profile details are added by `migrations/20260926000300_user_profiles.sql`; `migrations/20260927000100_self_owned_profiles_and_invitations.sql` defers profile creation for invite-only auth identities until the invitee signs in and adds an invitee-scoped pending-invitation view. Apply all migrations in filename order.

You can apply migrations from the repository root by setting `SUPABASE_DB_URL` to the direct PostgreSQL connection string and `SUPABASE_DB_CA_CERT=supabase/prod-ca-2021.crt` in the ignored `.env.local`, then running `npm run db:migrate`. The script validates row-level security and private Storage buckets. Alternatively, paste and run the SQL migration in the Supabase SQL Editor.

Never commit `.env.local` or any file containing API keys or database passwords. The account profile needs no additional client-side environment variables. To enable secure account deletion, configure `SUPABASE_SERVICE_ROLE_KEY` as a server-only environment variable; never expose it to Vite or the browser.

## Invitation email function

Deploy the Edge Function from the repository root with the Supabase CLI:

```sh
supabase functions deploy send-group-invitation
```

Configure `SITE_URL` as an Edge Function secret with the application's public origin. Supabase provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to deployed functions; the service role key stays server-side and must never be copied into the Vite app or `.env.local`.

Add `/?group_invitation=*` (or the site's root URL) to Supabase Authentication > URL Configuration > Redirect URLs. Configure Supabase Auth email/SMTP settings before expecting delivery. New addresses receive an Auth invite; existing accounts receive a sign-in link. In either case the signed-in user must use the invited email and accept the invitation in the app.

The profile trigger deliberately does not create a profile when a new email receives an invitation. When the invitee completes the invite and signs in, the app creates their profile under their own Auth user ID. `SITE_URL` must be the app's public origin; localhost is suitable only for same-machine testing.

The Ask Memories API requires a Supabase user access token and queries `public.memories` using that user's JWT. Database RLS filters rows before any memory context is sent to Gemini; the browser cannot submit arbitrary memory context to this endpoint.

## RLS test

After applying migrations, run `tests/people_groups_rls.sql` and `tests/user_profile_rls.sql` in the Supabase SQL Editor using a database-owner connection. Both insert temporary Auth fixtures and roll back the transaction. They verify profile ownership and delayed invite-profile creation, invitation acceptance, multiple-group access, group-leave revocation, private-memory isolation, and that shared members cannot edit another user's memory.

For an end-to-end smoke test with two real test accounts, create a private memory and a group-shared memory as account A, then invite and accept as account B. Confirm B sees only the shared memory and Ask Memories can answer only from those accessible rows. Remove B from the group and confirm that memory disappears from B's results and subsequent Ask Memories answers.

The test is an integration test and should be run against a development/test Supabase project, not while another database transaction is using the same fixture IDs.
