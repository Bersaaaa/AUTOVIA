
-- ============================================================
-- AUTOVIA / SUPABASE
-- Importer ce fichier dans Supabase > SQL Editor > Run
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- ENUMS ----------
do $$ begin
  create type public.vehicle_status as enum ('available','reserved','sold','draft');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lead_status as enum ('new','in_progress','closed','archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lead_type as enum ('valuation','contact','callback','vehicle_interest','visit');
exception when duplicate_object then null; end $$;

-- ---------- PROFILES ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'admin' check (role in ('admin','editor')),
  created_at timestamptz not null default now()
);

-- ---------- VEHICLES ----------
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  brand text not null,
  model text not null,
  version text,
  year integer check (year between 1900 and 2100),
  mileage integer check (mileage >= 0),
  fuel text,
  gearbox text,
  price numeric(12,2) check (price >= 0),
  monthly_payment numeric(12,2) check (monthly_payment >= 0),
  power_hp integer check (power_hp >= 0),
  doors integer check (doors between 1 and 10),
  seats integer check (seats between 1 and 20),
  crit_air text,
  co2_g_km integer check (co2_g_km >= 0),
  color text,
  description text,
  history text,
  warranty text,
  status public.vehicle_status not null default 'available',
  badge text,
  featured boolean not null default false,
  published boolean not null default true,
  equipment jsonb not null default '[]'::jsonb,
  financing jsonb not null default '{}'::jsonb,
  seo_title text,
  seo_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vehicles_status_idx on public.vehicles(status);
create index if not exists vehicles_brand_idx on public.vehicles(brand);
create index if not exists vehicles_price_idx on public.vehicles(price);
create index if not exists vehicles_year_idx on public.vehicles(year);
create index if not exists vehicles_created_at_idx on public.vehicles(created_at desc);

-- ---------- VEHICLE IMAGES ----------
create table if not exists public.vehicle_images (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  storage_path text not null,
  alt_text text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists vehicle_images_vehicle_idx
on public.vehicle_images(vehicle_id, sort_order);

-- ---------- LEADS ----------
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  type public.lead_type not null,
  status public.lead_status not null default 'new',
  vehicle_id uuid references public.vehicles(id) on delete set null,
  first_name text,
  last_name text,
  phone text,
  email text,
  subject text,
  message text,
  registration text,
  brand text,
  model text,
  vehicle_year integer,
  mileage integer,
  fuel text,
  gearbox text,
  condition text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_status_idx on public.leads(status);
create index if not exists leads_created_at_idx on public.leads(created_at desc);
create index if not exists leads_vehicle_idx on public.leads(vehicle_id);

-- ---------- VALUATION PHOTOS ----------
create table if not exists public.valuation_images (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  storage_path text not null,
  created_at timestamptz not null default now()
);

-- ---------- UPDATED_AT ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists vehicles_updated_at on public.vehicles;
create trigger vehicles_updated_at
before update on public.vehicles
for each row execute function public.set_updated_at();

drop trigger if exists leads_updated_at on public.leads;
create trigger leads_updated_at
before update on public.leads
for each row execute function public.set_updated_at();

-- ---------- PROFILE CREATION ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), 'admin')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------- ADMIN HELPER ----------
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin','editor')
  );
$$;

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.vehicle_images enable row level security;
alter table public.leads enable row level security;
alter table public.valuation_images enable row level security;

-- Public website: only published inventory.
drop policy if exists "public read published vehicles" on public.vehicles;
create policy "public read published vehicles"
on public.vehicles for select
to anon, authenticated
using (published = true and status <> 'draft');

-- Staff can manage inventory.
drop policy if exists "staff manage vehicles" on public.vehicles;
create policy "staff manage vehicles"
on public.vehicles for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

-- Public website: images belonging to public vehicles.
drop policy if exists "public read vehicle images" on public.vehicle_images;
create policy "public read vehicle images"
on public.vehicle_images for select
to anon, authenticated
using (
  exists (
    select 1 from public.vehicles v
    where v.id = vehicle_images.vehicle_id
      and v.published = true
      and v.status <> 'draft'
  )
);

drop policy if exists "staff manage vehicle images" on public.vehicle_images;
create policy "staff manage vehicle images"
on public.vehicle_images for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

-- Public forms: INSERT only. No public reading.
drop policy if exists "public create leads" on public.leads;
create policy "public create leads"
on public.leads for insert
to anon, authenticated
with check (true);

drop policy if exists "staff manage leads" on public.leads;
create policy "staff manage leads"
on public.leads for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

drop policy if exists "public create valuation images" on public.valuation_images;
create policy "public create valuation images"
on public.valuation_images for insert
to anon, authenticated
with check (true);

drop policy if exists "staff manage valuation images" on public.valuation_images;
create policy "staff manage valuation images"
on public.valuation_images for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

-- ---------- STORAGE ----------
insert into storage.buckets (id, name, public)
values ('vehicle-images','vehicle-images',true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public)
values ('valuation-images','valuation-images',false)
on conflict (id) do nothing;

