import type { User } from '@supabase/supabase-js'
import type { Memory } from '../../App'
import { supabase } from './client'

export type MemoryRecord = {
  id: string
  user_id: string
  title: string
  year: string
  location: string
  story: string
  people: string[]
  image_path: string
  voice_path: string | null
  voice: { title: string; duration: string; transcript?: string } | null
  transcript: string | null
  ai: unknown
  created_at: string
  personIds?: string[]
  groupIds?: string[]
}

export async function getProfileName(user: User) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle()
  if (error) throw error
  if (!data) {
    const name = String(user.user_metadata.name ?? user.email ?? 'Your memories')
    const { error: createError } = await supabase.from('profiles').insert({ id: user.id, display_name: name })
    if (createError && createError.code !== '23505') throw createError
    return name
  }
  return data.display_name || user.user_metadata.name || user.email || 'Your memories'
}

export async function loadMemories(userId: string) {
  void userId
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.from('memories').select('*').order('created_at', { ascending: true })
  if (error) throw error
  const rows = data as MemoryRecord[]
  const memoryIds = rows.map((row) => row.id)
  const [peopleResult, peopleRowsResult, groupsResult] = await Promise.all([
    memoryIds.length ? supabase.from('memory_people').select('memory_id,person_id').in('memory_id', memoryIds) : Promise.resolve({ data: [], error: null }),
    supabase.from('people').select('id,name'),
    memoryIds.length ? supabase.from('memory_groups').select('memory_id,group_id').in('memory_id', memoryIds) : Promise.resolve({ data: [], error: null }),
  ])
  if (peopleResult.error) throw peopleResult.error
  if (peopleRowsResult.error) throw peopleRowsResult.error
  if (groupsResult.error) throw groupsResult.error
  const nameByPerson = new Map((peopleRowsResult.data ?? []).map((person) => [person.id, person.name]))
  const peopleByMemory = new Map<string, string[]>()
  for (const link of peopleResult.data ?? []) {
    const name = nameByPerson.get(link.person_id)
    if (name) peopleByMemory.set(link.memory_id, [...(peopleByMemory.get(link.memory_id) ?? []), name])
  }
  const groupsByMemory = new Map<string, string[]>()
  for (const link of groupsResult.data ?? []) groupsByMemory.set(link.memory_id, [...(groupsByMemory.get(link.memory_id) ?? []), link.group_id])
  return Promise.all(rows.map(async (row, index): Promise<Memory> => {
    const { data: signed, error: photoError } = await supabase!.storage.from('memory-photos').createSignedUrl(row.image_path, 3600)
    if (photoError) throw photoError
    const audio = row.voice_path ? await supabase!.storage.from('memory-audio').createSignedUrl(row.voice_path, 3600) : null
    if (audio?.error) throw audio.error
    return {
      id: row.id,
      year: row.year,
      title: row.title,
      location: row.location,
      image: signed.signedUrl,
      imagePath: row.image_path,
      ownerId: row.user_id,
      personIds: (peopleResult.data ?? []).filter((link) => link.memory_id === row.id).map((link) => link.person_id),
      groupIds: groupsByMemory.get(row.id) ?? [],
      people: peopleByMemory.get(row.id) ?? row.people,
      story: row.story,
      position: { left: `${15 + ((index * 31) % 70)}%`, top: `${18 + ((index * 43) % 64)}%` },
      size: (['small', 'medium', 'large'] as const)[index % 3],
      voice: row.voice ? { ...row.voice, audioUrl: audio?.data?.signedUrl } : undefined,
      transcript: row.transcript ?? undefined,
      ai: row.ai as Memory['ai'],
      aiStatus: row.ai ? 'ready' as const : 'idle' as const,
    }
  }))
}

export async function saveMemoryRecord(memory: {
  id: string
  title: string
  year: string
  location: string
  story: string
  people: string[]
  personIds?: string[]
  groupIds?: string[]
  imageFile: File
  voice?: { title: string; duration: string; transcript?: string; audioFile?: File }
  transcript?: string
  ai?: unknown
}, userId: string) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const fileExt = memory.imageFile.name.split('.').pop()?.toLowerCase() || 'jpg'
  const imagePath = `${userId}/${memory.id}/${crypto.randomUUID()}.${fileExt}`
  const { error: uploadError } = await supabase.storage.from('memory-photos').upload(imagePath, memory.imageFile, { contentType: memory.imageFile.type, upsert: false })
  if (uploadError) throw uploadError

  let voicePath: string | null = null
  if (memory.voice?.audioFile) {
    const ext = memory.voice.audioFile.name.split('.').pop()?.toLowerCase() || 'webm'
    voicePath = `${userId}/${memory.id}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from('memory-audio').upload(voicePath, memory.voice.audioFile, { contentType: memory.voice.audioFile.type || 'audio/webm', upsert: false })
    if (error) { await supabase.storage.from('memory-photos').remove([imagePath]); throw error }
  }

  const { error: insertError } = await supabase.from('memories').insert({
    id: memory.id,
    user_id: userId,
    title: memory.title,
    year: memory.year,
    location: memory.location,
    story: memory.story,
    people: memory.people,
    image_path: imagePath,
    voice: memory.voice ? { title: memory.voice.title, duration: memory.voice.duration, transcript: memory.voice.transcript } : null,
    voice_path: voicePath,
    transcript: memory.transcript ?? null,
    ai: memory.ai ?? null,
  })
  if (insertError) {
    await supabase.storage.from('memory-photos').remove([imagePath])
    if (voicePath) await supabase.storage.from('memory-audio').remove([voicePath])
    throw insertError
  }
  try {
    if (memory.personIds?.length) {
      const { error } = await supabase.from('memory_people').insert(memory.personIds.map((person_id) => ({ memory_id: memory.id, person_id })))
      if (error) throw error
    }
    if (memory.groupIds?.length) {
      const { error } = await supabase.from('memory_groups').insert(memory.groupIds.map((group_id) => ({ memory_id: memory.id, group_id })))
      if (error) throw error
    }
  } catch (error) {
    await supabase.from('memories').delete().eq('id', memory.id).eq('user_id', userId)
    await supabase.storage.from('memory-photos').remove([imagePath])
    if (voicePath) await supabase.storage.from('memory-audio').remove([voicePath])
    throw error
  }
  return imagePath
}

export async function updateMemoryRecord(id: string, userId: string, patch: { voice?: unknown; transcript?: string; ai?: unknown; title?: string; year?: string; location?: string; story?: string }) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { error } = await supabase.from('memories').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId)
  if (error) throw error
}

export async function deleteMemoryRecord(id: string, userId: string) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data: row, error: lookupError } = await supabase.from('memories').select('image_path,voice_path').eq('id', id).eq('user_id', userId).single()
  if (lookupError) throw lookupError
  const { error } = await supabase.from('memories').delete().eq('id', id).eq('user_id', userId)
  if (error) throw error
  const photos = row.image_path ? await supabase.storage.from('memory-photos').remove([row.image_path]) : { error: null }
  const audio = row.voice_path ? await supabase.storage.from('memory-audio').remove([row.voice_path]) : { error: null }
  if (photos.error || audio.error) console.warn('[Supabase] A deleted memory file could not be removed from Storage.')
}
