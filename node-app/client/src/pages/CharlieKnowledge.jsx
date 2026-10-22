import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

const STATUS = { rascunho: "Rascunho", aguardando_aprovacao: "Aguardando aprovação", aprovado: "Aprovado", vigente: "Vigente", substituido: "Substituído", revogado: "Revogado" };

export default function CharlieKnowledge({ open, onClose }) {
  const [items, setItems] = useState([]), [config, setConfig] = useState({ categories: [] }), [q, setQ] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: "", category: "Procedimentos gerais", description: "", content: "", type: "procedimento" });
  async function load() { try { const [list, cfg] = await Promise.all([api.get("/ia/memoria", { q }), api.get("/ia/memoria/configuracao")]); setItems(list.itens || []); setConfig(cfg); } catch (e) { setError(e.message); } }
  useEffect(() => { if (open) load(); }, [open]);
  if (!open) return null;
  async function save(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const file = event.currentTarget.elements.arquivo.files[0];
      if (file) { const data = new FormData(); Object.entries(form).forEach(([k, v]) => data.append(k, v)); data.append("permissions", JSON.stringify({ public: true })); data.append("arquivo", file); await api.upload("/ia/memoria/upload", data); }
      else await api.post("/ia/memoria", { ...form, permissions: { public: true } });
      setForm({ title: "", category: form.category, description: "", content: "", type: "procedimento" }); event.currentTarget.reset(); await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function status(id, value) { try { await api.patch(`/ia/memoria/${id}/status`, { status: value }); await load(); } catch (e) { setError(e.message); } }
  return <div className="charlie-modal-backdrop"><section className="charlie-modal knowledge-modal">
    <header><div><h2>Conhecimento do Charlie</h2><small>Políticas, procedimentos, decisões e documentos versionados.</small></div><button onClick={onClose}>Fechar</button></header>
    {error ? <div className="error">{error}</div> : null}
    <div className="knowledge-grid">
      <div>
        <div className="knowledge-search"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar conhecimento"/><button onClick={load}>Pesquisar</button></div>
        <div className="knowledge-list">{items.map((item) => <article key={item.id}>
          <div><strong>{item.title}</strong><span className={`knowledge-status ${item.status}`}>{STATUS[item.status] || item.status}</span></div>
          <p>{item.description || item.category}</p><small>{item.category} · versão {item.version} · {new Date(item.updatedAt).toLocaleDateString("pt-BR")}</small>
          <div className="knowledge-actions">
            {item.original ? <a href={`/api/ia/memoria/${item.id}/original`} target="_blank" rel="noreferrer">Original</a> : null}
            {item.status === "rascunho" ? <button onClick={() => status(item.id, "aguardando_aprovacao")}>Enviar para aprovação</button> : null}
            {item.status === "aguardando_aprovacao" ? <button onClick={() => status(item.id, "vigente")}>Aprovar e publicar</button> : null}
            {item.status === "vigente" ? <button onClick={() => status(item.id, "revogado")}>Revogar</button> : null}
          </div>
        </article>)}</div>
      </div>
      <form onSubmit={save} className="knowledge-form">
        <h3>Cadastrar conhecimento</h3>
        <label>Título<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}/></label>
        <label>Categoria<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{config.categories?.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Tipo<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="politica">Política</option><option value="procedimento">Procedimento</option><option value="decisao">Decisão</option><option value="referencia">Referência</option></select></label>
        <label>Descrição<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}/></label>
        <label>Conteúdo<textarea rows="7" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Obrigatório quando não houver arquivo"/></label>
        <label>Documento<input name="arquivo" type="file" accept=".pdf,.docx,.txt,.md,.xlsx"/></label>
        <small>PDF, DOCX, TXT, Markdown ou XLSX; limite de {Math.round((config.maxBytes || 0) / 1024 / 1024)} MB.</small>
        <button className="primary" disabled={busy}>{busy ? "Processando..." : "Salvar como rascunho"}</button>
      </form>
    </div>
  </section></div>;
}
