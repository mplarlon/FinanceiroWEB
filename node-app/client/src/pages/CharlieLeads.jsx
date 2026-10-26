import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";

const ABAS = ["Painel", "Pesquisa", "Leads", "Funil", "Distribuição", "Automações", "Relatórios", "Configurações"];
const STATUS = ["NOVO", "QUALIFICADO", "ATRIBUIDO", "CONTATO_PENDENTE", "EM_CONTATO", "INTERESSADO", "ORCAMENTO", "NEGOCIACAO", "CONVERTIDO", "PERDIDO", "DESCARTADO"];
const vazio = { uf: "RJ", municipio: "", cnae: "4120400", situacao: "ATIVA", limite: 10, pagina: 1, comTelefone: false, comEmail: false, erp: "" };

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
          {itens.map((item) => (
            <button key={item.rotulo} type="button" title={`${item.rotulo}: ${item.total}`} onClick={() => onPick?.(item.rotulo)}>
              <span>{item.rotulo}</span>
              <i style={{ width: `${Math.max(6, (item.total / maior) * 100)}%` }} />
              <b>{item.total}</b>
            </button>
          ))}
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
  const [selecionado, setSelecionado] = useState(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [chave, setChave] = useState("");
  const [token, setToken] = useState("");

  async function carregar() {
    const [conf, ind, lista, vend] = await Promise.all([
      api.get("/charlie-leads/config"),
      api.get("/charlie-leads/indicadores"),
      api.get("/charlie-leads/leads"),
      api.get("/charlie-leads/vendedores").catch(() => ({ vendedores: [] })),
    ]);
    setConfig(conf.config);
    setIndicadores(ind.indicadores);
    setLeads(lista.leads || []);
    setVendedores(vend.vendedores || []);
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
        cnae: filtros.cnae ? [filtros.cnae] : [],
        situacao: filtros.situacao ? [filtros.situacao] : [],
        limite: Number(filtros.limite) || 10,
        pagina: Number(filtros.pagina) || 1,
        comTelefone: filtros.comTelefone,
        comEmail: filtros.comEmail,
        jaCadastradas: filtros.erp === "sim",
        naoCadastradas: filtros.erp === "nao",
      };
      const dados = await api.post("/charlie-leads/pesquisar", corpo);
      setPesquisa(dados.pesquisa);
      return dados.pesquisa?.reutilizado ? "Pesquisa reutilizada, sem novo consumo." : "Pesquisa concluída com o retorno da Casa dos Dados.";
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
    const resposta = await fetch(`/api/charlie-leads/exportar?formato=${formato}`);
    if (!resposta.ok) { setErro("Não foi possível exportar."); return; }
    const blob = await resposta.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `charlie-leads.${formato === "xlsx" ? "xlsx" : "csv"}`; link.click();
    URL.revokeObjectURL(url);
  }

  const pendente = config && !config.chaveConfigurada;
  const pago = config?.consultasPagasAutorizadas && config?.ativa && config?.chaveConfigurada;

  return (
    <section className="leads-page">
      <header>
        <h2>CHARLIE LEADS</h2>
        <p className="sub">Inteligência Comercial e Prospecção Automatizada</p>
      </header>
      {pendente ? <div className="leads-banner">Configuração pendente. Informe a API Key em Configurações. Nenhuma consulta paga será feita antes disso.</div> : null}
      {config && !pago ? <div className="leads-banner">As consultas pagas seguem desativadas até um administrador autorizar o uso.</div> : null}
      {erro ? <div className="error">{erro}</div> : null}
      {aviso ? <div className="leads-banner">{aviso}</div> : null}
      <nav className="leads-tabs">{ABAS.map((item) => <button className={aba === item ? "ativo" : ""} key={item} type="button" onClick={() => setAba(item)}>{item}</button>)}</nav>

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
            <Barras titulo="Evolução dos leads" itens={indicadores.evolucao} />
            <Barras titulo="Leads por cidade" itens={indicadores.porCidade} onPick={(cidade) => { setAba("Leads"); setLeads((atual) => atual.filter((lead) => lead.municipio === cidade)); }} />
            <Barras titulo="Leads por segmento" itens={indicadores.porSegmento} />
            <Barras titulo="Leads por vendedor" itens={indicadores.porVendedor} />
            <Barras titulo="Origem dos leads" itens={indicadores.porOrigem} />
            <Barras titulo="Conversão por período" itens={indicadores.conversaoPeriodo} />
            <Barras titulo="Desempenho da prospecção" itens={indicadores.desempenho} />
          </div>
        </>
      )}

      {aba === "Pesquisa" && (
        <form className="leads-card leads-filters" onSubmit={pesquisar}>
          <label>Estado<input value={filtros.uf} onChange={(e) => setFiltros({ ...filtros, uf: e.target.value })} /></label>
          <label>Cidade<input value={filtros.municipio} onChange={(e) => setFiltros({ ...filtros, municipio: e.target.value })} /></label>
          <label>CNAE principal<input value={filtros.cnae} onChange={(e) => setFiltros({ ...filtros, cnae: e.target.value })} /></label>
          <label>Situação<select value={filtros.situacao} onChange={(e) => setFiltros({ ...filtros, situacao: e.target.value })}>{["ATIVA", "BAIXADA", "INAPTA", "NULA", "SUSPENSA"].map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Limite<input type="number" min="1" max="1000" value={filtros.limite} onChange={(e) => setFiltros({ ...filtros, limite: e.target.value })} /></label>
          <label>Página<input type="number" min="1" value={filtros.pagina} onChange={(e) => setFiltros({ ...filtros, pagina: e.target.value })} /></label>
          <label>No ERP<select value={filtros.erp} onChange={(e) => setFiltros({ ...filtros, erp: e.target.value })}><option value="">Todos</option><option value="sim">Já cadastradas</option><option value="nao">Ainda não cadastradas</option></select></label>
          <label className="tray-check"><input type="checkbox" checked={filtros.comTelefone} onChange={(e) => setFiltros({ ...filtros, comTelefone: e.target.checked })} /> Com telefone</label>
          <label className="tray-check"><input type="checkbox" checked={filtros.comEmail} onChange={(e) => setFiltros({ ...filtros, comEmail: e.target.checked })} /> Com e-mail</label>
          <div className="leads-actions"><button className="primary" disabled={ocupado} type="submit">{ocupado ? "Consultando…" : "Pesquisar"}</button></div>
          {pesquisa ? <p>{pesquisa.reutilizado ? "Resultado reutilizado. " : ""}{pesquisa.empresas?.length || 0} empresa(s) nesta página{pesquisa.total != null ? ` · total informado pela API: ${pesquisa.total}` : ""}.</p> : null}
          <div className="leads-scroll"><Tabela empresas={pesquisa?.empresas || []} vendedores={vendedores} onChange={carregar} onSelect={setSelecionado} /></div>
          {selecionado ? <Detalhe empresa={selecionado} onClose={() => setSelecionado(null)} /> : null}
        </form>
      )}

      {aba === "Leads" && <div className="leads-scroll"><Tabela empresas={leads.map((lead) => ({ ...lead, pontuacao: lead.score, classificacao: lead.classificacao, vinculo: lead.vinculo, leadId: lead.id }))} vendedores={vendedores} onChange={carregar} onSelect={setSelecionado} />{selecionado ? <Detalhe empresa={selecionado} onClose={() => setSelecionado(null)} /> : null}</div>}

      {aba === "Funil" && (
        <div className="leads-funil">{(indicadores?.funil || []).map((item) => <div key={item.status}><b>{item.status}</b><span>{item.total}</span></div>)}</div>
      )}

      {aba === "Distribuição" && (
        <form className="leads-card leads-form" onSubmit={(event) => { event.preventDefault(); executar(async () => { const dados = await api.post("/charlie-leads/distribuir", { quantidade: Number(new FormData(event.target).get("quantidade")) || 50 }); return `${dados.quantidade} lead(s) distribuído(s).`; }); }}>
          <p>Modo atual: {config?.distribuicao?.modo || "manual"}. A distribuição automática só atribui leads sem vendedor e exige regras já gravadas.</p>
          <label>Quantidade<input name="quantidade" type="number" min="1" defaultValue="50" /></label>
          <button className="primary" disabled={ocupado} type="submit">Distribuir</button>
          <Regras config={config} onSave={(regras, modo) => executar(async () => { await api.put("/charlie-leads/config", { distribuicao: { modo, regras } }); return "Regras gravadas."; })} />
        </form>
      )}

      {aba === "Automações" && (
        <form className="leads-card leads-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.target); executar(async () => { await api.put("/charlie-leads/config", { automacao: { ativa: form.get("ativa") === "on", hora: form.get("hora"), limiteConsultas: Number(form.get("limiteConsultas")), limiteLeads: Number(form.get("limiteLeads")), scoreMinimo: Number(form.get("scoreMinimo")), distribuir: form.get("distribuir") === "on", ufs: String(form.get("ufs") || "").split(",").map((item) => item.trim()).filter(Boolean), cnaes: String(form.get("cnaes") || "").split(",").map((item) => item.trim()).filter(Boolean) } }); return "Automação gravada. Ela permanece desligada enquanto a opção não for marcada."; }); }}>
          <p>A prospecção automática nasce desligada e só roda com integração ativa, consultas pagas e consultas automáticas autorizadas.</p>
          <label className="tray-check"><input name="ativa" type="checkbox" defaultChecked={config?.automacao?.ativa} /> Ativar execução diária</label>
          <label>Horário<input name="hora" defaultValue={config?.automacao?.hora || "07:00"} /></label>
          <label>UFs<input name="ufs" placeholder="rj, sp" defaultValue={(config?.automacao?.ufs || []).join(", ")} /></label>
          <label>CNAEs<input name="cnaes" placeholder="4120400" defaultValue={(config?.automacao?.cnaes || []).join(", ")} /></label>
          <label>Máximo de consultas<input name="limiteConsultas" type="number" defaultValue={config?.automacao?.limiteConsultas || 5} /></label>
          <label>Máximo de leads<input name="limiteLeads" type="number" defaultValue={config?.automacao?.limiteLeads || 20} /></label>
          <label>Pontuação mínima<input name="scoreMinimo" type="number" defaultValue={config?.automacao?.scoreMinimo || 50} /></label>
          <label className="tray-check"><input name="distribuir" type="checkbox" defaultChecked={config?.automacao?.distribuir} /> Distribuir após cadastrar</label>
          <button className="primary" disabled={ocupado} type="submit">Salvar automação</button>
        </form>
      )}

      {aba === "Relatórios" && indicadores && (
        <div className="leads-card">
          <p>Faturamento vinculado: {moeda(indicadores.faturamentoVinculado)}. Orçamentos localizados: {indicadores.orcamentos}. Pedidos localizados: {indicadores.pedidos}. Custo das consultas: {indicadores.custo == null ? "informe o custo por crédito para calcular" : moeda(indicadores.custo)}.</p>
          <p>O potencial estimado não entra no faturamento.</p>
          <div className="leads-actions"><button type="button" onClick={() => baixar("csv")}>Exportar CSV</button><button type="button" onClick={() => baixar("xlsx")}>Exportar Excel</button></div>
        </div>
      )}

      {aba === "Configurações" && config && (
        <form className="leads-card leads-form" onSubmit={salvarConfig}>
          <h3>Integrações · Casa dos Dados</h3>
          <label className="tray-check"><input name="ativa" type="checkbox" defaultChecked={config.ativa} /> Ativar integração</label>
          <label>API Key<input type="password" value={chave} placeholder={config.chaveConfigurada ? config.chaveMascarada : "Cole a chave"} onChange={(e) => setChave(e.target.value)} autoComplete="off" /></label>
          <label>Token do webhook<input type="password" value={token} placeholder={config.tokenWebhookConfigurado ? "Token já gravado" : "casadosdados-token"} onChange={(e) => setToken(e.target.value)} autoComplete="off" /></label>
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
        </form>
      )}
    </section>
  );
}

