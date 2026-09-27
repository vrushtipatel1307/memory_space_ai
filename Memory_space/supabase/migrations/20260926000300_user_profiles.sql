-- Private account profiles, profile photos, and minimal group-visible identity.
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists bio text not null default '';
alter table public.profiles add column if not exists birthday date;
alter table public.profiles add column if not exists location text;
alter table public.profiles add column if not exists profile_image_url text;
alter table public.profiles add column if not exists profile_visibility text not null default 'private';

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_username_format_check') then
    alter table public.profiles add constraint profiles_username_format_check
      check (username is null or username ~ '^[A-Za-z0-9_]{3,24}$');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_visibility_check') then
    alter table public.profiles add constraint profiles_visibility_check
      check (profile_visibility in ('private', 'groups', 'public'));
  end if;
end $$;

create unique index if not exists profiles_username_ci_unique_idx
  on public.profiles (lower(username)) where username is not null;

alter table public.profiles enable row level security;
drop policy if exists "Profiles are readable by their owner" on public.profiles;
drop policy if exists "Profiles are readable by owner or group peers" on public.profiles;
drop policy if exists "Profiles are editable by their owner" on public.profiles;
drop policy if exists "Users can read their own account profile" on public.profiles;
drop policy if exists "Users can create their own account profile" on public.profiles;
drop policy if exists "Users can update their own account profile" on public.profiles;
create policy "Users can read their own account profile" on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "Users can create their own account profile" on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy "Users can update their own account profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
grant select, insert, update on public.profiles to authenticated;

create or replace function public.can_view_account_profile(target_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select target_user = (select auth.uid())
    or exists (
      select 1 from public.profiles p
      where p.id = target_user and p.profile_visibility = 'public'
    )
    or exists (
      select 1
      from public.profiles p
      join public.group_members target_member on target_member.user_id = p.id
      join public.group_members viewer_member on viewer_member.group_id = target_member.group_id
      where p.id = target_user and p.profile_visibility = 'groups'
        and viewer_member.user_id = (select auth.uid())
    )
$$;

create or replace function public.get_group_member_profiles(target_group uuid)
returns table(user_id uuid, display_name text, username text, profile_image_url text)
language sql stable security definer set search_path = ''
as $$
  select gm.user_id, coalesce(p.display_name, ''),
    case when p.profile_visibility in ('groups', 'public') then p.username else null end,
    case when p.profile_visibility in ('groups', 'public') then p.profile_image_url else null end
  from public.group_members gm
  left join public.profiles p on p.id = gm.user_id
  where gm.group_id = target_group and public.is_group_member(target_group)
$$;

revoke all on function public.can_view_account_profile(uuid) from public;
revoke all on function public.get_group_member_profiles(uuid) from public;
grant execute on function public.can_view_account_profile(uuid) to authenticated;
grant execute on function public.get_group_member_profiles(uuid) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "Users can view visible profile photos" on storage.objects;
create policy "Users can view visible profile photos" on storage.objects for select to authenticated
  using (bucket_id = 'profile-photos' and public.can_view_account_profile(((storage.foldername(name))[1])::uuid));
drop policy if exists "Users can upload their own profile photos" on storage.objects;
create policy "Users can upload their own profile photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Users can update their own profile photos" on storage.objects;
create policy "Users can update their own profile photos" on storage.objects for update to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Users can delete their own profile photos" on storage.objects;
create policy "Users can delete their own profile photos" on storage.objects for delete to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
