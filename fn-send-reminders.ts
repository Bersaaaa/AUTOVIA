// Edge Function planifiée (1 fois par jour) : rappel la veille des rendez-vous (client + agence), récapitulatif quotidien
// pour l'agence (devis sans réponse, garanties qui expirent, contrôles techniques, véhicules qui dorment)
// et, si l'option est cochée dans Paramètres, relance automatique UNIQUE des devis sans réponse depuis 3 jours.
// Pré-requis : supabase_v13.sql.
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
  // ---- Relance devis + récapitulatif quotidien
  const DAY = 86400_000, now = Date.now(), A = S as unknown as Record<string, unknown>;
  const { data: offers } = await admin.from("deals").select("*").eq("stage", "offer").order("updated_at");
  const stale = (offers ?? []).filter((d) => !String(d.deal_type ?? "").startsWith("achat") && now - new Date(d.updated_at).getTime() >= 3 * DAY);
  let q = 0;
  if (A.auto_quote === true) {
    for (const d of stale) {
      if (!d.client_email || !("quote_reminded_at" in d) || d.quote_reminded_at) continue;
      const r = await send(d.client_email, `Votre projet auto — ${agency}`,
        `<div style="font:15px/1.6 system-ui,sans-serif;color:#0b1b3f;max-width:560px"><p>Bonjour ${esc(d.client_name)},</p><p>Je reviens vers vous au sujet de notre proposition. Votre projet est-il toujours d'actualité ? Je peux vous rappeler ou fixer un rendez-vous à votre convenance.</p><p>${esc([S.phone, S.address].filter(Boolean).join(" · "))}</p><p style="color:#55607a">${esc(agency)}</p></div>`);
      if (r.ok) { await admin.from("deals").update({ quote_reminded_at: new Date().toISOString() }).eq("id", d.id); q++; } else console.error(await r.text());
    }
  }
  const items: string[] = [];
  stale.forEach((d) => items.push(`Devis sans réponse depuis ${Math.floor((now - new Date(d.updated_at).getTime()) / DAY)} j : <b>${esc(d.client_name)}</b>${d.client_phone ? " · " + esc(d.client_phone) : ""}`));
  const { data: won } = await admin.from("deals").select("*").in("stage", ["signed", "delivered"]);
  (won ?? []).forEach((d) => {
    if (!d.warranty_kind || !d.warranty_months || !d.warranty_start) return;
    const en = new Date(d.warranty_start); en.setMonth(en.getMonth() + Number(d.warranty_months));
    const left = Math.ceil((en.getTime() - now) / DAY);
    if (left >= 0 && left <= 30) items.push(`Garantie de <b>${esc(d.client_name)}</b> expire dans ${left} j : proposer une extension`);
  });
  const { data: veh } = await admin.from("vehicles").select("id,brand,model,year,created_at").eq("status", "available");
  const { data: cst } = await admin.from("vehicle_costs").select("*");
  const C = Object.fromEntries((cst ?? []).map((c) => [c.vehicle_id, c]));
  (veh ?? []).forEach((v) => {
    const c = C[v.id] ?? {}, name = esc(`${v.brand} ${v.model}`), ry = c.first_reg_date ? new Date(c.first_reg_date).getFullYear() : v.year;
    if (ry && new Date().getFullYear() - ry >= 4) {
      if (!c.ct_date) items.push(`${name} : date du contrôle technique non renseignée`);
      else { const en = new Date(c.ct_date); en.setMonth(en.getMonth() + 6); const left = Math.ceil((en.getTime() - now) / DAY); if (left <= 30) items.push(`${name} : contrôle technique ${left < 0 ? "périmé pour la vente" : "à refaire sous " + left + " j"}`); }
    }
    const age = Math.floor((now - new Date(c.purchased_at ?? v.created_at).getTime()) / DAY);
    if (age > 60) items.push(`${name} : ${age} j en stock, revoir le prix`);
  });
  if (items.length && S.email) {
    await send(S.email, `À traiter aujourd'hui : ${items.length} point(s) — ${agency}`,
      `<div style="font:15px/1.6 system-ui,sans-serif;color:#0b1b3f"><h3>À traiter</h3><ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>${q ? `<p style="color:#55607a">${q} relance(s) de devis envoyée(s) automatiquement aux clients.</p>` : ""}</div>`);
  }
  return new Response(JSON.stringify({ reminded: n, total: todo.length, quotes: q, items: items.length }), { headers: { "Content-Type": "application/json" } });
});
