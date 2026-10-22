import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: { outDir: path.resolve(import.meta.dirname, "..", "dist"), emptyOutDir: true },
  server: {
    port: 5173,
    fs: { allow: [path.resolve(import.meta.dirname, "..")] },
    proxy: { "/api": "http://localhost:505" },
  }
});
