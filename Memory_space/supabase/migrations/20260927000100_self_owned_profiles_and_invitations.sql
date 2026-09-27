-- Delay account-profile creation for a newly invited auth identity until its owner signs in.
-- The invitee creates their own profile through the authenticated client after redeeming the invite.
create or replace function public.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'group_invitation_id', '') <> '' then
    return new;
  end if;

  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Return pending invite details through a narrow, invitee-scoped RPC. Invitees are not
-- group members yet, so direct reads of groups and inviter profiles are intentionally denied.
create or replace function public.get_my_pending_group_invitations()
returns table (
  id uuid,
  group_id uuid,
  invited_email text,
  status text,
  expires_at timestamptz,
  group_name text,
  invited_by_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select invitation.id, invitation.group_id, invitation.invited_email,
    invitation.status, invitation.expires_at,
    coalesce(group_row.name, 'Group'), coalesce(profile.display_name, 'A group member')
  from public.group_invitations invitation
  join public.groups group_row on group_row.id = invitation.group_id
  left join public.profiles profile on profile.id = invitation.invited_by
  where (select auth.uid()) is not null
    and lower(invitation.invited_email) = lower((select auth.jwt() ->> 'email'))
    and invitation.status = 'pending'
    and invitation.expires_at > now()
$$;

revoke all on function public.get_my_pending_group_invitations() from public;
grant execute on function public.get_my_pending_group_invitations() to authenticated;
