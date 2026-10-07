// Edge Function « siv-notify » (Verify JWT : ACTIVÉ). Réservée à l'agence : envoie au client le mail correspondant au nouveau statut
// de sa demande de carte grise (paiement confirmé, documents à corriger, en traitement, terminé, refusée).
// Secrets : RESEND_API_KEY, CLIENT_FROM_EMAIL (ou SIV_FROM_EMAIL), SITE_URL.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const KINDS: Record<string, string> = { duplicata: "duplicata de carte grise", changement_adresse: "changement d'adresse", changement_titulaire: "changement de titulaire" };

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
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: r } = await admin.from("siv_requests").select("*").eq("id", b.id).maybeSingle();
    if (!r) return json({ error: "not_found" }, 404);
    if (!r.client_email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.client_email)) return json({ error: "no_email" }, 400);
    const status = String(b.status ?? r.status), note = String(b.message ?? "").trim().slice(0, 1000);
    if (r.last_notified_status === status && !note) return json({ ok: true, skipped: "already_sent" });
    const S = ((await admin.from("agency_settings").select("data").eq("id", 1).maybeSingle()).data?.data ?? {}) as Record<string, string>;
    const agency = S.brand || S.name || S.company || "Notre agence", site = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
    const numero = r.data?.numero ?? "", what = KINDS[r.kind] ?? "démarche de carte grise";
    const link = site && numero ? `${site}/suivi-carte-grise?n=${numero}&e=${encodeURIComponent(r.client_email)}` : "";
    const T: Record<string, [string, string]> = {
      paid: ["Paiement confirmé", "Nous avons bien reçu votre paiement. Nous vérifions maintenant votre dossier."],
      to_fix: ["Documents à corriger", "Il faut corriger ou compléter certaines pièces pour que nous puissions traiter votre dossier."],
      in_progress: ["Dossier en traitement", "Votre dossier est complet : nous effectuons votre démarche."],
      done: ["Démarche terminée", "Votre démarche est effectuée. Les documents officiels vous parviennent selon les délais de l'administration."],
      rejected: ["Dossier refusé", "Nous ne pouvons pas traiter votre demande en l'état."],
    };
    if (!T[status]) return json({ ok: true, skipped: "no_mail_for_status" });
    if (status === "to_fix") await admin.from("siv_requests").update({ data: { ...(r.data ?? {}), fix_message: note } }).eq("id", r.id);
    const html = `<div style="font:15px/1.6 system-ui,sans-serif;color:#0b1b3f;max-width:600px"><p>Bonjour ${esc(r.client_name)},</p><p><b>${T[status][0]}</b> : votre ${esc(what)}${numero ? ` (dossier <b>${esc(numero)}</b>)` : ""}.</p><p>${T[status][1]}</p>${note ? `<p style="background:#f2f6ff;border-left:4px solid #1d4ed8;padding:10px 14px">${esc(note).replace(/\n/g, "<br>")}</p>` : ""}${link ? `<p><a href="${esc(link)}">Suivre mon dossier${status === "to_fix" ? " et envoyer les pièces" : ""}</a></p>` : ""}<p style="color:#55607a;font-size:13px">${esc([agency, S.phone, S.email].filter(Boolean).join(" · "))}</p></div>`;
    const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [r.client_email], subject: `${T[status][0]}${numero ? " — " + numero : ""} — ${agency}`, html, reply_to: S.email || undefined }) });
    if (!res.ok) { console.error(await res.text()); return json({ error: "mail_failed" }, 502); }
    await admin.from("siv_requests").update({ last_notified_status: status }).eq("id", r.id);
    return json({ ok: true });
  } catch (e) { console.error(e); return json({ error: "server" }, 500); }
});
