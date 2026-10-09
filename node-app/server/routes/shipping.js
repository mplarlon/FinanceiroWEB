import express from "express";
import { query, withDatabase, withWriteTransaction } from "../db.js";

const router = express.Router();
const allowedOrderStatus = new Set(["AGUARDANDO", "APROVADO", "EM_SEPARACAO", "CONFERIDO", "LIBERADO"]);
const allowedLoadStatus = new Set(["PLANEJADA", "CARREGANDO", "EM_ROTA", "CONCLUIDA"]);
const userId = req => req.dashboardSession?.user?.idusuario || req.dashboardSession?.user?.IDUSUARIO || req.dashboardSession?.user?.id || null;
const read = fn => async (req, res) => {
  try { res.json(await withDatabase(db => fn(db, req))); }
  catch (error) { res.status(500).json({ ok: false, erro: error.message }); }
};

async function ensureStructure(tx) {
  const sequence = await tx.singleton(`SELECT 1 AS OK FROM RDB$GENERATORS WHERE TRIM(RDB$GENERATOR_NAME)='GEN_DASH_EXP_CARGA'`);
  if (!sequence) await tx.execute("CREATE SEQUENCE GEN_DASH_EXP_CARGA");
  const tables = new Set((await tx.query(`SELECT TRIM(RDB$RELATION_NAME) AS NOME FROM RDB$RELATIONS
    WHERE COALESCE(RDB$SYSTEM_FLAG,0)=0`)).map(row => row.NOME));
  if (!tables.has("DASH_EXP_PEDIDO")) await tx.execute(`CREATE TABLE DASH_EXP_PEDIDO (
    NRPEDIDO INTEGER NOT NULL, IDEMPRESA INTEGER NOT NULL, STATUS VARCHAR(20) NOT NULL,
    OBS VARCHAR(500), ATUALIZADO_EM TIMESTAMP NOT NULL, ATUALIZADO_POR INTEGER,
    PRIMARY KEY (NRPEDIDO, IDEMPRESA))`);
  if (!tables.has("DASH_EXP_CARGA")) await tx.execute(`CREATE TABLE DASH_EXP_CARGA (
    IDCARGA BIGINT NOT NULL PRIMARY KEY, DATA_ROTA DATE NOT NULL, CDCAMINHAO INTEGER NOT NULL,
    MOTORISTA VARCHAR(80), STATUS VARCHAR(20) NOT NULL, OBS VARCHAR(500),
    CRIADO_EM TIMESTAMP NOT NULL, CRIADO_POR INTEGER)`);
  if (!tables.has("DASH_EXP_CARGA_ITEM")) await tx.execute(`CREATE TABLE DASH_EXP_CARGA_ITEM (
    IDCARGA BIGINT NOT NULL, NRPEDIDO INTEGER NOT NULL, IDEMPRESA INTEGER NOT NULL,
    ORDEM INTEGER NOT NULL, STATUS VARCHAR(20) NOT NULL, OBS VARCHAR(500),
    PRIMARY KEY (IDCARGA, NRPEDIDO, IDEMPRESA))`);
}

router.get("/opcoes", read(async db => ({ ok: true, caminhoes: await query(db, `
  SELECT CDCAMINHAO, COALESCE(CAMINHAO, PLACA) AS CAMINHAO,
  PLACA, MOTORISTA, CARGA FROM CAMINHAO ORDER BY CAMINHAO, PLACA`) })));

