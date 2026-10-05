// Edge Function Supabase : estimation d'un véhicule avec l'API Claude.
// Déploiement :
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// Déploiement sans ligne de commande : Supabase > Edge Functions > Deploy a new function > nom « estimate-vehicle » > coller tout ce fichier.
// Facultatif : supabase secrets set ANTHROPIC_MODEL=claude-haiku-4-5-20251001
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const clean = (s: unknown, n = 60) => String(s ?? "").replace(/[^\p{L}\p{N} .\-+/']/gu, "").slice(0, n);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json();
    const v = {
      marque: clean(b.brand), modele: clean(b.model), annee: Number(b.year), kilometrage: Number(b.mileage),
      carburant: clean(b.fuel), boite: clean(b.gearbox), etat: clean(b.condition),
      carnet_entretien_a_jour: !!b.service_history, non_accidente: !!b.no_accident,
    };
    if (!v.marque || !v.modele || !(v.annee >= 1990 && v.annee <= new Date().getFullYear() + 1) || !(v.kilometrage >= 0 && v.kilometrage < 1_000_000))
      return json({ error: "invalid" }, 400);

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system: "Tu es expert en cotation de véhicules d'occasion sur le marché français. À partir de la fiche reçue, estime le prix de vente réaliste d'un professionnel à un particulier, en euros. Réponds uniquement par un objet JSON : {\"low\": entier, \"high\": entier, \"comment\": \"une phrase en français sur les facteurs qui influencent le prix\"}. low et high encadrent la valeur (écart d'environ 10 %).",
        messages: [{ role: "user", content: JSON.stringify(v) }],
      }),
    });
    if (!r.ok) return json({ error: "upstream" }, 502);
    const txt = (await r.json()).content?.[0]?.text ?? "";
    const o = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1));
    const low = Math.round(Number(o.low)), high = Math.round(Number(o.high));
    if (!(low >= 300 && high >= low && high <= 500000)) return json({ error: "bad_estimate" }, 502);
    return json({ low, high, comment: clean(o.comment, 240) });
  } catch (_) {
    return json({ error: "failed" }, 500);
  }
});
