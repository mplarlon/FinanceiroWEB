// Rotas fiscais de NF-e, porta de nfe_sefaz.py (registrar_rotas_nfe_sefaz).
import express from "express";
import path from "node:path";
import { query, withDatabase } from "../db.js";
import { HttpError, sendError } from "../lib/http-error.js";
import {
  AUTORIZADA, CANCELADA, EVENTO_REGISTRADO, INUTILIZADA,
  arquivarPdf, carregarNota, cstat, emitirNfePorId, gerarPdfNfe,
  loadConfig, pick, postGateway, protocoloAutorizado, resolverXmlAutorizado, updateExisting,
} from "../lib/nfe-sefaz.js";
import { withWriteTransaction } from "../db.js";
import { sendNfeDocuments } from "../lib/fiscal-email.js";

const router = express.Router();

router.get("/notas", async (req, res) => {
  try {
    const limite = Math.max(1, Math.min(Number(req.query.limite || 100), 300));
    const busca = String(req.query.busca || "").trim();
    const status = String(req.query.status || "").trim().toLowerCase();
    const tipoDocumento = String(req.query.tipo_documento || "").trim().toLowerCase();
    const dataInicioRaw = String(req.query.data_inicio || "").trim();
    const dataFimRaw = String(req.query.data_fim || "").trim();
    const filtros = ["COALESCE(n.STATUS, 0) NOT IN (2, 9)"];
    const params = [];
    if (tipoDocumento === "nfe") filtros.push("COALESCE(n.NFCE, 0) = 0");
    else if (tipoDocumento === "nfce") filtros.push("COALESCE(n.NFCE, 0) <> 0");
    else if (tipoDocumento) throw new HttpError("tipo de documento deve ser nfe ou nfce", 400);
    let dataInicio, dataFim;
    if (dataInicioRaw) {
      dataInicio = new Date(`${dataInicioRaw}T00:00:00`);
      if (Number.isNaN(dataInicio.getTime())) throw new HttpError("data_inicio invalida", 400);
      filtros.push("n.DTEMISS >= ?"); params.push(dataInicio);
    }
    if (dataFimRaw) {
      dataFim = new Date(`${dataFimRaw}T00:00:00`);
      if (Number.isNaN(dataFim.getTime())) throw new HttpError("data_fim invalida", 400);
      filtros.push("n.DTEMISS < DATEADD(1 DAY TO ?)"); params.push(dataFim);
    }
    if (dataInicioRaw && dataFimRaw && dataInicio > dataFim) {
      throw new HttpError("a data inicial nao pode ser posterior a data final", 400);
    }
    if (busca) {
      filtros.push(
        "(TRIM(COALESCE(n.NRDOC, '')) CONTAINING ? OR " +
        "TRIM(COALESCE(c.CLIENTE, '')) CONTAINING ? OR " +
        "TRIM(COALESCE(n.CHAVE, '')) CONTAINING ?)"
      );
      params.push(busca, busca, busca);
    }
    if (status === "pendente") filtros.push("COALESCE(n.NFE_EMITIDA, 0) = 0 AND COALESCE(n.NFE_CANCELADA, 0) = 0");
    else if (status === "autorizada") filtros.push("COALESCE(n.NFE_EMITIDA, 0) <> 0 AND COALESCE(n.NFE_CANCELADA, 0) = 0");
    else if (status === "cancelada") filtros.push("COALESCE(n.NFE_CANCELADA, 0) <> 0");
    const where = filtros.length ? " WHERE " + filtros.join(" AND ") : "";
    const notas = await withDatabase(db => query(db,
      `SELECT FIRST ${limite} n.IDNF, n.IDEMPRESA, TRIM(n.NRDOC) AS NRDOC,` +
      " n.DTEMISS, n.CDCLIENTE, TRIM(COALESCE(c.CLIENTE, '')) AS CLIENTE," +
      " n.VLTOTAL, n.STATUS, COALESCE(n.NFE_EMITIDA, 0) AS NFE_EMITIDA," +
      " COALESCE(n.NFE_CANCELADA, 0) AS NFE_CANCELADA," +
      " COALESCE(n.NFCE, 0) AS NFCE," +
      " TRIM(COALESCE(n.CHAVE, '')) AS CHAVE" +
      " FROM NOTAFISCAL n LEFT JOIN CLIENTE c ON c.CDCLIENTE = n.CDCLIENTE" +
      `${where} ORDER BY n.DTEMISS DESC, n.IDNF DESC`, params));
    res.json({ ok: true, notas });
  } catch (error) {
    sendError(res, error, 500);
  }
});

