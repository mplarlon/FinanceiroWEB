// Apaga uma carga/rota de entrega (tela Expedição > Cargas e rotas) direto no banco.
//
// Uso:
//   node scripts/deletar-carga.js <IDCARGA>
//
// O que faz:
//   1. Busca a carga em RELATENTREGA (+ DASH_EXP_CARGA) e lista as paradas
//      (pedidos) ligadas a ela via RELATENTREGA_PROD.
//   2. Salva um backup em JSON antes de mexer em qualquer coisa.
//   3. Pede para digitar "APAGAR" para confirmar.
//   4. Ao confirmar:
//        - limpa IDENTREGA/DTENTREGA/QTDCARREGADA em SAIDAPRODUTO (sem apagar
//          o pedido/venda em si);
//        - devolve os pedidos ligados à carga para STATUS='LIBERADO' em
//          DASH_EXP_PEDIDO, para poderem ser colocados em outra carga;
//        - apaga RELATENTREGA_PROD, DASH_EXP_CARGA_ITEM, DASH_EXP_CARGA e
//          RELATENTREGA da carga.
//
// Precisa rodar na máquina onde o Firebird do Dashboard está acessível
// (usa a mesma config de C:\ProgramData\Dashboard\database_config.json).

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import fs from "node:fs";
import path from "node:path";
import { attach, query, withWriteTransaction } from "../server/db.js";

const cargaId = Number(process.argv[2]);

if (!cargaId || !Number.isInteger(cargaId)) {
  console.error("Uso: node scripts/deletar-carga.js <IDCARGA>");
  process.exit(1);
}

async function carregarCarga() {
  const db = await attach();
  try {
    const cargas = await query(
      db,
      `SELECT re.IDENTREGA AS IDCARGA, re.DTENTREGA AS DATA_ROTA, re.CDCAMINHAO,
              COALESCE(c.MOTORISTA,'') AS MOTORISTA,
              COALESCE(cg.STATUS, CASE WHEN re.STATUS=1 THEN 'CONCLUIDA' ELSE 'PLANEJADA' END) AS STATUS,
              COALESCE(cg.OBS,re.OBS,'') AS OBS
       FROM RELATENTREGA re
       LEFT JOIN DASH_EXP_CARGA cg ON cg.IDCARGA=re.IDENTREGA
       LEFT JOIN CAMINHAO c ON c.CDCAMINHAO=re.CDCAMINHAO
       WHERE re.IDENTREGA = ?`,
      [cargaId]
    );
    if (!cargas.length) return { carga: null, paradas: [] };
    const paradas = await query(
      db,
      `SELECT NRPEDIDO, IDEMPRESA FROM RELATENTREGA_PROD WHERE IDENTREGA=?`,
      [cargaId]
    );
    return { carga: cargas[0], paradas };
  } finally {
    await db.disconnect();
  }
}

async function main() {
  const { carga, paradas } = await carregarCarga();
  if (!carga) {
    console.log(`Carga #${cargaId} não encontrada em RELATENTREGA. Nada para apagar.`);
    return;
  }

  console.log(`\nCarga #${cargaId}`);
  console.log(`  Data rota: ${carga.DATA_ROTA}`);
  console.log(`  Caminhão: ${carga.CDCAMINHAO}  Motorista: ${carga.MOTORISTA}`);
  console.log(`  Status: ${carga.STATUS}`);
  console.log(`  Paradas (pedidos): ${paradas.length}`);
  for (const p of paradas) {
    console.log(`    - Pedido ${p.NRPEDIDO} / Empresa ${p.IDEMPRESA}`);
  }

  const backupPath = path.resolve(
    import.meta.dirname,
    "..",
    "..",
    `backup_carga_${cargaId}_${Date.now()}.json`
  );
  fs.writeFileSync(backupPath, JSON.stringify({ carga, paradas }, null, 2), "utf8");
  console.log(`\nBackup salvo em: ${backupPath}`);

  console.log(`\nIsso vai apagar a Carga #${cargaId} e devolver ${paradas.length} pedido(s) para status LIBERADO.`);
  console.log("O pedido/venda em si NÃO é apagado, só o registro de logística da carga/rota.");

  const rl = readline.createInterface({ input, output });
  const resposta = (await rl.question('\nDigite "APAGAR" (sem aspas) para confirmar, ou qualquer outra coisa para cancelar: ')).trim();
  rl.close();

  if (resposta !== "APAGAR") {
    console.log("Cancelado. Nada foi alterado.");
    return;
  }

  await withWriteTransaction(async tx => {
    await tx.execute(
      `UPDATE SAIDAPRODUTO SET IDENTREGA=NULL, DTENTREGA=NULL, QTDCARREGADA=NULL WHERE IDENTREGA=?`,
      [cargaId]
    );
    for (const p of paradas) {
      await tx.execute(
        `UPDATE DASH_EXP_PEDIDO SET STATUS='LIBERADO', ATUALIZADO_EM=CURRENT_TIMESTAMP
         WHERE NRPEDIDO=? AND IDEMPRESA=?`,
        [p.NRPEDIDO, p.IDEMPRESA]
      );
    }
    await tx.execute(`DELETE FROM RELATENTREGA_PROD WHERE IDENTREGA=?`, [cargaId]);
    await tx.execute(`DELETE FROM DASH_EXP_CARGA_ITEM WHERE IDCARGA=?`, [cargaId]);
    await tx.execute(`DELETE FROM DASH_EXP_CARGA WHERE IDCARGA=?`, [cargaId]);
    await tx.execute(`DELETE FROM RELATENTREGA WHERE IDENTREGA=?`, [cargaId]);
  });

  console.log(`\nCarga #${cargaId} apagada com sucesso. ${paradas.length} pedido(s) voltaram para LIBERADO.`);
}

main().catch(err => {
  console.error("\nERRO ao apagar (nada foi alterado se a transação não chegou a commitar):", err);
  process.exitCode = 1;
});
