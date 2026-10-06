-- v15 : réservation en ligne d'un véhicule (acompte 500 € bloqué sur la carte 7 jours) + paiement Stripe.
-- Relançable sans risque. À exécuter après supabase_v14.sql.
create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references public.vehicles(id) on delete set null,
  vehicle_label text,
  client_name text not null,
  client_email text not null,
  client_phone text,
  amount numeric not null default 500,
  status text not null default 'pending' check (status in ('pending','held','kept','released','converted','expired')),
  stripe_session_id text,
  stripe_payment_intent text,
  held_at timestamptz,
  expires_at timestamptz,
  warned_at timestamptz,
  deal_id uuid references public.deals(id) on delete set null,
  consent_at timestamptz,
  note text,
  cancel_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);
alter table public.reservations add column if not exists cancel_token uuid not null default gen_random_uuid();
create index if not exists reservations_status_idx on public.reservations(status, expires_at);
create index if not exists reservations_vehicle_idx on public.reservations(vehicle_id);
alter table public.reservations enable row level security;
drop policy if exists reservations_staff on public.reservations;
create policy reservations_staff on public.reservations for all using (public.is_staff()) with check (public.is_staff());
-- Le public n'a AUCUN accès direct : tout passe par les fonctions Edge (clé service).
