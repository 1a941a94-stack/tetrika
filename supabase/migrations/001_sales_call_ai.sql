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


create table if not exists public.call_insights (
  id bigserial primary key,
  call_id uuid not null references public.calls(id) on delete cascade,
  insight_type text not null check (insight_type in ('praise','issue','pain','objection','objection_handled','objection_unhandled','product_link','goal','decision')),
  label text not null,
  detail text not null,
  speaker text,
  start_seconds numeric(10,3),
  end_seconds numeric(10,3),
  related_start_seconds numeric(10,3),
  related_end_seconds numeric(10,3),
  severity smallint not null default 1 check (severity between 1 and 3),
  tags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists call_insights_call_idx on public.call_insights(call_id, start_seconds);
create index if not exists call_insights_type_idx on public.call_insights(insight_type);
alter table public.call_insights enable row level security;
grant select on public.call_insights to authenticated;
create policy "call_insights_read_own_call" on public.call_insights for select to authenticated
using (exists(select 1 from public.calls c where c.id = call_insights.call_id and c.user_id = (select auth.uid())));


create table if not exists public.managers (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists managers_owner_idx on public.managers(owner_user_id, is_active, name);
alter table public.managers enable row level security;
grant select, insert, update, delete on public.managers to authenticated;
create policy "managers_select_own" on public.managers for select to authenticated using ((select auth.uid()) = owner_user_id);
create policy "managers_insert_own" on public.managers for insert to authenticated with check ((select auth.uid()) = owner_user_id);
create policy "managers_update_own" on public.managers for update to authenticated using ((select auth.uid()) = owner_user_id) with check ((select auth.uid()) = owner_user_id);
create policy "managers_delete_own" on public.managers for delete to authenticated using ((select auth.uid()) = owner_user_id);

alter table public.calls add column if not exists manager_id uuid references public.managers(id) on delete set null;
create index if not exists calls_manager_created_idx on public.calls(manager_id, created_at desc);


create table if not exists public.sales_departments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.sales_groups (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.sales_departments(id) on delete cascade,
  name text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('rop','rg')),
  department_id uuid not null references public.sales_departments(id) on delete cascade,
  group_id uuid references public.sales_groups(id) on delete cascade,
  created_at timestamptz not null default now(),
  check ((role='rop' and group_id is null) or (role='rg' and group_id is not null))
);

alter table public.managers add column if not exists department_id uuid references public.sales_departments(id) on delete set null;
alter table public.managers add column if not exists group_id uuid references public.sales_groups(id) on delete set null;

alter table public.calls add column if not exists department_id uuid references public.sales_departments(id) on delete set null;
alter table public.calls add column if not exists group_id uuid references public.sales_groups(id) on delete set null;
alter table public.calls add column if not exists sale_outcome text not null default 'unknown'
  check (sale_outcome in ('won','lost','pending','unknown'));
alter table public.calls add column if not exists sale_value numeric(12,2);
alter table public.calls add column if not exists outcome_source text not null default 'manual'
  check (outcome_source in ('manual','ai','import'));

create index if not exists sales_groups_department_idx on public.sales_groups(department_id);
create index if not exists user_roles_department_idx on public.user_roles(department_id, role);
create index if not exists user_roles_group_idx on public.user_roles(group_id) where group_id is not null;
create index if not exists managers_group_idx on public.managers(group_id, is_active, name);
create index if not exists calls_group_created_idx on public.calls(group_id, created_at desc);
create index if not exists calls_department_created_idx on public.calls(department_id, created_at desc);
create index if not exists calls_outcome_idx on public.calls(sale_outcome);

alter table public.sales_departments enable row level security;
alter table public.sales_groups enable row level security;
alter table public.user_roles enable row level security;

grant select, insert, update, delete on public.sales_departments to authenticated;
grant select, insert, update, delete on public.sales_groups to authenticated;
grant select on public.user_roles to authenticated;

create policy "roles_read_self" on public.user_roles for select to authenticated
using (user_id=(select auth.uid()));

create policy "departments_read_scope" on public.sales_departments for select to authenticated
using (exists(select 1 from public.user_roles ur where ur.user_id=(select auth.uid()) and ur.department_id=sales_departments.id));

create policy "groups_read_scope" on public.sales_groups for select to authenticated
using (exists(select 1 from public.user_roles ur where ur.user_id=(select auth.uid()) and ur.department_id=sales_groups.department_id and (ur.role='rop' or ur.group_id=sales_groups.id)));


-- Hierarchical read scope for call child data
drop policy if exists "segments_read_own_call" on public.transcript_segments;
drop policy if exists "analysis_steps_read_own_call" on public.analysis_step_results;
drop policy if exists "analysis_runs_read_own_call" on public.analysis_runs;
drop policy if exists "call_insights_read_own_call" on public.call_insights;
