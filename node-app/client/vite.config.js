import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";
import packageJson from "../package.json" with { type: "json" };

const appVersion = process.env.ERP_BUILD_VERSION || packageJson.version;

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), { name: "write-app-version", closeBundle() { const output = path.resolve(import.meta.dirname, "..", "dist", "version.json"); fs.writeFileSync(output, `${JSON.stringify({ version: appVersion, builtAt: new Date().toISOString() })}\n`); } }],
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  build: { outDir: path.resolve(import.meta.dirname, "..", "dist"), emptyOutDir: true },
  server: {
    port: 5173,
    fs: { allow: [path.resolve(import.meta.dirname, "..")] },
    proxy: { "/api": "http://localhost:505" },
  }
});
