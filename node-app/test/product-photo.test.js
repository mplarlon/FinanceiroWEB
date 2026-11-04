import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  attachReviewPhotos,
  ensureProductPhoto,
  findProductPhoto,
  photoDirectories,
  pickProductPhotoName,
  safeProductId,
} from "../server/lib/product-photo.js";

test("escolhe a foto principal mais nova do código", () => {
  const names = [
    "2604_1_20260101120000.jpg",
    "2604_0_20260327135046.jpg",
    "2604_0_20260603140708.jpg",
    "26040_0_20260603140708.jpg",
    "../segredo.jpg",
    "nota.txt",
  ];
  assert.equal(pickProductPhotoName(names, "2604"), "2604_0_20260603140708.jpg");
  assert.equal(pickProductPhotoName(names, "../2604"), null);
  assert.equal(safeProductId("2604"), "2604");
});

test("a foto resolvida fica dentro da pasta e entra na revisão", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foto-hub-"));
  fs.writeFileSync(path.join(dir, "2604_0_20260603140708.jpg"), "jpg");
  fs.writeFileSync(path.join(dir, "fora.txt"), "x");
  const names = ["2604_0_20260603140708.jpg", "fora.txt"];
  const file = findProductPhoto("2604", [dir], () => names);
  assert.equal(file, path.resolve(dir, "2604_0_20260603140708.jpg"));
  assert.equal(findProductPhoto("9999", [dir], () => names), null);
  const [item] = attachReviewPhotos([{ productId: "2604", productName: "Adaptador" }], [dir], () => names);
  assert.match(item.foto, /^\/api\/modulo_removido\/revisao-hub\/foto\/2604\?v=\d+$/);
  const [sem] = attachReviewPhotos([{ productId: "2583" }], [dir], () => names);
  assert.equal(sem.foto, undefined);
  assert.deepEqual(photoDirectories({ configured: dir, extra: ["Z:\\nao-existe"], fallback: "" }), [path.resolve(dir)]);
});

test("a revisão copia a foto só quando o código ainda não tem arquivo", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foto-hub-"));
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(32, 1),
  ]);
  let calls = 0;
  const created = await ensureProductPhoto({
    productId: "2583",
    productName: "ADAPTADOR SOLDAVEL KR/CA 32x1",
    dirs: [dir],
    at: new Date(2026, 9, 30, 23, 12, 0),
    fetchPhoto: async (product) => {
      calls += 1;
      assert.match(product.name, /32x1/);
      return png;
    },
  });
  assert.equal(calls, 1);
  assert.equal(created.created, true);
  assert.equal(path.basename(created.file), "2583_0_20261030231200.png");
  assert.equal(fs.readFileSync(created.file).length, png.length);
  const again = await ensureProductPhoto({
    productId: "2583",
    productName: "ADAPTADOR SOLDAVEL KR/CA 32x1",
    dirs: [dir],
    fetchPhoto: async () => { calls += 1; return png; },
  });
  assert.equal(calls, 1);
  assert.equal(again.created, false);
  assert.equal(again.file, created.file);
});
