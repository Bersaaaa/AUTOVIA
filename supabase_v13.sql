-- À exécuter après supabase_v12.sql : marge réelle (commission, autres frais), contrôle technique, relance des devis.
alter table public.deals add column if not exists commission numeric(12,2);
alter table public.deals add column if not exists other_costs numeric(12,2);
alter table public.deals add column if not exists quote_reminded_at timestamptz;
alter table public.vehicle_costs add column if not exists ct_date date;
