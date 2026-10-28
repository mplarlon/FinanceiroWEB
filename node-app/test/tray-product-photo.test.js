import assert from "node:assert/strict";
import test from "node:test";
import { trayProductPhoto } from "../server/lib/tray-product-photo.js";

const thumb = "https://images.tcdn.com.br/img/img_prod/1/90_foto.jpg";

test("a miniatura da Tray usa o thumb 90 em https", () => {
  const foto = trayProductPhoto({
    ProductImage: [{
      https: "https://images.tcdn.com.br/img/img_prod/1/foto.jpg",
      thumbs: { 90: { https: thumb }, 180: { https: "https://images.tcdn.com.br/img/img_prod/1/180_foto.jpg" } },
    }],
  });
  assert.equal(foto, thumb);
});

test("http do CDN da Tray vira https e outro host é descartado", () => {
  assert.equal(
    trayProductPhoto({ image: "http://images.tcdn.com.br/img/img_prod/1/foto.jpg" }),
    "https://images.tcdn.com.br/img/img_prod/1/foto.jpg",
  );
  assert.equal(trayProductPhoto({ image: "0" }), null);
  assert.equal(trayProductPhoto({ image: "1" }), null);
  assert.equal(trayProductPhoto({ ProductImage: [{ https: "https://evil.example/foto.jpg" }] }), null);
  assert.equal(trayProductPhoto({ name: "Sem foto" }), null);
});
