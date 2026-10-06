// Edge Function : parcours public /carte-grise (duplicata et changement d'adresse) + suivi de dossier sans compte.
// Actions : create (crée la demande, renvoie des liens d'envoi de documents), finalize (valide les pièces envoyées et prévient l'agence),
//           more (liens d'envoi pour des pièces supplémentaires), track (suivi par numéro + e-mail).
// Les pièces sont stockées dans le bucket PRIVÉ « siv-files » (créé par supabase_siv.sql), lisibles seulement par l'agence.
// Déploiement sans ligne de commande : Supabase > Edge Functions > Deploy a new function > nom « public-carte-grise » > coller tout ce fichier > désactiver « Verify JWT ».
// Secrets : RESEND_API_KEY, SIV_TO_EMAIL (boîte qui reçoit les demandes), SIV_FROM_EMAIL ; facultatif : SITE_URL (lien de suivi dans les e-mails).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const KINDS: Record<string, string> = {
  duplicata: "Duplicata de carte grise", changement_adresse: "Changement d'adresse",
  changement_titulaire: "Changement de titulaire", declaration_cession: "Déclaration de cession",
  premiere_immat: "Première immatriculation / import", w_garage: "Certificat W garage", autre: "Autre démarche",
};
const PUB = ["duplicata", "changement_adresse", "changement_titulaire"];
const PRICE_ID: Record<string, string> = { duplicata: "duplicata", changement_adresse: "adresse", changement_titulaire: "titulaire" };
const DEF: Record<string, [number, number]> = { duplicata: [50, 13.76], changement_adresse: [25, 0], changement_titulaire: [40, 13.76] };
const RT0: Record<string, number> = {'Île-de-France':54.95,'Hauts-de-France':42,'Normandie':60,'Bretagne':60,'Pays de la Loire':51,'Centre-Val de Loire':60,'Grand-Est':60,'Bourgogne-Franche-Comté':60,'Nouvelle-Aquitaine':53,'Auvergne-Rhône-Alpes':43,'Occitanie':59.5,"Provence-Alpes-Côte d'Azur":60,'Corse':43,'Guadeloupe':41,'Martinique':53,'Guyane':42.5,'Réunion':57,'Mayotte':30};
const DEPT_REGIONS: Record<string, string> = {
  'Île-de-France':'75 77 78 91 92 93 94 95','Hauts-de-France':'02 59 60 62 80','Normandie':'14 27 50 61 76',
  'Bretagne':'22 29 35 56','Pays de la Loire':'44 49 53 72 85','Centre-Val de Loire':'18 28 36 37 41 45',
  'Grand-Est':'08 10 51 52 54 55 57 67 68 88','Bourgogne-Franche-Comté':'21 25 39 58 70 71 89 90',
  'Nouvelle-Aquitaine':'16 17 19 23 24 33 40 47 64 79 86 87','Auvergne-Rhône-Alpes':'01 03 07 15 26 38 42 43 63 69 73 74',
  'Occitanie':'09 11 12 30 31 32 34 46 48 65 66 81 82','Provence-Alpes-Côte d'Azur':'04 05 06 13 83 84','Corse':'2A 2B',
  'Guadeloupe':'971','Martinique':'972','Guyane':'973','Réunion':'974','Mayotte':'976'
};
const DEPT: Record<string, string> = {};
for (const [r, l] of Object.entries(DEPT_REGIONS)) for (const c of l.split(" ")) DEPT[c] = r;
const OPTS: [string, string, number, string][] = [['prioritaire','Dossier prioritaire',10,'all'],['non-gage','Non-gage (vérification de la situation administrative)',10,'vehicule'],['carvertical','Rapport CarVertical (historique du véhicule)',25,'vehicule'],['envoi-postal','Envoi postal',7,'all'],['suivi-whatsapp','Suivi via WhatsApp',3,'all'],['assistante-tel','Assistante téléphonique',5,'all'],['aide-remplissage','Aide au remplissage',5,'all']];
const cut = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const slug = (n: string) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_").slice(-60) || "fichier";
const OK_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const optional = (l: string) => /si nécessaire|si détériorée/i.test(l);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json();
    if (b.website) return json({ ok: true }); // piège anti-robot
    const action = b.action ?? "create";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const key = Deno.env.get("RESEND_API_KEY"), to = Deno.env.get("SIV_TO_EMAIL"), from = Deno.env.get("SIV_FROM_EMAIL"), site = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
    const send = async (rcpt: string, subject: string, html: string, reply?: string) => {
      if (!key || !from) return false;
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [rcpt], reply_to: reply, subject, html }) });
      if (!r.ok) console.error(await r.text());
      return r.ok;
    };
    const wrap = (inner: string) => `<div style="font:15px/1.55 system-ui,sans-serif;color:#0b1b3f;max-width:620px">${inner}</div>`;
    const signed = async (numero: string, files: { name: string; type: string; size: number }[], start = 0) => {
      const out: ({ path: string; token: string } | null)[] = [];
      for (let i = 0; i < files.length && i < 12; i++) {
        const f = files[i];
        if (!OK_TYPES.includes(f.type) || !(f.size > 0 && f.size <= 10_000_000)) { out.push(null); continue; }
        const path = `cg/${numero}/${Date.now()}-${start + i}-${slug(String(f.name))}`;
        const { data, error } = await admin.storage.from("siv-files").createSignedUploadUrl(path);
        out.push(error || !data ? null : { path, token: data.token });
      }
      return out;
    };
    const find = async (numero: string, email: string) => {
      if (!/^CG-\d{4}-\d{6}$/.test(numero) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
      const { data } = await admin.from("siv_requests").select("*").contains("data", { numero }).eq("client_email", email.toLowerCase()).maybeSingle();
      return data;
    };

    if (action === "create") {
      const name = cut(b.name, 120), email = cut(b.email, 160).toLowerCase(), phone = cut(b.phone, 30), plate = cut(b.plate, 20).toUpperCase();
      if (!PUB.includes(b.kind)) return json({ error: "invalid" }, 400);
      const kind = b.kind, party = b.party === "soc" ? "soc" : "part";
      if (name.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || b.consent !== true) return json({ error: "invalid" }, 400);
      if (!to || !from || !key) return json({ error: "mail_not_configured" }, 500);
      const since = new Date(Date.now() - 3600_000).toISOString();
      const { count } = await admin.from("siv_requests").select("id", { count: "exact", head: true }).contains("data", { source: "site" }).gte("created_at", since);
      if ((count ?? 0) >= 30) return json({ error: "rate_limited" }, 429);
      let numero = "";
      for (let i = 0; i < 5; i++) {
        numero = `CG-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 900000) + 100000)}`;
        const { count: c } = await admin.from("siv_requests").select("id", { count: "exact", head: true }).contains("data", { numero });
        if (!c) break;
      }
      // Le prix est calculé ICI (réglages de l'agence), jamais pris dans le navigateur.
      const S = (await admin.from("agency_settings").select("data").eq("id", 1).maybeSingle()).data?.data ?? {};
      const num = (v: unknown, d: number) => { const n = Number(String(v ?? "").replace(",", ".")); return v === undefined || v === "" || isNaN(n) ? d : n; };
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const prest = num(S[`cg_price_${PRICE_ID[kind]}`], DEF[kind][0]), frais = num(S[`cg_fees_${PRICE_ID[kind]}`], DEF[kind][1]);
      const chosen = new Set(Array.isArray(b.options) ? b.options.map(String) : []);
      const opts = OPTS.filter((o) => chosen.has(o[0]) && (o[3] === "all" || kind === "changement_titulaire")).map((o) => ({ key: o[0], nom: o[1], prix: o[2] }));
      let taxe = 0, region = "", cvf = 0, over10 = false, tarifCv = 0, dept = "", firstReg = "";
      if (kind === "changement_titulaire") {
        // Taxe régionale = CV × tarif de la région du demandeur, divisée par 2 si le véhicule a plus de 10 ans.
        dept = cut(b.dept, 3); region = DEPT[dept] ?? ""; cvf = parseInt(String(b.cv), 10) || 0; firstReg = cut(b.date, 10);
        const rts = { ...RT0 };
        for (const l of String(S.cg_regions ?? "").split("\n")) { const m = l.split("="); if (m.length === 2 && rts[m[0].trim()] !== undefined) { const n = Number(m[1].replace(",", ".")); if (n > 0) rts[m[0].trim()] = n; } }
        tarifCv = rts[region] ?? 0;
        const d = new Date(firstReg + "T00:00:00");
        if (!region || !(cvf >= 1 && cvf <= 50) || !/^\d{4}-\d{2}-\d{2}$/.test(firstReg) || isNaN(d.getTime()) || d.getTime() > Date.now()) return json({ error: "invalid" }, 400);
        over10 = (Date.now() - d.getTime()) / (365.25 * 864e5) > 10;
        taxe = r2((cvf * tarifCv) / (over10 ? 2 : 1));
      }
      const tarif = r2(prest + frais + taxe + opts.reduce((t, o) => t + o.prix, 0));
      const breakdown = { prestation: prest, frais_etat: frais, taxe_regionale: taxe, region, dept, cv: cvf, tarif_cv: tarifCv, plus_10_ans: over10, premiere_immat: firstReg, options: opts };
      const docs = (Array.isArray(b.docs) ? b.docs : []).slice(0, 12).map((l: unknown) => cut(l, 120));
      const data = {
        source: "site", numero, party, siret: cut(b.siret, 20), motif: cut(b.motif, 30), new_address: cut(b.new_address, 200),
        tarif, breakdown, docs,
      };
      const { error } = await admin.from("siv_requests").insert({
        kind, status: "draft", client_name: name, client_email: email, client_phone: phone || null,
        client_address: cut(b.new_address, 200) || null, plate: plate || null, notes: cut(b.message, 2000) || null, data,
      });
      if (error) { console.error(error); return json({ error: "server" }, 500); }
      const files = (Array.isArray(b.files) ? b.files : []).map((f: Record<string, unknown>) => ({ name: String(f.name ?? ""), type: String(f.type ?? ""), size: Number(f.size) || 0 }));
      return json({ ok: true, numero, uploads: await signed(numero, files) });
    }

    const numero = cut(b.numero, 20).toUpperCase(), email = cut(b.email, 160);
    const r = await find(numero, email);
    if (!r) return json({ error: "not_found" }, 404);
    const D = (r.data ?? {}) as Record<string, unknown>;

    if (action === "pay") {
      if (D.pay_status === "paid") return json({ error: "already_paid" }, 409);
      const sk = Deno.env.get("STRIPE_SECRET_KEY"), amount = Number(D.tarif);
      if (!sk) return json({ error: "stripe_not_configured" }, 500);
      if (!(amount >= 1)) return json({ error: "no_amount" }, 400);
      const e = encodeURIComponent(r.client_email);
      const p = new URLSearchParams({
        mode: "payment", "payment_method_types[0]": "card", locale: "fr", customer_email: r.client_email,
        "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "eur",
        "line_items[0][price_data][unit_amount]": String(Math.round(amount * 100)),
        "line_items[0][price_data][product_data][name]": `${KINDS[r.kind] ?? r.kind} (dossier ${numero})`,
        "metadata[siv_id]": r.id, client_reference_id: r.id, "payment_intent_data[metadata][siv_id]": r.id,
        success_url: `${site}/suivi-carte-grise?n=${numero}&e=${e}&paid=1`, cancel_url: `${site}/suivi-carte-grise?n=${numero}&e=${e}`,
      });
      const sr = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { Authorization: `Bearer ${sk}`, "Content-Type": "application/x-www-form-urlencoded" }, body: p.toString() });
      const sj = await sr.json();
      if (!sr.ok) { console.error(JSON.stringify(sj)); return json({ error: "stripe_error" }, 502); }
      await admin.from("siv_requests").update({ data: { ...D, pay_url: sj.url, pay_amount: amount, pay_status: "pending" } }).eq("id", r.id);
      return json({ ok: true, url: sj.url });
    }

    if (action === "more") {
      const files = (Array.isArray(b.files) ? b.files : []).map((f: Record<string, unknown>) => ({ name: String(f.name ?? ""), type: String(f.type ?? ""), size: Number(f.size) || 0 }));
      return json({ ok: true, uploads: await signed(numero, files, (r.files ?? []).length) });
    }

    if (action === "finalize") {
      const up = (Array.isArray(b.uploaded) ? b.uploaded : []).filter((u: Record<string, unknown>) => typeof u.path === "string" && String(u.path).startsWith(`cg/${numero}/`)).slice(0, 12)
        .map((u: Record<string, unknown>) => ({ path: String(u.path), name: `${cut(u.label, 80)} — ${cut(u.name, 80)}`, label: cut(u.label, 120) }));
      const files = [...(r.files ?? []), ...up];
      const first = r.status === "draft";
      await admin.from("siv_requests").update({ files, ...(first ? { status: "sent", sent_at: new Date().toISOString() } : {}) }).eq("id", r.id);
      const link = site ? `${site}/#/suivi-carte-grise?n=${numero}&e=${encodeURIComponent(email)}` : "";
      if (to) {
        const rows: [string, string][] = [["Numéro", numero], ["Démarche", KINDS[r.kind] ?? r.kind], ["Client", `${r.client_name}${D.party === "soc" ? " (société)" : ""}`], ["E-mail", r.client_email], ["Téléphone", r.client_phone ?? ""], ["Immatriculation", r.plate ?? ""], ["Motif", String(D.motif ?? "")], ["Nouvelle adresse", String(D.new_address ?? "")], ["SIRET", String(D.siret ?? "")], ["Détail", D.breakdown ? ((x: Record<string, unknown>) => `prestation ${x.prestation} € + taxe régionale ${x.taxe_regionale} € (${x.cv} CV × ${x.tarif_cv} €, ${x.region}${x.plus_10_ans ? ", +10 ans −50 %" : ""}) + frais fixes ${x.frais_etat} € + options ${((x.options as {nom:string}[]) ?? []).map((o) => o.nom).join(", ") || "aucune"}`)(D.breakdown as Record<string, unknown>) : ""], ["Tarif", D.tarif ? `${D.tarif} € TTC (${D.pay_status === "paid" ? "PAYÉ" : "paiement en ligne en cours / à confirmer"})` : ""], ["Message", r.notes ?? ""], ["Pièces reçues", String(up.length)]];
        await send(to, `[Carte grise] ${b.more ? "Nouvelles pièces — " : ""}${KINDS[r.kind] ?? r.kind} — ${r.client_name} — ${numero}`,
          wrap(`<h2>${b.more ? "Pièces ajoutées" : "Nouvelle demande de carte grise (site)"}</h2><table style="border-collapse:collapse;width:100%">${rows.filter(([, v]) => v).map(([k, v]) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #e1e8f6;color:#55607a">${esc(k)}</td><td style="padding:6px 10px;border-bottom:1px solid #e1e8f6"><b>${esc(v)}</b></td></tr>`).join("")}</table><p>Les pièces sont dans l'espace agence › SIV.</p>`), r.client_email);
      }
      if (first && r.client_email) {
        await send(r.client_email, `Votre demande ${numero} est bien reçue`,
          wrap(`<p>Bonjour ${esc(r.client_name)},</p><p>Nous avons bien reçu votre demande de <b>${esc(KINDS[r.kind] ?? r.kind)}</b>. Votre numéro de dossier : <b>${numero}</b>.</p><p>Nous vérifions vos documents et traitons votre démarche dès réception du paiement. Si vous n'avez pas pu payer, vous pouvez le faire depuis le lien de suivi ci-dessous.</p>${link ? `<p><a href="${link}">Suivre mon dossier</a></p>` : ""}`));
      }
      return json({ ok: true });
    }

    if (action === "track") {
      const have = new Set((r.files ?? []).map((f: { label?: string }) => f.label));
      const docs = ((D.docs as string[]) ?? []).map((label) => ({ label, received: have.has(label), optional: optional(label) }));
      return json({ ok: true, numero, status: r.status, kindLabel: KINDS[r.kind] ?? r.kind, created_at: r.created_at, plate: r.plate, docs, pay_url: D.pay_status === "pending" ? D.pay_url ?? null : null, pay_amount: D.pay_amount ?? null, pay_status: D.pay_status ?? null });
    }
    return json({ error: "bad_action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "server" }, 500);
  }
});
