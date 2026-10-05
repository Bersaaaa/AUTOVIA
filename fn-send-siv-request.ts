// Edge Function Supabase : envoie une demande SIV par e-mail à la boîte de SBR CARTE GRISE.
// Déploiement :
//   supabase secrets set RESEND_API_KEY=re_...            (compte gratuit sur resend.com, domaine d'envoi à vérifier)
//   supabase secrets set SIV_TO_EMAIL=adresse@de-la-boite-sbr-carte-grise
//   supabase secrets set SIV_FROM_EMAIL="Demandes SIV <siv@votre-domaine-verifie.fr>"
//   supabase secrets set SIV_REPLY_TO=adresse-de-l-agence   (facultatif)
// Déploiement sans ligne de commande : Supabase > Edge Functions > Deploy a new function > nom « send-siv-request » > coller tout ce fichier.
// La fonction vérifie que l'appelant est un compte agence (is_staff) avant d'envoyer quoi que ce soit.
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
  changement_titulaire: "Changement de titulaire (achat d'un véhicule d'occasion)",
  declaration_achat: "Déclaration d'achat (reprise professionnelle)",
  declaration_cession: "Déclaration de cession",
  premiere_immat: "Première immatriculation / véhicule importé",
  duplicata: "Duplicata de carte grise",
  changement_adresse: "Changement d'adresse",
  w_garage: "Certificat W garage",
  autre: "Autre démarche",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: staff } = await user.rpc("is_staff");
    if (staff !== true) return json({ error: "forbidden" }, 403);

    const { id } = await req.json();
    const { data: r, error } = await user.from("siv_requests").select("*").eq("id", id).maybeSingle();
    if (error || !r) return json({ error: "not_found" }, 404);

    const key = Deno.env.get("RESEND_API_KEY"), to = Deno.env.get("SIV_TO_EMAIL"), from = Deno.env.get("SIV_FROM_EMAIL");
    if (!key || !to || !from) return json({ error: "mail_not_configured" }, 500);

    // Liens temporaires (7 jours) vers les pièces jointes, bucket privé.
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const links: { name: string; url: string }[] = [];
    for (const f of (r.files ?? []) as { path: string; name: string }[]) {
      const { data } = await admin.storage.from("siv-files").createSignedUrl(f.path, 60 * 60 * 24 * 7);
      if (data?.signedUrl) links.push({ name: f.name, url: data.signedUrl });
    }

    const d = (r.data ?? {}) as Record<string, string>;
    const rows: [string, unknown][] = [
      ["Démarche", KINDS[r.kind] ?? r.kind],
      ["Référence", r.id.slice(0, 8).toUpperCase()],
      ["Client", r.client_name], ["E-mail", r.client_email], ["Téléphone", r.client_phone], ["Adresse", r.client_address],
      ["Date de naissance", d.birth_date], ["Lieu de naissance", d.birth_place],
      ["Véhicule", r.vehicle_label], ["Immatriculation", r.plate], ["N° VIN", r.vin],
      ["1re immatriculation", d.first_reg_date], ["Kilométrage", d.mileage], ["Date de cession / achat", d.deal_date],
      ["Notes", r.notes],
    ];
    const html = `<div style="font:15px/1.5 system-ui,sans-serif;color:#0b1b3f;max-width:640px">
<h2 style="margin:0 0 12px">Nouvelle demande SIV</h2>
<table style="border-collapse:collapse;width:100%">${rows.filter(([, v]) => v).map(([k, v]) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #dfe6f3;color:#55607a;width:38%">${esc(k)}</td><td style="padding:6px 10px;border-bottom:1px solid #dfe6f3"><b>${esc(v)}</b></td></tr>`).join("")}</table>
<h3 style="margin:20px 0 6px">Pièces jointes</h3>${links.length ? `<ul>${links.map((l) => `<li><a href="${esc(l.url)}">${esc(l.name)}</a></li>`).join("")}</ul><p style="color:#55607a;font-size:13px">Liens valables 7 jours : téléchargez les pièces dès réception.</p>` : "<p>Aucune pièce jointe.</p>"}</div>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: [to], subject: `[SIV] ${KINDS[r.kind] ?? r.kind} — ${r.client_name}${r.plate ? " — " + r.plate : ""}`,
        html, reply_to: Deno.env.get("SIV_REPLY_TO") || undefined,
      }),
    });
    if (!res.ok) { console.error(await res.text()); return json({ error: "mail_failed" }, 502); }

    await user.from("siv_requests").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", id);
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: "server" }, 500);
  }
});
