-- À exécuter après supabase_signature_avis.sql : fiche interne du véhicule (réservée à l'agence).
alter table public.vehicle_costs
  add column if not exists vin text, add column if not exists plate text, add column if not exists first_reg_date date,
  add column if not exists seller_name text, add column if not exists seller_address text, add column if not exists purchase_payment text;
