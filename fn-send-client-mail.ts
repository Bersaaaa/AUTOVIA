// Edge Function : envoie un e-mail au client d'un dossier (devis, facture, relance, demande d'avis…).
// Réservé à l'agence (is_staff). Le destinataire est TOUJOURS l'e-mail enregistré dans le dossier.
// Secrets : RESEND_API_KEY, CLIENT_FROM_EMAIL (ou SIV_FROM_EMAIL), SITE_URL (ex. https://www.mon-site.fr)
// Déploiement sans ligne de commande : Supabase > Edge Functions > Deploy a new function > nom « send-client-mail » > coller tout ce fichier.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: staff } = await user.rpc("is_staff");
    if (staff !== true) return json({ error: "forbidden" }, 403);
    const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("CLIENT_FROM_EMAIL") || Deno.env.get("SIV_FROM_EMAIL");
    if (!key || !from) return json({ error: "mail_not_configured" }, 500);

    const b = await req.json();
    const { data: d } = await user.from("deals").select("*").eq("id", b.deal_id).maybeSingle();
    if (!d) return json({ error: "not_found" }, 404);
    if (!d.client_email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.client_email)) return json({ error: "no_email" }, 400);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: st } = await admin.from("agency_settings").select("data").eq("id", 1).maybeSingle();
    const S = (st?.data ?? {}) as Record<string, string>;
    const agency = S.name || S.company || "Notre agence";
    const site = (Deno.env.get("SITE_URL") || "").replace(/\/$/, "");

    let subject = String(b.subject ?? "").slice(0, 200), body = String(b.body ?? "").slice(0, 8000), kind = String(b.kind ?? "custom");
    if (kind === "review") {
      if (d.review_requested_at) return json({ ok: true, skipped: "already_requested" });
      subject = `Votre avis sur votre achat chez ${agency}`;
      body = `Bonjour ${d.client_name},\n\nMerci pour votre confiance. Si vous le souhaitez, vous pouvez donner votre avis sur votre achat depuis votre espace client${site ? " : " + site + "/compte" : ""}.\n\nVotre retour, positif ou critique, nous aide à progresser.\n\nCordialement,`;
    }
    if (!subject.trim() || !body.trim()) return json({ error: "empty" }, 400);

    let link = "";
    if (b.link_invoice && d.invoice_path) {
      const { data: s } = await admin.storage.from("client-documents").createSignedUrl(d.invoice_path, 60 * 60 * 24 * 7);
      if (s?.signedUrl) link = s.signedUrl;
    }
    const sig = [agency, S.phone, S.email].filter(Boolean).join(" · ");
    const html = `<div style="font:15px/1.6 system-ui,sans-serif;color:#0b1b3f;max-width:620px">${esc(body).replace(/\n/g, "<br>")}${link ? `<p><a href="${esc(link)}">Télécharger la facture</a> <span style="color:#55607a;font-size:13px">(lien valable 7 jours)</span></p>` : ""}<hr style="border:0;border-top:1px solid #dfe6f3;margin:20px 0"><p style="color:#55607a;font-size:13px">${esc(sig)}</p></div>`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [d.client_email], subject, html, reply_to: S.email || undefined }),
    });
    if (!res.ok) { console.error(await res.text()); return json({ error: "mail_failed" }, 502); }
    await admin.from("deal_mails").insert({ deal_id: d.id, kind, to_email: d.client_email, subject, body, created_by: null });
    if (kind === "review") await admin.from("deals").update({ review_requested_at: new Date().toISOString() }).eq("id", d.id);
    return json({ ok: true });
  } catch (e) { console.error(e); return json({ error: "server" }, 500); }
});
