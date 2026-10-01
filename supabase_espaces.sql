-- ============================================================
-- AUTOVIA : espaces acheteur et agence
-- À exécuter dans Supabase > SQL Editor APRÈS supabase_schema.sql
-- ============================================================

-- 1. Les nouveaux comptes sont des acheteurs (et plus des admins)
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin','editor','buyer'));
alter table public.profiles alter column role set default 'buyer';

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), 'buyer')
  on conflict (id) do nothing;
  return new;
end; $$;

-- 2. Chacun peut lire son propre profil (le site y lit le rôle)
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select to authenticated using (id = auth.uid());

-- 3. Demandes rattachées au compte, visibles par leur auteur
alter table public.leads add column if not exists user_id uuid references auth.users(id) on delete set null default auth.uid();
create index if not exists leads_user_idx on public.leads(user_id);
drop policy if exists "buyer read own leads" on public.leads;
create policy "buyer read own leads" on public.leads for select to authenticated using (user_id = auth.uid());

-- 4. Favoris
create table if not exists public.favorites (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, vehicle_id)
);
alter table public.favorites enable row level security;
drop policy if exists "own favorites" on public.favorites;
create policy "own favorites" on public.favorites for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, delete on public.favorites to authenticated;

-- 5. Donner l'accès agence à un compte existant (remplacer l'e-mail) :
-- update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'agence@exemple.fr');
