-- Run after migrations with a database owner connection. All fixture rows roll back.
begin;

insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'rls-a@example.invalid', '', now(), now(), now()),
  ('00000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'rls-b@example.invalid', '', now(), now(), now()),
  ('00000000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', 'rls-c@example.invalid', '', now(), now(), now())
on conflict (id) do nothing;

update public.profiles set display_name = 'Owner A' where id = '00000000-0000-4000-8000-0000000000a1';

insert into public.groups(id, created_by, name) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'RLS test family'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a1', 'RLS test friends');

insert into public.group_members(group_id, user_id, role) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000b2', 'member'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000b2', 'member'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000c3', 'member');

insert into public.group_invitations(id, group_id, invited_email, invited_by) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'rls-c@example.invalid', '00000000-0000-4000-8000-0000000000a1');

insert into public.memories(id, user_id, title, image_path) values
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'RLS family memory', '00000000-0000-4000-8000-0000000000a1/20000000-0000-4000-8000-000000000001/test.jpg'),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a1', 'RLS friends memory', '00000000-0000-4000-8000-0000000000a1/20000000-0000-4000-8000-000000000002/test.jpg'),
  ('20000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000a1', 'RLS private memory', '00000000-0000-4000-8000-0000000000a1/20000000-0000-4000-8000-000000000003/test.jpg'),
  ('20000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000a1', 'RLS family-only memory', '00000000-0000-4000-8000-0000000000a1/20000000-0000-4000-8000-000000000004/test.jpg');

insert into public.memory_groups(memory_id, group_id) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002');

insert into public.people(id, created_by, name, relationship) values
  ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'Grandma', 'Grandmother');
insert into public.memory_people(memory_id, person_id) values
  ('20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001');
do $$ begin
  if exists (select 1 from auth.users where lower(email) = 'grandma@example.invalid') then
    raise exception 'People in Memories failed: adding Grandma created an Auth account';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","email":"rls-a@example.invalid"}', true);
do $$ begin
  if (select count(*) from public.memories) <> 4 then raise exception 'RLS test failed: owner should see all four memories'; end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b2', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated","email":"rls-b@example.invalid"}', true);
do $$ declare visible_count integer; family_count integer; friends_count integer; family_only_count integer;
begin
  select count(*) into visible_count from public.memories;
  select count(*) into family_count from public.memories where id = '20000000-0000-4000-8000-000000000001';
  select count(*) into friends_count from public.memories where id = '20000000-0000-4000-8000-000000000002';
  select count(*) into family_only_count from public.memories where id = '20000000-0000-4000-8000-000000000004';
  if visible_count <> 3 or family_count <> 1 or friends_count <> 1 or family_only_count <> 1 then raise exception 'RLS test failed: user in multiple groups should see each group's shared memories'; end if;
  update public.memories set title = 'unauthorized change' where id = '20000000-0000-4000-8000-000000000001';
  if found then raise exception 'RLS test failed: group member edited another user memory'; end if;
end $$;

delete from public.group_members where group_id = '10000000-0000-4000-8000-000000000001' and user_id = '00000000-0000-4000-8000-0000000000b2';
do $$ declare visible_count integer; family_only_count integer; shared_with_friends integer;
begin
  select count(*) into visible_count from public.memories;
  select count(*) into family_only_count from public.memories where id = '20000000-0000-4000-8000-000000000004';
  select count(*) into shared_with_friends from public.memories where id = '20000000-0000-4000-8000-000000000001';
  if visible_count <> 2 or family_only_count <> 0 or shared_with_friends <> 1 then raise exception 'RLS test failed: leaving one group must revoke only that group’s exclusive memories'; end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000c3', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c3","role":"authenticated","email":"rls-c@example.invalid"}', true);
do $$ declare visible_count integer; friends_count integer; family_count integer; family_only_count integer; invite_row record;
begin
  select * into invite_row from public.get_my_pending_group_invitations();
  if not found or invite_row.id is distinct from '30000000-0000-4000-8000-000000000001'::uuid
    or invite_row.group_name is distinct from 'RLS test family' or invite_row.invited_by_name is distinct from 'Owner A' then
    raise exception 'Invitation RLS failed: invitee should see only their pending invite details';
  end if;
  select count(*) into visible_count from public.memories;
  select count(*) into friends_count from public.memories where id = '20000000-0000-4000-8000-000000000002';
  select count(*) into family_count from public.memories where id = '20000000-0000-4000-8000-000000000001';
  select count(*) into family_only_count from public.memories where id = '20000000-0000-4000-8000-000000000004';
  if visible_count <> 2 or friends_count <> 1 or family_count <> 1 or family_only_count <> 0 then raise exception 'RLS test failed: invitee before accepting sees only current group shares'; end if;
  if public.accept_group_invitation('30000000-0000-4000-8000-000000000001') <> '10000000-0000-4000-8000-000000000001' then raise exception 'RLS test failed: invitee accepted into the wrong group'; end if;
  if (select count(*) from public.memories where id = '20000000-0000-4000-8000-000000000004') <> 1 then raise exception 'RLS test failed: accepting an invitation did not grant the group's shared memory'; end if;
end $$;

reset role;
rollback;
