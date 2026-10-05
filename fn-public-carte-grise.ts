// Edge Function : parcours public /carte-grise (duplicata et changement d'adresse) + suivi de dossier sans compte.
// Actions : create (crée la demande, renvoie des liens d'envoi de documents), finalize (valide les pièces envoyées et prévient l'agence),
//           more (liens d'envoi pour des pièces supplémentaires), track (suivi par numéro + e-mail).
// Les pièces sont stockées dans le bucket PRIVÉ « siv-files » (créé par supabase_siv.sql), lisibles seulement par l'agence.
// Déploiement sans ligne de commande : Supabase > Edge Functions > Deploy a new function > nom « public-carte-grise » > coller tout ce fichier > désactiver « Verify JWT ».
// Secrets : RESEND_API_KEY, SIV_TO_EMAIL (boîte qui reçoit les demandes), SIV_FROM_EMAIL ; facultatif : SITE_URL (lien de suivi dans les e-mails).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const KINDS: Record<string, string> = {
  duplicata: "Duplicata de carte grise", changement_adresse: "Changement d'adresse",
  changement_titulaire: "Changement de titulaire", declaration_cession: "Déclaration de cession",
  premiere_immat: "Première immatriculation / import", w_garage: "Certificat W garage", autre: "Autre démarche",
};
const cut = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const slug = (n: string) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_").slice(-60) || "fichier";
const OK_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const optional = (l: string) => /si nécessaire|si détériorée/i.test(l);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json();
    if (b.website) return json({ ok: true }); // piège anti-robot
    const action = b.action ?? "create";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const key = Deno.env.get("RESEND_API_KEY"), to = Deno.env.get("SIV_TO_EMAIL"), from = Deno.env.get("SIV_FROM_EMAIL"), site = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
    const send = async (rcpt: string, subject: string, html: string, reply?: string) => {
      if (!key || !from) return false;
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [rcpt], reply_to: reply, subject, html }) });
      if (!r.ok) console.error(await r.text());
      return r.ok;
    };
    const wrap = (inner: string) => `<div style="font:15px/1.55 system-ui,sans-serif;color:#0b1b3f;max-width:620px">${inner}</div>`;
    const signed = async (numero: string, files: { name: string; type: string; size: number }[], start = 0) => {
      const out: ({ path: string; token: string } | null)[] = [];
      for (let i = 0; i < files.length && i < 12; i++) {
        const f = files[i];
        if (!OK_TYPES.includes(f.type) || !(f.size > 0 && f.size <= 10_000_000)) { out.push(null); continue; }
        const path = `cg/${numero}/${Date.now()}-${start + i}-${slug(String(f.name))}`;
        const { data, error } = await admin.storage.from("siv-files").createSignedUploadUrl(path);
        out.push(error || !data ? null : { path, token: data.token });
      }
      return out;
    };
    const find = async (numero: string, email: string) => {
      if (!/^CG-\d{4}-\d{6}$/.test(numero) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
      const { data } = await admin.from("siv_requests").select("*").contains("data", { numero }).eq("client_email", email.toLowerCase()).maybeSingle();
      return data;
    };

    if (action === "create") {
      const name = cut(b.name, 120), email = cut(b.email, 160).toLowerCase(), phone = cut(b.phone, 30), plate = cut(b.plate, 20).toUpperCase();
      const kind = KINDS[b.kind] ? b.kind : "autre", party = b.party === "soc" ? "soc" : "part";
      if (name.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || b.consent !== true) return json({ error: "invalid" }, 400);
      if (!to || !from || !key) return json({ error: "mail_not_configured" }, 500);
      const since = new Date(Date.now() - 3600_000).toISOString();
      const { count } = await admin.from("siv_requests").select("id", { count: "exact", head: true }).contains("data", { source: "site" }).gte("created_at", since);
      if ((count ?? 0) >= 30) return json({ error: "rate_limited" }, 429);
      let numero = "";
      for (let i = 0; i < 5; i++) {
        numero = `CG-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 900000) + 100000)}`;
        const { count: c } = await admin.from("siv_requests").select("id", { count: "exact", head: true }).contains("data", { numero });
        if (!c) break;
      }
      const docs = (Array.isArray(b.docs) ? b.docs : []).slice(0, 12).map((l: unknown) => cut(l, 120));
      const data = {
        source: "site", numero, party, siret: cut(b.siret, 20), motif: cut(b.motif, 30), new_address: cut(b.new_address, 200),
        tarif: Number(b.tarif) || null, docs,
      };
      const { error } = await admin.from("siv_requests").insert({
        kind, status: "draft", client_name: name, client_email: email, client_phone: phone || null,
        client_address: cut(b.new_address, 200) || null, plate: plate || null, notes: cut(b.message, 2000) || null, data,
      });
      if (error) { console.error(error); return json({ error: "server" }, 500); }
      const files = (Array.isArray(b.files) ? b.files : []).map((f: Record<string, unknown>) => ({ name: String(f.name ?? ""), type: String(f.type ?? ""), size: Number(f.size) || 0 }));
      return json({ ok: true, numero, uploads: await signed(numero, files) });
    }

    const numero = cut(b.numero, 20).toUpperCase(), email = cut(b.email, 160);
    const r = await find(numero, email);
    if (!r) return json({ error: "not_found" }, 404);
    const D = (r.data ?? {}) as Record<string, unknown>;

    if (action === "more") {
      const files = (Array.isArray(b.files) ? b.files : []).map((f: Record<string, unknown>) => ({ name: String(f.name ?? ""), type: String(f.type ?? ""), size: Number(f.size) || 0 }));
      return json({ ok: true, uploads: await signed(numero, files, (r.files ?? []).length) });
    }

    if (action === "finalize") {
      const up = (Array.isArray(b.uploaded) ? b.uploaded : []).filter((u: Record<string, unknown>) => typeof u.path === "string" && String(u.path).startsWith(`cg/${numero}/`)).slice(0, 12)
        .map((u: Record<string, unknown>) => ({ path: String(u.path), name: `${cut(u.label, 80)} — ${cut(u.name, 80)}`, label: cut(u.label, 120) }));
      const files = [...(r.files ?? []), ...up];
      const first = r.status === "draft";
      await admin.from("siv_requests").update({ files, ...(first ? { status: "sent", sent_at: new Date().toISOString() } : {}) }).eq("id", r.id);
      const link = site ? `${site}/#/suivi-carte-grise?n=${numero}&e=${encodeURIComponent(email)}` : "";
      if (to) {
        const rows: [string, string][] = [["Numéro", numero], ["Démarche", KINDS[r.kind] ?? r.kind], ["Client", `${r.client_name}${D.party === "soc" ? " (société)" : ""}`], ["E-mail", r.client_email], ["Téléphone", r.client_phone ?? ""], ["Immatriculation", r.plate ?? ""], ["Motif", String(D.motif ?? "")], ["Nouvelle adresse", String(D.new_address ?? "")], ["SIRET", String(D.siret ?? "")], ["Tarif annoncé", D.tarif ? `${D.tarif} € TTC` : ""], ["Message", r.notes ?? ""], ["Pièces reçues", String(up.length)]];
        await send(to, `[Carte grise] ${b.more ? "Nouvelles pièces — " : ""}${KINDS[r.kind] ?? r.kind} — ${r.client_name} — ${numero}`,
          wrap(`<h2>${b.more ? "Pièces ajoutées" : "Nouvelle demande de carte grise (site)"}</h2><table style="border-collapse:collapse;width:100%">${rows.filter(([, v]) => v).map(([k, v]) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #e1e8f6;color:#55607a">${esc(k)}</td><td style="padding:6px 10px;border-bottom:1px solid #e1e8f6"><b>${esc(v)}</b></td></tr>`).join("")}</table><p>Les pièces sont dans l'espace agence › SIV.</p>`), r.client_email);
      }
      if (first && r.client_email) {
        await send(r.client_email, `Votre demande ${numero} est bien reçue`,
          wrap(`<p>Bonjour ${esc(r.client_name)},</p><p>Nous avons bien reçu votre demande de <b>${esc(KINDS[r.kind] ?? r.kind)}</b>. Votre numéro de dossier : <b>${numero}</b>.</p><p>Nous vérifions vos documents, puis vous recevrez un lien de paiement sécurisé. Aucun paiement n'est demandé avant.</p>${link ? `<p><a href="${link}">Suivre mon dossier</a></p>` : ""}`));
      }
      return json({ ok: true });
    }

    if (action === "track") {
      const have = new Set((r.files ?? []).map((f: { label?: string }) => f.label));
      const docs = ((D.docs as string[]) ?? []).map((label) => ({ label, received: have.has(label), optional: optional(label) }));
      return json({ ok: true, numero, status: r.status, kindLabel: KINDS[r.kind] ?? r.kind, created_at: r.created_at, plate: r.plate, docs });
    }
    return json({ error: "bad_action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "server" }, 500);
  }
});
