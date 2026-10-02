-- À exécuter après supabase_documents.sql : dossiers de vente.
create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  client_name text not null,
  client_email text, client_phone text, client_address text,
  price numeric(12,2), deposit numeric(12,2),
  payment_mode text,
  stage text not null default 'contact' check (stage in ('contact','visit','offer','financing','signed','delivered','lost')),
  checklist jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists deals_user_idx on public.deals(user_id);
alter table public.deals enable row level security;
drop policy if exists "staff manage deals" on public.deals;
create policy "staff manage deals" on public.deals for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "client read own deal" on public.deals;
create policy "client read own deal" on public.deals for select to authenticated using (user_id = auth.uid());
drop trigger if exists deals_updated on public.deals;
create trigger deals_updated before update on public.deals for each row execute function public.set_updated_at();
