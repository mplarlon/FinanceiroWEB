import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";

const require = createRequire(import.meta.url);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fontDir = path.join(path.dirname(require.resolve("pdfkit")), "standard-fonts");

export const pdfkitStandardFonts = {
  name: "pdfkit-standard-fonts",
  setup(build) {
    build.onLoad({ filter: /[\\/]pdfkit[\\/]js[\\/]pdfkit\.node\.mjs$/ }, async (args) => {
      const source = await fs.readFile(args.path, "utf8");
      const bindings = new Map();
      const contents = source.replace(/require\$\d+\((['"])#standard-fonts\/([^'"]+)\1\)/g, (_match, _quote, name) => {
        let binding = bindings.get(name);
        if (!binding) {
          binding = `standardFont_${name.replace(/[^A-Za-z0-9]/g, "_")}`;
          bindings.set(name, binding);
        }
        return binding;
      });
      if (!bindings.size) {
        throw new Error("pdfkit mudou o carregamento das fontes padrão e o PDF do instalador quebraria.");
      }
      const header = [...bindings]
        .map(([name, binding]) => `import ${binding} from ${JSON.stringify(path.join(fontDir, `${name}.mjs`))};`)
        .join("\n");
      return { contents: `${header}\n${contents}`, loader: "js" };
    });
  },
};

async function bundleServer(outfile) {
  await esbuild.build({
    absWorkingDir: appRoot,
    entryPoints: [path.join(appRoot, "server", "index.js")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    minify: true,
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    external: ["node-firebird-native-api"],
    plugins: [pdfkitStandardFonts],
  });
  const bundled = await fs.readFile(outfile, "utf8");
  if (bundled.includes("#standard-fonts")) {
    throw new Error("O pacote ainda referencia #standard-fonts. O PDF falharia no cliente.");
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  const outfile = process.argv[2];
  if (!outfile) {
    console.error("Uso: node scripts/bundle-server.js <dashboard.mjs>");
    process.exit(1);
  }
  bundleServer(outfile).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
