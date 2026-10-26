import React, { useState } from "react";
import { api } from "../lib/api.js";

const initialBrief = { product: "", brand: "", model: "", category: "", application: "", features: "", audience: "", tone: "profissional e direto" };
const initialProduct = { name: "", description_small: "", description: "", brand: "", model: "", meta_title: "", meta_description: "", keywords: "", reference: "", ean: "", category_id: "", price: "", cost_price: "", promotional_price: "", stock: "", weight: "", length: "", width: "", height: "", available: true };

export default function TrayProductStudio({ connected, onCreated }) {
  const [brief, setBrief] = useState(initialBrief);
  const [product, setProduct] = useState(initialProduct);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const change = (setter, field) => (event) => setter((current) => ({ ...current, [field]: event.target.type === "checkbox" ? event.target.checked : event.target.value }));

  async function generate(event) {
    event.preventDefault(); setBusy("generate"); setError(""); setMessage("");
    try { const data = await api.post("/tray/produtos/sugerir", brief); setProduct((current) => ({ ...current, ...data.sugestao })); setMessage("Texto criado pelo Ollama. Revise antes de publicar."); }
    catch (e) { setError(e.message); }
    finally { setBusy(""); }
  }
  async function create(event) {
    event.preventDefault();
    if (!window.confirm(`Criar "${product.name}" na Tray?`)) return;
    setBusy("create"); setError(""); setMessage("");
    try { const data = await api.post("/tray/produtos", product); setMessage(`${data.mensagem} Código: ${data.id || "gerado"}.`); setBrief(initialBrief); setProduct(initialProduct); onCreated?.(); }
    catch (e) { setError(e.message); }
    finally { setBusy(""); }
  }

  return <section className="panel tray-ai-studio">
    <header><div><span className="tray-step">03</span><div><h2>Novo produto com Ollama</h2><p>Informe somente fatos do produto. A IA prepara o anúncio; você revisa e autoriza a criação.</p></div></div><span className="tray-ai-badge">✦ IA LOCAL</span></header>
    <div className="tray-ai-columns">
      <form onSubmit={generate} className="tray-brief-form">
        <h3>1. Informações para a IA</h3>
        <label>Produto* <input value={brief.product} onChange={change(setBrief, "product")} placeholder="Ex.: Pastilha de freio dianteira" required /></label>
        <div className="tray-form-row"><label>Marca <input value={brief.brand} onChange={change(setBrief, "brand")} /></label><label>Modelo <input value={brief.model} onChange={change(setBrief, "model")} /></label></div>
        <label>Categoria textual <input value={brief.category} onChange={change(setBrief, "category")} placeholder="Ex.: Freios e suspensão" /></label>
        <label>Aplicação/compatibilidade confirmada <textarea value={brief.application} onChange={change(setBrief, "application")} placeholder="Veículos, anos e versões já conferidos" /></label>
        <label>Características verificadas <textarea value={brief.features} onChange={change(setBrief, "features")} placeholder="Material, medidas, conteúdo da embalagem, diferenciais..." /></label>
        <label>Público e tom <input value={brief.audience} onChange={change(setBrief, "audience")} placeholder="Ex.: oficinas e consumidor final" /></label>
        <button disabled={Boolean(busy)}>{busy === "generate" ? "Ollama está escrevendo..." : "✦ Gerar cadastro com Ollama"}</button>
      </form>
      <form onSubmit={create} className="tray-product-form">
        <h3>2. Revisar e publicar na Tray</h3>
        <label>Nome* <input value={product.name} onChange={change(setProduct, "name")} required /></label>
        <label>Descrição curta <textarea value={product.description_small} onChange={change(setProduct, "description_small")} /></label>
        <label>Descrição completa* <textarea className="large" value={product.description} onChange={change(setProduct, "description")} required /></label>
        <div className="tray-form-row"><label>Marca <input value={product.brand} onChange={change(setProduct, "brand")} /></label><label>Modelo <input value={product.model} onChange={change(setProduct, "model")} /></label></div>
        <div className="tray-form-row"><label>Referência* <input value={product.reference} onChange={change(setProduct, "reference")} required /></label><label>EAN <input value={product.ean} onChange={change(setProduct, "ean")} /></label><label>ID categoria* <input type="number" min="1" value={product.category_id} onChange={change(setProduct, "category_id")} required /></label></div>
        <div className="tray-form-row"><label>Preço* <input type="number" min="0.01" step="0.01" value={product.price} onChange={change(setProduct, "price")} required /></label><label>Custo <input type="number" min="0" step="0.01" value={product.cost_price} onChange={change(setProduct, "cost_price")} /></label><label>Estoque* <input type="number" min="0" step="1" value={product.stock} onChange={change(setProduct, "stock")} required /></label></div>
        <div className="tray-form-row"><label>Peso (g)* <input type="number" min="1" value={product.weight} onChange={change(setProduct, "weight")} required /></label><label>Comp. (cm)* <input type="number" min="1" value={product.length} onChange={change(setProduct, "length")} required /></label><label>Larg. (cm)* <input type="number" min="1" value={product.width} onChange={change(setProduct, "width")} required /></label><label>Alt. (cm)* <input type="number" min="1" value={product.height} onChange={change(setProduct, "height")} required /></label></div>
        <label>Título SEO <input value={product.meta_title} onChange={change(setProduct, "meta_title")} /></label>
        <label>Palavras-chave <input value={product.keywords} onChange={change(setProduct, "keywords")} /></label>
        <label className="tray-check"><input type="checkbox" checked={product.available} onChange={change(setProduct, "available")} /> Publicar como disponível na loja</label>
        <button disabled={Boolean(busy) || !connected}>{busy === "create" ? "Criando na Tray..." : "Criar produto na Tray"}</button>
      </form>
    </div>
    {message && <div className="tray-message success">✓ {message}</div>}{error && <div className="error">{error}</div>}
  </section>;
}
