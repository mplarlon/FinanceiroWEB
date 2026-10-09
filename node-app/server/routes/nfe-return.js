import express from "express";
import multer from "multer";
import { DOMParser } from "@xmldom/xmldom";
import { withWriteTransaction } from "../db.js";

const router = express.Router(),
  upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  }),
  digits = (value) => String(value || "").replace(/\D/g, "");
const nodes = (node, name) =>
    Array.from(node?.getElementsByTagNameNS?.("*", name) || []),
  first = (node, name) => nodes(node, name)[0] || null,
  text = (node, name) => first(node, name)?.textContent?.trim() || "",
  number = (node, name) => Number(text(node, name) || 0);
export function parseReturnNfeXml(xml) {
  const errors = [],
    document = new DOMParser({
      onError: (message) => errors.push(message),
    }).parseFromString(String(xml), "application/xml");
  if (errors.length || nodes(document, "parsererror").length)
    throw Object.assign(
      new Error(`XML da NF-e invalido: ${errors[0] || "erro de sintaxe"}`),
      { status: 400 },
    );
  const inf = first(document, "infNFe");
  if (!inf)
    throw Object.assign(new Error("O arquivo nao contem uma NF-e 4.00."), {
      status: 400,
    });
  const key = digits(inf.getAttribute("Id"));
  if (key.length !== 44)
    throw Object.assign(
      new Error("A chave da NF-e original nao foi encontrada."),
      { status: 400 },
    );
  const protocol = first(document, "infProt"),
    status = protocol ? text(protocol, "cStat") : "100";
  if (!["100", "150"].includes(status))
    throw Object.assign(new Error("A NF-e original nao esta autorizada."), {
      status: 400,
    });
  const emit = first(inf, "emit"),
    dest = first(inf, "dest");
  if (!emit || !dest)
    throw Object.assign(new Error("Emitente ou destinatario ausente no XML."), {
      status: 400,
    });
  const party = (node, address) => ({
      documento: text(node, "CNPJ") || text(node, "CPF"),
      nome: text(node, "xNome"),
      ie: text(node, "IE"),
      uf: text(first(node, address), "UF"),
    }),
    items = nodes(inf, "det").map((det, index) => {
      const product = first(det, "prod"),
        taxes = first(det, "imposto"),
        icms = first(taxes, "ICMS"),
        rule = icms?.childNodes
          ? Array.from(icms.childNodes).find((child) => child.nodeType === 1)
          : null;
      return {
        item: Number(det.getAttribute("nItem") || index + 1),
        codigo: text(product, "cProd"),
        descricao: text(product, "xProd"),
        ncm: text(product, "NCM"),
        cfop_original: text(product, "CFOP"),
        unidade: text(product, "uCom") || "UN",
        quantidade: number(product, "qCom"),
        valor_unitario: number(product, "vUnCom"),
        desconto: number(product, "vDesc"),
        origem: text(rule, "orig") || "0",
        cst: text(rule, "CST") || "00",
        picms: number(rule, "pICMS"),
        ppis: number(first(taxes, "PIS"), "pPIS"),
        pcofins: number(first(taxes, "COFINS"), "pCOFINS"),
      };
    });
  if (!items.length)
    throw Object.assign(new Error("A NF-e original nao possui itens."), {
      status: 400,
    });
  return {
    chave: key,
    numero: text(first(inf, "ide"), "nNF"),
    serie: text(first(inf, "ide"), "serie"),
    emitente: party(emit, "enderEmit"),
    destinatario: party(dest, "enderDest"),
    itens: items,
  };
}
const returnCfop = (cfop, interstate, inbound = false) => {
  const map = {
      5101: "1201",
      5102: "1202",
      5401: "1410",
      5403: "1411",
      5405: "1411",
      6101: "2201",
      6102: "2202",
      6401: "2410",
      6403: "2411",
      6404: "2411",
    },
    base = map[digits(cfop)] || `${interstate ? "2" : "1"}202`;
  return `${inbound ? (interstate ? "2" : "1") : interstate ? "6" : "5"}${base.slice(1)}`;
};
async function insertAvailable(tx, table, data) {
  const existing = new Set(
      (
        await tx.query(
          "SELECT TRIM(RDB$FIELD_NAME) AS NAME FROM RDB$RELATION_FIELDS WHERE TRIM(RDB$RELATION_NAME)=?",
          [table],
        )
      ).map((row) => row.NAME),
    ),
    fields = Object.keys(data).filter((field) => existing.has(field));
  if (!fields.length)
    throw new Error(`Tabela ${table} sem campos compativeis.`);
  await tx.execute(
    `INSERT INTO ${table} (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`,
    fields.map((field) => data[field]),
  );
}
router.post("/devolucao/xml", upload.single("xml"), async (req, res) => {
  try {
    if (!req.file)
      return res
        .status(400)
        .json({ ok: false, erro: "Selecione o XML original da NF-e." });
    const parsed = parseReturnNfeXml(req.file.buffer.toString("utf8"));
    if (String(req.body?.acao || "preview") === "preview")
      return res.json({ ok: true, nota: parsed });
    let payload = {};
    try {
      payload = JSON.parse(req.body?.dados || "{}");
    } catch {
      throw Object.assign(new Error("Dados da devolucao invalidos."), {
        status: 400,
      });
    }
    const result = await withWriteTransaction(async (tx) => {
      const companyId = Number(payload.idempresa || 1),
        company = await tx.singleton(
          "SELECT FIRST 1 CNPJ,UF FROM CONFIGURACAO WHERE IDEMPRESA=?",
          [companyId],
        );
      if (!company)
        throw Object.assign(new Error("Empresa nao encontrada."), {
          status: 404,
        });
      const duplicate = await tx.singleton(
        "SELECT FIRST 1 n.IDNF,TRIM(n.NRDOC) AS NRDOC FROM NOTAFISCAL n JOIN NOTAFIS_PRODUTO p ON p.IDNF=n.IDNF AND p.IDEMPRESA=n.IDEMPRESA WHERE n.IDEMPRESA=? AND TRIM(COALESCE(p.NFEREF,''))=? AND COALESCE(n.STATUS,0) NOT IN (2,9)",
        [companyId, parsed.chave],
      );
      if (duplicate)
        throw Object.assign(
          new Error(
            `Ja existe a devolucao ${duplicate.NRDOC} (ID ${duplicate.IDNF}) para esta chave.`,
          ),
          { status: 409 },
        );
      const companyDoc = digits(company.CNPJ),
        emitDoc = digits(parsed.emitente.documento),
        destDoc = digits(parsed.destinatario.documento);
      let counterpart, inbound;
      if (companyDoc === destDoc) {
        counterpart = parsed.emitente;
        inbound = false;
      } else if (companyDoc === emitDoc) {
        counterpart = parsed.destinatario;
        inbound = true;
      } else
        throw Object.assign(
          new Error(
            "O CNPJ da empresa selecionada nao participa da NF-e original.",
          ),
          { status: 400 },
        );
      const customer = await tx.singleton(
        "SELECT FIRST 1 CDCLIENTE FROM CLIENTE WHERE REPLACE(REPLACE(REPLACE(COALESCE(CGC,''),'.',''),'/',''),'-','')=?",
        [digits(counterpart.documento)],
      );
      if (!customer)
        throw Object.assign(
          new Error(
            `A contraparte ${counterpart.nome} nao esta cadastrada como cliente.`,
          ),
          { status: 400 },
        );
      const selected = new Map(
        (payload.itens || []).map((item) => [
          Number(item.item),
          Number(item.quantidade || 0),
        ]),
      );
      if (!selected.size)
        for (const item of parsed.itens)
          selected.set(item.item, item.quantidade);
      const chosen = [];
      let total = 0;
      for (const original of parsed.itens) {
        const quantity = Number(selected.get(original.item) || 0);
        if (quantity <= 0) continue;
        if (quantity > original.quantidade + 0.000001)
          throw Object.assign(
            new Error(
              `Quantidade do item ${original.item} excede a nota original.`,
            ),
            { status: 400 },
          );
        const product = await tx.singleton(
          "SELECT FIRST 1 CDPRODUTO FROM PRODUTO WHERE TRIM(CDPRODUTO)=?",
          [original.codigo.slice(0, 10)],
        );
        if (!product)
          throw Object.assign(
            new Error(
              `Produto do XML nao cadastrado: ${original.codigo} - ${original.descricao}`,
            ),
            { status: 400 },
          );
        const ratio = original.quantidade ? quantity / original.quantidade : 0,
          returnedDiscount = Math.round(original.desconto * ratio * 100) / 100,
          itemTotal =
            Math.round(
              (quantity * original.valor_unitario - returnedDiscount) * 100,
            ) / 100;
        chosen.push({
          ...original,
          quantidade_devolvida: quantity,
          cdproduto: String(product.CDPRODUTO).trim(),
          desconto_devolvido: returnedDiscount,
          total: itemTotal,
        });
        total += itemTotal;
      }
      if (!chosen.length)
        throw Object.assign(
          new Error("Selecione ao menos um item para devolucao."),
          { status: 400 },
        );
      const idnf = Number(
          (
            await tx.singleton(
              "SELECT COALESCE(MAX(IDNF),0)+1 AS ID FROM NOTAFISCAL",
            )
          ).ID,
        ),
        numberDoc = String(idnf).padStart(9, "0"),
        now = new Date(),
        note = `DEVOLUCAO DA NF-E ${parsed.numero} SERIE ${parsed.serie}. CHAVE REFERENCIADA: ${parsed.chave}. ${String(payload.motivo || "Devolucao de mercadoria").trim()}`;
      await insertAvailable(tx, "NOTAFISCAL", {
        IDNF: idnf,
        IDEMPRESA: companyId,
        NRDOC: numberDoc,
        CDCLIENTE: Number(customer.CDCLIENTE),
        DTEMISS: now,
        DATASAIDA: now,
        VALOR: Math.round(total * 100) / 100,
        VLTOTAL: Math.round(total * 100) / 100,
        DESCONTO: 0,
        FRETE: 0,
        OUTROS: 0,
        VLIPI: 0,
        VLSEG: 0,
        TIPOFRETE: 0,
        VOLUMES: "0",
        PESO: "0,00",
        PESOBRUTO: 0,
        SERIE_NFE: 1,
        SERIE_NFCE: 0,
        STATUS: 0,
        NFE_EMITIDA: 0,
        NFE_CANCELADA: 0,
        CANCELAR_NFE: 0,
        NFCE: 0,
        INDFINAL: 1,
        INDPRES: 1,
        CNF: Number(String(idnf).slice(-8)),
        ENTRADA: 0,
        DEVOLUCAO: -1,
        IDTRANSP: 1,
        CDVENDEDOR: 18,
        ACORDO_NF: 0,
        END_NF: 0,
        EXPORTACAO: 0,
        INDINTERMED: 0,
        FRETE_ABATER: 0,
        CDNATOP: "0000",
        OBSERVACAO: note.slice(0, 500),
        DTALTER: now,
        SIST_ALT: "LOCAL",
      });
      let itemId = Number(
          (
            await tx.singleton(
              "SELECT COALESCE(MAX(ID),0)+1 AS ID FROM NOTAFIS_PRODUTO",
            )
          ).ID,
        ),
        position = 0,
        interstate =
          String(company.UF || "").toUpperCase() !==
          String(counterpart.uf || "").toUpperCase();
      for (const item of chosen) {
        position++;
        await insertAvailable(tx, "NOTAFIS_PRODUTO", {
          ID: itemId++,
          IDNF: idnf,
          IDEMPRESA: companyId,
          POSIC: position,
          CDPRODUTO: item.cdproduto,
          CDDEPOSITO: Number(payload.cddeposito || 1),
          NRPEDIDO: -999,
          STATUSSE: 0,
          DESCRICAO: item.descricao.slice(0, 150),
          TOTAL: item.total,
          VLUNIT: item.valor_unitario,
          QTDPRODUTO: item.quantidade_devolvida,
          DESCONTO: item.desconto_devolvido,
          VDESC: item.desconto_devolvido,
          UNID: item.unidade.slice(0, 3),
          NCM: item.ncm,
          CFOP: returnCfop(item.cfop_original, interstate, inbound),
          SITTRIBUT: Number(item.cst || 0),
          ORIG: item.origem,
          PICMS: item.picms,
          ICMS: item.picms,
          PPIS: item.ppis,
          PCOFINS: item.pcofins,
          CST_PIS: 1,
          CST_COFINS: 1,
          NFEREF: parsed.chave,
          PERC_DEVOL: 100,
          IMP_XML: -1,
          QTD_XML: item.quantidade_devolvida,
          QTDEPECA: 1,
          CDLOTE: 0,
          LOTE: "",
          NUMCUPOM: 0,
          NUMECF: 0,
          NUMCOO: 0,
          CSTIPI: 0,
          PIPI: 0,
          VIPI: 0,
          CENQ: 0,
          ICMS_COMPLEMENTO: 0,
          VLCOMPLEMENTO: 0,
          VFRETE: 0,
          VSEG: 0,
          VOUTRO: 0,
          MANUAL: -1,
          FCP_MANUAL: -1,
          DTALTER: now,
          SIST_ALT: "LOCAL",
        });
      }
      return {
        idnf,
        idempresa: companyId,
        numero: numberDoc,
        total: Math.round(total * 100) / 100,
        itens: chosen.length,
      };
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});
export default router;