function Tabela({ empresas, vendedores, onChange, onSelect }) {
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
            <td>{item.cnae || item.segmento || "—"}</td>
            <td>{item.telefone || "—"}</td>
            <td>{item.email || "—"}</td>
            <td><span className={`leads-badge ${classe(item.classificacao)}`}>{item.pontuacao ?? item.score ?? "—"}</span></td>
            <td>{item.statusLead || item.status || item.vinculo?.situacao || "não verificado"}</td>
            <td>{item.vendedorNome || "—"}</td>
            <td className="leads-actions">
              <button type="button" onClick={() => onSelect(item)}>Visualizar</button>
              {item.leadId ? <button type="button" onClick={async () => { const dados = await api.post(`/charlie-leads/leads/${item.leadId}/analisar`); onSelect({ ...item, ...dados.lead, narrativa: dados.lead.narrativa }); }}>Analisar com Charlie</button> : null}
              {!item.leadId ? <button type="button" onClick={async () => { await api.post("/charlie-leads/leads", item); onChange(); }}>Adicionar ao CRM</button> : null}
              {item.leadId ? <select defaultValue="" onChange={async (event) => { if (!event.target.value) return; await api.post(`/charlie-leads/leads/${item.leadId}/vendedor`, { vendedorId: Number(event.target.value), reatribuir: true }); onChange(); }}><option value="">Atribuir vendedor</option>{vendedores.map((vend) => <option key={vend.id} value={vend.id}>{vend.nome}</option>)}</select> : null}
              {item.leadId ? <button type="button" onClick={async () => { await api.post(`/charlie-leads/leads/${item.leadId}/oportunidade`); onChange(); }}>Criar oportunidade</button> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Detalhe({ empresa, onClose }) {
  return (
    <aside className="leads-detail">
      <button type="button" onClick={onClose}>Fechar</button>
      <h3>{empresa.razaoSocial || empresa.cnpj}</h3>
      <p>{empresa.narrativa || (empresa.criterios || []).map((item) => item.motivo).join(" ") || "A análise ainda não foi executada."}</p>
      <p>Vínculo com o ERP: {empresa.vinculo?.existe ? `${empresa.vinculo.nome} (${empresa.vinculo.situacao})` : empresa.vinculo?.verificado ? "não cadastrado" : "cadastro não consultado"}.</p>
      {empresa.potencialEhEstimativa ? <p>Potencial estimado pelo ticket médio de clientes da mesma UF: {moeda(empresa.potencialEstimado)}. É uma estimativa, não faturamento.</p> : null}
    </aside>
  );
}

function Regras({ config, onSave }) {
  const [texto, setTexto] = useState(JSON.stringify(config?.distribuicao?.regras || [], null, 2));
  const [invalido, setInvalido] = useState("");
  return (
    <label>Regras em JSON
      <textarea rows={8} value={texto} onChange={(event) => setTexto(event.target.value)} />
      {invalido ? <span>{invalido}</span> : null}
      <button type="button" onClick={() => { try { onSave(JSON.parse(texto), config?.distribuicao?.modo || "manual"); setInvalido(""); } catch { setInvalido("O JSON das regras está inválido."); } }}>Salvar regras</button>
    </label>
  );
}
