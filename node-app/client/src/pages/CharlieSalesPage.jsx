import React from "react";

export default function CharlieSalesPage({
  kicker = "CHARLIE VENDAS",
  titulo,
  resumo,
  metricas = [],
  lacunas = [],
  erro = "",
  aviso = "",
  acoes = null,
  children,
}) {
  const textoResumo = typeof resumo === "string" ? resumo : "";
  const limites = (lacunas || []).filter((item) => item && !textoResumo.includes(item));

  return <div className="charlie-sales-page">
    <section className="charlie-sales-hero">
      <div>
        <span className="tray-kicker">{kicker}</span>
        <h2>{titulo}</h2>
        {resumo ? <p>{resumo}</p> : null}
      </div>
      {acoes ? <div className="charlie-sales-hero-acoes">{acoes}</div> : null}
    </section>
    {metricas.length > 0 && <ul className="charlie-sales-metricas">
      {metricas.map((item) => <li key={item.rotulo}>
        <span>{item.rotulo}</span>
        <strong>{item.valor == null || item.valor === "" ? "—" : item.valor}</strong>
      </li>)}
    </ul>}
    {erro ? <p className="charlie-sales-banner erro">{erro}</p> : null}
    {aviso ? <p className="charlie-sales-banner ok">{aviso}</p> : null}
    {children}
    {limites.length > 0 && <details className="charlie-sales-limites">
      <summary>Limites desta leitura</summary>
      <ul>{limites.map((lacuna) => <li key={lacuna}>{lacuna}</li>)}</ul>
    </details>}
  </div>;
}
