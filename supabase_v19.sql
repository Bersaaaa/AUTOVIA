-- v19 : signature électronique SANS compte client (lien secret) + signature de plusieurs documents (Cerfa PDF, garantie, bon de commande…)
-- À exécuter après supabase_signature_avis.sql.
alter table public.order_signatures alter column user_id drop not null;
alter table public.order_signatures add column if not exists pack_token uuid;
alter table public.order_signatures add column if not exists kind text not null default 'html';
alter table public.order_signatures add column if not exists storage_path text;   -- PDF d'origine (bucket sign-docs)
alter table public.order_signatures add column if not exists signed_path text;     -- PDF signé (avec page de certificat)
alter table public.order_signatures add column if not exists signer_email text;
alter table public.order_signatures add column if not exists expires_at timestamptz default (now() + interval '30 days');
update public.order_signatures set pack_token = gen_random_uuid() where pack_token is null;
alter table public.order_signatures alter column pack_token set default gen_random_uuid();
create index if not exists order_signatures_pack_idx on public.order_signatures(pack_token);

insert into storage.buckets (id, name, public) values ('sign-docs', 'sign-docs', false) on conflict (id) do nothing;
drop policy if exists "staff manage sign-docs" on storage.objects;
create policy "staff manage sign-docs" on storage.objects for all to authenticated
using (bucket_id = 'sign-docs' and public.is_staff()) with check (bucket_id = 'sign-docs' and public.is_staff());
-- Le client sans compte ne lit/signe QUE via la fonction « public-sign » (clé de service, jeton secret du lien).
