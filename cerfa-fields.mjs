// Liste les champs des PDF cerfa_*.pdf (racine du site) : npm i pdf-lib && node cerfa-fields.mjs
import { readdirSync, readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
for (const f of readdirSync(".").filter((x) => /^cerfa_.*\.pdf$/.test(x))) {
  const pdf = await PDFDocument.load(readFileSync(f), { ignoreEncryption: true });
  const fields = pdf.getForm().getFields();
  console.log(`\n== ${f} : ${fields.length} champ(s)`);
  for (const x of fields) console.log(`${x.constructor.name.replace("PDF", "")}\t${x.getName()}`);
}
