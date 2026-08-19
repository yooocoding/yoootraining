# yoootraining

Personal training & check-in tracker. Next.js (App Router) + Supabase, deployed on Vercel.
Single-user v1 — no auth.

## Setup

1. **Env vars**

   ```bash
   cp .env.local.example .env.local
   ```

   Fill in the three values from Supabase Dashboard → Project Settings → API Keys.
   `SUPABASE_SECRET_KEY` is server-only — never import it into a `'use client'` file.

2. **Database**

   Open the Supabase SQL editor and run [supabase/schema.sql](supabase/schema.sql) as-is.
   It creates the three tables and enables RLS with no policies (deny-all for anon);
   the API routes use the secret key, which bypasses RLS.

3. **Run**

   ```bash
   npm install
   npm run dev
   ```

   → http://localhost:3000

## Structure

| Path | What |
| --- | --- |
| [app/page.tsx](app/page.tsx) | `/` — today's check-in (morning form, AI plan, evening form) |
| [app/calendar/page.tsx](app/calendar/page.tsx) | `/calendar` — history list |
| [app/goals/page.tsx](app/goals/page.tsx) | `/goals` — sprint + phase settings |
| [app/videos/page.tsx](app/videos/page.tsx) | `/videos` — video library CRUD |
| [lib/supabase.ts](lib/supabase.ts) | browser + server Supabase clients |
| [lib/types.ts](lib/types.ts) | domain types & the hand-written `Database` type |
| [lib/ai.ts](lib/ai.ts) | **stub** — Claude API goes here next |

API routes live under [app/api/](app/api/): `daily-logs`, `goals`, `goals/[id]`,
`videos`, `videos/[id]`, `ai-plan`.

## Next step

Wire up the Claude API in `generateDailyPlan()` in [lib/ai.ts](lib/ai.ts). It already
receives today's log, the active sprint, the video library, and the last 7 days;
`POST /api/ai-plan` saves the result onto that day's `daily_logs` row.
