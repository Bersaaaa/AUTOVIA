-- v18 : galerie/documents véhicule, journal d'activité, sauvegarde automatique, rappels
alter table public.vehicle_costs add column if not exists insurance_end date;
alter table public.deals add column if not exists warranty_reminded_at timestamptz;

-- Documents par véhicule (carte grise, CT, facture d'achat, assurance, rapport…)
create table if not exists public.vehicle_files (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  kind text default 'autre',
  title text not null,
  storage_path text not null,
  created_at timestamptz default now()
);
alter table public.vehicle_files enable row level security;
drop policy if exists "staff manage vehicle files" on public.vehicle_files;
create policy "staff manage vehicle files" on public.vehicle_files for all to authenticated using (public.is_staff()) with check (public.is_staff());
insert into storage.buckets (id, name, public) values ('vehicle-files', 'vehicle-files', false) on conflict (id) do nothing;
drop policy if exists "staff manage vehicle-files bucket" on storage.objects;
create policy "staff manage vehicle-files bucket" on storage.objects for all to authenticated
using (bucket_id = 'vehicle-files' and public.is_staff()) with check (bucket_id = 'vehicle-files' and public.is_staff());

-- Sauvegardes automatiques (bucket privé, lecture équipe uniquement)
insert into storage.buckets (id, name, public) values ('backups', 'backups', false) on conflict (id) do nothing;
drop policy if exists "staff read backups" on storage.objects;
create policy "staff read backups" on storage.objects for select to authenticated using (bucket_id = 'backups' and public.is_staff());

-- Journal d'activité : qui a modifié quoi (noms des champs modifiés, pas leurs valeurs)
create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_email text,
  action text not null,
  table_name text not null,
  record_id text,
  label text,
  changed text[]
);
create index if not exists activity_log_at_idx on public.activity_log(at desc);
alter table public.activity_log enable row level security;
drop policy if exists "staff read activity" on public.activity_log;
create policy "staff read activity" on public.activity_log for select to authenticated using (public.is_staff());

create or replace function public.log_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb; ch text[]; lbl text;
begin
  if tg_op = 'DELETE' then r := to_jsonb(old); else r := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(n.key), '{}') into ch from jsonb_each(to_jsonb(new)) n
      where to_jsonb(old) -> n.key is distinct from n.value and n.key not in ('updated_at');
    if array_length(ch, 1) is null then return new; end if;
  end if;
  lbl := coalesce(nullif(r->>'client_name',''), nullif(r->>'title',''), nullif(r->>'counterparty_name',''),
                  nullif(concat_ws(' ', r->>'brand', r->>'model'), ''), nullif(r->>'description',''), nullif(r->>'plate',''));
  insert into public.activity_log(user_email, action, table_name, record_id, label, changed)
  values (coalesce(auth.jwt()->>'email', 'système'), tg_op, tg_table_name, r->>'id', left(lbl, 120), ch);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['deals','vehicles','vehicle_costs','accounting_entries','police_register','reservations','siv_requests','vehicle_files','leads'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists log_activity_trg on public.%I', t);
      execute format('create trigger log_activity_trg after insert or update or delete on public.%I for each row execute function public.log_activity()', t);
    end if;
  end loop;
end $$;
