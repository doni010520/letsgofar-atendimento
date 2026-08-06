/** Gera um PDF VÁLIDO e grande, para testar o envio sem usar documento real. */
import fs from "node:fs";

const SAIDA = process.argv[2] ?? "teste.pdf";
const ALVO_MB = Number(process.argv[3] ?? 11);

const objetos = [];
const add = (corpo) => objetos.push(corpo);

add("<< /Type /Catalog /Pages 2 0 R >>");
add("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
add("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R " +
    "/Resources << /Font << /F1 5 0 R >> >> >>");

// O peso vem de um fluxo de texto com muitas linhas — conteúdo real, não lixo.
const linhas = [];
const alvoBytes = ALVO_MB * 1024 * 1024;
let n = 0;
let acumulado = 0; // somado a cada linha: recalcular o join a cada volta é O(n²)
while (acumulado < alvoBytes) {
  n += 1;
  const l = `(Linha ${n} - arquivo de teste do envio de documentos.) Tj 0 -1 Td`;
  linhas.push(l);
  acumulado += l.length + 1;
}
const conteudo = `BT /F1 9 Tf 40 800 Td 12 TL\n${linhas.join("\n")}\nET`;
add(`<< /Length ${Buffer.byteLength(conteudo)} >>\nstream\n${conteudo}\nendstream`);
add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

let pdf = "%PDF-1.4\n";
const offsets = [];
objetos.forEach((corpo, i) => {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${i + 1} 0 obj\n${corpo}\nendobj\n`;
});

const inicioXref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
for (const o of offsets) pdf += `${String(o).padStart(10, "0")} 00000 n \n`;
pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;

fs.writeFileSync(SAIDA, pdf, "latin1");
const tam = fs.statSync(SAIDA).size;
console.log(`gerado: ${SAIDA} — ${(tam / 1024 / 1024).toFixed(2)} MB`);
console.log(`válido? cabeçalho=${pdf.startsWith("%PDF")} startxref=${pdf.includes("startxref")} EOF=${pdf.trimEnd().endsWith("%%EOF")}`);
