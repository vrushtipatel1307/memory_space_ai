import { supabase } from './client'

export type PersonProfile = {
  id: string
  created_by: string
  name: string
  relationship: string | null
  description: string | null
  birthday: string | null
  profile_image_url: string | null
  notes: string | null
  imageUrl?: string
}

export type CommunityGroup = {
  id: string
  created_by: string
  name: string
  description: string | null
  image_url: string | null
  group_type: string | null
  role: 'owner' | 'admin' | 'member'
  created_at: string
  imageUrl?: string
}

export type GroupMember = { group_id: string; user_id: string; role: 'owner' | 'admin' | 'member'; display_name: string; username?: string | null; imageUrl?: string }
export type GroupInvitation = { id: string; group_id: string; invited_email: string; status: string; expires_at: string; group_name?: string; invited_by_name?: string }

function client() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

export async function loadPeople(userId: string): Promise<PersonProfile[]> {
  const db = client()
  const { data, error } = await db.from('people').select('*').eq('created_by', userId).order('name')
  if (error) throw error
  return Promise.all((data ?? []).map(async (person) => {
    if (!person.profile_image_url) return person as PersonProfile
    const { data: signed, error: imageError } = await db.storage.from('people-photos').createSignedUrl(person.profile_image_url, 3600)
    if (imageError) throw imageError
    return { ...person, imageUrl: signed.signedUrl } as PersonProfile
  }))
}

export async function loadGroups(userId: string): Promise<CommunityGroup[]> {
  const db = client()
  const { data: memberships, error: memberError } = await db.from('group_members').select('group_id,role').eq('user_id', userId)
  if (memberError) throw memberError
  if (!memberships?.length) return []
  const { data, error } = await db.from('groups').select('*').in('id', memberships.map((item) => item.group_id)).order('created_at', { ascending: false })
  if (error) throw error
  const roleByGroup = new Map(memberships.map((item) => [item.group_id, item.role as CommunityGroup['role']]))
  return Promise.all((data ?? []).map(async (group) => {
    const role = roleByGroup.get(group.id) ?? 'member'
    if (!group.image_url) return { ...group, role }
    const { data: signed, error: imageError } = await db.storage.from('group-images').createSignedUrl(group.image_url, 3600)
    if (imageError) throw imageError
    return { ...group, role, imageUrl: signed.signedUrl }
  }))
}

export async function loadGroupMembers(groupId: string): Promise<GroupMember[]> {
  const db = client()
  const { data, error } = await db.from('group_members').select('group_id,user_id,role').eq('group_id', groupId).order('joined_at')
  if (error) throw error
  if (!data?.length) return []
  const { data: profileData, error: profileError } = await db.rpc('get_group_member_profiles', { target_group: groupId })
  if (profileError) throw profileError
  const profiles = (profileData ?? []) as Array<{ user_id: string; display_name: string | null; username: string | null; profile_image_url: string | null }>
  const profileById = new Map<string, (typeof profiles)[number]>(profiles.map((profile) => [profile.user_id, profile]))
  return Promise.all(data.map(async (member) => {
    const profile = profileById.get(member.user_id)
    let imageUrl: string | undefined
    if (profile?.profile_image_url) {
      const { data: signed, error: imageError } = await db.storage.from('profile-photos').createSignedUrl(profile.profile_image_url, 3600)
      if (imageError) throw imageError
      imageUrl = signed.signedUrl
    }
    return { ...member, role: member.role as GroupMember['role'], display_name: profile?.display_name || 'Group member', username: profile?.username, imageUrl }
  }))
}

export async function loadGroupMemberCount(groupId: string): Promise<number> {
  const { count, error } = await client().from('group_members').select('user_id', { count: 'exact', head: true }).eq('group_id', groupId)
  if (error) throw error
  return count ?? 0
}

export async function loadInvitations(): Promise<GroupInvitation[]> {
  const { data, error } = await client().rpc('get_my_pending_group_invitations')
  if (error) throw error
  return (data ?? []) as GroupInvitation[]
}