router.get("/pedidos", read(async (db, req) => {
  const busca = String(req.query.busca || "").trim();
  const status = String(req.query.status || "ABERTOS").toUpperCase();
  const params = [];
  const filters = [];
  if (busca) {
    filters.push(`(CAST(se.NRPEDIDO AS VARCHAR(20)) CONTAINING ? OR
      COALESCE(se.CLIENTE,c.CLIENTE,'') CONTAINING ? OR COALESCE(se.BAIRRO,'') CONTAINING ?)`);
    params.push(busca, busca, busca);
  }
  if (status !== "TODOS") {
    if (status === "ABERTOS") filters.push("COALESCE(ep.STATUS,'AGUARDANDO') NOT IN ('EM_ROTA','ENTREGUE')");
    else { filters.push("COALESCE(ep.STATUS,'AGUARDANDO')=?"); params.push(status); }
  }
  const extra = filters.length ? ` AND ${filters.join(" AND ")}` : "";
  const pedidos = await query(db, `SELECT FIRST 300 se.NRPEDIDO, se.IDEMPRESA, se.DTSAIDA,
    COALESCE(se.CLIENTE,c.CLIENTE,'Consumidor') AS CLIENTE,
    COALESCE(se.VLTOTAL,se.VALOR,0) AS TOTAL, COALESCE(se.LOCALENTR,c.ENDERECO,'') AS ENDERECO,
    COALESCE(se.BAIRRO,c.BAIRRO,'') AS BAIRRO, COALESCE(se.CEP,c.CEP,'') AS CEP, se.CDTPENTREGA,
    COALESCE(te.TPENTREGA,se.CDTPENTREGA,'Entrega') AS TIPO_ENTREGA,
    COALESCE(ep.STATUS,'AGUARDANDO') AS STATUS, ep.OBS,
    (SELECT COUNT(*) FROM SAIDAPRODUTO sp WHERE sp.NRPEDIDO=se.NRPEDIDO
      AND sp.IDEMPRESA=se.IDEMPRESA AND COALESCE(sp.STATUSSE,0)=0) AS ITENS
    FROM SAIDAESTOQUE se LEFT JOIN CLIENTE c ON c.CDCLIENTE=se.CDCLIENTE
    LEFT JOIN TPENTREGA te ON te.CDTPENTREGA=se.CDTPENTREGA
    LEFT JOIN DASH_EXP_PEDIDO ep ON ep.NRPEDIDO=se.NRPEDIDO AND ep.IDEMPRESA=se.IDEMPRESA
    WHERE se.DTSAIDA>=DATEADD(-90 DAY TO CURRENT_DATE) AND se.DTCANCELAMENTO IS NULL
      AND COALESCE(se.STATUS,1) IN (1,3) AND COALESCE(se.STATUS_ORC,0)=0
      AND (se.CDTPENTREGA='EN' OR COALESCE(se.LIBERAEXPEDICAO,0)<>0 OR EXISTS
        (SELECT 1 FROM CTARECEBERCAIXA rc WHERE rc.NRPEDIDO=se.NRPEDIDO AND rc.IDEMPRESA=se.IDEMPRESA))
      ${extra} ORDER BY se.DTSAIDA DESC, se.NRPEDIDO DESC`, params);
  return { ok: true, pedidos };
}));

router.post("/pedido/status", async (req, res) => {
  const pedido = Number(req.body.pedido || 0), empresa = Number(req.body.empresa || 0);
  const status = String(req.body.status || "").toUpperCase();
  if (!Number.isInteger(pedido) || !Number.isInteger(empresa) || !allowedOrderStatus.has(status))
    return res.status(400).json({ ok: false, erro: "Pedido, empresa ou etapa inválida." });
  try {
    await withWriteTransaction(async tx => {
      await ensureStructure(tx);
      await tx.execute(`UPDATE OR INSERT INTO DASH_EXP_PEDIDO
        (NRPEDIDO,IDEMPRESA,STATUS,OBS,ATUALIZADO_EM,ATUALIZADO_POR)
        VALUES (?,?,?,?,CURRENT_TIMESTAMP,?) MATCHING (NRPEDIDO,IDEMPRESA)`,
        [pedido, empresa, status, String(req.body.obs || "").slice(0, 500), userId(req)]);
      if (status === "LIBERADO") await tx.execute(`UPDATE SAIDAESTOQUE SET LIBERAEXPEDICAO=1
        WHERE NRPEDIDO=? AND IDEMPRESA=?`, [pedido, empresa]);
    });
    res.json({ ok: true, mensagem: "Etapa da expedição atualizada." });
  } catch (error) { res.status(500).json({ ok: false, erro: error.message }); }
});

