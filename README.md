# MemorySpace

MemorySpace is a shared home for the moments, stories, and people that make up a life. Save memories in one visual space, and revisit them anytime — alone or with the people who matter to you.

## Features

- **Build a visual memory space** — Browse saved moments in an immersive, interactive timeline.
- **Save the full story** — Add photos, dates, places, people, written stories, and voice recordings.
- **Organize with AI** — Turn family-provided details and voice transcripts into searchable summaries and context. The AI is instructed never to invent missing details.
- **Ask about your memories** — Ask natural-language questions and get answers grounded in your saved memories, with sources.
- **Share with people and groups** — Connect with others and share memories with selected groups.
- **Manage your account and privacy** — Edit your profile, manage your memories, and control who can see what.

## Why it matters

Photos can outlast the stories that explain them. A face in an old picture, a place, a date — the details fade even when the image doesn't. MemorySpace helps preserve the context behind important moments: who was there, what happened, why it mattered — making personal and family history easier to hold onto and pass down.

That matters for everyday family life, but it can matter even more for families navigating memory loss. A well-organized, easy-to-browse space of photos, names, and stories can be a genuinely useful tool for people living with dementia or Alzheimer's, and for the families supporting them, a calm way to revisit familiar faces and moments together. MemorySpace isn't a medical or therapeutic product and doesn't claim to treat or manage any condition, but that supportive, human use case is very much part of why it's worth building well.

## Tech stack

React, TypeScript, Vite, Supabase, and Google Gemini.

## Run locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Add the required configuration to `.env.local` (see below).
3. Start the app:
   ```bash
   npm run dev
   ```

The app uses **Supabase** for accounts and data, and **Google Gemini** for memory organization, voice transcription, and answering questions about memories.

### Environment variables

Create a `.env.local` file with:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
GEMINI_API_KEY=
```

> `VITE_SUPABASE_ANON_KEY` can be used in place of `VITE_SUPABASE_PUBLISHABLE_KEY`.

Database setup and sharing policies are documented in [`supabase/`](./supabase).