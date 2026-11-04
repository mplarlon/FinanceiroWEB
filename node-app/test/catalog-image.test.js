import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { generateLocalCatalogImage, localImageArgs } from "../server/lib/catalog-image.js";

test("o comando da foto pede fundo de produto e um png", () => {
  const args = localImageArgs("adaptador soldavel 32 mm", {
    model: "C:\\modelos\\sd.safetensors",
    output: "C:\\temp\\foto.png",
  });
  assert.equal(args[0], "-m");
  assert.equal(args[1], "C:\\modelos\\sd.safetensors");
  assert.match(args[args.indexOf("-p") + 1], /adaptador soldavel/);
  assert.equal(args[args.indexOf("-o") + 1], "C:\\temp\\foto.png");
  assert.equal(args[args.indexOf("-W") + 1], "512");
});

test("sem runner instalado a revisão não gera arquivo", async () => {
  const bytes = await generateLocalCatalogImage("adaptador", { paths: { bin: "", model: "" } });
  assert.equal(bytes, null);
});

test("a foto gerada pelo runner entra como png", async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40, 3)]);
  const bytes = await generateLocalCatalogImage("adaptador branco", {
    paths: { bin: "sd-cli.exe", model: "modelo.safetensors" },
    spawnProcess(bin, args) {
      assert.equal(bin, "sd-cli.exe");
      fs.writeFileSync(args[args.indexOf("-o") + 1], png);
      return {
        kill() {},
        on(event, fn) {
          if (event === "exit") queueMicrotask(() => fn(0));
          return this;
        },
      };
    },
  });
  assert.equal(bytes.equals(png), true);
});
