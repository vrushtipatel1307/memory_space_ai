-- People, groups, invitations, and group-shared memories.
create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  relationship text,
  description text,
  birthday date,
  profile_image_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists people_created_by_idx on public.people(created_by, name);
create unique index if not exists people_owner_name_unique_idx on public.people(created_by, lower(name));

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  description text,
  image_url text,
  group_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_members_user_idx on public.group_members(user_id, group_id);

create table if not exists public.group_invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  invited_email text not null check (length(trim(invited_email)) between 3 and 320),
  invited_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days')
);
create unique index if not exists group_invitations_pending_email_idx
  on public.group_invitations(group_id, lower(invited_email)) where status = 'pending';

create or replace function public.expire_replaced_group_invitation()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin
  update public.group_invitations gi set status = 'expired'
  where gi.group_id = new.group_id and lower(gi.invited_email) = lower(new.invited_email)
    and gi.status = 'pending' and gi.expires_at <= now();
  return new;
end $$;
drop trigger if exists group_invitation_expire_before_insert on public.group_invitations;
create trigger group_invitation_expire_before_insert before insert on public.group_invitations
for each row execute function public.expire_replaced_group_invitation();

create table if not exists public.memory_people (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.memories(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (memory_id, person_id)
);
create index if not exists memory_people_person_idx on public.memory_people(person_id, memory_id);

create table if not exists public.memory_groups (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.memories(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (memory_id, group_id)
);
create index if not exists memory_groups_group_idx on public.memory_groups(group_id, memory_id);

-- Migrate existing name-only memory participants to real, owner-scoped people.
insert into public.people(created_by, name)
select distinct on (m.user_id, lower(trim(person_name))) m.user_id, trim(person_name)
from public.memories m
cross join lateral unnest(m.people) as person_name
where nullif(trim(person_name), '') is not null
order by m.user_id, lower(trim(person_name)), trim(person_name)
on conflict (created_by, lower(name)) do nothing;

insert into public.memory_people(memory_id, person_id)
select m.id, p.id
from public.memories m
cross join lateral unnest(m.people) as person_name
join public.people p on p.created_by = m.user_id and lower(p.name) = lower(trim(person_name))
where nullif(trim(person_name), '') is not null
on conflict (memory_id, person_id) do nothing;

drop function if exists public.is_group_member(uuid, uuid);
drop function if exists public.can_manage_group(uuid, uuid);
drop function if exists public.is_group_owner(uuid, uuid);
drop function if exists public.can_access_memory(uuid, uuid);

create or replace function public.is_group_member(target_group uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.group_members gm where gm.group_id = target_group and gm.user_id = (select auth.uid())) $$;

create or replace function public.can_manage_group(target_group uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.group_members gm where gm.group_id = target_group and gm.user_id = (select auth.uid()) and gm.role in ('owner', 'admin')) $$;

create or replace function public.is_group_owner(target_group uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.group_members gm where gm.group_id = target_group and gm.user_id = (select auth.uid()) and gm.role = 'owner') $$;

create or replace function public.can_access_memory(target_memory uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists(select 1 from public.memories m where m.id = target_memory and m.user_id = (select auth.uid()))
      or exists(select 1 from public.memory_groups mg join public.group_members gm on gm.group_id = mg.group_id
                where mg.memory_id = target_memory and gm.user_id = (select auth.uid()))
$$;

create or replace function public.add_group_creator_as_owner()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin
  insert into public.group_members(group_id, user_id, role) values (new.id, new.created_by, 'owner') on conflict do nothing;
  return new;
end $$;
drop trigger if exists groups_add_creator on public.groups;
create trigger groups_add_creator after insert on public.groups for each row execute function public.add_group_creator_as_owner();

create or replace function public.accept_group_invitation(invitation_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare invitation public.group_invitations%rowtype; account_email text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select lower(u.email) into account_email from auth.users u where u.id = auth.uid();
  select * into invitation from public.group_invitations gi where gi.id = invitation_id for update;
  if invitation.id is null or lower(invitation.invited_email) <> account_email then raise exception 'Invitation not found for this account'; end if;
  if invitation.status <> 'pending' or invitation.expires_at <= now() then raise exception 'Invitation is no longer active'; end if;
  insert into public.group_members(group_id, user_id, role) values (invitation.group_id, auth.uid(), 'member') on conflict (group_id, user_id) do nothing;
  update public.group_invitations set status = 'accepted' where id = invitation.id;
  return invitation.group_id;
end $$;

create or replace function public.decline_group_invitation(invitation_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.group_invitations gi set status = 'declined'
  where gi.id = invitation_id and gi.status = 'pending'
    and lower(gi.invited_email) = (select lower(u.email) from auth.users u where u.id = auth.uid());
  if not found then raise exception 'Invitation not found for this account'; end if;
end $$;

grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.can_manage_group(uuid) to authenticated;
grant execute on function public.is_group_owner(uuid) to authenticated;
grant execute on function public.can_access_memory(uuid) to authenticated;
grant execute on function public.accept_group_invitation(uuid) to authenticated;
grant execute on function public.decline_group_invitation(uuid) to authenticated;

alter table public.people enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invitations enable row level security;
alter table public.memory_people enable row level security;
alter table public.memory_groups enable row level security;

grant select, insert, update, delete on public.people, public.groups, public.group_members,
  public.group_invitations, public.memory_people, public.memory_groups to authenticated;
grant select on public.profiles, public.memories to authenticated;

drop policy if exists "Profiles are readable by their owner" on public.profiles;
drop policy if exists "Profiles are readable by owner or group peers" on public.profiles;
create policy "Profiles are readable by owner or group peers" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or exists (
    select 1 from public.group_members peer
    where peer.user_id = profiles.id and public.is_group_member(peer.group_id)
  ));

drop policy if exists "Users can read their own memories" on public.memories;
create policy "Users can read owned or group-shared memories" on public.memories for select to authenticated
  using (public.can_access_memory(id));

drop policy if exists "People are visible to their creator or memory collaborators" on public.people;
drop policy if exists "People are visible only to their creator" on public.people;
create policy "People are visible only to their creator" on public.people for select to authenticated
  using (created_by = (select auth.uid()));
drop policy if exists "People can be created by their owner" on public.people;
create policy "People can be created by their owner" on public.people for insert to authenticated
  with check (created_by = (select auth.uid()));
drop policy if exists "People can be edited by their owner" on public.people;
create policy "People can be edited by their owner" on public.people for update to authenticated
  using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));
drop policy if exists "People can be deleted by their owner" on public.people;
create policy "People can be deleted by their owner" on public.people for delete to authenticated
  using (created_by = (select auth.uid()));

drop policy if exists "Group members can read their groups" on public.groups;
create policy "Group members can read their groups" on public.groups for select to authenticated
  using (public.is_group_member(id));
drop policy if exists "Authenticated users can create groups" on public.groups;
create policy "Authenticated users can create groups" on public.groups for insert to authenticated
  with check (created_by = (select auth.uid()));
drop policy if exists "Group admins can edit groups" on public.groups;
create policy "Group admins can edit groups" on public.groups for update to authenticated
  using (public.can_manage_group(id)) with check (public.can_manage_group(id));
drop policy if exists "Only group owners can delete groups" on public.groups;
create policy "Only group owners can delete groups" on public.groups for delete to authenticated
  using (public.is_group_owner(id));

drop policy if exists "Group members can read memberships" on public.group_members;
create policy "Group members can read memberships" on public.group_members for select to authenticated
  using (public.is_group_member(group_id));
drop policy if exists "Group admins can add memberships" on public.group_members;
create policy "Group admins can add memberships" on public.group_members for insert to authenticated
  with check (public.can_manage_group(group_id) and role = 'member');
drop policy if exists "Group admins can update non-owner memberships" on public.group_members;
create policy "Group admins can update non-owner memberships" on public.group_members for update to authenticated
  using (public.can_manage_group(group_id) and role <> 'owner')
  with check (public.can_manage_group(group_id) and role in ('admin', 'member'));
drop policy if exists "Group admins or members can remove non-owners" on public.group_members;
create policy "Group admins or members can remove non-owners" on public.group_members for delete to authenticated
  using (role <> 'owner' and (public.can_manage_group(group_id) or user_id = (select auth.uid())));

drop policy if exists "Invitees and group admins can read invitations" on public.group_invitations;
create policy "Invitees and group admins can read invitations" on public.group_invitations for select to authenticated
  using (public.can_manage_group(group_id) or lower(invited_email) = lower((select auth.jwt() ->> 'email')));
drop policy if exists "Group admins can invite by email" on public.group_invitations;
create policy "Group admins can invite by email" on public.group_invitations for insert to authenticated
  with check (public.can_manage_group(group_id) and invited_by = (select auth.uid()) and status = 'pending');
drop policy if exists "Group admins can cancel invitations" on public.group_invitations;
create policy "Group admins can cancel invitations" on public.group_invitations for delete to authenticated
  using (public.can_manage_group(group_id));

drop policy if exists "Users can read people on accessible memories" on public.memory_people;
create policy "Users can read people on accessible memories" on public.memory_people for select to authenticated
  using (public.can_access_memory(memory_id));
drop policy if exists "Memory owners can add people" on public.memory_people;
create policy "Memory owners can add people" on public.memory_people for insert to authenticated
  with check (exists(select 1 from public.memories m join public.people p on p.id = person_id
    where m.id = memory_id and m.user_id = (select auth.uid()) and p.created_by = (select auth.uid())));
drop policy if exists "Memory owners can remove people" on public.memory_people;
create policy "Memory owners can remove people" on public.memory_people for delete to authenticated
  using (exists(select 1 from public.memories m where m.id = memory_id and m.user_id = (select auth.uid())));

drop policy if exists "Members can read shared memory links" on public.memory_groups;
create policy "Members can read shared memory links" on public.memory_groups for select to authenticated
  using (public.can_access_memory(memory_id));
drop policy if exists "Memory owners can share to their groups" on public.memory_groups;
create policy "Memory owners can share to their groups" on public.memory_groups for insert to authenticated
  with check (exists(select 1 from public.memories m where m.id = memory_id and m.user_id = (select auth.uid()))
    and public.is_group_member(group_id));
drop policy if exists "Memory owners can unshare their memories" on public.memory_groups;
create policy "Memory owners can unshare their memories" on public.memory_groups for delete to authenticated
  using (exists(select 1 from public.memories m where m.id = memory_id and m.user_id = (select auth.uid())));

-- Storage buckets stay private. Object keys: userId/personId/file; groupId/file; userId/memoryId/file.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('people-photos', 'people-photos', false, 12582912, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = false;
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('group-images', 'group-images', false, 12582912, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = false;

drop policy if exists "Users can read their own memory photos" on storage.objects;
create policy "Users can read owned or group-shared memory photos" on storage.objects for select to authenticated
  using (bucket_id = 'memory-photos' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.can_access_memory(((storage.foldername(name))[2])::uuid)
  ));
drop policy if exists "Users can upload their own memory photos" on storage.objects;
create policy "Users can upload their own memory photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'memory-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Users can update their own memory photos" on storage.objects;
create policy "Users can update their own memory photos" on storage.objects for update to authenticated
  using (bucket_id = 'memory-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'memory-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Users can delete their own memory photos" on storage.objects;
create policy "Users can delete their own memory photos" on storage.objects for delete to authenticated
  using (bucket_id = 'memory-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users can read their own memory audio" on storage.objects;
create policy "Users can read owned or group-shared memory audio" on storage.objects for select to authenticated
  using (bucket_id = 'memory-audio' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.can_access_memory(((storage.foldername(name))[2])::uuid)
  ));

drop policy if exists "People can read their own profile photos" on storage.objects;
create policy "People can read their own profile photos" on storage.objects for select to authenticated
  using (bucket_id = 'people-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "People can upload their own profile photos" on storage.objects;
create policy "People can upload their own profile photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'people-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "People can update their own profile photos" on storage.objects;
create policy "People can update their own profile photos" on storage.objects for update to authenticated
  using (bucket_id = 'people-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'people-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "People can delete their own profile photos" on storage.objects;
create policy "People can delete their own profile photos" on storage.objects for delete to authenticated
  using (bucket_id = 'people-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Group members can read group images" on storage.objects;
create policy "Group members can read group images" on storage.objects for select to authenticated
  using (bucket_id = 'group-images' and public.is_group_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "Group admins can upload group images" on storage.objects;
create policy "Group admins can upload group images" on storage.objects for insert to authenticated
  with check (bucket_id = 'group-images' and public.can_manage_group(((storage.foldername(name))[1])::uuid));
drop policy if exists "Group admins can update group images" on storage.objects;
create policy "Group admins can update group images" on storage.objects for update to authenticated
  using (bucket_id = 'group-images' and public.can_manage_group(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'group-images' and public.can_manage_group(((storage.foldername(name))[1])::uuid));
drop policy if exists "Group admins can delete group images" on storage.objects;
create policy "Group admins can delete group images" on storage.objects for delete to authenticated
  using (bucket_id = 'group-images' and public.can_manage_group(((storage.foldername(name))[1])::uuid));