router.get("/cargas", read(async db => ({ ok: true, cargas: await query(db, `SELECT FIRST 80
  re.IDENTREGA AS IDCARGA, re.DTENTREGA AS DATA_ROTA, re.CDCAMINHAO,
  COALESCE(c.MOTORISTA,'') AS MOTORISTA,
  COALESCE(cg.STATUS, CASE WHEN re.STATUS=1 THEN 'CONCLUIDA' ELSE 'PLANEJADA' END) AS STATUS,
  COALESCE(cg.OBS,re.OBS) AS OBS, COALESCE(c.PLACA,c.CAMINHAO,'') AS VEICULO,
  COUNT(DISTINCT rp.NRPEDIDO) AS PARADAS FROM RELATENTREGA re
  LEFT JOIN DASH_EXP_CARGA cg ON cg.IDCARGA=re.IDENTREGA
  LEFT JOIN CAMINHAO c ON c.CDCAMINHAO=re.CDCAMINHAO
  LEFT JOIN RELATENTREGA_PROD rp ON rp.IDENTREGA=re.IDENTREGA
  GROUP BY re.IDENTREGA,re.DTENTREGA,re.CDCAMINHAO,c.MOTORISTA,cg.STATUS,re.STATUS,
    cg.OBS,re.OBS,c.PLACA,c.CAMINHAO ORDER BY re.DTENTREGA DESC,re.IDENTREGA DESC`) })));

router.post("/cargas", async (req, res) => {
  const itens = Array.isArray(req.body.pedidos) ? req.body.pedidos : [];
  const caminhao = Number(req.body.caminhao || 0);
  if (!Number.isInteger(caminhao) || !itens.length)
    return res.status(400).json({ ok: false, erro: "Selecione o caminhão e pelo menos um pedido liberado." });
  try {
    const carga = await withWriteTransaction(async tx => {
      await ensureStructure(tx);
      const next = await tx.singleton("SELECT NEXT VALUE FOR GEN_RELATENTREGA AS ID FROM RDB$DATABASE");
      const id = Number(next.ID);
      const truck = await tx.singleton("SELECT MOTORISTA,IDTRANSP FROM CAMINHAO WHERE CDCAMINHAO=?", [caminhao]);
      const motorista = String(req.body.motorista || truck?.MOTORISTA || "").slice(0, 80);
      const dataRota = String(req.body.data_rota || new Date().toISOString().slice(0, 10));
      const empresaCarga = Number(itens[0].empresa);
      await tx.execute(`INSERT INTO RELATENTREGA
        (IDENTREGA,IDTRANSP,DTENTREGA,DTALTER,SIST_ALT,CDCAMINHAO,IDEMPRESA,STATUS,OBS,CDUSUARIO)
        VALUES (?,?,?,CURRENT_TIMESTAMP,'LOCAL',?,?,0,?,?)`,
        [id, truck?.IDTRANSP || null, dataRota, caminhao, empresaCarga, String(req.body.obs || "").slice(0,255), userId(req)]);
      await tx.execute(`INSERT INTO DASH_EXP_CARGA
        (IDCARGA,DATA_ROTA,CDCAMINHAO,MOTORISTA,STATUS,OBS,CRIADO_EM,CRIADO_POR)
        VALUES (?,?,?,?,'PLANEJADA',?,CURRENT_TIMESTAMP,?)`,
        [id, dataRota, caminhao, motorista, String(req.body.obs || "").slice(0,500), userId(req)]);
      for (let index = 0; index < itens.length; index++) {
        const pedido = Number(itens[index].pedido), empresa = Number(itens[index].empresa), ordem = index + 1;
        const current = await tx.singleton("SELECT STATUS FROM DASH_EXP_PEDIDO WHERE NRPEDIDO=? AND IDEMPRESA=?", [pedido, empresa]);
        if (current?.STATUS !== "LIBERADO") throw new Error(`O pedido ${pedido} ainda não está liberado para carga.`);
        const active = await tx.singleton(`SELECT COUNT(*) AS TOTAL FROM SAIDAPRODUTO WHERE NRPEDIDO=?
          AND IDEMPRESA=? AND COALESCE(STATUSSE,0)=0`, [pedido, empresa]);
        if (!Number(active?.TOTAL)) throw new Error(`O pedido ${pedido} não possui itens ativos em SAIDAPRODUTO.`);
        await tx.execute("INSERT INTO DASH_EXP_CARGA_ITEM VALUES (?,?,?,?,?,?)", [id,pedido,empresa,ordem,"PLANEJADO",""]);
        await tx.execute(`INSERT INTO RELATENTREGA_PROD
          (IDENTREGA,NRPEDIDO,POSIC,IDEMPRESA,QTDELIB,DTALTER,SIST_ALT,CONTROLE,STATUSRE,OBS,CDPRODUTO,ORDEM,OBS_ENTREGA)
          SELECT ?,sp.NRPEDIDO,sp.POSIC,sp.IDEMPRESA,
          COALESCE(NULLIF(sp.QTDENTREGAR,0),NULLIF(sp.QTDELIB,0),sp.QTDPRODUTO),
          CURRENT_TIMESTAMP,'LOCAL',NULL,0,'',sp.CDPRODUTO,?,COALESCE(sp.OBSPROD,'')
          FROM SAIDAPRODUTO sp WHERE sp.NRPEDIDO=? AND sp.IDEMPRESA=? AND COALESCE(sp.STATUSSE,0)=0`,
          [id, ordem, pedido, empresa]);
        await tx.execute(`UPDATE SAIDAPRODUTO SET IDENTREGA=?,DTENTREGA=?,
          QTDCARREGADA=COALESCE(NULLIF(QTDENTREGAR,0),NULLIF(QTDELIB,0),QTDPRODUTO)
          WHERE NRPEDIDO=? AND IDEMPRESA=? AND COALESCE(STATUSSE,0)=0`, [id,dataRota,pedido,empresa]);
        await tx.execute(`UPDATE DASH_EXP_PEDIDO SET STATUS='EM_ROTA',ATUALIZADO_EM=CURRENT_TIMESTAMP,
          ATUALIZADO_POR=? WHERE NRPEDIDO=? AND IDEMPRESA=?`, [userId(req),pedido,empresa]);
      }
      return id;
    });
    res.json({ ok: true, carga, mensagem: `Carga #${carga} montada com ${itens.length} parada(s).` });
  } catch (error) { res.status(400).json({ ok: false, erro: error.message }); }
});

