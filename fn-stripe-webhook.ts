// Edge Function « stripe-webhook » (Verify JWT : DÉSACTIVÉ, la sécurité vient de la signature Stripe).
// Stripe > Développeurs > Webhooks > Ajouter un endpoint : https://<PROJET>.supabase.co/functions/v1/stripe-webhook
// Événements : checkout.session.completed, checkout.session.expired. Copiez la « clé de signature » (whsec_…) dans le secret STRIPE_WEBHOOK_SECRET.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const eur = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function verify(raw: string, header: string, secret: string) {
  const p = Object.fromEntries(header.split(",").map((x) => x.split("=") as [string, string]));
  const t = Number(p.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${t}.${raw}`)));
  // plusieurs v1 possibles : on compare à tous
  return header.split(",").filter((x) => x.startsWith("v1=")).some((x) => {
    const v = x.slice(3);
    if (v.length !== sig.length) return false;
    let d = 0; for (let i = 0; i < v.length; i++) d |= v.charCodeAt(i) ^ sig.charCodeAt(i);
    return d === 0;
  });
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const raw = await req.text();
  if (!secret || !(await verify(raw, req.headers.get("stripe-signature") ?? "", secret))) return new Response("bad signature", { status: 400 });
  try {
    const ev = JSON.parse(raw);
    const s = ev.data?.object ?? {};
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("CLIENT_FROM_EMAIL") ?? Deno.env.get("SIV_FROM_EMAIL"), agency = Deno.env.get("SIV_TO_EMAIL");
    const send = async (rcpt: string | undefined, subject: string, inner: string) => {
      if (!key || !from || !rcpt) return;
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [rcpt], subject, html: `<div style="font:15px/1.55 system-ui,sans-serif;color:#0b1b3f;max-width:620px">${inner}</div>` }) });
      if (!r.ok) console.error(await r.text());
    };
    const rid = s.metadata?.reservation_id, sid = s.metadata?.siv_id;

    if (ev.type === "checkout.session.completed" && rid) {
      const { data: r } = await admin.from("reservations").select("*").eq("id", rid).maybeSingle();
      if (!r || r.status !== "pending") return new Response("ok");
      const now = new Date(), exp = new Date(now.getTime() + 7 * 864e5);
      await admin.from("reservations").update({ status: "held", held_at: now.toISOString(), expires_at: exp.toISOString(), stripe_payment_intent: s.payment_intent }).eq("id", rid);
      if (r.vehicle_id) await admin.from("vehicles").update({ status: "reserved" }).eq("id", r.vehicle_id).eq("status", "available");
      const d = exp.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
      await send(r.client_email, `Réservation confirmée : ${r.vehicle_label}`, `<p>Bonjour ${esc(r.client_name)},</p><p>Votre réservation de <b>${esc(r.vehicle_label)}</b> est confirmée. Un montant de <b>${eur(r.amount)}</b> est <b>bloqué</b> sur votre carte jusqu'au <b>${d}</b> (7 jours).</p><p>Contactez-nous avant cette date pour acheter le véhicule : l'acompte est déduit du prix. Si vous renoncez <b>avant cette date</b>, annulez en un clic : l'acompte vous est rendu (aucun prélèvement). Sans achat ni réponse de votre part avant cette date, l'acompte est conservé, comme indiqué dans les conditions de réservation que vous avez acceptées.</p><p><a href="${(Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "")}/reservation?id=${r.id}&t=${r.cancel_token}">Annuler ma réservation</a></p>`);
      await send(agency, `Nouvelle réservation : ${r.vehicle_label}`, `<p><b>${esc(r.client_name)}</b> (${esc(r.client_email)}, ${esc(r.client_phone)}) a réservé <b>${esc(r.vehicle_label)}</b> avec ${eur(r.amount)} bloqués jusqu'au ${d}.</p><p>Contactez-le vite : Agence › Réservations.</p>`);
    }
    if (ev.type === "checkout.session.expired" && rid) {
      await admin.from("reservations").update({ status: "expired" }).eq("id", rid).eq("status", "pending");
    }
    if (ev.type === "checkout.session.completed" && sid && s.payment_status === "paid") {
      const { data: r } = await admin.from("siv_requests").select("*").eq("id", sid).maybeSingle();
      if (r) {
        await admin.from("siv_requests").update({ data: { ...(r.data ?? {}), pay_status: "paid", paid_at: new Date().toISOString() } }).eq("id", sid);
        const amt = (s.amount_total ?? 0) / 100;
        await admin.from("accounting_entries").insert({ kind: "recette", category: "Carte grise", label: `Carte grise ${r.data?.numero ?? ""} (${r.client_name})`, amount_ttc: amt, vat_amount: 0, payment_mode: "carte" });
        await send(r.client_email, `Paiement reçu : ${r.data?.numero ?? ""}`, `<p>Bonjour ${esc(r.client_name)},</p><p>Nous avons bien reçu votre paiement de ${eur(amt)}. Nous traitons votre démarche.</p>`);
        await send(agency, `Paiement reçu : ${r.data?.numero ?? ""}`, `<p>${esc(r.client_name)} a payé ${eur(amt)} pour la démarche ${esc(r.data?.numero ?? "")}.</p>`);
      }
    }
    return new Response("ok");
  } catch (e) {
    console.error(e);
    return new Response("error", { status: 500 }); // Stripe réessaiera
  }
});
