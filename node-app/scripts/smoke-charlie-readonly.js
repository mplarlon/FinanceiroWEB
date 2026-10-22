import { query, withReadOnlyDatabase } from "../server/db.js";
import { validateReadOnlySql } from "../server/lib/charlie-sql.js";
import { getOllamaStatus } from "../server/lib/ollama.js";

const payable = validateReadOnlySql(
  "SELECT COUNT(*) AS QTD, COALESCE(SUM(COALESCE(VALOR,0)),0) AS TOTAL FROM CTAPAGAR WHERE STATUS=1 AND DTVENC < CURRENT_DATE",
);
const sales = validateReadOnlySql(
  "SELECT COUNT(DISTINCT se.NRPEDIDO) AS QTD_VENDAS, COALESCE(SUM(COALESCE(sp.SUBTOTAL,sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0)),0) AS TOTAL FROM SAIDAESTOQUE se JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA WHERE CAST(se.DTSAIDA AS DATE) BETWEEN DATE '2026-10-01' AND DATE '2026-10-31' AND se.DTCANCELAMENTO IS NULL AND COALESCE(sp.STATUSSE,0)=0",
);
const out = await withReadOnlyDatabase(async (db) => {
  const titles = await query(db, payable);
  const month = await query(db, sales);
  const meta = await query(
    db,
    "SELECT COUNT(*) AS TABELAS FROM RDB$RELATIONS WHERE COALESCE(RDB$SYSTEM_FLAG,0)=0",
  );
  return { pagar_vencido: titles[0], vendas_outubro: month[0], tabelas_usuario: meta[0] };
});
const ollama = await getOllamaStatus();
console.log(JSON.stringify({ ...out, ollama: { online: ollama.online, model: ollama.model, modelAvailable: ollama.modelAvailable } }));
