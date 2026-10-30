export const NOME_EMPRESA_PADRAO = "Dashboard Gerencial";

export function escolherNomeEmpresa(rows) {
  const empresas = (rows || [])
    .map((row) => ({
      nome: String(row?.NOMEEMPRESA ?? row?.NOME ?? "").trim(),
      padrao: Number(row?.PADRAO) === -1,
      id: Number(row?.IDEMPRESA) || 0,
    }))
    .filter((row) => row.nome);
  empresas.sort((a, b) => Number(b.padrao) - Number(a.padrao) || a.id - b.id);
  return empresas[0]?.nome || NOME_EMPRESA_PADRAO;
}
