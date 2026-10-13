import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import SearchableSelect from "../components/SearchableSelect.jsx";

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-01`;
};
const money = (value) =>
  Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const displayDate = (value) => {
  const normalized = String(value || "").slice(0, 10);
  if (!normalized || normalized <= "1899-12-30") return "—";
  return normalized.split("-").reverse().join("/");
};
const ref = (row) => `${row.CONTROLE}/${row.IDEMPRESA}`;
const refs = (rows) =>
  rows.map((row) => ({ controle: row.CONTROLE, idempresa: row.IDEMPRESA }));
const statusClass = (status) =>
  String(status || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll(" ", "-");
const initialFilters = () => ({
  status: "aberto",
  busca: "",
  data_inicio: monthStart(),
  data_fim: today(),
  tipo_data: "vencimento",
});

function NewAccountModal({ type, options, onClose, onDone }) {
  const [form, setForm] = useState({
    idempresa: "",
    pessoa_id: "",
    documento: "",
    parcela: 1,
    vencimento: today(),
    valor: "",
    forma_pagamento: "",
    caixa: "",
    centro_custo: "",
    conta: "",
    subconta: "",
    subsubconta: "",
    subsubsubconta: "",
    historico: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (name, value) =>
    setForm((current) => ({ ...current, [name]: value }));
  const setAccountLevel = (name, value) =>
    setForm((current) => {
      const next = { ...current, [name]: value };
      if (name === "conta") {
        next.subconta = "";
        next.subsubconta = "";
        next.subsubsubconta = "";
      } else if (name === "subconta") {
        next.subsubconta = "";
        next.subsubsubconta = "";
      } else if (name === "subsubconta") {
        next.subsubsubconta = "";
      }
      return next;
    });
  const people = type === "receber" ? options.clientes : options.fornecedores;
  const paymentOptions = type === "receber"
    ? (options.formas || []).map((item) => ({ ...item, value: item.CDRECEBTO, label: item.RECEBTO }))
    : (options.formas_pagar || []).map((item) => ({ ...item, value: item.CDPAGTO, label: item.PAGTO }));
  const personOptions = (people || []).map((item) => ({
    value: type === "receber" ? item.CDCLIENTE : item.CDFORNECEDOR,
    label: type === "receber" ? item.CLIENTE : item.FORNECEDOR,
  }));
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api.post("/financeiro/operacoes/criar", {
        ...form,
        tipo: type,
      });
      await onDone(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal finance-new-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-title-row">
          <div>
            <small>NOVO LANÇAMENTO</small>
            <h2>Conta a {type}</h2>
          </div>
          <button type="button" className="secondary" onClick={onClose}>Fechar</button>
        </div>
        <p>O título será criado em aberto. Nenhum valor será movimentado no caixa até a quitação.</p>
        <div className="form-grid">
          <label>Empresa<SearchableSelect value={form.idempresa} onChange={(value) => set("idempresa", value)} placeholder="Digite para buscar" required options={(options.empresas || []).map((item) => ({ value: item.IDEMPRESA, label: item.NOMEEMPRESA }))} /></label>
          <label>{type === "receber" ? "Cliente" : "Fornecedor"}<SearchableSelect value={form.pessoa_id} onChange={(value) => set("pessoa_id", value)} placeholder="Digite para buscar" required options={personOptions} /></label>
        </div>
        <div className="form-grid">
          <label>Documento<input value={form.documento} maxLength="20" onChange={(e) => set("documento", e.target.value)} required /></label>
          <label>Parcela<input type="number" min="1" max="999" value={form.parcela} onChange={(e) => set("parcela", e.target.value)} required /></label>
          <label>Vencimento<input type="date" value={form.vencimento} onChange={(e) => set("vencimento", e.target.value)} required /></label>
          <label>Valor<input type="number" min="0.01" step="0.01" value={form.valor} onChange={(e) => set("valor", e.target.value)} required /></label>
        </div>
        <div className="form-grid">
          <label>Forma prevista<select value={form.forma_pagamento} onChange={(e) => set("forma_pagamento", e.target.value)}><option value="">Não informada</option>{paymentOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label>Caixa<SearchableSelect value={form.caixa} onChange={(value) => set("caixa", value)} placeholder="Não informado" options={[{ value: "", label: "Não informado" }, ...(options.caixas || []).map((item) => ({ value: item.CDCAIXA, label: item.CAIXA }))]} /></label>
        </div>
        <details className="finance-advanced">
          <summary>Classificação contábil</summary>
          <div className="form-grid">
            <label>Centro de custo<select value={form.centro_custo} onChange={(e) => set("centro_custo", e.target.value)}><option value="">Não informado</option>{options.centros_custo?.map((item) => <option key={item.CCUSTO} value={item.CCUSTO}>{item.CENTROCUSTO}</option>)}</select></label>
            <label>Conta de nível 1<select value={form.conta} onChange={(e) => setAccountLevel("conta", e.target.value)}><option value="">Não informada</option>{options.plano_contas?.contas?.map((item) => <option key={item.CDCONTA} value={item.CDCONTA}>{item.CONTA}</option>)}</select></label>
            <label>Conta de nível 2<select value={form.subconta} onChange={(e) => setAccountLevel("subconta", e.target.value)}><option value="">Não informada</option>{options.plano_contas?.subcontas?.filter((item) => !form.conta || String(item.CDCONTA) === String(form.conta)).map((item) => <option key={`${item.CDCONTA}-${item.CDSUBCONTA}`} value={item.CDSUBCONTA}>{item.SUBCONTA}</option>)}</select></label>
            <label>Conta de nível 3<select value={form.subsubconta} onChange={(e) => setAccountLevel("subsubconta", e.target.value)}><option value="">Não informada</option>{options.plano_contas?.subsubcontas?.filter((item) => (!form.conta || String(item.CDCONTA) === String(form.conta)) && (!form.subconta || String(item.CDSUBCONTA) === String(form.subconta))).map((item) => <option key={`${item.CDCONTA}-${item.CDSUBCONTA}-${item.CDSUBSUBCONTA}`} value={item.CDSUBSUBCONTA}>{item.SUBSUBCONTA}</option>)}</select></label>
            <label>Conta de nível 4<select value={form.subsubsubconta} onChange={(e) => setAccountLevel("subsubsubconta", e.target.value)}><option value="">Não informada</option>{options.plano_contas?.subsubsubcontas?.filter((item) => (!form.conta || String(item.CDCONTA) === String(form.conta)) && (!form.subconta || String(item.CDSUBCONTA) === String(form.subconta)) && (!form.subsubconta || String(item.CDSUBSUBCONTA) === String(form.subsubconta))).map((item) => <option key={`${item.CDCONTA}-${item.CDSUBCONTA}-${item.CDSUBSUBCONTA}-${item.CDSUBSUBSUBCONTA}`} value={item.CDSUBSUBSUBCONTA}>{item.SUBSUBSUBCONTA}</option>)}</select></label>
          </div>
        </details>
        <label>Histórico<textarea rows="3" maxLength="255" value={form.historico} onChange={(e) => set("historico", e.target.value)} placeholder="Descrição do lançamento" /></label>
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" disabled={busy}>{busy ? "Salvando..." : `Criar conta a ${type}`}</button>
        </div>
      </form>
    </div>
  );
}

function ActionModal({ action, selected, type, options, onClose, onDone }) {
  const original = selected.reduce(
    (sum, row) => sum + Number(row.VALOR || 0),
    0,
  );
  const [form, setForm] = useState({
    data_pagamento: today(),
    forma_pagamento: "",
    caixa: "",
    banco: "",
    agencia: "",
    conta: "",
    desconto: 0,
    quantidade: 1,
    intervalo: 30,
    juros: 0,
    acrescimo: 0,
    retencao: 0,
    historico: "",
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const account = options.contas_bancarias?.find(
    (item) =>
      String(item.CDBANCO) === String(form.banco) &&
      (!form.conta || item.NUMCONTA === form.conta),
  );
  const payment = options.formas?.find(
    (item) => String(item.CDRECEBTO) === String(form.forma_pagamento),
  );
  const titleRetention = selected.reduce(
    (sum, row) => sum + Number(row.RETENCAO || 0),
    0,
  );
  const retention =
    type === "receber"
      ? titleRetention || (original * Number(payment?.TAXA_RETENCAO || 0)) / 100
      : 0;
  const interest = selected.reduce((sum, row) => {
    const rate = Number(
      options.taxas_juros?.find(
        (item) => Number(item.IDEMPRESA) === Number(row.IDEMPRESA),
      )?.TXJUROS || 0,
    );
    const days = row.VENCIMENTO
      ? Math.max(
          0,
          Math.floor(
            (new Date(`${form.data_pagamento}T12:00:00`) -
              new Date(`${String(row.VENCIMENTO).slice(0, 10)}T12:00:00`)) /
              86400000,
          ),
        )
      : 0;
    return sum + (Number(row.VALOR || 0) * rate * days) / 100;
  }, 0);
  const gross =
    Math.round((original + interest - Number(form.desconto || 0)) * 100) / 100;
  const net = Math.round((gross - retention) * 100) / 100;
  const agreementTotal =
    Math.round(
      (original +
        Number(form.juros || 0) +
        Number(form.acrescimo || 0) -
        Number(form.desconto || 0) -
        Number(form.retencao || 0)) *
        100,
    ) / 100;

  function set(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const base = { tipo: type, contas: refs(selected) };
      if (action === "baixar")
        await api.post("/financeiro/operacoes/baixar", {
          ...base,
          ...form,
          valor_pagamento: gross,
          valor_liquido: net,
          retencao: retention,
          agencia: form.agencia || account?.AGENCIA || "",
          conta: form.conta || account?.NUMCONTA || "",
        });
      else if (action === "acordo") {
        const count = Math.max(1, Number(form.quantidade));
        const value = Math.floor((agreementTotal / count) * 100) / 100;
        const values = Array.from({ length: count }, (_, index) =>
          index === count - 1
            ? Math.round((agreementTotal - value * (count - 1)) * 100) / 100
            : value,
        );
        await api.post("/financeiro/operacoes/acordo", {
          ...base,
          modelo_controle: selected[0].CONTROLE,
          modelo_empresa: selected[0].IDEMPRESA,
          quantidade: count,
          intervalo: Number(form.intervalo),
          data_inicial: form.data_pagamento,
          juros: Number(form.juros),
          desconto: Number(form.desconto),
          retencao: Number(form.retencao),
          acrescimo: Number(form.acrescimo),
          valores,
          historico: form.historico,
        });
      }
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2>{action === "baixar" ? "Quitar títulos" : "Criar acordo"}</h2>
        <p>
          {selected.length} título(s) · saldo original{" "}
          <strong>{money(original)}</strong>
        </p>
        <label>
          {action === "baixar" ? "Data da quitação" : "Primeiro vencimento"}
          <input
            type="date"
            value={form.data_pagamento}
            onChange={(e) => set("data_pagamento", e.target.value)}
            required
          />
        </label>
        {action === "baixar" ? (
          <>
            <label>
              Forma de quitação
              <select
                value={form.forma_pagamento}
                onChange={(e) => set("forma_pagamento", e.target.value)}
                required
              >
                <option value="">Selecione</option>
                {options.formas?.map((item) => (
                  <option key={item.CDRECEBTO} value={item.CDRECEBTO}>
                    {item.RECEBTO}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Caixa
              <select
                value={form.caixa}
                onChange={(e) => set("caixa", e.target.value)}
                required
              >
                <option value="">Selecione</option>
                {options.caixas?.map((item) => (
                  <option key={item.CDCAIXA} value={item.CDCAIXA}>
                    {item.CAIXA}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Conta bancária
              <select
                value={`${form.banco}|${form.conta}`}
                onChange={(e) => {
                  const [bank, accountNumber, agency] =
                    e.target.value.split("|");
                  setForm((current) => ({
                    ...current,
                    banco: bank,
                    conta: accountNumber,
                    agencia: agency,
                  }));
                }}
              >
                <option value="|">Sem movimento bancário</option>
                {options.contas_bancarias?.map((item, index) => (
                  <option
                    key={`${item.CDBANCO}-${item.NUMCONTA}-${index}`}
                    value={`${item.CDBANCO}|${item.NUMCONTA}|${item.AGENCIA}`}
                  >
                    {item.BANCO} · {item.AGENCIA}/{item.NUMCONTA}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Desconto
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.desconto}
                onChange={(e) => set("desconto", e.target.value)}
              />
            </label>
            <div className="finance-calc">
              <span>Juros automáticos: {money(interest)}</span>
              <span>Retenção: {money(retention)}</span>
              <strong>Líquido: {money(net)}</strong>
            </div>
          </>
        ) : (
          <>
            <div className="form-grid">
              <label>
                Parcelas
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={form.quantidade}
                  onChange={(e) => set("quantidade", e.target.value)}
                />
              </label>
              <label>
                Intervalo (dias)
                <input
                  type="number"
                  min="0"
                  value={form.intervalo}
                  onChange={(e) => set("intervalo", e.target.value)}
                />
              </label>
            </div>
            <div className="form-grid">
              <label>
                Juros
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.juros}
                  onChange={(e) => set("juros", e.target.value)}
                />
              </label>
              <label>
                Acréscimo
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.acrescimo}
                  onChange={(e) => set("acrescimo", e.target.value)}
                />
              </label>
              <label>
                Desconto
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.desconto}
                  onChange={(e) => set("desconto", e.target.value)}
                />
              </label>
              {type === "receber" && (
                <label>
                  Retenção
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.retencao}
                    onChange={(e) => set("retencao", e.target.value)}
                  />
                </label>
              )}
            </div>
            <div className="finance-calc">
              <strong>Novo total: {money(agreementTotal)}</strong>
              <span>{form.quantidade} parcela(s)</span>
            </div>
          </>
        )}
        <label>
          Histórico
          <textarea
            rows="3"
            value={form.historico}
            onChange={(e) => set("historico", e.target.value)}
          />
        </label>
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Gravando..." : "Confirmar"}
          </button>
        </div>
      </form>
    </div>
  );
}

function AccountDetailModal({ detail, loading, onClose }) {
  const title = detail?.titulo;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <section className="modal modal-wide account-detail" onClick={(event) => event.stopPropagation()}>
        <div className="detail-heading">
          <div>
            <small>DETALHES DO LANÇAMENTO</small>
            <h2>{detail?.tipo === "pagar" ? "Conta a pagar" : "Conta a receber"}</h2>
          </div>
          <button type="button" className="secondary" onClick={onClose}>Fechar</button>
        </div>
        {loading && <p>Carregando detalhes...</p>}
        {!loading && title && (
          <>
            <div className="detail-grid">
              <div><small>{detail.tipo === "pagar" ? "Fornecedor" : "Cliente"}</small><strong>{title.PESSOA || "—"}</strong></div>
              <div><small>Documento</small><strong>{title.NOTAFISCAL || title.NRDOC || title.NRDOC2 || "—"}</strong></div>
              <div><small>Parcela</small><strong>{title.PARCELA ?? "—"}</strong></div>
              <div><small>Vencimento</small><strong>{displayDate(title.DTVENC)}</strong></div>
              <div><small>Quitação</small><strong>{displayDate(title.DATA_BAIXA)}</strong></div>
              <div><small>Forma de pagamento</small><strong>{title.FORMA_PAGAMENTO || "—"}</strong></div>
              <div><small>Valor</small><strong className="money-cell">{money(title.VALOR ?? title.TOTAL ?? title.DIVIDA)}</strong></div>
              <div><small>Valor pago</small><strong className="money-cell">{money(title.TOTALPG ?? title.VLPAGTO ?? title.VLPGLIQ)}</strong></div>
              <div><small>Juros</small><strong className="money-cell">{money(title.JUROS)}</strong></div>
              <div><small>Desconto</small><strong className="money-cell">{money(title.DESCONTO)}</strong></div>
              <div><small>Origem</small><strong>{title.ORIGEM || "—"}</strong></div>
              <div><small>Histórico</small><strong>{title.HISTORICO || "—"}</strong></div>
            </div>
            {detail.pedido && (
              <div className="detail-order">
                <h3>Pedido {detail.pedido.NRPEDIDO}</h3>
                <p>{detail.pedido.CLIENTE || title.PESSOA} · {displayDate(detail.pedido.DTSAIDA)}</p>
                <div className="table-scroll">
                  <table className="tabela">
                    <thead><tr><th>Produto</th><th>Descrição</th><th>Qtd.</th><th className="money-cell">Unitário</th><th className="money-cell">Total</th></tr></thead>
                    <tbody>
                      {(detail.itens || []).map((item) => (
                        <tr key={`${item.POSIC}-${item.CDPRODUTO}`}>
                          <td>{item.CDPRODUTO}</td><td>{item.DESCRICAO}</td><td>{Number(item.QTDPRODUTO || 0).toLocaleString("pt-BR")} {item.UNID || ""}</td>
                          <td className="money-cell">{money(item.VLUNIT)}</td><td className="money-cell">{money(item.TOTAL)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="detail-total"><span>Total do pedido</span><strong>{money(detail.pedido.VLTOTAL)}</strong></div>
              </div>
            )}
            {detail.entrada && (
              <div className="detail-order">
                <h3>Nota de entrada {detail.entrada.NOTAFISCAL}</h3>
                <p>Entrada {detail.entrada.IDENTRADA} · {displayDate(detail.entrada.DTENTRADA)}{detail.entrada.CHAVE ? ` · NF-e ${detail.entrada.CHAVE}` : ""}</p>
                <div className="table-scroll">
                  <table className="tabela">
                    <thead><tr><th>Produto</th><th>Descrição</th><th>Qtd.</th><th className="money-cell">Unitário</th><th className="money-cell">Desconto</th><th className="money-cell">Total</th></tr></thead>
                    <tbody>
                      {(detail.itens || []).map((item) => (
                        <tr key={`${item.POSIC}-${item.CDPRODUTO}`}>
                          <td>{item.CDPRODUTO}</td><td>{item.DESCRICAO}</td><td>{Number(item.QTDPRODUTO || 0).toLocaleString("pt-BR")} {item.UNID || ""}</td>
                          <td className="money-cell">{money(item.VLUNIT)}</td><td className="money-cell">{money(item.DESCONTO)}</td><td className="money-cell">{money(item.TOTAL)}</td>
                        </tr>
                      ))}
                      {!detail.itens?.length && <tr><td colSpan="6">Nenhum produto encontrado para esta nota.</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div className="detail-total"><span>Total da nota</span><strong>{money(detail.entrada.VLTOTAL)}</strong></div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

export default function FinanceAccounts() {
  const [type, setType] = useState("receber"),
    [rows, setRows] = useState([]),
    [summary, setSummary] = useState({}),
    [options, setOptions] = useState({}),
    [agreements, setAgreements] = useState([]);
  const [filters, setFilters] = useState(initialFilters);
  const [selected, setSelected] = useState(new Set()),
    [action, setAction] = useState(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [detail, setDetail] = useState(null),
    [detailLoading, setDetailLoading] = useState(false),
    [creating, setCreating] = useState(false);
  const chosen = useMemo(
    () => rows.filter((row) => selected.has(ref(row))),
    [rows, selected],
  );
  async function load(filterOverride = filters) {
    setLoading(true);
    setError("");
    setSelected(new Set());
    try {
      const [accounts, agreementData] = await Promise.all([
        api.get(`/financeiro/contas-${type}`, filterOverride),
        api.get("/financeiro/operacoes/acordos", { tipo: type }),
      ]);
      setRows(accounts.dados || []);
      setSummary(accounts.resumo || {});
      setAgreements(agreementData.acordos || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    api.get("/financeiro/operacoes/opcoes").then(setOptions).catch((e) => setError(e.message));
  }, []);
  function setFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value }));
  }
  function clearFilters() {
    setFilters(initialFilters());
  }
  function toggle(row) {
    const id = ref(row);
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  async function openDetail(row) {
    setDetail({ tipo: type, titulo: row, pedido: null, itens: [] });
    setDetailLoading(true);
    try {
      setDetail(
        await api.get("/financeiro/operacoes/detalhe", {
          tipo: type,
          controle: row.CONTROLE,
          empresa: row.IDEMPRESA,
        }),
      );
    } catch (e) {
      setError(e.message);
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }
  async function direct(operation, confirmText) {
    if (!chosen.length || !window.confirm(confirmText)) return;
    setError("");
    setNotice("");
    try {
      const result = await api.post(`/financeiro/operacoes/${operation}`, {
        tipo: type,
        contas: refs(chosen),
      });
      setNotice(result.mensagem);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }
  const allOpen =
      chosen.length && chosen.every((row) => Number(row.STATUS) === 1),
    allPaid = chosen.length && chosen.every((row) => Number(row.STATUS) === 2),
    samePerson = new Set(chosen.map((row) => row.PESSOA_ID)).size === 1,
    hasAgreement = chosen.length && chosen.every((row) => row.ACORDO);
  return (
    <>
      <section className="panel finance-panel">
        <div className="finance-heading">
          <div>
            <h2>Contas a {type}</h2>
            <p>Operações compatíveis com os status e acordos do Automec.</p>
          </div>
          <div className="tabs">
            <button onClick={() => setCreating(true)}>+ Nova conta</button>
            <button
              className={type === "receber" ? "active" : ""}
              onClick={() => setType("receber")}
            >
              A receber
            </button>
            <button
              className={type === "pagar" ? "active" : ""}
              onClick={() => setType("pagar")}
            >
              A pagar
            </button>
          </div>
        </div>
        <div className="filtros">
          <label>
            Status
            <select
              value={filters.status}
              onChange={(e) => setFilter("status", e.target.value)}
            >
              <option value="">Todos</option>
              <option value="aberto">Aberto</option>
              <option value="vencido">Vencido</option>
              <option value="a_vencer">A vencer</option>
              <option value="quitado">Quitado</option>
              <option value="acordo">Acordo</option>
              {type === "receber" && <option value="acordo_nf">Acordo em nota fiscal</option>}
              {type === "receber" && <option value="acordo_recebimento">Acordo no recebimento</option>}
              {type === "pagar" && <option value="pendente">Pendente</option>}
              <option value="cancelado">Cancelado</option>
              <option value="devolucao">Devolução</option>
              <option value="transferencia">Transferência</option>
              <option value="excluido">Excluído</option>
            </select>
          </label>
          <label>
            Busca
            <input
              value={filters.busca}
              onChange={(e) => setFilter("busca", e.target.value)}
              placeholder="Cliente, documento ou histórico"
            />
          </label>
          <label>
            Data de
            <select value={filters.tipo_data} onChange={(e) => setFilter("tipo_data", e.target.value)}>
              <option value="vencimento">Vencimento</option>
              <option value="movimento">Movimento/entrada</option>
              <option value="pagamento">Quitação</option>
            </select>
          </label>
          <label>
            De
            <input
              type="date"
              value={filters.data_inicio}
              onChange={(e) => setFilter("data_inicio", e.target.value)}
            />
          </label>
          <label>
            Até
            <input
              type="date"
              value={filters.data_fim}
              onChange={(e) => setFilter("data_fim", e.target.value)}
            />
          </label>
          <button onClick={load}>{loading ? "Buscando..." : "Buscar"}</button>
          <button className="secondary" onClick={clearFilters}>Limpar</button>
          <details className="finance-advanced">
            <summary>Filtros avançados</summary>
            <div className="advanced-filter-grid">
              <label>Empresa<SearchableSelect value={filters.loja || ""} onChange={(value) => setFilter("loja", value)} placeholder="Todas" options={[{ value: "", label: "Todas" }, ...(options.empresas || []).map((x) => ({ value: x.IDEMPRESA, label: x.NOMEEMPRESA }))]} /></label>
              <label>{type === "receber" ? "Cliente" : "Fornecedor"}<SearchableSelect value={filters[type === "receber" ? "cliente" : "fornecedor"] || ""} onChange={(value) => setFilter(type === "receber" ? "cliente" : "fornecedor", value)} placeholder="Digite o nome" options={[{ value: "", label: "Todos" }, ...((type === "receber" ? options.clientes : options.fornecedores) || []).map((x) => ({ value: type === "receber" ? x.CDCLIENTE : x.CDFORNECEDOR, label: type === "receber" ? x.CLIENTE : x.FORNECEDOR }))]} /></label>
              <label>Banco<SearchableSelect value={filters.banco || ""} onChange={(value) => setFilter("banco", value)} placeholder="Todos" options={[{ value: "", label: "Todos" }, ...(options.bancos || []).map((x) => ({ value: x.CDBANCO, label: x.BANCO }))]} /></label>
              <label>Caixa<SearchableSelect value={filters.caixa || ""} onChange={(value) => setFilter("caixa", value)} placeholder="Todos" options={[{ value: "", label: "Todos" }, ...(options.caixas || []).map((x) => ({ value: x.CDCAIXA, label: x.CAIXA }))]} /></label>
              <label>Grupo de recebimento<select value={filters.grupo_recebto || ""} onChange={(e) => setFilter("grupo_recebto", e.target.value)}><option value="">Todos</option>{options.grupos_recebimento?.map((x) => <option key={x.CDGRUPO} value={x.CDGRUPO}>{x.GRUPO}</option>)}</select></label>
              <label>Condição de pagamento<select value={filters.condicao_pagamento || ""} onChange={(e) => setFilter("condicao_pagamento", e.target.value)}><option value="">Todas</option>{options.formas?.map((x) => <option key={x.CDRECEBTO} value={x.CDRECEBTO}>{x.RECEBTO}</option>)}</select></label>
              <label>Tipo/forma prevista<select value={filters.tipo_pagamento || ""} onChange={(e) => setFilter("tipo_pagamento", e.target.value)}><option value="">Todos</option>{options.formas?.map((x) => <option key={x.CDRECEBTO} value={x.CDRECEBTO}>{x.RECEBTO}</option>)}</select></label>
              <label>Centro de custo<select value={filters.centro_custo || ""} onChange={(e) => setFilter("centro_custo", e.target.value)}><option value="">Todos</option>{options.centros_custo?.map((x) => <option key={x.CCUSTO} value={x.CCUSTO}>{x.CENTROCUSTO}</option>)}</select></label>
              <label>Conta de nível 1<select value={filters.conta || ""} onChange={(e) => setFilter("conta", e.target.value)}><option value="">Todas</option>{options.plano_contas?.contas?.map((x) => <option key={x.CDCONTA} value={x.CDCONTA}>{x.CONTA}</option>)}</select></label>
              <label>Conta de nível 2<select value={filters.subconta || ""} onChange={(e) => setFilter("subconta", e.target.value)}><option value="">Todas</option>{options.plano_contas?.subcontas?.filter((x) => !filters.conta || String(x.CDCONTA) === String(filters.conta)).map((x) => <option key={`${x.CDCONTA}-${x.CDSUBCONTA}`} value={x.CDSUBCONTA}>{x.SUBCONTA}</option>)}</select></label>
              <label>Conta de nível 3<select value={filters.subsubconta || ""} onChange={(e) => setFilter("subsubconta", e.target.value)}><option value="">Todas</option>{options.plano_contas?.subsubcontas?.filter((x) => !filters.conta || String(x.CDCONTA) === String(filters.conta)).map((x) => <option key={`${x.CDCONTA}-${x.CDSUBCONTA}-${x.CDSUBSUBCONTA}`} value={x.CDSUBSUBCONTA}>{x.SUBSUBCONTA}</option>)}</select></label>
              <label>Conta de nível 4<select value={filters.subsubsubconta || ""} onChange={(e) => setFilter("subsubsubconta", e.target.value)}><option value="">Todas</option>{options.plano_contas?.subsubsubcontas?.filter((x) => !filters.conta || String(x.CDCONTA) === String(filters.conta)).map((x) => <option key={`${x.CDCONTA}-${x.CDSUBCONTA}-${x.CDSUBSUBCONTA}-${x.CDSUBSUBSUBCONTA}`} value={x.CDSUBSUBSUBCONTA}>{x.SUBSUBSUBCONTA}</option>)}</select></label>
              <label>Histórico<input value={filters.historico || ""} onChange={(e) => setFilter("historico", e.target.value)} /></label>
              <label>Documento<input value={filters.documento || ""} onChange={(e) => setFilter("documento", e.target.value)} /></label>
              <label>Documento 2<input value={filters.documento_2 || ""} onChange={(e) => setFilter("documento_2", e.target.value)} /></label>
              <label>Valor exato<input type="number" step="0.01" value={filters.valor || ""} onChange={(e) => setFilter("valor", e.target.value)} /></label>
              <label>Competência<input type="month" value={filters.competencia || ""} onChange={(e) => setFilter("competencia", e.target.value ? `${e.target.value}-01` : "")} /></label>
              <label>Ordenar por<select value={filters.ordenar || "vencimento_asc"} onChange={(e) => setFilter("ordenar", e.target.value)}><option value="vencimento_asc">Vencimento</option><option value="valor_desc">Maior valor</option><option value="valor_asc">Menor valor</option><option value="pessoa">Cliente</option></select></label>
              {type === "receber" ? <>
                <label>Vendedor<SearchableSelect value={filters.vendedor || ""} onChange={(value) => setFilter("vendedor", value)} placeholder="Todos" options={[{ value: "", label: "Todos" }, ...(options.vendedores || []).map((x) => ({ value: x.CDVENDEDOR, label: x.VENDEDOR }))]} /></label>
                <label>Classificação<select value={filters.classificacao || ""} onChange={(e) => setFilter("classificacao", e.target.value)}><option value="">Todas</option>{options.classificacoes?.map((x) => <option key={x.CDCLASSIFICACAO} value={x.CDCLASSIFICACAO}>{x.CLASSIFICACAO}</option>)}</select></label>
                <label>Pedido/nota fiscal<input type="number" value={filters.pedido || ""} onChange={(e) => setFilter("pedido", e.target.value)} /></label>
                <label>Nosso número/boleto<input value={filters.nosso_numero || ""} onChange={(e) => setFilter("nosso_numero", e.target.value)} /></label>
                <label>Nº cheque<input value={filters.cheque || ""} onChange={(e) => setFilter("cheque", e.target.value)} /></label>
                <label>Acordo NF<input type="number" value={filters.acordo_nf || ""} onChange={(e) => setFilter("acordo_nf", e.target.value)} /></label>
                <label>Acordo recebimento<input type="number" value={filters.acordo_recebimento || ""} onChange={(e) => setFilter("acordo_recebimento", e.target.value)} /></label>
                <label>Origem<input value={filters.origem || ""} onChange={(e) => setFilter("origem", e.target.value)} /></label>
                <label>Remessa de boleto<input value={filters.remessa || ""} onChange={(e) => setFilter("remessa", e.target.value)} /></label>
                <label>Status do pedido<select value={filters.status_pedido || ""} onChange={(e) => setFilter("status_pedido", e.target.value)}><option value="">Todos</option><option value="1">Ativo</option><option value="3">Cancelado</option></select></label>
                <label>ID do endereço<input type="number" value={filters.endereco || ""} onChange={(e) => setFilter("endereco", e.target.value)} /></label>
                <label>Tipo de recebimento<input type="number" value={filters.tipo_recebimento || ""} onChange={(e) => setFilter("tipo_recebimento", e.target.value)} /></label>
              </> : <>
                <label>Tipo de documento<select value={filters.tipo_documento || ""} onChange={(e) => setFilter("tipo_documento", e.target.value)}><option value="">Todos</option>{options.tipos_documento?.map((x) => <option key={x.CDDOCUMENTO} value={x.CDDOCUMENTO}>{x.DOCUMENTO}</option>)}</select></label>
                <label>Nota fiscal<input value={filters.nota_fiscal || ""} onChange={(e) => setFilter("nota_fiscal", e.target.value)} /></label>
                <label>Parcela<input type="number" value={filters.parcela || ""} onChange={(e) => setFilter("parcela", e.target.value)} /></label>
                <label>Entrada<input value={filters.entrada || ""} onChange={(e) => setFilter("entrada", e.target.value)} /></label>
                <label>Valor pago<input type="number" step="0.01" value={filters.valor_pago || ""} onChange={(e) => setFilter("valor_pago", e.target.value)} /></label>
                <label>Com boleto<select value={filters.com_boleto || ""} onChange={(e) => setFilter("com_boleto", e.target.value)}><option value="">Todos</option><option value="sim">Sim</option><option value="nao">Não</option></select></label>
                <label>DANFE<select value={filters.danfe || ""} onChange={(e) => setFilter("danfe", e.target.value)}><option value="">Todos</option><option value="sim">Sim</option><option value="nao">Não</option></select></label>
                <label>Vales<select value={filters.vale || ""} onChange={(e) => setFilter("vale", e.target.value)}><option value="">Todos</option><option value="somente_vales">Somente vales</option><option value="vales_gerados">Vales gerados</option><option value="vales_funcionarios">Vales de funcionários</option><option value="sem_vales">Sem vales</option></select></label>
                <label>Emissão de<input type="date" value={filters.emissao_inicio || ""} onChange={(e) => setFilter("emissao_inicio", e.target.value)} /></label>
                <label>Emissão até<input type="date" value={filters.emissao_fim || ""} onChange={(e) => setFilter("emissao_fim", e.target.value)} /></label>
                <label className="check-filter"><input type="checkbox" checked={Boolean(filters.ocultar_provisao)} onChange={(e) => setFilter("ocultar_provisao", e.target.checked)} /> Ocultar provisão de ordem de compra</label>
              </>}
            </div>
          </details>
        </div>
        <div className="finance-summary">
          <article>
            <small>Títulos</small>
            <strong>{Number(summary.TITULOS || 0)}</strong>
          </article>
          <article>
            <small>Em aberto</small>
            <strong>{money(summary.TOTAL_ABERTO)}</strong>
          </article>
          <article>
            <small>Vencido</small>
            <strong>{money(summary.TOTAL_VENCIDO)}</strong>
          </article>
          <article>
            <small>Quitado</small>
            <strong>{money(summary.TOTAL_QUITADO)}</strong>
          </article>
        </div>
        {error && <div className="error">{error}</div>}
        {notice && <div className="success">{notice}</div>}
        <div className="selection-bar">
          <span>
            {chosen.length} selecionado(s) ·{" "}
            {money(
              chosen.reduce((sum, row) => sum + Number(row.VALOR || 0), 0),
            )}
          </span>
          <div>
            <button
              disabled={!allOpen || !samePerson}
              onClick={() => setAction("baixar")}
            >
              Quitar
            </button>
            <button
              disabled={!allOpen || !samePerson}
              onClick={() => setAction("acordo")}
            >
              Acordo
            </button>
            <button
              disabled={!allPaid}
              onClick={() =>
                direct(
                  "cancelar-baixa",
                  "Cancelar a quitação dos títulos selecionados?",
                )
              }
            >
              Cancelar quitação
            </button>
            <button
              disabled={!hasAgreement}
              onClick={() =>
                direct(
                  "desfazer-acordo",
                  "Desfazer este acordo e restaurar os títulos originais?",
                )
              }
            >
              Desfazer acordo
            </button>
          </div>
        </div>
        <div className="table-scroll">
          <table className="tabela">
            <thead>
              <tr>
                <th></th>
                <th>Status</th>
                <th>Vencimento</th>
                <th>Cliente</th>
                <th>Documento</th>
                <th>Parcela</th>
                <th className="money-cell">Valor</th>
                <th>Quitação</th>
                <th>Acordo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={ref(row)}
                  className={selected.has(ref(row)) ? "selected-row" : ""}
                  onDoubleClick={() => openDetail(row)}
                  title="Clique duas vezes para abrir os detalhes"
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(ref(row))}
                      onChange={() => toggle(row)}
                      onDoubleClick={(event) => event.stopPropagation()}
                    />
                  </td>
                  <td>
                    <span
                      className={`finance-status status-${statusClass(row.STATUS_TITULO)}`}
                    >
                      {row.STATUS_TITULO}
                    </span>
                  </td>
                  <td>{displayDate(row.VENCIMENTO)}</td>
                  <td>{row.PESSOA || row.PESSOA_ID}</td>
                  <td>{row.DOCUMENTO}</td>
                  <td>{row.PARCELA}</td>
                  <td className="money-cell">{money(row.VALOR)}</td>
                  <td>{displayDate(row.DATA_BAIXA)}</td>
                  <td>{row.ACORDO || "—"}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan="9">Nenhum título encontrado.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <h2>Acordos recentes</h2>
        <table className="tabela">
          <thead>
            <tr>
              <th>Nº</th>
              <th>Status</th>
              <th>Originais</th>
              <th>Parcelas</th>
              <th className="money-cell">Saldo anterior</th>
              <th className="money-cell">Novo total</th>
              <th>Criado em</th>
            </tr>
          </thead>
          <tbody>
            {agreements.map((item) => (
              <tr key={item.IDACORDO}>
                <td>{item.IDACORDO}</td>
                <td>{item.STATUS}</td>
                <td>{item.TITULOS_ORIGINAIS}</td>
                <td>{item.PARCELAS_NOVAS}</td>
                <td className="money-cell">{money(item.SALDO_ORIGINAL)}</td>
                <td className="money-cell">{money(item.TOTAL_NOVO)}</td>
                <td>{displayDate(item.CRIADO_EM)}</td>
              </tr>
            ))}
            {!agreements.length && (
              <tr>
                <td colSpan="7">Nenhum acordo registrado pelo dashboard.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
      {action && (
        <ActionModal
          action={action}
          selected={chosen}
          type={type}
          options={options}
          onClose={() => setAction(null)}
          onDone={async () => {
            setAction(null);
            setNotice(
              action === "baixar"
                ? "Quitação gravada com sucesso."
                : "Acordo criado com sucesso.",
            );
            await load();
          }}
        />
      )}
      {creating && (
        <NewAccountModal
          type={type}
          options={options}
          onClose={() => setCreating(false)}
          onDone={async (result) => {
            setCreating(false);
            setNotice(result.mensagem);
            const due = String(result.vencimento || "").slice(0, 10);
            const nextFilters = due
              ? {
                  ...filters,
                  data_inicio: !filters.data_inicio || due < filters.data_inicio ? due : filters.data_inicio,
                  data_fim: !filters.data_fim || due > filters.data_fim ? due : filters.data_fim,
                }
              : filters;
            setFilters(nextFilters);
            await load(nextFilters);
          }}
        />
      )}
      {detail && (
        <AccountDetailModal
          detail={detail}
          loading={detailLoading}
          onClose={() => setDetail(null)}
        />
      )}
    </>
  );
}
