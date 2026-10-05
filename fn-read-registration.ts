// Edge Function : lit une photo avec Claude (vision), réservée au personnel de l'agence.
// kind absent / "registration" : carte grise -> champs du VÉHICULE uniquement (jamais le titulaire).
// kind "id" : pièce d'identité -> nom, prénom, date et lieu de naissance, sexe. Le numéro du document n'est jamais demandé ni renvoyé, rien n'est conservé.
// Secrets : supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   (clé API console.anthropic.com : usage facturé à part)
//           facultatif : ANTHROPIC_MODEL (par défaut claude-sonnet-5-5)
// Déploiement sans ligne de commande : Supabase > Edge Functions > Deploy a new function > nom « read-registration » > coller tout ce fichier.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const FUEL: Record<string, string> = { ES: "Essence", GO: "Diesel", GZ: "GPL", GP: "GPL", EL: "Électrique", EH: "Hybride", GH: "Hybride", ER: "Hybride", EE: "Hybride", PH: "Hybride" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: staff } = await user.rpc("is_staff");
    if (staff !== true) return json({ error: "forbidden" }, 403);
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "ai_not_configured" }, 500);

    const { image, media_type, kind } = await req.json();
    if (typeof image !== "string" || image.length < 100 || image.length > 7_000_000) return json({ error: "bad_image" }, 400);
    const mt = ["image/jpeg", "image/png", "image/webp"].includes(media_type) ? media_type : "image/jpeg";

    if (kind === "id") {
      const idPrompt = `Voici la photo d'une pièce d'identité. Extrais UNIQUEMENT : nom de naissance, prénom(s), date de naissance, lieu de naissance, pays de naissance, sexe. Ne renvoie JAMAIS le numéro du document, ni l'adresse, ni la photo.
Réponds avec un seul objet JSON, sans texte autour (null si illisible ou absent, ne devine jamais) : {"last_name": "NOM en majuscules", "first_name": "premier prénom", "birth_date": "AAAA-MM-JJ", "birth_place": "commune", "birth_country": "pays (France si la commune est française)", "sex": "M" ou "F"}`;
      const r0 = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5", max_tokens: 400,
          messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mt, data: image } }, { type: "text", text: idPrompt }] }] }),
      });
      if (!r0.ok) { console.error(await r0.text()); return json({ error: "ai_failed" }, 502); }
      const o0 = await r0.json(), t0 = (o0.content ?? []).map((c: { text?: string }) => c.text ?? "").join(""), m0 = t0.match(/\{[\s\S]*\}/);
      if (!m0) return json({ error: "unreadable" }, 422);
      const q = JSON.parse(m0[0]), str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
      return json({ ok: true, person: {
        last_name: str(q.last_name), first_name: str(q.first_name),
        birth_date: /^\d{4}-\d{2}-\d{2}$/.test(q.birth_date ?? "") ? q.birth_date : null,
        birth_place: str(q.birth_place), birth_country: str(q.birth_country),
        sex: q.sex === "M" || q.sex === "F" ? q.sex : null } });
    }

    const prompt = `Voici la photo d'un certificat d'immatriculation français (carte grise). Extrais UNIQUEMENT les données du véhicule, jamais celles du titulaire (ne renvoie ni nom, ni adresse).
Réponds avec un seul objet JSON, sans texte autour, avec ces clés (null si illisible ou absent, ne devine jamais) :
{"plate": champ A (immatriculation, format AB-123-CD), "first_reg_date": champ B au format AAAA-MM-JJ, "brand": champ D.1, "model": champ D.3 (dénomination commerciale), "version": champ D.2 (variante/version), "vin": champ E (17 caractères), "fuel_code": champ P.3 (code énergie), "power_kw": champ P.2 (nombre), "fiscal_cv": champ P.6 (nombre), "co2": champ V.7 (nombre), "seats": champ S.1 (nombre)}`;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5", max_tokens: 500,
        messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mt, data: image } }, { type: "text", text: prompt }] }],
      }),
    });
    if (!res.ok) { console.error(await res.text()); return json({ error: "ai_failed" }, 502); }
    const out = await res.json();
    const txt = (out.content ?? []).map((c: { text?: string }) => c.text ?? "").join("");
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return json({ error: "unreadable" }, 422);
    const r = JSON.parse(m[0]);
    const num = (v: unknown) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
    return json({
      ok: true,
      vehicle: {
        plate: r.plate ?? null, first_reg_date: /^\d{4}-\d{2}-\d{2}$/.test(r.first_reg_date ?? "") ? r.first_reg_date : null,
        brand: r.brand ?? null, model: r.model ?? null, version: r.version ?? null,
        vin: typeof r.vin === "string" && r.vin.length === 17 ? r.vin.toUpperCase() : (r.vin ?? null),
        fuel: FUEL[String(r.fuel_code ?? "").toUpperCase()] ?? null, power_kw: num(r.power_kw), fiscal_cv: num(r.fiscal_cv), co2: num(r.co2), seats: num(r.seats),
      },
    });
  } catch (e) { console.error(e); return json({ error: "server" }, 500); }
});
