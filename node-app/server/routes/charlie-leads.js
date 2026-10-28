import express from "express";
import { query, withReadOnlyDatabase, withWriteTransaction } from "../db.js";
import { buildCsv, buildExcel } from "../lib/table-export.js";
import { espelharLeads } from "../lib/charlie-leads-schema.js";
import { listarVendedores } from "../lib/charlie-leads-erp.js";
import { loadState, configPublica } from "../lib/charlie-leads-store.js";
import { classificarCaca, planoDeCaca } from "../lib/charlie-sales-hunter.js";
import { receberWebhook } from "../lib/charlie-leads-service.js";
import {
  analisarLead,
  atribuirVendedor,
  atualizarLead,
  consultarCnpj,
  consultarSaldo,
  criarLead,
  criarOportunidade,
  distribuirLeads,
  executarAutomacao,
  empresasAbertasHoje,
  gerarArquivo,
  indicadores,
  listarLeads,
  abrirPesquisaLocal,
  listarPesquisasLocais,
  pesquisarEmpresas,
  prepararMensagem,
  processarFila,
  relatorio,
  salvarConfiguracao,
  sugerirProdutos,
  tabelaExportacao,
  testarConexao,
  vincularOrcamento,
  vincularPedido,
} from "../lib/charlie-leads-service.js";

const router = express.Router();

function ator(req) {
  const usuario = req.dashboardSession?.user || {};
  return {
    id: usuario.idusuario,
    nome: usuario.nome,
    gerencial: Boolean(usuario.permissao_gerencial),
    vendedorId: usuario.cdvendedor || usuario.vendedorId || null,
  };
}

async function consulta(sql, params = []) {
  return withReadOnlyDatabase((db) => query(db, sql, params, { timeoutMs: 20000 }));
}

function deps() {
  return { query: consulta };
}

function enviar(res, promessa) {
  return Promise.resolve(promessa).then(
    (dados) => res.json({ ok: true, ...(dados && typeof dados === "object" && !Array.isArray(dados) ? dados : { dados }) }),
    (error) => res.status(error.status || 500).json({ ok: false, erro: String(error.message || "Falha ao buscar contatos.").slice(0, 300) }),
  );
}

