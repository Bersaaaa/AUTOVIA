-- À exécuter après supabase_cerfa.sql : marges par véhicule, tableau de bord, alertes clients.
-- Les coûts d'achat sont dans une table À PART (jamais lisible par les visiteurs du site).
create table if not exists public.vehicle_costs (
  vehicle_id uuid primary key references public.vehicles(id) on delete cascade,
  purchase_price numeric(12,2), prep_cost numeric(12,2), purchased_at date,
  updated_at timestamptz not null default now()
);
alter table public.vehicle_costs enable row level security;
drop policy if exists "staff manage costs" on public.vehicle_costs;
create policy "staff manage costs" on public.vehicle_costs for all to authenticated using (public.is_staff()) with check (public.is_staff());

alter table public.deals add column if not exists signed_at timestamptz;

create table if not exists public.search_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  brand text, max_price numeric(12,2), fuel text,
  created_at timestamptz not null default now()
);
alter table public.search_alerts enable row level security;
drop policy if exists "own alerts" on public.search_alerts;
create policy "own alerts" on public.search_alerts for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "staff read alerts" on public.search_alerts;
create policy "staff read alerts" on public.search_alerts for select to authenticated using (public.is_staff());
