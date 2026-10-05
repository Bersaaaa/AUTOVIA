// Edge Function Supabase : demande de carte grise envoyée depuis la page publique /carte-grise.
// Enregistre la demande dans siv_requests (source "site") puis l'envoie par e-mail à SBR CARTE GRISE.
// Déploiement (appel public, sans connexion) :
// Déploiement sans ligne de commande : Supabase > Edge Functions > Deploy a new function > nom « public-carte-grise » > coller tout ce fichier > désactiver « Verify JWT ».
// Secrets : les mêmes que send-siv-request (RESEND_API_KEY, SIV_TO_EMAIL, SIV_FROM_EMAIL).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const KINDS: Record<string, string> = {
  changement_titulaire: "Changement de titulaire",
  declaration_cession: "Déclaration de cession",
  changement_adresse: "Changement d'adresse",
  duplicata: "Duplicata",
  premiere_immat: "Première immatriculation / import",
  w_garage: "Certificat W garage",
  autre: "Autre démarche",
};
const cut = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json();
    if (b.website) return json({ ok: true }); // piège anti-robot : champ caché rempli
    const name = cut(b.name, 120), email = cut(b.email, 160), phone = cut(b.phone, 30), plate = cut(b.plate, 20).toUpperCase();
    const message = cut(b.message, 2000), kind = KINDS[b.kind] ? b.kind : "autre";
    if (name.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || b.consent !== true) return json({ error: "invalid" }, 400);

    const key = Deno.env.get("RESEND_API_KEY"), to = Deno.env.get("SIV_TO_EMAIL"), from = Deno.env.get("SIV_FROM_EMAIL");
    if (!key || !to || !from) return json({ error: "mail_not_configured" }, 500);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await admin.from("siv_requests").select("id", { count: "exact", head: true })
      .contains("data", { source: "site" }).gte("created_at", since);
    if ((count ?? 0) >= 30) return json({ error: "rate_limited" }, 429);

    const { data: r, error } = await admin.from("siv_requests").insert({
      kind, status: "draft", client_name: name, client_email: email, client_phone: phone || null,
      plate: plate || null, notes: message || null, data: { source: "site" },
    }).select("id").single();
    if (error || !r) { console.error(error); return json({ error: "server" }, 500); }

    const rows: [string, string][] = [["Démarche", KINDS[kind]], ["Référence", r.id.slice(0, 8).toUpperCase()], ["Client", name], ["E-mail", email], ["Téléphone", phone], ["Immatriculation", plate], ["Message", message]];
    const html = `<div style="font:15px/1.5 system-ui,sans-serif;color:#0b1b3f;max-width:640px"><h2>Nouvelle demande de carte grise (site)</h2><table style="border-collapse:collapse;width:100%">${rows.filter(([, v]) => v).map(([k, v]) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #dfe6f3;color:#55607a;width:34%">${esc(k)}</td><td style="padding:6px 10px;border-bottom:1px solid #dfe6f3"><b>${esc(v)}</b></td></tr>`).join("")}</table><p style="color:#55607a;font-size:13px">Répondez à ce message pour écrire directement au client.</p></div>`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], reply_to: email, subject: `[Carte grise] ${KINDS[kind]} — ${name}${plate ? " — " + plate : ""}`, html }),
    });
    if (!res.ok) { console.error(await res.text()); return json({ error: "mail_failed" }, 502); }
    await admin.from("siv_requests").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", r.id);
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: "server" }, 500);
  }
});
