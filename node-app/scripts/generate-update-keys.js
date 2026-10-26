import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const destination = path.resolve(process.argv[2] || "update-keys");
fs.mkdirSync(destination, { recursive: true });
const pair = crypto.generateKeyPairSync("ed25519");
fs.writeFileSync(path.join(destination, "release-private.pem"), pair.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
fs.writeFileSync(path.join(destination, "release-public.pem"), pair.publicKey.export({ type: "spki", format: "pem" }), { flag: "wx" });
console.log(`Chaves criadas em ${destination}. A chave privada deve permanecer somente no ambiente seguro de publicacao.`);
