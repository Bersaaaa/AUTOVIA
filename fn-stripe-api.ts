// Edge Function « stripe-api » (Verify JWT : DÉSACTIVÉ, les contrôles sont faits dans le code).
// Public : reserve (réservation d'un véhicule avec acompte bloqué), reservation_status.
// Agence connectée (JWT + rôle staff) : release, keep, convert, cg_pay.
// Secrets : STRIPE_SECRET_KEY, SITE_URL, RESEND_API_KEY, SIV_FROM_EMAIL (ou CLIENT_FROM_EMAIL), SIV_TO_EMAIL.
// L'acompte est une AUTORISATION bancaire (capture manuelle) : l'argent est bloqué, pas encore prélevé.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cut = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const eur = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);

async function stripe(path: string, params: Record<string, string> | null, method = "POST") {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new Error("stripe_not_configured");
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params ? new URLSearchParams(params).toString() : undefined,
  });
  const j = await r.json();
  if (!r.ok) { console.error("stripe", path, JSON.stringify(j)); throw new Error(j?.error?.code || "stripe_error"); }
  return j;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json();
    if (b.website) return json({ ok: true });
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const site = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
    const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("CLIENT_FROM_EMAIL") ?? Deno.env.get("SIV_FROM_EMAIL"), agency = Deno.env.get("SIV_TO_EMAIL");
    const send = async (rcpt: string | undefined, subject: string, inner: string) => {
      if (!key || !from || !rcpt) return;
      const html = `<div style="font:15px/1.55 system-ui,sans-serif;color:#0b1b3f;max-width:620px">${inner}</div>`;
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [rcpt], subject, html }) });
      if (!r.ok) console.error(await r.text());
    };
    const settings = async () => (await admin.from("agency_settings").select("data").eq("id", 1).maybeSingle()).data?.data ?? {};
    const action = b.action;

    // ---------- PUBLIC : réserver un véhicule ----------
    if (action === "reserve") {
      const S = await settings();
      if (S.reserve_on === false) return json({ error: "disabled" }, 403);
      const name = cut(b.name, 120), email = cut(b.email, 160).toLowerCase(), phone = cut(b.phone, 30);
      if (name.length < 2 || !EMAIL.test(email) || phone.length < 6 || b.consent !== true || !/^[0-9a-f-]{36}$/i.test(String(b.vehicle_id))) return json({ error: "invalid" }, 400);
      const amount = Math.min(5000, Math.max(50, Number(S.reserve_amount) || 500)); // jamais le montant venu du navigateur
      const { data: v } = await admin.from("vehicles").select("id,brand,model,version,status,slug").eq("id", b.vehicle_id).maybeSingle();
      if (!v || v.status !== "available") return json({ error: "unavailable" }, 409);
      const since = new Date(Date.now() - 3600_000).toISOString();
      const { count: recent } = await admin.from("reservations").select("id", { count: "exact", head: true }).eq("client_email", email).gte("created_at", since);
      if ((recent ?? 0) >= 3) return json({ error: "rate" }, 429);
      const { data: busy } = await admin.from("reservations").select("id,created_at,status").eq("vehicle_id", v.id).in("status", ["pending", "held"]);
      const live = (busy ?? []).filter((x) => x.status === "held" || Date.now() - new Date(x.created_at).getTime() < 35 * 60_000);
      if (live.length) return json({ error: "busy" }, 409);
      const label = [v.brand, v.model, v.version].filter(Boolean).join(" ");
      const { data: row, error } = await admin.from("reservations").insert({ vehicle_id: v.id, vehicle_label: label, client_name: name, client_email: email, client_phone: phone, amount, consent_at: new Date().toISOString() }).select("id").single();
      if (error || !row) { console.error(error); return json({ error: "server" }, 500); }
      const sess = await stripe("checkout/sessions", {
        mode: "payment", "payment_method_types[0]": "card", locale: "fr", customer_email: email,
        "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "eur",
        "line_items[0][price_data][unit_amount]": String(Math.round(amount * 100)),
        "line_items[0][price_data][product_data][name]": `Réservation : ${label}`,
        "line_items[0][price_data][product_data][description]": "Acompte bloqué 7 jours sur votre carte (autorisation). Annulation gratuite avant la fin du délai.",
        "payment_intent_data[capture_method]": "manual", "payment_intent_data[metadata][reservation_id]": row.id,
        "metadata[reservation_id]": row.id, client_reference_id: row.id,
        success_url: `${site}/reservation?ok=1&id=${row.id}`, cancel_url: `${site}/vehicule/${v.slug ?? ""}`,
        expires_at: String(Math.floor(Date.now() / 1000) + 31 * 60),
      });
      await admin.from("reservations").update({ stripe_session_id: sess.id }).eq("id", row.id);
      return json({ ok: true, url: sess.url });
    }

    if (action === "reservation_status") {
      if (!/^[0-9a-f-]{36}$/i.test(String(b.id))) return json({ error: "invalid" }, 400);
      const { data: r } = await admin.from("reservations").select("status,vehicle_label,amount,expires_at,cancel_token").eq("id", b.id).maybeSingle();
      if (!r) return json({ error: "not_found" }, 404);
      const { cancel_token, ...pub } = r;
      return json({ ok: true, ...pub, can_cancel: r.status === "held" && !!b.token && b.token === cancel_token });
    }

    // ---------- PUBLIC : le client renonce avant la fin du délai => blocage levé, aucun prélèvement ----------
    if (action === "cancel") {
      if (!/^[0-9a-f-]{36}$/i.test(String(b.id)) || !/^[0-9a-f-]{36}$/i.test(String(b.token))) return json({ error: "invalid" }, 400);
      const { data: r } = await admin.from("reservations").select("*").eq("id", b.id).eq("cancel_token", b.token).maybeSingle();
      if (!r) return json({ error: "not_found" }, 404);
      if (r.status !== "held") return json({ error: "not_held" }, 409);
      if (r.expires_at && new Date(r.expires_at).getTime() < Date.now()) return json({ error: "too_late" }, 409);
      if (r.stripe_payment_intent) await stripe(`payment_intents/${r.stripe_payment_intent}/cancel`, {});
      await admin.from("reservations").update({ status: "released", note: "Annulée par le client avant la fin du délai" }).eq("id", r.id);
      if (r.vehicle_id) await admin.from("vehicles").update({ status: "available" }).eq("id", r.vehicle_id).eq("status", "reserved");
      await send(r.client_email, `Réservation annulée : ${r.vehicle_label}`, `<p>Bonjour ${esc(r.client_name)},</p><p>Votre réservation est annulée. Le blocage de ${eur(r.amount)} est levé : vous n'êtes pas débité (votre banque peut mettre quelques jours à le faire disparaître).</p>`);
      await send(agency, `Réservation annulée par le client : ${r.vehicle_label}`, `<p>${esc(r.client_name)} a annulé avant la fin du délai. Acompte libéré, véhicule remis en vente.</p>`);
      return json({ ok: true });
    }

    // ---------- AGENCE : contrôle du JWT et du rôle ----------
    const authH = req.headers.get("Authorization") ?? "";
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authH } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "auth" }, 401);
    const { data: staff } = await userClient.rpc("is_staff");
    if (staff !== true) return json({ error: "forbidden" }, 403);

    if (["release", "keep", "convert"].includes(action)) {
      const { data: r } = await admin.from("reservations").select("*").eq("id", b.id).maybeSingle();
      if (!r) return json({ error: "not_found" }, 404);
      if (r.status !== "held") return json({ error: "not_held" }, 409);
      const pi = r.stripe_payment_intent;
      const back = async (st: string) => { if (r.vehicle_id) await admin.from("vehicles").update({ status: st }).eq("id", r.vehicle_id).eq("status", "reserved"); };
      if (action === "release") {
        if (pi) await stripe(`payment_intents/${pi}/cancel`, {});
        await admin.from("reservations").update({ status: "released" }).eq("id", r.id);
        await back("available");
        await send(r.client_email, `Votre réservation est annulée : ${r.vehicle_label}`, `<p>Bonjour ${esc(r.client_name)},</p><p>Votre réservation de <b>${esc(r.vehicle_label)}</b> est annulée. Le blocage de ${eur(r.amount)} sur votre carte est levé, aucun prélèvement n'est effectué (votre banque peut mettre quelques jours à le faire apparaître).</p>`);
        return json({ ok: true });
      }
      if (pi) await stripe(`payment_intents/${pi}/capture`, {});
      if (action === "keep") {
        await admin.from("reservations").update({ status: "kept" }).eq("id", r.id);
        await admin.from("accounting_entries").insert({ kind: "recette", category: "Arrhes conservées", label: `Arrhes conservées : ${r.vehicle_label} (${r.client_name})`, amount_ttc: r.amount, vat_amount: 0, payment_mode: "carte" });
        await back("available");
        await send(r.client_email, `Réservation terminée : ${r.vehicle_label}`, `<p>Bonjour ${esc(r.client_name)},</p><p>Le délai de renonciation étant écoulé sans achat ni réponse de votre part, l'acompte de ${eur(r.amount)} est conservé conformément aux conditions de réservation acceptées. Le véhicule est remis en vente.</p>`);
        return json({ ok: true });
      }
      // convert : achat confirmé, l'acompte est prélevé et déduit du prix
      const { data: veh } = await admin.from("vehicles").select("price").eq("id", r.vehicle_id).maybeSingle();
      const { data: deal } = await admin.from("deals").insert({ vehicle_id: r.vehicle_id, client_name: r.client_name, client_email: r.client_email, client_phone: r.client_phone, price: veh?.price ?? null, deposit: r.amount, payment_mode: "carte", stage: "offer", user_id: u.user.id }).select("id").single();
      await admin.from("reservations").update({ status: "converted", deal_id: deal?.id ?? null }).eq("id", r.id);
      await admin.from("accounting_entries").insert({ kind: "recette", category: "Acompte réservation", label: `Acompte réservation : ${r.vehicle_label} (${r.client_name})`, amount_ttc: r.amount, vat_amount: 0, payment_mode: "carte", deal_id: deal?.id ?? null });
      await send(r.client_email, `Acompte encaissé : ${r.vehicle_label}`, `<p>Bonjour ${esc(r.client_name)},</p><p>Votre acompte de ${eur(r.amount)} est encaissé et sera déduit du prix du véhicule <b>${esc(r.vehicle_label)}</b>. Nous préparons votre dossier.</p>`);
      return json({ ok: true, deal_id: deal?.id });
    }

    if (action === "cg_pay") {
      const { data: r } = await admin.from("siv_requests").select("*").eq("id", b.id).maybeSingle();
      if (!r) return json({ error: "not_found" }, 404);
      const amount = Number(b.amount);
      if (!(amount >= 1 && amount <= 2000) || !r.client_email) return json({ error: "invalid" }, 400);
      const numero = r.data?.numero ?? r.id.slice(0, 8);
      const sess = await stripe("checkout/sessions", {
        mode: "payment", "payment_method_types[0]": "card", locale: "fr", customer_email: r.client_email,
        "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "eur",
        "line_items[0][price_data][unit_amount]": String(Math.round(amount * 100)),
        "line_items[0][price_data][product_data][name]": `Démarche carte grise ${numero}`,
        "metadata[siv_id]": r.id, client_reference_id: r.id, "payment_intent_data[metadata][siv_id]": r.id,
        success_url: `${site}/suivi-carte-grise?n=${numero}&e=${encodeURIComponent(r.client_email)}&paid=1`, cancel_url: `${site}/suivi-carte-grise?n=${numero}&e=${encodeURIComponent(r.client_email)}`,
      });
      const data = { ...(r.data ?? {}), pay_url: sess.url, pay_amount: amount, pay_status: "pending" };
      await admin.from("siv_requests").update({ data }).eq("id", r.id);
      await send(r.client_email, `Paiement de votre démarche ${numero}`, `<p>Bonjour ${esc(r.client_name)},</p><p>Vos documents sont vérifiés. Vous pouvez régler <b>${eur(amount)}</b> en ligne de façon sécurisée :</p><p><a href="${sess.url}">Payer ma démarche</a></p><p>Ce lien reste valable 24 heures ; vous pouvez aussi le retrouver dans le suivi de votre dossier.</p>`);
      return json({ ok: true, url: sess.url });
    }
    return json({ error: "bad_action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message === "stripe_not_configured" ? "stripe_not_configured" : "server") }, 500);
  }
});
