import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import ManualUpdate from "./ManualUpdate.jsx";

const EMPTY = {
  name: "",
  host: "",
  port: "3051",
  database: "",
  user: "",
  password: "",
  charset: "WIN1252",
  role: "",
};

export default function StartIniSetup({ onEditing, onSaved }) {
  const [step, setStep] = useState("hidden");
  const [senha, setSenha] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [hasPassword, setHasPassword] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    onEditing?.(step === "editor");
  }, [step, onEditing]);

  function setField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function close() {
    setStep("hidden");
    setSenha("");
    setError("");
    setInfo("");
    setForm(EMPTY);
  }

  async function openConfig(event) {
    event.preventDefault();
    setError("");
    setInfo("");
    setBusy(true);
    try {
      const data = await api.post("/setup/start-ini", { senha, acao: "abrir" });
      const config = data.config || {};
      setForm({
        name: config.name || "",
        host: config.host || "",
        port: String(config.port || 3051),
        database: config.database || "",
        user: config.user || "",
        password: "",
        charset: config.charset || "WIN1252",
        role: config.role || "",
      });
      setHasPassword(Boolean(config.has_password));
      setStep("editor");
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  }

  function payload(acao) {
    const body = {
      senha,
      acao,
      name: form.name,
      host: form.host,
      port: form.port,
      database: form.database,
      user: form.user,
      charset: form.charset,
      role: form.role,
    };
    if (form.password) body.password = form.password;
    return body;
  }

  async function run(acao) {
    setError("");
    setInfo("");
    setBusy(true);
    try {
      const data = await api.post("/setup/start-ini", payload(acao));
      if (acao === "salvar") {
        setInfo("Dados do start.ini salvos.");
        setForm((current) => ({ ...current, password: "" }));
        setHasPassword(true);
        onSaved?.();
      } else {
        setInfo(data.mensagem || "Conexão realizada.");
      }
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  }

  if (step === "hidden") {
    return (
      <div className="login-links">
        <button type="button" className="link-btn start-ini-open" onClick={() => { setError(""); setStep("password"); }}>
          Suporte
        </button>
        <ManualUpdate />
      </div>
    );
  }

  if (step === "password") {
    return (
      <form className="start-ini-gate" onSubmit={openConfig}>
        <p>Senha para abrir a configuração do banco.</p>
        <input
          type="password"
          autoFocus
          value={senha}
          onChange={(event) => setSenha(event.target.value)}
          placeholder="Senha"
          autoComplete="off"
          required
        />
        <div className="start-ini-actions">
          <button type="submit" disabled={busy}>Abrir</button>
          <button type="button" className="secondary" onClick={close}>Cancelar</button>
        </div>
        {error && <div className="error">{error}</div>}
      </form>
    );
  }

  return (
    <form className="start-ini-form" onSubmit={(event) => { event.preventDefault(); run("salvar"); }}>
      <h2>start.ini</h2>
      <p>Dados da conexão com o Firebird. A senha do banco só muda se for preenchida.</p>
      <label>Nome<input value={form.name} onChange={(event) => setField("name", event.target.value)} /></label>
      <label>Servidor<input value={form.host} onChange={(event) => setField("host", event.target.value)} required /></label>
      <label>Porta<input value={form.port} onChange={(event) => setField("port", event.target.value)} inputMode="numeric" required /></label>
      <label>Caminho do banco<input value={form.database} onChange={(event) => setField("database", event.target.value)} required /></label>
      <label>Usuário<input value={form.user} onChange={(event) => setField("user", event.target.value)} autoComplete="off" required /></label>
      <label>
        Senha do banco
        <input
          type="password"
          value={form.password}
          onChange={(event) => setField("password", event.target.value)}
          autoComplete="new-password"
          placeholder={hasPassword ? "Manter a senha atual" : "Senha"}
        />
      </label>
      <label>Charset<input value={form.charset} onChange={(event) => setField("charset", event.target.value)} /></label>
      <label>Role<input value={form.role} onChange={(event) => setField("role", event.target.value)} /></label>
      {info && <div className="success">{info}</div>}
      {error && <div className="error">{error}</div>}
      <div className="start-ini-actions">
        <button type="submit" disabled={busy}>Salvar</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => run("testar")}>Testar</button>
      </div>
      <button type="button" className="link-btn start-ini-open" onClick={close}>Voltar ao login</button>
    </form>
  );
}
