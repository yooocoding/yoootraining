-- yoootraining — v1 schema
-- Run this whole file in the Supabase SQL editor (SQL Editor -> New query -> Run).
-- Single-user v1: no auth. RLS is ON everywhere and NO policies are created,
-- so anon/authenticated clients are denied by default. All reads/writes go
-- through our Next.js API routes using the secret (service role) key, which
-- bypasses RLS.

-- Needed for gen_random_uuid() on older projects; a no-op on new ones.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. daily_logs — one row per calendar day
-- ---------------------------------------------------------------------------
create table if not exists public.daily_logs (
  date             date primary key,
  weight           numeric,
  sleep_hours      numeric,
  energy           int check (energy between 1 and 5),
  training_status  text check (training_status in ('完成', '部分完成', '跳过')),
  felt             int check (felt between 1 and 5),
  water            int,
  morning_note     text,
  evening_note     text,
  ai_training_plan text,
  ai_food_plan     text,
  ai_evening_reflection text,
  is_period        boolean not null default false
);

-- Migration for an existing database (safe to re-run):
-- alter table public.daily_logs add column if not exists ai_evening_reflection text;

-- ---------------------------------------------------------------------------
-- 2. goals — sprint definitions
-- phase_definitions shape, e.g.:
-- [
--   { "name": "Phase 1", "start_date": "2026-08-18", "end_date": "2026-08-31",
--     "goal": "Rebuild base — 3 sessions/week" }
-- ]
-- ---------------------------------------------------------------------------
create table if not exists public.goals (
  id                uuid primary key default gen_random_uuid(),
  sprint_start_date date not null,
  sprint_end_date   date not null,
  phase_definitions jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists goals_sprint_start_date_idx
  on public.goals (sprint_start_date desc);

-- ---------------------------------------------------------------------------
-- 3. video_library
-- ---------------------------------------------------------------------------
create table if not exists public.video_library (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  url              text not null,
  body_part        text not null check (body_part in (
                     'glutes/legs', 'core', 'arms', 'cardio',
                     'back', 'shoulders', 'full_body')),
  difficulty       text not null check (difficulty in ('beginner', 'intermediate')),
  duration_minutes int  not null,
  notes            text
);

create index if not exists video_library_body_part_idx
  on public.video_library (body_part);

-- ---------------------------------------------------------------------------
-- RLS: enabled, no policies -> deny-all for anon & authenticated.
-- ---------------------------------------------------------------------------
alter table public.daily_logs    enable row level security;
alter table public.goals         enable row level security;
alter table public.video_library enable row level security;

-- ---------------------------------------------------------------------------
-- Privileges.
--
-- Two independent gates guard every table: GRANTs and RLS. GRANTs are checked
-- FIRST, and service_role's BYPASSRLS attribute only exempts it from the second
-- one. So the secret key still needs explicit table privileges — without them
-- the API routes get 42501 "permission denied for table", never reaching RLS.
--
-- Tables created here do not reliably inherit Supabase's default privileges
-- (those are bound to the role that created them), so grant explicitly.
-- ---------------------------------------------------------------------------
grant usage on schema public to service_role;

grant select, insert, update, delete
  on public.daily_logs, public.goals, public.video_library
  to service_role;

-- Belt and braces: anon/authenticated are denied at BOTH gates — no grants,
-- and no RLS policy. Either alone would be enough.
revoke all on public.daily_logs, public.goals, public.video_library
  from anon, authenticated;

-- Future tables created in this schema by this role get the same treatment.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

-- ---------------------------------------------------------------------------
-- Verify: expect service_role with 4 privileges on each table, nothing else.
-- ---------------------------------------------------------------------------
-- select grantee, table_name,
--        string_agg(privilege_type, ', ' order by privilege_type) as privileges
-- from information_schema.role_table_grants
-- where table_schema = 'public'
--   and table_name in ('daily_logs', 'goals', 'video_library')
--   and grantee in ('anon', 'authenticated', 'service_role', 'postgres')
-- group by grantee, table_name
-- order by table_name, grantee;
