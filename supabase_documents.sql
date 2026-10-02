-- À exécuter après supabase_schema.sql et supabase_espaces.sql
-- Documents clients (factures, bons de commande, contrats…) : stockage privé, chaque client ne voit que les siens.

alter table public.profiles add column if not exists email text;
update public.profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name, role, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), 'buyer', new.email)
  on conflict (id) do nothing;
  return new;
end; $$;

drop policy if exists "staff read profiles" on public.profiles;
create policy "staff read profiles" on public.profiles for select to authenticated using (public.is_staff());

create table if not exists public.client_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  kind text not null default 'other' check (kind in ('invoice','order','contract','registration','warranty','other')),
  title text not null,
  number text,
  amount_ttc numeric(12,2),
  storage_path text not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists client_documents_user_idx on public.client_documents(user_id);
alter table public.client_documents enable row level security;

drop policy if exists "client read own documents" on public.client_documents;
create policy "client read own documents" on public.client_documents for select to authenticated using (user_id = auth.uid());
drop policy if exists "staff manage documents" on public.client_documents;
create policy "staff manage documents" on public.client_documents for all to authenticated using (public.is_staff()) with check (public.is_staff());

insert into storage.buckets (id, name, public) values ('client-documents', 'client-documents', false) on conflict (id) do nothing;

-- Chemin des fichiers : <user_id>/<fichier>. Le client ne lit que son dossier.
drop policy if exists "client read own files" on storage.objects;
create policy "client read own files" on storage.objects for select to authenticated
using (bucket_id = 'client-documents' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "staff manage client files" on storage.objects;
create policy "staff manage client files" on storage.objects for all to authenticated
using (bucket_id = 'client-documents' and public.is_staff()) with check (bucket_id = 'client-documents' and public.is_staff());
