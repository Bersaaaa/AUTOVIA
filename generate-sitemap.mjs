// Génère sitemap.xml (pages + fiches véhicules).
// Usage : SITE_URL=https://www.mon-site.fr SUPABASE_URL=... SUPABASE_ANON_KEY=... node generate-sitemap.mjs
import { writeFileSync } from "node:fs";
const site = (process.env.SITE_URL || "").replace(/\/$/, "");
if (!site) { console.error("SITE_URL manquant"); process.exit(1); }
const urls = ["/", "/acheter", "/vendre", "/services", "/apropos", "/contact", "/carte-grise", "/mentions"].map((p) => ({ loc: site + p }));
const { SUPABASE_URL: su, SUPABASE_ANON_KEY: key } = process.env;
if (su && key) {
  const r = await fetch(`${su}/rest/v1/vehicles?select=slug,updated_at&published=eq.true&status=neq.draft`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) { console.error("Erreur Supabase", r.status); process.exit(1); }
  const all = await r.json();
  for (const b of [...new Set((await (await fetch(`${su}/rest/v1/vehicles?select=brand&published=eq.true&status=neq.draft`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })).json()).map((x) => x.brand))]) urls.push({ loc: `${site}/marque/${encodeURIComponent(b)}` });
  const cs = await (await fetch(`${su}/rest/v1/agency_settings?select=data&id=eq.1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })).json().catch(() => []);
  const slug = (c) => String(c).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  for (const c of String(cs?.[0]?.data?.cities ?? "").split(",").map((x) => x.trim()).filter(Boolean)) urls.push({ loc: `${site}/occasion/${slug(c)}` });
  for (const v of all) urls.push({ loc: `${site}/vehicule/${encodeURIComponent(v.slug)}`, lastmod: (v.updated_at || "").slice(0, 10) });
}
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`;
writeFileSync("sitemap.xml", xml);
console.log(`${urls.length} URL écrites dans sitemap.xml`);
