import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeTrayProductSuggestion } from "../server/lib/tray-product-ai.js";

test("normaliza e limita o texto sugerido para produto Tray", () => {
  const result = sanitizeTrayProductSuggestion({
    name: `  Pastilha   de Freio ${"X".repeat(150)}  `,
    description_small: "Texto   curto",
    description: "Descrição completa",
    meta_title: "T".repeat(100),
    meta_description: "M".repeat(200),
    keywords: "freio, carro",
  });
  assert.equal(result.name.length, 120);
  assert.equal(result.description_small, "Texto curto");
  assert.equal(result.meta_title.length, 70);
  assert.equal(result.meta_description.length, 160);
});