router.get("/acbr/status", async (_req, res) => {
  try {
    const cfg = loadConfig();
    const result = await postGateway("status", {}, cfg);
    res.json({ ok: true, provider: cfg.provider, sefaz: result });
  } catch (error) {
    sendError(res, error, 503);
  }
});

// Produtos ativos cuja regra de IMPOSTO ainda nao tem CST_REFORMA/CCLASSTRIB
// (NT 2025.002-RTC). A partir de 03/08/2026 esses campos sao obrigatorios na
// NF-e para empresas do regime normal; sem eles a nota emitida com esses
// produtos sera rejeitada pela SEFAZ.
router.get("/reforma/pendencias", async (_req, res) => {
  try {
    const produtos = await withDatabase(db => query(db,
      "SELECT p.CDPRODUTO, TRIM(p.PRODUTO) AS PRODUTO, p.IDIMPOSTO_VENDA," +
      " TRIM(COALESCE(i.CST_REFORMA, '')) AS CST_REFORMA," +
      " TRIM(COALESCE(i.CCLASSTRIB, '')) AS CCLASSTRIB" +
      " FROM PRODUTO p LEFT JOIN IMPOSTO i ON i.IDIMPOSTO = p.IDIMPOSTO_VENDA" +
      " WHERE (p.INATIVO = 0 OR p.INATIVO IS NULL)" +
      " AND (p.IDIMPOSTO_VENDA IS NULL OR i.IDIMPOSTO IS NULL" +
      " OR TRIM(COALESCE(i.CST_REFORMA, '')) = '' OR TRIM(COALESCE(i.CCLASSTRIB, '')) = '')" +
      " ORDER BY p.PRODUTO"
    ));
    res.json({ ok: true, limite: "2026-08-03", total: produtos.length, produtos });
  } catch (error) {
    sendError(res, error, 500);
  }
});

router.post("/:idnf/emitir", async (req, res) => {
  try {
    const result = await emitirNfePorId(req.params.idnf, req.body?.idempresa);
    res.json(result);
  } catch (error) {
    sendError(res, error, error instanceof HttpError ? error.status : 502);
  }
});

router.get("/:idnf/pdf", async (req, res) => {
  try {
    const pdfPath = await withWriteTransaction(async tx => {
      const { nota } = await carregarNota(tx, req.params.idnf, req.query.idempresa);
      if (Number(nota.NFE_EMITIDA || 0) !== -1 || !nota.CHAVE) {
        throw new HttpError("Somente uma NF-e autorizada pode ser impressa.", 409);
      }
      const cfg = loadConfig();
      const gerado = await gerarPdfNfe(nota, cfg);
      const configuracao = (await tx.query(
        "SELECT FIRST 1 * FROM CONFIGURACAO WHERE IDEMPRESA = ?", [Number(nota.IDEMPRESA)]
      ))[0] || {};
      const xmlPath = resolverXmlAutorizado(nota);
      const arquivos = arquivarPdf(nota, configuracao, xmlPath, gerado);
      await updateExisting(tx, "NOTAFISCAL", "IDNF = ? AND IDEMPRESA = ?", [Number(nota.IDNF), Number(nota.IDEMPRESA)], {
        CAMINHO: arquivos.pdf,
      });
      return arquivos.pdf;
    });
    const nrdoc = String(req.query.nrdoc || req.params.idnf).trim();
    res.setHeader("Content-Disposition", `inline; filename="DANFE-${nrdoc}.pdf"`);
    res.type("application/pdf");
    res.sendFile(path.resolve(pdfPath));
  } catch (error) {
    sendError(res, error, error instanceof HttpError ? error.status : 500);
  }
});

