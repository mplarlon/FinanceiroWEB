import crypto from "node:crypto";
import { cifrar, decifrar, mascarar, recusarSenhaBancaria, redigir } from "./open-finance-crypto.js";
import {
  CAPACIDADES,
  analisarMovimentos,
  dia,
  montarRelatorio,
  normalizarTransacao,
  periodoRetroativo,
  podeLiquidar,
  politicaPadrao,
  proximaTentativaSegundos,
  regraCompativel,
  resumirPainel,
  saldoDivergente,
  validarPolitica,
} from "./open-finance-engine.js";
import { criarProvedor, normalizarClientIdPluggy, normalizarSegredoProvedor } from "./open-finance-providers.js";
import { desfazerPermitido, investigar, montarFatos } from "./reconciliation-intelligence.js";

function enriquecerTitulos(titulos) {
  return (titulos || []).map((titulo) => {
    const bruto = String(titulo.endToEndId || titulo.nrdoc || titulo.nossoNumero || "").replace(/\W/g, "").toUpperCase();
    return { ...titulo, endToEndId: /^E[A-Z0-9]{31}$/.test(bruto) ? bruto : titulo.endToEndId || null };
  });
}

function segredoConfere(esperado, recebido) {
  const a = Buffer.from(String(esperado || ""));
  const b = Buffer.from(String(recebido || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function statusDaAnalise(item) {
  if (item.divergencia) return "divergente";
  if (item.classe === "automatica" || item.classe === "sugerida") return "sugerido";
  return "importado";
}

export function criarServico(deps) {
  const repo = deps.repositorio;

  async function chave() {
    const valor = await deps.chave();
    if (!valor) throw Object.assign(new Error("A chave mestra do Open Finance não está configurada."), { status: 409 });
    return valor;
  }

  async function lerSegredos() {
    const bruto = await deps.segredos.ler();
    if (!bruto?.clientId || !bruto?.clientSecret) return null;
    const mestra = await chave();
    return {
      provedor: bruto.provedor,
      ambiente: bruto.ambiente,
      clientId: decifrar(bruto.clientId, mestra),
      clientSecret: decifrar(bruto.clientSecret, mestra),
      webhookSecret: bruto.webhookSecret ? decifrar(bruto.webhookSecret, mestra) : "",
      termosUrl: bruto.termosUrl || "",
    };
  }

  async function exigirSegredos() {
    const segredos = await lerSegredos();
    if (!segredos) throw Object.assign(new Error("O provedor Open Finance ainda não foi configurado. Informe as credenciais reais do contrato."), { status: 409 });
    return segredos;
  }

  async function provedor() {
    const segredos = await exigirSegredos();
    return { segredos, api: criarProvedor(segredos.provedor, segredos, deps.buscar) };
  }

  async function garantirPolitica(empresa) {
    return (await repo.politica(empresa)) || repo.salvarPolitica(politicaPadrao(empresa));
  }

  async function carregar(empresa) {
    if (!deps.carregar) return { titulos: [], contasProprias: [], baixadosSemBanco: [], tarifasHistoricas: [] };
    const carga = await deps.carregar(empresa);
    return { ...carga, titulos: enriquecerTitulos(carga.titulos) };
  }

  async function auditar(evento) {
    await repo.auditar({ ...evento, detalhe: redigir(evento.detalhe || "").slice(0, 1000) });
  }

  async function atualizarSugestao(movimento, item) {
    if (["conciliado", "ignorado", "processando"].includes(movimento.status)) return movimento;
    return repo.salvarMovimento({
      ...movimento,
      classe: item.classe,
      confianca: item.confianca,
      charlie: item.charlie,
      motivo: item.decisao?.motivo || "",
      acao: item.decisao?.acao || "",
      titulos: item.decisao?.titulos || [],
      espelhoId: item.decisao?.espelhoId || null,
      status: statusDaAnalise(item),
      podeBaixar: false,
    });
  }

  async function conciliarEmpresa(empresa, opcoes = {}) {
    const politica = await garantirPolitica(empresa);
    const [movimentos, contas, regras, carga] = await Promise.all([
      repo.listarMovimentos(empresa),
      repo.listarContas(empresa),
      repo.listarRegras(empresa),
      carregar(empresa),
    ]);
    const analises = analisarMovimentos({
      movimentos,
      contas,
      regras,
      empresa,
      titulos: carga.titulos,
      contasProprias: carga.contasProprias?.length ? carga.contasProprias : contas.filter((conta) => conta.vinculada).map((conta) => ({ banco: conta.cdbanco, agencia: conta.agenciaErp || "", conta: conta.numcontaErp })),
      baixadosSemBanco: carga.baixadosSemBanco || [],
    });
    let charlie = 0;
    const aplicadas = [];
    for (const item of analises) {
      if (deps.narrar && item.classe !== "automatica" && item.decisao?.nivel === 3 && charlie < 8) {
        const motor = {
          id: item.movimento.id,
          valor: item.movimento.valor,
          data: item.movimento.data,
          historico: item.movimento.descricao,
          empresa: item.movimento.empresa,
        };
        const hipotese = await investigar(montarFatos(motor, item.decisao?.titulos || []), deps.narrar);
        item.charlie = `${item.charlie} ${hipotese.narracao || ""}`.trim().slice(0, 500);
        item.decisao = { ...item.decisao, automatica: false, hipotese: { ...hipotese, automatica: false, executar: false } };
        charlie += 1;
      }
      await atualizarSugestao(item.movimento, item);
      if (item.divergencia) await repo.salvarDivergencia({ ...item.divergencia, empresa });
      if (item.decisao?.acao === "transferencia" && Number(item.movimento.id) > Number(item.decisao.espelhoId || 0)) continue;
      const gate = podeLiquidar(item.decisao, politica, opcoes.origem || "servico");
      if (!gate.aplicar) continue;
      const resultado = await liquidar(item, opcoes.ator || { idusuario: 1, nome: "servico-conciliacao", origem: "servico-conciliacao" });
      if (resultado.ok) aplicadas.push(item.movimento.id);
    }
    return { analises, aplicadas, politica };
  }

  async function liquidar(analise, ator) {
    const movimento = await repo.obterMovimento(analise.movimento.id, analise.movimento.empresa);
    const conta = await repo.obterConta(movimento?.contaId, movimento?.empresa);
    if (!conta?.vinculada || !conta.cdbanco || !conta.numcontaErp) return { ok: false, motivo: "conta_nao_vinculada" };
    const reservado = await repo.reservarMovimento(movimento.id, movimento.empresa);
    if (!reservado) return { ok: false, motivo: "ja_utilizado" };
    if (analise.decisao?.acao === "transferencia") {
      const par = await repo.reservarMovimento(analise.decisao.espelhoId, movimento.empresa);
      if (!par) {
        await repo.liberarMovimento(movimento.id, "par_indisponivel");
        return { ok: false, motivo: "par_indisponivel" };
      }
    }
    const origem = ator.origem === "aprovacao-humana" ? "aprovacao-humana" : "servico-conciliacao";
    try {
      const resultado = await deps.transacao(async (tx) => {
        if (analise.decisao.acao === "transferencia") return liquidarTransferencia(tx, movimento, analise.decisao, conta, ator, origem);
        return liquidarUm(tx, movimento, analise.decisao, conta, ator, origem);
      });
      return { ok: true, ...resultado };
    } catch (error) {
      await repo.liberarMovimento(movimento.id, redigir(error.message));
      await auditar({ empresa: movimento.empresa, operacao: "falha_baixa", detalhe: error.message, usuarioId: ator.idusuario || null });
      return { ok: false, motivo: "falha", erro: redigir(error.message) };
    }
  }

  async function importarItem(tx, movimento, conta, ator) {
    const numdoc = String(movimento.e2e || movimento.idExterno).slice(0, 40);
    await deps.importar(tx, {
      confirmado: true,
      cdbanco: conta.cdbanco,
      agencia: conta.agenciaErp || conta.agencia || "",
      numconta: conta.numcontaErp,
      empresa: movimento.empresa,
      usuario: ator.idusuario || 1,
      nomeArquivo: "open-finance",
      itens: [{ data: movimento.data, valor: movimento.valor, historico: movimento.descricao, fitid: numdoc, numdoc }],
    });
    const item = await deps.localizar(tx, numdoc, movimento.empresa);
    if (!item?.id) throw Object.assign(new Error("O extrato não foi localizado após a importação."), { status: 409 });
    return { ...item, numdoc };
  }

  async function liquidarUm(tx, movimento, decisao, conta, ator, origem) {
    const item = await importarItem(tx, movimento, conta, ator);
    if (item.movBancario) {
      await repo.concluirMovimento(movimento.id, { status: "conciliado", extratoItem: item.id, movBancario: item.movBancario, origemBaixa: origem }, tx);
      return { jaExistia: true, movimentos: [item.movBancario] };
    }
    const gravacao = {
      ...decisao,
      movimentoId: item.id,
      empresa: movimento.empresa,
      valor: movimento.valor,
      data: movimento.data,
    };
    if (origem === "aprovacao-humana" && gravacao.acao === "conciliar") {
      gravacao.automatica = false;
      gravacao.ambigua = false;
      gravacao.alteraValor = false;
      gravacao.aprovadaPorHumano = true;
    }
    const aplicado = await deps.aplicar(tx, gravacao, { ...ator, origem });
    await repo.concluirMovimento(movimento.id, {
      status: "conciliado",
      classe: "automatica",
      extratoItem: item.id,
      movBancario: aplicado?.movimentos?.[0] || null,
      origemBaixa: origem,
      titulos: gravacao.titulos || [],
    }, tx);
    await auditar({ empresa: movimento.empresa, operacao: "baixa", detalhe: `Movimento ${movimento.idExterno} vinculado ao extrato ${item.id}.`, usuarioId: ator.idusuario || null });
    return aplicado;
  }

  async function liquidarTransferencia(tx, movimento, decisao, conta, ator, origem) {
    const outro = await repo.obterMovimento(decisao.espelhoId, movimento.empresa);
    const contaOutro = outro ? await repo.obterConta(outro.contaId, outro.empresa) : null;
    if (!outro || !contaOutro?.vinculada) throw Object.assign(new Error("A contrapartida da transferência não está vinculada."), { status: 409 });
    if (outro.status === "conciliado") return { jaExistia: true, movimentos: [outro.movBancario] };
    const origemItem = await importarItem(tx, movimento, conta, ator);
    const destinoItem = await importarItem(tx, outro, contaOutro, ator);
    if (origemItem.movBancario && destinoItem.movBancario) {
      await repo.concluirMovimento(movimento.id, { status: "conciliado", extratoItem: origemItem.id, movBancario: origemItem.movBancario, origemBaixa: origem }, tx);
      await repo.concluirMovimento(outro.id, { status: "conciliado", extratoItem: destinoItem.id, movBancario: destinoItem.movBancario, origemBaixa: origem }, tx);
      return { jaExistia: true, movimentos: [origemItem.movBancario, destinoItem.movBancario] };
    }
    const aplicado = await deps.aplicar(tx, {
      ...decisao,
      automatica: true,
      acao: "transferencia",
      movimentoId: origemItem.id,
      espelhoId: destinoItem.id,
      empresa: movimento.empresa,
      valor: movimento.valor,
    }, { ...ator, origem });
    const movimentos = aplicado?.movimentos || [];
    await repo.concluirMovimento(movimento.id, { status: "conciliado", extratoItem: origemItem.id, movBancario: movimentos[0] || null, origemBaixa: origem, espelhoId: outro.id }, tx);
    await repo.concluirMovimento(outro.id, { status: "conciliado", extratoItem: destinoItem.id, movBancario: movimentos[1] || null, origemBaixa: origem, espelhoId: movimento.id }, tx);
    await auditar({ empresa: movimento.empresa, operacao: "transferencia", detalhe: `Transferência interna ${movimento.id} e ${outro.id}.`, usuarioId: ator.idusuario || null });
    return aplicado;
  }

  async function gravarLote(conexao, conta, brutos, provedorNome) {
    let recebidos = 0;
    let novos = 0;
    let duplicados = 0;
    for (const bruto of brutos) {
      const normal = normalizarTransacao(bruto, provedorNome);
      if (!normal) continue;
      if (normal.contaExterna && conta?.idExterno && normal.contaExterna !== conta.idExterno) continue;
      recebidos += 1;
      const existente = await repo.movimentoPorExterno(conexao.empresa, normal.idExterno);
      if (existente?.status === "conciliado") {
        if (Math.abs(Number(existente.valor) - Number(normal.valor)) > 0.01) {
          await repo.salvarDivergencia({
            empresa: conexao.empresa,
            movimentoId: existente.id,
            tipo: "movimentacao_alterada",
            valor: normal.valor,
            causa: "O provedor alterou o valor depois da conciliação.",
            sugestao: "Não alterar a baixa. Usar o estorno controlado se a correção for confirmada.",
            documentos: String(existente.extratoItem || ""),
            status: "aberta",
          });
        }
        duplicados += 1;
        continue;
      }
      if (existente) {
        await repo.salvarMovimento({ ...existente, ...normal, id: existente.id, contaId: conta?.id || existente.contaId, status: existente.status === "ignorado" ? "ignorado" : existente.status });
        duplicados += 1;
        continue;
      }
      await repo.salvarMovimento({
        ...normal,
        empresa: conexao.empresa,
        conexaoId: conexao.id,
        contaId: conta?.id || null,
        banco: conta?.banco || "",
        agencia: conta?.agencia || "",
        numero: conta?.numero || "",
        status: "importado",
        classe: "nao_identificado",
        podeBaixar: false,
        importadoEm: new Date().toISOString(),
      });
      novos += 1;
    }
    return { recebidos, novos, duplicados };
  }

  return {
    capacidades() {
      return {
        provedores: CAPACIDADES,
        escolhido: null,
        observacao: "Nenhum provedor está em uso até as credenciais do contrato serem gravadas. Baixa automática nasce desligada.",
      };
    },

    async salvarPolitica(empresa, entrada, ator) {
      const atual = await garantirPolitica(empresa);
      const politica = validarPolitica(atual, { ...entrada, empresa }, ator);
      const salva = await repo.salvarPolitica(politica);
      await auditar({ empresa, operacao: "politica", detalhe: `Modo ${salva.modo}.`, usuarioId: ator?.idusuario || null });
      return salva;
    },

    async contasDoErp() {
      return deps.contasErp ? deps.contasErp() : [];
    },

    async estado(empresa) {
      const bruto = await deps.segredos.ler();
      const politica = empresa ? await garantirPolitica(empresa) : null;
      return {
        configurado: Boolean(bruto?.clientId && bruto?.clientSecret),
        provedor: bruto?.provedor || null,
        ambiente: bruto?.ambiente || null,
        clientId: bruto?.clientId ? mascarar("configurado") : "",
        webhook: Boolean(bruto?.webhookSecret),
        capacidades: CAPACIDADES[bruto?.provedor] || null,
        politica,
        baixaAutomatica: politica?.modo === "automatico",
      };
    },

    async configurar(pedido, ator) {
      recusarSenhaBancaria(pedido);
      if (!["pluggy", "belvo"].includes(pedido?.provedor)) throw Object.assign(new Error("Escolha pluggy ou belvo."), { status: 400 });
      if (!["sandbox", "producao"].includes(pedido?.ambiente)) throw Object.assign(new Error("Informe o ambiente sandbox ou producao."), { status: 400 });
      const clientSecret = normalizarSegredoProvedor(pedido.clientSecret);
      const clientId = pedido.provedor === "pluggy" ? normalizarClientIdPluggy(pedido.clientId) : String(pedido.clientId || "").trim();
      if (!clientId || !clientSecret) throw Object.assign(new Error("Informe o CLIENT_ID e o CLIENT_SECRET da aplicação. A API key não é gravada aqui."), { status: 400 });
      if (pedido.provedor === "pluggy") {
        const api = criarProvedor("pluggy", { clientId, clientSecret, ambiente: pedido.ambiente }, deps.buscar);
        await api.verificar();
      }
      const mestra = await chave();
      const webhookSecret = String(pedido.webhookSecret || crypto.randomBytes(24).toString("hex"));
      const gravado = {
        provedor: pedido.provedor,
        ambiente: pedido.ambiente,
        clientId: cifrar(clientId, mestra),
        clientSecret: cifrar(clientSecret, mestra),
        webhookSecret: cifrar(webhookSecret, mestra),
        termosUrl: String(pedido.termosUrl || "").slice(0, 300),
      };
      await deps.segredos.gravar(gravado);
      let webhook = null;
      if (pedido.urlPublica && pedido.provedor === "pluggy") {
        try {
          const api = criarProvedor(pedido.provedor, { ...pedido, clientId, clientSecret, ambiente: pedido.ambiente }, deps.buscar);
          webhook = await api.registrarWebhook({ url: `${String(pedido.urlPublica).replace(/\/$/, "")}/api/open-finance/webhook`, segredo: webhookSecret });
        } catch (error) {
          webhook = { ok: false, erro: redigir(error.message) };
        }
      }
      await auditar({ empresa: pedido.empresa || 0, operacao: "configurar", detalhe: `Provedor ${pedido.provedor} no ambiente ${pedido.ambiente}.`, usuarioId: ator?.idusuario || null });
      return {
        ok: true,
        provedor: pedido.provedor,
        ambiente: pedido.ambiente,
        webhookSecretInicial: webhookSecret,
        webhook,
        aviso: "Guarde o segredo do webhook agora. Ele não será exibido de novo. Nenhuma senha bancária foi armazenada.",
      };
    },

    async instituicoes() {
      const { api } = await provedor();
      return api.instituicoes();
    },

    async iniciarConexao(pedido) {
      recusarSenhaBancaria(pedido);
      const { api } = await provedor();
      const token = await api.iniciarConexao({ ...pedido, webhookUrl: pedido.urlPublica ? `${String(pedido.urlPublica).replace(/\/$/, "")}/api/open-finance/webhook` : "" });
      await auditar({ empresa: pedido.empresa, operacao: "iniciar_conexao", detalhe: `Conexão iniciada no provedor ${api.nome}.`, usuarioId: pedido.idusuario || null });
      return token;
    },

    async confirmarConexao(pedido) {
      recusarSenhaBancaria(pedido);
      if (!pedido?.itemId) throw Object.assign(new Error("Informe o identificador devolvido pelo widget."), { status: 400 });
      const { segredos, api } = await provedor();
      const item = await api.obterConexao(pedido.itemId);
      const cliente = String(item.clientUserId || item.external_id || "");
      if (cliente && cliente !== `erp-${pedido.empresa}`) throw Object.assign(new Error("Esta conexão pertence a outra empresa."), { status: 403 });
      const consentimento = segredos.provedor === "pluggy"
        ? await api.consentimento(pedido.itemId)
        : await api.consentimento(item.consent_id || item.consent || "");
      const anterior = await repo.obterConexaoPorItem(String(item.id || pedido.itemId));
      if (anterior && Number(anterior.empresa) !== Number(pedido.empresa)) throw Object.assign(new Error("Esta conexão pertence a outra empresa."), { status: 403 });
      const conexao = await repo.salvarConexao({
        id: anterior?.id,
        empresa: Number(pedido.empresa),
        provedor: segredos.provedor,
        itemExterno: String(item.id || pedido.itemId),
        instituicao: item.connector?.name || item.institution || pedido.instituicao || "Instituição",
        conector: String(item.connector?.id || pedido.conectorId || ""),
        status: consentimento.revogadoEm ? "revogada" : "ativa",
        consentimentoId: consentimento.id || "",
        consentimentoExpira: consentimento.expiraEm,
        consentimentoRevogado: consentimento.revogadoEm,
        produtos: (consentimento.produtos || []).join(",").slice(0, 500),
        criadoEm: anterior?.criadoEm || new Date().toISOString(),
        atualizadoEm: new Date().toISOString(),
        tentativas: 0,
        ultimoErro: "",
        proximaTentativa: String(item.status || "").toUpperCase() === "UPDATING" ? new Date(Date.now() + 30_000).toISOString() : null,
      });
      const remotas = await api.contas(conexao.itemExterno);
      const contas = [];
      for (const remota of remotas) contas.push(await repo.salvarConta({ ...remota, empresa: conexao.empresa, conexaoId: conexao.id }));
      await auditar({ empresa: conexao.empresa, operacao: "confirmar_conexao", detalhe: `${conexao.instituicao} conectada com ${contas.length} conta(s).`, usuarioId: pedido.idusuario || null });
      return { conexao, contas };
    },

    async vincularConta(pedido) {
      const conta = await repo.obterConta(pedido.idConta, pedido.empresa);
      if (!conta) throw Object.assign(new Error("Conta bancária não encontrada nesta empresa."), { status: 404 });
      if (deps.contasErp) {
        const oficiais = await deps.contasErp();
        const existe = (oficiais || []).some((item) => String(item.cdbanco) === String(pedido.cdbanco) && String(item.numconta).trim() === String(pedido.numconta).trim());
        if (!existe) throw Object.assign(new Error("A conta informada não existe no ERP."), { status: 409 });
      }
      const salva = await repo.salvarConta({
        ...conta,
        vinculada: true,
        cdbanco: String(pedido.cdbanco).slice(0, 10),
        agenciaErp: String(pedido.agencia || "").slice(0, 20),
        numcontaErp: String(pedido.numconta).slice(0, 30),
      });
      await auditar({ empresa: pedido.empresa, operacao: "vincular_conta", detalhe: `Conta ${conta.idExterno} vinculada a ${pedido.cdbanco}/${pedido.numconta}.`, usuarioId: pedido.idusuario || null });
      return salva;
    },

    async sincronizar(pedido) {
      const conexao = await repo.obterConexao(pedido.idConexao, pedido.empresa);
      if (!conexao || conexao.status === "desconectada") throw Object.assign(new Error("Conexão não encontrada para esta empresa."), { status: 404 });
      if (["revogada", "consentimento_expirado"].includes(conexao.status) && !pedido.manual) return { ok: false, motivo: conexao.status };
      const { api } = await provedor();
      const inicio = new Date().toISOString();
      try {
        const consentimento = conexao.provedor === "pluggy" ? await api.consentimento(conexao.itemExterno) : await api.consentimento(conexao.consentimentoId);
        if (consentimento.revogadoEm) {
          await repo.salvarConexao({ ...conexao, status: "revogada", consentimentoRevogado: consentimento.revogadoEm, ultimoErro: "Consentimento revogado." });
          return { ok: false, motivo: "consentimento_revogado" };
        }
        if (consentimento.expiraEm && Date.parse(consentimento.expiraEm) < Date.now()) {
          await repo.salvarConexao({ ...conexao, status: "consentimento_expirado", consentimentoExpira: consentimento.expiraEm });
          return { ok: false, motivo: "consentimento_expirado" };
        }
        const remotas = await api.contas(conexao.itemExterno);
        const contas = [];
        for (const remota of remotas) contas.push(await repo.salvarConta({ ...remota, empresa: conexao.empresa, conexaoId: conexao.id }));
        const periodo = periodoRetroativo(pedido, conexao.ultimaSync);
        let totais = { recebidos: 0, novos: 0, duplicados: 0 };
        let truncado = false;
        if (api.nome === "belvo") {
          const lote = await api.transacoes(conexao.itemExterno, periodo);
          truncado = lote.truncado;
          for (const conta of contas) {
            const parte = await gravarLote(conexao, conta, lote.itens, "belvo");
            totais = { recebidos: totais.recebidos + parte.recebidos, novos: totais.novos + parte.novos, duplicados: totais.duplicados + parte.duplicados };
          }
        } else {
          for (const conta of contas) {
            const lote = await api.transacoes(conta.idExterno, periodo);
            truncado = truncado || lote.truncado;
            const parte = await gravarLote(conexao, conta, lote.itens, "pluggy");
            totais = { recebidos: totais.recebidos + parte.recebidos, novos: totais.novos + parte.novos, duplicados: totais.duplicados + parte.duplicados };
          }
        }
        const remoto = api.nome === "pluggy" ? await api.obterConexao(conexao.itemExterno) : null;
        const emColeta = String(remoto?.status || "").toUpperCase() === "UPDATING";
        const conciliacao = emColeta ? { aplicadas: [] } : await conciliarEmpresa(conexao.empresa);
        await repo.salvarConexao({
          ...conexao,
          status: "ativa",
          consentimentoExpira: consentimento.expiraEm,
          ultimaSync: emColeta ? conexao.ultimaSync : new Date().toISOString(),
          tentativas: 0,
          ultimoErro: emColeta ? "A Pluggy ainda está coletando o sandbox." : "",
          proximaTentativa: emColeta ? new Date(Date.now() + 30_000).toISOString() : null,
        });
        await repo.salvarSync({ empresa: conexao.empresa, conexaoId: conexao.id, inicio, fim: new Date().toISOString(), status: "ok", ...totais, truncado, tentativa: 0 });
        return { ok: true, ...totais, truncado, aplicadas: conciliacao.aplicadas.length, periodo };
      } catch (error) {
        const tentativas = Number(conexao.tentativas || 0) + 1;
        const proxima = new Date(Date.now() + proximaTentativaSegundos(tentativas) * 1000).toISOString();
        await repo.salvarConexao({ ...conexao, status: "erro", tentativas, proximaTentativa: proxima, ultimoErro: redigir(error.message) });
        await repo.salvarSync({ empresa: conexao.empresa, conexaoId: conexao.id, inicio, fim: new Date().toISOString(), status: "falha", recebidos: 0, novos: 0, duplicados: 0, erro: redigir(error.message), tentativa: tentativas });
        if (pedido.manual) throw Object.assign(new Error(redigir(error.message)), { status: error.status || 502 });
        return { ok: false, erro: redigir(error.message), proximaTentativa: proxima };
      }
    },

    async painel(filtro) {
      const [movimentos, contas, conexoes, divergencias, regras, syncs, politica] = await Promise.all([
        repo.listarMovimentos(filtro.empresa),
        repo.listarContas(filtro.empresa),
        repo.listarConexoes(filtro.empresa),
        repo.listarDivergencias(filtro.empresa),
        repo.listarRegras(filtro.empresa),
        repo.listarSync(filtro.empresa),
        garantirPolitica(filtro.empresa),
      ]);
      const saldosErp = deps.saldosErp ? await deps.saldosErp(filtro.empresa, contas) : [];
      const saldos = contas.filter((conta) => conta.vinculada).map((conta) => {
        const erp = (saldosErp || []).find((item) => String(item.cdbanco) === String(conta.cdbanco) && String(item.numconta) === String(conta.numcontaErp));
        return { conta: conta.numcontaErp, banco: conta.cdbanco, ...saldoDivergente(conta.saldo, erp ? erp.saldo : null) };
      });
      const filtrados = movimentos.filter((item) => {
        if (filtro.banco && String(item.banco) !== String(filtro.banco)) return false;
        if (filtro.conta && String(item.numero) !== String(filtro.conta) && String(item.contaId) !== String(filtro.conta)) return false;
        if (filtro.de && item.data < filtro.de) return false;
        if (filtro.ate && item.data > filtro.ate) return false;
        if (filtro.natureza && item.natureza !== filtro.natureza) return false;
        if (filtro.status && item.status !== filtro.status) return false;
        if (filtro.classe && item.classe !== filtro.classe) return false;
        return true;
      });
      return {
        politica,
        resumo: resumirPainel(filtrados, contas, conexoes, saldos),
        movimentos: filtrados,
        contas,
        conexoes,
        divergencias,
        regras,
        sincronizacoes: syncs.slice(-50),
      };
    },

    async aprovar(pedido) {
      if (pedido?.confirmado !== true || !pedido.idusuario) return { ok: false, motivo: "confirmacao_ausente" };
      const movimento = await repo.obterMovimento(pedido.id, pedido.empresa);
      if (!movimento) return { ok: false, motivo: "nao_encontrado" };
      if (["conciliado", "ignorado", "processando"].includes(movimento.status)) return { ok: false, motivo: "ja_utilizado" };
      const [contas, regras, carga] = await Promise.all([
        repo.listarContas(pedido.empresa),
        repo.listarRegras(pedido.empresa),
        carregar(pedido.empresa),
      ]);
      const companhia = movimento.acao === "transferencia"
        ? (await repo.listarMovimentos(pedido.empresa)).filter((item) => item.id === movimento.id || item.id === movimento.espelhoId)
        : [movimento];
      const [analise] = analisarMovimentos({
        movimentos: companhia.length ? companhia : [movimento],
        contas,
        regras,
        empresa: pedido.empresa,
        titulos: carga.titulos,
        contasProprias: carga.contasProprias || [],
        baixadosSemBanco: carga.baixadosSemBanco || [],
      }).filter((item) => item.movimento.id === movimento.id);
      if (!analise?.decisao) return { ok: false, motivo: "sem_correspondencia" };
      let decisao = { ...analise.decisao, empresa: pedido.empresa, valor: movimento.valor, aprovadaPorHumano: true };
      if (pedido.controle) {
        const titulo = (decisao.titulos || []).find((item) => Number(item.controle) === Number(pedido.controle) && item.tipo === pedido.tipo);
        if (!titulo) return { ok: false, motivo: "titulo_fora_das_opcoes" };
        decisao = { ...decisao, acao: "conciliar", titulos: [titulo], automatica: false, ambigua: false, alteraValor: false };
      }
      const gate = podeLiquidar(decisao, await garantirPolitica(pedido.empresa), "humano");
      if (!gate.aplicar) return gate;
      if (pedido.salvarRegra && decisao.titulos?.[0]?.pessoa) {
        await repo.salvarRegra({
          empresa: pedido.empresa,
          padrao: String(movimento.descricao || "").slice(0, 160),
          categoria: movimento.natureza || "outros",
          criarLancamento: false,
          ativa: true,
          origem: `usuario:${pedido.idusuario}`,
          criadoPor: pedido.idusuario,
          criadoEm: new Date().toISOString(),
        });
      }
      return liquidar({ ...analise, decisao }, { idusuario: pedido.idusuario, nome: pedido.nome || "", origem: "aprovacao-humana", perfil: pedido.perfil || "" });
    },

    async rejeitar(pedido) {
      if (!pedido?.idusuario) return { ok: false, motivo: "usuario_ausente" };
      const movimento = await repo.obterMovimento(pedido.id, pedido.empresa);
      if (!movimento || movimento.status === "conciliado") return { ok: false, motivo: "nao_pode_rejeitar" };
      await repo.salvarMovimento({ ...movimento, status: "ignorado", classe: movimento.classe || "nao_identificado" });
      await auditar({ empresa: pedido.empresa, operacao: "rejeitar", detalhe: `Movimento ${movimento.id} ignorado.`, usuarioId: pedido.idusuario });
      return { ok: true };
    },

    async classificar(pedido) {
      if (pedido?.confirmado !== true || !pedido.idusuario) return { ok: false, motivo: "confirmacao_ausente" };
      const movimento = await repo.obterMovimento(pedido.id, pedido.empresa);
      if (!movimento || movimento.status === "conciliado") return { ok: false, motivo: "nao_encontrado" };
      const categorias = ["tarifa", "juros", "iof", "rendimento", "estorno", "encargo", "transferencia", "nao_identificado"];
      if (!categorias.includes(pedido.categoria)) return { ok: false, motivo: "categoria_invalida" };
      let regra = null;
      if (pedido.salvarRegra) {
        regra = await repo.salvarRegra({
          empresa: pedido.empresa,
          padrao: String(pedido.padrao || movimento.descricao).slice(0, 160),
          categoria: pedido.categoria,
          criarLancamento: Boolean(pedido.criarLancamento),
          cdfornecedor: Number(pedido.cdfornecedor) || null,
          cdconta: Number(pedido.cdconta) || null,
          ativa: true,
          origem: `usuario:${pedido.idusuario}`,
          criadoPor: pedido.idusuario,
          criadoEm: new Date().toISOString(),
        });
      }
      await repo.salvarMovimento({ ...movimento, natureza: pedido.categoria, status: "classificado", charlie: `Classificação autorizada: ${pedido.categoria}.` });
      if (!pedido.criarLancamento) return { ok: true, regra, lancamento: false };
      const atualizado = await repo.obterMovimento(movimento.id, movimento.empresa);
      const decisao = {
        acao: "tarifa",
        automatica: true,
        aprovadaPorHumano: true,
        alteraValor: false,
        ambigua: false,
        fornecedor: Number(pedido.cdfornecedor),
        cdconta: Number(pedido.cdconta),
        empresa: pedido.empresa,
        valor: atualizado.valor,
        natureza: "tarifa",
        titulos: [],
      };
      const gate = podeLiquidar(decisao, await garantirPolitica(pedido.empresa), "humano");
      if (!gate.aplicar) return { ...gate, regra, lancamento: false };
      const resultado = await liquidar({ movimento: atualizado, decisao }, { idusuario: pedido.idusuario, nome: pedido.nome || "", origem: "aprovacao-humana" });
      return { ...resultado, regra };
    },

    async regraAtualizar(pedido) {
      const regras = await repo.listarRegras(pedido.empresa);
      const atual = regras.find((item) => item.id === pedido.id);
      if (!atual) return { ok: false, motivo: "nao_encontrada" };
      const salva = await repo.salvarRegra({ ...atual, ...pedido.patch, id: atual.id, empresa: pedido.empresa });
      return { ok: true, regra: salva };
    },

    async desconectar(pedido) {
      const conexao = await repo.obterConexao(pedido.idConexao, pedido.empresa);
      if (!conexao) throw Object.assign(new Error("Conexão não encontrada nesta empresa."), { status: 404 });
      const { api } = await provedor();
      await api.excluir(conexao.itemExterno);
      const salva = await repo.salvarConexao({ ...conexao, status: "desconectada", consentimentoRevogado: new Date().toISOString(), atualizadoEm: new Date().toISOString() });
      await auditar({ empresa: pedido.empresa, operacao: "desconectar", detalhe: `${conexao.instituicao} desconectada.`, usuarioId: pedido.idusuario || null });
      return salva;
    },

    async renovar(pedido) {
      const conexao = await repo.obterConexao(pedido.idConexao, pedido.empresa);
      if (!conexao) throw Object.assign(new Error("Conexão não encontrada nesta empresa."), { status: 404 });
      const { api } = await provedor();
      return api.iniciarConexao({ ...pedido, itemId: conexao.itemExterno, empresa: pedido.empresa });
    },

    async relatorio(pedido) {
      const data = dia(pedido.data || new Date());
      const [movimentos, contas] = await Promise.all([repo.listarMovimentos(pedido.empresa), repo.listarContas(pedido.empresa)]);
      const relatorio = montarRelatorio({ empresa: pedido.empresa, nome: pedido.nomeEmpresa, data, movimentos, contas });
      if (pedido.enviar && deps.notificar) await deps.notificar([relatorioTexto(relatorio)]);
      if (pedido.registrar) {
        const politica = await garantirPolitica(pedido.empresa);
        await repo.salvarPolitica({ ...politica, ultimoRelatorio: data });
      }
      return relatorio;
    },

    async webhook(pedido) {
      const segredos = await lerSegredos();
      if (!segredos?.webhookSecret) return { ok: false, status: 503, motivo: "webhook_nao_configurado" };
      if (!segredoConfere(segredos.webhookSecret, pedido.token)) return { ok: false, status: 401, motivo: "token_invalido" };
      const eventoId = String(pedido.eventoId || "");
      if (eventoId && await repo.eventoVisto(eventoId)) return { ok: true, duplicado: true };
      if (eventoId) await repo.registrarEvento(eventoId, 0);
      const itemId = String(pedido.itemId || "");
      const conexao = itemId ? await repo.obterConexaoPorItem(itemId) : null;
      if (!conexao) return { ok: true, ignorado: true };
      const erro = /error|revoked|deleted/i.test(String(pedido.evento || ""));
      await repo.salvarConexao({
        ...conexao,
        proximaTentativa: new Date().toISOString(),
        ultimoErro: erro ? redigir(pedido.erro || pedido.evento) : conexao.ultimoErro,
        status: /revoked/i.test(String(pedido.evento || "")) ? "revogada" : conexao.status,
      });
      if (deps.agendar && !erro) deps.agendar(() => this.sincronizar({ idConexao: conexao.id, empresa: conexao.empresa }));
      return { ok: true, conexao: conexao.id };
    },

    async orquestrar(agora = new Date()) {
      await repo.liberarTravados?.(new Date(agora.getTime() - 15 * 60 * 1000).toISOString());
      const conexoes = await repo.listarConexoes();
      const resultados = [];
      const empresas = new Set();
      for (const conexao of conexoes) {
        if (["desconectada", "revogada", "consentimento_expirado"].includes(conexao.status)) continue;
        const politica = await garantirPolitica(conexao.empresa);
        const ultima = conexao.ultimaSync ? Date.parse(conexao.ultimaSync) : 0;
        const proxima = conexao.proximaTentativa ? Date.parse(conexao.proximaTentativa) : 0;
        const vencida = !ultima || agora.getTime() - ultima >= politica.intervaloMinutos * 60 * 1000;
        const retry = proxima && proxima <= agora.getTime();
        if (!vencida && !retry) continue;
        resultados.push(await this.sincronizar({ idConexao: conexao.id, empresa: conexao.empresa }));
        empresas.add(conexao.empresa);
      }
      const relatorios = [];
      for (const empresa of empresas) {
        const politica = await garantirPolitica(empresa);
        const hoje = dia(agora);
        if (politica.ultimoRelatorio !== hoje && agora.getHours() >= 8) {
          relatorios.push(await this.relatorio({ empresa, data: hoje, enviar: true, registrar: true }));
        }
        const limite = new Date(agora.getTime() - politica.retencaoDias * 86400000).toISOString().slice(0, 10);
        await repo.redactarAntigos(empresa, limite);
      }
      if (deps.notificar) {
        const atuais = await repo.listarConexoes();
        const divergencias = [];
        for (const empresa of empresas) divergencias.push(...await repo.listarDivergencias(empresa));
        const textos = avisos(atuais, divergencias, resultados);
        if (textos.length) await deps.notificar(textos);
      }
      return { resultados, relatorios };
    },

    async estornar(pedido) {
      if (pedido?.confirmado !== true || !pedido.idusuario) return { ok: false, motivo: "confirmacao_ausente" };
      const movimento = await repo.obterMovimento(pedido.id, pedido.empresa);
      if (!movimento || movimento.status !== "conciliado" || !movimento.extratoItem || !movimento.movBancario) return { ok: false, motivo: "sem_rastreio" };
      const registro = {
        origem: movimento.origemBaixa,
        movimentos: [movimento.movBancario],
        movimentoId: movimento.extratoItem,
        empresa: movimento.empresa,
        titulos: movimento.titulos || [],
        acao: movimento.acao,
        espelhoId: null,
        desfeito: false,
      };
      const permissao = desfazerPermitido(registro, pedido);
      if (!permissao.ok) return permissao;
      await deps.transacao((tx) => deps.desfazer(tx, registro));
      await repo.salvarMovimento({ ...movimento, status: "sugerido", extratoItem: null, movBancario: null, origemBaixa: "" });
      await auditar({ empresa: pedido.empresa, operacao: "estorno", detalhe: `Baixa do movimento ${movimento.id} desfeita.`, usuarioId: pedido.idusuario });
      return { ok: true };
    },
  };
}

function relatorioTexto(relatorio) {
  return {
    prioridade: "normal",
    texto: [
      relatorio.titulo,
      `Empresa: ${relatorio.empresa}`,
      `Movimentações identificadas: ${relatorio.movimentacoes}`,
      `Conciliadas automaticamente: ${relatorio.conciliadasAutomaticamente}`,
      `Pendentes de análise: ${relatorio.pendentes}`,
      `Divergências: ${relatorio.divergencias}`,
      `Percentual de conciliação automática: ${relatorio.percentual == null ? "sem base" : `${relatorio.percentual.toLocaleString("pt-BR")}%`}`,
      `Valor total recebido: ${moeda(relatorio.recebido)}`,
      `Valor total pago: ${moeda(relatorio.pago)}`,
      `Saldo bancário informado: ${relatorio.saldoBancario == null ? "não informado pelo provedor" : moeda(relatorio.saldoBancario)}`,
      relatorio.alertas.join(" "),
    ].filter(Boolean).join("\n"),
  };
}

function avisos(conexoes, divergencias, resultados) {
  const textos = [];
  for (const conexao of conexoes || []) {
    if (conexao.status === "erro") textos.push({ prioridade: "alta", texto: `Falha na conexão bancária ${conexao.instituicao}.` });
    if (conexao.consentimentoExpira) {
      const dias = (Date.parse(conexao.consentimentoExpira) - Date.now()) / 86400000;
      if (dias >= 0 && dias <= 15) textos.push({ prioridade: "alta", texto: `Consentimento de ${conexao.instituicao} vence em ${Math.ceil(dias)} dia(s).` });
    }
  }
  for (const item of divergencias || []) {
    if (item.status === "aberta" && ["duplicidade", "pagamento_superior", "titulo_ja_baixado"].includes(item.tipo)) {
      textos.push({ prioridade: "alta", texto: `Divergência ${item.tipo} de ${moeda(item.valor)}.` });
    }
  }
  const falhas = (resultados || []).filter((item) => item && item.ok === false);
  if (falhas.length) textos.push({ prioridade: "alta", texto: `${falhas.length} sincronização(ões) falharam e serão tentadas de novo.` });
  return textos;
}

function moeda(valor) {
  return (Number(valor) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function regraDaEmpresa(regras, movimento) {
  return (regras || []).find((regra) => regraCompativel(regra, movimento)) || null;
}
