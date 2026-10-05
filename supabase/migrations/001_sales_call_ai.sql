-- The production database for this project has already been provisioned in Supabase.
-- This migration is kept in Git so the schema is reproducible.
create extension if not exists pgcrypto;

create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete cascade,
  title text not null,
  manager_name text,
  source_filename text not null,
  storage_path text not null unique,
  mime_type text,
  duration_seconds integer,
  language text default 'ru',
  status text not null default 'uploaded' check (status in ('uploaded','queued','transcribing','transcribed','analyzing','completed','failed')),
  error_message text,
  transcript_text text,
  overall_score numeric(5,2),
  summary text,
  strengths jsonb not null default '[]'::jsonb,
  improvements jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.transcript_segments (
  id bigserial primary key,
  call_id uuid not null references public.calls(id) on delete cascade,
  segment_index integer not null,
  start_seconds numeric(10,3) not null,
  end_seconds numeric(10,3) not null,
  speaker text,
  text text not null,
  confidence numeric(6,5),
  created_at timestamptz not null default now(),
  unique (call_id, segment_index)
);

create table if not exists public.rubric_steps (
  id smallint primary key,
  code text not null unique,
  title text not null,
  weight numeric(6,3) not null default 1,
  description text not null
);

create table if not exists public.analysis_step_results (
  id bigserial primary key,
  call_id uuid not null references public.calls(id) on delete cascade,
  step_id smallint not null references public.rubric_steps(id),
  status text not null check (status in ('passed','partial','failed','not_applicable')),
  score numeric(5,2) not null check (score >= 0 and score <= 100),
  comment text not null,
  evidence jsonb not null default '[]'::jsonb,
  recommendation text,
  created_at timestamptz not null default now(),
  unique(call_id, step_id)
);

create table if not exists public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.calls(id) on delete cascade,
  created_at timestamptz not null default now(),
  model text,
  prompt_version text not null default 'sales-rubric-v1',
  raw_response jsonb,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(12,6),
  status text not null default 'completed' check (status in ('completed','failed')),
  error_message text
);

alter table public.calls enable row level security;
alter table public.transcript_segments enable row level security;
alter table public.rubric_steps enable row level security;
alter table public.analysis_step_results enable row level security;
alter table public.analysis_runs enable row level security;

create policy "calls_select_own" on public.calls for select to authenticated using ((select auth.uid()) = user_id);
create policy "calls_insert_own" on public.calls for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "calls_update_own" on public.calls for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "calls_delete_own" on public.calls for delete to authenticated using ((select auth.uid()) = user_id);
create policy "rubric_read_authenticated" on public.rubric_steps for select to authenticated using (true);
create policy "segments_read_own_call" on public.transcript_segments for select to authenticated using (exists(select 1 from public.calls c where c.id = transcript_segments.call_id and c.user_id = (select auth.uid())));
create policy "analysis_steps_read_own_call" on public.analysis_step_results for select to authenticated using (exists(select 1 from public.calls c where c.id = analysis_step_results.call_id and c.user_id = (select auth.uid())));
create policy "analysis_runs_read_own_call" on public.analysis_runs for select to authenticated using (exists(select 1 from public.calls c where c.id = analysis_runs.call_id and c.user_id = (select auth.uid())));

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('sales-audio','sales-audio',false,1073741824,array['audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/x-wav','audio/webm','video/webm','video/mp4','application/octet-stream'])
on conflict (id) do nothing;

create policy "audio_insert_own" on storage.objects for insert to authenticated with check (bucket_id='sales-audio' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "audio_select_own" on storage.objects for select to authenticated using (bucket_id='sales-audio' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "audio_delete_own" on storage.objects for delete to authenticated using (bucket_id='sales-audio' and (storage.foldername(name))[1]=(select auth.uid())::text);

create index if not exists analysis_runs_call_idx on public.analysis_runs(call_id);
create index if not exists analysis_step_results_step_idx on public.analysis_step_results(step_id);