drop policy if exists "public read vehicle storage" on storage.objects;
create policy "public read vehicle storage"
on storage.objects for select
to public
using (bucket_id = 'vehicle-images');

drop policy if exists "staff upload vehicle storage" on storage.objects;
create policy "staff upload vehicle storage"
on storage.objects for insert
to authenticated
with check (bucket_id = 'vehicle-images' and public.is_staff());

drop policy if exists "staff update vehicle storage" on storage.objects;
create policy "staff update vehicle storage"
on storage.objects for update
to authenticated
using (bucket_id = 'vehicle-images' and public.is_staff())
with check (bucket_id = 'vehicle-images' and public.is_staff());

drop policy if exists "staff delete vehicle storage" on storage.objects;
create policy "staff delete vehicle storage"
on storage.objects for delete
to authenticated
using (bucket_id = 'vehicle-images' and public.is_staff());

-- Valuation photos: staff can read; public upload is intentionally NOT opened here.
-- Recommended production flow: upload through an Edge Function after lead creation.
drop policy if exists "staff read valuation storage" on storage.objects;
create policy "staff read valuation storage"
on storage.objects for select
to authenticated
using (bucket_id = 'valuation-images' and public.is_staff());

drop policy if exists "staff upload valuation storage" on storage.objects;
create policy "staff upload valuation storage"
on storage.objects for insert
to authenticated
with check (bucket_id = 'valuation-images' and public.is_staff());

-- ---------- DEMO VEHICLES ----------
insert into public.vehicles
(slug,brand,model,version,year,mileage,fuel,gearbox,price,monthly_payment,power_hp,doors,seats,crit_air,co2_g_km,color,description,history,warranty,status,badge,featured,published,equipment,financing,seo_title,seo_description)
values
('bmw-serie-3-320i-m-sport-2024','BMW','Série 3','320i M Sport',2024,18900,'Essence','Automatique',39490,549,184,4,5,'1',145,'Noir','Berline premium de démonstration, configuration fictive.','Historique fictif à remplacer.','Garantie fictive à remplacer.','available','Coup de cœur',true,true,'["Caméra de recul","GPS","Sièges chauffants","Régulateur adaptatif","Apple CarPlay"]'::jsonb,'{"apport":5000,"duration":60,"monthly":549}'::jsonb,'BMW Série 3 320i M Sport occasion','BMW Série 3 320i M Sport d’occasion — fiche de démonstration.'),
('peugeot-308-gt-hybrid-180-2025','Peugeot','308','GT Hybrid 180',2025,9800,'Hybride','Automatique',31990,449,180,5,5,'1',30,'Gris','Véhicule de démonstration.','Historique fictif à remplacer.','Garantie fictive à remplacer.','available','Nouveau',true,true,'["Toit panoramique","Caméra 360","GPS","Sièges chauffants"]'::jsonb,'{"apport":4000,"duration":60,"monthly":449}'::jsonb,'Peugeot 308 GT Hybrid 180 occasion','Peugeot 308 GT Hybrid 180 d’occasion — fiche de démonstration.'),
('volkswagen-golf-etsi-r-line-2024','Volkswagen','Golf','1.5 eTSI R-Line',2024,14500,'Essence','Automatique',29490,419,150,5,5,'1',125,'Blanc','Véhicule de démonstration.','Historique fictif à remplacer.','Garantie fictive à remplacer.','available',null,false,true,'["LED Matrix","Digital Cockpit","CarPlay","Aide au stationnement"]'::jsonb,'{"apport":4000,"duration":60,"monthly":419}'::jsonb,'Volkswagen Golf eTSI R-Line occasion','Volkswagen Golf eTSI R-Line d’occasion — fiche de démonstration.')
on conflict (slug) do nothing;

-- ---------- GRANTS ----------
grant usage on schema public to anon, authenticated;
grant select on public.vehicles, public.vehicle_images to anon, authenticated;
grant insert on public.leads to anon, authenticated;
grant insert on public.valuation_images to anon, authenticated;
grant all on public.profiles, public.vehicles, public.vehicle_images, public.leads, public.valuation_images to authenticated;

-- ---------- OPTIONAL SEARCH FUNCTION ----------
create or replace function public.search_vehicles(
  p_brand text default null,
  p_model text default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_max_mileage integer default null,
  p_year integer default null,
  p_fuel text default null,
  p_gearbox text default null
)
returns setof public.vehicles
language sql
stable
as $$
  select *
  from public.vehicles
  where published = true
    and status <> 'draft'
    and (p_brand is null or brand ilike '%' || p_brand || '%')
    and (p_model is null or model ilike '%' || p_model || '%')
    and (p_min_price is null or price >= p_min_price)
    and (p_max_price is null or price <= p_max_price)
    and (p_max_mileage is null or mileage <= p_max_mileage)
    and (p_year is null or year = p_year)
    and (p_fuel is null or fuel = p_fuel)
    and (p_gearbox is null or gearbox = p_gearbox)
  order by featured desc, created_at desc;
$$;

grant execute on function public.search_vehicles(text,text,numeric,numeric,integer,integer,text,text)
to anon, authenticated;
