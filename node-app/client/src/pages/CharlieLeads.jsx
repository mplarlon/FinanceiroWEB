import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";

const ABAS = ["Painel", "Pesquisa", "Leads", "Funil", "Distribuição", "Automações", "Relatórios", "Configurações"];
const STATUS = ["NOVO", "QUALIFICADO", "ATRIBUIDO", "CONTATO_PENDENTE", "EM_CONTATO", "INTERESSADO", "ORCAMENTO", "NEGOCIACAO", "CONVERTIDO", "PERDIDO", "DESCARTADO"];
const DIAS = [["1", "Seg"], ["2", "Ter"], ["3", "Qua"], ["4", "Qui"], ["5", "Sex"], ["6", "Sáb"], ["0", "Dom"]];
const vazio = {
  uf: "RJ", municipio: "", cnae: "4120400", cnaeSecundario: "", incluirSecundaria: false,
  razaoSocial: "", nomeFantasia: "", situacao: "ATIVA", matrizFilial: "", porte: "",
  capitalMinimo: "", capitalMaximo: "", aberturaInicio: "", aberturaFim: "", ultimosDias: "",
  limite: 10, pagina: 1, comTelefone: false, comEmail: false, erp: "",
  bairro: "", cep: "", numero: "", ddd: "", telefone: "", natureza: "", cnpj: "", cnpjRaiz: "", excluirCnpj: "",
  mei: "", meiExclusaoInicio: "", meiExclusaoFim: "", simples: "", simplesExclusaoInicio: "", simplesExclusaoFim: "",
  somenteFixo: false, somenteCelular: false, excluirVisualizadas: false, excluirEmailContabil: false,
};
const RECORTE_VAZIO = { desde: "", ate: "", vendedorId: "", uf: "", cidade: "", segmento: "", status: "", semCidade: "", semVendedor: "", semSegmento: "" };
const partir = (valor) => String(valor || "").split(/[,;]+/).map((item) => item.trim()).filter(Boolean);

function textoRecorte(recorte, config, vendedores) {
  const partes = [];
  if (recorte.desde || recorte.ate) partes.push(`${recorte.desde || "início"} a ${recorte.ate || "hoje"}`);
  if (recorte.status) partes.push(String(recorte.status).replaceAll("_", " "));
  if (recorte.semVendedor) partes.push("sem vendedor");
  else if (recorte.vendedorId) partes.push(vendedores.find((item) => String(item.id) === String(recorte.vendedorId))?.nome || `vendedor ${recorte.vendedorId}`);
  if (recorte.uf) partes.push(String(recorte.uf).toUpperCase());
  if (recorte.semCidade) partes.push("sem cidade");
  else if (recorte.cidade) partes.push(recorte.cidade);
  if (recorte.semSegmento) partes.push("sem segmento");
  else if (recorte.segmento) partes.push((config?.segmentos || []).find((item) => item.id === recorte.segmento)?.nome || recorte.segmento);
  return partes;
}
const numeroOuNada = (valor) => valor === "" || valor == null ? undefined : Number(valor);

