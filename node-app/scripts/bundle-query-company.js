import path from "node:path";
import { build } from "esbuild";

const output = path.resolve(process.argv[2] || path.resolve(import.meta.dirname, "..", "..", "installer", "QueryCompany.cjs"));
await build({
  entryPoints: [path.resolve(import.meta.dirname, "..", "..", "installer", "query-company.js")],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  absWorkingDir: path.resolve(import.meta.dirname, ".."),
  nodePaths: [path.resolve(import.meta.dirname, "..", "node_modules")],
  external: ["node-firebird-native-api"],
});
console.log(`Consulta de empresa consolidada em ${output}`);
