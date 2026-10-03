-- À exécuter après supabase_siv.sql : champs d'un dossier de vente complet (type Autocerfa).
alter table public.deals
  add column if not exists deal_no bigint generated always as identity,
  add column if not exists deal_type text not null default 'vente_particulier',
  add column if not exists invoice_no text,
  add column if not exists client_usage_name text, add column if not exists client_siren text,
  add column if not exists client_sex text, add column if not exists co_name text,
  add column if not exists client_birth_dept text, add column if not exists client_birth_country text default 'FRANCE',
  add column if not exists street_no text, add column if not exists street_ext text,
  add column if not exists street_type text, add column if not exists street_name text,
  add column if not exists building text, add column if not exists floor text,
  add column if not exists trade_brand text, add column if not exists trade_plate text;
create unique index if not exists deals_invoice_no_key on public.deals(invoice_no) where invoice_no is not null;

-- Factures importées par l'agence, garanties (type Autocerfa).
alter table public.deals
  add column if not exists invoice_path text,
  add column if not exists purchase_invoice_no text, add column if not exists purchase_invoice_path text,
  add column if not exists warranty_kind text, add column if not exists warranty_months integer,
  add column if not exists warranty_km integer, add column if not exists warranty_cap numeric(12,2),
  add column if not exists warranty_price numeric(12,2), add column if not exists warranty_provider text,
  add column if not exists warranty_ref text, add column if not exists warranty_start date,
  add column if not exists warranty_points text;
