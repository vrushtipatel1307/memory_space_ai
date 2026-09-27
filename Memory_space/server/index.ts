import cors from 'cors'
import express from 'express'
import { createClient } from '@supabase/supabase-js'
import { answerMemoryQuestion, organizeMemory, transcribeVoice } from './ai.js'

const app = express()
const port = Number(process.env.PORT ?? 8787)
app.use(cors())
app.use(express.json({ limit: '12mb' }))

app.get('/api/health', (_request, response) => response.json({ ok: true, aiConfigured: Boolean(process.env.GEMINI_API_KEY) }))

app.post('/api/organize-memory', async (request, response) => {
  try { response.json(await organizeMemory(request.body)) }
  catch (error) { response.status(503).json({ error: error instanceof Error ? error.message : 'Memory organizer unavailable.' }) }
})

app.post('/api/transcribe-voice', async (request, response) => {
  try { response.json({ transcript: await transcribeVoice(request.body.audioBase64, request.body.filename) }) }
  catch (error) { response.status(503).json({ error: error instanceof Error ? error.message : 'Voice transcription unavailable.' }) }
})

app.post('/api/ask-memory', async (request, response) => {
  try {
    const token = request.header('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
    const url = process.env.VITE_SUPABASE_URL
    const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
    if (!token || !url || !anonKey) return response.status(401).json({ error: 'Sign in to ask about your memories.' })
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: { user }, error: authError } = await userClient.auth.getUser(token)
    if (authError || !user) return response.status(401).json({ error: 'Your session could not be verified.' })
    const question = String(request.body?.question ?? '').trim().slice(0, 1000)
    if (!question) return response.status(400).json({ error: 'Enter a question about your memories.' })
    const { data: rows, error: memoryError } = await userClient
      .from('memories')
      .select('id,title,year,location,story,people,ai')
      .order('created_at', { ascending: false })
      .limit(500)
    if (memoryError) throw memoryError
    const questionTerms = [...new Set(question.toLowerCase().match(/[a-z0-9']{3,}/g) ?? [])]
    const memories = (rows ?? []).map((memory) => {
      const searchable = `${memory.title} ${memory.year} ${memory.location} ${memory.story} ${JSON.stringify(memory.people ?? [])} ${JSON.stringify(memory.ai ?? {})}`.toLowerCase()
      const relevance = questionTerms.reduce((score, term) => score + Number(searchable.includes(term)), 0)
      return { memory, relevance }
    }).sort((left, right) => right.relevance - left.relevance).slice(0, 30).map(({ memory }) => ({
      id: memory.id,
      title: memory.title,
      year: memory.year,
      location: memory.location,
      story: String(memory.story ?? '').slice(0, 8000),
      people: Array.isArray(memory.people) ? memory.people.slice(0, 40) : [],
      ai: memory.ai,
    }))
    if (!memories.length) return response.json({ answer: 'I couldn\'t find a saved memory with that information.', sources: [], memories: [] })
    const answer = await answerMemoryQuestion(question, undefined, memories)
    response.json({ ...answer, memories })
  } catch (error) {
    response.status(503).json({ error: error instanceof Error ? error.message : 'Memory questions unavailable.' })
  }
})

app.delete('/api/account', async (request, response) => {
  const authorization = request.header('Authorization')
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  const url = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!token || !url || !anonKey || !serviceKey) {
    return response.status(503).json({ error: 'Account deletion is not configured on the server.' })
  }
  try {
    const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: { user }, error: authError } = await authClient.auth.getUser(token)
    if (authError || !user || request.body?.userId !== user.id) return response.status(401).json({ error: 'Your session could not be verified.' })

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const [memories, people, groups, profile] = await Promise.all([
      admin.from('memories').select('image_path,voice_path').eq('user_id', user.id),
      admin.from('people').select('profile_image_url').eq('created_by', user.id),
      admin.from('groups').select('id,image_url').eq('created_by', user.id),
      admin.from('profiles').select('profile_image_url').eq('id', user.id).maybeSingle(),
    ])
    for (const result of [memories, people, groups, profile]) if (result.error) throw result.error
    const removals: Array<[string, string[]]> = [
      ['memory-photos', (memories.data ?? []).map((item) => item.image_path).filter(Boolean)],
      ['memory-audio', (memories.data ?? []).map((item) => item.voice_path).filter(Boolean)],
      ['people-photos', (people.data ?? []).map((item) => item.profile_image_url).filter(Boolean)],
      ['profile-photos', profile.data?.profile_image_url ? [profile.data.profile_image_url] : []],
      ['group-images', (groups.data ?? []).map((item) => item.image_url).filter(Boolean)],
    ]
    for (const [bucket, paths] of removals) {
      if (!paths.length) continue
      const { error } = await admin.storage.from(bucket).remove(paths)
      if (error) throw error
    }
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
    if (deleteError) throw deleteError
    response.json({ ok: true })
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unable to delete your account.' })
  }
})

app.listen(port, () => console.log(`MemorySpace AI server listening on http://localhost:${port}`))