router.post("/:idnf/email", async (req, res) => {
  try {
    const generated = await withWriteTransaction(async tx => {
      const { nota } = await carregarNota(tx, req.params.idnf, req.body?.idempresa);
      if (Number(nota.NFE_EMITIDA || 0) === 0 || !nota.CHAVE) {
        throw new HttpError("Somente uma NF-e autorizada pode ser enviada.", 409);
      }
      const pdf = await gerarPdfNfe(nota, loadConfig());
      return { nota, pdf };
    });
    const result = await sendNfeDocuments(Number(generated.nota.IDNF), Number(generated.nota.IDEMPRESA), generated.pdf);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (error) {
    sendError(res, error, error instanceof HttpError ? error.status : 500);
  }
});

// Exclui logicamente uma NF-e pendente e desfaz seus vinculos de origem.
router.delete("/:idnf", async (req, res) => {
  try {
    const result = await withWriteTransaction(async tx => {
      const idnf = Number(req.params.idnf);
      const { nota } = await carregarNota(tx, idnf, req.body?.idempresa);
      if (Number(nota.NFE_EMITIDA || 0) !== 0 || nota.CHAVE) {
        throw new HttpError("NF-e autorizada nao pode ser excluida; use o cancelamento na SEFAZ.", 409);
      }
      if (Number(nota.NFE_CANCELADA || 0) !== 0) {
        throw new HttpError("NF-e cancelada nao pode ser excluida.", 409);
      }
      if (Number(nota.STATUS || 0) === 9) {
        return { ok: true, ja_excluida: true, idnf, saidaproduto_atualizadas: 0, ctareceber_atualizadas: 0 };
      }
      const idempresa = Number(nota.IDEMPRESA);
      const nrdoc = String(nota.NRDOC || "").trim();
      if (!nrdoc) throw new HttpError("A nota fiscal nao possui NRDOC para reverter.", 409);

      // node-firebird-driver-native nao devolve rowcount em execute(); conta
      // antes de atualizar pra manter a informacao no retorno.
      const saidaAntes = await tx.singleton(
        "SELECT COUNT(*) AS TOTAL FROM SAIDAPRODUTO WHERE IDEMPRESA = ? AND TRIM(COALESCE(NRDOC, '')) = ?",
        [idempresa, nrdoc]
      );
      await tx.execute(
        "UPDATE SAIDAPRODUTO SET NRDOC = NULL, DTALTER = CURRENT_TIMESTAMP, SIST_ALT = 'DASHBRD'" +
        " WHERE IDEMPRESA = ? AND TRIM(COALESCE(NRDOC, '')) = ?",
        [idempresa, nrdoc]
      );
      const ctaAntes = await tx.singleton(
        "SELECT COUNT(*) AS TOTAL FROM CTARECEBER WHERE IDEMPRESA = ? AND TRIM(COALESCE(NRDOC, '')) = ?",
        [idempresa, nrdoc]
      );
      await tx.execute(
        "UPDATE CTARECEBER SET NRDOC = CAST(NRPEDIDO AS VARCHAR(20))," +
        " ACORDO_NF = 0, VALOR_ACORDO_NF = 0," +
        " DTALTER = CURRENT_TIMESTAMP, SIST_ALT = 'DASHBRD'" +
        " WHERE IDEMPRESA = ? AND TRIM(COALESCE(NRDOC, '')) = ?",
        [idempresa, nrdoc]
      );
      await tx.execute(
        "UPDATE NOTAFISCAL SET STATUS = 9, DTALTER = CURRENT_TIMESTAMP, SIST_ALT = 'DASHBRD'" +
        " WHERE IDNF = ? AND IDEMPRESA = ? AND COALESCE(STATUS, 0) <> 9",
        [idnf, idempresa]
      );
      return {
        ok: true, idnf, nrdoc,
        saidaproduto_atualizadas: Number(saidaAntes?.TOTAL || 0),
        ctareceber_atualizadas: Number(ctaAntes?.TOTAL || 0),
      };
    });
    res.json(result);
  } catch (error) {
    sendError(res, error, error instanceof HttpError ? error.status : 500);
  }
});

router.get("/:idnf/consultar", async (req, res) => {
  try {
    const result = await withWriteTransaction(async tx => {
      const { nota } = await carregarNota(tx, req.params.idnf, req.query.idempresa);
      if (!nota.CHAVE) throw new HttpError("Nota sem chave de acesso; nao ha o que consultar na SEFAZ.", 409);
      const cfg = loadConfig();
      const provider = String(cfg.provider || "").toLowerCase();
      let consulta;
      if (provider === "acbr_monitor") {
        const xmlPath = resolverXmlAutorizado(nota);
        consulta = await postGateway("consultar", { xml_path: xmlPath }, cfg);
      } else {
        consulta = await postGateway("consultar", { chave: nota.CHAVE }, cfg);
      }
      const status = cstat(consulta);
      return {
        ok: true, cStat: status,
        motivo: pick(consulta, "xMotivo", "motivo"),
        protocolo: pick(consulta, "nProt", "protocolo"),
        cancelada_no_sefaz: CANCELADA.has(status),
        cancelada_localmente: Number(nota.NFE_CANCELADA || 0) === -1,
      };
    });
    res.json(result);
  } catch (error) {
    sendError(res, error, error instanceof HttpError ? error.status : 502);
  }
});

router.post("/:idnf/cancelar", async (req, res) => {
  try {
    const idnf = Number(req.params.idnf);
    const justificativa = String(req.body?.justificativa || "").trim();
    if (justificativa.length < 15 || justificativa.length > 255) {
      throw new HttpError("Justificativa deve ter entre 15 e 255 caracteres.", 400);
    }
    const result = await withWriteTransaction(async tx => {
      const { nota } = await carregarNota(tx, idnf, req.body?.idempresa);
      const cfg = loadConfig();
      const isAcbr = String(cfg.provider || "").toLowerCase() === "acbr_monitor";
      const protocolo = await protocoloAutorizado(tx, nota.CHAVE);
      if (!nota.CHAVE || (!isAcbr && !protocolo)) {
        throw new HttpError("Somente uma NF-e autorizada pode ser cancelada.", 409);
      }
      let sefazResult = await postGateway("cancelar", {
        chave: String(nota.CHAVE).replace("NFe", ""),
        protocolo, justificativa, idempresa: nota.IDEMPRESA,
      }, cfg);
      let status = cstat(sefazResult);
      if (status === 573 && isAcbr) {
        // 573 = Duplicidade de Evento: a SEFAZ ja tem esse cancelamento
        // registrado, geralmente de uma tentativa anterior que teve sucesso
        // no lado da SEFAZ mas nao chegou a salvar localmente. Consulta a
        // situacao real antes de decidir se e falha de fato.
        try {
          const xmlPath = resolverXmlAutorizado(nota);
          const consulta = await postGateway("consultar", { xml_path: xmlPath }, cfg);
          const consultaStatus = cstat(consulta);
          if (CANCELADA.has(consultaStatus)) { sefazResult = consulta; status = consultaStatus; }
        } catch { /* Mantem a resposta original do cancelamento. */ }
      }
      if (!CANCELADA.has(status)) {
        throw new Error("Cancelamento rejeitado: " + String(pick(sefazResult, "xMotivo", "motivo", "message") || status));
      }
      await updateExisting(tx, "NOTAFISCAL", "IDNF = ? AND IDEMPRESA = ?", [idnf, Number(nota.IDEMPRESA)], {
        NFE_CANCELADA: -1, CANCELAR_NFE: 0, STATUS: 9,
        DTCANCELAMENTO: new Date(), CSTAT: status,
        DTALTER: new Date(), SIST_ALT: "DASHBRD",
      });
      return { ok: true, cStat: status, protocolo: pick(sefazResult, "nProt", "protocolo"), motivo: pick(sefazResult, "xMotivo", "motivo") };
    });
    res.json(result);
  } catch (error) {
    sendError(res, error, error instanceof HttpError ? error.status : 502);
  }
});

router.post("/inutilizar", async (req, res) => {
  try {
    const body = req.body || {};
    const inicio = Number(body.numero_inicial), fim = Number(body.numero_final);
    const justificativa = String(body.justificativa || "").trim();
    if (!Number.isFinite(inicio) || !Number.isFinite(fim) || inicio < 1 || fim < inicio) {
      throw new HttpError("Faixa de numeracao invalida.", 400);
    }
    if (fim - inicio > 10000) throw new HttpError("A faixa de inutilizacao e grande demais.", 400);
    if (justificativa.length < 15 || justificativa.length > 255) {
      throw new HttpError("Justificativa deve ter entre 15 e 255 caracteres.", 400);
    }
    const payload = {
      idempresa: Number(body.idempresa), ano: Number(body.ano),
      modelo: Number(body.modelo ?? 55), serie: Number(body.serie ?? 1),
      numero_inicial: inicio, numero_final: fim, justificativa,
    };
    const result = await postGateway("inutilizar", payload);
    const status = cstat(result);
    if (!INUTILIZADA.has(status)) {
      throw new Error("Inutilizacao rejeitada: " + String(pick(result, "xMotivo", "motivo", "message") || status));
    }
    res.json({ ok: true, cStat: status, protocolo: pick(result, "nProt", "protocolo"), motivo: pick(result, "xMotivo", "motivo") });
  } catch (error) {
    sendError(res, error, error instanceof HttpError ? error.status : 502);
  }
});

router.post("/:idnf/carta-correcao", async (req, res) => {
  try {
    const idnf = Number(req.params.idnf);
    const correcao = String(req.body?.correcao || "").trim();
    const sequencia = Number(req.body?.sequencia ?? 1);
    if (correcao.length < 15 || correcao.length > 1000) {
      throw new HttpError("Correcao deve ter entre 15 e 1000 caracteres.", 400);
    }
    if (sequencia < 1 || sequencia > 20) throw new HttpError("Sequencia da CC-e deve estar entre 1 e 20.", 400);
    const result = await withWriteTransaction(async tx => {
      const { nota } = await carregarNota(tx, idnf, req.body?.idempresa);
      const cfg = loadConfig();
      const isAcbr = String(cfg.provider || "").toLowerCase() === "acbr_monitor";
      const protocolo = await protocoloAutorizado(tx, nota.CHAVE);
      if (!nota.CHAVE || (!isAcbr && !protocolo)) {
        throw new HttpError("Somente uma NF-e autorizada aceita carta de correcao.", 409);
      }
      const sefazResult = await postGateway("carta-correcao", {
        chave: String(nota.CHAVE).replace("NFe", ""), sequencia, correcao, idempresa: nota.IDEMPRESA,
      }, cfg);
      const status = cstat(sefazResult);
      if (!EVENTO_REGISTRADO.has(status)) {
        throw new Error("Carta de correcao rejeitada: " + String(pick(sefazResult, "xMotivo", "motivo", "message") || status));
      }
      return {
        ok: true, cStat: status, sequencia,
        protocolo: pick(sefazResult, "nProt", "protocolo"), motivo: pick(sefazResult, "xMotivo", "motivo"),
      };
    });
    res.json(result);
  } catch (error) {
    sendError(res, error, error instanceof HttpError ? error.status : 502);
  }
});

export default router;
