import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

const moeda = (valor) => valor == null ? "não informado" : Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function mensagemVisivel(texto) {
  const bruto = String(texto || "");
  if (/TRIAL_CLIENT_ITEM_CREATE_NOT_ALLOWED|only create Sandbox \(Pluggy Bank\)/i.test(bruto)) {
    return "A aplicação da Pluggy está no plano trial e só conecta o banco de teste Pluggy Bank. Banco real, como o Bradesco, fica bloqueado até a Pluggy liberar conexões de produção. Ative o plano no dashboard da Pluggy e grave de novo as credenciais, no ambiente Produção.";
  }
  if (/clientId must be a UUID/i.test(bruto)) {
    return "O CLIENT_ID da Pluggy precisa ser só o UUID, com cinco blocos separados por hífen. Não cole o rótulo Client Secret no mesmo campo.";
  }
  return bruto;
}

function carregarScript(src) {
  return new Promise((resolve, reject) => {
    const existente = document.querySelector(`script[src="${src}"]`);
    if (existente) return resolve();
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Não foi possível carregar o widget do provedor."));
    document.body.appendChild(script);
  });
}

async function abrirWidget(token) {
  await carregarScript(token.widgetScript);
  return new Promise((resolve, reject) => {
    if (token.provedor === "belvo") {
      if (!window.belvoSDK?.createWidget) return reject(new Error("O widget da Belvo não ficou disponível."));
      window.belvoSDK.createWidget(token.connectToken, {
        callback: (link) => resolve({ id: link }),
        onExit: () => reject(new Error("A autorização foi cancelada.")),
        onEvent: () => {},
      }).build();
      return;
    }
    if (!window.PluggyConnect) return reject(new Error("O widget da Pluggy não ficou disponível."));
    const widget = new window.PluggyConnect({
      connectToken: token.connectToken,
      includeSandbox: Boolean(token.includeSandbox),
      ...(token.conectorId ? { connectorIds: [Number(token.conectorId)], selectedConnectorId: Number(token.conectorId) } : {}),
      onSuccess: (item) => resolve({ id: item?.item?.id || item?.id }),
      onError: (erro) => reject(new Error(mensagemVisivel(erro?.message || erro?.codeDescription || "Falha no consentimento."))),
    });
    widget.init();
  });
}