function moeda(valor) {
  return valor == null ? "sem base" : Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function classe(codigo) {
  if (codigo === "POTENCIAL_ALTO") return "alto";
  if (codigo === "POTENCIAL_MEDIO") return "medio";
  return "baixo";
}
function Barras({ titulo, itens, onPick }) {
  const maior = Math.max(1, ...(itens || []).map((item) => item.total));
  return (
    <article className="leads-card">
      <h3>{titulo}</h3>
      {(itens || []).length ? (
        <div className="leads-bars">
          {itens.map((item) => {
            const conteudo = (<><span>{item.rotulo}</span><i style={{ width: `${Math.max(6, (item.total / maior) * 100)}%` }} /><b>{item.total}</b></>);
            return onPick
              ? <button key={`${item.rotulo}-${item.valor ?? item.vendedorId ?? ""}`} type="button" title={`${item.rotulo}: ${item.total}`} onClick={() => onPick(item)}>{conteudo}</button>
              : <div className="barra" key={`${item.rotulo}-${item.valor ?? ""}`}>{conteudo}</div>;
          })}
        </div>
      ) : <p>Sem dados neste recorte.</p>}
    </article>
  );
}

export default function CharlieLeads() {
  const [aba, setAba] = useState("Painel");
  const [config, setConfig] = useState(null);
  const [indicadores, setIndicadores] = useState(null);
  const [leads, setLeads] = useState([]);
  const [vendedores, setVendedores] = useState([]);
  const [filtros, setFiltros] = useState(vazio);
  const [pesquisa, setPesquisa] = useState(null);
  const [historico, setHistorico] = useState([]);
  const [selecionado, setSelecionado] = useState(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [chave, setChave] = useState("");
  const [token, setToken] = useState("");
  const [recorte, setRecorte] = useState(RECORTE_VAZIO);

  function consultaDe(filtro) {
    const params = new URLSearchParams();
    for (const [chaveFiltro, valor] of Object.entries(filtro)) if (valor) params.set(chaveFiltro, valor);
    const texto = params.toString();
    return texto ? `?${texto}` : "";
  }

  async function carregar(filtro = recorte) {
    const consulta = consultaDe(filtro);
    const [conf, ind, lista, vend, locais] = await Promise.all([
      api.get("/charlie-leads/config"),
      api.get(`/charlie-leads/indicadores${consulta}`),
      api.get(`/charlie-leads/leads${consulta}`),
      api.get("/charlie-leads/vendedores").catch(() => ({ vendedores: [] })),
      api.get("/charlie-leads/pesquisas").catch(() => ({ pesquisas: [] })),
    ]);
    setConfig(conf.config);
    setIndicadores(ind.indicadores);
    setLeads(lista.leads || []);
    setVendedores(vend.vendedores || []);
    setHistorico(locais.pesquisas || []);
  }
  useEffect(() => { carregar().catch((causa) => setErro(causa.message)); }, []);

  async function executar(acao) {
    setOcupado(true); setErro(""); setAviso("");
    try { const resultado = await acao(); setAviso(resultado || "Operação concluída."); await carregar(); }
    catch (causa) { setErro(causa.message); }
    finally { setOcupado(false); }
  }

  async function pesquisar(event) {
    event?.preventDefault();
    await executar(async () => {
      const corpo = {
        uf: filtros.uf ? [filtros.uf.toLowerCase()] : [],
        municipio: filtros.municipio ? [filtros.municipio] : [],
        cnae: partir(filtros.cnae),
        cnaeSecundario: partir(filtros.cnaeSecundario),
        incluirSecundaria: filtros.incluirSecundaria,
        razaoSocial: filtros.razaoSocial || undefined,
        nomeFantasia: filtros.nomeFantasia || undefined,
        situacao: filtros.situacao ? [filtros.situacao] : [],
        matrizFilial: filtros.matrizFilial || undefined,
        porte: filtros.porte ? [filtros.porte] : [],
        capitalMinimo: numeroOuNada(filtros.capitalMinimo),
        capitalMaximo: numeroOuNada(filtros.capitalMaximo),
        aberturaInicio: filtros.aberturaInicio || undefined,
        aberturaFim: filtros.aberturaFim || undefined,
        ultimosDias: numeroOuNada(filtros.ultimosDias),
        limite: Number(filtros.limite) || 10,
        pagina: Number(filtros.pagina) || 1,
        comTelefone: filtros.comTelefone,
        comEmail: filtros.comEmail,
        bairro: filtros.bairro ? [filtros.bairro] : [],
        cep: partir(filtros.cep),
        enderecoNumero: filtros.numero ? [filtros.numero] : [],
        ddd: partir(filtros.ddd),
        telefone: partir(filtros.telefone),
        naturezaJuridica: partir(filtros.natureza),
        cnpj: partir(filtros.cnpj),
        cnpjRaiz: partir(filtros.cnpjRaiz),
        excluirCnpj: partir(filtros.excluirCnpj),
        meiOptante: filtros.mei === "optante",
        meiExcluir: filtros.mei === "excluir",
        meiExclusaoInicio: filtros.mei === "excluir" ? filtros.meiExclusaoInicio || undefined : undefined,
        meiExclusaoFim: filtros.mei === "excluir" ? filtros.meiExclusaoFim || undefined : undefined,
        simplesOptante: filtros.simples === "optante",
        simplesExcluir: filtros.simples === "excluir",
        simplesExclusaoInicio: filtros.simples === "excluir" ? filtros.simplesExclusaoInicio || undefined : undefined,
        simplesExclusaoFim: filtros.simples === "excluir" ? filtros.simplesExclusaoFim || undefined : undefined,
        somenteFixo: filtros.somenteFixo,
        somenteCelular: filtros.somenteCelular,
        excluirVisualizadas: filtros.excluirVisualizadas,
        excluirEmailContabil: filtros.excluirEmailContabil,
        jaCadastradas: filtros.erp === "sim",
        naoCadastradas: filtros.erp === "nao",
      };
      const dados = await api.post("/charlie-leads/pesquisar", corpo);
      setPesquisa(dados.pesquisa);
      return dados.pesquisa?.reutilizado ? "Pesquisa reutilizada, sem novo consumo." : "Pesquisa concluída com o retorno da Casa dos Dados.";
    });
  }

  async function abrirLocal(id) {
    await executar(async () => {
      const dados = await api.get(`/charlie-leads/pesquisas/${id}`);
      const aberta = dados.pesquisa;
      setPesquisa(aberta);
      setFiltros((atual) => ({ ...atual, pagina: aberta?.pagina || 1, limite: aberta?.limite || atual.limite }));
      return "Pesquisa local aberta. Nenhuma consulta paga foi feita.";
    });
  }

  async function salvarConfig(event) {
    event.preventDefault();
    const form = new FormData(event.target);
    const corpo = Object.fromEntries(form.entries());
    corpo.ativa = form.get("ativa") === "on";
    corpo.consultasPagasAutorizadas = form.get("consultasPagasAutorizadas") === "on";
    corpo.autorizarLote = form.get("autorizarLote") === "on";
    corpo.autorizarAutomatico = form.get("autorizarAutomatico") === "on";
    corpo.bloquearAoAtingir = form.get("bloquearAoAtingir") === "on";
    corpo.regioesAtendidas = String(corpo.regioesAtendidas || "").split(",").map((item) => item.trim()).filter(Boolean);
    if (chave) corpo.apiKey = chave;
    if (token) corpo.webhookToken = token;
    await executar(async () => { await api.put("/charlie-leads/config", corpo); setChave(""); setToken(""); return "Configuração gravada. A chave permanece somente no servidor."; });
  }

  async function baixar(formato) {
    const params = new URLSearchParams({ formato });
    for (const [chaveFiltro, valor] of Object.entries(recorte)) if (valor) params.set(chaveFiltro, valor);
    const resposta = await fetch(`/api/charlie-leads/exportar?${params}`);
    if (!resposta.ok) { setErro("Não foi possível exportar."); return; }
    const blob = await resposta.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `charlie-leads.${formato === "xlsx" ? "xlsx" : "csv"}`; link.click();
    URL.revokeObjectURL(url);
  }

  function aplicarRecorte(proximo, aba) {
    setRecorte(proximo);
    if (aba) setAba(aba);
    carregar(proximo).catch((causa) => setErro(causa.message));
  }

  function abrirLista(parcial) {
    aplicarRecorte({ ...recorte, ...parcial }, "Leads");
  }

  function atualizarSelecionado(lead) {
    setSelecionado({ ...lead, leadId: lead.id, pontuacao: lead.score });
    carregar().catch((causa) => setErro(causa.message));
  }

  function alterarFiltro(parcial) {
    setFiltros((atual) => {
      const patch = typeof parcial === "function" ? parcial(atual) : parcial;
      const mudaConsulta = Object.keys(patch).some((chave) => chave !== "pagina");
      return { ...atual, ...patch, ...(mudaConsulta ? { pagina: 1 } : {}) };
    });
  }

  function irPagina(destino) {
    const pagina = Math.min(100000, Math.max(1, destino));
    alterarFiltro({ pagina });
  }

  const pendente = config && !config.chaveConfigurada;
  const pago = config?.consultasPagasAutorizadas && config?.ativa && config?.chaveConfigurada;
  const paginaAtual = Math.max(1, Number(filtros.pagina) || 1);
  const limiteAtual = Math.max(1, Number(filtros.limite) || 10);
  const totalInformado = Number.isFinite(Number(pesquisa?.total)) ? Number(pesquisa.total) : null;
  const limiteConsultado = Number(pesquisa?.limite) || limiteAtual;
  const paginas = totalInformado != null && limiteConsultado > 0 ? Math.max(1, Math.ceil(totalInformado / limiteConsultado)) : null;
  const consultaPendente = Boolean(pesquisa) && (Number(pesquisa.pagina) !== paginaAtual || Number(pesquisa.limite) !== limiteAtual);

  return (
    <section className="leads-page">
      <header>
        <span className="tray-kicker">CHARLIE VENDAS</span>
        <h2>Contatos</h2>
        <p className="sub">Empresas para entrar em contato</p>
      </header>
      {pendente ? <div className="leads-banner">Configuração pendente. Informe a API Key em Configurações. Nenhuma consulta paga será feita antes disso.</div> : null}
      {config && !pago ? <div className="leads-banner">As consultas pagas seguem desativadas até um administrador autorizar o uso.</div> : null}
      {erro ? <div className="error">{erro}</div> : null}
      {aviso ? <div className="leads-banner">{aviso}</div> : null}
      <nav className="leads-tabs">{ABAS.map((item) => <button className={aba === item ? "ativo" : ""} key={item} type="button" onClick={() => setAba(item)}>{item}</button>)}</nav>
      {textoRecorte(recorte, config, vendedores).length ? <div className="leads-banner">Recorte ativo: {textoRecorte(recorte, config, vendedores).join(" · ")}. <button type="button" onClick={() => aplicarRecorte(RECORTE_VAZIO)}>Limpar recorte</button></div> : null}

      {aba === "Painel" && indicadores && (
        <>
          <div className="leads-kpis">
            {[
              ["Encontrados", indicadores.total],
              ["Novos", indicadores.novos],
              ["Qualificados", indicadores.qualificados],
              ["Em negociação", indicadores.negociacao],
              ["Convertidos", indicadores.convertidos],
              ["Descartados", indicadores.descartados],
              ["Conversão", indicadores.conversao == null ? "sem base" : `${Math.round(indicadores.conversao * 100)}%`],
              ["Potencial estimado", moeda(indicadores.potencialEstimado)],
              ["Créditos debitados", indicadores.creditos == null ? "não confirmado" : indicadores.creditos],
              ["Consultas pagas", indicadores.consultasPagas],
            ].map(([rotulo, valor]) => <article key={rotulo}><span>{rotulo}</span><strong>{valor}</strong></article>)}
          </div>
          <div className="leads-charts">
            <Barras titulo="Evolução dos leads" itens={indicadores.evolucao} onPick={(item) => abrirLista({ desde: item.rotulo, ate: item.rotulo })} />
            <Barras titulo="Leads por cidade" itens={indicadores.porCidade} onPick={(item) => abrirLista(item.valor ? { cidade: item.valor, semCidade: "" } : { cidade: "", semCidade: "1" })} />
            <Barras titulo="Leads por segmento" itens={indicadores.porSegmento} onPick={(item) => abrirLista(item.valor ? { segmento: item.valor, semSegmento: "" } : { segmento: "", semSegmento: "1" })} />
            <Barras titulo="Leads por vendedor" itens={indicadores.porVendedor} onPick={(item) => abrirLista(item.vendedorId ? { vendedorId: String(item.vendedorId), semVendedor: "" } : { vendedorId: "", semVendedor: "1" })} />
            <Barras titulo="Origem dos leads" itens={indicadores.porOrigem} />
            <Barras titulo="Conversão por período" itens={indicadores.conversaoPeriodo} />
            <Barras titulo="Desempenho da prospecção" itens={indicadores.desempenho} />
          </div>
        </>
      )}

      {aba === "Pesquisa" && (
        <form className="leads-card leads-filters" onSubmit={pesquisar}>
          <label>Estado<input value={filtros.uf} onChange={(e) => alterarFiltro({ uf: e.target.value })} /></label>
          <label>Cidade<input value={filtros.municipio} onChange={(e) => alterarFiltro({ municipio: e.target.value })} /></label>
          <label>Bairro<input value={filtros.bairro} onChange={(e) => alterarFiltro({ bairro: e.target.value })} /></label>
          <label>CEP<input value={filtros.cep} placeholder="07115000" onChange={(e) => alterarFiltro({ cep: e.target.value })} /></label>
          <label>Número<input value={filtros.numero} onChange={(e) => alterarFiltro({ numero: e.target.value })} /></label>
          <label>Razão social<input value={filtros.razaoSocial} onChange={(e) => alterarFiltro({ razaoSocial: e.target.value })} /></label>
          <label>Nome fantasia<input value={filtros.nomeFantasia} onChange={(e) => alterarFiltro({ nomeFantasia: e.target.value })} /></label>
          <label>CNAE principal<input value={filtros.cnae} onChange={(e) => alterarFiltro({ cnae: e.target.value })} /></label>
          <label>CNAEs secundários<input value={filtros.cnaeSecundario} placeholder="separados por vírgula" onChange={(e) => alterarFiltro({ cnaeSecundario: e.target.value })} /></label>
          <label>Situação<select value={filtros.situacao} onChange={(e) => alterarFiltro({ situacao: e.target.value })}>{["ATIVA", "BAIXADA", "INAPTA", "NULA", "SUSPENSA"].map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Matriz ou filial<select value={filtros.matrizFilial} onChange={(e) => alterarFiltro({ matrizFilial: e.target.value })}><option value="">Todas</option><option value="MATRIZ">Matriz</option><option value="FILIAL">Filial</option></select></label>
          <label>Porte<select value={filtros.porte} onChange={(e) => alterarFiltro({ porte: e.target.value })}><option value="">Qualquer</option><option value="01">01 · Microempresa</option><option value="03">03 · Pequeno porte</option><option value="05">05 · Demais</option></select></label>
          <label>Natureza jurídica<input value={filtros.natureza} placeholder="2062" onChange={(e) => alterarFiltro({ natureza: e.target.value })} /></label>
          <label>CNPJ<input value={filtros.cnpj} placeholder="separados por vírgula" onChange={(e) => alterarFiltro({ cnpj: e.target.value })} /></label>
          <label>CNPJ raiz<input value={filtros.cnpjRaiz} placeholder="8 dígitos" onChange={(e) => alterarFiltro({ cnpjRaiz: e.target.value })} /></label>
          <label>Excluir CNPJs<input value={filtros.excluirCnpj} placeholder="separados por vírgula" onChange={(e) => alterarFiltro({ excluirCnpj: e.target.value })} /></label>
          <label>DDD<input value={filtros.ddd} onChange={(e) => alterarFiltro({ ddd: e.target.value })} /></label>
          <label>Telefone<input value={filtros.telefone} onChange={(e) => alterarFiltro({ telefone: e.target.value })} /></label>
          <label>MEI<select value={filtros.mei} onChange={(e) => alterarFiltro({ mei: e.target.value })}><option value="">Qualquer</option><option value="optante">Somente optante</option><option value="excluir">Excluir optante</option></select></label>
          {filtros.mei === "excluir" ? <label>Exclusão do MEI de<input type="date" value={filtros.meiExclusaoInicio} onChange={(e) => alterarFiltro({ meiExclusaoInicio: e.target.value })} /></label> : null}
          {filtros.mei === "excluir" ? <label>Exclusão do MEI até<input type="date" value={filtros.meiExclusaoFim} onChange={(e) => alterarFiltro({ meiExclusaoFim: e.target.value })} /></label> : null}
          <label>Simples<select value={filtros.simples} onChange={(e) => alterarFiltro({ simples: e.target.value })}><option value="">Qualquer</option><option value="optante">Somente optante</option><option value="excluir">Excluir optante</option></select></label>
          {filtros.simples === "excluir" ? <label>Exclusão do Simples de<input type="date" value={filtros.simplesExclusaoInicio} onChange={(e) => alterarFiltro({ simplesExclusaoInicio: e.target.value })} /></label> : null}
          {filtros.simples === "excluir" ? <label>Exclusão do Simples até<input type="date" value={filtros.simplesExclusaoFim} onChange={(e) => alterarFiltro({ simplesExclusaoFim: e.target.value })} /></label> : null}
          <label>Capital mínimo<input type="number" min="0" value={filtros.capitalMinimo} onChange={(e) => alterarFiltro({ capitalMinimo: e.target.value })} /></label>
          <label>Capital máximo<input type="number" min="0" value={filtros.capitalMaximo} onChange={(e) => alterarFiltro({ capitalMaximo: e.target.value })} /></label>
          <label>Abertura de<input type="date" value={filtros.aberturaInicio} onChange={(e) => alterarFiltro({ aberturaInicio: e.target.value })} /></label>
          <label>Abertura até<input type="date" value={filtros.aberturaFim} onChange={(e) => alterarFiltro({ aberturaFim: e.target.value })} /></label>
          <label>Abertas nos últimos dias<input type="number" min="1" max="3650" value={filtros.ultimosDias} onChange={(e) => alterarFiltro({ ultimosDias: e.target.value })} /></label>
          <label>Limite<input type="number" min="1" max="1000" value={filtros.limite} onChange={(e) => alterarFiltro({ limite: e.target.value })} /></label>
          <label>Página<input type="number" min="1" value={filtros.pagina} onChange={(e) => alterarFiltro({ pagina: e.target.value })} /></label>
          <label>No ERP<select value={filtros.erp} onChange={(e) => alterarFiltro({ erp: e.target.value })}><option value="">Todos</option><option value="sim">Já cadastradas</option><option value="nao">Ainda não cadastradas</option></select></label>
          <label className="tray-check"><input type="checkbox" checked={filtros.incluirSecundaria} onChange={(e) => alterarFiltro({ incluirSecundaria: e.target.checked })} /> Incluir CNAE secundário</label>
          <label className="tray-check"><input type="checkbox" checked={filtros.comTelefone} onChange={(e) => alterarFiltro({ comTelefone: e.target.checked })} /> Com telefone</label>
          <label className="tray-check"><input type="checkbox" checked={filtros.comEmail} onChange={(e) => alterarFiltro({ comEmail: e.target.checked })} /> Com e-mail</label>
          <label className="tray-check"><input type="checkbox" checked={filtros.somenteFixo} onChange={(e) => alterarFiltro({ somenteFixo: e.target.checked, somenteCelular: e.target.checked ? false : filtros.somenteCelular })} /> Somente fixo</label>
          <label className="tray-check"><input type="checkbox" checked={filtros.somenteCelular} onChange={(e) => alterarFiltro({ somenteCelular: e.target.checked, somenteFixo: e.target.checked ? false : filtros.somenteFixo })} /> Somente celular</label>
          <label className="tray-check"><input type="checkbox" checked={filtros.excluirVisualizadas} onChange={(e) => alterarFiltro({ excluirVisualizadas: e.target.checked })} /> Excluir empresas já visualizadas</label>
          <label className="tray-check"><input type="checkbox" checked={filtros.excluirEmailContabil} onChange={(e) => alterarFiltro({ excluirEmailContabil: e.target.checked })} /> Excluir e-mail de contabilidade</label>
          <p>A correspondência de CNAE não comprova intenção de compra. Só entram campos aceitos pela API. Telefone e e-mail só aparecem se a resposta da Casa dos Dados trouxer esses campos. Trocar de página não consulta a Casa dos Dados.</p>
          <div className="leads-actions">
            <button className="primary" disabled={ocupado} type="submit">{ocupado ? "Consultando…" : "Pesquisar"}</button>
            <button type="button" disabled={paginaAtual <= 1} onClick={() => irPagina(paginaAtual - 1)}>Página anterior</button>
            <button type="button" disabled={paginas != null && paginaAtual >= paginas} onClick={() => irPagina(paginaAtual + 1)}>Próxima página</button>
            <button type="button" disabled={!pesquisa?.empresas?.length} onClick={() => exportarTabela(pesquisa.empresas)}>Exportar resultados</button>
          </div>
          <p>Página {paginaAtual}{paginas != null ? ` de ${paginas}` : ""}{totalInformado != null ? ` · total informado pela API: ${totalInformado}` : ""}.</p>
          {consultaPendente ? <p>Esta página ou este limite ainda não foi consultado. Pesquisar pode consumir créditos.</p> : null}
          {pesquisa ? <p>{pesquisa.local ? "Resultado gravado neste servidor. " : pesquisa.reutilizado ? "Resultado reutilizado. " : ""}{pesquisa.empresas?.length || 0} empresa(s) na página consultada {pesquisa.pagina || 1}.</p> : null}
          <div className="leads-scroll"><Tabela empresas={pesquisa?.empresas || []} segmentos={config?.segmentos} vendedores={vendedores} onChange={carregar} onErro={setErro} onSelect={setSelecionado} /></div>
          {selecionado ? <Detalhe key={selecionado.atualizadoEm || selecionado.cnpj} empresa={selecionado} onClose={() => setSelecionado(null)} onAtualizar={atualizarSelecionado} /> : null}
          <h3>Pesquisas já gravadas</h3>
          <p>Estas linhas saíram do arquivo local. Abrir não consulta a Casa dos Dados.</p>
          {historico.length ? historico.map((item) => (
            <p key={item.id}>{new Date(item.em).toLocaleString("pt-BR")} · {item.resumo} · página {item.pagina || 1} · {item.validos} empresa(s){item.total != null ? ` · total ${item.total}` : ""} <button type="button" disabled={ocupado} onClick={() => abrirLocal(item.id)}>Abrir nesta tela</button></p>
          )) : <p>Nenhuma pesquisa gravada neste servidor.</p>}
        </form>
      )}

      {aba === "Leads" && <div className="leads-scroll"><Tabela empresas={leads.map((lead) => ({ ...lead, pontuacao: lead.score, classificacao: lead.classificacao, vinculo: lead.vinculo, leadId: lead.id }))} segmentos={config?.segmentos} vendedores={vendedores} onChange={carregar} onErro={setErro} onSelect={setSelecionado} />{selecionado ? <Detalhe key={selecionado.atualizadoEm || selecionado.cnpj} empresa={selecionado} onClose={() => setSelecionado(null)} onAtualizar={atualizarSelecionado} /> : null}</div>}

      {aba === "Funil" && (
        <div className="leads-funil">{(indicadores?.funil || []).map((item) => <button className={recorte.status === item.status ? "ativo" : ""} key={item.status} type="button" onClick={() => aplicarRecorte({ ...recorte, status: recorte.status === item.status ? "" : item.status }, "Leads")}><b>{item.status.replaceAll("_", " ")}</b><span>{item.total}</span></button>)}</div>
      )}

      {aba === "Distribuição" && (
        <form className="leads-card leads-form" onSubmit={(event) => { event.preventDefault(); executar(async () => { const dados = await api.post("/charlie-leads/distribuir", { quantidade: Number(new FormData(event.target).get("quantidade")) || 50 }); return `${dados.quantidade} contato(s) distribuído(s).`; }); }}>
          <p>Modo atual: {config?.distribuicao?.modo || "manual"}. A distribuição automática só atribui leads sem vendedor e exige regras já gravadas.</p>
          <label>Quantidade<input name="quantidade" type="number" min="1" defaultValue="50" /></label>
          <button className="primary" disabled={ocupado} type="submit">Distribuir</button>
          <Regras config={config} vendedores={vendedores} onSave={(regras, modo) => executar(async () => { await api.put("/charlie-leads/config", { distribuicao: { modo, regras } }); return "Regras gravadas."; })} />
        </form>
      )}

      {aba === "Automações" && (
        <form className="leads-card leads-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.target); executar(async () => { await api.put("/charlie-leads/config", { automacao: { ativa: form.get("ativa") === "on", hora: form.get("hora"), diasSemana: form.getAll("dia").map(Number), limiteConsultas: Number(form.get("limiteConsultas")), limiteLeads: Number(form.get("limiteLeads")), scoreMinimo: Number(form.get("scoreMinimo")), distribuir: form.get("distribuir") === "on", ufs: String(form.get("ufs") || "").split(",").map((item) => item.trim()).filter(Boolean), municipios: String(form.get("municipios") || "").split(",").map((item) => item.trim()).filter(Boolean), cnaes: String(form.get("cnaes") || "").split(",").map((item) => item.trim()).filter(Boolean) } }); return "Automação gravada. Ela permanece desligada enquanto a opção não for marcada."; }); }}>
          <p>A prospecção automática nasce desligada e só roda com integração ativa, consultas pagas e consultas automáticas autorizadas.</p>
          <label className="tray-check"><input name="ativa" type="checkbox" defaultChecked={config?.automacao?.ativa} /> Ativar execução diária</label>
          <label>Horário<input name="hora" defaultValue={config?.automacao?.hora || "07:00"} /></label>
          <div className="leads-actions">{DIAS.map(([valor, rotulo]) => <label className="tray-check" key={valor}><input name="dia" type="checkbox" value={valor} defaultChecked={(config?.automacao?.diasSemana || [1, 2, 3, 4, 5]).map(String).includes(valor)} /> {rotulo}</label>)}</div>
          <label>UFs<input name="ufs" placeholder="rj, sp" defaultValue={(config?.automacao?.ufs || []).join(", ")} /></label>
          <label>Cidades<input name="municipios" placeholder="rio de janeiro" defaultValue={(config?.automacao?.municipios || []).join(", ")} /></label>
          <label>CNAEs<input name="cnaes" placeholder="4120400" defaultValue={(config?.automacao?.cnaes || []).join(", ")} /></label>
          <label>Máximo de consultas<input name="limiteConsultas" type="number" defaultValue={config?.automacao?.limiteConsultas || 5} /></label>
          <label>Máximo de leads<input name="limiteLeads" type="number" defaultValue={config?.automacao?.limiteLeads || 20} /></label>
          <label>Pontuação mínima<input name="scoreMinimo" type="number" defaultValue={config?.automacao?.scoreMinimo || 50} /></label>
          <label className="tray-check"><input name="distribuir" type="checkbox" defaultChecked={config?.automacao?.distribuir} /> Distribuir após cadastrar</label>
          <p>Última execução: {config?.automacao?.ultimaExecucao ? new Date(config.automacao.ultimaExecucao).toLocaleString("pt-BR") : "nenhuma"}. Sem dia marcado, a rotina diária não dispara.</p>
          <div className="leads-actions">
            <button className="primary" disabled={ocupado} type="submit">Salvar automação</button>
            <button type="button" disabled={ocupado} onClick={() => executar(async () => { const dados = await api.post("/charlie-leads/automacao/executar"); return dados.executado ? `Execução concluída. Contatos novos: ${dados.criados}. Distribuídos: ${dados.distribuidos}.` : "A execução não rodou. Ela só parte com a automação ligada e as consultas pagas e automáticas autorizadas."; })}>Executar agora</button>
          </div>
          <p>Executar agora consulta a Casa dos Dados e pode consumir créditos.</p>
        </form>
      )}

      {aba === "Relatórios" && indicadores && (
        <div className="leads-card">
          <form key={JSON.stringify(recorte)} className="leads-filters" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.target); const cidade = form.get("cidade") || ""; const vendedorId = form.get("vendedorId") || ""; const segmento = form.get("segmento") || ""; aplicarRecorte({ desde: form.get("desde") || "", ate: form.get("ate") || "", vendedorId, uf: form.get("uf") || "", cidade, segmento, status: recorte.status || "", semCidade: cidade ? "" : recorte.semCidade || "", semVendedor: vendedorId ? "" : recorte.semVendedor || "", semSegmento: segmento ? "" : recorte.semSegmento || "" }); }}>
            <label>De<input name="desde" type="date" defaultValue={recorte.desde} /></label>
            <label>Até<input name="ate" type="date" defaultValue={recorte.ate} /></label>
            <label>Vendedor<select name="vendedorId" defaultValue={recorte.vendedorId}><option value="">Todos</option>{vendedores.map((vend) => <option key={vend.id} value={vend.id}>{vend.nome}</option>)}</select></label>
            <label>Estado<input name="uf" defaultValue={recorte.uf} /></label>
            <label>Cidade<input name="cidade" defaultValue={recorte.cidade} /></label>
            <label>Segmento<select name="segmento" defaultValue={recorte.segmento}><option value="">Todos</option>{(config?.segmentos || []).map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>
            <div className="leads-actions"><button className="primary" type="submit">Aplicar recorte</button><button type="button" onClick={() => aplicarRecorte(RECORTE_VAZIO)}>Limpar</button></div>
          </form>
          <p>Encontrados: {indicadores.total}. Qualificados: {indicadores.qualificados}. Descartados: {indicadores.descartados}. Convertidos: {indicadores.convertidos}. Conversão: {indicadores.conversao == null ? "sem base" : `${Math.round(indicadores.conversao * 100)}%`}.</p>
          <p>Faturamento vinculado: {moeda(indicadores.faturamentoVinculado)}. {indicadores.faturamentoObservacao || ""} Orçamentos localizados: {indicadores.orcamentos}. Pedidos localizados: {indicadores.pedidos}. Consultas pagas no período: {indicadores.consultasPagas}. Custo das consultas: {indicadores.custo == null ? "informe o custo por crédito para calcular" : moeda(indicadores.custo)}. Custo por lead: {moeda(indicadores.custoPorLead)}. Custo por convertido: {moeda(indicadores.custoPorConvertido)}.</p>
          <p>O potencial estimado não entra no faturamento. O recorte também atualiza o painel, o funil e a lista.</p>
          <div className="leads-actions"><button type="button" onClick={() => baixar("csv")}>Exportar CSV</button><button type="button" onClick={() => baixar("xlsx")}>Exportar Excel</button></div>
        </div>
      )}

      {aba === "Configurações" && config && (
        <form className="leads-card leads-form" onSubmit={salvarConfig}>
          <h3>Integrações · Casa dos Dados</h3>
          <label className="tray-check"><input name="ativa" type="checkbox" defaultChecked={config.ativa} /> Ativar integração</label>
          <label>API Key<input type="password" value={chave} placeholder={config.chaveConfigurada ? config.chaveMascarada : "Cole a chave"} onChange={(e) => setChave(e.target.value)} autoComplete="off" /></label>
          <label>Token do webhook<input type="password" value={token} placeholder={config.tokenWebhookConfigurado ? "Token já gravado" : "casadosdados-token"} onChange={(e) => setToken(e.target.value)} autoComplete="off" /></label>
          <p>Endereço deste acesso: {window.location.origin}/api/integracoes/casa-dos-dados/webhook. O portal deve enviar o cabeçalho casadosdados-token igual ao token gravado aqui. Se a Casa dos Dados estiver fora desta rede, use o endereço público do Dashboard. O evento não dispara consulta paga.</p>
          <h3>Fila do webhook</h3>
          <p>{Object.keys(config.fila?.contagem || {}).length ? Object.entries(config.fila.contagem).map(([chave, total]) => `${chave.replaceAll("_", " ")}: ${total}`).join(" · ") : "Nenhum evento recebido."}</p>
          {(config.fila?.recentes || []).map((item) => <p key={item.id}>{new Date(item.em).toLocaleString("pt-BR")} · {item.razaoSocial || item.cnpj} · {String(item.situacaoFila || "").replaceAll("_", " ")}</p>)}
          <button type="button" disabled={ocupado} onClick={() => executar(async () => { await api.post("/charlie-leads/fila/processar"); return "Fila reprocessada. Nenhuma consulta paga foi feita."; })}>Reprocessar fila</button>
          <p>Conexão: {config.chaveConfigurada ? "chave gravada" : "pendente"}. Saldo informado: {config.ultimoSaldo?.total ?? "ainda não consultado"}. Última consulta: {config.ultimaConsulta || "nenhuma"}. Última sincronização: {config.ultimaSincronizacao || "nenhuma"}.</p>
          <label>Limite diário<input name="limiteDiario" type="number" defaultValue={config.limiteDiario} /></label>
          <label>Limite mensal<input name="limiteMensal" type="number" defaultValue={config.limiteMensal} /></label>
          <label>Reserva mínima de créditos<input name="reservaMinima" type="number" defaultValue={config.reservaMinima} /></label>
          <label>Alerta a partir de % do limite mensal<input name="alertaPercentual" type="number" defaultValue={config.alertaPercentual} /></label>
          <label>Custo por crédito em reais<input name="custoPorCredito" defaultValue={config.custoPorCredito ?? ""} /></label>
          <label>Regiões atendidas<input name="regioesAtendidas" defaultValue={(config.regioesAtendidas || []).join(", ")} /></label>
          <label className="tray-check"><input name="bloquearAoAtingir" type="checkbox" defaultChecked={config.bloquearAoAtingir} /> Bloquear ao atingir o limite</label>
          <label className="tray-check"><input name="consultasPagasAutorizadas" type="checkbox" defaultChecked={config.consultasPagasAutorizadas} /> Autorizar consultas pagas</label>
          <label className="tray-check"><input name="autorizarLote" type="checkbox" defaultChecked={config.autorizarLote} /> Autorizar consultas em lote</label>
          <label className="tray-check"><input name="autorizarAutomatico" type="checkbox" defaultChecked={config.autorizarAutomatico} /> Autorizar consultas automáticas</label>
          <div className="leads-actions">
            <button className="primary" disabled={ocupado} type="submit">Salvar</button>
            <button type="button" disabled={ocupado} onClick={() => executar(async () => { const dados = await api.post("/charlie-leads/testar"); return `Conexão aceita. Saldo informado: ${dados.saldo}.`; })}>Testar conexão</button>
          </div>
          <h3>Histórico de erros</h3>
          {(config.erros || []).length ? config.erros.map((item) => <p key={item.id}>{new Date(item.em).toLocaleString("pt-BR")} · {item.operacao} · {item.mensagem}</p>) : <p>Nenhum erro registrado.</p>}
          <Segmentos config={config} onSave={(segmentos) => executar(async () => { await api.put("/charlie-leads/config", { segmentos }); return "Segmentos gravados. A sugestão de produto usa só o catálogo do ERP."; })} />
          <Pesos config={config} onSave={(pesos) => executar(async () => { await api.put("/charlie-leads/config", { pesos }); return "Pesos gravados. A pontuação continua determinística."; })} />
        </form>
      )}
    </section>
  );
}

function rotuloSegmento(item, segmentos) {
  const nome = (segmentos || []).find((segmento) => segmento.id === item.segmento)?.nome;
  if (nome && item.cnae) return `${nome} · ${item.cnae}`;
  return nome || item.cnae || item.segmento || "—";
}

function Tabela({ empresas, segmentos, vendedores, onChange, onErro, onSelect }) {
  async function agir(acao) {
    onErro?.("");
    try { await acao(); }
    catch (causa) { onErro?.(causa.message); }
  }
  if (!empresas.length) return <p>Nenhum registro neste recorte.</p>;
  return (
    <table className="leads-table">
      <thead><tr>{["Empresa", "CNPJ", "Cidade", "UF", "Segmento", "Telefone", "E-mail", "Potencial", "Status", "Vendedor", "Ações"].map((item) => <th key={item}>{item}</th>)}</tr></thead>
      <tbody>
        {empresas.map((item) => (
          <tr key={item.leadId || item.cnpj}>
            <td>{item.razaoSocial || "—"}</td>
            <td>{item.cnpj}</td>
            <td>{item.municipio || "—"}</td>
            <td>{item.uf || "—"}</td>
            <td>{rotuloSegmento(item, segmentos)}</td>
            <td>{item.telefone || "—"}</td>
            <td>{item.email || "—"}</td>
            <td><span className={`leads-badge ${classe(item.classificacao)}`}>{item.pontuacao ?? item.score ?? "—"}</span></td>
            <td>{item.statusLead || item.status || item.vinculo?.situacao || "não verificado"}</td>
            <td>{item.vendedorNome || "—"}</td>
            <td className="leads-actions">
              <button type="button" onClick={() => onSelect(item)}>Visualizar</button>
              {item.leadId ? <button type="button" onClick={() => agir(async () => { const dados = await api.post(`/charlie-leads/leads/${item.leadId}/analisar`); onSelect({ ...item, ...dados.lead, narrativa: dados.lead.narrativa }); })}>Analisar com Charlie</button> : null}
              {!item.leadId ? <button type="button" onClick={() => agir(async () => { await api.post("/charlie-leads/leads", item); onChange(); })}>Adicionar ao CRM</button> : null}
              {item.leadId ? <select defaultValue="" onChange={(event) => { const valor = event.target.value; if (!valor) return; agir(async () => { await api.post(`/charlie-leads/leads/${item.leadId}/vendedor`, { vendedorId: Number(valor), reatribuir: true }); onChange(); }); }}><option value="">Atribuir vendedor</option>{vendedores.map((vend) => <option key={vend.id} value={vend.id}>{vend.nome}</option>)}</select> : null}
              {item.leadId ? <button type="button" onClick={() => agir(async () => { await api.post(`/charlie-leads/leads/${item.leadId}/oportunidade`); onChange(); })}>Criar oportunidade</button> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Detalhe({ empresa, onClose, onAtualizar }) {
  const [status, setStatus] = useState(empresa.status || "NOVO");
  const [motivo, setMotivo] = useState(empresa.motivoPerda || "");
  const [nota, setNota] = useState("");
  const [canal, setCanal] = useState("telefone");
  const [resumo, setResumo] = useState("");
  const [retorno, setRetorno] = useState("");
  const [orcamento, setOrcamento] = useState("");
  const [pedido, setPedido] = useState("");
  const [falhaLocal, setFalhaLocal] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [rascunho, setRascunho] = useState("");
  const [produtos, setProdutos] = useState(empresa.produtosSugeridos || []);
  const [avisoProdutos, setAvisoProdutos] = useState("");
  const id = empresa.leadId || empresa.id;
  async function enviar(acao) {
    setOcupado(true); setFalhaLocal("");
    try { onAtualizar(await acao()); }
    catch (causa) { setFalhaLocal(causa.message); }
    finally { setOcupado(false); }
  }
  return (
    <aside className="leads-detail">
      <button type="button" onClick={onClose}>Fechar</button>
      <h3>{empresa.razaoSocial || empresa.cnpj}</h3>
      <p>{empresa.narrativa || (empresa.criterios || []).map((item) => item.motivo).join(" ") || "A análise ainda não foi executada."}</p>
      <p>Vínculo com o ERP: {empresa.vinculo?.existe ? `${empresa.vinculo.nome} (${empresa.vinculo.situacao})` : empresa.vinculo?.verificado ? "não cadastrado" : "cadastro não consultado"}.</p>
      {empresa.potencialEhEstimativa ? <p>Potencial estimado pelo ticket médio de clientes da mesma UF: {moeda(empresa.potencialEstimado)}. É uma estimativa, não faturamento. {empresa.potencialObservacao || ""}</p> : null}
      {id ? (
        <div className="leads-regra">
          <label>Situação
            <select value={status} onChange={(event) => setStatus(event.target.value)}>{STATUS.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select>
          </label>
          {status === "PERDIDO" ? <label>Motivo da perda<input value={motivo} onChange={(event) => setMotivo(event.target.value)} /></label> : null}
          <button type="button" disabled={ocupado} onClick={() => enviar(async () => (await api.patch(`/charlie-leads/leads/${id}`, { status, motivoPerda: motivo })).lead)}>Atualizar situação</button>
          <label>Observação<input value={nota} onChange={(event) => setNota(event.target.value)} /></label>
          <button type="button" disabled={ocupado || !nota.trim()} onClick={() => enviar(async () => { const dados = await api.patch(`/charlie-leads/leads/${id}`, { observacao: nota }); setNota(""); return dados.lead; })}>Registrar observação</button>
          <label>Canal
            <select value={canal} onChange={(event) => setCanal(event.target.value)}><option value="telefone">Telefone</option><option value="whatsapp">WhatsApp</option><option value="email">E-mail</option><option value="outro">Outro</option></select>
          </label>
          <label>Resumo do contato<input value={resumo} onChange={(event) => setResumo(event.target.value)} /></label>
          <button type="button" disabled={ocupado || !resumo.trim()} onClick={() => enviar(async () => { const dados = await api.patch(`/charlie-leads/leads/${id}`, { contato: { canal, resumo } }); setResumo(""); return dados.lead; })}>Registrar contato</button>
          <label>Retorno<input type="date" value={retorno} onChange={(event) => setRetorno(event.target.value)} /></label>
          <button type="button" disabled={ocupado || !retorno} onClick={() => enviar(async () => (await api.patch(`/charlie-leads/leads/${id}`, { retorno })).lead)}>Agendar retorno</button>
          <label>Orçamento<input value={orcamento} onChange={(event) => setOrcamento(event.target.value)} /></label>
          <button type="button" disabled={ocupado || !orcamento.trim()} onClick={() => enviar(async () => (await api.post(`/charlie-leads/leads/${id}/orcamento`, { numero: orcamento })).lead)}>Vincular orçamento</button>
          <label>Pedido<input value={pedido} onChange={(event) => setPedido(event.target.value)} /></label>
          <button type="button" disabled={ocupado || !pedido.trim()} onClick={() => enviar(async () => (await api.post(`/charlie-leads/leads/${id}/pedido`, { numero: pedido })).lead)}>Vincular pedido</button>
          <button type="button" disabled={ocupado} onClick={() => enviar(async () => { const dados = await api.post(`/charlie-leads/leads/${id}/produtos`); setProdutos(dados.produtos || []); setAvisoProdutos(dados.aviso || ""); return dados.lead || empresa; })}>Sugerir produtos do cadastro</button>
          {avisoProdutos ? <p>{avisoProdutos}</p> : null}
          {produtos.length ? <ul>{produtos.map((item) => <li key={item.codigo}>{item.codigo} · {item.nome}</li>)}</ul> : null}
          <button type="button" disabled={ocupado} onClick={() => enviar(async () => { const dados = await api.post(`/charlie-leads/leads/${id}/mensagem`); setRascunho(dados.rascunho || ""); return empresa; })}>Preparar mensagem</button>
          {rascunho ? <p>{rascunho}</p> : null}
        </div>
      ) : null}
      {falhaLocal ? <div className="error">{falhaLocal}</div> : null}
      <p>Registrar contato não envia mensagem. Orçamento e pedido só contam se já existirem no ERP.</p>
      {(empresa.historico || []).length ? <ul>{empresa.historico.slice().reverse().slice(0, 8).map((item, indice) => <li key={`${item.em}-${indice}`}>{new Date(item.em).toLocaleString("pt-BR")} · {item.acao}{item.para ? ` → ${item.para}` : ""}{item.numero ? ` ${item.numero}` : ""}{item.localizado === false ? " (não localizado)" : ""}</li>)}</ul> : null}
    </aside>
  );
}

function exportarTabela(empresas) {
  const cabecalho = ["Empresa", "CNPJ", "Cidade", "UF", "Segmento", "Telefone", "E-mail", "Potencial", "Status", "Vendedor"];
  const linhas = empresas.map((item) => [item.razaoSocial, item.cnpj, item.municipio, item.uf, item.cnae || item.segmento, item.telefone, item.email, item.pontuacao ?? item.score, item.statusLead || item.status || item.vinculo?.situacao, item.vendedorNome]);
  const csv = [cabecalho, ...linhas].map((linha) => linha.map((valor) => `"${String(valor ?? "").replaceAll("\"", "\"\"")}"`).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = "charlie-leads-pesquisa.csv"; link.click();
  URL.revokeObjectURL(url);
}

function regraVazia() {
  return { vendedorId: "", ufs: "", cidades: "", segmentos: "", prioridade: "0", ativo: true };
}

function Regras({ config, vendedores, onSave }) {
  const [modo, setModo] = useState(config?.distribuicao?.modo || "manual");
  const [regras, setRegras] = useState(() => (config?.distribuicao?.regras || []).map((regra) => ({
    vendedorId: regra.vendedorId ? String(regra.vendedorId) : "",
    ufs: (regra.ufs || []).join(", "),
    cidades: (regra.cidades || []).join(", "),
    segmentos: (regra.segmentos || []).join(", "),
    prioridade: String(regra.prioridade || 0),
    ativo: regra.ativo !== false,
  })));
  const alterar = (indice, campo, valor) => setRegras((atual) => atual.map((regra, posicao) => posicao === indice ? { ...regra, [campo]: valor } : regra));
  return (
    <div className="leads-regras">
      <label>Modo
        <select value={modo} onChange={(event) => setModo(event.target.value)}>
          <option value="manual">Manual</option>
          <option value="automatica">Automática</option>
        </select>
      </label>
      {regras.map((regra, indice) => (
        <div className="leads-regra" key={`${regra.vendedorId}-${indice}`}>
          <label>Vendedor
            <select value={regra.vendedorId} onChange={(event) => alterar(indice, "vendedorId", event.target.value)}>
              <option value="">Selecione</option>
              {vendedores.map((vend) => <option key={vend.id} value={vend.id}>{vend.nome}</option>)}
            </select>
          </label>
          <label>UFs<input value={regra.ufs} placeholder="RJ, SP" onChange={(event) => alterar(indice, "ufs", event.target.value)} /></label>
          <label>Cidades<input value={regra.cidades} placeholder="Rio de Janeiro" onChange={(event) => alterar(indice, "cidades", event.target.value)} /></label>
          <label>Segmentos<input value={regra.segmentos} placeholder={(config?.segmentos || []).map((item) => item.id).join(", ")} onChange={(event) => alterar(indice, "segmentos", event.target.value)} /></label>
          <label>Prioridade<input type="number" value={regra.prioridade} onChange={(event) => alterar(indice, "prioridade", event.target.value)} /></label>
          <label className="tray-check"><input type="checkbox" checked={regra.ativo} onChange={(event) => alterar(indice, "ativo", event.target.checked)} /> Ativa</label>
          <button type="button" onClick={() => setRegras((atual) => atual.filter((_, posicao) => posicao !== indice))}>Remover</button>
        </div>
      ))}
      <div className="leads-actions">
        <button type="button" onClick={() => setRegras((atual) => [...atual, regraVazia()])}>Adicionar regra</button>
        <button type="button" onClick={() => onSave(regras.filter((regra) => regra.vendedorId).map((regra) => ({
          vendedorId: Number(regra.vendedorId),
          nome: vendedores.find((vend) => String(vend.id) === String(regra.vendedorId))?.nome || "",
          ufs: partir(regra.ufs).map((uf) => uf.toUpperCase()),
          cidades: partir(regra.cidades),
          segmentos: partir(regra.segmentos),
          prioridade: Number(regra.prioridade) || 0,
          ativo: regra.ativo,
        })), modo)}>Salvar regras</button>
      </div>
    </div>
  );
}

const PESOS = [["cnae", "CNAE"], ["local", "Localização"], ["porte", "Porte"], ["historico", "Histórico semelhante"], ["contato", "Contato"], ["perfil", "Perfil dos clientes"], ["capital", "Capital social"]];

function Segmentos({ config, onSave }) {
  const [itens, setItens] = useState(() => (config?.segmentos || []).map((item) => ({
    id: item.id,
    nome: item.nome || "",
    cnaes: (item.cnaes || []).join(", "),
    termos: (item.termos || []).join(", "),
    termosProduto: (item.termosProduto || []).join(", "),
  })));
  const alterar = (indice, campo, valor) => setItens((atual) => atual.map((item, posicao) => posicao === indice ? { ...item, [campo]: valor } : item));
  return (
    <div className="leads-regras">
      <h3>Segmentos e produtos</h3>
      <p>Os termos de produto só sugerem itens encontrados no cadastro do ERP. O CNAE não comprova intenção de compra.</p>
      {itens.map((item, indice) => (
        <div className="leads-regra" key={item.id || indice}>
          <label>Nome<input value={item.nome} onChange={(event) => alterar(indice, "nome", event.target.value)} /></label>
          <label>CNAEs<input value={item.cnaes} onChange={(event) => alterar(indice, "cnaes", event.target.value)} /></label>
          <label>Termos da busca<input value={item.termos} onChange={(event) => alterar(indice, "termos", event.target.value)} /></label>
          <label>Termos de produto<input value={item.termosProduto} placeholder="cabo, disjuntor" onChange={(event) => alterar(indice, "termosProduto", event.target.value)} /></label>
          <button type="button" onClick={() => setItens((atual) => atual.filter((_, posicao) => posicao !== indice))}>Remover</button>
        </div>
      ))}
      <div className="leads-actions">
        <button type="button" onClick={() => setItens((atual) => [...atual, { id: "", nome: "", cnaes: "", termos: "", termosProduto: "" }])}>Adicionar segmento</button>
        <button type="button" onClick={() => onSave(itens.filter((item) => item.nome.trim()).map((item) => ({ id: item.id || undefined, nome: item.nome, cnaes: partir(item.cnaes), termos: partir(item.termos), termosProduto: partir(item.termosProduto) })))}>Salvar segmentos</button>
      </div>
    </div>
  );
}

function Pesos({ config, onSave }) {
  const [valores, setValores] = useState(() => Object.fromEntries(PESOS.map(([chave]) => [chave, config?.pesos?.[chave] ?? ""])));
  return (
    <div className="leads-regras">
      <h3>Pesos da pontuação</h3>
      <div className="leads-regra">
        {PESOS.map(([chave, rotulo]) => (
          <label key={chave}>{rotulo}<input type="number" min="0" max="100" value={valores[chave]} onChange={(event) => setValores({ ...valores, [chave]: event.target.value })} /></label>
        ))}
      </div>
      <button type="button" onClick={() => onSave(valores)}>Salvar pesos</button>
    </div>
  );
}
