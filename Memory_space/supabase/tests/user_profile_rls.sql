-- Run after user profile migrations with a database owner. All fixture rows roll back.
begin;
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('00000000-0000-4000-8000-0000000000d4', 'authenticated', 'authenticated', 'profile-a@example.invalid', '', now(), now(), now(), '{}'),
  ('00000000-0000-4000-8000-0000000000e5', 'authenticated', 'authenticated', 'profile-b@example.invalid', '', now(), now(), now(), '{}'),
  ('00000000-0000-4000-8000-0000000000f6', 'authenticated', 'authenticated', 'invite-only@example.invalid', '', now(), now(), now(), '{"group_invitation_id":"30000000-0000-4000-8000-000000000001"}')
on conflict (id) do nothing;

do $$ begin
  if exists (select 1 from public.profiles where id = '00000000-0000-4000-8000-0000000000f6') then
    raise exception 'Profile ownership failed: sending an invite created the invitee profile before they acted';
  end if;
end $$;

update public.profiles set display_name = 'Profile A', bio = 'Private A' where id = '00000000-0000-4000-8000-0000000000d4';
update public.profiles set display_name = 'Profile B', bio = 'Private B' where id = '00000000-0000-4000-8000-0000000000e5';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000d4', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d4","role":"authenticated","email":"profile-a@example.invalid"}', true);
do $$ begin
  if (select count(*) from public.profiles where id = '00000000-0000-4000-8000-0000000000d4') <> 1 then raise exception 'Profile RLS failed: user A cannot read own profile'; end if;
  if (select count(*) from public.profiles where id = '00000000-0000-4000-8000-0000000000e5') <> 0 then raise exception 'Profile RLS failed: user A can read user B private profile'; end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000e5', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e5","role":"authenticated","email":"profile-b@example.invalid"}', true);
do $$ begin
  update public.profiles set display_name = 'Hacked' where id = '00000000-0000-4000-8000-0000000000d4';
  if found then raise exception 'Profile RLS failed: user B changed user A profile'; end if;
end $$;

-- The invitee creates their own profile only after authenticating.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000f6', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f6","role":"authenticated","email":"invite-only@example.invalid"}', true);
insert into public.profiles(id, display_name) values ('00000000-0000-4000-8000-0000000000f6', 'Invitee-owned profile');
do $$ begin
  if not exists (select 1 from public.profiles where id = '00000000-0000-4000-8000-0000000000f6' and display_name = 'Invitee-owned profile') then
    raise exception 'Profile ownership failed: invitee could not create their own profile after authenticating';
  end if;
end $$;

reset role;
do $$ begin
  if (select display_name from public.profiles where id = '00000000-0000-4000-8000-0000000000d4') <> 'Profile A' then raise exception 'Profile RLS failed: user A profile was modified'; end if;
end $$;
rollback;
