import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import CharlieSalesPage from "./CharlieSalesPage.jsx";

const TIPO = {
  substituto_cadastrado: "Substituto cadastrado",
  marca_alternativa: "Marca alternativa",
  medidas_divergentes: "Medidas divergentes",
  mesmo_codigo_fabricante: "Mesmo código de fabricante",
  complementar_kit: "Kit complementar",
};

export default function CharlieProductMatch() {
  const [codigo, setCodigo] = useState("");
  const [painel, setPainel] = useState(null);
  const [erro, setErro] = useState("");

  async function carregar(filtro = codigo) {
    const consulta = filtro ? `?codigo=${encodeURIComponent(filtro)}` : "";
    setPainel(await api.get(`/charlie-product-match${consulta}`));
  }

  useEffect(() => { carregar("").catch((causa) => setErro(causa.message)); }, []);

  const pares = painel?.pares || [];

  return <CharlieSalesPage
    titulo="Produtos iguais"
    resumo={`${painel?.aviso || "Carregando."} A comparação usa código de fabricante, medidas cadastradas, o campo de produto similar e kit. Nome parecido não confirma equivalência.`}
    metricas={[{ rotulo: "Pares nesta lista", valor: painel ? String(pares.length) : "…" }]}
    lacunas={painel?.lacunas}
    erro={erro}
  >
    <form className="charlie-sales-filters" onSubmit={(event) => { event.preventDefault(); carregar(codigo).catch((causa) => setErro(causa.message)); }}>
      <label>Código ou nome<input value={codigo} onChange={(event) => setCodigo(event.target.value)} placeholder="Filtra a comparação" /></label>
      <button type="submit">Filtrar</button>
    </form>
    <section className="panel ecommerce-table">
      <header><h3>Correspondências</h3><small>{pares.length ? `${pares.length} par(es)` : "Nenhum par com os dados cadastrados."}</small></header>
      <div className="table-scroll"><table className="tabela"><thead><tr><th>Produto</th><th>Outro</th><th>Tipo</th><th>Compatibilidade</th><th>Motivo</th></tr></thead><tbody>
        {pares.length ? pares.map((item) => <tr key={item.id}>
          <td><b>{item.origemNome}</b><br /><small>{item.origemId}</small></td>
          <td><b>{item.destinoNome}</b><br /><small>{item.destinoId}</small></td>
          <td>{TIPO[item.tipo] || item.tipo}</td>
          <td>Não confirmada</td>
          <td>{item.motivo}</td>
        </tr>) : <tr><td colSpan="5">Nenhum código de fabricante, substituto ou kit coincidiu.</td></tr>}
      </tbody></table></div>
    </section>
  </CharlieSalesPage>;
}
