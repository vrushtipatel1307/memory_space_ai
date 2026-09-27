import { supabase } from './client'

export type AccountProfile = {
  id: string
  display_name: string
  username: string | null
  bio: string
  birthday: string | null
  location: string | null
  profile_image_url: string | null
  profile_visibility: 'private' | 'groups' | 'public'
  imageUrl?: string
}

function client() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

export async function loadAccountProfile(user: { id: string; email?: string; user_metadata?: Record<string, unknown> }): Promise<AccountProfile> {
  const db = client()
  const fallbackName = String(user.user_metadata?.name ?? user.email ?? '').trim()
  let { data, error } = await db.from('profiles').select('id,display_name,username,bio,birthday,location,profile_image_url,profile_visibility').eq('id', user.id).maybeSingle()
  if (error) throw error
  if (!data) {
    const inserted = await db.from('profiles').insert({ id: user.id, display_name: fallbackName, bio: '', profile_visibility: 'private' })
      .select('id,display_name,username,bio,birthday,location,profile_image_url,profile_visibility').single()
    if (inserted.error) throw inserted.error
    data = inserted.data
  }
  const profile = data as AccountProfile
  if (!profile.profile_image_url) return profile
  const { data: signed, error: imageError } = await db.storage.from('profile-photos').createSignedUrl(profile.profile_image_url, 3600)
  if (imageError) throw imageError
  return { ...profile, imageUrl: signed.signedUrl }
}

export async function saveAccountProfile(userId: string, values: Pick<AccountProfile, 'display_name' | 'username' | 'bio' | 'birthday' | 'location' | 'profile_visibility'>, image?: File, removeImage = false) {
  const db = client()
  if (image && (!['image/jpeg', 'image/png', 'image/webp'].includes(image.type) || image.size > 5 * 1024 * 1024)) {
    throw new Error('Choose a JPG, PNG, or WebP image under 5 MB.')
  }
  const { data: current, error: currentError } = await db.from('profiles').select('profile_image_url').eq('id', userId).single()
  if (currentError) throw currentError
  const previousPath = current.profile_image_url as string | null
  let nextPath: string | null | undefined
  if (image) {
    const extension = image.type === 'image/jpeg' ? 'jpg' : image.type.split('/')[1]
    nextPath = `${userId}/${crypto.randomUUID()}.${extension}`
    const { error } = await db.storage.from('profile-photos').upload(nextPath, image, { contentType: image.type, upsert: false })
    if (error) throw new Error('Unable to upload your profile picture.')
  } else if (removeImage) nextPath = null

  const username = values.username?.trim().replace(/^@/, '').toLowerCase() || null
  const { error } = await db.from('profiles').update({
    display_name: values.display_name.trim(), username, bio: values.bio.trim(), birthday: values.birthday || null,
    location: values.location?.trim() || null, profile_visibility: values.profile_visibility,
    ...(nextPath !== undefined ? { profile_image_url: nextPath } : {}), updated_at: new Date().toISOString(),
  }).eq('id', userId)
  if (error) {
    if (typeof nextPath === 'string') await db.storage.from('profile-photos').remove([nextPath])
    if (error.code === '23505') throw new Error('This username is already in use.')
    throw new Error('Unable to update your profile. Please try again.')
  }
  if (previousPath && nextPath !== undefined && previousPath !== nextPath) {
    const { error: removeError } = await db.storage.from('profile-photos').remove([previousPath])
    if (removeError) console.warn('[Profile] Previous profile photo could not be removed.', removeError.message)
  }
}

export async function removeAccount(userId: string) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error || !session?.access_token) throw new Error('Your session expired. Sign in again before deleting your account.')
  const response = await fetch('/api/account', { method: 'DELETE', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? 'Unable to delete your account.')
  await supabase.auth.signOut({ scope: 'local' })
}