export default function OpenFinance() {
  const [empresas, setEmpresas] = useState([]);
  const [empresa, setEmpresa] = useState("");
  const [estado, setEstado] = useState(null);
  const [painel, setPainel] = useState(null);
  const [instituicoes, setInstituicoes] = useState([]);
  const [contasErp, setContasErp] = useState([]);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [filtros, setFiltros] = useState({ banco: "", conta: "", de: "", ate: "", natureza: "", status: "" });
  const [credenciais, setCredenciais] = useState({ provedor: "pluggy", ambiente: "sandbox", clientId: "", clientSecret: "", termosUrl: "" });
  const [trocar, setTrocar] = useState(false);
  const [belvo, setBelvo] = useState({ cpf: "", nome: "", cnpj: "", razao: "" });

  async function carregar(id = empresa) {
    const atual = await api.get("/open-finance/estado", { empresa: id || undefined });
    setEstado(atual);
    if (!id) return;
    const dados = await api.get("/open-finance/painel", { empresa: id, ...filtros });
    setPainel(dados);
  }

  useEffect(() => {
    api.get("/open-finance/estado").then(setEstado).catch((falha) => setErro(mensagemVisivel(falha.message)));
    api.get("/open-finance/empresas").then((dados) => {
      setEmpresas(dados.empresas || []);
      if (dados.empresas?.[0]) setEmpresa(String(dados.empresas[0].id));
    }).catch((falha) => setErro(mensagemVisivel(falha.message)));
    api.get("/open-finance/contas-erp").then((dados) => setContasErp(dados.contas || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!empresa) return;
    carregar(empresa).catch((falha) => setErro(mensagemVisivel(falha.message)));
  }, [empresa]);

  async function salvarCredenciais(event) {
    event.preventDefault();
    setOcupado(true);
    setErro("");
    try {
      const resposta = await api.put("/open-finance/configuracao", credenciais);
      setAviso(`${resposta.aviso} Segredo do webhook: ${resposta.webhookSecretInicial}`);
      setCredenciais((atual) => ({ ...atual, clientSecret: "" }));
      setTrocar(false);
      await carregar(empresa);
    } catch (falha) {
      setErro(mensagemVisivel(falha.message));
    } finally {
      setOcupado(false);
    }
  }

  async function conectar(event) {
    event.preventDefault();
    setOcupado(true);
    setErro("");
    try {
      const instituicao = instituicoes.find((item) => String(item.id) === event.target.instituicao.value);
      const token = await api.post("/open-finance/conexoes", { empresa: Number(empresa), conectorId: instituicao?.id, ...belvo, termosUrl: credenciais.termosUrl });
      const item = await abrirWidget({ ...token, conectorId: instituicao?.id });
      if (!item.id) throw new Error("O provedor não devolveu o identificador da conexão.");
      await api.post("/open-finance/conexoes/confirmar", { empresa: Number(empresa), itemId: item.id, instituicao: instituicao?.nome, conectorId: instituicao?.id });
      await carregar(empresa);
    } catch (falha) {
      setErro(mensagemVisivel(falha.message));
    } finally {
      setOcupado(false);
    }
  }

  async function acao(caminho, corpo = {}) {
    setOcupado(true);
    setErro("");
    try {
      await api.post(caminho, { empresa: Number(empresa), ...corpo });
      await carregar(empresa);
    } catch (falha) {
      setErro(mensagemVisivel(falha.message));
    } finally {
      setOcupado(false);
    }
  }

  const resumo = painel?.resumo;
  return (
    <div className="open-finance-page">
      {erro && <div className="error">{erro}</div>}
      {aviso && <div className="open-finance-aviso">{aviso}</div>}
      <section className="panel">
        <span className="section-kicker">FINANCEIRO</span>
        <h2>Open Finance</h2>
        <p>A conexão usa o consentimento oficial do provedor. O ERP não pede nem guarda senha bancária. A baixa automática permanece desligada até um administrador homologar.</p>
        <div className="open-finance-filtros">
          <label>Empresa
            <select value={empresa} onChange={(event) => setEmpresa(event.target.value)}>
              <option value="">Selecione</option>
              {empresas.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
            </select>
          </label>
          <label>Modo
            <strong>{estado?.politica?.modo || "sugestão"}</strong>
          </label>
          <label>Provedor
            <strong>{estado?.provedor ? `${estado.provedor} · ${estado.ambiente}` : "não configurado"}</strong>
          </label>
        </div>
      </section>

      {(!estado?.configurado || trocar) && (
        <form className="panel import-form" onSubmit={salvarCredenciais}>
          <h2>Configurar provedor</h2>
          <p>No Dashboard da Pluggy, em Applications, copie só o CLIENT_ID — o código com cinco blocos e hífens — e o CLIENT_SECRET. Não cole o rótulo Client Secret no primeiro campo, nem a API key. Ambiente sandbox não movimenta conta real.</p>
          <label>Provedor
            <select value={credenciais.provedor} onChange={(event) => setCredenciais({ ...credenciais, provedor: event.target.value })}>
              <option value="pluggy">Pluggy</option>
              <option value="belvo">Belvo</option>
            </select>
          </label>
          <label>Ambiente
            <select value={credenciais.ambiente} onChange={(event) => setCredenciais({ ...credenciais, ambiente: event.target.value })}>
              <option value="sandbox">Sandbox</option>
              <option value="producao">Produção</option>
            </select>
          </label>
          <label>CLIENT_ID<input value={credenciais.clientId} onChange={(event) => setCredenciais({ ...credenciais, clientId: event.target.value })} required autoComplete="off" /></label>
          <label>CLIENT_SECRET<input type="password" value={credenciais.clientSecret} onChange={(event) => setCredenciais({ ...credenciais, clientSecret: event.target.value })} required autoComplete="new-password" /></label>
          <label>URL dos termos<input value={credenciais.termosUrl} onChange={(event) => setCredenciais({ ...credenciais, termosUrl: event.target.value })} placeholder="Obrigatória para a Belvo" /></label>
          <button className="primary" disabled={ocupado}>Gravar credenciais</button>
        </form>
      )}

      {estado?.configurado && !trocar && (
        <form className="panel import-form" onSubmit={conectar}>
          <h2>Conectar banco</h2>
          {estado.provedor === "pluggy" && estado.ambiente === "sandbox" && (
            <p>Sandbox da Pluggy, na mesma API de produção. Escolha Pluggy Bank e entre com o usuário <strong>user-ok</strong> e a senha <strong>password-ok</strong>. Se pedir token, use <strong>123456</strong>. No conector Sandbox Open Finance, o CPF de teste é 761.092.776-73 e o login do banco fictício é o mesmo. A coleta pode levar cerca de um minuto; se o saldo continuar zerado, use Sincronizar.</p>
          )}
          <button type="button" onClick={() => api.get("/open-finance/instituicoes").then((dados) => setInstituicoes(dados.instituicoes || [])).catch((falha) => { setErro(mensagemVisivel(falha.message)); if (/client keys are invalid/i.test(falha.message)) setTrocar(true); })}>Listar instituições</button>
          <button type="button" onClick={() => { setTrocar(true); setCredenciais((atual) => ({ ...atual, ambiente: "sandbox", clientId: "", clientSecret: "" })); }}>Trocar credenciais</button>
          <label>Instituição
            <select name="instituicao" required>
              <option value="">Selecione</option>
              {instituicoes.map((item) => <option key={item.id} value={item.id}>{item.nome}{item.saude ? ` · ${item.saude}` : ""}</option>)}
            </select>
          </label>
          {estado.provedor === "belvo" && (
            <>
              <label>CPF do representante<input value={belvo.cpf} onChange={(event) => setBelvo({ ...belvo, cpf: event.target.value })} required /></label>
              <label>Nome do representante<input value={belvo.nome} onChange={(event) => setBelvo({ ...belvo, nome: event.target.value })} required /></label>
              <label>CNPJ<input value={belvo.cnpj} onChange={(event) => setBelvo({ ...belvo, cnpj: event.target.value })} required /></label>
              <label>Razão social<input value={belvo.razao} onChange={(event) => setBelvo({ ...belvo, razao: event.target.value })} required /></label>
            </>
          )}
          <button className="primary" disabled={ocupado || !empresa}>Iniciar consentimento</button>
        </form>
      )}

      {resumo && (
        <section className="finance-summary">
          <article><small>Saldo bancário</small><strong>{moeda(resumo.saldos?.reduce((total, item) => total + Number(item.saldoBanco || 0), 0))}</strong></article>
          <article><small>Saldo no ERP</small><strong>{moeda(resumo.saldos?.reduce((total, item) => total + Number(item.saldoErp || 0), 0))}</strong></article>
          <article><small>Diferença</small><strong>{moeda(resumo.saldos?.reduce((total, item) => total + Number(item.diferenca || 0), 0))}</strong></article>
          <article><small>Importadas</small><strong>{resumo.importadas}</strong></article>
          <article><small>Automáticas</small><strong>{resumo.conciliadasAutomaticamente}</strong></article>
          <article><small>Manuais</small><strong>{resumo.conciliadasManualmente}</strong></article>
          <article><small>Pendentes</small><strong>{resumo.pendentes}</strong></article>
          <article><small>Divergências</small><strong>{resumo.divergencias}</strong></article>
          <article><small>Automação</small><strong>{resumo.percentualAutomacao == null ? "—" : `${resumo.percentualAutomacao}%`}</strong></article>
          <article><small>Última sincronização</small><strong>{resumo.ultimaSincronizacao ? new Date(resumo.ultimaSincronizacao).toLocaleString("pt-BR") : "—"}</strong></article>
        </section>
      )}

      <section className="panel">
        <h2>Conexões</h2>
        <table>
          <thead><tr><th>Instituição</th><th>Status</th><th>Consentimento</th><th>Última sincronização</th><th></th></tr></thead>
          <tbody>
            {(painel?.conexoes || []).map((conexao) => (
              <tr key={conexao.id}>
                <td>{conexao.instituicao}</td>
                <td>{conexao.status}</td>
                <td>{conexao.consentimentoExpira ? new Date(conexao.consentimentoExpira).toLocaleDateString("pt-BR") : "sem expiração informada"}</td>
                <td>{conexao.ultimaSync ? new Date(conexao.ultimaSync).toLocaleString("pt-BR") : "—"}</td>
                <td>
                  <button type="button" disabled={ocupado} onClick={() => acao(`/open-finance/conexoes/${conexao.id}/sincronizar`, { de: filtros.de, ate: filtros.ate })}>Sincronizar</button>
                  <button type="button" disabled={ocupado} onClick={async () => { const token = await api.post(`/open-finance/conexoes/${conexao.id}/renovar`, { empresa: Number(empresa) }); await abrirWidget(token); await api.post("/open-finance/conexoes/confirmar", { empresa: Number(empresa), itemId: conexao.itemExterno }); await carregar(empresa); }}>Renovar</button>
                  <button type="button" disabled={ocupado} onClick={() => api.del(`/open-finance/conexoes/${conexao.id}`, { empresa: Number(empresa) }).then(() => carregar(empresa)).catch((falha) => setErro(mensagemVisivel(falha.message)))}>Desconectar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2>Contas para vincular</h2>
        {(painel?.contas || []).map((conta) => (
          <form key={conta.id} className="open-finance-filtros" onSubmit={(event) => {
            event.preventDefault();
            const [cdbanco, agencia, numconta] = event.target.erp.value.split("|");
            acao(`/open-finance/contas/${conta.id}/vincular`, { cdbanco, agencia, numconta });
          }}>
            <strong>{conta.nome} · {conta.banco}/{conta.numero}{conta.vinculada ? ` · vinculada a ${conta.cdbanco}/${conta.numcontaErp}` : ""}</strong>
            <label>Conta do ERP
              <select name="erp" defaultValue={conta.vinculada ? `${conta.cdbanco}|${conta.agenciaErp}|${conta.numcontaErp}` : ""} required>
                <option value="">Selecione</option>
                {contasErp.map((item) => <option key={`${item.cdbanco}-${item.numconta}`} value={`${item.cdbanco}|${item.agencia}|${item.numconta}`}>{item.nome} · {item.agencia}/{item.numconta}</option>)}
              </select>
            </label>
            <button disabled={ocupado}>{conta.vinculada ? "Atualizar vínculo" : "Vincular"}</button>
          </form>
        ))}
      </section>

      <section className="panel">
        <h2>Movimentações</h2>
        <form className="open-finance-filtros" onSubmit={(event) => { event.preventDefault(); carregar(empresa); }}>
          <label>Banco<input value={filtros.banco} onChange={(event) => setFiltros({ ...filtros, banco: event.target.value })} /></label>
          <label>Conta<input value={filtros.conta} onChange={(event) => setFiltros({ ...filtros, conta: event.target.value })} /></label>
          <label>De<input type="date" value={filtros.de} onChange={(event) => setFiltros({ ...filtros, de: event.target.value })} /></label>
          <label>Até<input type="date" value={filtros.ate} onChange={(event) => setFiltros({ ...filtros, ate: event.target.value })} /></label>
          <label>Natureza
            <select value={filtros.natureza} onChange={(event) => setFiltros({ ...filtros, natureza: event.target.value })}>
              <option value="">Todas</option>
              {["pix", "boleto", "tarifa", "transferencia", "estorno", "outros"].map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>Status
            <select value={filtros.status} onChange={(event) => setFiltros({ ...filtros, status: event.target.value })}>
              <option value="">Todos</option>
              {["importado", "sugerido", "divergente", "conciliado", "ignorado", "classificado"].map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <button>Filtrar</button>
        </form>
        <table>
          <thead><tr><th>Data</th><th>Descrição</th><th>Valor</th><th>Classe</th><th>Charlie</th><th></th></tr></thead>
          <tbody>
            {(painel?.movimentos || []).map((item) => (
              <tr key={item.id}>
                <td>{item.data}</td>
                <td>{item.descricao}<br /><small>{item.pagador}</small></td>
                <td>{moeda(item.valor)}</td>
                <td><span className={`selo ${item.classe}`}>{item.classe}</span></td>
                <td>{item.charlie}</td>
                <td>
                  {item.status !== "conciliado" && item.status !== "ignorado" && <button type="button" disabled={ocupado} onClick={() => acao(`/open-finance/movimentos/${item.id}/aprovar`, { confirmado: true, controle: item.titulos?.[0]?.controle, tipo: item.titulos?.[0]?.tipo })}>Aprovar</button>}
                  {item.status !== "conciliado" && item.status !== "ignorado" && <button type="button" disabled={ocupado} onClick={() => acao(`/open-finance/movimentos/${item.id}/rejeitar`)}>Rejeitar</button>}
                  {item.status === "conciliado" && <button type="button" disabled={ocupado} onClick={() => acao(`/open-finance/movimentos/${item.id}/estornar`, { confirmado: true })}>Estornar</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Divergências</h2>
        <table>
          <thead><tr><th>Tipo</th><th>Valor</th><th>Causa</th><th>Sugestão</th><th>Documentos</th><th>Status</th></tr></thead>
          <tbody>
            {(painel?.divergencias || []).map((item) => (
              <tr key={item.id}><td>{item.tipo}</td><td>{moeda(item.valor)}</td><td>{item.causa}</td><td>{item.sugestao}</td><td>{item.documentos}</td><td>{item.status}</td></tr>
            ))}
          </tbody>
        </table>
        <h2>Regras da empresa</h2>
        <table>
          <thead><tr><th>Padrão</th><th>Categoria</th><th>Ativa</th><th></th></tr></thead>
          <tbody>
            {(painel?.regras || []).map((regra) => (
              <tr key={regra.id}>
                <td>{regra.padrao}</td><td>{regra.categoria}</td><td>{regra.ativa ? "sim" : "não"}</td>
                <td><button type="button" onClick={() => api.put(`/open-finance/regras/${regra.id}`, { empresa: Number(empresa), ativa: !regra.ativa }).then(() => carregar(empresa))}>{regra.ativa ? "Desativar" : "Ativar"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {estado?.capacidades && (
        <section className="panel">
          <h2>Provedor e limites</h2>
          <p>{estado.capacidades.historico}</p>
          <p>{estado.capacidades.consentimento}</p>
          <p>{estado.capacidades.comercializacao}</p>
          <p>Custo: {estado.capacidades.custo}</p>
        </section>
      )}
    </div>
  );
}
