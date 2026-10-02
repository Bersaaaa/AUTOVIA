-- À exécuter après supabase_compta.sql : signature électronique du bon de commande + avis clients vérifiés.

-- ===== Signature électronique (signature simple, preuve conservée côté serveur) =====
create table if not exists public.order_signatures (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references public.deals(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  document_html text not null,
  status text not null default 'pending' check (status in ('pending','signed')),
  signature_png text, signer_name text, signer_ip text, signer_user_agent text,
  doc_hash text, signed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
alter table public.order_signatures enable row level security;
drop policy if exists "client read own signatures" on public.order_signatures;
create policy "client read own signatures" on public.order_signatures for select to authenticated using (user_id = auth.uid());
drop policy if exists "staff read signatures" on public.order_signatures;
create policy "staff read signatures" on public.order_signatures for select to authenticated using (public.is_staff());
drop policy if exists "staff create signatures" on public.order_signatures;
create policy "staff create signatures" on public.order_signatures for insert to authenticated with check (public.is_staff() and status = 'pending');
drop policy if exists "staff delete pending signatures" on public.order_signatures;
create policy "staff delete pending signatures" on public.order_signatures for delete to authenticated using (public.is_staff());
-- pas de politique update : seule la fonction sign_order() peut signer.

create or replace function public.lock_signed() returns trigger language plpgsql as $$
begin
  if old.status = 'signed' then raise exception 'Document signé : modification impossible'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;
drop trigger if exists order_signatures_lock on public.order_signatures;
create trigger order_signatures_lock before update or delete on public.order_signatures for each row execute function public.lock_signed();

create or replace function public.sign_order(p_id uuid, p_signature text, p_name text, p_ua text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.order_signatures; hdr json;
begin
  select * into r from public.order_signatures where id = p_id and user_id = auth.uid() and status = 'pending' for update;
  if not found then raise exception 'Document introuvable ou déjà signé'; end if;
  if p_signature is null or length(p_signature) < 500 or length(p_signature) > 400000 or length(coalesce(p_name,'')) < 2 then raise exception 'Signature invalide'; end if;
  begin hdr := current_setting('request.headers', true)::json; exception when others then hdr := null; end;
  update public.order_signatures set status = 'signed', signature_png = p_signature, signer_name = left(p_name,120),
    signer_user_agent = left(coalesce(p_ua,''),300), signer_ip = left(coalesce(hdr->>'x-forwarded-for',''),100),
    doc_hash = encode(sha256(convert_to(document_html,'UTF8')),'hex'), signed_at = now()
  where id = p_id;
end; $$;
revoke all on function public.sign_order(uuid,text,text,text) from public;
grant execute on function public.sign_order(uuid,text,text,text) to authenticated;

-- ===== Avis clients : uniquement après livraison, publiés après modération =====
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null unique references public.deals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text not null check (length(comment) between 10 and 1500),
  author_name text not null check (length(author_name) between 2 and 60),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);
alter table public.reviews enable row level security;
drop policy if exists "public read approved reviews" on public.reviews;
create policy "public read approved reviews" on public.reviews for select to anon, authenticated using (status = 'approved');
drop policy if exists "client read own review" on public.reviews;
create policy "client read own review" on public.reviews for select to authenticated using (user_id = auth.uid());
drop policy if exists "client create review after delivery" on public.reviews;
create policy "client create review after delivery" on public.reviews for insert to authenticated
with check (user_id = auth.uid() and status = 'pending' and exists (select 1 from public.deals d where d.id = deal_id and d.user_id = auth.uid() and d.stage = 'delivered'));
drop policy if exists "staff manage reviews" on public.reviews;
create policy "staff manage reviews" on public.reviews for all to authenticated using (public.is_staff()) with check (public.is_staff());
