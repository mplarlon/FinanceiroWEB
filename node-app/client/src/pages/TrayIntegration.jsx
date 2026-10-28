import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { trayProductPhoto } from "../../../server/lib/tray-product-photo.js";
import TrayProductStudio from "../components/TrayProductStudio.jsx";
import CharlieSalesShell from "./CharlieSalesShell.jsx";

const emptyConfig = { api_address: "", store_host: "", store_id: "", consumer_key: "", consumer_secret: "", access_token: "", refresh_token: "", webhook_secret: "", auto_sync: false, sync_interval_minutes: 15 };
const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateTime = (value) => value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Ainda não executada";
const connectionDetail = (estado) => {
  const erro = String(estado?.erro || "");
  if (/unauthorized access/i.test(erro)) return "A renovação automática não foi aceita pela Tray. Autorize o aplicativo novamente.";
  return erro || `Última sincronização: ${dateTime(estado?.ultima_sincronizacao)}`;
};

export default function TrayIntegration() {
  const [config, setConfig] = useState(emptyConfig);
  const [meta, setMeta] = useState({ conectado: false, estado: {} });
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [authCode, setAuthCode] = useState("");

  async function load() {
    try {
      const data = await api.get("/tray/config");
      setConfig((current) => ({ ...current, ...data.config }));
      setMeta({ conectado: data.conectado, estado: data.estado || {} });
      if (!data.conectado) return;
      try {
        const result = await api.get("/tray/resumo");
        setSummary(result);
        setMeta((current) => ({ ...current, estado: result.estado || current.estado }));
      } catch (e) {
        setMeta((current) => ({ ...current, estado: { ...current.estado, status: "erro", erro: e.message } }));
      }
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(event) {
    event.preventDefault(); setBusy("save"); setError(""); setMessage("");
    try {
      const data = await api.put("/tray/config", config);
      setMeta((current) => ({ ...current, conectado: data.conectado }));
      setConfig((current) => ({ ...current, ...data.config, consumer_secret: "", access_token: "", refresh_token: "" }));
      setMessage("Configuração protegida e salva no servidor.");
    } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  }
  async function test() {
    setBusy("test"); setError(""); setMessage("");
    try { const data = await api.post("/tray/testar"); setMessage(data.mensagem); setMeta((current) => ({ ...current, conectado: true, estado: data.estado })); }
    catch (e) { setError(e.message); }
    finally { setBusy(""); }
  }
  async function sync() {
    setBusy("sync"); setError(""); setMessage("");
    try { const data = await api.get("/tray/resumo"); setSummary(data); setMeta((current) => ({ ...current, estado: data.estado })); setMessage("Dados da loja atualizados."); }
    catch (e) { setError(e.message); }
    finally { setBusy(""); }
  }
  async function authorize() {
    if (!authCode.trim()) return setError("Informe o código de autorização recebido da Tray.");
    setBusy("auth"); setError(""); setMessage("");
    try {
      const data = await api.post("/tray/autorizar", { code: authCode.trim() });
      setConfig((current) => ({ ...current, ...data.config })); setMeta((current) => ({ ...current, conectado: true })); setAuthCode(""); setMessage(data.mensagem);
    } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  }
  async function editProduct(product) {
    const stock = window.prompt(`Novo estoque de ${product.name || product.id}:`, product.stock ?? "");
    if (stock === null) return;
    const price = window.prompt("Novo preço (deixe vazio para manter):", product.price ?? "");
    setBusy(`product-${product.id}`); setError("");
    try { const data = await api.put(`/tray/produtos/${product.id}`, { stock, price }); setMessage(data.mensagem); await sync(); }
    catch (e) { setError(e.message); }
    finally { setBusy(""); }
  }
  async function editOrder(order) {
    const status_id = window.prompt(`Novo ID de status do pedido #${order.id}:`, order.status_id || "");
    if (!status_id) return;
    const sending_code = window.prompt("Código de rastreio (opcional):", order.sending_code || "");
    setBusy(`order-${order.id}`); setError("");
    try { const data = await api.put(`/tray/pedidos/${order.id}`, { status_id, sending_code }); setMessage(data.mensagem); await sync(); }
    catch (e) { setError(e.message); }
    finally { setBusy(""); }
  }
  const set = (field) => (event) => setConfig((current) => ({ ...current, [field]: event.target.value }));

  return (
    <CharlieSalesShell connected={meta.conectado} onSynchronized={load}>
      <>
      <section className="tray-hero">
        <div>
          <span className="tray-kicker">LOJA CONECTADA</span>
          <h2>Loja Tray</h2>
          <p>Centralize pedidos, produtos e clientes da sua loja virtual dentro do Pontual Financeiro.</p>
        </div>
        <div className={`tray-status ${meta.conectado && meta.estado?.status !== "erro" ? "online" : "offline"}`}>
          <i />
          <span><b>{meta.conectado ? "Integração configurada" : "Aguardando configuração"}</b><small>{connectionDetail(meta.estado)}</small></span>
        </div>
      </section>

      {summary && (
        <section className="tray-kpis" aria-label="Resumo da loja Tray">
          <article><span>Pedidos na Tray</span><strong>{summary.totais?.pedidos ?? 0}</strong><small>Volume disponível pela API</small></article>
          <article><span>Produtos cadastrados</span><strong>{summary.totais?.produtos ?? 0}</strong><small>Catálogo integrado</small></article>
          <article><span>Clientes</span><strong>{summary.totais?.clientes ?? 0}</strong><small>Base de consumidores</small></article>
          <article className="accent"><span>Status da conexão</span><strong>Online</strong><small>API respondendo normalmente</small></article>
        </section>
      )}

      <div className="tray-grid">
        <section className="panel tray-config">
          <header><div><span className="tray-step">01</span><h2>Conectar sua loja</h2></div><a href="https://developers.tray.com.br/" target="_blank" rel="noreferrer">Documentação Tray ↗</a></header>
          <p className="tray-help">Use o endereço <b>api_address</b> e as chaves fornecidas quando o aplicativo é autorizado na Tray. Os segredos ficam armazenados apenas no servidor.</p>
          <form onSubmit={save}>
            <label className="wide">Endereço da API <input value={config.api_address} onChange={set("api_address")} placeholder="https://sualoja.commercesuite.com.br/web_api" required /></label>
            <label>Domínio da loja <input value={config.store_host} onChange={set("store_host")} placeholder="https://sualoja.com.br" /></label>
            <label>ID da loja <input value={config.store_id} onChange={set("store_id")} placeholder="Ex.: 391250" /></label>
            <label>Consumer key <input value={config.consumer_key} onChange={set("consumer_key")} placeholder="Chave do aplicativo" /></label>
            <label>Consumer secret <input type="password" value={config.consumer_secret} onChange={set("consumer_secret")} placeholder={config.has_consumer_secret ? "Configurado ••••••••" : "Segredo do aplicativo"} /></label>
            <label>Access token <input type="password" value={config.access_token} onChange={set("access_token")} placeholder={config.has_access_token ? "Configurado ••••••••" : "Token de acesso"} /></label>
            <label>Refresh token <input type="password" value={config.refresh_token} onChange={set("refresh_token")} placeholder={config.has_refresh_token ? "Configurado ••••••••" : "Token de renovação"} /></label>
            <label>Segredo do webhook <input type="password" value={config.webhook_secret} onChange={set("webhook_secret")} placeholder={config.has_webhook_secret ? "Configurado ••••••••" : "Proteção da URL pública"} /></label>
            <label>Sincronização automática <span className="tray-inline"><input type="checkbox" checked={Boolean(config.auto_sync)} onChange={(e) => setConfig((current) => ({ ...current, auto_sync: e.target.checked }))} /> Ativada a cada <input type="number" min="5" max="1440" value={config.sync_interval_minutes} onChange={set("sync_interval_minutes")} /> min</span></label>
            <div className="tray-actions wide">
              <button type="submit" disabled={Boolean(busy)}>{busy === "save" ? "Salvando..." : "Salvar configuração"}</button>
              <button type="button" className="secondary" onClick={test} disabled={Boolean(busy) || !meta.conectado}>{busy === "test" ? "Testando..." : "Testar conexão"}</button>
            </div>
          </form>
          <div className="tray-oauth">
            <h3>Autorizar aplicativo via OAuth 2.0</h3>
            <p>O access token é renovado automaticamente, sem interromper o uso. O código abaixo só é necessário na instalação do aplicativo.</p>
            <div><input value={authCode} onChange={(e) => setAuthCode(e.target.value)} placeholder="Código de autorização" /><button type="button" onClick={authorize} disabled={Boolean(busy)}>{busy === "auth" ? "Autorizando..." : "Autorizar"}</button></div>
          </div>
          {message && <div className="tray-message success">✓ {message}</div>}
          {error && <div className="error">{error}</div>}
        </section>

        <section className="panel tray-sync">
          <header><div><span className="tray-step">02</span><h2>Sincronização</h2></div><button onClick={sync} disabled={Boolean(busy) || !meta.conectado}>{busy === "sync" ? "Atualizando..." : "Sincronizar agora"}</button></header>
          <div className="tray-flow"><span>TRAY</span><i>→</i><span className="pontual">PONTUAL</span></div>
          <ul>
            <li><i>✓</i><span><b>Pedidos</b><small>Venda, situação, frete e pagamento</small></span></li>
            <li><i>✓</i><span><b>Produtos</b><small>Preço, estoque, referência e disponibilidade</small></span></li>
            <li><i>✓</i><span><b>Clientes</b><small>Cadastro comercial para conciliação</small></span></li>
          </ul>
          <p className="tray-note">A integração já permite leitura e atualização na Tray. A criação automática de documentos fiscais no Firebird continua protegida até que empresa, vendedor, depósito e formas de pagamento sejam mapeados.</p>
        </section>
      </div>

      <TrayProductStudio connected={meta.conectado} onCreated={sync} />

      {summary?.pedidos?.length > 0 && (
        <section className="panel tray-orders">
          <header><div><span className="tray-step">03</span><h2>Pedidos recentes</h2></div><small>Dados em tempo real da API</small></header>
          <div className="table-scroll"><table className="tabela"><thead><tr><th>Pedido</th><th>Data</th><th>Cliente</th><th>Status</th><th className="money-cell">Total</th><th>Ação</th></tr></thead><tbody>
            {summary.pedidos.map((order) => <tr key={order.id}><td><b>#{order.id}</b></td><td>{order.date || "-"} {order.hour || ""}</td><td>{order.Customer?.name || order.customer_name || `Cliente ${order.customer_id || "-"}`}</td><td><span className="tray-order-status">{order.status || "Novo"}</span></td><td className="money-cell">{money(order.total || order.partial_total)}</td><td><button className="tray-table-action" onClick={() => editOrder(order)} disabled={Boolean(busy)}>Atualizar</button></td></tr>)}
          </tbody></table></div>
        </section>
      )}
      {summary?.produtos?.length > 0 && (
        <section className="panel tray-orders"><header><div><span className="tray-step">04</span><h2>Catálogo e estoque</h2></div><small>Atualização direta na Tray</small></header><div className="table-scroll"><table className="tabela"><thead><tr><th>Produto</th><th>Referência</th><th>Estoque</th><th className="money-cell">Preço</th><th>Ação</th></tr></thead><tbody>
          {summary.produtos.map((product) => {
            const photo = trayProductPhoto(product);
            return <tr key={product.id}><td><span className="tray-product-cell">{photo ? <img className="tray-product-photo" src={photo} alt="" /> : <span className="tray-product-photo tray-product-photo-empty" aria-hidden="true" />}<b>{product.name || `Produto ${product.id}`}</b></span></td><td>{product.reference || "-"}</td><td>{product.stock ?? "-"}</td><td className="money-cell">{money(product.price)}</td><td><button className="tray-table-action" onClick={() => editProduct(product)} disabled={Boolean(busy)}>{busy === `product-${product.id}` ? "Salvando..." : "Editar"}</button></td></tr>;
          })}
        </tbody></table></div></section>
      )}
      </>
    </CharlieSalesShell>
  );
}