export async function loadGroupInvitations(groupId: string): Promise<GroupInvitation[]> {
  const { data, error } = await client().from('group_invitations').select('id,group_id,invited_email,status,expires_at').eq('group_id', groupId).eq('status', 'pending').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function cancelGroupInvitation(invitationId: string) {
  const { error } = await client().from('group_invitations').delete().eq('id', invitationId)
  if (error) throw error
}

export async function createPerson(input: Omit<PersonProfile, 'id' | 'created_by' | 'profile_image_url' | 'imageUrl'> & { image?: File }, userId: string) {
  const db = client()
  const id = crypto.randomUUID()
  let imagePath: string | null = null
  if (input.image) {
    const ext = input.image.name.split('.').pop()?.toLowerCase() || 'jpg'
    imagePath = `${userId}/${id}/${crypto.randomUUID()}.${ext}`
    const { error } = await db.storage.from('people-photos').upload(imagePath, input.image, { contentType: input.image.type, upsert: false })
    if (error) throw error
  }
  const { error } = await db.from('people').insert({ id, created_by: userId, name: input.name.trim(), relationship: input.relationship, description: input.description, birthday: input.birthday || null, notes: input.notes, profile_image_url: imagePath })
  if (error) {
    if (imagePath) await db.storage.from('people-photos').remove([imagePath])
    throw error
  }
}

export async function updatePerson(id: string, patch: Partial<Pick<PersonProfile, 'name' | 'relationship' | 'description' | 'birthday' | 'notes'>>, image: File | undefined, userId: string) {
  const db = client()
  let imagePath: string | undefined
  if (image) {
    const ext = image.name.split('.').pop()?.toLowerCase() || 'jpg'
    imagePath = `${userId}/${id}/${crypto.randomUUID()}.${ext}`
    const { error } = await db.storage.from('people-photos').upload(imagePath, image, { contentType: image.type, upsert: false })
    if (error) throw error
  }
  const { error } = await db.from('people').update({ ...patch, ...(imagePath ? { profile_image_url: imagePath } : {}), updated_at: new Date().toISOString() }).eq('id', id).eq('created_by', userId)
  if (error) {
    if (imagePath) await db.storage.from('people-photos').remove([imagePath])
    throw error
  }
}

export async function deletePerson(person: PersonProfile, userId: string) {
  const db = client()
  const { error } = await db.from('people').delete().eq('id', person.id).eq('created_by', userId)
  if (error) throw error
  if (person.profile_image_url) await db.storage.from('people-photos').remove([person.profile_image_url])
}

export async function createGroup(input: { name: string; description: string; group_type: string; image?: File }, userId: string) {
  const db = client()
  const id = crypto.randomUUID()
  let imagePath: string | null = null
  if (input.image) {
    const ext = input.image.name.split('.').pop()?.toLowerCase() || 'jpg'
    imagePath = `${id}/${crypto.randomUUID()}.${ext}`
    const { error } = await db.storage.from('group-images').upload(imagePath, input.image, { contentType: input.image.type, upsert: false })
    if (error) throw error
  }
  const { error } = await db.from('groups').insert({ id, created_by: userId, name: input.name.trim(), description: input.description || null, group_type: input.group_type || null, image_url: imagePath })
  if (error) {
    if (imagePath) await db.storage.from('group-images').remove([imagePath])
    throw error
  }
}

export async function inviteToGroup(groupId: string, email: string, inviterId: string) {
  const normalized = email.trim().toLowerCase()
  if (!normalized) throw new Error('Enter an email address.')
  void inviterId
  const { data, error } = await client().functions.invoke('send-group-invitation', { body: { group_id: groupId, invited_email: normalized } })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data as { delivery: 'invite_email' | 'sign_in_email' }
}

export async function acceptInvitation(invitationId: string) {
  const { data, error } = await client().rpc('accept_group_invitation', { invitation_id: invitationId })
  if (error) throw error
  return data as string
}

export async function declineInvitation(invitationId: string) {
  const { error } = await client().rpc('decline_group_invitation', { invitation_id: invitationId })
  if (error) throw error
}

export async function removeGroupMember(groupId: string, userId: string) {
  const { error } = await client().from('group_members').delete().eq('group_id', groupId).eq('user_id', userId)
  if (error) throw error
}

export async function updateGroup(groupId: string, patch: { name: string; description: string; group_type: string }, image?: File, oldImagePath?: string | null) {
  const db = client()
  let imagePath: string | undefined
  if (image) {
    const ext = image.name.split('.').pop()?.toLowerCase() || 'jpg'
    imagePath = `${groupId}/${crypto.randomUUID()}.${ext}`
    const { error } = await db.storage.from('group-images').upload(imagePath, image, { contentType: image.type, upsert: false })
    if (error) throw error
  }
  const { error } = await db.from('groups').update({ name: patch.name.trim(), description: patch.description || null, group_type: patch.group_type || null, ...(imagePath ? { image_url: imagePath } : {}), updated_at: new Date().toISOString() }).eq('id', groupId)
  if (error) {
    if (imagePath) await db.storage.from('group-images').remove([imagePath])
    throw error
  }
  if (imagePath && oldImagePath) await db.storage.from('group-images').remove([oldImagePath])
}

export async function changeMemberRole(groupId: string, userId: string, role: 'admin' | 'member') {
  const { error } = await client().from('group_members').update({ role }).eq('group_id', groupId).eq('user_id', userId)
  if (error) throw error
}

export async function deleteGroup(groupId: string, imagePath?: string | null) {
  const db = client()
  const { error } = await db.from('groups').delete().eq('id', groupId)
  if (error) throw error
  if (imagePath) await db.storage.from('group-images').remove([imagePath])
}

