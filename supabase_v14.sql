-- À exécuter après supabase_v13.sql :
--  1) archivage des documents d'un dossier (pièce d'identité, carte grise, Cerfa achat / vente) dans un espace PRIVÉ réservé à l'agence ;
--  2) livre de police modifiable et supprimable, avec JOURNAL automatique de l'ancienne valeur.

-- 1) Archivage
insert into storage.buckets (id, name, public) values ('deal-files', 'deal-files', false) on conflict (id) do nothing;
drop policy if exists "staff manage deal files" on storage.objects;
create policy "staff manage deal files" on storage.objects for all to authenticated
  using (bucket_id = 'deal-files' and public.is_staff()) with check (bucket_id = 'deal-files' and public.is_staff());

create table if not exists public.deal_files (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references public.deals(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  kind text not null check (kind in ('identite','carte_grise','cerfa_achat','cerfa_vente','autre')),
  name text, storage_path text not null, mime text,
  created_at timestamptz not null default now(), created_by uuid default auth.uid()
);
create index if not exists deal_files_deal_idx on public.deal_files(deal_id);
create index if not exists deal_files_vehicle_idx on public.deal_files(vehicle_id);
alter table public.deal_files enable row level security;
drop policy if exists "staff manage deal_files" on public.deal_files;
create policy "staff manage deal_files" on public.deal_files for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- 2) Livre de police
create table if not exists public.police_register_log (
  id uuid primary key default gen_random_uuid(),
  register_id uuid, seq bigint, action text not null, old_data jsonb,
  changed_at timestamptz not null default now(), changed_by uuid default auth.uid()
);
alter table public.police_register_log enable row level security;
drop policy if exists "staff read register log" on public.police_register_log;
create policy "staff read register log" on public.police_register_log for select to authenticated using (public.is_staff());

create or replace function public.log_police_change() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.police_register_log(register_id, seq, action, old_data)
  values (old.id, old.seq, case tg_op when 'UPDATE' then 'modification' else 'suppression' end, to_jsonb(old));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists police_log on public.police_register;
create trigger police_log before update or delete on public.police_register for each row execute function public.log_police_change();

drop policy if exists "staff update register" on public.police_register;
create policy "staff update register" on public.police_register for update to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "staff delete register" on public.police_register;
create policy "staff delete register" on public.police_register for delete to authenticated using (public.is_staff());
