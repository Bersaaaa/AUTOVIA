-- v17 : CRM (recherche de véhicule + charges fixes/variables)
alter type public.lead_type add value if not exists 'search';
alter table public.vehicle_costs add column if not exists charges jsonb default '[]'::jsonb;
alter table public.vehicle_costs add column if not exists target_margin_pct numeric;
