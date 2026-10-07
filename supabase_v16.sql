-- v16 : statuts fins des demandes carte grise, limitation des contrôles IA publics, relance des prospects.
-- Relançable sans risque. À exécuter après supabase_v15.sql.
alter table public.siv_requests drop constraint if exists siv_requests_status_check;
alter table public.siv_requests add constraint siv_requests_status_check
  check (status in ('draft','sent','paid','to_fix','in_progress','done','rejected'));
alter table public.siv_requests add column if not exists last_notified_status text;

-- limitation d'usage des fonctions publiques qui appellent l'IA (empreinte d'adresse IP, jamais l'adresse elle-même)
create table if not exists public.public_rate (
  id bigserial primary key,
  ip_hash text not null,
  kind text not null,
  created_at timestamptz not null default now()
);
create index if not exists public_rate_idx on public.public_rate(kind, ip_hash, created_at desc);
alter table public.public_rate enable row level security; -- aucune policy : seules les fonctions (clé service) y accèdent

alter table public.leads add column if not exists hot_reminded_at timestamptz;
