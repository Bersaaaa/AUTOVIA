-- À exécuter après supabase_fiche.sql : demandes SIV transmises par e-mail à SBR CARTE GRISE.
create table if not exists public.siv_requests (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references public.deals(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  kind text not null check (kind in ('changement_titulaire','declaration_achat','declaration_cession','premiere_immat','duplicata','changement_adresse','w_garage','autre')),
  status text not null default 'draft' check (status in ('draft','sent','in_progress','done','rejected')),
  client_name text not null,
  client_email text, client_phone text, client_address text,
  plate text, vin text, vehicle_label text,
  data jsonb not null default '{}'::jsonb,
  notes text,
  files jsonb not null default '[]'::jsonb,   -- [{path, name}] dans le bucket siv-files
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
alter table public.siv_requests enable row level security;
drop policy if exists "staff manage siv" on public.siv_requests;
create policy "staff manage siv" on public.siv_requests for all to authenticated using (public.is_staff()) with check (public.is_staff());

insert into storage.buckets (id, name, public) values ('siv-files','siv-files', false) on conflict (id) do nothing;
drop policy if exists "staff manage siv files" on storage.objects;
create policy "staff manage siv files" on storage.objects for all to authenticated
using (bucket_id = 'siv-files' and public.is_staff()) with check (bucket_id = 'siv-files' and public.is_staff());
