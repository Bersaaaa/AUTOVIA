// Edge Function PUBLIQUE (désactiver « Verify JWT ») : signature électronique SANS compte.
// Le client ouvre le lien /signer?t=<jeton secret> ; il lit puis signe d'un coup tous les documents du lot
// (bon de commande, certificat de garantie, Cerfa PDF…).
// - Documents HTML : empreinte SHA-256 du contenu + signature dessinée + nom + date + IP + navigateur.
// - Documents PDF (Cerfa) : le PDF d'origine n'est pas modifié ; une page « Certificat de signature électronique »
//   (signataire, date, IP, empreinte SHA-256 du PDF d'origine, signature) est ajoutée à la fin et le PDF signé est archivé.
// Pré-requis : supabase_v19.sql. Secrets facultatifs (e-mails de confirmation) : RESEND_API_KEY, CLIENT_FROM_EMAIL, SITE_URL.
// Niveau : signature électronique SIMPLE (règlement eIDAS) : preuve conservée, mais ce n'est pas une signature qualifiée. À VÉRIFIER pour les usages administratifs (Cerfa, SIV) avec votre conseil.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Content-Type": "application/json" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: CORS });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha = async (d: Uint8Array | string) => hex(await crypto.subtle.digest("SHA-256", typeof d === "string" ? new TextEncoder().encode(d) : d));
const safe = (s: string) => String(s ?? "").replace(/[^\x20-\x7E -ÿ’‘“”€–—…]/g, "?");
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function stamp(orig: Uint8Array, o: { title: string; name: string; at: Date; ip: string; ua: string; hash: string; png: Uint8Array; agency: string }) {
  const pdf = await PDFDocument.load(orig, { ignoreEncryption: true });
  const pg = pdf.addPage([595, 842]), f = await pdf.embedFont(StandardFonts.Helvetica), fb = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.04, 0.1, 0.25), grey = rgb(0.35, 0.4, 0.5);
  let y = 780;
  pg.drawText("Certificat de signature électronique", { x: 50, y, size: 20, font: fb, color: ink }); y -= 34;
  const line = (k: string, v: string) => { pg.drawText(safe(k), { x: 50, y, size: 10, font: f, color: grey }); pg.drawText(safe(v).slice(0, 90), { x: 190, y, size: 11, font: fb, color: ink }); y -= 22; };
  line("Document", o.title); line("Signataire", o.name);
  line("Date et heure", o.at.toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "long", timeStyle: "medium" }));
  line("Adresse IP", o.ip || "non disponible"); line("Agence", o.agency);
  pg.drawText("Empreinte SHA-256 du document d'origine :", { x: 50, y, size: 10, font: f, color: grey }); y -= 16;
  pg.drawText(o.hash.slice(0, 32), { x: 50, y, size: 10, font: fb, color: ink }); y -= 14;
  pg.drawText(o.hash.slice(32), { x: 50, y, size: 10, font: fb, color: ink }); y -= 30;
  pg.drawText("Signature :", { x: 50, y, size: 10, font: f, color: grey }); y -= 8;
  const img = await pdf.embedPng(o.png), w = 260, h = Math.min(110, (img.height / img.width) * w);
  pg.drawRectangle({ x: 48, y: y - h - 6, width: w + 4, height: h + 8, borderColor: grey, borderWidth: 0.5 });
  pg.drawImage(img, { x: 50, y: y - h - 2, width: w, height: h }); y -= h + 34;
  const txt = "Le signataire a déclaré avoir lu le document précédent et l'approuver. Signature électronique simple : la preuve (horodatage, adresse IP, navigateur, empreinte) est conservée par l'agence.";
  const words = txt.split(" "); let cur = "";
  for (const wd of words) { if ((cur + " " + wd).length > 95) { pg.drawText(safe(cur), { x: 50, y, size: 9, font: f, color: grey }); y -= 13; cur = wd; } else cur = (cur + " " + wd).trim(); }
  if (cur) pg.drawText(safe(cur), { x: 50, y, size: 9, font: f, color: grey });
  return await pdf.save();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let b: any; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_request" }, 400); }
  const token = String(b.token ?? ""); if (!UUID.test(token)) return json({ ok: false, error: "not_found" }, 404);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: rows } = await admin.from("order_signatures").select("*").eq("pack_token", token).order("created_at");
  if (!rows || !rows.length) return json({ ok: false, error: "not_found" }, 404);
  const { data: st } = await admin.from("agency_settings").select("data").eq("id", 1).maybeSingle();
  const S = (st?.data ?? {}) as Record<string, string>, agency = S.brand || S.company || S.name || "Notre agence";
  const expired = rows.some((r) => r.status === "pending" && r.expires_at && new Date(r.expires_at).getTime() < Date.now());

  if (b.action === "get") {
    const docs = [];
    for (const r of rows) {
      let url: string | null = null;
      if (r.kind === "pdf") { const p = r.status === "signed" && r.signed_path ? r.signed_path : r.storage_path; const s = p ? await admin.storage.from("sign-docs").createSignedUrl(p, 3600) : null; url = s?.data?.signedUrl ?? null; }
      docs.push({ id: r.id, title: r.title, kind: r.kind, status: r.status, html: r.kind === "html" ? r.document_html : null, url, signer_name: r.signer_name, signed_at: r.signed_at, doc_hash: r.doc_hash });
    }
    return json({ ok: true, agency, expired, client: rows[0].signer_email ? true : false, docs });
  }

  if (b.action === "sign") {
    const name = String(b.name ?? "").trim(), png = String(b.signature ?? "");
    if (b.consent !== true || name.length < 2 || name.length > 120 || !png.startsWith("data:image/png;base64,") || png.length < 500 || png.length > 400000) return json({ ok: false, error: "invalid" }, 400);
    if (expired) return json({ ok: false, error: "expired" }, 410);
    const pending = rows.filter((r) => r.status === "pending"); if (!pending.length) return json({ ok: false, error: "already_signed" }, 409);
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 100), ua = String(b.ua ?? req.headers.get("user-agent") ?? "").slice(0, 300), at = new Date();
    const pngBytes = Uint8Array.from(atob(png.split(",")[1]), (c) => c.charCodeAt(0));
    for (const r of pending) {
      let hash: string, signed_path: string | null = null;
      if (r.kind === "pdf") {
        const dl = await admin.storage.from("sign-docs").download(r.storage_path); if (dl.error || !dl.data) return json({ ok: false, error: "file_missing" }, 500);
        const orig = new Uint8Array(await dl.data.arrayBuffer()); hash = await sha(orig);
        const out = await stamp(orig, { title: r.title, name, at, ip, ua, hash, png: pngBytes, agency });
        signed_path = `signed/${r.id}.pdf`;
        const up = await admin.storage.from("sign-docs").upload(signed_path, new Blob([out], { type: "application/pdf" }), { upsert: true, contentType: "application/pdf" });
        if (up.error) return json({ ok: false, error: "archive_failed" }, 500);
      } else hash = await sha(r.document_html);
      const { error } = await admin.from("order_signatures").update({ status: "signed", signature_png: png, signer_name: name, signer_ip: ip, signer_user_agent: ua, doc_hash: hash, signed_at: at.toISOString(), signed_path }).eq("id", r.id).eq("status", "pending");
      if (error) { console.error(error.message); return json({ ok: false, error: "save_failed" }, 500); }
    }
    // e-mails de confirmation (facultatif)
    const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("CLIENT_FROM_EMAIL") || Deno.env.get("SIV_FROM_EMAIL"), site = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
    if (key && from) {
      const send = (to: string, subject: string, html: string) => fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [to], subject, html, reply_to: S.email || undefined }) }).catch(() => null);
      const list = pending.map((r) => `<li>${esc(r.title)}</li>`).join(""), link = site ? `${site}/signer?t=${token}` : "";
      if (S.email) await send(S.email, `Documents signés par ${name}`, `<div style="font:15px/1.6 system-ui,sans-serif;color:#0b1b3f"><p><b>${esc(name)}</b> a signé ${pending.length} document(s) :</p><ul>${list}</ul>${link ? `<p><a href="${link}">Ouvrir les documents signés</a></p>` : ""}</div>`);
      const to = rows[0].signer_email;
      if (to) await send(to, `Vos documents signés — ${agency}`, `<div style="font:15px/1.6 system-ui,sans-serif;color:#0b1b3f;max-width:560px"><p>Bonjour ${esc(name)},</p><p>Nous confirmons la signature de :</p><ul>${list}</ul>${link ? `<p>Vous pouvez les retrouver et les télécharger ici : <a href="${link}">${link}</a></p>` : ""}<p style="color:#55607a">${esc(agency)}</p></div>`);
    }
    return json({ ok: true, signed: pending.length });
  }
  return json({ ok: false, error: "unknown_action" }, 400);
});
