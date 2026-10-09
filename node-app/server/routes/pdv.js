import fs from "node:fs";
import path from "node:path";
import express from "express";
import { query, withDatabase, withWriteTransaction } from "../db.js";

const router = express.Router();
const run = (fn) => async (req, res) => {
  try {
    res.json(await withDatabase((db) => fn(db, req)));
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
};
const userId = (req) => Number(req.dashboardSession?.user?.idusuario || 1);
const isAdmin = (req) =>
  Boolean(req.dashboardSession?.user?.permissao_gerencial);
async function exists(tx, kind, name) {
  const table = kind === "sequence" ? "RDB$GENERATORS" : "RDB$RELATIONS",
    field = kind === "sequence" ? "RDB$GENERATOR_NAME" : "RDB$RELATION_NAME";
  return Boolean(
    await tx.singleton(`SELECT 1 AS OK FROM ${table} WHERE TRIM(${field})=?`, [
      name,
    ]),
  );
}
async function ensureSchema(tx) {
  if (!(await exists(tx, "sequence", "GEN_DASH_PDV_LIBERACAO")))
    await tx.execute("CREATE SEQUENCE GEN_DASH_PDV_LIBERACAO");
  if (!(await exists(tx, "table", "DASH_PDV_LIBERACAO")))
    await tx.execute(
      "CREATE TABLE DASH_PDV_LIBERACAO (IDLIBERACAO BIGINT NOT NULL PRIMARY KEY,CDPRODUTO VARCHAR(10) NOT NULL,QUANTIDADE NUMERIC(18,4) NOT NULL,STATUS VARCHAR(12) NOT NULL,SOLICITADO_POR INTEGER,SOLICITADO_EM TIMESTAMP NOT NULL,DECIDIDO_POR INTEGER,DECIDIDO_EM TIMESTAMP,OBSERVACAO VARCHAR(500),NRPEDIDO INTEGER,TIPO VARCHAR(20) DEFAULT 'SEM_ESTOQUE',VALOR_SOLICITADO NUMERIC(18,2),VALOR_LIMITE NUMERIC(18,2))",
    );
  else {
    const rows = await tx.query(
        "SELECT TRIM(RDB$FIELD_NAME) AS NOME FROM RDB$RELATION_FIELDS WHERE TRIM(RDB$RELATION_NAME)='DASH_PDV_LIBERACAO'",
      ),
      fields = new Set(rows.map((row) => row.NOME));
    for (const [name, ddl] of [
      ["TIPO", "VARCHAR(20) DEFAULT 'SEM_ESTOQUE'"],
      ["VALOR_SOLICITADO", "NUMERIC(18,2)"],
      ["VALOR_LIMITE", "NUMERIC(18,2)"],
    ])
      if (!fields.has(name))
        await tx.execute(`ALTER TABLE DASH_PDV_LIBERACAO ADD ${name} ${ddl}`);
  }
}

export function normalizeReleaseRequest(body = {}) {
  const type = String(body.tipo || "SEM_ESTOQUE")
    .trim()
    .toUpperCase();
  if (!["SEM_ESTOQUE", "DESCONTO"].includes(type))
    throw Object.assign(new Error("Tipo de liberacao invalido."), {
      status: 400,
    });
  if (type === "DESCONTO") {
    const value = Math.round(Number(body.valor || 0) * 100) / 100,
      limit = Math.round(Number(body.limite || 0) * 100) / 100;
    if (
      !Number.isFinite(value) ||
      !Number.isFinite(limit) ||
      value < 0 ||
      limit < 0
    )
      throw Object.assign(new Error("Valores de desconto invalidos."), {
        status: 400,
      });
    return {
      type,
      value,
      limit,
      note: String(body.observacao || "").slice(0, 500),
    };
  }
  const product = String(body.produto || "").trim(),
    quantity = Number(body.quantidade ?? 1);
  if (!product || !Number.isFinite(quantity) || quantity <= 0)
    throw Object.assign(new Error("Produto e quantidade sao obrigatorios."), {
      status: 400,
    });
  return {
    type,
    product,
    quantity,
    note: String(body.observacao || "").slice(0, 500),
  };
}

router.get(
  "/pdv/produtos",
  run(async (db, req) => {
    const term = String(req.query.q || "").trim(),
      params = [],
      filter = ["p.INATIVO=0"];
    if (term) {
      filter.push(
        "(UPPER(p.PRODUTO) CONTAINING CAST(? AS VARCHAR(250)) OR CAST(p.CDPRODUTO AS VARCHAR(50)) CONTAINING CAST(? AS VARCHAR(50)) OR COALESCE(p.CODIGOBARRA,'') CONTAINING CAST(? AS VARCHAR(50)))",
      );
      params.push(term.toUpperCase(), term, term);
    }
    params.push(term, term);
    const produtos = await query(
      db,
      `SELECT p.CDPRODUTO AS ID,p.CDPRODUTO AS CODIGO_PRODUTO,COALESCE(NULLIF(p.CODIGOBARRA,''),p.CDPRODUTO) AS CODIGO,p.PRODUTO AS NOME,COALESCE(p.GRUPO,'Produtos') AS CATEGORIA,COALESCE(pp.PRECO,0) AS PRECO,COALESCE(p.IDPRECO,1) AS IDPRECO,COALESCE(tp.VLPERCAUMENTO,0) AS LIMITE_ALTERACAO,COALESCE(tp.TPPERCAUMENTO,-1) AS TIPO_LIMITE,NULLIF(TRIM(p.URL_FOTO_ITS),'') AS URL_IMAGEM,CASE WHEN NULLIF(TRIM(p.FOTO),'') IS NOT NULL THEN 1 ELSE 0 END AS TEM_IMAGEM_LOCAL,COALESCE((SELECT SUM(m.QTDEATUAL) FROM MOVIMENTO m WHERE m.CDPRODUTO=p.CDPRODUTO),0) AS ESTOQUE FROM PRODUTO p LEFT JOIN PRODUTOPRECO pp ON pp.CDPRODUTO=p.CDPRODUTO AND pp.IDPRECO=COALESCE(p.IDPRECO,1) AND pp.CDUNIDADE=COALESCE(NULLIF(p.CDUNIDVENDA,''),NULLIF(p.CDUNIDADE,''),'UN') LEFT JOIN TABELAPRECO tp ON tp.IDPRECO=COALESCE(p.IDPRECO,1) WHERE ${filter.join(" AND ")} ORDER BY CASE WHEN TRIM(CAST(p.CDPRODUTO AS VARCHAR(50)))=CAST(? AS VARCHAR(50)) THEN 0 WHEN TRIM(COALESCE(p.CODIGOBARRA,''))=CAST(? AS VARCHAR(50)) THEN 1 ELSE 2 END,p.PRODUTO`,
      params,
    );
    return { ok: true, produtos };
  }),
);

router.get("/pdv/produtos/:productId/imagem", async (req, res) => {
  try {
    const row = await withDatabase(
        async (db) =>
          (
            await query(
              db,
              "SELECT FIRST 1 FOTO FROM PRODUTO WHERE CDPRODUTO=? AND INATIVO=0 AND NULLIF(TRIM(FOTO),'') IS NOT NULL",
              [req.params.productId],
            )
          )[0],
      ),
      file = String(row?.FOTO || "").trim(),
      resolved = path.resolve(file);
    if (
      !file ||
      !path.isAbsolute(resolved) ||
      !fs.existsSync(resolved) ||
      !fs.statSync(resolved).isFile()
    )
      return res
        .status(404)
        .json({ ok: false, erro: "Imagem do produto nao encontrada." });
    res.set("Cache-Control", "private, max-age=3600");
    res.sendFile(resolved);
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});

router.get("/pdv/liberacoes", async (req, res) => {
  try {
    const result = await withWriteTransaction(async (tx) => {
      await ensureSchema(tx);
      const status = String(req.query.status || "PENDENTE")
          .trim()
          .toUpperCase(),
        params = [],
        clause = status === "TODOS" ? "" : "WHERE l.STATUS=?";
      if (clause) params.push(status);
      const rows = await tx.query(
        `SELECT l.IDLIBERACAO,l.CDPRODUTO,p.PRODUTO,l.QUANTIDADE,l.STATUS,l.SOLICITADO_EM,l.DECIDIDO_EM,l.OBSERVACAO,COALESCE(l.TIPO,'SEM_ESTOQUE') AS TIPO,l.VALOR_SOLICITADO,l.VALOR_LIMITE,COALESCE(us.NOMECOMPLETO,us.LOGIN) AS SOLICITANTE,COALESCE(ud.NOMECOMPLETO,ud.LOGIN) AS RESPONSAVEL FROM DASH_PDV_LIBERACAO l LEFT JOIN PRODUTO p ON p.CDPRODUTO=l.CDPRODUTO LEFT JOIN USUARIOS us ON us.IDUSUARIO=l.SOLICITADO_POR LEFT JOIN USUARIOS ud ON ud.IDUSUARIO=l.DECIDIDO_POR ${clause} ORDER BY l.SOLICITADO_EM DESC,l.IDLIBERACAO DESC`,
        params,
      );
      return rows;
    });
    res.json({ ok: true, liberacoes: result, admin: isAdmin(req) });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

router.post("/pdv/liberacoes", async (req, res) => {
  try {
    const input = normalizeReleaseRequest(req.body),
      uid = userId(req);
    if (input.type === "DESCONTO" && input.value <= input.limit)
      return res.json({ ok: true, necessaria: false });
    const result = await withWriteTransaction(async (tx) => {
      await ensureSchema(tx);
      if (input.type === "DESCONTO") {
        const existing = await tx.singleton(
          "SELECT FIRST 1 IDLIBERACAO FROM DASH_PDV_LIBERACAO WHERE COALESCE(TIPO,'SEM_ESTOQUE')='DESCONTO' AND SOLICITADO_POR=? AND STATUS='PENDENTE' ORDER BY SOLICITADO_EM DESC",
          [uid],
        );
        if (existing) {
          await tx.execute(
            "UPDATE DASH_PDV_LIBERACAO SET QUANTIDADE=?,VALOR_SOLICITADO=?,VALOR_LIMITE=?,OBSERVACAO=?,SOLICITADO_EM=CURRENT_TIMESTAMP WHERE IDLIBERACAO=?",
            [
              input.value,
              input.value,
              input.limit,
              input.note,
              existing.IDLIBERACAO,
            ],
          );
          return { id: Number(existing.IDLIBERACAO), type: input.type };
        }
        const next = await tx.singleton(
          "SELECT NEXT VALUE FOR GEN_DASH_PDV_LIBERACAO AS ID FROM RDB$DATABASE",
        );
        await tx.execute(
          "INSERT INTO DASH_PDV_LIBERACAO (IDLIBERACAO,CDPRODUTO,QUANTIDADE,STATUS,SOLICITADO_POR,SOLICITADO_EM,TIPO,VALOR_SOLICITADO,VALOR_LIMITE,OBSERVACAO) VALUES (?,'@DESCONTO',?,'PENDENTE',?,CURRENT_TIMESTAMP,'DESCONTO',?,?,?)",
          [next.ID, input.value, uid, input.value, input.limit, input.note],
        );
        return { id: Number(next.ID), type: input.type };
      }
      const product = await tx.singleton(
        "SELECT FIRST 1 p.PRODUTO,COALESCE((SELECT SUM(m.QTDEATUAL) FROM MOVIMENTO m WHERE m.CDPRODUTO=p.CDPRODUTO),0) AS ESTOQUE FROM PRODUTO p WHERE p.CDPRODUTO=? AND p.INATIVO=0",
        [input.product],
      );
      if (!product)
        throw Object.assign(new Error("Produto ativo nao encontrado."), {
          status: 400,
        });
      if (Number(product.ESTOQUE) > 0) return { needed: false };
      const existing = await tx.singleton(
        "SELECT FIRST 1 IDLIBERACAO FROM DASH_PDV_LIBERACAO WHERE CDPRODUTO=? AND SOLICITADO_POR=? AND STATUS='PENDENTE' ORDER BY SOLICITADO_EM DESC",
        [input.product, uid],
      );
      if (existing) {
        await tx.execute(
          "UPDATE DASH_PDV_LIBERACAO SET QUANTIDADE=? WHERE IDLIBERACAO=?",
          [input.quantity, existing.IDLIBERACAO],
        );
        return {
          id: Number(existing.IDLIBERACAO),
          type: input.type,
          product: product.PRODUTO,
        };
      }
      const next = await tx.singleton(
        "SELECT NEXT VALUE FOR GEN_DASH_PDV_LIBERACAO AS ID FROM RDB$DATABASE",
      );
      await tx.execute(
        "INSERT INTO DASH_PDV_LIBERACAO (IDLIBERACAO,CDPRODUTO,QUANTIDADE,STATUS,SOLICITADO_POR,SOLICITADO_EM,TIPO) VALUES (?,?,?,'PENDENTE',?,CURRENT_TIMESTAMP,'SEM_ESTOQUE')",
        [next.ID, input.product, input.quantity, uid],
      );
      return {
        id: Number(next.ID),
        type: input.type,
        product: product.PRODUTO,
      };
    });
    if (result.needed === false)
      return res.json({ ok: true, necessaria: false });
    res.json({
      ok: true,
      necessaria: true,
      liberacao_id: result.id,
      status: "PENDENTE",
      tipo: result.type,
      produto: result.product,
    });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

router.post("/pdv/liberacoes/:releaseId", async (req, res) => {
  try {
    if (!isAdmin(req))
      return res.status(403).json({
        ok: false,
        erro: "Somente um administrador pode decidir a liberacao.",
      });
    const id = Number(req.params.releaseId),
      decision = String(req.body?.decisao || "")
        .trim()
        .toUpperCase();
    if (
      !Number.isInteger(id) ||
      id < 1 ||
      !["APROVADO", "REJEITADO"].includes(decision)
    )
      throw Object.assign(new Error("Decisao invalida."), { status: 400 });
    const changed = await withWriteTransaction(async (tx) => {
      await ensureSchema(tx);
      const pending = await tx.singleton(
        "SELECT IDLIBERACAO FROM DASH_PDV_LIBERACAO WHERE IDLIBERACAO=? AND STATUS='PENDENTE'",
        [id],
      );
      if (!pending) return false;
      await tx.execute(
        "UPDATE DASH_PDV_LIBERACAO SET STATUS=?,DECIDIDO_POR=?,DECIDIDO_EM=CURRENT_TIMESTAMP,OBSERVACAO=? WHERE IDLIBERACAO=? AND STATUS='PENDENTE'",
        [
          decision,
          userId(req),
          String(req.body?.observacao || "").slice(0, 500),
          id,
        ],
      );
      return true;
    });
    if (!changed)
      return res
        .status(409)
        .json({ ok: false, erro: "Pendencia nao encontrada ou ja decidida." });
    res.json({ ok: true, id, status: decision });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

router.post("/pdv/venda", async (req, res) => {
  try {
    const body = req.body || {},
      company = Number(body.empresa || 0),
      cash = Number(body.caixa || 0),
      customer = Number(body.cliente_id || 0) || null,
      customerName = String(body.cliente_nome || "Consumidor final").trim(),
      method = String(body.forma || "")
        .trim()
        .toLowerCase(),
      total = Math.round(Number(body.total || 0) * 100) / 100,
      discount = Math.round(Number(body.desconto || 0) * 100) / 100,
      addition = Math.round(Number(body.acrescimo || 0) * 100) / 100,
      subtotal = Math.round(Number(body.subtotal || 0) * 100) / 100,
      discountRelease = Number(body.desconto_liberacao_id || 0),
      items = Array.isArray(body.itens) ? body.itens : [];
    if (
      !company ||
      !cash ||
      !customer ||
      !items.length ||
      !Number.isFinite(total) ||
      total <= 0
    )
      throw Object.assign(
        new Error("Informe empresa, caixa, cliente, itens e total da venda."),
        { status: 400 },
      );
    if (
      Math.abs(
        total - Math.round((subtotal + addition - discount) * 100) / 100,
      ) > 0.009
    )
      throw Object.assign(
        new Error("O total da venda nao confere com desconto e acrescimo."),
        { status: 400 },
      );
    const result = await withWriteTransaction(async (tx) => {
      await ensureSchema(tx);
      const terms = {
        dinheiro: ["DINHEIRO"],
        pix: ["PIX"],
        debito: ["DEBITO", "DÉBITO"],
        credito: ["CREDITO", "CRÉDITO"],
        boleto: ["BOLETO"],
      }[method];
      if (!terms)
        throw Object.assign(new Error("Forma de pagamento invalida."), {
          status: 400,
        });
      const where = terms
          .map(() => "UPPER(COALESCE(RECEBTO,'')) CONTAINING ?")
          .join(" OR "),
        form = await tx.singleton(
          `SELECT FIRST 1 CDRECEBTO,COALESCE(USARLIMITEDESC,0) AS USA_LIMITE,COALESCE(LIMITEDESC,0) AS LIMITE,CDGRUPO,COALESCE(CCUSTO,1) AS CCUSTO FROM RECEBTO WHERE COALESCE(INATIVO,0)=0 AND (${where}) ORDER BY CDRECEBTO`,
          terms,
        );
      if (!form)
        throw Object.assign(
          new Error("Forma de pagamento correspondente nao encontrada no ERP."),
          { status: 400 },
        );
      const order = Number(
          (
            await tx.singleton(
              "SELECT COALESCE(MAX(NRPEDIDO),0)+1 AS ID FROM SAIDAESTOQUE WHERE IDEMPRESA=?",
              [company],
            )
          ).ID,
        ),
        seller = await tx.singleton(
          "SELECT FIRST 1 CDVENDEDOR FROM VENDEDOR ORDER BY CDVENDEDOR",
        );
      if (!seller)
        throw Object.assign(new Error("Nenhum vendedor cadastrado no ERP."), {
          status: 400,
        });
      let tableLimit = 0;
      const prepared = [];
      for (const raw of items) {
        const code = String(raw.produto || raw.codigo || "").trim(),
          quantity = Number(raw.quantidade || 0),
          unit = Math.round(Number(raw.valor_unitario || 0) * 10000) / 10000;
        if (!code || quantity <= 0 || unit <= 0)
          throw Object.assign(
            new Error("Produto, quantidade ou valor unitario invalido."),
            { status: 400 },
          );
        const product = await tx.singleton(
          "SELECT FIRST 1 p.PRODUTO,COALESCE(NULLIF(p.CDUNIDVENDA,''),NULLIF(p.CDUNIDADE,''),'UN') AS UNID,COALESCE(p.CDDEPOSITO,(SELECT FIRST 1 d.CDDEPOSITO FROM DEPOSITO d WHERE (d.IDEMPRESA=? OR d.IDEMPRESA IS NULL) AND COALESCE(d.INATIVO,0)=0 ORDER BY d.CDDEPOSITO)) AS DEPOSITO,COALESCE(pp.VLCUSTO,p.VLCUSTOMEDIO,0) AS CUSTO,COALESCE(p.IDPRECO,1) AS IDPRECO,COALESCE((SELECT SUM(m.QTDEATUAL) FROM MOVIMENTO m WHERE m.CDPRODUTO=p.CDPRODUTO),0) AS ESTOQUE,COALESCE(pp.PRECO,0) AS PRECO,COALESCE(tp.VLPERCAUMENTO,0) AS LIMITE,COALESCE(tp.TPPERCAUMENTO,-1) AS TIPO_LIMITE,COALESCE(tp.RESTRINGIR_FOMAPAGTO,0) AS RESTRINGE FROM PRODUTO p LEFT JOIN PRODUTOPRECO pp ON pp.CDPRODUTO=p.CDPRODUTO AND pp.IDPRECO=COALESCE(p.IDPRECO,1) AND pp.CDUNIDADE=COALESCE(NULLIF(p.CDUNIDVENDA,''),NULLIF(p.CDUNIDADE,''),'UN') LEFT JOIN TABELAPRECO tp ON tp.IDPRECO=COALESCE(p.IDPRECO,1) WHERE p.CDPRODUTO=? AND p.INATIVO=0",
          [company, code],
        );
        if (!product?.DEPOSITO)
          throw Object.assign(
            new Error(`Produto ${code} nao encontrado ou sem deposito.`),
            { status: 400 },
          );
        if (Number(product.RESTRINGE)) {
          const allowed = await tx.singleton(
            "SELECT FIRST 1 1 AS OK FROM TABELAPRECO_RECEBTO WHERE IDPRECO=? AND CDRECEBTO=?",
            [product.IDPRECO, form.CDRECEBTO],
          );
          if (!allowed)
            throw Object.assign(
              new Error(
                `A tabela de preco ${product.IDPRECO} nao permite a forma de recebimento selecionada.`,
              ),
              { status: 400 },
            );
        }
        tableLimit +=
          Number(product.TIPO_LIMITE) === -1
            ? (Number(product.PRECO) * quantity * Number(product.LIMITE)) / 100
            : Number(product.LIMITE) * quantity;
        if (Number(product.ESTOQUE) <= 0) {
          const release = await tx.singleton(
            "SELECT FIRST 1 IDLIBERACAO FROM DASH_PDV_LIBERACAO WHERE IDLIBERACAO=? AND CDPRODUTO=? AND STATUS='APROVADO' AND QUANTIDADE>=?",
            [Number(raw.liberacao_id || 0), code, quantity],
          );
          if (!release)
            throw Object.assign(
              new Error(
                `O produto ${code} esta sem estoque e ainda nao possui liberacao aprovada.`,
              ),
              { status: 409 },
            );
        }
        prepared.push({ raw, code, quantity, unit, product });
      }
      tableLimit = Math.round(Math.max(0, tableLimit) * 100) / 100;
      const paymentLimit = Number(form.USA_LIMITE)
          ? Math.round(((subtotal * Number(form.LIMITE)) / 100) * 100) / 100
          : tableLimit,
        allowedDiscount = Math.min(tableLimit, paymentLimit);
      if (discount > allowedDiscount + 0.001) {
        const release = await tx.singleton(
          "SELECT FIRST 1 IDLIBERACAO FROM DASH_PDV_LIBERACAO WHERE IDLIBERACAO=? AND COALESCE(TIPO,'SEM_ESTOQUE')='DESCONTO' AND STATUS='APROVADO' AND VALOR_SOLICITADO>=?",
          [discountRelease, discount],
        );
        if (!release)
          throw Object.assign(
            new Error(
              `O desconto excede o limite da tabela de preco (R$ ${allowedDiscount.toFixed(2)}) e aguarda aprovacao administrativa.`,
            ),
            { status: 409 },
          );
      }
      const sellerId = Number(seller.CDVENDEDOR),
        uid = userId(req),
        document = String(order).slice(0, 15);
      await tx.execute(
        "INSERT INTO SAIDAESTOQUE (NRPEDIDO,IDEMPRESA,CDCLIENTE,DTSAIDA,DESCONTO,ORIGDESCONTO,VLTOTAL,CDVENDEDOR,STATUS,CDTPENTREGA,CDRECEBTO,SUBTOTAL,CLIENTE,PERCCOMIS,HORALOG,DTALTER,SIST_ALT,PERC_DESCONTO,VALOR,TROCO,FRETE) VALUES (?,?,?,CURRENT_TIMESTAMP,?,?,?,?,3,'FF',?,?,?,?,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'LOCAL',?,?,0,?)",
        [
          order,
          company,
          customer,
          discount,
          discount,
          total,
          sellerId,
          form.CDRECEBTO,
          subtotal,
          customerName.slice(0, 100),
          subtotal ? (discount / subtotal) * 100 : 0,
          total,
          addition,
        ],
      );
      let position = Number(
          (
            await tx.singleton(
              "SELECT COALESCE(MAX(POSIC),0) AS ID FROM SAIDAPRODUTO",
            )
          ).ID,
        ),
        used = [];
      for (const entry of prepared) {
        position++;
        const itemTotal = Math.round(entry.quantity * entry.unit * 100) / 100;
        await tx.execute(
          "INSERT INTO SAIDAPRODUTO (POSIC,NRPEDIDO,CDPRODUTO,IDEMPRESA,CDDEPOSITO,UNID,ORDEM,DESCRICAO,CDCLIENTE,QTDPRODUTO,VLUNIT,TOTAL,QTDEPECA,QTDELIB,STATUS,SERV,STATUSSE,DESCONTO,MOSTRAR,IDPRECO,DTALTER,SIST_ALT,VLCUSTO,SUBTOTAL,FATORCONV,CALC) VALUES (?,?,?,?,?,?,'A',?,?,?,?,?,?,0,'FF','',0,0,-1,?,CURRENT_TIMESTAMP,'LOCAL',?,?,1,?)",
          [
            position,
            order,
            entry.code,
            company,
            entry.product.DEPOSITO,
            String(entry.product.UNID).slice(0, 3),
            String(entry.product.PRODUTO).slice(0, 150),
            customer,
            entry.quantity,
            entry.unit,
            itemTotal,
            Math.trunc(entry.quantity),
            entry.product.IDPRECO,
            entry.product.CUSTO,
            itemTotal,
            itemTotal,
          ],
        );
        if (Number(entry.product.ESTOQUE) <= 0)
          used.push(Number(entry.raw.liberacao_id));
      }
      const history =
          `VENDA PDV PEDIDO ${order} - ${customerName}${addition ? ` - ACRESCIMO R$ ${addition.toFixed(2)}` : ""}`.slice(
            0,
            255,
          ),
        base = [
          company,
          document,
          1,
          customer,
          total,
          total,
          total,
          cash,
          form.CDRECEBTO,
          sellerId,
          discount,
          order,
          form.CDRECEBTO,
          uid,
          form.CDGRUPO,
          document,
          cash,
        ],
        tables = [
          ["CTARECEBER_PROV", false],
          ["CTARECEBER", true],
          ["CTARECEBERCAIXA", false],
        ],
        controls = [];
      for (const [table, main] of tables) {
        const control = Number(
          (
            await tx.singleton(
              `SELECT COALESCE(MAX(CONTROLE),0)+1 AS ID FROM ${table}`,
            )
          ).ID,
        );
        controls.push(control);
        if (table === "CTARECEBER_PROV")
          await tx.execute(
            "INSERT INTO CTARECEBER_PROV (CONTROLE,IDEMPRESA,NRDOC,PARCELA,CDCLIENTE,DTVENC,VALOR,INTERVALO,ORIGEM,DIVIDA,TOTALPG,DTCOB,CAIXA,CODPAGTO,CDVEND,DESCONTO,NRPEDIDO,DTMOV,TPPAGTO,STATUS,CDUSR,DTLOG,CDRECGRUPO,HORALOG,NRDOC2,ACORDO,DTALTER,SIST_ALT,CDCAIXAORIGEM) VALUES (?,?,?,?,?,CURRENT_DATE,?,0,'Venda PDV',?,?,CURRENT_DATE,?,?,?,?,?,CURRENT_DATE,?,2,?,CURRENT_DATE,?,CURRENT_TIMESTAMP,?,0,CURRENT_TIMESTAMP,'LOCAL',?)",
            [control, ...base],
          );
        else if (main)
          await tx.execute(
            "INSERT INTO CTARECEBER (CONTROLE,IDEMPRESA,NRDOC,PARCELA,CDCLIENTE,DTVENC,VALOR,INTERVALO,ORIGEM,DIVIDA,TOTALPG,DTCOB,CAIXA,CODPAGTO,CDVEND,DESCONTO,NRPEDIDO,DTMOV,TPPAGTO,STATUS,CDUSR,DTLOG,CDRECGRUPO,HORALOG,NRDOC2,ACORDO,DTALTER,SIST_ALT,CDCAIXAORIGEM,HISTORICO,VLPGLIQ,CCUSTO) VALUES (?,?,?,?,?,CURRENT_DATE,?,0,'Vendas',?,?,CURRENT_DATE,?,?,?,?,?,CURRENT_DATE,?,2,?,CURRENT_DATE,?,CURRENT_TIMESTAMP,?,0,CURRENT_TIMESTAMP,'LOCAL',?,?,?,?)",
            [control, ...base, history, total, form.CCUSTO],
          );
        else
          await tx.execute(
            "INSERT INTO CTARECEBERCAIXA (CONTROLE,IDEMPRESA,NRDOC,PARCELA,CDCLIENTE,DTVENC,VALOR,INTERVALO,ORIGEM,DIVIDA,TOTALPG,DTCOB,CAIXA,CODPAGTO,CDVEND,DESCONTO,NRPEDIDO,DTMOV,TPPAGTO,STATUS,CDUSR,DTLOG,CDRECGRUPO,HORALOG,NRDOC2,ACORDO,DTALTER,SIST_ALT,CDCAIXAORIGEM,HISTORICO,CANCELADO) VALUES (?,?,?,?,?,CURRENT_DATE,?,0,'Vendas',?,?,CURRENT_DATE,?,?,?,?,?,CURRENT_DATE,?,2,?,CURRENT_DATE,?,CURRENT_TIMESTAMP,?,0,CURRENT_TIMESTAMP,'LOCAL',?,?,0)",
            [control, ...base, history],
          );
      }
      for (const release of new Set(used))
        await tx.execute(
          "UPDATE DASH_PDV_LIBERACAO SET STATUS='UTILIZADO',NRPEDIDO=? WHERE IDLIBERACAO=? AND STATUS='APROVADO'",
          [order, release],
        );
      if (discountRelease)
        await tx.execute(
          "UPDATE DASH_PDV_LIBERACAO SET STATUS='UTILIZADO',NRPEDIDO=? WHERE IDLIBERACAO=? AND COALESCE(TIPO,'SEM_ESTOQUE')='DESCONTO' AND STATUS='APROVADO'",
          [order, discountRelease],
        );
      return {
        pedido: order,
        itens_gravados: prepared.length,
        controle_provisao: controls[0],
        controle_receber: controls[1],
        controle_caixa: controls[2],
        forma_pagamento: Number(form.CDRECEBTO),
      };
    });
    res.json({
      ok: true,
      mensagem: "Venda gravada no estoque, financeiro e caixa.",
      ...result,
    });
  } catch (error) {
    res.status(error.status || 500).json({
      ok: false,
      erro: `Erro ao gravar venda do PDV: ${error.message}`,
    });
  }
});

export default router;
