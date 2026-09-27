import { GoogleGenAI } from '@google/genai'

const model = process.env.GEMINI_MODEL ?? 'gemini-3.8-flash'
const fallbackModel = process.env.GEMINI_FALLBACK_MODEL ?? 'gemini-3.7-flash'
const transcriptionModel = process.env.GEMINI_TRANSCRIBE_MODEL ?? 'gemini-3.5-transcribe'

export type MemoryInput = {
  title?: string
  year?: string
  location?: string
  description?: string
  transcript?: string
  people?: string[]
  imageDataUrl?: string
}

export type StructuredMemory = {
  title: string
  summary: string
  date: { value: string; certainty: 'known' | 'possible' | 'unknown'; source: string }
  location: { value: string; certainty: 'known' | 'possible' | 'unknown'; source: string }
  people: Array<{ name: string; certainty: 'known' | 'possible'; source: string }>
  events: string[]
  sources: string[]
  uncertainties: string[]
  mood: string[]
  tags: string[]
  objects: string[]
  keywords: string[]
}

function client() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured on the server.')
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
}

function isTemporaryModelError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { status?: number; code?: number | string; message?: string }
  return candidate.status === 503 || candidate.status === 429 || candidate.code === 503 || candidate.code === 429
    || /high demand|temporarily unavailable|service unavailable|resource_exhausted/i.test(candidate.message ?? '')
}

async function generateWithFallback(contents: string, systemInstruction: string) {
  const ai = client()
  const request = (modelName: string) => ai.models.generateContent({
    model: modelName,
    contents,
    config: { temperature: 0, systemInstruction, responseMimeType: 'application/json' },
  })
  try {
    return await request(model)
  } catch (error) {
    if (!isTemporaryModelError(error) || fallbackModel === model) throw error
    console.warn(`[AI] ${model} is temporarily unavailable; retrying with ${fallbackModel}.`)
    return request(fallbackModel)
  }
}

const organizerRules = `You organize only family-provided information. Never invent a date, person, place, event, or detail. Every date, location, and person must be marked known or possible and include the exact source label. Use "Year unknown" or "Location unknown" when absent. Return JSON only.`

function parseJson<T>(text: string | undefined, fallback: T): T {
  if (!text) return fallback
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  return JSON.parse(cleaned) as T
}

export async function organizeMemory(input: MemoryInput): Promise<StructuredMemory> {
  const response = await generateWithFallback(
    JSON.stringify({ title: input.title, year: input.year, location: input.location, description: input.description, transcript: input.transcript, people: input.people }),
    `${organizerRules} Return this shape: { title, summary, date: { value, certainty, source }, location: { value, certainty, source }, people: [{ name, certainty, source }], events: [], mood: [], tags: [], objects: [], keywords: [], sources: [], uncertainties: [] }.`,
  )
  return parseJson<StructuredMemory>(response.text, {
    title: input.title ?? '', summary: '', date: { value: input.year ?? 'Year unknown', certainty: 'unknown', source: 'Not provided' },
    location: { value: input.location ?? 'Location unknown', certainty: 'unknown', source: 'Not provided' },
    people: [], events: [], sources: [], uncertainties: [], mood: [], tags: [], objects: [], keywords: [],
  })
}

export async function transcribeVoice(audioBase64: string, _filename = 'memory.webm') {
  const response = await client().models.generateContent({
    model: transcriptionModel,
    contents: [{ inlineData: { mimeType: 'audio/webm', data: audioBase64 } }],
    config: { temperature: 0, audioTranscriptionConfig: { languageCodes: [] } },
  })
  return response.text?.trim() ?? ''
}

export async function answerMemoryQuestion(question: string, memory: MemoryInput | undefined, familyMemories: unknown[]) {
  const fallback = { answer: 'I don\'t have enough information from your family\'s memories to answer that.', sources: [] as string[] }
  const response = await generateWithFallback(
    JSON.stringify({ question, memory, familyMemories }),
    'Answer only from the supplied family memories. Never guess or add outside knowledge. If the answer is not supported, say exactly: I don\'t have enough information from your family\'s memories to answer that. Return JSON with answer and sources arrays.',
  )
  return parseJson<{ answer: string; sources: string[] }>(response.text, fallback)
}
