// Edge Function « public-scan » (Verify JWT : DÉSACTIVÉ ; limitée par adresse IP).
// check : l'IA dit si la photo d'un document est lisible AVANT l'envoi (flou, coupé, reflet, mauvais document). Ne lit aucune donnée personnelle.
// card  : lit la carte grise (véhicule uniquement) pour préremplir l'estimation de reprise.
// Secrets : ANTHROPIC_API_KEY. Facultatif : ANTHROPIC_MODEL. Pré-requis : supabase_v16.sql.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const FUEL: Record<string, string> = { ES: "Essence", GO: "Diesel", EL: "Électrique", EH: "Hybride", GH: "Hybride", EE: "Hybride", PH: "Hybride rechargeable", GN: "GPL", GP: "GPL", H2: "Hydrogène" };
const LIMITS: Record<string, [number, number]> = { check: [60, 600], card: [8, 150] }; // [par IP et par heure, au total par jour]

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "ai_not_configured" }, 500);
    const b = await req.json();
    const kind = b.action === "card" ? "card" : "check";
    const image = String(b.image ?? "");
    if (image.length < 100 || image.length > 4_000_000) return json({ error: "bad_image" }, 400);
    const mt = ["image/jpeg", "image/png", "image/webp"].includes(b.media_type) ? b.media_type : "image/jpeg";

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    const h = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip + "|sbr")))).map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 24);
    const [perIp, perDay] = LIMITS[kind];
    const { count: c1 } = await admin.from("public_rate").select("id", { count: "exact", head: true }).eq("kind", kind).eq("ip_hash", h).gte("created_at", new Date(Date.now() - 3600_000).toISOString());
    const { count: c2 } = await admin.from("public_rate").select("id", { count: "exact", head: true }).eq("kind", kind).gte("created_at", new Date(Date.now() - 86400_000).toISOString());
    if ((c1 ?? 0) >= perIp || (c2 ?? 0) >= perDay) return json({ error: "rate" }, 429);
    await admin.from("public_rate").insert({ ip_hash: h, kind });
    if (Math.random() < 0.02) await admin.from("public_rate").delete().lt("created_at", new Date(Date.now() - 3 * 86400_000).toISOString());

    const prompt = kind === "check"
      ? `Cette photo doit montrer ce document : « ${String(b.label ?? "document").slice(0, 100)} ». Juge UNIQUEMENT la qualité de la photo et le type de document. Ne recopie AUCUNE donnée personnelle.
Réponds avec un seul objet JSON, sans texte autour : {"right_document": true/false, "readable": true/false, "problems": liste parmi ["floue","coupée (bords manquants)","reflet","trop sombre","mauvais document","verso manquant"], "tip": "une phrase courte en français pour refaire la photo, vide si tout va bien"}. Sois indulgent : readable=true si un humain peut tout lire.`
      : `Voici la photo d'un certificat d'immatriculation français (carte grise). Extrais UNIQUEMENT les données du véhicule, jamais celles du titulaire.
Réponds avec un seul objet JSON, sans texte autour (null si illisible, ne devine jamais) : {"plate": champ A, "first_reg_date": champ B au format AAAA-MM-JJ, "brand": champ D.1, "model": champ D.3, "fuel_code": champ P.3, "fiscal_cv": champ P.6}.`;
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-4-5-20251001", max_tokens: 300,
        messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mt, data: image } }, { type: "text", text: prompt }] }] }),
    });
    if (!r.ok) { console.error(await r.text()); return json({ error: "ai_failed" }, 502); }
    const txt = ((await r.json()).content ?? []).map((c: { text?: string }) => c.text ?? "").join(""), m = txt.match(/\{[\s\S]*\}/);
    if (!m) return json({ error: "unreadable" }, 422);
    const o = JSON.parse(m[0]);
    if (kind === "check") {
      const problems = (Array.isArray(o.problems) ? o.problems : []).map((x: unknown) => String(x).slice(0, 40)).slice(0, 4);
      return json({ ok: true, readable: o.readable !== false && o.right_document !== false, right_document: o.right_document !== false, problems, tip: String(o.tip ?? "").slice(0, 200) });
    }
    return json({ ok: true, vehicle: {
      plate: typeof o.plate === "string" ? o.plate.toUpperCase().slice(0, 12) : null,
      first_reg_date: /^\d{4}-\d{2}-\d{2}$/.test(o.first_reg_date ?? "") ? o.first_reg_date : null,
      brand: typeof o.brand === "string" ? o.brand.slice(0, 40) : null, model: typeof o.model === "string" ? o.model.slice(0, 60) : null,
      fuel: FUEL[String(o.fuel_code ?? "").toUpperCase()] ?? null, fiscal_cv: Number(o.fiscal_cv) || null } });
  } catch (e) { console.error(e); return json({ error: "server" }, 500); }
});
