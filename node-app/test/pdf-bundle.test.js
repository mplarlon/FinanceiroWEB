import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";
import { pdfkitStandardFonts } from "../scripts/bundle-server.js";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("o pacote do instalador embute a Helvetica do pdfkit", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-bundle-"));
  const entry = path.join(dir, "entry.js");
  const outfile = path.join(dir, "out.mjs");
  await fs.writeFile(
    entry,
    `import PDFDocument from "pdfkit";
export function pdf() {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 32 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.font("Helvetica-Bold").fontSize(14).text("Risco de ruptura");
    doc.font("Helvetica").text("Fio flexivel");
    doc.end();
  });
}
`,
  );
  try {
    await esbuild.build({
      absWorkingDir: appRoot,
      nodePaths: [path.join(appRoot, "node_modules")],
      entryPoints: [entry],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      minify: true,
      plugins: [pdfkitStandardFonts],
    });
    const bundled = await fs.readFile(outfile, "utf8");
    assert.equal(bundled.includes("#standard-fonts"), false);
    const { pdf } = await import(pathToFileURL(outfile).href);
    const bytes = await pdf();
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    assert.ok(bytes.length > 500);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
