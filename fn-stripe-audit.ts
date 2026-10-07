// Edge Function « stripe-audit » (Verify JWT : DÉSACTIVÉ ; accès = en-tête x-cron-secret OU agence connectée).
// Compare les paiements Stripe des 3 derniers jours avec votre base : réservations et paiements carte grise.
// Corrige tout seul ce qui peut l'être (webhook raté) et vous envoie un e-mail pour le reste.
// À lancer chaque jour (pg_cron) et depuis le bouton « Vérifier les paiements » (Agence › Réservations).
// Secrets : STRIPE_SECRET_KEY, CRON_SECRET, RESEND_API_KEY, SIV_TO_EMAIL, CLIENT_FROM_EMAIL (ou SIV_FROM_EMAIL), SITE_URL.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const eur = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const cron = Deno.env.get("CRON_SECRET");
  let allowed = !!cron && req.headers.get("x-cron-secret") === cron;
  if (!allowed) {
    const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: staff } = await user.rpc("is_staff");
    allowed = staff === true;
  }
  if (!allowed) return json({ error: "forbidden" }, 403);
  const sk = Deno.env.get("STRIPE_SECRET_KEY");
  if (!sk) return json({ error: "stripe_not_configured" }, 500);
  try {
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const since = Math.floor((Date.now() - 3 * 86400_000) / 1000);
    const sessions: Record<string, any>[] = [];
    let after = "";
    for (let page = 0; page < 5; page++) {
      const r = await fetch(`https://api.stripe.com/v1/checkout/sessions?limit=100&created[gte]=${since}${after ? "&starting_after=" + after : ""}`, { headers: { Authorization: `Bearer ${sk}` } });
      const j = await r.json();
      if (!r.ok) { console.error(JSON.stringify(j)); return json({ error: "stripe_error" }, 502); }
      sessions.push(...j.data);
      if (!j.has_more) break;
      after = j.data[j.data.length - 1].id;
    }
    const fixed: string[] = [], alerts: string[] = [];
    let checked = 0;
    for (const s of sessions) {
      if (s.status !== "complete") continue;
      const rid = s.metadata?.reservation_id, sid = s.metadata?.siv_id;
      if (rid) {
        checked++;
        const { data: r } = await admin.from("reservations").select("*").eq("id", rid).maybeSingle();
        if (!r) { alerts.push(`Paiement Stripe ${s.id} (${eur((s.amount_total ?? 0) / 100)}) sans réservation correspondante : à vérifier dans Stripe.`); continue; }
        if (r.status === "pending") {
          const { data: v } = r.vehicle_id ? await admin.from("vehicles").select("status").eq("id", r.vehicle_id).maybeSingle() : { data: null };
          if (v && v.status !== "available") { alerts.push(`Réservation de ${esc(r.client_name)} payée (${eur(r.amount)}) mais le véhicule « ${esc(r.vehicle_label)} » n'est plus disponible : annulez le blocage (Réservations › Libérer) ou contactez le client.`); }
          const now = new Date();
          await admin.from("reservations").update({ status: "held", held_at: now.toISOString(), expires_at: new Date(now.getTime() + 7 * 864e5).toISOString(), stripe_payment_intent: s.payment_intent }).eq("id", rid);
          if (r.vehicle_id) await admin.from("vehicles").update({ status: "reserved" }).eq("id", r.vehicle_id).eq("status", "available");
          fixed.push(`Réservation de ${esc(r.client_name)} (${esc(r.vehicle_label)}) : le webhook n'avait pas été reçu, elle est maintenant enregistrée (7 jours à partir de maintenant).`);
        } else if (r.status === "expired") {
          alerts.push(`Réservation de ${esc(r.client_name)} (${esc(r.vehicle_label)}) marquée « non finalisée » alors que le client a payé ${eur(r.amount)} : à traiter à la main (rembourser ou réactiver).`);
        }
      } else if (sid && s.payment_status === "paid") {
        checked++;
        const { data: r } = await admin.from("siv_requests").select("*").eq("id", sid).maybeSingle();
        if (!r) { alerts.push(`Paiement Stripe ${s.id} (${eur((s.amount_total ?? 0) / 100)}) sans demande carte grise correspondante.`); continue; }
        const numero = r.data?.numero ?? "";
        const amt = (s.amount_total ?? 0) / 100;
        if (r.data?.pay_status !== "paid") {
          await admin.from("siv_requests").update({ data: { ...(r.data ?? {}), pay_status: "paid", paid_at: new Date().toISOString() }, ...(["draft", "sent"].includes(r.status) ? { status: "paid" } : {}) }).eq("id", sid);
          fixed.push(`Carte grise ${esc(numero)} (${esc(r.client_name)}) : paiement de ${eur(amt)} marqué comme payé (webhook manqué).`);
        }
        const { count } = numero ? await admin.from("accounting_entries").select("id", { count: "exact", head: true }).ilike("label", `%${numero}%`) : { count: 1 };
        if (!count) {
          await admin.from("accounting_entries").insert({ kind: "recette", category: "Carte grise", label: `Carte grise ${numero} (${r.client_name})`, amount_ttc: amt, vat_amount: 0, payment_mode: "carte" });
          fixed.push(`Carte grise ${esc(numero)} : recette de ${eur(amt)} ajoutée en compta (elle manquait).`);
        }
      }
    }
    const lines = [...alerts.map((a) => `⚠ ${a}`), ...fixed.map((f) => `✓ ${f}`)];
    const to = Deno.env.get("SIV_TO_EMAIL"), key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("CLIENT_FROM_EMAIL") ?? Deno.env.get("SIV_FROM_EMAIL");
    if (lines.length && to && key && from) {
      await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject: `Contrôle des paiements : ${alerts.length} alerte(s), ${fixed.length} correction(s)`, html: `<div style="font:15px/1.6 system-ui,sans-serif;color:#0b1b3f;max-width:640px"><h3>Contrôle des paiements Stripe (3 derniers jours)</h3><ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul></div>` }) });
    }
    return json({ ok: true, checked, fixed, alerts });
  } catch (e) { console.error(e); return json({ error: "server" }, 500); }
});
