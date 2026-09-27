-- User profiles and private memory data for MemorySpace.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''))
  on conflict (id) do update
    set display_name = excluded.display_name;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.create_profile_for_auth_user();

insert into public.profiles (id, display_name)
select id, coalesce(raw_user_meta_data ->> 'name', '')
from auth.users
on conflict (id) do nothing;

create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  year text not null default 'Unknown',
  location text not null default 'Location unknown',
  story text not null default '',
  people text[] not null default '{}',
  image_path text not null,
  voice jsonb,
  voice_path text,
  transcript text,
  ai jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memories_user_created_idx
  on public.memories (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.memories enable row level security;

drop policy if exists "Profiles are readable by their owner" on public.profiles;
create policy "Profiles are readable by their owner"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Profiles are editable by their owner" on public.profiles;
create policy "Profiles are editable by their owner"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "Users can read their own memories" on public.memories;
create policy "Users can read their own memories"
  on public.memories for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own memories" on public.memories;
create policy "Users can create their own memories"
  on public.memories for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own memories" on public.memories;
create policy "Users can update their own memories"
  on public.memories for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own memories" on public.memories;
create policy "Users can delete their own memories"
  on public.memories for delete to authenticated
  using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('memory-photos', 'memory-photos', false, 12582912, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = false;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('memory-audio', 'memory-audio', false, 31457280, array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'])
on conflict (id) do update set public = false;

drop policy if exists "Users can read their own memory photos" on storage.objects;
create policy "Users can read their own memory photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'memory-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users can upload their own memory photos" on storage.objects;
create policy "Users can upload their own memory photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'memory-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users can update their own memory photos" on storage.objects;
create policy "Users can update their own memory photos"
  on storage.objects for update to authenticated
  using (bucket_id = 'memory-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'memory-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users can delete their own memory photos" on storage.objects;
create policy "Users can delete their own memory photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'memory-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users can read their own memory audio" on storage.objects;
create policy "Users can read their own memory audio"
  on storage.objects for select to authenticated
  using (bucket_id = 'memory-audio' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users can upload their own memory audio" on storage.objects;
create policy "Users can upload their own memory audio"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'memory-audio' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users can update their own memory audio" on storage.objects;
create policy "Users can update their own memory audio"
  on storage.objects for update to authenticated
  using (bucket_id = 'memory-audio' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'memory-audio' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users can delete their own memory audio" on storage.objects;
create policy "Users can delete their own memory audio"
  on storage.objects for delete to authenticated
  using (bucket_id = 'memory-audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
