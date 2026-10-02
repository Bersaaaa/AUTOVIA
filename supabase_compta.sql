-- À exécuter après supabase_pilotage.sql : livre de police (registre) et compta.

-- Livre de police : AJOUT SEUL (pas de modification ni suppression possibles depuis le site).
create table if not exists public.police_register (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique,
  entry_type text not null check (entry_type in ('achat','vente')),
  occurred_on date not null default current_date,
  deal_id uuid references public.deals(id) on delete set null,
  brand_model text not null, vin text, plate text, first_reg_date date, mileage integer,
  counterparty_name text not null, counterparty_birth text, counterparty_address text,
  id_document text,
  price numeric(12,2), payment_mode text, note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
alter table public.police_register enable row level security;
drop policy if exists "staff read register" on public.police_register;
create policy "staff read register" on public.police_register for select to authenticated using (public.is_staff());
drop policy if exists "staff append register" on public.police_register;
create policy "staff append register" on public.police_register for insert to authenticated with check (public.is_staff());
-- volontairement aucune politique update/delete

create table if not exists public.accounting_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default current_date,
  kind text not null check (kind in ('recette','depense')),
  category text not null, label text not null,
  amount_ttc numeric(12,2) not null, vat_amount numeric(12,2) default 0,
  payment_mode text, deal_id uuid references public.deals(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.accounting_entries enable row level security;
drop policy if exists "staff manage accounting" on public.accounting_entries;
create policy "staff manage accounting" on public.accounting_entries for all to authenticated using (public.is_staff()) with check (public.is_staff());
