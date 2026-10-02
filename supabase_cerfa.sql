-- À exécuter après supabase_dossiers.sql : remplissage automatique des Cerfa (PDF officiels fournis par vous).
alter table public.deals
  add column if not exists plate text, add column if not exists vin text,
  add column if not exists first_reg_date date, add column if not exists mileage integer,
  add column if not exists client_birth_date date, add column if not exists client_birth_place text,
  add column if not exists client_zip text, add column if not exists client_city text;

create table if not exists public.cerfa_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  storage_path text not null,
  mapping jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.cerfa_templates enable row level security;
drop policy if exists "staff manage cerfa" on public.cerfa_templates;
create policy "staff manage cerfa" on public.cerfa_templates for all to authenticated using (public.is_staff()) with check (public.is_staff());

insert into storage.buckets (id, name, public) values ('cerfa-templates','cerfa-templates', false) on conflict (id) do nothing;
drop policy if exists "staff manage cerfa files" on storage.objects;
create policy "staff manage cerfa files" on storage.objects for all to authenticated
using (bucket_id = 'cerfa-templates' and public.is_staff()) with check (bucket_id = 'cerfa-templates' and public.is_staff());
