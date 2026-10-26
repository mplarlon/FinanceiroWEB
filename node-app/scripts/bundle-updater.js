import path from "node:path";
import { build } from "esbuild";
const output = path.resolve(process.argv[2] || "build/updater/agent.mjs");
await build({ entryPoints: [path.resolve(import.meta.dirname, "..", "update-system", "agent", "agent.js")], outfile: output, bundle: true, platform: "node", format: "esm", target: "node20", minify: true });
console.log(`Agente consolidado em ${output}`);
