// Edge Function planifiée : rappel la veille des rendez-vous (client + récapitulatif pour l'agence).
// Déploiement sans ligne de commande : Supabase > Edge Functions > Deploy a new function > nom « send-reminders » > coller tout ce fichier > désactiver « Verify JWT ».
// Secrets : RESEND_API_KEY, CLIENT_FROM_EMAIL (ou SIV_FROM_EMAIL), CRON_SECRET (valeur de votre choix)
// Planification (voir README) : tous les jours à 15:00 UTC, avec l'en-tête x-cron-secret.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const KIND: Record<string, string> = { visit: "Visite", test_drive: "Essai", delivery: "Livraison", other: "Rendez-vous" };
const day = (d: Date) => d.toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
const hm = (d: Date) => d.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET") || !Deno.env.get("CRON_SECRET")) return new Response("forbidden", { status: 403 });
  const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("CLIENT_FROM_EMAIL") || Deno.env.get("SIV_FROM_EMAIL");
  if (!key || !from) return new Response("mail_not_configured", { status: 500 });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: st } = await admin.from("agency_settings").select("data").eq("id", 1).maybeSingle();
  const S = (st?.data ?? {}) as Record<string, string>;
  const agency = S.name || S.company || "Notre agence";
  const tomorrow = day(new Date(Date.now() + 24 * 3600_000));
  const { data: list } = await admin.from("appointments").select("*").eq("done", false).is("reminder_sent_at", null)
    .gte("starts_at", new Date().toISOString()).lte("starts_at", new Date(Date.now() + 49 * 3600_000).toISOString()).order("starts_at");
  const todo = (list ?? []).filter((a) => day(new Date(a.starts_at)) === tomorrow);
  const send = (to: string, subject: string, html: string) => fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html, reply_to: S.email || undefined }),
  });
  let n = 0;
  for (const a of todo) {
    const t = new Date(a.starts_at);
    if (a.client_email) {
      const r = await send(a.client_email, `Rappel : ${KIND[a.kind] ?? "rendez-vous"} demain à ${hm(t)} — ${agency}`,
        `<div style="font:15px/1.6 system-ui,sans-serif;color:#0b1b3f;max-width:560px"><p>Bonjour ${esc(a.client_name)},</p><p>Nous vous rappelons votre rendez-vous <b>demain à ${hm(t)}</b>${a.vehicle_label ? ` pour le véhicule <b>${esc(a.vehicle_label)}</b>` : ""}.</p><p>${esc([S.address, S.phone].filter(Boolean).join(" · "))}</p><p>Un empêchement ? Répondez à ce message ou appelez-nous.</p><p style="color:#55607a">${esc(agency)}</p></div>`);
      if (!r.ok) { console.error(await r.text()); continue; }
    }
    await admin.from("appointments").update({ reminder_sent_at: new Date().toISOString() }).eq("id", a.id);
    n++;
  }
  if (todo.length && S.email) {
    await send(S.email, `Agenda de demain : ${todo.length} rendez-vous`,
      `<div style="font:15px/1.6 system-ui,sans-serif;color:#0b1b3f"><h3>Demain</h3><ul>${todo.map((a) => `<li><b>${hm(new Date(a.starts_at))}</b> · ${KIND[a.kind] ?? ""} · ${esc(a.client_name)}${a.client_phone ? " · " + esc(a.client_phone) : ""}${a.vehicle_label ? " · " + esc(a.vehicle_label) : ""}</li>`).join("")}</ul></div>`);
  }
  return new Response(JSON.stringify({ reminded: n, total: todo.length }), { headers: { "Content-Type": "application/json" } });
});
