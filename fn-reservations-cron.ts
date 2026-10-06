// Edge Function « reservations-cron » (Verify JWT : DÉSACTIVÉ ; protégée par l'en-tête x-cron-secret = secret CRON_SECRET).
// À lancer CHAQUE HEURE (pg_cron) : encaisse les acomptes dont le délai est écoulé et prévient les clients.
// Une autorisation de carte dure environ 7 jours au maximum : on encaisse à 6 j 16 h pour garder une marge.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const eur = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
const CAPTURE_AFTER_H = 160;

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return new Response("forbidden", { status: 403 });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const sk = Deno.env.get("STRIPE_SECRET_KEY"), key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("CLIENT_FROM_EMAIL") ?? Deno.env.get("SIV_FROM_EMAIL"), agency = Deno.env.get("SIV_TO_EMAIL");
  const send = async (rcpt: string | undefined, subject: string, inner: string) => {
    if (!key || !from || !rcpt) return;
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [rcpt], subject, html: `<div style="font:15px/1.55 system-ui,sans-serif;color:#0b1b3f;max-width:620px">${inner}</div>` }) });
    if (!r.ok) console.error(await r.text());
  };
  const out = { captured: 0, warned: 0, expired: 0, errors: 0 };
  const { data: held } = await admin.from("reservations").select("*").eq("status", "held");
  for (const r of held ?? []) {
    const ageH = (Date.now() - new Date(r.held_at).getTime()) / 36e5;
    try {
      if (ageH >= CAPTURE_AFTER_H && r.stripe_payment_intent && sk) {
        const c = await fetch(`https://api.stripe.com/v1/payment_intents/${r.stripe_payment_intent}/capture`, { method: "POST", headers: { Authorization: `Bearer ${sk}` } });
        if (!c.ok) { console.error(await c.text()); out.errors++; await send(agency, `ACTION REQUISE : encaissement impossible (${r.vehicle_label})`, `<p>L'acompte de ${esc(r.client_name)} n'a pas pu être encaissé automatiquement (autorisation expirée ?). Vérifiez dans Stripe. Le véhicule reste « réservé » : agence › Réservations.</p>`); continue; }
        await admin.from("reservations").update({ status: "kept" }).eq("id", r.id);
        await admin.from("accounting_entries").insert({ kind: "recette", category: "Arrhes conservées", label: `Arrhes conservées : ${r.vehicle_label} (${r.client_name})`, amount_ttc: r.amount, vat_amount: 0, payment_mode: "carte" });
        if (r.vehicle_id) await admin.from("vehicles").update({ status: "available" }).eq("id", r.vehicle_id).eq("status", "reserved");
        await send(r.client_email, `Délai de réservation écoulé : ${r.vehicle_label}`, `<p>Bonjour ${esc(r.client_name)},</p><p>Le délai de 7 jours est écoulé sans achat, sans réponse et sans annulation de votre part : l'acompte de ${eur(r.amount)} est conservé, comme prévu dans les conditions de réservation. Le véhicule est remis en vente.</p>`);
        await send(agency, `Acompte conservé : ${r.vehicle_label}`, `<p>Délai écoulé : ${eur(r.amount)} encaissés (${esc(r.client_name)}). Véhicule remis en vente.</p>`);
        out.captured++;
      } else if (ageH >= 96 && !r.warned_at) {
        await admin.from("reservations").update({ warned_at: new Date().toISOString() }).eq("id", r.id);
        const d = new Date(r.expires_at).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
        await send(r.client_email, `Rappel : votre réservation se termine bientôt (${r.vehicle_label})`, `<p>Bonjour ${esc(r.client_name)},</p><p>Votre réservation de <b>${esc(r.vehicle_label)}</b> se termine le ${d}. Contactez-nous avant cette date pour finaliser l'achat. Si vous renoncez, annulez avant cette date : <a href="${(Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "")}/reservation?id=${r.id}&t=${r.cancel_token}">annuler ma réservation</a> (acompte rendu). Sinon l'acompte de ${eur(r.amount)} sera conservé.</p>`);
        out.warned++;
      }
    } catch (e) { console.error(e); out.errors++; }
  }
  // nettoyage : paiements jamais terminés
  const { data: gone } = await admin.from("reservations").update({ status: "expired" }).eq("status", "pending").lt("created_at", new Date(Date.now() - 2 * 36e5).toISOString()).select("id");
  out.expired = gone?.length ?? 0;
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
});
