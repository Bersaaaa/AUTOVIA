-- À exécuter après supabase_bureau.sql : paramètres d'identité, mails client, agenda, demande d'avis.
-- 1) Paramètres de l'agence (lisibles par tous : mentions légales, coordonnées ; modifiables par l'agence)
create table if not exists public.agency_settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.agency_settings enable row level security;
drop policy if exists "settings read" on public.agency_settings;
create policy "settings read" on public.agency_settings for select to anon, authenticated using (true);
drop policy if exists "settings staff write" on public.agency_settings;
create policy "settings staff write" on public.agency_settings for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- 2) Historique des e-mails envoyés au client depuis un dossier
create table if not exists public.deal_mails (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references public.deals(id) on delete cascade,
  kind text not null default 'custom',
  to_email text not null,
  subject text not null,
  body text,
  sent_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
alter table public.deal_mails enable row level security;
drop policy if exists "staff manage deal_mails" on public.deal_mails;
create policy "staff manage deal_mails" on public.deal_mails for all to authenticated using (public.is_staff()) with check (public.is_staff());

alter table public.deals add column if not exists review_requested_at timestamptz;

-- 3) Agenda : rendez-vous, essais, livraisons
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'visit' check (kind in ('visit','test_drive','delivery','other')),
  starts_at timestamptz not null,
  duration_min int not null default 60,
  client_name text not null,
  client_phone text, client_email text,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  vehicle_label text,
  deal_id uuid references public.deals(id) on delete set null,
  notes text,
  done boolean not null default false,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists appointments_starts_idx on public.appointments (starts_at);
alter table public.appointments enable row level security;
drop policy if exists "staff manage appointments" on public.appointments;
create policy "staff manage appointments" on public.appointments for all to authenticated using (public.is_staff()) with check (public.is_staff());