router.get("/charlie-leads/config", (req, res) => res.json({ ok: true, config: configPublica() }));
router.put("/charlie-leads/config", (req, res) => enviar(res, salvarConfiguracao(req.body || {}, ator(req)).then((config) => ({ config }))));
router.post("/charlie-leads/testar", (req, res) => enviar(res, testarConexao(ator(req), deps())));
router.get("/charlie-leads/saldo", (req, res) => enviar(res, consultarSaldo(ator(req), deps())));
router.post("/charlie-leads/pesquisar", (req, res) => enviar(res, pesquisarEmpresas(req.body || {}, ator(req), deps()).then((dados) => ({ pesquisa: dados }))));
router.get("/charlie-leads/pesquisas", (req, res) => enviar(res, Promise.resolve().then(() => ({ pesquisas: listarPesquisasLocais(ator(req)) }))));
router.get("/charlie-leads/pesquisas/:id", (req, res) => enviar(res, abrirPesquisaLocal(req.params.id, ator(req), deps()).then((pesquisa) => ({ pesquisa }))));
router.post("/charlie-leads/hunter", (req, res) => enviar(res, (async () => {
  const plano = planoDeCaca(req.body || {}, loadState().segmentos);
  if (plano.erros.length) throw Object.assign(new Error(plano.erros[0]), { status: 400 });
  const pesquisa = await pesquisarEmpresas(plano.pesquisa, ator(req), deps());
  return {
    segmento: plano.segmento,
    aviso: "A pontuação ordena a prioridade comercial e não é probabilidade de compra. A consulta usa a Casa dos Dados já configurada em Contatos.",
    total: pesquisa.total,
    reutilizado: pesquisa.reutilizado,
    alerta: pesquisa.alerta,
    debito: pesquisa.debito,
    empresas: classificarCaca(pesquisa.empresas || [], { scoreMinimo: Number(req.body?.scoreMinimo) || 0, segmento: plano.segmento }),
  };
})()));
router.post("/charlie-leads/hunter/gravar", (req, res) => enviar(res, (async () => {
  const selecionadas = Array.isArray(req.body?.empresas) ? req.body.empresas.slice(0, 20) : [];
  const resultados = [];
  for (const empresa of selecionadas) {
    if (empresa?.destino !== "elegivel") {
      resultados.push({ cnpj: empresa.cnpj, gravado: false, motivo: empresa.destino });
      continue;
    }
    let criado;
    try {
      criado = await criarLead({ ...empresa, origem: "sales-hunter" }, ator(req), deps());
    } catch (error) {
      resultados.push({ cnpj: empresa.cnpj, gravado: false, motivo: String(error.message || "O lead não foi gravado.").slice(0, 200) });
      continue;
    }
    let produtos = 0;
    if (!criado.duplicado && criado.lead?.id) {
      try {
        const sugestao = await sugerirProdutos(criado.lead.id, ator(req), deps());
        produtos = sugestao.produtos?.length || 0;
      } catch { /* a sugestão de produto não impede o lead */ }
    }
    resultados.push({ cnpj: empresa.cnpj, gravado: !criado.duplicado, duplicado: Boolean(criado.duplicado), leadId: criado.lead?.id || null, produtos });
  }
  let distribuicao = null;
  let distribuicaoErro = null;
  if (req.body?.distribuir === true) {
    try {
      distribuicao = await distribuirLeads({ quantidade: Math.max(selecionadas.length, 1), scoreMinimo: Number(req.body?.scoreMinimo) || 0 }, ator(req));
    } catch (error) {
      distribuicaoErro = String(error.message || "A distribuição não foi feita.").slice(0, 200);
    }
  }
  return { resultados, distribuicao, distribuicaoErro };
})()));
router.get("/charlie-leads/cnpj/:cnpj", (req, res) => enviar(res, consultarCnpj(req.params.cnpj, ator(req), deps()).then((empresa) => ({ empresa }))));
router.get("/charlie-leads/leads", (req, res) => res.json({ ok: true, leads: listarLeads(req.query || {}, ator(req)) }));
router.post("/charlie-leads/leads", (req, res) => enviar(res, criarLead(req.body || {}, ator(req), deps())));
router.post("/charlie-leads/leads/:id/analisar", (req, res) => enviar(res, analisarLead(req.params.id, ator(req), deps()).then((lead) => ({ lead }))));
router.post("/charlie-leads/leads/:id/produtos", (req, res) => enviar(res, sugerirProdutos(req.params.id, ator(req), deps())));
router.patch("/charlie-leads/leads/:id", (req, res) => enviar(res, atualizarLead(req.params.id, req.body || {}, ator(req)).then((lead) => ({ lead }))));
router.post("/charlie-leads/leads/:id/vendedor", (req, res) => enviar(res, atribuirVendedor({ ...req.body, id: req.params.id }, ator(req), deps()).then((leads) => ({ leads }))));
router.post("/charlie-leads/distribuir", (req, res) => enviar(res, distribuirLeads(req.body || {}, ator(req))));
router.post("/charlie-leads/leads/:id/oportunidade", (req, res) => enviar(res, criarOportunidade(req.params.id, ator(req)).then((lead) => ({ lead }))));
router.post("/charlie-leads/leads/:id/orcamento", (req, res) => enviar(res, vincularOrcamento(req.params.id, req.body?.numero, ator(req), deps()).then((lead) => ({ lead }))));
router.post("/charlie-leads/leads/:id/pedido", (req, res) => enviar(res, vincularPedido(req.params.id, req.body?.numero, ator(req), deps()).then((lead) => ({ lead }))));
router.post("/charlie-leads/leads/:id/mensagem", (req, res) => enviar(res, prepararMensagem(req.params.id, ator(req))));
router.get("/charlie-leads/empresas-abertas", (req, res) => enviar(res, empresasAbertasHoje(ator(req), deps())));
router.post("/charlie-leads/arquivo", (req, res) => enviar(res, gerarArquivo(req.body || {}, ator(req), deps())));
router.get("/charlie-leads/indicadores", (req, res) => res.json({ ok: true, indicadores: indicadores(req.query || {}, ator(req)) }));
router.get("/charlie-leads/relatorio", (req, res) => res.json({ ok: true, relatorio: relatorio(req.query || {}, ator(req)) }));
router.get("/charlie-leads/vendedores", (req, res) => enviar(res, listarVendedores(consulta).then((vendedores) => ({ vendedores }))));
router.post("/charlie-leads/automacao/executar", (req, res) => enviar(res, executarAutomacao(ator(req), deps())));
router.get("/charlie-leads/exportar", async (req, res) => {
  try {
    const tabela = tabelaExportacao(req.query || {}, ator(req));
    if (req.query.formato === "xlsx") {
      const arquivo = await buildExcel(tabela);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=charlie-leads.xlsx");
      return res.send(Buffer.from(arquivo));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=charlie-leads.csv");
    return res.send(buildCsv(tabela));
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});
router.post("/charlie-leads/fila/processar", (req, res) => {
  if (!ator(req).gerencial) return res.status(403).json({ ok: false, erro: "Esta operação exige permissão gerencial." });
  enviar(res, processarFila(deps()).then(() => ({ fila: configPublica().fila })));
});
router.post("/charlie-leads/migrar", async (req, res) => {
  if (!ator(req).gerencial) return res.status(403).json({ ok: false, erro: "Esta operação exige permissão gerencial." });
  try {
    const resultado = await withWriteTransaction(async (tx) => {
      const gravados = await espelharLeads(tx, loadState());
      return { gravados };
    });
    res.json({ ok: true, ...resultado });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});
router.post("/integracoes/casa-dos-dados/webhook", (req, res) => {
  enviar(res, receberWebhook(req.body || {}, req.get("casadosdados-token"), deps()));
});

export default router;