router.post("/carga/:carga/status", async (req, res) => {
  const carga = Number(req.params.carga), status = String(req.body.status || "").toUpperCase();
  if (!Number.isInteger(carga) || !allowedLoadStatus.has(status))
    return res.status(400).json({ ok: false, erro: "Status de carga inválido." });
  try {
    await withWriteTransaction(async tx => {
      await tx.execute("UPDATE DASH_EXP_CARGA SET STATUS=? WHERE IDCARGA=?", [status,carga]);
      await tx.execute("UPDATE RELATENTREGA SET STATUS=?,DTALTER=CURRENT_TIMESTAMP WHERE IDENTREGA=?", [status === "CONCLUIDA" ? 1 : 0,carga]);
      if (status === "CONCLUIDA") {
        await tx.execute(`UPDATE DASH_EXP_PEDIDO ep SET ep.STATUS='ENTREGUE',ep.ATUALIZADO_EM=CURRENT_TIMESTAMP
          WHERE EXISTS (SELECT 1 FROM DASH_EXP_CARGA_ITEM ci WHERE ci.IDCARGA=?
          AND ci.NRPEDIDO=ep.NRPEDIDO AND ci.IDEMPRESA=ep.IDEMPRESA)`, [carga]);
        await tx.execute("UPDATE DASH_EXP_CARGA_ITEM SET STATUS='ENTREGUE' WHERE IDCARGA=?", [carga]);
        await tx.execute("UPDATE RELATENTREGA_PROD SET STATUSRE=1,DTALTER=CURRENT_TIMESTAMP WHERE IDENTREGA=?", [carga]);
      }
    });
    res.json({ ok: true });
  } catch (error) { res.status(500).json({ ok: false, erro: error.message }); }
});

export default router;
