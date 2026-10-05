// Génère une page HTML statique par véhicule et par marque (titre, description, Open Graph, données structurées),
// pour que Google lise le contenu sans exécuter le JavaScript. Le site reprend ensuite la main dans le navigateur.
// Usage : SITE_URL=https://www.mon-site.fr SUPABASE_URL=... SUPABASE_ANON_KEY=... node prerender.mjs
// À lancer après chaque ajout de véhicule (ou à chaque déploiement), puis relancer generate-sitemap.mjs.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const site = (process.env.SITE_URL || "").replace(/\/$/, "");
const { SUPABASE_URL: su, SUPABASE_ANON_KEY: key } = process.env;
if (!site || !su || !key) { console.error("SITE_URL, SUPABASE_URL et SUPABASE_ANON_KEY sont requis"); process.exit(1); }
const tpl = readFileSync("index.html", "utf8");
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const name = (tpl.match(/name:\s*"([^"]+)"/) || [, "Concession"])[1];
const r = await fetch(`${su}/rest/v1/vehicles?select=slug,brand,model,version,year,mileage,fuel,gearbox,price,description,status,vehicle_images(storage_path,sort_order)&published=eq.true&status=neq.draft`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
if (!r.ok) { console.error("Erreur Supabase", r.status); process.exit(1); }
const vehicles = await r.json();
const img = (v) => { const p = [...(v.vehicle_images || [])].sort((a, b) => a.sort_order - b.sort_order)[0]?.storage_path; return p ? (/^https?:/.test(p) ? p : `${su}/storage/v1/object/public/vehicle-images/${p}`) : ""; };

function page({ path, title, desc, image, ld, h1, text }) {
  let h = tpl
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${site}${path}">${image ? `<meta property="og:image" content="${esc(image)}">` : ""}`)
    .replace("</head>", `<link rel="canonical" href="${site}${path}"><script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script></head>`)
    .replace(/(<[^>]+id="app"[^>]*>)/, `$1<div class="wrap section"><h1>${esc(h1)}</h1><p>${esc(text)}</p></div>`);
  const dir = path.replace(/^\//, "");
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/index.html`, h);
}

for (const v of vehicles) {
  const t = `${v.brand} ${v.model} ${v.version || ""}`.trim();
  const desc = `${t} ${v.year || ""} d'occasion, ${v.mileage != null ? v.mileage.toLocaleString("fr-FR") + " km, " : ""}${v.fuel || ""} ${v.gearbox || ""}. ${v.price ? Math.round(v.price).toLocaleString("fr-FR") + " €." : ""}`.replace(/\s+/g, " ").trim();
  page({ path: `/vehicule/${encodeURIComponent(v.slug)}`, title: `${t} ${v.year || ""} d'occasion — ${name}`, desc, image: img(v), h1: t, text: v.description || desc,
    ld: { "@context": "https://schema.org", "@type": "Car", name: t, brand: { "@type": "Brand", name: v.brand }, model: v.model, vehicleModelDate: v.year ? String(v.year) : undefined, mileageFromOdometer: v.mileage != null ? { "@type": "QuantitativeValue", value: v.mileage, unitCode: "KMT" } : undefined, fuelType: v.fuel, image: img(v) || undefined, offers: v.price ? { "@type": "Offer", price: v.price, priceCurrency: "EUR", availability: v.status === "sold" ? "https://schema.org/SoldOut" : "https://schema.org/InStock" } : undefined } });
}
const brands = [...new Set(vehicles.map((v) => v.brand))];
for (const b of brands) {
  const n = vehicles.filter((v) => v.brand === b).length;
  page({ path: `/marque/${encodeURIComponent(b)}`, title: `${b} d'occasion — ${name}`, desc: `${n} ${b} d'occasion disponibles : prix, kilométrage, année et garantie.`, h1: `${b} d'occasion`, text: `${n} véhicule(s) ${b} disponible(s).`,
    ld: { "@context": "https://schema.org", "@type": "CollectionPage", name: `${b} d'occasion` } });
}
writeFileSync("brands.json", JSON.stringify(brands));
console.log(`${vehicles.length} fiches et ${brands.length} pages marque générées.`);
