import express from "express";
import { query, withDatabase } from "../db.js";

const router = express.Router();
const run = fn => async (req, res) => {
  try { res.json(await withDatabase(db => fn(db, req))); }
  catch (error) { res.status(500).json({ ok: false, erro: error.message }); }
};

router.get("/options", run(async db => ({ ok: true,
  cfops: await query(db, `SELECT FIRST 200 TRIM(nfp.CFOP) AS ID, TRIM(nfp.CFOP) AS NOME
    FROM NFE_PRODUTO nfp WHERE nfp.CFOP IS NOT NULL AND TRIM(nfp.CFOP) <> ''
    GROUP BY TRIM(nfp.CFOP) ORDER BY TRIM(nfp.CFOP)`),
  tipos: [{ ID: "saida", NOME: "Saida" }, { ID: "entrada", NOME: "Entrada" },
    { ID: "devolucao", NOME: "Devolucao" }, { ID: "bonificacao", NOME: "Bonificacao" },
    { ID: "remessa", NOME: "Remessa" }, { ID: "transferencia", NOME: "Transferencia" }]
})));

export default router;
